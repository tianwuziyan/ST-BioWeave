import { createChatBoundary } from "./chat.js";
import {
  createStore,
  hasSwipeSlot,
  hasSwipeStructure,
  isCharacterMessage,
} from "../storage/store.js";
import { createAnalyzer } from "../ai/analyzer.js";
import { createStoryTime } from "../story/time.js";
import {
  FOLLOW_DEFAULT_API,
  SILLYTAVERN_CURRENT_API,
  cloneValue,
} from "../storage/schema.js";
import {
  applyClearPlanToState,
  buildClearPlan,
  createClearService,
} from "../storage/clear.js";
import { createEventAnalysisCoordinator } from "./event-analysis.js";
import { floorVersion, hashText, sameFloorVersion } from "./floor.js";
import { createStoryTimeCoordinator } from "../story/coordinator.js";
import { createCalendarResolver } from "../story/calendar.js";
import { createProjectionPersistence } from "../storage/projection.js";
import { createProjectionContextCoordinator } from "./projection-context.js";
import { createRuntimeActivity } from "./activity.js";

const LIFECYCLE_EVENTS = [
  "CHAT_CHANGED",
  "CHAT_CREATED",
  "MESSAGE_UPDATED",
  "MESSAGE_EDITED",
  "MESSAGE_DELETED",
  "MESSAGE_SWIPED",
  "MESSAGE_SWIPE_DELETED",
  "MESSAGE_RECEIVED",
  "GENERATION_ENDED",
  "GENERATION_STOPPED",
  "GENERATION_CANCELLED",
  "GENERATION_STARTED",
  "CHARACTER_MESSAGE_RENDERED",
];

const SOURCE_OWNER_LATEST_MERGE = true;

function ownerId(value) {
  const raw =
    typeof value === "string"
      ? value
      : value?.chatId ?? value?.chat_id ?? value?.owner?.chatId ?? value?.owner?.chat_id;
  return typeof raw === "string" ? raw.trim() : raw ?? null;
}

function chatIdKey(value) {
  const id = ownerId(value);
  return id == null ? null : String(id).replace(/\.jsonl$/iu, "");
}

function cloneOwnerValue(value) {
  return cloneValue(value);
}

function stableOwnerValue(value) {
  if (Array.isArray(value)) return value.map(stableOwnerValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableOwnerValue(value[key])]),
  );
}

function ownerIdentityFromContext(context) {
  const custom = context?.getChatOwnerIdentity?.();
  const source = custom && typeof custom === "object" ? custom : context;
  return {
    characterId:
      source?.characterId ??
      source?.character_id ??
      source?.activeCharacterId ??
      source?.active_character_id ??
      null,
    groupId:
      source?.groupId ??
      source?.group_id ??
      source?.activeGroupId ??
      source?.active_group_id ??
      null,
  };
}

function characterForOwner(context, owner = {}) {
  const identity = ownerIdentityFromContext(context);
  const characterId =
    owner?.characterId ?? owner?.character_id ?? identity.characterId;
  const characters = context?.characters;
  const character =
    (characters && characterId != null ? characters[characterId] : null) ??
    context?.character ??
    context?.characterCard ??
    null;
  const name =
    owner?.characterName ??
    owner?.character_name ??
    character?.name ??
    (String(characterId) === String(identity.characterId)
      ? context?.name2
      : null);
  const avatar =
    owner?.avatarUrl ??
    owner?.avatar_url ??
    character?.avatar ??
    context?.avatar_url ??
    context?.avatarUrl;
  if (typeof name !== "string" || !name.trim()) return null;
  if (typeof avatar !== "string" || !avatar.trim()) return null;
  return {
    characterId,
    groupId: identity.groupId,
    ch_name: name,
    avatar_url: avatar,
  };
}

function sourceRequestHeaders(context) {
  let headers = {};
  try {
    headers = context?.getRequestHeaders?.() ?? {};
  } catch {
    headers = {};
  }
  const contentType = Object.keys(headers).find(
    (key) => key.toLowerCase() === "content-type",
  );
  return contentType
    ? headers
    : { ...headers, "Content-Type": "application/json" };
}

function sourceError(code, details = {}) {
  const error = new Error(code);
  error.code = code;
  Object.assign(error, details);
  return error;
}

export function createSillyTavernAdapter() {
  const getContext = () => globalThis.SillyTavern?.getContext?.() ?? null;
  let chatIndexCache = null;
  let chatIndexOwnerKey = null;
  let persistenceTraceSink = null;

  function emitPersistenceTrace(payload = {}) {
    try {
      const allowed = new Set([
      "domain", "chat_id", "active_chat_id", "active_character_floor_message_id", "active_swipe_id", "message_id", "floor", "swipe_id", "content_hash",
        "message_version", "attempt", "trigger", "stage", "path", "reason",
        "generation_id", "generation_type", "generation_source", "execution_active",
        "cancel_stage", "cancel_reason", "cancel_code",
        "original_chat_id", "current_chat_id", "original_message_id", "current_owner_message_id",
        "original_swipe_id", "current_swipe_id", "original_content_hash", "current_content_hash",
        "original_message_version", "current_message_version", "chat_id_match", "message_id_match",
        "swipe_id_match", "content_hash_match", "message_version_match", "generation_identity_match",
      "result", "present", "world_model_present", "species_count",
        "biological_type_count", "floor_version_match", "swipe_match", "commitState",
        "revision", "current_floor_present", "expected", "actual", "authoritative",
        "response_shape", "messages_present", "messages_count", "owner_found",
        "owner_message_id", "owner_message_found", "swipe_found", "swipe_structure", "active_swipe_id",
        "swipes_present", "swipes_count", "swipe_info_present", "swipe_info_count",
        "target_swipe_info_found", "target_extra_present", "target_bioweave_present",
        "failure_stage", "error_name", "error_code", "error_message", "diagnostic_code",
        "status", "phase",
      ]);
      const safe = Object.fromEntries(
        Object.entries(payload).filter(([key]) => allowed.has(key)),
      );
      persistenceTraceSink?.(safe);
    } catch {
      // Diagnostics must never change the persistence result.
    }
  }

  function persistenceTraceError(error, failureStage) {
    const code = String(
      error?.code ?? error?.error_code ?? error?.diagnostic_code ?? error?.name ?? "ERROR",
    ).slice(0, 160);
    const rawMessage = String(
      error?.safe_error_summary ?? error?.message ?? code,
    );
    const message = rawMessage
      .replace(/authorization\s*[:=]\s*\S+/giu, "authorization:[redacted]")
      .replace(/api[_-]?key\s*[:=]\s*\S+/giu, "api_key:[redacted]")
      .slice(0, 240);
    return {
      failure_stage: failureStage,
      error_name: String(error?.name ?? "Error").slice(0, 80),
      error_code: code,
      error_message: message,
      diagnostic_code: String(error?.diagnostic_code ?? error?.diagnosticCode ?? code).slice(0, 160),
      ...(error?.status !== undefined ? {status: Number(error.status) || String(error.status)} : {}),
    };
  }

  function ownerKey(context, owner = {}) {
    const identity = ownerIdentityFromContext(context);
    const characterId =
      owner?.characterId ?? owner?.character_id ?? identity.characterId;
    const groupId = owner?.groupId ?? owner?.group_id ?? identity.groupId;
    const character = characterForOwner(context, owner);
    return `${groupId ?? ""}|${characterId ?? ""}|${character?.avatar_url ?? ""}`;
  }

  function sourceDescriptor(context, owner = {}) {
    const chatId = ownerId(owner);
    if (!chatId) throw sourceError("SOURCE_OWNER_REQUIRED");
    const identity = ownerIdentityFromContext(context);
    const groupId = owner?.groupId ?? owner?.group_id ?? identity.groupId;
    const characterId = owner?.characterId ?? owner?.character_id;
    if (
      characterId != null &&
      identity.characterId != null &&
      String(characterId) !== String(identity.characterId)
    ) {
      throw sourceError("SOURCE_OWNER_IDENTITY_MISMATCH");
    }
    if (
      groupId != null &&
      identity.groupId != null &&
      String(groupId) !== String(identity.groupId)
    ) {
      throw sourceError("SOURCE_OWNER_IDENTITY_MISMATCH");
    }
    if (groupId != null && String(groupId).trim()) {
      throw sourceError("SOURCE_OWNER_GROUP_UNSUPPORTED");
    }
    const character = characterForOwner(context, owner);
    if (!character)
      throw sourceError("SOURCE_OWNER_CHARACTER_UNAVAILABLE");
    return {
      chatId,
      apiFileName: String(chatId).replace(/\.jsonl$/iu, ""),
      characterId: character.characterId,
      groupId: null,
      ch_name: character.ch_name,
      avatar_url: character.avatar_url,
    };
  }

  async function requestJson(endpoint, body, { signal = undefined, write = false } = {}) {
    const context = getContext();
    const fetchRef = globalThis.fetch;
    if (typeof fetchRef !== "function")
      throw sourceError("SOURCE_OWNER_HTTP_UNAVAILABLE");
    let response;
    try {
      response = await fetchRef(endpoint, {
        method: "POST",
        headers: sourceRequestHeaders(context),
        body: JSON.stringify(body),
        cache: "no-cache",
        ...(signal ? { signal } : {}),
      });
    } catch (error) {
      const wrapped = sourceError(
        write ? "SOURCE_OWNER_SAVE_UNKNOWN" : "SOURCE_OWNER_READ_FAILED",
        { cause: error },
      );
      if (write) wrapped.commitState = "unknown";
      throw wrapped;
    }
    if (!response?.ok) {
      const status = Number(response?.status) || 0;
      const error = sourceError(
        write && status >= 500
          ? "SOURCE_OWNER_SAVE_UNKNOWN"
          : write
            ? "SOURCE_OWNER_SAVE_FAILED"
            : "SOURCE_OWNER_READ_FAILED",
        { status, statusText: response?.statusText },
      );
      if (write && status >= 500) error.commitState = "unknown";
      throw error;
    }
    if (write) return response;
    try {
      return await response.json();
    } catch (error) {
      throw sourceError("SOURCE_OWNER_READ_INVALID_RESPONSE", { cause: error });
    }
  }

  async function sourceRevision(state) {
    return hashText(
      JSON.stringify(
        stableOwnerValue({
          chatId: state.chatId,
          characterId: state.characterId,
          groupId: state.groupId,
          header: state.header,
          chatMetadata: state.chatMetadata,
          messages: state.messages,
        }),
      ),
    );
  }

  function parseSourceResponse(data, descriptor) {
    if (!Array.isArray(data))
      throw sourceError("SOURCE_OWNER_READ_INVALID_RESPONSE");
    const header = data.length > 0 && data[0] && typeof data[0] === "object"
      ? data[0]
      : {};
    const metadata = header.chat_metadata ?? {};
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata))
      throw sourceError("SOURCE_OWNER_METADATA_INVALID");
    return {
      chatId: descriptor.chatId,
      chat_id: descriptor.chatId,
      characterId: descriptor.characterId,
      groupId: descriptor.groupId,
      header: cloneOwnerValue(header),
      chatMetadata: cloneOwnerValue(metadata),
      metadata: cloneOwnerValue(metadata),
      messages: cloneOwnerValue(data.slice(data.length > 0 ? 1 : 0)),
      chat: cloneOwnerValue(data.slice(data.length > 0 ? 1 : 0)),
      response_shape: "json_array_jsonl",
    };
  }

  async function readOfficialChatOwner(owner) {
    const context = getContext();
    const descriptor = sourceDescriptor(context, owner);
    const data = await requestJson(
      "/api/chats/get",
      {
        ch_name: descriptor.ch_name,
        file_name: descriptor.apiFileName,
        avatar_url: descriptor.avatar_url,
      },
      { signal: owner?.signal },
    );
    const state = parseSourceResponse(data, descriptor);
    state.revision = await sourceRevision(state);
    state.sourceRevision = state.revision;
    state.owner = {
      chatId: descriptor.chatId,
      characterId: descriptor.characterId,
      groupId: descriptor.groupId,
      revision: state.revision,
    };
    return state;
  }

  async function saveOfficialChatOwner(payload) {
    const owner = payload?.owner ?? payload;
    const descriptor = sourceDescriptor(getContext(), owner);
    const latest = await readOfficialChatOwner(owner);
    if (payload?.signal?.aborted)
      throw sourceError("SOURCE_OWNER_SAVE_UNKNOWN", { commitState: "unknown" });
    const plan = buildClearPlan({
      domain: payload?.plan?.domain ?? payload?.plan?.operation ?? "all",
      owner,
      chatId: descriptor.chatId,
      state: latest,
      sourceTargeted: true,
    });
    const next = applyClearPlanToState(latest, plan);
    const header = {
      ...(next.header && typeof next.header === "object" ? cloneOwnerValue(next.header) : {}),
      chat_metadata: cloneOwnerValue(next.chatMetadata),
      user_name: next.header?.user_name ?? "unused",
      character_name: next.header?.character_name ?? "unused",
    };
    await requestJson(
      "/api/chats/save",
      {
        ch_name: descriptor.ch_name,
        file_name: descriptor.apiFileName,
        chat: [header, ...cloneOwnerValue(next.messages)],
        avatar_url: descriptor.avatar_url,
        force: false,
      },
      { signal: payload?.signal, write: true },
    );
    return {
      commitState: "confirmed",
      mergeMode: "latest-source",
      baseRevision: latest.revision,
      baseState: cloneOwnerValue(latest),
      plan,
    };
  }

  function messageTextForFloor(message, swipeId) {
    if (hasSwipeStructure(message)) {
      const active = Number.isInteger(message?.swipe_id) ? message.swipe_id : 0;
      return message?.swipes?.[swipeId]
        ?? message?.swipe_info?.[swipeId]?.mes
        ?? (Number(swipeId) === active ? message?.mes ?? message?.content ?? "" : "");
    }
    return message?.mes ?? message?.content ?? "";
  }

  function messageIdForFloor(message, fallback) {
    return message?.message_id ?? message?.messageId ?? message?.id ?? fallback;
  }

  function writeFloorSlot(message, swipeId, value) {
    if (hasSwipeStructure(message)) {
      const canCreateInitialSwipe = Number(swipeId) === 0
        && (Number.isInteger(message?.swipe_id) ? message.swipe_id : 0) === 0
        && Boolean(
          message?.swipes?.[0] ??
          message?.mes ??
          message?.content ??
          message?.swipe_info?.[0]?.mes,
        );
      if (!hasSwipeSlot(message, swipeId) && !canCreateInitialSwipe)
        throw sourceError("SWIPE_NOT_FOUND");
      message.swipe_info ??= [];
      message.swipe_info[swipeId] ??= {};
      message.swipe_info[swipeId].extra ??= {};
      message.swipe_info[swipeId].extra.bioweave = cloneOwnerValue(value);
      return;
    }
    message.extra ??= {};
    message.extra.bioweave = cloneOwnerValue(value);
  }

  function readFloorSlot(message, swipeId) {
    if (hasSwipeStructure(message))
      return message?.swipe_info?.[swipeId]?.extra?.bioweave;
    return message?.extra?.bioweave;
  }

  async function saveOfficialFloorBioWeave(
    messageIndex,
    swipeId,
    value,
    expectedChatId,
    expectedVersion,
    traceContext = null,
  ) {
    const traceStage = (worldStage, eventStage = worldStage) =>
      traceContext?.domain === "event" ? eventStage : worldStage;
    const trace = (stage, details = {}) => emitPersistenceTrace({
      ...traceContext,
      stage,
      ...details,
    });
    if (typeof globalThis.fetch !== "function") {
      trace(traceStage("WORLD_SAVE_PATH_SELECTED", "EVENT_SAVE_PATH_SELECTED"), {
        path: "context_fallback",
        reason: "fetch unavailable",
      });
      return null;
    }
    const context = getContext();
    let descriptor;
    try {
      descriptor = sourceDescriptor(context, { chatId: expectedChatId });
    } catch (error) {
      if ([
        "SOURCE_OWNER_CHARACTER_UNAVAILABLE",
        "SOURCE_OWNER_IDENTITY_MISMATCH",
        "SOURCE_OWNER_GROUP_UNSUPPORTED",
      ].includes(error?.code)) {
        trace(traceStage("WORLD_SAVE_PATH_SELECTED", "EVENT_SAVE_PATH_SELECTED"), {
          path: "context_fallback",
          reason:
            error?.code === "SOURCE_OWNER_CHARACTER_UNAVAILABLE"
              ? "sourceDescriptor unavailable"
              : error?.code === "SOURCE_OWNER_GROUP_UNSUPPORTED"
                ? "unsupported chat source"
                : "owner unresolved",
        });
        return null;
      }
      throw error;
    }
    trace(traceStage("WORLD_SAVE_PATH_SELECTED", "EVENT_SAVE_PATH_SELECTED"), {path: "official"});
    const liveMessage = context?.chat?.[messageIndex];
    if (expectedVersion && liveMessage) {
      const liveSwipeId = hasSwipeStructure(liveMessage)
        ? Number.isInteger(liveMessage.swipe_id) ? liveMessage.swipe_id : swipeId
        : swipeId;
      const liveVersion = await floorVersion({
        chatId: expectedChatId,
        messageId: messageIdForFloor(liveMessage, messageIndex),
        floor: liveMessage.floor ?? messageIndex,
        swipeId: liveSwipeId,
        text: messageTextForFloor(liveMessage, liveSwipeId),
        messageVersion: liveMessage.message_version ?? liveMessage.messageVersion,
      });
      const liveMatches = sameFloorVersion(liveVersion, expectedVersion);
      trace(traceStage("WORLD_OWNER_VERSION_CHECK", "EVENT_OWNER_VERSION_CHECK"), {
        result: liveMatches ? "match" : "mismatch",
        expected: expectedVersion,
        actual: liveVersion,
      });
      if (!liveMatches)
        throw sourceError("STALE_FLOOR_VERSION");
    }
    trace("OFFICIAL_GET_BEFORE_SAVE_BEGIN");
    const latest = await readOfficialChatOwner({
      chatId: expectedChatId,
      characterId: descriptor.characterId,
    });
    trace("OFFICIAL_GET_BEFORE_SAVE_END", {revision: latest.revision});
    let target;
    let targetIndex;
    let targetSwipeId;
    let expectedMessageId;
    let failureStage = "official_owner_resolution";
    let prewriteContext = {
      owner_message_found: false,
      swipe_id: Number.isInteger(swipeId) && swipeId >= 0 ? swipeId : 0,
      swipes_present: false,
      swipes_count: 0,
      swipe_info_present: false,
      swipe_info_count: 0,
      swipe_found: false,
      target_swipe_info_found: false,
      target_extra_present: false,
      target_bioweave_present: false,
    };
    try {
      trace("OFFICIAL_RESPONSE_SHAPE_RESOLVED", {
        response_shape: latest.response_shape ?? "json_array_jsonl",
        messages_present: Array.isArray(latest.messages),
        messages_count: Array.isArray(latest.messages) ? latest.messages.length : 0,
      });
      if (!Array.isArray(latest.messages))
        throw sourceError("SOURCE_OWNER_MESSAGES_INVALID");
      trace("OFFICIAL_MESSAGES_RESOLVED", {
        messages_present: true,
        messages_count: latest.messages.length,
      });
      expectedMessageId = expectedVersion?.message_id ??
        messageIdForFloor(context?.chat?.[messageIndex], messageIndex);
      targetIndex = latest.messages.findIndex((message, index) =>
        String(messageIdForFloor(message, index)) === String(expectedMessageId));
      trace("OFFICIAL_OWNER_MESSAGE_RESOLVED", {
        owner_found: targetIndex >= 0,
        owner_message_id: targetIndex >= 0
          ? messageIdForFloor(latest.messages[targetIndex], targetIndex)
          : expectedMessageId,
      });
      if (targetIndex < 0) throw sourceError("STALE_FLOOR_VERSION");
      target = latest.messages[targetIndex];
      prewriteContext = {
        ...prewriteContext,
        owner_message_found: true,
        swipes_present: Array.isArray(target?.swipes),
        swipes_count: Array.isArray(target?.swipes) ? target.swipes.length : 0,
        swipe_info_present: Boolean(target?.swipe_info && typeof target.swipe_info === "object"),
        swipe_info_count: Array.isArray(target?.swipe_info)
          ? target.swipe_info.length
          : target?.swipe_info && typeof target.swipe_info === "object"
            ? Object.keys(target.swipe_info).length
            : 0,
      };
      if (!isCharacterMessage(target)) {
        trace("OFFICIAL_OWNER_MESSAGE_RESOLVED", {
          owner_found: false,
          owner_message_id: messageIdForFloor(target, targetIndex),
        });
        throw sourceError("BIOWEAVE_USER_FLOOR_WRITE_FORBIDDEN");
      }
      failureStage = "official_owner_swipe_resolution";
      targetSwipeId = Number.isInteger(swipeId) && swipeId >= 0 ? swipeId : 0;
      const targetSwipeInfo = target?.swipe_info?.[targetSwipeId];
      const canCreateInitialSwipe = targetSwipeId === 0
        && (Number.isInteger(target?.swipe_id) ? target.swipe_id : 0) === 0
        && Boolean(
          target?.swipes?.[0] ??
          target?.mes ??
          target?.content ??
          target?.swipe_info?.[0]?.mes,
        );
      const swipeFound = !hasSwipeStructure(target) || hasSwipeSlot(target, targetSwipeId) || canCreateInitialSwipe;
      prewriteContext = {
        ...prewriteContext,
        swipe_id: targetSwipeId,
        swipe_found: swipeFound,
        target_swipe_info_found: targetSwipeInfo !== undefined && targetSwipeInfo !== null,
        target_extra_present: Boolean(targetSwipeInfo?.extra && typeof targetSwipeInfo.extra === "object"),
        target_bioweave_present: targetSwipeInfo?.extra?.bioweave !== undefined,
      };
      trace("OFFICIAL_OWNER_SWIPE_RESOLVED", {
        swipe_found: swipeFound,
        swipe_structure: hasSwipeStructure(target),
        active_swipe_id: Number.isInteger(target.swipe_id) ? target.swipe_id : targetSwipeId,
        swipe_id: targetSwipeId,
        swipes_present: Array.isArray(target?.swipes),
        swipes_count: Array.isArray(target?.swipes) ? target.swipes.length : 0,
        swipe_info_present: Boolean(target?.swipe_info && typeof target.swipe_info === "object"),
        swipe_info_count: Array.isArray(target?.swipe_info)
          ? target.swipe_info.length
          : target?.swipe_info && typeof target.swipe_info === "object"
            ? Object.keys(target.swipe_info).length
            : 0,
        target_swipe_info_found: targetSwipeInfo !== undefined && targetSwipeInfo !== null,
        target_extra_present: Boolean(targetSwipeInfo?.extra && typeof targetSwipeInfo.extra === "object"),
        target_bioweave_present: targetSwipeInfo?.extra?.bioweave !== undefined,
      });
      if (!swipeFound || (hasSwipeStructure(target) &&
        Number.isInteger(target.swipe_id) && target.swipe_id !== targetSwipeId))
        throw sourceError("STALE_FLOOR_VERSION");
      if (expectedVersion) {
        failureStage = "official_owner_floor_version_check";
        const authoritativeVersion = await floorVersion({
          chatId: expectedChatId,
          messageId: messageIdForFloor(target, targetIndex),
          floor: target.floor ?? targetIndex,
          swipeId: targetSwipeId,
          text: messageTextForFloor(target, targetSwipeId),
          messageVersion: target.message_version ?? target.messageVersion,
        });
        const versionMatches = sameFloorVersion(authoritativeVersion, expectedVersion);
        trace(traceStage("WORLD_OWNER_VERSION_CHECK", "EVENT_OWNER_VERSION_CHECK"), {
          result: versionMatches ? "match" : "mismatch",
          expected: expectedVersion,
          actual: authoritativeVersion,
        });
        if (!versionMatches)
          throw sourceError("STALE_FLOOR_VERSION");
      }
      if (expectedVersion && context?.chat?.[messageIndex]) {
        failureStage = "official_owner_live_version_check";
        const current = context.chat[messageIndex];
        const currentSwipeId = hasSwipeStructure(current)
          ? Number.isInteger(current.swipe_id) ? current.swipe_id : swipeId
          : swipeId;
        const currentVersion = await floorVersion({
          chatId: expectedChatId,
          messageId: messageIdForFloor(current, messageIndex),
          floor: current.floor ?? messageIndex,
          swipeId: currentSwipeId,
          text: messageTextForFloor(current, currentSwipeId),
          messageVersion: current.message_version ?? current.messageVersion,
        });
        const currentMatches = sameFloorVersion(currentVersion, expectedVersion);
        if (!currentMatches) {
          trace(traceStage("WORLD_OWNER_VERSION_CHECK", "EVENT_OWNER_VERSION_CHECK"), {
            result: "mismatch",
            expected: expectedVersion,
            actual: currentVersion,
          });
          throw sourceError("STALE_FLOOR_VERSION");
        }
      }
      // The slot marker is deliberately emitted only after all owner and
      // Floor Version guards pass.
    } catch (error) {
      trace("OFFICIAL_PREWRITE_FAILED", {
        ...persistenceTraceError(error, failureStage),
        ...prewriteContext,
      });
      throw error;
    }
    trace(traceStage("WORLD_SLOT_BEFORE_WRITE", "EVENT_SLOT_BEFORE_WRITE"), {
      present: readFloorSlot(target, targetSwipeId) !== undefined,
    });
    if (traceContext?.domain === "event") {
      const existing = readFloorSlot(target, targetSwipeId);
      trace("EVENT_SOURCE_WORLD_PRESENT", {
        present: existing?.world_model !== undefined && existing?.world_model !== null,
      });
    }
    writeFloorSlot(target, targetSwipeId, value);
    trace(traceStage("WORLD_SLOT_AFTER_MERGE", "EVENT_SLOT_AFTER_MERGE"), {
      present: readFloorSlot(target, targetSwipeId) !== undefined,
    });
    const header = {
      ...(latest.header && typeof latest.header === "object" ? cloneOwnerValue(latest.header) : {}),
      chat_metadata: cloneOwnerValue(latest.chatMetadata),
      user_name: latest.header?.user_name ?? "unused",
      character_name: latest.header?.character_name ?? "unused",
    };
    trace(traceStage("OFFICIAL_SAVE_BEGIN", "EVENT_SAVE_BEGIN"));
    await requestJson(
      "/api/chats/save",
      {
        ch_name: descriptor.ch_name,
        file_name: descriptor.apiFileName,
        chat: [header, ...cloneOwnerValue(latest.messages)],
        avatar_url: descriptor.avatar_url,
        force: false,
      },
      { write: true },
    );
    trace(traceStage("OFFICIAL_SAVE_END", "EVENT_SAVE_END"));
    trace("OFFICIAL_GET_AFTER_SAVE_BEGIN");
    const committed = await readOfficialChatOwner({
      chatId: expectedChatId,
      characterId: descriptor.characterId,
    });
    trace("OFFICIAL_GET_AFTER_SAVE_END", {revision: committed.revision});
    const committedMessage = committed.messages.find((message, index) =>
      String(messageIdForFloor(message, index)) === String(expectedMessageId));
    const readbackPresent = Boolean(committedMessage && readFloorSlot(committedMessage, targetSwipeId) !== undefined);
    trace(traceStage("WORLD_SLOT_AFTER_READBACK", "EVENT_SLOT_AFTER_READBACK"), {
      present: readbackPresent,
      floor_version_match: Boolean(committedMessage),
      swipe_match: Boolean(committedMessage && (!hasSwipeStructure(committedMessage) || committedMessage.swipe_id === targetSwipeId)),
    });
    if (!committedMessage || JSON.stringify(readFloorSlot(committedMessage, targetSwipeId)) !== JSON.stringify(value))
      throw sourceError("FLOOR_PERSISTENCE_READBACK_FAILED");
    if (String(getContext()?.chatId) !== String(expectedChatId))
      throw sourceError("STALE_CHAT");
    const committedLiveMessage = getContext()?.chat?.[messageIndex];
    if (committedLiveMessage && String(messageIdForFloor(committedLiveMessage, messageIndex)) === String(expectedMessageId))
      writeFloorSlot(committedLiveMessage, targetSwipeId, value);
    return {
      commitState: "confirmed",
      mergeMode: "latest-source-floor-slot",
      authoritativeReadback: true,
    };
  }

  async function refreshOfficialChatIndex() {
    const context = getContext();
    const descriptor = sourceDescriptor(context, {
      chatId: context?.chatId,
      characterId: ownerIdentityFromContext(context).characterId,
    });
    const data = await requestJson(
      "/api/characters/chats",
      { avatar_url: descriptor.avatar_url },
    );
    if (!data || typeof data !== "object" || Array.isArray(data) || data.error === true)
      throw sourceError("CHAT_INDEX_INVALID");
    const ids = new Set();
    for (const entry of Object.values(data)) {
      const id = ownerId(entry?.file_name ?? entry?.chatId ?? entry?.chat_id ?? entry);
      if (id) ids.add(chatIdKey(id));
    }
    ids.add(chatIdKey(descriptor.chatId));
    chatIndexCache = ids;
    chatIndexOwnerKey = ownerKey(context, descriptor);
    return new Set(ids);
  }

  return {
    getContext,
    sourceOwnerLatestMerge: SOURCE_OWNER_LATEST_MERGE,
    getChat: () => getContext()?.chat ?? null,
    getExtensionSettings: () => getContext()?.extensionSettings ?? null,
    getGlobalSettings: () => getContext()?.extensionSettings?.bioweave ?? null,
    getRequestHeaders: () => getContext()?.getRequestHeaders?.() ?? {},
    fetch: (...args) => globalThis.fetch(...args),
    async saveGlobalSettings(value) {
      const context = getContext();
      if (
        !context?.extensionSettings ||
        typeof context.saveSettingsDebounced !== "function"
      ) {
        throw new Error("ST_EXTENSION_SETTINGS_UNAVAILABLE");
      }
      const hadPrevious = Object.prototype.hasOwnProperty.call(
        context.extensionSettings,
        "bioweave",
      );
      const previous = context.extensionSettings.bioweave;
      context.extensionSettings.bioweave = value;
      try {
        await context.saveSettingsDebounced();
      } catch (error) {
        if (hadPrevious) context.extensionSettings.bioweave = previous;
        else delete context.extensionSettings.bioweave;
        throw error;
      }
    },
    getChatId: () => getContext()?.chatId ?? null,
    getChatMetadata: () => getContext()?.chatMetadata ?? null,
    getMessage: (index) => getContext()?.chat?.[index] ?? null,
    getChatRevision: (chatId) => {
      const context = getContext();
      const value =
        context?.chatRevision ??
        context?.chat_revision ??
        context?.chatStateRevision ??
        context?.chat_state_revision;
      if (typeof context?.getChatRevision === "function")
        return context.getChatRevision(chatId);
      if (typeof context?.getRevision === "function")
        return context.getRevision(chatId);
      return value;
    },
    getChatOwnerIdentity: () => {
      const context = getContext();
      if (typeof context?.getChatOwnerIdentity === "function")
        return context.getChatOwnerIdentity();
      return {
        characterId:
          context?.characterId ??
          context?.character_id ??
          context?.activeCharacterId ??
          context?.active_character_id ??
          null,
        groupId:
          context?.groupId ??
          context?.group_id ??
          context?.activeGroupId ??
          context?.active_group_id ??
          null,
      };
    },
    getChatIndex: () => {
      const context = getContext();
      if (typeof context?.getChatIndex === "function")
        return context.getChatIndex();
      if (typeof context?.getKnownChatIds === "function")
        return context.getKnownChatIds();
      const contextIndex =
        context?.chatIndex ?? context?.chat_index ?? context?.chatIds ?? null;
      if (contextIndex !== null && contextIndex !== undefined)
        return contextIndex;
      return chatIndexOwnerKey === ownerKey(context)
        ? new Set(chatIndexCache ?? [])
        : null;
    },
    refreshChatIndex: refreshOfficialChatIndex,
    isFreshChat: (chatId) => {
      const context = getContext();
      if (typeof context?.isFreshChat === "function")
        return context.isFreshChat(chatId);
      if (typeof context?.getChatFreshness === "function")
        return context.getChatFreshness(chatId);
      return undefined;
    },
    hasSourceOwnerCapability: () => {
      const context = getContext();
      const reader = [
        "readChatOwner",
        "readChatSnapshot",
        "getChatOwnerSnapshot",
      ].some((name) => typeof context?.[name] === "function");
      const writer = [
        "compareAndSaveChatOwner",
        "compareAndSwapChatOwner",
        "saveChatOwnerCAS",
        "commitChatOwnerCAS",
        "saveChatOwner",
        "saveChatSnapshot",
        "saveChatStateByOwner",
      ].some((name) => typeof context?.[name] === "function");
      const cas =
        context?.sourceOwnerRevisionCAS === true ||
        context?.supportsSourceOwnerRevisionCAS === true ||
        context?.capabilities?.sourceOwnerRevisionCAS === true ||
        [
          "compareAndSaveChatOwner",
          "compareAndSwapChatOwner",
          "saveChatOwnerCAS",
          "commitChatOwnerCAS",
        ].some((name) => typeof context?.[name] === "function");
      const officialLatestMerge = Boolean(
        typeof globalThis.fetch === "function" &&
        context &&
        context?.chatId &&
        characterForOwner(context, { chatId: context.chatId }),
      );
      return Boolean(
        (reader && writer && cas) || officialLatestMerge,
      );
    },
    async compareAndSaveChatOwner(payload) {
      const context = getContext();
      const name = [
        "compareAndSaveChatOwner",
        "compareAndSwapChatOwner",
        "saveChatOwnerCAS",
        "commitChatOwnerCAS",
      ].find((candidate) => typeof context?.[candidate] === "function");
      if (name) return context[name].call(context, payload);
      if (
        context?.sourceOwnerRevisionCAS === true &&
        typeof context?.saveChatOwner === "function"
      )
        return context.saveChatOwner.call(context, payload);
      return saveOfficialChatOwner(payload);
    },
    async readChatOwner(owner) {
      const context = getContext();
      const customReader = [
        "readChatOwner",
        "readChatSnapshot",
        "getChatOwnerSnapshot",
      ].find((name) => typeof context?.[name] === "function");
      return customReader
        ? context[customReader].call(context, owner)
        : readOfficialChatOwner(owner);
    },
    async saveChatOwner(payload) {
      const context = getContext();
      const name = [
        "saveChatOwner",
        "saveChatSnapshot",
        "saveChatStateByOwner",
      ].find((candidate) => typeof context?.[candidate] === "function");
      return name
        ? context[name].call(context, payload)
        : saveOfficialChatOwner(payload);
    },
    async saveChat(options = {}) {
      const context = getContext();
      const expectedChatId = options?.expectedChatId ?? options?.chatId;
      if (
        expectedChatId !== undefined &&
        String(context?.chatId) !== String(expectedChatId)
      ) {
        throw sourceError("STALE_CHAT");
      }
      if (typeof context?.saveChat !== "function")
        throw sourceError("ST_CHAT_STORAGE_UNAVAILABLE");
      const response = await context.saveChat();
      if (
        expectedChatId !== undefined &&
        getContext()?.chatId !== expectedChatId
      ) {
        throw sourceError("STALE_CHAT");
      }
      return response ?? { commitState: "confirmed" };
    },
    async saveChatMetadata(key, value, expectedChatId) {
      const context = getContext();
      if (expectedChatId !== undefined && context?.chatId !== expectedChatId) {
        throw new Error("STALE_CHAT");
      }
      if (
        !context?.chatMetadata ||
        typeof context.saveMetadata !== "function"
      ) {
        throw new Error("ST_METADATA_UNAVAILABLE");
      }
      context.chatMetadata[key] = value;
      const response = await context.saveMetadata();
      if (
        expectedChatId !== undefined &&
        getContext()?.chatId !== expectedChatId
      ) {
        throw new Error("STALE_CHAT");
      }
      return response ?? { commitState: "confirmed" };
    },
    async saveFloorBioWeave(messageIndex, swipeId, value, expectedChatId, expectedVersion, traceContext = null) {
      const context = getContext();
      if (expectedChatId !== undefined && context?.chatId !== expectedChatId) {
        throw new Error("STALE_CHAT");
      }
      const message = context?.chat?.[messageIndex];
      if (!message) throw new Error("MESSAGE_NOT_FOUND");
      if (!isCharacterMessage(message))
        throw new Error("BIOWEAVE_USER_FLOOR_WRITE_FORBIDDEN");
      const targetSwipeId =
        Number.isInteger(swipeId) && swipeId >= 0 ? swipeId : 0;
      const authoritative = await saveOfficialFloorBioWeave(
        messageIndex,
        targetSwipeId,
        value,
        expectedChatId,
        expectedVersion,
        traceContext,
      );
      if (authoritative) return authoritative;
      const trace = (stage, details = {}) => emitPersistenceTrace({
        ...traceContext,
        stage,
        ...details,
      });
      traceContext?.domain === "world"
        ? trace("WORLD_SLOT_BEFORE_WRITE", {present: Boolean(message?.extra?.bioweave || message?.swipe_info?.[targetSwipeId]?.extra?.bioweave)})
        : trace("EVENT_SOURCE_WORLD_PRESENT", {present: Boolean(message?.extra?.bioweave?.world_model || message?.swipe_info?.[targetSwipeId]?.extra?.bioweave?.world_model)});
      if (hasSwipeStructure(message)) {
        if (!hasSwipeSlot(message, targetSwipeId))
          throw new Error("SWIPE_NOT_FOUND");
        message.swipe_info ??= [];
        message.swipe_info[targetSwipeId] ??= {};
        message.swipe_info[targetSwipeId].extra ??= {};
        message.swipe_info[targetSwipeId].extra.bioweave = value;
      } else {
        message.extra ??= {};
        message.extra.bioweave = value;
      }
      trace(traceContext?.domain === "world" ? "WORLD_SLOT_AFTER_MERGE" : "EVENT_SLOT_AFTER_MERGE", {
        present: true,
      });
      if (traceContext?.domain === "event") trace("EVENT_SAVE_BEGIN");
      const response = await this.saveChat({ expectedChatId });
      trace(traceContext?.domain === "world" ? "WORLD_SLOT_AFTER_READBACK" : "EVENT_SLOT_AFTER_READBACK", {
        present: true,
        authoritative: false,
      });
      trace(traceContext?.domain === "world" ? "WORLD_PERSISTENCE_CONFIRMED" : "EVENT_SAVE_END", {
        commitState: response?.commitState ?? "confirmed",
      });
      if (
        expectedChatId !== undefined &&
        getContext()?.chatId !== expectedChatId
      ) {
        throw new Error("STALE_CHAT");
      }
      return response;
    },
    setPersistenceTraceSink(sink) {
      persistenceTraceSink = typeof sink === "function" ? sink : null;
    },
    setExtensionPrompt({key, content, position, depth, scan = false, role} = {}) {
      const context = getContext();
      const setter = context?.setExtensionPrompt ?? globalThis.setExtensionPrompt;
      if (typeof setter !== "function") throw sourceError("ST_EXTENSION_PROMPT_UNAVAILABLE");
      const types = context?.extension_prompt_types ?? globalThis.extension_prompt_types ?? {};
      const roles = context?.extension_prompt_roles ?? globalThis.extension_prompt_roles ?? {};
      const resolvedPosition = position === "IN_CHAT" ? types.IN_CHAT : position;
      const resolvedRole = role === "SYSTEM" ? roles.SYSTEM : role;
      if (resolvedPosition === undefined || resolvedRole === undefined)
        throw sourceError("ST_EXTENSION_PROMPT_API_INVALID");
      return context?.setExtensionPrompt
        ? setter.call(context, key, content, resolvedPosition, depth, scan, resolvedRole)
        : setter(key, content, resolvedPosition, depth, scan, resolvedRole);
    },
  };
}

export function createRuntime({
  adapter = createSillyTavernAdapter(),
  analyzer = null,
  storyTimeDebug = false,
  storyTimeTrace = null,
  characterContextResolver = null,
  analysisContextCollector = null,
  analysisSourceLoader = null,
  analysisSourceLoaderOptions = {},
  externalMemoryProviderLoader = null,
  analysisSourceCache = null,
} = {}) {
  const st = adapter;
  const chat = createChatBoundary(st);
  const store = createStore(st, chat);
  const subscriptions = new Set();
  const unbind = [];
  const activity = createRuntimeActivity();
  const recentLifecycleTrace = [];
  let persistenceTrace = null;
  let traceSequence = 0;
  let initialized = false;
  let destroyed = false;

  function isBioWeaveEnabled() {
    return store.getChat(chat.current()).settings?.enabled !== false;
  }

  function assertBioWeaveEnabled() {
    if (isBioWeaveEnabled()) return true;
    const error = new Error("BIOWEAVE_DISABLED");
    error.code = "BIOWEAVE_DISABLED";
    error.status = "disabled";
    throw error;
  }

  function notify(event) {
    if (event?.type === "BIOWEAVE_PERSISTENCE_TRACE") {
      const payload = event.payload ?? {};
      if (payload.stage === "AUTO_ANALYSIS_TRIGGERED") {
        persistenceTrace = {
          execution: {
            chat_id: payload.chat_id ?? chat.current(),
            message_id: payload.message_id ?? null,
            floor: payload.floor ?? null,
            swipe_id: payload.swipe_id ?? 0,
            content_hash: payload.content_hash ?? null,
            message_version: payload.message_version ?? null,
            attempt: payload.attempt ?? null,
            trigger: payload.trigger ?? null,
          },
          sequence: recentLifecycleTrace.slice(-32),
          terminal: null,
          host_post_save_hook: "NO_PUBLIC_POST_SAVE_HOOK",
        };
      }
      if (!persistenceTrace) {
        persistenceTrace = {
          execution: null,
          sequence: [],
          terminal: null,
        };
      }
      persistenceTrace.sequence.push({
        seq: ++traceSequence,
        stage: payload.stage ?? "UNKNOWN",
        ...sanitizePersistenceTracePayload(payload),
      });
    }
    if (event?.type === "EVENT_ANALYSIS_STATUS_CHANGED" && persistenceTrace && event.payload?.state !== "running") {
      persistenceTrace.terminal = event.payload?.state ?? null;
      const diagnostic = event.payload?.diagnostic ?? event.payload ?? {};
      const terminalStage = event.payload?.state === "failed"
        ? "ANALYSIS_FAILED"
        : `ANALYSIS_${String(event.payload?.state ?? "unknown").toUpperCase()}`;
      persistenceTrace.sequence.push({
        seq: ++traceSequence,
        ...sanitizePersistenceTracePayload(event.payload),
        stage: terminalStage,
        trigger: event.payload?.reason ?? persistenceTrace.execution?.trigger ?? null,
        failure_stage: event.payload?.state === "failed" ? diagnostic.stage ?? event.payload?.analysis_stage ?? null : undefined,
        error_name: event.payload?.state === "failed" ? diagnostic.error_name ?? null : undefined,
        error_code: event.payload?.state === "failed" ? diagnostic.error_code ?? event.payload?.error_code ?? null : undefined,
        error_message: event.payload?.state === "failed" ? diagnostic.error_message ?? diagnostic.safe_error_summary ?? null : undefined,
        diagnostic_code: event.payload?.state === "failed" ? diagnostic.diagnostic_code ?? event.payload?.diagnostic_code ?? null : undefined,
      });
    }
    activity.handleRuntimeEvent(event);
    for (const listener of [...subscriptions]) {
      try {
        listener(event);
      } catch (error) {
        console.error("[BioWeave] runtime subscriber failed", error);
      }
    }
  }

  function sanitizePersistenceTracePayload(payload = {}) {
    const allowed = [
      "chat_id", "active_chat_id", "active_character_floor_message_id", "active_swipe_id", "message_id", "floor", "swipe_id", "content_hash",
      "message_version", "attempt", "trigger", "domain", "state", "path",
      "generation_id", "generation_type", "generation_source", "execution_active",
      "cancel_stage", "cancel_reason", "cancel_code",
      "original_chat_id", "current_chat_id", "original_message_id", "current_owner_message_id",
      "original_swipe_id", "current_swipe_id", "original_content_hash", "current_content_hash",
      "original_message_version", "current_message_version", "chat_id_match", "message_id_match",
      "swipe_id_match", "content_hash_match", "message_version_match", "generation_identity_match",
      "reason", "result", "present", "world_model_present", "species_count",
      "biological_type_count", "floor_version_match", "swipe_match", "commitState",
      "revision", "current_floor_present",
    ];
    return Object.fromEntries(
      allowed
        .filter(key => payload[key] !== undefined)
        .map(key => [key, cloneSafeTraceValue(payload[key])]),
    );
  }

  function cloneSafeTraceValue(value) {
    if (value === null || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map(cloneSafeTraceValue);
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneSafeTraceValue(item)]));
  }

  function recordLifecycleTrace(stage, payload, chatId) {
    const generationType = typeof payload === "object"
      ? payload?.genType ?? payload?.generation_type ?? payload?.type ?? null
      : payload;
    const generationSource = typeof payload === "object"
      ? payload?.source ?? payload?.generation_source ?? payload?.reason ?? null
      : null;
    const entry = {
      seq: ++traceSequence,
      stage,
      chat_id: chatId ?? chat.current(),
    };
    const safe = sanitizePersistenceTracePayload({
      ...(payload && typeof payload === "object" ? payload : {}),
      ...(generationType != null ? {generation_type: String(generationType).slice(0, 40)} : {}),
      ...(generationSource != null ? {generation_source: String(generationSource).slice(0, 80)} : {}),
    });
    recentLifecycleTrace.push({...entry, ...safe});
    while (recentLifecycleTrace.length > 64) recentLifecycleTrace.shift();
    if (persistenceTrace) persistenceTrace.sequence.push({...entry, ...safe});
  }

  function getPersistenceTrace() {
    return cloneSafeTraceValue(persistenceTrace);
  }

  function recordPersistenceTrace(payload = {}) {
    notify({
      type: "BIOWEAVE_PERSISTENCE_TRACE",
      payload,
      chatId: payload?.chat_id ?? chat.current(),
    });
  }

  function notifyLifecycleSettled(key, eventType, payload) {
    notify({
      type: "BIOWEAVE_LIFECYCLE_SETTLED",
      eventType,
      mutationType: key,
      payload,
      chatId: chat.current(),
      epoch: chat.getEpoch(),
    });
  }

  st.setPersistenceTraceSink?.((payload) => notify({
    type: "BIOWEAVE_PERSISTENCE_TRACE",
    payload,
    chatId: payload?.chat_id ?? chat.current(),
  }));

  function resolveEventAnalysisProfile() {
    const settings = store.profileStore?.getSettings?.() ?? {};
    const assignment = settings.assignments?.event_analysis ?? null;
    if (assignment === SILLYTAVERN_CURRENT_API) return SILLYTAVERN_CURRENT_API;
    if (assignment === FOLLOW_DEFAULT_API) {
      if (settings.api_source === SILLYTAVERN_CURRENT_API)
        return SILLYTAVERN_CURRENT_API;
      return settings.default_profile_id
        ? (store.profileStore?.getProfile?.(settings.default_profile_id) ??
            null)
        : null;
    }
    return assignment
      ? (store.profileStore?.getProfile?.(assignment) ?? null)
      : null;
  }

  const eventAnalyzer =
    analyzer ??
    createAnalyzer({
      profileResolver: resolveEventAnalysisProfile,
      contextResolver: () => st.getContext?.() ?? null,
      requestSettingsResolver: () =>
        store.profileStore?.getApiRequestSettings?.() ?? {},
      analysisPromptResolver: () =>
        store.profileStore?.getAnalysisPrompt?.() ?? {},
    });
  const calendarResolver = createCalendarResolver();
  const resolvedStoryTime = createStoryTime({calendarResolver});
  const storyTimeCoordinator = createStoryTimeCoordinator({
    st,
    chat,
    store,
    storyTime: resolvedStoryTime,
    debug: storyTimeDebug,
    trace: storyTimeTrace,
  });
  const eventAnalysis = createEventAnalysisCoordinator({
    st,
    chat,
    store,
    analyzer: eventAnalyzer,
    storyTime: resolvedStoryTime,
    storyTimeCoordinator,
    ...(typeof characterContextResolver === "function"
      ? { characterContextResolver }
      : {}),
    ...(typeof analysisContextCollector === "function"
      ? { analysisContextCollector }
      : {}),
    ...(typeof analysisSourceLoader === "function"
      ? { analysisSourceLoader }
      : {}),
    analysisSourceLoaderOptions,
    ...(typeof externalMemoryProviderLoader === "function"
      ? { externalMemoryProviderLoader }
      : {}),
    ...(analysisSourceCache ? { analysisSourceCache } : {}),
    globalRecentStoryResolver: () =>
      store.profileStore?.getSettings?.()?.recent_story_global ?? {},
    enabledResolver: isBioWeaveEnabled,
    notify,
  });
  const projectionPersistence = createProjectionPersistence({
    store,
    enabledResolver: isBioWeaveEnabled,
    resolveCurrentFloorVersion: async ({ownerFloor}) => {
      const index = ownerFloor?.message_index ?? ownerFloor?.messageIndex ?? ownerFloor?.index;
      if (!Number.isInteger(Number(index))) return null;
      return (await eventAnalysis.resolveCurrentBioWeaveFloor({
        __messageIndex: true,
        index: Number(index),
      })).version;
    },
  });
  const projectionContext = createProjectionContextCoordinator({
    getProjectionViews: projectionPersistence.getProjectionViews,
    resolveCurrentFloor: () => eventAnalysis.resolveCurrentBioWeaveFloor(),
    getChatId: () => chat.current(),
    setExtensionPrompt: st.setExtensionPrompt,
    enabledResolver: isBioWeaveEnabled,
  });

  async function setBioWeaveEnabled(enabled) {
    const chatId = chat.current();
    const current = store.getChat(chatId);
    const next = enabled !== false;
    if (current.settings?.enabled === next) {
      if (!next) {
        eventAnalysis.pause?.();
        projectionContext.clearProjectionContext();
      }
      return next;
    }
    if (!next) {
      eventAnalysis.pause?.();
      projectionContext.clearProjectionContext();
    }
    await store.saveChat(chatId, {
      ...current,
      settings: {...(current.settings ?? {}), enabled: next},
    });
    if (next) {
      // Rebase the lifecycle hint at re-enable time so disabled-period Floors
      // are not interpreted as an automatic backlog.
      await eventAnalysis.primeLifecycleSnapshot?.();
      await projectionContext.refreshProjectionContext({chatId});
    }
    notify({
      type: "BIOWEAVE_ENABLED_CHANGED",
      payload: {enabled: next},
      chatId,
      epoch: chat.getEpoch(),
    });
    return next;
  }

  const clearService = createClearService({
    adapter: st,
    store,
    boundary: chat,
    invalidate: (payload) => eventAnalysis.invalidateForClear?.(payload),
  });
  let lifecycleSequence = 0;
  let lifecycleTail = Promise.resolve();
  let activeOwner = null;
  let knownChatIds = null;
  let knownChatIdsEvidence = false;
  let pendingStartNewChat = null;
  const failedSourceClears = new Map();

  function cloneValue(value) {
    if (value === undefined || value === null) return value;
    if (typeof structuredClone === "function") return structuredClone(value);
    if (Array.isArray(value)) return value.map(cloneValue);
    if (typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, cloneValue(item)]),
      );
    return value;
  }

  function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableValue(value[key])]),
    );
  }

  function scalarId(value) {
    if (typeof value === "string") return value.trim() || null;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    return null;
  }

  function eventChatId(payload) {
    if (payload === undefined || payload === null) return null;
    if (typeof payload === "string" || typeof payload === "number")
      return scalarId(payload);
    if (typeof payload !== "object") return null;
    return scalarId(
      payload.chatId ??
        payload.chat_id ??
        payload.chat_id_name ??
        payload.id ??
        null,
    );
  }

  function ownerIdentity() {
    let raw = {};
    try {
      raw = st.getChatOwnerIdentity?.() ?? {};
    } catch {
      raw = {};
    }
    return {
      characterId:
        raw.characterId ?? raw.character_id ?? raw.character ?? null,
      groupId: raw.groupId ?? raw.group_id ?? raw.group ?? null,
    };
  }

  function ownerIdentityMatches(source, target) {
    const sourceValue = source ?? {};
    const targetValue = target ?? {};
    const keys = ["characterId", "groupId"];
    const known = keys.filter(
      (key) => sourceValue[key] !== null && sourceValue[key] !== undefined,
    );
    if (!known.length) return false;
    return known.every(
      (key) =>
        targetValue[key] !== null &&
        targetValue[key] !== undefined &&
        String(targetValue[key]) === String(sourceValue[key]),
    );
  }

  function normalizeChatIds(raw) {
    if (raw && typeof raw.then === "function") return null;
    const value = raw?.chatIds ?? raw?.chat_ids ?? raw?.ids ?? raw;
    const entries =
      value instanceof Set
        ? [...value]
        : Array.isArray(value)
          ? value
          : null;
    if (!entries) return null;
    const ids = new Set();
    for (const entry of entries) {
      const id =
        typeof entry === "object"
          ? scalarId(entry?.chatId ?? entry?.chat_id ?? entry?.id)
          : scalarId(entry);
      if (id !== null) ids.add(chatIdKey(id));
    }
    return ids;
  }

  function readChatIds() {
    try {
      return normalizeChatIds(st.getChatIndex?.());
    } catch {
      return null;
    }
  }

  function sourceOwnerCapabilityAvailable() {
    if (typeof st.hasSourceOwnerCapability === "function") {
      try {
        return st.hasSourceOwnerCapability() === true;
      } catch {
        return false;
      }
    }
    const cas =
      st.sourceOwnerRevisionCAS === true ||
      st.supportsSourceOwnerRevisionCAS === true ||
      st.sourceOwnerLatestMerge === true ||
      st.supportsSourceOwnerLatestMerge === true ||
      st.capabilities?.sourceOwnerRevisionCAS === true ||
      st.capabilities?.sourceOwnerLatestMerge === true ||
      [
        "compareAndSaveChatOwner",
        "compareAndSwapChatOwner",
        "saveChatOwnerCAS",
        "commitChatOwnerCAS",
      ].some((name) => typeof st[name] === "function");
    return (
      typeof st.readChatOwner === "function" &&
      typeof st.saveChatOwner === "function" &&
      cas
    );
  }

  function captureCurrentOwner(chatId = chat.current()) {
    try {
      const token = chat.token();
      const snapshot = store.getCurrentChatOwnerSnapshot?.(chatId);
      if (!snapshot) return null;
      return {
        chatId,
        chat_id: chatId,
        ...ownerIdentity(),
        revision:
          snapshot.revision ?? st.getChatRevision?.(chatId) ?? undefined,
        sourceRevision:
          snapshot.revision ?? st.getChatRevision?.(chatId) ?? undefined,
        epoch: token.epoch,
        snapshot,
      };
    } catch {
      return null;
    }
  }

  async function captureActiveOwner(chatId = chat.current()) {
    const owner = captureCurrentOwner(chatId);
    if (!owner) return null;
    owner.source_hash = await hashText(
      JSON.stringify(
        stableValue({
          chatId: owner.chatId,
          revision: owner.revision,
          header: owner.snapshot?.header,
          chatMetadata: owner.snapshot?.chatMetadata,
          messages: owner.snapshot?.messages,
        }),
      ),
    );
    if (owner.revision === undefined || owner.revision === null) {
      // The current ST release does not expose a server revision. A stable
      // digest of the captured owner is the revision token used by the
      // latest-read/source-merge adapter; it is never a permission to write
      // the captured snapshot back wholesale.
      owner.revision = owner.source_hash;
      owner.sourceRevision = owner.source_hash;
    }
    chat.assert({ chatId, epoch: owner.epoch });
    return owner;
  }

  async function refreshActiveOwner(chatId = chat.current()) {
    try {
      const owner = await captureActiveOwner(chatId);
      if (owner && chat.current() === chatId) activeOwner = owner;
      const ids = readChatIds();
      if (ids) {
        ids.add(chatIdKey(chatId));
        knownChatIds = ids;
        knownChatIdsEvidence = true;
      } else {
        // A Chat index that cannot be read is not evidence for a new-chat
        // transition. Do not carry another character's stale index forward.
        knownChatIds = null;
        knownChatIdsEvidence = false;
      }
      return owner;
    } catch (error) {
      if (error?.message !== "STALE_CHAT")
        console.error("[BioWeave] active Chat owner capture failed", error);
      return null;
    }
  }

  function clearNotification(result, operation) {
    const confirmed =
      result?.ok === true && result?.persistence?.commitState === "confirmed";
    notify({
      type: confirmed
        ? "BIOWEAVE_DATA_CLEARED"
        : "BIOWEAVE_DATA_CLEAR_FAILED",
      payload: { ...result, operation: result?.operation ?? operation },
      chatId: result?.chatId ?? chat.current(),
    });
  }

  async function runClear(operation, target, options = {}) {
    const method = clearService?.[operation];
    if (typeof method !== "function") {
      const result = {
        ok: false,
        changed: false,
        operation,
        error_code: "CLEAR_SERVICE_UNAVAILABLE",
        persistence: { commitState: "failed", attempted: false },
      };
      clearNotification(result, operation);
      return result;
    }
    const result = await method.call(clearService, target, options);
    try {
      await eventAnalysis.completeClear?.(result);
    } catch (error) {
      if (result.ok) console.error("[BioWeave] clear state refresh failed", error);
    }
    clearNotification(result, operation);
    return result;
  }

  function prepareStartNewChatTransition(
    sequence,
    epochBefore,
    previousOwner,
    targetChatId,
    payload,
  ) {
    const idsBefore = knownChatIds ? new Set(knownChatIds) : null;
    const targetOwner = captureCurrentOwner(targetChatId);
    const payloadChatId = eventChatId(payload);
    const eligible = Boolean(
      sourceOwnerCapabilityAvailable() &&
        previousOwner &&
        previousOwner.chatId !== targetChatId &&
        previousOwner.epoch === epochBefore &&
        previousOwner.snapshot &&
        previousOwner.source_hash &&
        previousOwner.revision !== undefined &&
        previousOwner.revision !== null &&
        idsBefore &&
        knownChatIdsEvidence &&
        !idsBefore.has(chatIdKey(targetChatId)) &&
        targetOwner &&
        ownerIdentityMatches(previousOwner, targetOwner) &&
        (payloadChatId === null ||
          String(payloadChatId) === String(targetChatId)),
    );
    pendingStartNewChat = eligible
      ? {
          token: `start-new-chat:${sequence}`,
          sequence,
          sourceChatId: previousOwner.chatId,
          sourceOwner: cloneValue(previousOwner),
          targetChatId,
          targetOwner: cloneValue(targetOwner),
          epoch: chat.getEpoch(),
          idsBefore: [...idsBefore],
          consumed: false,
        }
      : null;
    activeOwner = targetOwner ?? {
      chatId: targetChatId,
      chat_id: targetChatId,
      ...ownerIdentity(),
      epoch: chat.getEpoch(),
    };
    if (knownChatIds) knownChatIds.add(chatIdKey(targetChatId));
  }

  function consumeStartNewChatTransition(sequence, payload) {
    const candidate = pendingStartNewChat;
    const targetChatId = chat.current();
    const payloadChatId = eventChatId(payload);
    let freshness;
    try {
      freshness = st.isFreshChat?.(targetChatId);
    } catch {
      freshness = false;
    }
    const freshnessIsSynchronous =
      !(freshness && typeof freshness.then === "function");
    const valid = Boolean(
      candidate &&
        !candidate.consumed &&
        candidate.sequence === sequence - 1 &&
        candidate.epoch === chat.getEpoch() &&
        String(candidate.targetChatId) === String(targetChatId) &&
        (payloadChatId === null ||
          String(payloadChatId) === String(targetChatId)) &&
        ownerIdentityMatches(candidate.sourceOwner, ownerIdentity()) &&
        freshnessIsSynchronous && freshness !== false,
    );
    if (!valid) {
      if (candidate && candidate.sequence < sequence - 1)
        pendingStartNewChat = null;
      return null;
    }
    candidate.consumed = true;
    return candidate;
  }

  async function clearSourceAfterTransition(candidate) {
    const controller = new AbortController();
    const sourceOwner = {
      ...cloneValue(candidate.sourceOwner),
      sourceTargeted: true,
      source_targeted: true,
      transitionToken: candidate.token,
    };
    await eventAnalysis.invalidateForClear?.({
      reason: "start-new-chat-source",
      owner: sourceOwner,
      transitionToken: candidate.token,
    });
    let result;
    try {
      result = await clearService.clearSourceChatBioWeave(sourceOwner, {
        signal: controller.signal,
        source: true,
      });
    } catch (error) {
      result = {
        ok: false,
        changed: false,
        operation: "all",
        chatId: candidate.sourceChatId,
        sourceTargeted: true,
        error_code: error?.code ?? error?.message ?? "SOURCE_CLEAR_FAILED",
        persistence: { commitState: "failed", attempted: false },
      };
    }
    try {
      await eventAnalysis.completeClear?.(result);
    } catch (error) {
      if (result.ok) console.error("[BioWeave] source clear refresh failed", error);
    }
    if (
      result?.ok !== true ||
      result?.persistence?.commitState !== "confirmed"
    ) {
      failedSourceClears.set(candidate.sourceChatId, {
        owner: sourceOwner,
        result,
        transitionToken: candidate.token,
      });
    } else {
      failedSourceClears.delete(candidate.sourceChatId);
    }
    clearNotification(result, "clearSourceChatBioWeave");
    return result;
  }

  function handleLifecycleEvent(key, eventType, payload) {
    const sequence = ++lifecycleSequence;
    const epochBefore = chat.getEpoch();
    const previousOwner = activeOwner;
    const chatId = chat.current();
    const lifecycleTraceStage = {
      GENERATION_STARTED: "GENERATION_STARTED",
      GENERATION_ENDED: "GENERATION_ENDED",
      GENERATION_STOPPED: "GENERATION_STOPPED",
      GENERATION_CANCELLED: "GENERATION_CANCELLED",
      MESSAGE_RECEIVED: "MESSAGE_RECEIVED",
      CHARACTER_MESSAGE_RENDERED: "CHARACTER_MESSAGE_RENDERED",
    }[key];
    if (lifecycleTraceStage) recordLifecycleTrace(lifecycleTraceStage, payload, chatId);
    const chatChanged = chat.getEpoch() !== epochBefore;
    let sourceTransition = null;
    if (key === "CHAT_CHANGED" && chatChanged) {
      prepareStartNewChatTransition(
        sequence,
        epochBefore,
        previousOwner,
        chatId,
        payload,
      );
    } else if (key === "CHAT_CREATED") {
      sourceTransition = consumeStartNewChatTransition(sequence, payload);
    } else if (chatChanged) {
      pendingStartNewChat = null;
      activeOwner = captureCurrentOwner(chatId) ?? activeOwner;
    }
    notify({
      type: key,
      eventType,
      payload,
      chatId,
      epoch: chat.getEpoch(),
      chatChanged,
    });
    const work = lifecycleTail.then(
      async () => {
        storyTimeCoordinator.handleLifecycleEvent({
          type: key,
          eventType,
          payload,
          chatId,
        });
        if (sourceTransition) await clearSourceAfterTransition(sourceTransition);
        try {
          await eventAnalysis.handleLifecycleEvent({
            type: key,
            eventType,
            payload,
            chatId,
          });
        } catch (error) {
          if (!["STALE_CHAT", "MESSAGE_NOT_FOUND"].includes(error?.message))
            console.error("[BioWeave] event analysis lifecycle failed", error);
        }
        await refreshActiveOwner(chat.current());
        await projectionContext.refreshProjectionContext({chatId: chat.current()});
        notifyLifecycleSettled(key, eventType, payload);
      },
      async () => {
        if (sourceTransition) await clearSourceAfterTransition(sourceTransition);
        await refreshActiveOwner(chat.current());
        await projectionContext.refreshProjectionContext({chatId: chat.current()});
        notifyLifecycleSettled(key, eventType, payload);
      },
    );
    lifecycleTail = work.catch(() => null);
  }

  function bindLifecycleEvents() {
    const context = st.getContext?.();
    const source = context?.eventSource;
    const types = context?.eventTypes;
    if (
      !source ||
      typeof source.on !== "function" ||
      typeof source.removeListener !== "function"
    ) {
      return;
    }
    const boundEventTypes = new Set();
    for (const key of LIFECYCLE_EVENTS) {
      const eventType = types?.[key];
      if (eventType == null || boundEventTypes.has(eventType)) continue;
      const listener = (payload) =>
        handleLifecycleEvent(key, eventType, payload);
      source.on(eventType, listener);
      boundEventTypes.add(eventType);
      unbind.push(() => source.removeListener(eventType, listener));
    }
  }

  async function init() {
    if (destroyed) return false;
    if (initialized) return true;
    const context = st.getContext?.();
    if (typeof st.getContext === "function" && !context) {
      console.error("[BioWeave] SillyTavern context unavailable");
      return false;
    }
    const currentChatId = chat.current();
    try {
      await st.refreshChatIndex?.(currentChatId);
    } catch (error) {
      // A missing chat index is intentionally fail-closed: without a
      // pre-boundary list, a later Chat change cannot prove Start New Chat.
      if (error?.code !== "SOURCE_OWNER_GROUP_UNSUPPORTED")
        console.warn("[BioWeave] Chat index unavailable; Start New Chat cleanup is disabled", error);
    }
    await refreshActiveOwner(currentChatId);
    storyTimeCoordinator.handleLifecycleEvent({type: "RUNTIME_INIT"});
    await eventAnalysis.primeLifecycleSnapshot?.();
    try {
      await projectionContext.refreshProjectionContext({chatId: currentChatId});
    } catch (error) {
      console.error("[BioWeave] initial projection context refresh failed", error);
    }
    bindLifecycleEvents();
    initialized = true;
    void eventAnalysis.refreshTrackingRegistry("init").catch((error) => {
      if (error?.message !== "STALE_CHAT") {
        console.error(
          "[BioWeave] initial tracking registry refresh failed",
          error,
        );
      }
    });
    return true;
  }

  function subscribe(listener) {
    if (typeof listener !== "function")
      throw new TypeError("RUNTIME_LISTENER_REQUIRED");
    subscriptions.add(listener);
    return () => subscriptions.delete(listener);
  }

  // These reads deliberately stay synchronous and side-effect free.  The UI
  // can ask for the current message/swipe facts after a lifecycle notification
  // without turning mount/open/reopen into an analysis request.
  function getActiveSwipeId(messageId) {
    return store.getActiveSwipeId?.(messageId) ?? null;
  }

  function getActiveFloor(messageId) {
    return store.getActiveFloor?.(messageId) ?? null;
  }

  function getActiveFloorEvents(messageId, version) {
    return store.getActiveFloorEvents?.(messageId, version) ?? [];
  }

  function clearCharacterData(target, options = {}) {
    return runClear("clearCharacterData", target, options);
  }

  function clearWorldData(target, options = {}) {
    return runClear("clearWorldData", target, options);
  }

  function clearAllBioWeaveData(target, options = {}) {
    return runClear("clearAllBioWeaveData", target, options);
  }

  function clearSourceChatBioWeave(target, options = {}) {
    return runClear("clearSourceChatBioWeave", target, {
      ...options,
      source: true,
    });
  }

  function clearBioWeaveData(domain = "all", target, options = {}) {
    if (domain && typeof domain === "object") {
      options = domain;
      domain = options.domain ?? options.operation ?? "all";
      target = options.target ?? options.owner;
    }
    const normalized = String(domain).toLowerCase();
    if (normalized === "character") return clearCharacterData(target, options);
    if (normalized === "world") return clearWorldData(target, options);
    return clearAllBioWeaveData(target, options);
  }

  async function getStoryTimeDebugInfo() {
    const info = await storyTimeCoordinator.getCurrentStoryTimeInfo();
    const resolutionTrace = Array.isArray(info.trace) ? info.trace : [];
    let business = null;
    try {
      // This is a read-only derived-data read. It does not invoke Event Analyzer.
      business = await eventAnalysis.collectActiveBusinessData();
    } catch {
      business = null;
    }
    const trace = storyTimeCoordinator.getDebugTrace();
    const latestResolution = [...resolutionTrace].reverse().find(entry => entry?.source !== 'historical_event_difference' && (entry?.story_time || entry?.source)) ?? null;
    const currentStoryTime = info.story_time ?? null;
    const differences = business?.current_story_time_differences ?? {};
    const events = Array.isArray(business?.active_events) ? business.active_events : [];
    const event = events.find(item => Object.prototype.hasOwnProperty.call(differences, String(item?.event_id ?? '')))
      ?? events[0]
      ?? null;
    const eventId = event?.event_id ? String(event.event_id) : null;
    const difference = eventId ? (differences[eventId] ?? null) : null;
    const eventStoryTime = event
      ? (storyTimeCoordinator.normalizeStoryTimeForRead?.(event.story_time) ?? event.story_time ?? null)
      : null;
    const calendar = latestResolution?.calendar ?? null;
    const normalizeCandidateSource = source => source === 'synopsis_time' ? 'synopsis_block_time' : (source ?? 'unknown');
    const debugSource = normalizeCandidateSource(latestResolution?.source);
    const candidateSource = normalizeCandidateSource(latestResolution?.candidate_source ?? debugSource);
    const currentStoryTimeParsed = Boolean(currentStoryTime?.normalized || currentStoryTime?.day_index !== null);
    const eventStoryTimeParsed = Boolean(eventStoryTime?.normalized || eventStoryTime?.day_index !== null);
    const failureReason = difference
      ? null
      : info.status === 'NO_CHARACTER_FLOOR'
        ? 'CURRENT_STORY_TIME_UNKNOWN'
        : !currentStoryTimeParsed
          ? 'CURRENT_STORY_TIME_PARSE_FAILED'
          : event && !eventStoryTimeParsed
            ? 'HISTORICAL_STORY_TIME_PARSE_FAILED'
            : (calendar?.failure_reason ?? 'STORY_TIME_NOT_COMPARABLE');
    return {
      status: info.status ?? 'unknown',
      chat_id: chat.current() === undefined || chat.current() === null ? null : String(chat.current()),
      floor: info.floor?.version ? {
        floor: info.floor.version.floor ?? null,
        message_id: info.floor.version.message_id ?? null,
        swipe_id: info.floor.version.swipe_id ?? info.floor.swipeId ?? null,
        content_hash: info.floor.version.content_hash ?? null,
        message_version: info.floor.version.message_version ?? null,
      } : null,
      source: debugSource,
      resolution_source: latestResolution?.resolution_source ?? (latestResolution?.source === 'cache' ? 'cache' : 'fresh'),
      candidate_source: candidateSource,
      candidate: latestResolution?.candidate ?? null,
      story_time: currentStoryTime,
      parsed_parts: latestResolution?.parsed_parts ?? null,
      calendar: calendar ? {
        calendar_id: calendar.calendar_id ?? currentStoryTime?.calendar_id ?? null,
        era_label: calendar.era_label ?? latestResolution?.parsed_parts?.era_label ?? null,
        calculation_level: calendar.calculation_level ?? null,
        ordinal_in_year: latestResolution?.ordinal_in_year ?? null,
        day_index: currentStoryTime?.day_index ?? null,
        failure_reason: calendar.failure_reason ?? null,
      } : {
        calendar_id: currentStoryTime?.calendar_id ?? null,
        era_label: latestResolution?.parsed_parts?.era_label ?? null,
        calculation_level: null,
        ordinal_in_year: null,
        day_index: currentStoryTime?.day_index ?? null,
        failure_reason: info.status === 'NO_CHARACTER_FLOOR' ? 'CURRENT_STORY_TIME_UNKNOWN' : 'NO_CALENDAR_MAPPING',
      },
      recent_event: event ? {
        event_id: eventId,
        story_time: eventStoryTime,
        difference,
      } : null,
      difference,
      failure_reason: difference ? null : failureReason,
      trace,
    };
  }

  const dataLifecycle = {
    clearCharacterData,
    clearWorldData,
    clearAllBioWeaveData,
    clearSourceChatBioWeave,
    clearBioWeaveData,
  };

  function destroy() {
    if (destroyed) return;
    projectionContext.destroy();
    storyTimeCoordinator.destroy();
    eventAnalysis.destroy();
    while (unbind.length) unbind.pop()();
    subscriptions.clear();
    activity.destroy();
    chat.destroy();
    destroyed = true;
    initialized = false;
  }

  return {
    st,
    chat,
    store,
    init,
    subscribe,
    getActivityState: activity.getActivityState,
    subscribeActivity: activity.subscribe,
    startActivity: activity.startActivity,
    finishActivity: activity.finishActivity,
    recordActivityError: activity.recordError,
    analyzeCurrentFloor: eventAnalysis.analyzeCurrentFloor,
    resolveCurrentBioWeaveFloor: eventAnalysis.resolveCurrentBioWeaveFloor,
    analyzeFloor: eventAnalysis.analyzeFloor,
    refreshCurrentFloorAnalysis: eventAnalysis.refreshCurrentFloorAnalysis,
    requestAbortCurrentFloorAnalysis:
      eventAnalysis.requestAbortCurrentFloorAnalysis,
    getBioWeaveEnabled: isBioWeaveEnabled,
    assertBioWeaveEnabled,
    setBioWeaveEnabled,
    getCurrentFloorAnalysisStatus: eventAnalysis.getCurrentFloorAnalysisStatus,
    getAutoAnalysisSchedulerState: eventAnalysis.getAutoAnalysisSchedulerState,
    getPersistenceTrace,
    recordPersistenceTrace,
    getCurrentFloorAnalysisInput: eventAnalysis.getCurrentFloorAnalysisInput,
    getCurrentFloorEvents: eventAnalysis.getCurrentFloorEvents,
    getCurrentCharacterIdentity: eventAnalysis.getCurrentCharacterIdentity,
    updateCharacterAliases: eventAnalysis.updateCharacterAliases,
    getCurrentStoryTime: storyTimeCoordinator.getCurrentStoryTime,
    getCurrentStoryTimeInfo: storyTimeCoordinator.getCurrentStoryTimeInfo,
    getStoryTimeDebugTrace: storyTimeCoordinator.getDebugTrace,
    getStoryTimeDebugInfo,
    resolveWorldModelAtOrBefore: eventAnalysis.resolveWorldModelAtOrBefore,
    resolveWorldModelStrictlyBefore: eventAnalysis.resolveWorldModelStrictlyBefore,
    saveWorldModel: eventAnalysis.saveWorldModel,
    analyzeCurrentWorldModelFull: eventAnalysis.analyzeCurrentWorldModelFull,
    analyzeCurrentWorldModelPatch: eventAnalysis.analyzeCurrentWorldModelPatch,
    getTrackingRegistry: eventAnalysis.getTrackingRegistry,
    collectActiveBusinessData: eventAnalysis.collectActiveBusinessData,
    getCurrentBiologicalState: eventAnalysis.getCurrentBiologicalState,
    getProjectionViews: projectionPersistence.getProjectionViews,
    refreshProjectionContext: projectionContext.refreshProjectionContext,
    clearProjectionContext: projectionContext.clearProjectionContext,
    refreshTrackingRegistry: eventAnalysis.refreshTrackingRegistry,
    updateEvent: eventAnalysis.updateEvent,
    deleteEvent: eventAnalysis.deleteEvent,
    clearCharacterData,
    clearWorldData,
    clearAllBioWeaveData,
    clearSourceChatBioWeave,
    clearBioWeaveData,
    clearData: clearBioWeaveData,
    dataLifecycle,
    lifecycle: dataLifecycle,
    getFailedSourceClear: (chatId) => failedSourceClears.get(chatId) ?? null,
    getActiveSwipeId,
    getActiveFloor,
    getActiveFloorEvents,
    destroy,
  };
}

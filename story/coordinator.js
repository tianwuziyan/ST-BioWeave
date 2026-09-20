import {hasSwipeSlot, isCharacterMessage} from "../storage/store.js";
import {floorVersion} from "../runtime/floor.js";
import {
  normalizeStoryTime,
  parseStoryTimeDate,
  parseStoryTimeCandidate,
  resolveStoryTimeHeader,
} from "./time.js";

const STORY_TIME_TAG_RE = /<\s*(time|story_time)\s*>([^<]*)<\s*\/\s*\1\s*>/iu;
const STORY_TIME_LABEL_RE = /^(?:【\s*(?:时间|故事时间|TIME|DATE|story_time)\s*】|(?:时间|故事时间|TIME|DATE|story_time)\s*[:：])\s*(.+)$/iu;
const SYNOPSIS_BLOCK_RE = /\[\s*SYNOPSIS_BLOCK\s*\]([\s\S]*?)\[\s*\/\s*SYNOPSIS_BLOCK\s*\]/iu;
const AFFINITY_BLOCK_RE = /\[\s*affinity_status\s*\]([\s\S]*?)\[\s*\/\s*affinity_status\s*\]/iu;
const QUOTED_STATUS_LINE_RE = /『([^』]+)』/u;

function own(value, key) {
  return Boolean(value && Object.prototype.hasOwnProperty.call(value, key));
}

function messagePartText(value) {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (!value || typeof value !== "object") return "";
  return String(value.mes ?? value.content ?? value.message ?? value.text ?? "");
}

function messageText(message, swipeId = 0) {
  if (typeof message === "string" || typeof message === "number") return String(message);
  if (!message || typeof message !== "object") return "";
  if (message.swipes || message.swipe_info) {
    if (!hasSwipeSlot(message, swipeId)) return "";
    if (message.swipes && typeof message.swipes === "object" && message.swipes[swipeId] !== undefined)
      return messagePartText(message.swipes[swipeId]);
    return messagePartText(message.swipe_info?.[swipeId]);
  }
  return messagePartText(message.mes ?? message.content ?? message.message);
}

function messageId(message, index, storedVersion = null) {
  return String(
    message?.message_id ??
      message?.mes_id ??
      message?.id ??
      storedVersion?.message_id ??
      index,
  );
}

function messageFloor(message, index, storedVersion = null) {
  for (const candidate of [
    message?.floor,
    message?.floor_id,
    message?.floorIndex,
    storedVersion?.floor,
    index,
  ]) {
    const parsed = Number(candidate);
    if (Number.isFinite(parsed)) return Math.round(parsed);
  }
  return index;
}

function messageVersion(message, storedVersion = null) {
  return message?.message_version ?? message?.messageVersion ?? storedVersion?.message_version;
}

function hasStoryTime(value) {
  return Boolean(value && (value.display || value.normalized || value.day_index !== null));
}

function versionKey(version) {
  if (!version || typeof version !== "object") return null;
  return [
    version.chat_id,
    version.message_id,
    version.floor,
    version.swipe_id,
    version.content_hash,
    version.message_version,
  ].map(value => String(value ?? "")).join("::");
}

function firstNonEmptyLine(content) {
  return String(content ?? "").split(/\r?\n/u).map(line => line.trim()).find(Boolean) ?? "";
}

function parsedStoryTimeParts(value, calendar = null) {
  const parsed = parseStoryTimeDate(value?.display ?? value, {calendar});
  if (!parsed) return null;
  return {
    era_label: parsed.eraLabel ?? null,
    year: parsed.year ?? null,
    month: parsed.month ?? null,
    day: parsed.day ?? null,
    hour: parsed.hour ?? null,
    minute: parsed.minute ?? null,
  };
}

export function extractFloorStoryTimeCandidates(content) {
  const text = String(content ?? "");
  const candidates = [];

  const synopsis = SYNOPSIS_BLOCK_RE.exec(text)?.[1] ?? "";
  for (const line of synopsis.split(/\r?\n/u)) {
    const match = /^\s*TIME\s*[:：]\s*(.+?)\s*$/iu.exec(line);
    if (match?.[1]?.trim()) candidates.push({source: "synopsis_time", value: match[1].trim()});
  }

  const tag = STORY_TIME_TAG_RE.exec(text);
  if (tag?.[2]?.trim()) candidates.push({source: tag[1].toLowerCase() === "story_time" ? "story_time_tag" : "time_tag", value: tag[2].trim()});

  const labelText = text.replace(SYNOPSIS_BLOCK_RE, "");
  for (const line of labelText.split(/\r?\n/u)) {
    const match = STORY_TIME_LABEL_RE.exec(line.trim());
    if (match?.[1]?.trim()) candidates.push({source: "time_label", value: match[1].trim()});
  }

  const affinity = AFFINITY_BLOCK_RE.exec(text)?.[1] ?? "";
  for (const line of affinity.split(/\r?\n/u)) {
    const quoted = QUOTED_STATUS_LINE_RE.exec(line)?.[1];
    if (!quoted) continue;
    const fields = quoted.split(/[｜|]/u).map(value => value.trim()).filter(Boolean);
    const statusFields = (fields[0] ?? "").split(/[·•]/u).map(value => value.trim()).filter(Boolean);
    const dateField = statusFields[0] ?? "";
    const timeField = statusFields.find(value => parseStoryTimeCandidate(`${dateField} ${value}`));
    if (dateField && timeField) candidates.push({source: "affinity_status", value: `${dateField} ${timeField}`.trim()});
  }

  const first = firstNonEmptyLine(text);
  if (first) candidates.push({source: "floor_header", value: first});
  return candidates;
}

function safeNormalize(storyTime, value) {
  try {
    const normalized = storyTime?.normalize?.(value) ?? normalizeStoryTime(value);
    if (normalized?.day_index !== null || normalized?.normalized) return normalized;
    const candidate = parseStoryTimeCandidate(normalized?.display ?? value, {
      calendar: safeCalendar(storyTime, value),
    });
    return candidate ?? normalized;
  } catch {
    return normalizeStoryTime(null);
  }
}

function safeCalendar(storyTime, value = null) {
  try {
    if (typeof storyTime?.getCalendarFor === "function") return storyTime.getCalendarFor(value);
    return storyTime?.getCalendar?.() ?? null;
  } catch {
    return null;
  }
}

function safeCalendarDebug(storyTime, value = null) {
  try {
    return storyTime?.getCalendarDebug?.(value) ?? null;
  } catch {
    return null;
  }
}

export function createStoryTimeCoordinator({
  st,
  chat,
  store,
  storyTime,
  debug = false,
  trace = null,
} = {}) {
  if (!st || !chat || !store || !storyTime) throw new TypeError("STORY_TIME_COORDINATOR_DEPENDENCIES_REQUIRED");
  const cache = new Map();
  let lastTrace = [];

  function messages() {
    const context = st.getContext?.();
    const value = st.getChat?.() ?? context?.chat;
    return Array.isArray(value) ? value : [];
  }

  function emitTrace(entry) {
    lastTrace = [...lastTrace, entry].slice(-32);
    if (debug && typeof trace === "function") trace(entry);
  }

  async function resolveFloor(target) {
    if (!target?.message || !isCharacterMessage(target.message)) return null;
    const version = target.version ?? await floorVersion({
      chatId: target.chatId ?? chat.current(),
      messageId: messageId(target.message, target.index),
      floor: messageFloor(target.message, target.index),
      swipeId: target.swipeId,
      text: messageText(target.message, target.swipeId),
      messageVersion: messageVersion(target.message),
    });
    const key = versionKey(version);
    const content = messageText(target.message, target.swipeId);
    const traceBase = {
      chat_id: version.chat_id,
      message_id: version.message_id,
      floor: version.floor,
      swipe_id: version.swipe_id,
      content_hash: version.content_hash,
      message_version: version.message_version,
      raw_header: firstNonEmptyLine(content).slice(0, 240),
      candidate: (extractFloorStoryTimeCandidates(content)[0]?.value ?? firstNonEmptyLine(content)).slice(0, 240),
      calendar: safeCalendarDebug(storyTime),
    };
    if (key && cache.has(key)) {
      const cached = cache.get(key);
      const cachedStoryTime = cached?.story_time ?? cached;
      emitTrace({
        ...traceBase,
        source: "cache",
        resolution_source: "cache",
        candidate_source: cached?.candidate_source ?? null,
        candidate: cached?.candidate ?? traceBase.candidate,
        story_time: cachedStoryTime,
        parsed_parts: parsedStoryTimeParts(cachedStoryTime, safeCalendarDebug(storyTime, cachedStoryTime)?.descriptor ?? safeCalendar(storyTime, cachedStoryTime)),
      });
      return {floor: {...target, version}, story_time: cachedStoryTime, status: hasStoryTime(cachedStoryTime) ? "ready" : "unknown"};
    }

    const normalize = value => safeNormalize(storyTime, value);
    for (const value of [target.message.story_time, target.message.storyTime]) {
      const normalized = normalize(value);
      if (hasStoryTime(normalized)) return finish(target, version, key, normalized, "structured", {...traceBase, candidate_source: "structured_story_time"});
    }

    const candidates = extractFloorStoryTimeCandidates(content);
    const resolvedCandidates = candidates.map(candidate => {
      const calendar = safeCalendar(storyTime, candidate.value);
      return {
        ...candidate,
        story_time: parseStoryTimeCandidate(candidate.value, {calendar}),
        calendar,
      };
    }).filter(candidate => candidate.story_time && hasStoryTime(candidate.story_time));
    const selected = resolvedCandidates[0];
    if (selected) {
      const conflicts = resolvedCandidates
        .slice(1)
        .filter(candidate => candidate.story_time.display !== selected.story_time.display)
        .map(candidate => ({source: candidate.source, candidate: candidate.value}));
      return finish(target, version, key, selected.story_time, selected.source === "floor_header" ? "header" : selected.source, {
        ...traceBase,
        candidate: selected.value.slice(0, 240),
        candidate_source: selected.source === "floor_header" ? "first_line_header" : selected.source,
        conflicting_candidates: conflicts,
      });
    }

    const headerText = firstNonEmptyLine(content);
    const header = resolveStoryTimeHeader(headerText, {
      normalize,
      calendar: safeCalendar(storyTime, headerText),
    });
    if (header && hasStoryTime(header)) return finish(target, version, key, header, "header", {...traceBase, candidate_source: "first_line_header"});

    return finish(target, version, key, normalize(null), "unknown", traceBase);
  }

  function finish(target, version, key, value, source, traceBase) {
    const result = value ?? normalizeStoryTime(null);
    if (key) cache.set(key, {
      story_time: result,
      candidate: traceBase.candidate ?? null,
      candidate_source: traceBase.candidate_source ?? source,
    });
    const calendarDebug = safeCalendarDebug(storyTime, result);
    emitTrace({
      ...traceBase,
      source,
      resolution_source: "fresh",
      candidate_source: traceBase.candidate_source ?? source,
      calendar: calendarDebug,
      source_kind: source,
      calendar_id: result.calendar_id,
      day_index: result.day_index,
      story_time: result,
      parsed_parts: parsedStoryTimeParts(result, calendarDebug?.descriptor ?? safeCalendar(storyTime)),
    });
    return {floor: {...target, version}, story_time: result, status: hasStoryTime(result) ? "ready" : "unknown"};
  }

  async function resolveCurrentFloor(selector = null) {
    const all = messages();
    let index = all.length - 1;
    if (selector && typeof selector === "object") index = Number(selector.index ?? selector.messageIndex ?? index);
    if (!Number.isInteger(index) || index < 0) return null;
    for (let candidate = Math.min(index, all.length - 1); candidate >= 0; candidate -= 1) {
      const message = all[candidate];
      if (!isCharacterMessage(message)) continue;
      const swipeId = store.getActiveSwipeId?.(candidate);
      if (swipeId === null || swipeId === undefined || !hasSwipeSlot(message, swipeId)) continue;
      const storedVersion = store.getFloor?.(candidate, swipeId)?.analysis?.floor_version
        ?? store.getFloor?.(candidate, swipeId)?.floor_version
        ?? null;
      const version = await floorVersion({
        chatId: chat.current(),
        messageId: messageId(message, candidate, storedVersion),
        floor: messageFloor(message, candidate, storedVersion),
        swipeId,
        text: messageText(message, swipeId),
        messageVersion: messageVersion(message, storedVersion),
      });
      chat.assert?.(chat.token?.());
      return {index: candidate, message, swipeId, version, chatId: version.chat_id};
    }
    return null;
  }

  async function getCurrentStoryTimeInfo(selector = null) {
    lastTrace = [];
    const floor = await resolveCurrentFloor(selector);
    if (!floor) return {story_time: normalizeStoryTime(null), floor: null, status: "NO_CHARACTER_FLOOR", trace: [...lastTrace]};
    const resolved = await resolveFloor(floor);
    return {...resolved, story_time: resolved.story_time, trace: [...lastTrace]};
  }

  async function getCurrentStoryTime(selector = null) {
    return (await getCurrentStoryTimeInfo(selector)).story_time;
  }

  function resolveFloorStoryTime(target) {
    return resolveFloor(target).then(result => result?.story_time ?? normalizeStoryTime(null));
  }

  function normalizeStoryTimeForRead(value) {
    return safeNormalize(storyTime, value);
  }

  function invalidate() {
    cache.clear();
    lastTrace = [];
  }

  function handleLifecycleEvent() {
    invalidate();
    return {invalidated: true};
  }

  function traceHistoricalDifference(eventId, eventStoryTime, currentStoryTime, difference) {
    const calendar = safeCalendarDebug(storyTime, currentStoryTime)
      ?? safeCalendarDebug(storyTime, eventStoryTime);
    emitTrace({
      source: "historical_event_difference",
      event_id: String(eventId ?? ""),
      historical_story_time: safeNormalize(storyTime, eventStoryTime),
      current_story_time: safeNormalize(storyTime, currentStoryTime),
      difference,
      calendar,
      calendar_id: calendar?.calendar_id ?? null,
      calculation_level: difference?.value == null
        ? null
        : (calendar?.descriptor ? (calendar?.descriptor?.absoluteCycle || calendar?.descriptor?.epochYear != null ? 3 : 2) : 1),
      ordinal_in_year: null,
      failure_reason: difference?.value == null ? (calendar?.failure_reason ?? "UNKNOWN") : null,
    });
  }

  function destroy() {
    invalidate();
  }

  return {
    resolveFloorStoryTime,
    normalizeStoryTimeForRead,
    resolveCurrentFloor,
    getCurrentStoryTime,
    getCurrentStoryTimeInfo,
    handleLifecycleEvent,
    traceHistoricalDifference,
    invalidate,
    getDebugTrace: () => [...lastTrace],
    destroy,
  };
}

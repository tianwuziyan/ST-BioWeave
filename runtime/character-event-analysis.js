import { traceApi } from "../ai/client.js";
import {
  CAPABILITY_KEYS,
  dedupeEventsAgainstExisting,
  dedupeEvents,
  normalizeEvent,
  eventSemanticKey,
  splitCompositePregnancyExposureEvent,
  validateEventStoryTimesAtOrBefore,
  validateEventCollection,
} from "../core/events.js";
import {isCycleExposureLocked} from "../core/participant-aggregation-lock.js";
import {
  normalizeCharacterRegistry,
  resolveEventAnalysisIdentities,
} from "../core/identity.js";
import {compareStoryTime, differenceStoryTime} from "../story/time.js";
import {
  floorVersionFromData,
  hashText,
  sameFloorVersion,
} from "./floor.js";

async function deterministicEventId(version, ordinal) {
  const material = [
    "bioweave-event-id-v1",
    version?.chat_id,
    version?.message_id,
    version?.floor,
    version?.swipe_id,
    version?.content_hash,
    version?.message_version,
    ordinal,
  ]
    .map((value) => String(value ?? ""))
    .join("\u001f");
  const digest = await hashText(material);
  return `evt_${digest.slice(0, 24)}_${ordinal + 1}`;
}

async function deterministicStateFactId(version, ordinal, subjectId, kind) {
  const material = [
    "bioweave-state-fact-id-v1",
    kind,
    version?.chat_id,
    version?.message_id,
    version?.floor,
    version?.swipe_id,
    version?.content_hash,
    version?.message_version,
    subjectId,
    ordinal,
  ].map((value) => String(value ?? "")).join("\u001f");
  const digest = await hashText(material);
  return `${kind}_${digest.slice(0, 24)}_${ordinal + 1}`;
}

async function materializeStateFact(event, version, ordinal) {
  if (!event?.state_fact || typeof event.state_fact !== "object") return event;
  const stateFact = structuredClone(event.state_fact);
  const payload = stateFact.payload && typeof stateFact.payload === "object"
    ? stateFact.payload
    : {};
  const pregnancyRef = payload.pregnancy_ref;
  if (payload.status === "not_pregnant") {
    payload.pregnancy_id = null;
    delete payload.pregnancy_ref;
  } else if (pregnancyRef?.kind === "new") {
    payload.pregnancy_id = await deterministicStateFactId(
      version,
      ordinal,
      stateFact.subject_id,
      "preg",
    );
    delete payload.pregnancy_ref;
  } else if (pregnancyRef?.kind === "existing") {
    payload.pregnancy_id = pregnancyRef.id;
    delete payload.pregnancy_ref;
  }
  for (const [referenceKey, idKey, kind] of [
    ["labor_ref", "labor_id", "labor"],
    ["delivery_ref", "delivery_id", "delivery"],
    ["postpartum_ref", "postpartum_id", "postpartum"],
  ]) {
    const reference = payload[referenceKey];
    if (!reference) continue;
    payload[idKey] = reference.kind === "new"
      ? await deterministicStateFactId(version, ordinal, stateFact.subject_id, kind)
      : reference.id;
    delete payload[referenceKey];
  }
  stateFact.payload = payload;
  return { ...event, state_fact: stateFact };
}

function continuityIdList(value) {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const ids = value.map((item) => typeof item === "string" ? item.trim() : "");
  if (ids.some((item) => !item) || new Set(ids).size !== ids.length) return null;
  return [...ids].sort();
}

function continuityParticipants(event) {
  const participants = Array.isArray(event?.participants) ? event.participants : [];
  const normalized = participants.map((participant) => {
    const characterId = typeof participant?.character_id === "string"
      ? participant.character_id.trim()
      : "";
    const eventRole = typeof participant?.event_role === "string"
      ? participant.event_role.trim()
      : "";
    if (!characterId || !eventRole) return null;
    return {character_id: characterId, event_role: eventRole};
  });
  if (normalized.some((participant) => participant === null)) return null;
  const characterIds = normalized.map((participant) => participant.character_id);
  if (new Set(characterIds).size !== characterIds.length) return null;
  return normalized.sort((left, right) =>
    JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

function eventContinuityKey(event) {
  const storyTime = event?.story_time ?? {};
  const mechanism = event?.pregnancy_relevance?.reproductive_mechanism ?? {};
  const participants = continuityParticipants(event);
  const gestationalSubjectIds = continuityIdList(
    event?.pregnancy_relevance?.gestational_subject_ids,
  );
  const counterpartIds = continuityIdList(event?.pregnancy_relevance?.counterpart_ids);
  if (!participants || !gestationalSubjectIds || !counterpartIds) return null;
  return JSON.stringify({
    type: event?.type ?? null,
    location: event?.location ?? null,
    story_time: {
      normalized: storyTime.normalized ?? null,
      day_index: storyTime.normalized ? null : storyTime.day_index ?? null,
      calendar_id: storyTime.calendar_id ?? null,
    },
    participants,
    gestational_subject_ids: gestationalSubjectIds,
    counterpart_ids: counterpartIds,
    mechanism: {kind: mechanism.kind ?? null},
  });
}

// Cross-Floor Episode identity is intentionally narrower in scope but looser
// in facts: time, wording, participants and counterpart sets can evolve.
function eventEpisodeContinuityKey(event) {
  if (event?.type !== "sexual_activity" || event?.pregnancy_relevance?.relevant !== true) return null;
  const mechanism = event?.pregnancy_relevance?.reproductive_mechanism ?? {};
  const subjects = continuityIdList(event?.pregnancy_relevance?.gestational_subject_ids);
  if (!subjects || subjects.length !== 1 || !mechanism.kind) return null;
  return JSON.stringify({type: event.type, gestational_subject_id: subjects[0], mechanism: mechanism.kind});
}

// A marker-free cross-Floor update is safe only when the complete canonical
// participant/counterpart relation and location remain stable. This is
// narrower than Episode identity, so a marker is still required for source
// expansion or other continuity matches that need stronger narrative license.
function eventStableContinuityKey(event) {
  if (eventEpisodeContinuityKey(event) === null) return null;
  const participants = continuityParticipants(event);
  const relevance = event?.pregnancy_relevance ?? {};
  const counterpartIds = continuityIdList(relevance.counterpart_ids);
  if (!participants || !counterpartIds) return null;
  return JSON.stringify({
    episode: eventEpisodeContinuityKey(event),
    location: event?.location ?? null,
    participants,
    counterpart_ids: counterpartIds,
  });
}

function strictContinuationDuplicate(candidate, current) {
  const candidateKey = eventSemanticKey(candidate);
  const currentKey = eventSemanticKey(current);
  return Boolean(candidateKey && currentKey && candidateKey === currentKey);
}

function mergeCurrentParticipantEvidence(currentParticipant, nextParticipant) {
  const current = currentParticipant && typeof currentParticipant === "object"
    ? currentParticipant
    : {};
  const next = nextParticipant && typeof nextParticipant === "object"
    ? nextParticipant
    : {};
  const currentCapabilities = current.reproductive_capabilities_used ?? {};
  const nextCapabilities = next.reproductive_capabilities_used ?? {};
  return {
    ...current,
    ...next,
    reproductive_capabilities_used: Object.fromEntries(
      CAPABILITY_KEYS.map((key) => [
        key,
        nextCapabilities[key] === null || nextCapabilities[key] === undefined
          ? currentCapabilities[key] ?? null
          : nextCapabilities[key],
      ]),
    ),
    evidence: [
      ...mergeEvidenceUnique(current.evidence, next.evidence),
    ],
  };
}

function stableFingerprint(value) {
  if (Array.isArray(value)) return `[${value.map(stableFingerprint).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value);
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableFingerprint(value[key])}`).join(",")}}`;
}

function evidenceFingerprint(value) {
  const item = value && typeof value === "object" ? value : {};
  return stableFingerprint({
    kind: typeof item.kind === "string" ? item.kind.trim() : item.kind ?? null,
    text: typeof item.text === "string" ? item.text.trim() : item.text ?? null,
  });
}

function mergeEvidenceUnique(...collections) {
  const result = [];
  const seen = new Set();
  for (const collection of collections) {
    if (!Array.isArray(collection)) continue;
    for (const item of collection) {
      const key = evidenceFingerprint(item);
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(structuredClone(item));
    }
  }
  return result;
}

function sameIdSet(left = [], right = []) {
  const a = new Set((Array.isArray(left) ? left : []).filter(Boolean));
  const b = new Set((Array.isArray(right) ? right : []).filter(Boolean));
  return a.size === b.size && [...a].every((value) => b.has(value));
}

function compatibleWorldModelRuleRefs(left = [], right = []) {
  const leftRefs = new Set((Array.isArray(left) ? left : []).filter(Boolean));
  const rightRefs = new Set((Array.isArray(right) ? right : []).filter(Boolean));
  if (!leftRefs.size || !rightRefs.size) return true;
  return [...leftRefs].some((reference) => rightRefs.has(reference));
}

function continuationStoryTimeCompatible(leftStoryTime, rightStoryTime) {
  const left = leftStoryTime ?? {};
  const right = rightStoryTime ?? {};
  const leftNormalized = typeof left.normalized === "string" ? left.normalized.trim() : "";
  const rightNormalized = typeof right.normalized === "string" ? right.normalized.trim() : "";
  if (leftNormalized || rightNormalized) {
    return Boolean(leftNormalized && rightNormalized && leftNormalized === rightNormalized &&
      (left.calendar_id ?? null) === (right.calendar_id ?? null));
  }
  return compareStoryTime(left, right) === 0;
}

const MARKERLESS_CONTINUITY_WINDOW_MINUTES = 6 * 60;

function markerlessStoryTimeCompatible(leftStoryTime, rightStoryTime) {
  const difference = differenceStoryTime(leftStoryTime, rightStoryTime, {
    includeCrossDayClock: true,
  });
  if (!difference || difference.unit !== "minute" || !Number.isFinite(Number(difference.value))) {
    return false;
  }
  return Math.abs(Number(difference.value)) <= MARKERLESS_CONTINUITY_WINDOW_MINUTES;
}

function continuationSourceIsVisible(source, targetVersion) {
  if (!source || typeof source !== "object") return false;
  if (source.chat_id !== targetVersion?.chat_id || source.swipe_id !== targetVersion?.swipe_id) return false;
  if (["message_id", "content_hash", "message_version"].some((key) => {
    const value = source[key];
    return value === null || value === undefined || String(value).trim() === "";
  })) return false;
  const sourceFloor = Number(source.floor);
  const targetFloor = Number(targetVersion?.floor);
  if (!Number.isFinite(sourceFloor) || !Number.isFinite(targetFloor)) return false;
  if (sourceFloor === targetFloor && !sameFloorVersion(source, targetVersion)) return false;
  return sourceFloor <= targetFloor;
}

function sameFloorOwner(source, targetVersion) {
  return Boolean(source && targetVersion &&
    source.chat_id === targetVersion.chat_id &&
    source.message_id === targetVersion.message_id &&
    Number(source.floor) === Number(targetVersion.floor) &&
    source.swipe_id === targetVersion.swipe_id);
}

function validateContinuationReference(candidate, current, targetVersion) {
  if (!candidate || !current || !continuationSourceIsVisible(current.source, targetVersion)) return false;
  if (candidate.type !== current.type) return false;
  const candidateParticipants = continuityParticipants(candidate);
  const currentParticipants = continuityParticipants(current);
  if (!candidateParticipants || !currentParticipants) return false;
  const candidateRelevance = candidate.pregnancy_relevance ?? {};
  const currentRelevance = current.pregnancy_relevance ?? {};
  if (!sameIdSet(candidateRelevance.gestational_subject_ids, currentRelevance.gestational_subject_ids)) return false;
  const candidateMechanism = candidateRelevance.reproductive_mechanism ?? {};
  const currentMechanism = currentRelevance.reproductive_mechanism ?? {};
  if (candidateMechanism.kind !== currentMechanism.kind) return false;
  if (!compatibleWorldModelRuleRefs(
    candidateMechanism.world_model_rule_refs,
    currentMechanism.world_model_rule_refs,
  )) return false;
  if (candidate.location && current.location && candidate.location !== current.location) return false;
  if (candidate.type === "sexual_activity" && current.type === "sexual_activity" &&
      eventEpisodeContinuityKey(candidate) && eventEpisodeContinuityKey(current)) {
    return Boolean(eventEpisodeContinuityKey(candidate) && eventEpisodeContinuityKey(current));
  }
  if (!sameIdSet(candidateRelevance.counterpart_ids, currentRelevance.counterpart_ids) ||
      !candidateParticipants || !currentParticipants ||
      JSON.stringify(candidateParticipants) !== JSON.stringify(currentParticipants) ||
      !continuationStoryTimeCompatible(candidate.story_time, current.story_time)) return false;
  return true;
}

function hasMeaningfulContinuationUpdate(current, candidate) {
  if (candidate?.continuation_update !== true) return false;
  const currentMechanism = current?.pregnancy_relevance?.reproductive_mechanism ?? {};
  const candidateMechanism = candidate?.pregnancy_relevance?.reproductive_mechanism ?? {};
  const currentEvidence = [
    ...(current?.source_evidence ?? []),
    ...(currentMechanism.evidence ?? []),
    ...(current?.participants ?? []).flatMap((item) => item?.evidence ?? []),
  ];
  const candidateEvidence = [
    ...(candidate?.source_evidence ?? []),
    ...(candidateMechanism.evidence ?? []),
    ...(candidate?.participants ?? []).flatMap((item) => item?.evidence ?? []),
  ];
  const currentKeys = new Set(currentEvidence.map(evidenceFingerprint));
  if (candidateEvidence.some((item) => !currentKeys.has(evidenceFingerprint(item)))) return true;
  return stableFingerprint(current?.state_fact ?? null) !== stableFingerprint(candidate?.state_fact ?? null) ||
    stableFingerprint(current?.physical_effect ?? null) !== stableFingerprint(candidate?.physical_effect ?? null) ||
    current.status !== candidate.status;
}

function mergeContinuedEvent(current, candidate, meaningfulUpdate) {
  if (!meaningfulUpdate) return current;
  const currentRelevance = current.pregnancy_relevance ?? {};
  const candidateRelevance = candidate.pregnancy_relevance ?? {};
  const currentMechanism = currentRelevance.reproductive_mechanism ?? {};
  const candidateMechanism = candidateRelevance.reproductive_mechanism ?? {};
  const participants = [...(current.participants ?? [])];
  for (const nextParticipant of candidate.participants ?? []) {
    const existingIndex = participants.findIndex(
      (item) => item?.character_id === nextParticipant?.character_id,
    );
    if (existingIndex < 0) participants.push(structuredClone(nextParticipant));
    else participants[existingIndex] = mergeCurrentParticipantEvidence(
      participants[existingIndex],
      nextParticipant,
    );
  }
  const gestationalSubjectIds = [...new Set([
    ...(currentRelevance.gestational_subject_ids ?? []),
    ...(candidateRelevance.gestational_subject_ids ?? []),
  ])];
  const counterpartIds = [...new Set([
    ...(currentRelevance.counterpart_ids ?? []),
    ...(candidateRelevance.counterpart_ids ?? []),
  ])];
  return {
    ...structuredClone(current),
    status: candidate.status ?? current.status,
    participants,
    source_evidence: mergeEvidenceUnique(current.source_evidence, candidate.source_evidence),
    physical_effect: candidate.physical_effect && typeof candidate.physical_effect === "object"
      ? {...structuredClone(current.physical_effect ?? {}), ...structuredClone(candidate.physical_effect)}
      : current.physical_effect,
    pregnancy_relevance: {
      ...structuredClone(currentRelevance),
      possible_conception: candidateRelevance.possible_conception ?? currentRelevance.possible_conception,
      gestational_subject_ids: gestationalSubjectIds,
      counterpart_ids: counterpartIds,
      confidence: candidateRelevance.confidence ?? currentRelevance.confidence,
      reproductive_mechanism: {
        ...structuredClone(currentMechanism),
        label: candidateMechanism.label ?? currentMechanism.label,
        pathway: candidateMechanism.pathway ?? currentMechanism.pathway,
        world_model_rule_refs: [...new Set([
          ...(currentMechanism.world_model_rule_refs ?? []),
          ...(candidateMechanism.world_model_rule_refs ?? []),
        ])],
        evidence: mergeEvidenceUnique(currentMechanism.evidence, candidateMechanism.evidence),
      },
    },
    state_fact: candidate.state_fact ?? current.state_fact,
    event_id: current.event_id,
    source: structuredClone(current.source),
  };
}

function identityResolutionError(result) {
  const first = Array.isArray(result?.errors)
    ? result.errors.find((item) => item && typeof item === "object")
    : null;
  const code = String(first?.error_code ?? "identity_resolution_failed").trim() ||
    "identity_resolution_failed";
  const error = new Error("EVENT_IDENTITY_RESOLUTION_FAILED");
  error.code = "EVENT_IDENTITY_RESOLUTION_FAILED";
  error.analysis_stage = "identity_resolution";
  error.diagnostic_code = code;
  error.error_code = code;
  if (first?.path) {
    error.diagnostic_path = first.path;
    error.error_path = first.path;
  }
  return error;
}

function analysisNarrative(input = {}) {
  const current = input?.current_floor?.narrative ?? "";
  const recent = Array.isArray(input?.recent_context)
    ? input.recent_context
        .map((item) => item?.content ?? item?.narrative ?? "")
        .filter(Boolean)
    : [];
  return [current, ...recent].join("\n");
}

export function createCharacterEventAnalysis({
  analyzer,
  commitAnalysis,
  commitFloorPatch,
  assertExecutionTargetCurrent,
  assertExecutionCurrent,
  dependencyHashForTarget,
  invalidateExecution,
  requestAbortedError,
  getFloor,
  resolveFloorAtIndex,
  resolveCurrentBioWeaveFloor,
  resolveCharacterRegistryAtOrBefore,
  collectActiveBusinessData,
  collectCurrentFloorStates,
  assertToken,
  maybeCreateSnapshot,
  refreshTrackingRegistry,
  emitPersistenceTrace,
  persistenceTraceContext,
  clearInvalidatedFloor,
  trace = traceApi,
  nextPersistenceInvocationId,
  domainValidationError,
  isStaleChat = () => false,
  healthAssessment = null,
  healthEvolution = null,
  getCurrentStoryTime = null,
  waitForHealthRecoveryStability = null,
  persistPregnancyLifecycleFacts = null,
  resolveLockedExposureState = null,
} = {}) {
  async function verifyCharacterCanonicalReady(target, execution, token, expectedEvents) {
    emitPersistenceTrace("CHARACTER_CANONICAL_READ_BEGIN", execution, target, {
      domain: "event",
    }, "event");
    let currentTarget;
    let floorData;
    try {
      currentTarget = await resolveFloorAtIndex({
        __messageIndex: true,
        index: target.index,
      });
      floorData = getFloor(target.index, target.swipeId) ?? null;
    } catch (cause) {
      const error = new Error("CHARACTER_CANONICAL_NOT_READY");
      error.code = "CHARACTER_CANONICAL_NOT_READY";
      error.analysis_stage = "character_canonical_read";
      error.cause = cause;
      throw error;
    }
    const actualVersion = currentTarget?.version ?? floorVersionFromData(floorData);
    const floorVersionMatch = Boolean(
      actualVersion && sameFloorVersion(actualVersion, target.version),
    );
    const slotAudit = {
      analysis_present: Boolean(floorData?.analysis),
      events_present: Array.isArray(floorData?.events),
      event_count: Array.isArray(floorData?.events) ? floorData.events.length : 0,
      character_registry_present: Boolean(floorData?.character_registry),
      character_count: floorData?.character_registry?.entities
        ? Object.keys(floorData.character_registry.entities).length
        : 0,
      snapshot_present: Boolean(floorData?.snapshot),
      projection_timeline_present: Boolean(floorData?.projection_timeline),
      world_model_present: Boolean(floorData?.world_model),
    };
    emitPersistenceTrace("CHARACTER_FLOOR_SOURCE_RESOLVED", execution, target, {
      chat_id: target.version.chat_id,
      message_id: target.version.message_id,
      floor: target.version.floor,
      active_swipe_id: currentTarget?.swipeId ?? target.swipeId,
      expected_swipe_id: target.swipeId,
      expected_floor_version: target.version,
      actual_floor_version: actualVersion,
      floor_version_match: floorVersionMatch,
      bioweave_present: Boolean(floorData),
    }, "event");
    emitPersistenceTrace("CHARACTER_SLOT_AUDIT", execution, target, slotAudit, "event");
    if (!floorVersionMatch || !slotAudit.analysis_present || !slotAudit.events_present || !slotAudit.character_registry_present) {
      const error = new Error("CHARACTER_CANONICAL_NOT_READY");
      error.code = "CHARACTER_CANONICAL_NOT_READY";
      error.analysis_stage = "character_canonical_read";
      error.floor_version_match = floorVersionMatch;
      throw error;
    }
    assertToken(token);
    let business = null;
    let currentFloorIncluded = false;
    try {
      const current = await resolveCurrentBioWeaveFloor();
      if (current?.version && sameFloorVersion(current.version, target.version)) {
        business = await collectActiveBusinessData();
        currentFloorIncluded = Boolean(
          business?.current_floor?.version &&
          sameFloorVersion(business.current_floor.version, target.version),
        );
      } else {
        const states = await collectCurrentFloorStates(token);
        currentFloorIncluded = states.some(
          (state) => state.index === target.index &&
            sameFloorVersion(state.version, target.version),
        );
      }
    } catch (cause) {
      const error = new Error("CHARACTER_CANONICAL_NOT_READY");
      error.code = "CHARACTER_CANONICAL_NOT_READY";
      error.analysis_stage = "character_canonical_rebuild";
      error.cause = cause;
      throw error;
    }
    const eventCount = Array.isArray(business?.active_events)
      ? business.active_events.length
      : slotAudit.event_count;
    const characterCount = Object.keys(business?.tracking_subjects ?? {}).length;
    const expectedEventCount = Array.isArray(expectedEvents)
      ? expectedEvents.length
      : null;
    const actualFloorEvents = Array.isArray(floorData?.events) ? floorData.events : [];
    const expectedEventIds = new Set(
      (Array.isArray(expectedEvents) ? expectedEvents : [])
        .map((event) => event?.event_id)
        .filter(Boolean),
    );
    const canonicalEventCountMatches = expectedEventCount === null ||
      actualFloorEvents.length === expectedEventCount;
    const actualEventIds = new Set(actualFloorEvents.map((event) => event?.event_id).filter(Boolean));
    const canonicalEventIdsMatch = expectedEventCount === null ||
      (expectedEventIds.size === actualEventIds.size &&
        [...expectedEventIds].every((id) => actualEventIds.has(id)));
    const validEmptyEventResult = expectedEventCount === 0 && actualFloorEvents.length === 0;
    emitPersistenceTrace("CHARACTER_CANONICAL_ACTUAL", execution, target, {
      actual_event_count: actualFloorEvents.length,
      actual_character_count: characterCount,
      actual_registry_character_count: slotAudit.character_count,
    }, "event");
    emitPersistenceTrace("EVENT_EMPTY_RESULT_CLASSIFIED", execution, target, {
      valid_empty: validEmptyEventResult,
      reason: validEmptyEventResult
        ? "persisted_current_floor_events_empty"
        : expectedEventCount === 0
          ? "persisted_current_floor_events_unexpected"
          : "nonempty_result_requires_canonical_events",
    }, "event");
    emitPersistenceTrace("CHARACTER_CANONICAL_STATE_BUILT", execution, target, {
      character_count: characterCount,
      event_count: eventCount,
      current_floor_included: currentFloorIncluded,
      source: "authoritative_floor",
    }, "event");
    const ready = currentFloorIncluded &&
      business?.current_state_status !== "STATE_ERROR" &&
      canonicalEventCountMatches && canonicalEventIdsMatch;
    emitPersistenceTrace("CHARACTER_UI_READY", execution, target, {
      ready,
      reason: ready
        ? validEmptyEventResult ? "valid_empty_event_result" : "canonical_business_state_ready"
        : !canonicalEventCountMatches || !canonicalEventIdsMatch
          ? "canonical_event_state_missing"
          : "canonical_business_state_invalid",
    }, "event");
    if (!ready) {
      const error = new Error("CHARACTER_CANONICAL_NOT_READY");
      error.code = "CHARACTER_CANONICAL_NOT_READY";
      error.analysis_stage = "character_ui_ready";
      throw error;
    }
    return { business, slotAudit, expectedEvents };
  }

  async function runEventAttempt({
    target,
    token,
    execution,
    analysisInput,
    finalWorldModel,
    savedAnalysis,
    dependencyHash,
    previousError = null,
  }) {
    if (typeof analyzer?.analyzeFloor !== "function")
      throw new Error("EVENT_ANALYZER_UNAVAILABLE");
    emitPersistenceTrace("VERSION_CHAIN", execution, target, {
      boundary: "API_REQUEST_STARTED",
      source_kind: "analysis_target",
      analysis_execution_id: execution?.analysis_execution_id ?? null,
      source_text_length: execution?.source_text_length ?? null,
    }, "event");
    const result = await analyzer.analyzeFloor({
      analysisInput,
      world_model: finalWorldModel,
      floor_version: target.version,
      authoritative_floor_version: target.version,
      signal: execution.controller.signal,
      retry_directive:
        previousError?.diagnostic_code === "unexpected_top_level_field" &&
        (previousError?.diagnostic_path ?? previousError?.error_path) === "$.continuation_of_event_id"
          ? {kind: "continuation_field_placement"}
          : null,
      onEventAnalysisTrace: (details) => emitPersistenceTrace(
        details?.stage ?? "EVENT_ANALYSIS_DIAGNOSTIC",
        execution,
        target,
        details,
        "event",
      ),
    });
    emitPersistenceTrace("VERSION_CHAIN", execution, target, {
      boundary: "API_RESULT_RECEIVED",
      source_kind: "analysis_target",
      analysis_execution_id: execution?.analysis_execution_id ?? null,
      source_text_length: execution?.source_text_length ?? null,
      result: "received",
    }, "event");
    emitPersistenceTrace("EVENT_VALIDATION_RESULT", execution, target, {
      schema_valid: true,
      domain_valid: null,
    }, "event");
    assertExecutionCurrent(execution, token);
    execution.stage = "identity_resolution";
    const rawResultEvents = Array.isArray(result) ? result : (Array.isArray(result?.events) ? result.events : []);
    const splitResultEvents = rawResultEvents.flatMap(splitCompositePregnancyExposureEvent);
    const identityInput = Array.isArray(result) ? splitResultEvents : {...result, events: splitResultEvents};
    const identityResult = resolveEventAnalysisIdentities(identityInput, {
      registry: normalizeCharacterRegistry(analysisInput.character_registry),
      persistAliases: true,
      narrative: analysisNarrative(analysisInput),
    });
    if (!identityResult.ok) throw identityResolutionError(identityResult);
    const identityResolvedEvents = Array.isArray(identityResult.events)
      ? identityResult.events
      : [];
    const selectedExistingEvents = Array.isArray(analysisInput.existing_events)
      ? analysisInput.existing_events
      : [];
    const currentFloorEvents = selectedExistingEvents
      .map((event) => normalizeEvent(event));
    const explicitContinuationIndexes = new WeakMap();
    const explicitContinuationUpdates = new WeakMap();
    const implicitContinuationIndexes = new WeakMap();
    const implicitContinuationUpdates = new WeakMap();
    const rejectedExplicitContinuations = new WeakSet();
    const removedCurrentIndexes = new Map();
    const continuationDiagnostics = [];
    let appendedEventOrdinal = 0;
    const historicalEventsForDedupe = (analysisInput.existing_events ?? [])
      .filter((event) => !sameFloorVersion(event?.source, target.version));
    const dedupedEvents = dedupeEventsAgainstExisting(
      identityResolvedEvents,
      historicalEventsForDedupe,
    );
    emitPersistenceTrace("EVENT_SEMANTIC_DEDUPE_RESULT", execution, target, {
      input_event_count: identityResolvedEvents.length,
      existing_event_count: Array.isArray(analysisInput.existing_events)
        ? analysisInput.existing_events.length
        : 0,
      retained_event_count: dedupedEvents.length,
      removed_event_count: identityResolvedEvents.length - dedupedEvents.length,
    }, "event");
    execution.stage = "normalization";
    const hasExistingState = currentFloorEvents.length > 0 ||
      Boolean(analysisInput.existing_bioweave?.analysis?.status);
    const currentEventIndexes = new Map();
    if (currentFloorEvents.length) {
      currentFloorEvents.forEach((event, index) => {
        if (!continuationSourceIsVisible(event?.source, target.version)) return;
        for (const key of [
          eventContinuityKey(event) && `same:${eventContinuityKey(event)}`,
          eventEpisodeContinuityKey(event) && `episode:${eventEpisodeContinuityKey(event)}`,
          eventStableContinuityKey(event) && `stable:${eventStableContinuityKey(event)}`,
        ].filter(Boolean)) {
          const indexes = currentEventIndexes.get(key) ?? [];
          indexes.push(index);
          currentEventIndexes.set(key, indexes);
        }
      });
    }
    const historicalStableDuplicateIndexes = (event) => {
      const stableKey = eventStableContinuityKey(event);
      if (!stableKey || event?.continuation_update === false) return [];
      return [...new Set((currentEventIndexes.get(`stable:${stableKey}`) ?? [])
        .filter(index => {
          const current = currentFloorEvents[index];
          return !sameFloorOwner(current?.source, target.version) &&
            markerlessStoryTimeCompatible(event?.story_time, current?.story_time) &&
            compatibleWorldModelRuleRefs(
              current?.pregnancy_relevance?.reproductive_mechanism?.world_model_rule_refs,
              event?.pregnancy_relevance?.reproductive_mechanism?.world_model_rule_refs,
            ) && (!current?.location || !event?.location || current.location === event.location);
        }))];
    };
    const earliestHistoricalIndex = (indexes) => indexes.reduce((earliest, index) => {
      const earliestFloor = Number(currentFloorEvents[earliest]?.source?.floor);
      const candidateFloor = Number(currentFloorEvents[index]?.source?.floor);
      return Number.isFinite(candidateFloor) &&
        (!Number.isFinite(earliestFloor) || candidateFloor < earliestFloor)
        ? index
        : earliest;
    }, indexes[0]);
    const convergedHistoricalEvents = new Map();
    const findContinuityIndex = (event) => {
      const exactKey = eventContinuityKey(event);
      const episodeKey = eventEpisodeContinuityKey(event);
      const stableKey = eventStableContinuityKey(event);
      const markerAllowsContinuity = event?.continuation_update === true;
      const explicitIndependentBoundary = event?.continuation_update === false;
      const keys = [
        exactKey && `same:${exactKey}`,
        !explicitIndependentBoundary && stableKey && `stable:${stableKey}`,
        markerAllowsContinuity && episodeKey && `episode:${episodeKey}`,
      ].filter(Boolean);
      const candidateIndexes = keys.flatMap(key =>
        (currentEventIndexes.get(key) ?? []).map(index => ({index, key})),
      );
      const compatibleIndexEntries = candidateIndexes.filter(({index, key}) =>
        (key.startsWith("same:")
          ? sameFloorVersion(currentFloorEvents[index]?.source, target.version)
          : key.startsWith("episode:")
            ? Boolean(markerAllowsContinuity && episodeKey)
            : !sameFloorOwner(currentFloorEvents[index]?.source, target.version) &&
              !explicitIndependentBoundary && Boolean(stableKey)) &&
        (!key.startsWith("stable:") ||
          markerlessStoryTimeCompatible(event?.story_time, currentFloorEvents[index]?.story_time)) &&
        compatibleWorldModelRuleRefs(
          currentFloorEvents[index]?.pregnancy_relevance?.reproductive_mechanism?.world_model_rule_refs,
          event?.pregnancy_relevance?.reproductive_mechanism?.world_model_rule_refs,
        ) && (!currentFloorEvents[index]?.location || !event?.location ||
          currentFloorEvents[index].location === event.location));
      const compatibleIndexes = [...new Set(compatibleIndexEntries.map(({index}) => index))];
      return compatibleIndexes.length === 1 ? compatibleIndexes[0] : undefined;
    };
    const enrichedEvents = await Promise.all(
      dedupedEvents.map(
        async (event) => {
          const facts = event && typeof event === "object" && !Array.isArray(event)
            ? Object.fromEntries(Object.entries(event).filter(
              ([key]) => key !== "event_id" && key !== "source" &&
                key !== "continuation_of_event_id" && key !== "continuation_update",
            ))
            : event;
          if (!facts || typeof facts !== "object" || Array.isArray(facts)) return facts;
          const requestedContinuationId = typeof event?.continuation_of_event_id === "string"
            ? event.continuation_of_event_id.trim()
            : "";
          const requestedContinuationIndex = requestedContinuationId
            ? currentFloorEvents.findIndex((current) => current.event_id === requestedContinuationId)
            : -1;
          const explicitContinuationIndex = requestedContinuationIndex >= 0 &&
            validateContinuationReference(
              facts,
              currentFloorEvents[requestedContinuationIndex],
              target.version,
            )
            ? requestedContinuationIndex
            : undefined;
          if (requestedContinuationId && explicitContinuationIndex === undefined) {
            rejectedExplicitContinuations.add(event);
          }
          const continuationDiagnostic = {
            continuation_reference_present: Boolean(requestedContinuationId),
            continuation_reference_event_id: requestedContinuationId || null,
            continuation_reference_target_exists: requestedContinuationIndex >= 0,
            continuation_reference_valid: explicitContinuationIndex !== undefined,
            continuation_merge_executed: false,
            continuation_rejection_reason: requestedContinuationId
              ? explicitContinuationIndex === undefined
                ? requestedContinuationIndex >= 0 ? "reference_validation_failed" : "reference_target_missing"
                : null
              : null,
          };
          // An explicit continuation reference already selects the identity to
          // update. Only converge historical duplicates when that validated
          // target is itself one of the same stable-identity duplicates; keep
          // an expanded or otherwise different explicit target independent.
          const historicalStableIndexes = historicalStableDuplicateIndexes(event);
          const stableDuplicateIndexes = explicitContinuationIndex !== undefined
            ? historicalStableIndexes.includes(explicitContinuationIndex)
              ? historicalStableIndexes
              : []
            : requestedContinuationId
              ? []
              : historicalStableIndexes;
          if (stableDuplicateIndexes.length > 1) {
            const canonicalIndex = explicitContinuationIndex !== undefined
              ? explicitContinuationIndex
              : earliestHistoricalIndex(stableDuplicateIndexes);
            const removedIndexes = stableDuplicateIndexes.filter(index => index !== canonicalIndex);
            let canonicalEvent = convergedHistoricalEvents.get(canonicalIndex) ??
              currentFloorEvents[canonicalIndex];
            for (const duplicateIndex of removedIndexes) {
              canonicalEvent = mergeContinuedEvent(
                canonicalEvent,
                currentFloorEvents[duplicateIndex],
                true,
              );
              removedCurrentIndexes.set(duplicateIndex, "stable_duplicate_converged");
            }
            convergedHistoricalEvents.set(canonicalIndex, canonicalEvent);
            const removedEventIds = removedIndexes
              .map(index => currentFloorEvents[index]?.event_id)
              .filter(Boolean);
            continuationDiagnostic.continuation_reconciliation_reason = "stable_duplicate_converged";
            continuationDiagnostic.continuation_reconciliation_event_id = canonicalEvent?.event_id ?? null;
            continuationDiagnostic.continuation_reconciliation_removed_event_ids = removedEventIds;
          }
          const continuityIndex = explicitContinuationIndex ?? (
            requestedContinuationId
              ? undefined
              : stableDuplicateIndexes.length > 1
                ? earliestHistoricalIndex(stableDuplicateIndexes)
                : findContinuityIndex(event)
          );
          const eventOrdinal = currentFloorEvents.length + appendedEventOrdinal++;
          const materialized = await materializeStateFact({
            ...facts,
            event_id: await deterministicEventId(
              target.version,
              eventOrdinal,
            ),
            source: target.version,
          }, target.version, eventOrdinal);
          if (continuityIndex !== undefined) {
            materialized.event_id = currentFloorEvents[continuityIndex].event_id;
            if (explicitContinuationIndex === undefined) {
              implicitContinuationIndexes.set(materialized, continuityIndex);
              implicitContinuationUpdates.set(
                materialized,
                event?.continuation_update === true
                  ? hasMeaningfulContinuationUpdate(
                    currentFloorEvents[continuityIndex],
                    event,
                  )
                  : true,
              );
            }
          }
          if (requestedContinuationId && explicitContinuationIndex === undefined) {
            rejectedExplicitContinuations.add(materialized);
          }
          if (explicitContinuationIndex !== undefined) {
            materialized.source = structuredClone(currentFloorEvents[continuityIndex].source);
            explicitContinuationIndexes.set(materialized, explicitContinuationIndex);
            const meaningfulExplicitUpdate = hasMeaningfulContinuationUpdate(
              currentFloorEvents[explicitContinuationIndex],
              event,
            );
            explicitContinuationUpdates.set(materialized, meaningfulExplicitUpdate);
            continuationDiagnostic.continuation_merge_executed = true;
            for (const [currentIndex, currentEvent] of currentFloorEvents.entries()) {
              if (currentIndex === explicitContinuationIndex ||
                  !sameFloorVersion(currentEvent?.source, target.version)) continue;
              const sameEpisode = (eventEpisodeContinuityKey(facts) &&
                eventEpisodeContinuityKey(currentEvent) === eventEpisodeContinuityKey(facts)) ||
                (eventContinuityKey(facts) &&
                eventContinuityKey(currentEvent) === eventContinuityKey(facts));
              if (!strictContinuationDuplicate(facts, currentEvent) && !sameEpisode) continue;
              removedCurrentIndexes.set(currentIndex, "explicit_continuation_duplicate");
            }
          }
          continuationDiagnostics.push(continuationDiagnostic);
          return materialized;
        },
      ),
    );
    const currentStoryTimeForEvents = getCurrentStoryTime
      ? await getCurrentStoryTime(target)
      : analysisInput.story_time;
    const storyTimeValidation = validateEventStoryTimesAtOrBefore(
      enrichedEvents,
      currentStoryTimeForEvents,
    );
    if (storyTimeValidation.future_event_ids.length) {
      emitPersistenceTrace("EVENT_STORY_TIME_REJECTED", execution, target, {
        event_ids: storyTimeValidation.future_event_ids,
        reason: "event_after_target_story_time",
      }, "event");
    }
    if (storyTimeValidation.incomparable_event_ids.length) {
      emitPersistenceTrace("EVENT_STORY_TIME_INCOMPARABLE", execution, target, {
        event_ids: storyTimeValidation.incomparable_event_ids,
        reason: "story_time_not_comparable",
      }, "event");
    }
    const rejectedFutureEventIds = new Set(storyTimeValidation.future_event_ids);
    const acceptedEnrichedEvents = enrichedEvents.filter(
      (event) => !rejectedFutureEventIds.has(event?.event_id),
    );
    const lockState = typeof resolveLockedExposureState === "function"
      ? await resolveLockedExposureState({target})
      : {lockedCycleKeys: [], lifecycleArchiveReleaseReady: false};
    const unlockedEnrichedEvents = acceptedEnrichedEvents.filter(event => !isCycleExposureLocked({
      event,
      lockedCycleKeys: lockState?.lockedCycleKeys,
      lifecycleArchiveReleaseReady: lockState?.lifecycleArchiveReleaseReady,
    }));
    if (unlockedEnrichedEvents.length !== acceptedEnrichedEvents.length) {
      emitPersistenceTrace("PARTICIPANT_AGGREGATION_LOCK_FILTERED", execution, target, {
        filtered_event_count: acceptedEnrichedEvents.length - unlockedEnrichedEvents.length,
        retained_event_count: unlockedEnrichedEvents.length,
        locked_cycle_keys: lockState?.lockedCycleKeys ?? [],
      }, "event");
    }
    acceptedEnrichedEvents.splice(0, acceptedEnrichedEvents.length, ...unlockedEnrichedEvents);
    emitPersistenceTrace("EVENT_NORMALIZATION_RESULT", execution, target, {
      event_count: acceptedEnrichedEvents.length,
      rejected_future_event_count: rejectedFutureEventIds.size,
    }, "event");
    emitPersistenceTrace("EVENT_EMPTY_RESULT_CLASSIFIED", execution, target, {
      valid_empty: acceptedEnrichedEvents.length === 0,
      reason: acceptedEnrichedEvents.length === 0
        ? "normalized_event_array_empty"
        : "normalized_event_array_nonempty",
    }, "event");
    const expectedCharacterIds = [...new Set(acceptedEnrichedEvents.flatMap((event) => [
      ...(event?.participants ?? []).map((participant) => participant?.character_id).filter(Boolean),
      ...(event?.pregnancy_relevance?.gestational_subject_ids ?? []),
      ...(event?.pregnancy_relevance?.counterpart_ids ?? []),
      event?.state_fact?.subject_id,
    ].filter(Boolean)))];
    emitPersistenceTrace("CHARACTER_CANONICAL_EXPECTATION", execution, target, {
      expected_event_count: acceptedEnrichedEvents.length,
      expected_character_count: expectedCharacterIds.length,
      expected_character_ids: expectedCharacterIds,
    }, "event");
    execution.stage = "schema_validation";
    const collectionValidation = validateEventCollection(acceptedEnrichedEvents, {
      strictCanonicalParticipants: true,
    });
    if (!collectionValidation.ok) {
      emitPersistenceTrace("EVENT_VALIDATION_RESULT", execution, target, {
        schema_valid: true,
        domain_valid: false,
        validation_error_path: collectionValidation.errors?.[0] ?? "events",
      }, "event");
      throw domainValidationError(collectionValidation, "EVENT_DOMAIN_VALIDATION_FAILED", acceptedEnrichedEvents);
    }
    emitPersistenceTrace("EVENT_VALIDATION_RESULT", execution, target, {
      schema_valid: true,
      domain_valid: true,
    }, "event");
    const updatedByCurrentIndex = new Map(
      acceptedEnrichedEvents
        .map((event) => {
          const explicitIndex = explicitContinuationIndexes.get(event);
          const index = explicitIndex ?? (
            rejectedExplicitContinuations.has(event)
              ? undefined
              : implicitContinuationIndexes.get(event)
          );
          if (index === undefined) return [index, event];
          const current = currentFloorEvents[index];
          return [index, mergeContinuedEvent(
            convergedHistoricalEvents.get(index) ?? current,
            event,
            explicitContinuationIndexes.has(event)
              ? explicitContinuationUpdates.get(event) === true
              : implicitContinuationUpdates.get(event) === true,
          )];
        })
        .filter(([index]) => index !== undefined),
    );
    let events = dedupeEvents([
      ...currentFloorEvents
        .map((event, index) => removedCurrentIndexes.has(index)
          ? null
          : updatedByCurrentIndex.get(index) ?? event)
        .filter(Boolean),
      ...acceptedEnrichedEvents.filter((event) => {
        const explicitIndex = explicitContinuationIndexes.get(event);
        if (explicitIndex !== undefined) return false;
        if (rejectedExplicitContinuations.has(event)) return true;
        return implicitContinuationIndexes.get(event) === undefined;
      }),
    ]).map((event) => normalizeEvent(event));
    const preAnalysisEventIds = currentFloorEvents.map(event => event?.event_id).filter(Boolean);
    const postAnalysisEventIds = events.map(event => event?.event_id).filter(Boolean);
    const preAnalysisIdSet = new Set(preAnalysisEventIds);
    const postAnalysisIdSet = new Set(postAnalysisEventIds);
    const updatedEventIds = [...updatedByCurrentIndex.entries()]
      .filter(([index]) => !removedCurrentIndexes.has(index))
      .map(([, event]) => event?.event_id)
      .filter(Boolean);
    emitPersistenceTrace("EVENT_RECONCILIATION_RESULT", execution, target, {
      pre_analysis_event_ids: preAnalysisEventIds,
      pre_analysis_current_floor_event_ids: currentFloorEvents
        .filter(event => sameFloorVersion(event?.source, target.version))
        .map(event => event?.event_id)
        .filter(Boolean),
      candidate_event_count: identityResolvedEvents.length,
      post_analysis_event_ids: postAnalysisEventIds,
      added_event_ids: postAnalysisEventIds.filter(id => !preAnalysisIdSet.has(id)),
      updated_event_ids: [...new Set(updatedEventIds)],
      retained_event_ids: postAnalysisEventIds.filter(id => preAnalysisIdSet.has(id) && !updatedEventIds.includes(id)),
      removed_event_ids: preAnalysisEventIds.filter(id => !postAnalysisIdSet.has(id)),
      removal_reasons: [...removedCurrentIndexes.entries()].map(([index, reason]) => ({
        event_id: currentFloorEvents[index]?.event_id ?? null,
        reason,
      })),
      continuation_diagnostics: continuationDiagnostics,
    }, "event");
    if (healthEvolution?.findExpiredEventIds) {
      const currentStoryTime = getCurrentStoryTime
        ? await getCurrentStoryTime(target)
        : analysisInput.story_time;
      const states = await collectCurrentFloorStates(token, {validOnly: true});
      const expiredEventIds = healthEvolution.findExpiredEventIds({
        states,
        currentEvents: events,
        currentStoryTime,
        protectedEventIds: acceptedEnrichedEvents.map((event) => event?.event_id).filter(Boolean),
      });
      if (expiredEventIds.length) {
        if (typeof waitForHealthRecoveryStability === "function") {
          await waitForHealthRecoveryStability({target, execution, token});
        }
        const stableStoryTime = getCurrentStoryTime
          ? await getCurrentStoryTime(target)
          : currentStoryTime;
        const stableStates = await collectCurrentFloorStates(token, {validOnly: true});
        const stableExpiredEventIds = healthEvolution.findExpiredEventIds({
          states: stableStates,
          currentEvents: events,
          currentStoryTime: stableStoryTime,
          protectedEventIds: acceptedEnrichedEvents.map((event) => event?.event_id).filter(Boolean),
        });
        const stableExpired = new Set(stableExpiredEventIds);
        events = events.filter((event) => !stableExpired.has(event?.event_id));
        emitPersistenceTrace("HEALTH_RECOVERY_EVENTS_EXPIRED", execution, target, {
          expired_event_ids: stableExpiredEventIds,
          event_count_before: currentFloorEvents.length,
          event_count_after: events.length,
          delayed_stability_check: true,
        }, "health");
      }
    }
    let characterRegistry = identityResult.character_registry;
    if (execution.reason === "manual-refresh") {
      const resolvedRegistry = typeof resolveCharacterRegistryAtOrBefore === "function"
        ? await resolveCharacterRegistryAtOrBefore(target)
        : null;
      characterRegistry = normalizeCharacterRegistry(
        resolvedRegistry?.character_registry ?? identityResult.character_registry,
      );
      const referencedCharacterIds = new Set(
        events.flatMap((event) => (event.participants ?? [])
          .map((participant) => participant?.character_id)
          .filter(Boolean)),
      );
      for (const [characterId, entry] of Object.entries(identityResult.character_registry.entities ?? {})) {
        if (referencedCharacterIds.has(characterId) &&
            !characterRegistry.entities[characterId])
          characterRegistry.entities[characterId] = entry;
      }
    }
    const currentFloor = getFloor(target.index, target.swipeId);
    const currentFloorHasCompleteSnapshot = Boolean(
      currentFloor &&
      sameFloorVersion(floorVersionFromData(currentFloor), target.version) &&
      currentFloor.analysis?.status === "success" &&
      Array.isArray(currentFloor.events) &&
      currentFloor.character_registry,
    );
    const inheritedEmptyResultIsUnchanged = !currentFloorHasCompleteSnapshot &&
      currentFloorEvents.length > 0 &&
      acceptedEnrichedEvents.length === 0;
    const unchanged = (currentFloorHasCompleteSnapshot || inheritedEmptyResultIsUnchanged) &&
      JSON.stringify(events) === JSON.stringify(currentFloorEvents);
    const currentStoredRegistry = normalizeCharacterRegistry(
      getFloor(target.index, target.swipeId)?.character_registry,
    );
    const registryChanged = execution.reason === "manual-refresh" &&
      JSON.stringify(characterRegistry) !== JSON.stringify(currentStoredRegistry);
    if (unchanged && hasExistingState && !registryChanged) {
      try {
        await maybeCreateSnapshot(target, token);
      } catch (snapshotError) {
        trace("runtime-snapshot-error", {
          error: snapshotError,
          phase: "snapshot_checkpoint",
          attempt: execution.attempt,
          staleChat: isStaleChat(snapshotError),
        });
      }
      return {identityResult, events, analysis: null, unchanged: true};
    }
    const assessmentCandidates = healthAssessment?.selectCandidates
      ? healthAssessment.selectCandidates({events, currentEvents: currentFloorEvents})
      : events;
    const analyzedAt = new Date().toISOString();
    const analysis = commitAnalysis(savedAnalysis, {
      status: "success",
      analyzed_at: analyzedAt,
      last_analyzed_at: analyzedAt,
      started_at: execution.started_at,
      finished_at: analyzedAt,
      event_count: events.length,
      reason: execution.reason,
      attempt: execution.attempt,
    }, target.version);
    analysis.dependency_hash = dependencyHash;
    analysis.source_provenance = { ...target.version };
    await assertExecutionTargetCurrent(execution, target, token);
    const currentDependencyHash = await dependencyHashForTarget(target, token);
    if (currentDependencyHash !== dependencyHash) {
      invalidateExecution(execution);
      throw requestAbortedError();
    }
    execution.stage = "floor_save";
    await assertExecutionTargetCurrent(execution, target, token);
    execution.floorSaveStarted = true;
    execution.persistence_invocation_id = nextPersistenceInvocationId("event");
    try {
      await commitFloorPatch(target, "event", {
        analysis,
        events,
        character_registry: characterRegistry,
      }, {
        operation_type: "event-analysis-patch",
        execution,
        traceContext: persistenceTraceContext(execution, target, "event"),
        assertCurrent: () => assertExecutionTargetCurrent(execution, target, token),
      });
    } catch (cause) {
      if (cause?.code !== "FLOOR_TX_READBACK_FAILED") throw cause;
      await verifyCharacterCanonicalReady(target, execution, token, events);
      const canonical = new Error("CHARACTER_CANONICAL_NOT_READY");
      canonical.code = "CHARACTER_CANONICAL_NOT_READY";
      canonical.analysis_stage = "character_canonical_read";
      canonical.cause = cause;
      throw canonical;
    }
    execution.floorSaved = true;
    const finalFloor = getFloor(target.index, target.swipeId) ?? null;
    if (
      !finalFloor ||
      !sameFloorVersion(floorVersionFromData(finalFloor), target.version) ||
      !finalFloor.analysis ||
      !Array.isArray(finalFloor.events) ||
      !finalFloor.character_registry
    ) {
      const error = new Error("FLOOR_PERSISTENCE_READBACK_FAILED");
      error.code = "FLOOR_PERSISTENCE_READBACK_FAILED";
      error.analysis_stage = "event_persistence_readback";
      throw error;
    }
    emitPersistenceTrace("FINAL_BIOWEAVE_SLOT_SUMMARY", execution, target, {
      world_model_present: Boolean(finalFloor.world_model),
      event_analysis_present: Boolean(finalFloor.analysis),
      event_slot_present: Array.isArray(finalFloor.events),
    }, "event");
    await assertExecutionTargetCurrent(execution, target, token);
    // Assessment is downstream derived data; it must not roll back factual
    // Event persistence when its own AI or storage path fails.
    if (healthAssessment?.assessFloor && typeof analyzer?.analyzeHealthAssessment === "function") {
      try {
        await healthAssessment.assessFloor({
          target,
          execution,
          token,
          events: assessmentCandidates,
          signal: execution.controller.signal,
        });
      } catch (assessmentError) {
        emitPersistenceTrace("HEALTH_ASSESSMENT_DOWNSTREAM_FAILED", execution, target, {
          code: assessmentError?.code ?? assessmentError?.message ?? "HEALTH_ASSESSMENT_FAILED",
        }, "health");
      }
    }
    clearInvalidatedFloor(target.version);
    execution.stage = "snapshot_checkpoint";
    try {
      await maybeCreateSnapshot(target, token);
    } catch (snapshotError) {
      trace("runtime-snapshot-error", {
        error: snapshotError,
        phase: execution.stage,
        attempt: execution.attempt,
        staleChat: isStaleChat(snapshotError),
      });
    }
    execution.stage = "registry_rebuild";
    assertExecutionCurrent(execution, token);
    const rebuiltRegistry = await refreshTrackingRegistry(execution.reason);
    assertExecutionCurrent(execution, token);
    if (!rebuiltRegistry || typeof rebuiltRegistry !== "object") {
      const error = new Error("CHARACTER_UI_NOT_READY");
      error.code = "CHARACTER_UI_NOT_READY";
      error.analysis_stage = "character_ui_ready";
      throw error;
    }
    await verifyCharacterCanonicalReady(target, execution, token, events);
    if (typeof persistPregnancyLifecycleFacts === "function") {
      await persistPregnancyLifecycleFacts({target, events, execution, token});
    }
    execution.event_count = events.length;
    trace("runtime-success", {
      state: "success",
      phase: execution.stage,
      attempt: execution.attempt,
      eventCount: events.length,
      floorSaved: execution.floorSaved === true,
      persistenceComplete: true,
      registryComplete: true,
    });
    return { identityResult, events, analysis, unchanged };
  }

  return { runEventAttempt };
}

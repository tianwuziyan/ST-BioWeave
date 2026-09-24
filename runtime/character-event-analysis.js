import { traceApi } from "../ai/client.js";
import {
  dedupeEvents,
  normalizeEvent,
  validateEventCollection,
} from "../core/events.js";
import {
  normalizeCharacterRegistry,
  resolveEventAnalysisIdentities,
} from "../core/identity.js";
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
  if (pregnancyRef?.kind === "new") {
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
  }) {
    if (typeof analyzer?.analyzeFloor !== "function")
      throw new Error("EVENT_ANALYZER_UNAVAILABLE");
    const result = await analyzer.analyzeFloor({
      analysisInput,
      world_model: finalWorldModel,
      floor_version: target.version,
      authoritative_floor_version: target.version,
      signal: execution.controller.signal,
      onEventAnalysisTrace: (details) => emitPersistenceTrace(
        details?.stage ?? "EVENT_ANALYSIS_DIAGNOSTIC",
        execution,
        target,
        details,
        "event",
      ),
    });
    emitPersistenceTrace("EVENT_VALIDATION_RESULT", execution, target, {
      schema_valid: true,
      domain_valid: null,
    }, "event");
    assertExecutionCurrent(execution, token);
    execution.stage = "identity_resolution";
    const identityResult = resolveEventAnalysisIdentities(result, {
      registry: normalizeCharacterRegistry(analysisInput.character_registry),
      persistAliases: true,
      narrative: analysisNarrative(analysisInput),
    });
    if (!identityResult.ok) throw identityResolutionError(identityResult);
    execution.stage = "normalization";
    const enrichedEvents = await Promise.all(
      (Array.isArray(identityResult.events) ? identityResult.events : []).map(
        async (event, ordinal) => {
          const facts = event && typeof event === "object" && !Array.isArray(event)
            ? Object.fromEntries(Object.entries(event).filter(
              ([key]) => key !== "event_id" && key !== "source",
            ))
            : event;
          if (!facts || typeof facts !== "object" || Array.isArray(facts)) return facts;
          return materializeStateFact({
            ...facts,
            event_id: await deterministicEventId(target.version, ordinal),
            source: target.version,
          }, target.version, ordinal);
        },
      ),
    );
    emitPersistenceTrace("EVENT_NORMALIZATION_RESULT", execution, target, {
      event_count: enrichedEvents.length,
    }, "event");
    emitPersistenceTrace("EVENT_EMPTY_RESULT_CLASSIFIED", execution, target, {
      valid_empty: enrichedEvents.length === 0,
      reason: enrichedEvents.length === 0
        ? "normalized_event_array_empty"
        : "normalized_event_array_nonempty",
    }, "event");
    const expectedCharacterIds = [...new Set(enrichedEvents.flatMap((event) => [
      ...(event?.participants ?? []).map((participant) => participant?.character_id).filter(Boolean),
      ...(event?.pregnancy_relevance?.gestational_subject_ids ?? []),
      ...(event?.pregnancy_relevance?.counterpart_ids ?? []),
      event?.state_fact?.subject_id,
    ].filter(Boolean)))];
    emitPersistenceTrace("CHARACTER_CANONICAL_EXPECTATION", execution, target, {
      expected_event_count: enrichedEvents.length,
      expected_character_count: expectedCharacterIds.length,
      expected_character_ids: expectedCharacterIds,
    }, "event");
    execution.stage = "schema_validation";
    const collectionValidation = validateEventCollection(enrichedEvents, {
      strictCanonicalParticipants: true,
    });
    if (!collectionValidation.ok) {
      emitPersistenceTrace("EVENT_VALIDATION_RESULT", execution, target, {
        schema_valid: true,
        domain_valid: false,
        validation_error_path: collectionValidation.errors?.[0] ?? "events",
      }, "event");
      throw domainValidationError(collectionValidation, "EVENT_DOMAIN_VALIDATION_FAILED", enrichedEvents);
    }
    emitPersistenceTrace("EVENT_VALIDATION_RESULT", execution, target, {
      schema_valid: true,
      domain_valid: true,
    }, "event");
    const events = dedupeEvents(enrichedEvents).map((event) => normalizeEvent(event));

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
        character_registry: identityResult.character_registry,
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
    return { identityResult, events, analysis };
  }

  return { runEventAttempt };
}

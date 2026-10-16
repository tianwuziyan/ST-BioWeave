import {evaluateProjectionEligibility, evaluateProjectionEvolution, normalizeProjectionRules} from "../core/projection-eligibility.js";
import {generateProjectionCandidate} from "../core/projection-generation.js";
import {hashText} from "./floor.js";
import {differenceStoryTime} from "../story/time.js";

function clone(value) {
  if (value === undefined || value === null || typeof value !== "object") return value;
  if (typeof structuredClone === "function") return structuredClone(value);
  if (Array.isArray(value)) return value.map(clone);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function sameIdentity(left, right) {
  return left?.subject_id === right?.subject_id
    && (left?.pregnancy_id ?? null) === (right?.pregnancy_id ?? null)
    && left?.cycle_id === right?.cycle_id;
}

function sameFloorOwner(left, right) {
  return Boolean(left && right) && ['chat_id', 'message_id', 'floor', 'swipe_id']
    .every(field => String(left[field] ?? '') === String(right[field] ?? ''));
}

function lifecycleFactsFor(events, identity) {
  return (Array.isArray(events) ? events : []).filter(event => {
    if (event?.status !== 'confirmed') return false;
    const payload = event?.state_fact?.payload ?? {};
    const subjectId = event?.state_fact?.subject_id ?? event?.pregnancy_relevance?.gestational_subject_ids?.[0] ?? null;
    const cycleId = payload.cycle_id ?? null;
    const pregnancyId = payload.status === 'not_pregnant' ? null : payload.pregnancy_id ?? null;
    return subjectId === identity.subject_id && cycleId === identity.cycle_id
      && (pregnancyId === (identity.pregnancy_id ?? null) || payload.status === 'not_pregnant')
      && (event?.type === 'pregnancy_lifecycle' || ['pregnancy_confirmation', 'pregnancy_loss', 'abortion', 'delivery'].includes(event?.type));
  });
}

function deliveryIsBeforeResponse(delivery, target, execution) {
  if (!delivery || !target?.version) return false;
  if (Number(delivery.owner_index) < Number(target.index)) return true;
  if (Number(delivery.owner_index) !== Number(target.index)) return false;
  const submitted = delivery.submitted_floor_version;
  if (submitted?.chat_id !== target.version.chat_id || submitted?.message_id !== target.version.message_id || Number(submitted?.swipe_id) !== Number(target.version.swipe_id)) return false;
  if (submitted.content_hash === target.version.content_hash && submitted.message_version === target.version.message_version) return false;
  const generationId = execution?.generation_id ?? null;
  return Boolean(generationId && delivery.generation_id && String(generationId) === String(delivery.generation_id));
}

function floorOwner(floor) {
  return {
    message_index: floor?.index ?? floor?.message_index,
    message_id: floor?.version?.message_id ?? floor?.message_id,
  };
}

function viewStatus(view) {
  if (view?.deleted) return "deleted";
  return view?.factual_status ?? "active";
}

function toProjectionDTO(view) {
  if (!view || typeof view !== "object") return null;
  return {
    id: view.projection_id,
    subject: {id: view.subject_id},
    rule: {
      id: view.projection_rule_id,
      concern_key: view.development_concern_key,
    },
    concern_key: view.development_concern_key,
    status: viewStatus(view),
    generated_statement: view.development?.next_signal ?? "",
    development_kind: view.development?.kind ?? null,
    source_refs: [...(view.source_event_ids ?? [])],
    created_story_time: view.timing?.current_story_time ?? view.timing?.reference_story_time ?? null,
    lifecycle: {
      factual_status: view.factual_status ?? "active",
      deleted: view.deleted === true,
    },
    ...(view.confidence !== undefined ? {confidence: view.confidence} : {}),
    ...(view.uncertainty !== undefined ? {uncertainty: view.uncertainty} : {}),
  };
}

function dtoFromViews(views) {
  const all = Array.isArray(views?.all) ? views.all : [];
  const projections = all.map(toProjectionDTO).filter(Boolean);
  const active = projections.filter(item => item.status === "active");
  return {
    projections,
    projection_summary: {
      active_count: active.length,
      recent: projections.slice(-3),
    },
  };
}

function decisionKey(decision) {
  return [decision?.subject_id, decision?.projection_rule_id, decision?.development_concern_key]
    .map(value => String(value ?? ""))
    .join("\u001f");
}

function projectionViewDiagnostics(views) {
  const all = Array.isArray(views?.all) ? views.all : Array.isArray(views) ? views : [];
  const active = all.filter(view => !view?.deleted && (view?.factual_status ?? 'active') === 'active');
  const contextVisible = all.filter(view => view?.context_visible === true && !view?.deleted);
  return {
    projection_view_count: all.length,
    projection_ids: all.map(view => view?.projection_id).filter(Boolean),
    active_projection_count: active.length,
    active_projection_ids: active.map(view => view?.projection_id).filter(Boolean),
    context_visible_projection_count: contextVisible.length,
    context_visible_projection_ids: contextVisible.map(view => view?.projection_id).filter(Boolean),
  };
}

function exposureIdentityDiagnostics(inputs, exposureIds = []) {
  const wanted = new Set(exposureIds);
  const sourceParticipantIds = new Set();
  const sourceIdentityIds = new Set();
  for (const event of inputs?.events ?? []) {
    if (!wanted.has(event?.event_id)) continue;
    for (const participant of event?.participants ?? []) {
      if (participant?.event_role !== 'potential_conception_source') continue;
      const participantId = participant?.character_id ?? participant?.mention_id;
      if (participantId) sourceParticipantIds.add(participantId);
      if (participant?.character_id) sourceIdentityIds.add(participant.character_id);
    }
  }
  return {
    source_participant_ids: [...sourceParticipantIds].sort(),
    source_identity_ids: [...sourceIdentityIds].sort(),
  };
}

function timingDecisionDiagnostics(decision, timing, inputs) {
  const instance = timing?.instances?.find(item => item.timing_instance_id === decision.timing_instance_id) ?? null;
  const window = timing?.windows?.find(item => item.tracking_window_id === decision.tracking_window_id) ?? null;
  const exposureIds = decision.exposure_event_ids ?? [];
  return {
    reproductive_cycle_id: instance?.cycle_id ?? window?.cycle_id ?? null,
    cycle_id: instance?.cycle_id ?? window?.cycle_id ?? null,
    tracking_window_id: decision.tracking_window_id ?? null,
    timing_instance_id: decision.timing_instance_id ?? null,
    current_story_time: inputs?.currentStoryTime ?? null,
    anchor_story_time: instance?.reference_story_time ?? null,
    elapsed_story_days: decision.timing_elapsed_story_days ?? null,
    effective_min_story_days: decision.effective_min_story_days ?? instance?.effective_min_story_days ?? null,
    effective_max_story_days: decision.effective_max_story_days ?? instance?.effective_max_story_days ?? null,
    timing_state: decision.timing_status ?? null,
    timing_transition: decision.timing_status === 'window_open'
      ? decision.existing_projection_id ? 'window_open_existing_projection' : 'window_open_without_existing_projection'
      : null,
    compatible_exposure_count: exposureIds.length,
    compatible_exposure_event_ids: [...exposureIds].sort(),
    multiple_compatible_exposures: exposureIds.length > 1,
    ...exposureIdentityDiagnostics(inputs, exposureIds),
  };
}

export function createProjectionRuntime({
  analyzer,
  enabledResolver = () => true,
  getChatId,
  collectInputs,
  resolveCurrentFloor,
  getProjectionViews,
  saveGeneratedProjection,
  saveProjectionEvidence,
  saveEvolutionDecision,
  resolvePreConfirmationTiming = null,
  refreshProjectionContext = null,
  saveProjectionDeliveryResponse = null,
  getProjectionDeliveryRecords = null,
  archiveAndReleasePregnancy = null,
  diagnostics = null,
  notify = () => {},
  activity = null,
} = {}) {
  if (typeof collectInputs !== "function") throw new TypeError("PROJECTION_INPUTS_REQUIRED");
  if (typeof resolveCurrentFloor !== "function") throw new TypeError("PROJECTION_FLOOR_REQUIRED");
  if (typeof getProjectionViews !== "function") throw new TypeError("PROJECTION_VIEWS_REQUIRED");
  if (typeof saveGeneratedProjection !== "function") throw new TypeError("PROJECTION_SAVE_REQUIRED");
  if (typeof saveEvolutionDecision !== "function") throw new TypeError("PROJECTION_EVOLUTION_SAVE_REQUIRED");

  const inFlight = new Map();
  const lifecycleInFlight = new Map();
  let destroyed = false;

  async function executionIdentity(inputs) {
    const material = stable({
      chat_id: inputs?.floor?.version?.chat_id ?? getChatId?.(),
      floor_version: inputs?.floor?.version ?? null,
      active_swipe: inputs?.floor?.swipeId ?? inputs?.floor?.version?.swipe_id ?? null,
      factual_basis: {
        events: inputs?.events ?? [],
        source_candidates: inputs?.sourceCandidates ?? [],
        state: inputs?.currentState ?? {},
        story_time: inputs?.currentStoryTime ?? null,
      },
      world_rules: inputs?.worldModel?.projection_rules ?? [],
    });
    return `projection-execution-${await hashText(JSON.stringify(material))}`;
  }

  async function currentInputsMatch(expected) {
    try {
      const current = await collectInputs();
      const currentKey = await executionIdentity(current);
      return currentKey === expected;
    } catch {
      return false;
    }
  }

  function emitStatus(payload) {
    notify({
      type: "PROJECTION_ANALYSIS_STATUS_CHANGED",
      payload,
      chatId: payload?.chat_id ?? getChatId?.(),
    });
  }

  function recordPipelineStage(payload = {}) {
    try {
      diagnostics?.recordNsfwPipelineStage?.(payload);
    } catch {
      // Diagnostic collection is fail-open and must not affect Projection.
    }
  }

  function startPipelineRun(payload = {}) {
    try {
      return diagnostics?.startNsfwPipelineRun?.(payload) ?? null;
    } catch {
      return null;
    }
  }

  function finishPipelineRun(runId, payload = {}) {
    try {
      diagnostics?.finishNsfwPipelineRun?.({run_id: runId, ...payload});
    } catch {
      // Diagnostic collection is fail-open and must not affect Projection.
    }
  }

  function startActivity(identity) {
    activity?.startActivity?.("projection_generation", {
      chat_id: identity.chat_id,
      floor_version: identity.floor_version,
      attempt: identity.execution_id,
      domain: "projection_generation",
    });
  }

  function finishActivity(identity, status, error = null) {
    activity?.finishActivity?.(
      "projection_generation",
      status === "failed" || status === "partial" ? "error" : "success",
      error,
      {
        chat_id: identity.chat_id,
        floor_version: identity.floor_version,
        attempt: identity.execution_id,
        domain: "projection_generation",
      },
    );
  }

  async function recordCompletedResponse({target, execution} = {}) {
    if (typeof getProjectionDeliveryRecords !== 'function' || typeof saveProjectionDeliveryResponse !== 'function') return {status: 'unsupported', observed: 0};
    const inputs = await collectInputs();
    const deliveries = await getProjectionDeliveryRecords({chatId: target?.version?.chat_id, endpointFloor: target?.version?.floor});
    const existingResponseIds = new Set(deliveries.filter(item => item.response_id).map(item => item.response_id));
    let observed = 0;
    for (const delivery of deliveries.filter(item => item.status === 'readback_verified' && !item.response_id)) {
      if (!deliveryIsBeforeResponse(delivery, target, execution)) continue;
      const responseId = `projection_response_${await hashText(JSON.stringify({delivery_id: delivery.delivery_id, response_floor_version: target.version}))}`;
      if (existingResponseIds.has(responseId)) continue;
      const identity = {subject_id: delivery.subject_id, pregnancy_id: delivery.pregnancy_id ?? null, cycle_id: delivery.cycle_id};
      const explicitFacts = lifecycleFactsFor(inputs.events, identity).map(event => event.event_id).filter(Boolean).sort();
      await saveProjectionDeliveryResponse({
        chatId: target.version.chat_id,
        ownerFloor: floorOwner(target),
        floorVersion: target.version,
        deliveryRecord: {
          delivery_id: delivery.delivery_id,
          projection_id: delivery.projection_id,
          aggregation_id: delivery.aggregation_id,
          subject_id: delivery.subject_id,
          pregnancy_id: delivery.pregnancy_id ?? null,
          cycle_id: delivery.cycle_id,
          submitted_floor_version: delivery.submitted_floor_version,
          created_at_floor_version: target.version,
          context_fingerprint: delivery.context_fingerprint,
          response_id: responseId,
          response_floor_version: target.version,
          generation_id: execution?.generation_id ?? null,
          generation_intent_id: execution?.generation?.intent_id ?? null,
          analysis_execution_id: execution?.analysis_execution_id ?? `analysis:${target.version.message_id}:${target.version.message_version}`,
          analysis_status: 'success',
          explicit_lifecycle_fact_ids: explicitFacts,
        },
      });
      observed += 1;
    }
    return {status: 'observed', observed};
  }

  async function evaluateTimeoutNoPregnancy(target) {
    if (typeof getProjectionDeliveryRecords !== 'function' || typeof archiveAndReleasePregnancy !== 'function') return {status: 'unsupported', closed: 0};
    const inputs = await collectInputs();
    const deliveries = await getProjectionDeliveryRecords({chatId: target?.version?.chat_id, endpointFloor: target?.version?.floor});
    const lifecycle = inputs.pregnancyLifecycleTimeline ?? {release_records: []};
    const released = new Set((lifecycle.release_records ?? []).filter(record => record.action === 'cycle-lock-released').map(record => `${record.subject_id}:${record.pregnancy_id ?? 'none'}:${record.cycle_id}`));
    let closed = 0;
    for (const delivery of deliveries.filter(item => item.status === 'response_observed' && item.response_id && item.analysis_status === 'success')) {
      const identity = {subject_id: delivery.subject_id, pregnancy_id: delivery.pregnancy_id ?? null, cycle_id: delivery.cycle_id};
      const lockKey = `${identity.subject_id}:${identity.pregnancy_id ?? 'none'}:${identity.cycle_id}`;
      if (released.has(lockKey) || lifecycleFactsFor(inputs.events, identity).length) continue;
      const aggregation = (inputs.participantAggregations ?? []).find(item => item.aggregation_id === delivery.aggregation_id && sameIdentity(item, identity) && item.status === 'succeeded');
      if (!aggregation) continue;
      const elapsed = differenceStoryTime(inputs.currentStoryTime, aggregation.reference_story_time);
      if (!elapsed || elapsed.unit !== 'day' || Number(elapsed.value) <= Number(aggregation.effective_max_story_days)) continue;
      await archiveAndReleasePregnancy({
        ownerFloor: floorOwner(target),
        floorVersion: target.version,
        aggregation,
        closureReason: 'timeout_no_pregnancy',
        operationKey: `timeout-no-pregnancy:${delivery.delivery_id}`,
      });
      closed += 1;
    }
    return {status: 'evaluated', closed};
  }

  async function handleAnalysisSuccess({target, execution} = {}) {
    const runId = execution?.pipeline_run_id ?? null;
    try {
      let current = null;
      try { current = await resolveCurrentFloor?.(); } catch { current = null; }
      if (!sameFloorOwner(current?.version, target?.version)) {
        finishPipelineRun(runId, {
          execution_status: "BLOCKED",
          reason_code: "FLOOR_VERSION_CHANGED",
        });
        return {status: 'stale', response: null, timeout: null, projection: null};
      }
      const response = await recordCompletedResponse({target, execution});
      const timeout = await evaluateTimeoutNoPregnancy(target);
      const projection = await process({reason: 'factual-success', runId});
      return {response, timeout, projection};
    } catch (error) {
      finishPipelineRun(runId, {
        execution_status: "FAILED",
        reason_code: "PROJECTION_POST_PROCESSING_FAILED",
        error_code: error?.code ?? error?.message ?? "PROJECTION_POST_PROCESSING_FAILED",
      });
      throw error;
    }
  }

  async function runExecution(inputs, identity, reason, trigger) {
    const startedAt = new Date().toISOString();
    startActivity(identity);
    emitStatus({stage: "PROJECTION_PROCESS_STARTED", state: "running", phase: "process", reason, trigger, current_story_time: inputs.currentStoryTime ?? null, ...identity, started_at: startedAt});
    recordPipelineStage({
      stage: "EVENT_SNAPSHOT_RESOLUTION",
      execution_status: "SUCCEEDED",
      reason_code: "CURRENT_FLOOR_SNAPSHOT_RESOLVED",
      invoked: true,
      run_id: identity.run_id ?? null,
      chat_id: identity.chat_id,
      floor_version: identity.floor_version,
      input_count: Array.isArray(inputs.events) ? inputs.events.length : 0,
      output_count: Array.isArray(inputs.events) ? inputs.events.length : 0,
      source_type: "EXECUTION_TRACE",
    });
    recordPipelineStage({
      stage: "EXPOSURE_CLASSIFICATION",
      execution_status: "SUCCEEDED",
      reason_code: "CURRENT_EVENT_INPUTS_RESOLVED",
      invoked: true,
      run_id: identity.run_id ?? null,
      chat_id: identity.chat_id,
      floor_version: identity.floor_version,
      input_count: Array.isArray(inputs.events) ? inputs.events.length : 0,
      output_count: Array.isArray(inputs.sourceCandidates) ? inputs.sourceCandidates.length : 0,
      source_type: "EXECUTION_TRACE",
    });
    recordPipelineStage({
      stage: "TRACKING_WINDOW_RESOLUTION",
      execution_status: "SUCCEEDED",
      reason_code: "CURRENT_TRACKING_WINDOW_SNAPSHOT_RESOLVED",
      invoked: true,
      run_id: identity.run_id ?? null,
      chat_id: identity.chat_id,
      floor_version: identity.floor_version,
      input_count: Array.isArray(inputs.trackingWindows) ? inputs.trackingWindows.length : 0,
      output_count: Array.isArray(inputs.trackingWindows) ? inputs.trackingWindows.length : 0,
      source_type: "EXECUTION_TRACE",
    });
    let partial = false;
    const errors = [];
    try {
      let views = await getProjectionViews({
        chatId: identity.chat_id,
        endpointFloor: identity.floor_version.floor,
      });
      const rules = normalizeProjectionRules(inputs.worldModel?.projection_rules ?? []);
      const ruleByKey = new Map(rules.map(rule => [
        `${rule.projection_rule_id}\u001f${rule.development_concern_key}`,
        rule,
      ]));

      for (const view of views?.all ?? []) {
        if (view?.deleted || ["realized", "contradicted", "expired"].includes(view?.factual_status)) continue;
        const evolution = evaluateProjectionEvolution({
          projection: view,
          currentView: view,
          currentState: inputs.currentState,
          events: inputs.events,
          worldModel: inputs.worldModel,
          currentStoryTime: inputs.currentStoryTime,
        });
        if (["realized", "contradicted", "expired"].includes(evolution.decision)) {
          await saveEvolutionDecision({
            chatId: identity.chat_id,
            ownerFloor: floorOwner(inputs.floor),
            floorVersion: inputs.floor.version,
            projectionId: view.projection_id,
            decision: evolution.decision,
            evidenceRefs: (evolution.evidence_event_ids ?? []).map(id => `event:${id}`),
          });
        }
      }

      views = await getProjectionViews({
        chatId: identity.chat_id,
        endpointFloor: identity.floor_version.floor,
      });
      const preConfirmationTiming = typeof resolvePreConfirmationTiming === "function"
        ? await resolvePreConfirmationTiming({inputs, views, execution: identity, run_id: identity.run_id ?? null})
        : null;
      const eligibility = evaluateProjectionEligibility({
        currentState: inputs.currentState,
        events: inputs.events,
        sourceCandidates: inputs.sourceCandidates,
        worldModel: inputs.worldModel,
        currentStoryTime: inputs.currentStoryTime,
        existingProjections: views?.all ?? [],
        preConfirmationTiming,
      });
      const timingDecisions = eligibility.decisions.filter(decision => decision.timing_instance_id || decision.tracking_window_id);
      recordPipelineStage({
        stage: "TIMING_ELIGIBILITY_EVALUATION",
        execution_status: "SUCCEEDED",
        reason_code: timingDecisions.length ? "TIMING_ELIGIBILITY_EVALUATED" : "TIMING_INSTANCE_MISSING",
        invoked: timingDecisions.length > 0,
        run_id: identity.run_id ?? null,
        chat_id: identity.chat_id,
        floor_version: identity.floor_version,
        input_count: timingDecisions.length,
        output_count: timingDecisions.filter(decision => decision.eligibility === "eligible").length,
        source_type: "EXECUTION_TRACE",
      });
      recordPipelineStage({
        stage: "PROJECTION_ELIGIBILITY",
        execution_status: eligibility.diagnostics?.some(item => item.code === "projection_rule_conflict")
          ? "FAILED"
          : "SUCCEEDED",
        reason_code: eligibility.diagnostics?.[0]?.code ?? (eligibility.decisions.length ? "ELIGIBILITY_EVALUATED" : "NO_PROJECTION_DECISION"),
        invoked: true,
        run_id: identity.run_id ?? null,
        chat_id: identity.chat_id,
        floor_version: identity.floor_version,
        input_count: rules.length,
        output_count: eligibility.decisions.length,
        error_code: eligibility.diagnostics?.some(item => item.code === "projection_rule_conflict") ? "PROJECTION_ELIGIBILITY_FAILED" : null,
        projection_rules_available: rules.length > 0,
        projection_rules_count: rules.length,
        projection_eligibility: eligibility.decisions.length ? "DECISIONS_EVALUATED" : "NO_ELIGIBLE_PROJECTION",
        timing_window_status: eligibility.decisions.map(decision => decision.timing_status).filter(Boolean).join(",") || null,
        source_type: "EXECUTION_TRACE",
      });
      emitStatus({
        stage: "PROJECTION_TIMING_EVALUATED",
        state: "running",
        phase: "eligibility",
        reason,
        trigger,
        ...identity,
        existing_projection_view_count: views?.all?.length ?? 0,
        existing_projection_ids: (views?.all ?? []).map(view => view?.projection_id).filter(Boolean),
        timing_evaluations: eligibility.decisions.map(decision => ({
          subject_id: decision.subject_id,
          projection_rule_id: decision.projection_rule_id,
          timing_instance_id: decision.timing_instance_id,
          tracking_window_id: decision.tracking_window_id,
          timing_status: decision.timing_status,
          ...timingDecisionDiagnostics(decision, preConfirmationTiming, inputs),
          eligibility: decision.eligibility,
          reason_code: decision.reason_code,
          existing_projection_id: decision.existing_projection_id,
          ai_call_will_start: decision.eligibility === 'eligible' && !decision.existing_projection_id,
        })),
      });
      if (eligibility.diagnostics?.some(item => item.code === "projection_rule_conflict")) {
        throw Object.assign(new Error("PROJECTION_ELIGIBILITY_FAILED"), {code: "PROJECTION_ELIGIBILITY_FAILED"});
      }

      const generationDecisions = eligibility.decisions.filter(item => item.eligibility === "eligible" && !item.existing_projection_id);
      emitStatus({stage: "PROJECTION_AI_PLAN", state: "running", phase: "generation", reason, trigger, candidate_count: 0, ai_call_will_start: generationDecisions.length > 0, ...identity, started_at: startedAt});
      recordPipelineStage({
        stage: "PROJECTION_AI_SCHEDULING",
        execution_status: generationDecisions.length > 0 ? "ATTEMPTED" : "BLOCKED",
        reason_code: generationDecisions.length > 0 ? "ELIGIBLE_DECISION_FOUND" : "NO_ELIGIBLE_PROJECTION",
        invoked: true,
        run_id: identity.run_id ?? null,
        chat_id: identity.chat_id,
        floor_version: identity.floor_version,
        input_count: eligibility.decisions.length,
        output_count: generationDecisions.length,
        projection_rules_available: rules.length > 0,
        projection_rules_count: rules.length,
        projection_eligibility: generationDecisions.length > 0 ? "ELIGIBLE_DECISION_FOUND" : "NO_ELIGIBLE_PROJECTION",
        timing_window_status: eligibility.decisions.map(decision => decision.timing_status).filter(Boolean).join(",") || null,
        projection_ai_request_started: false,
        source_type: "EXECUTION_TRACE",
      });
      for (const decision of generationDecisions) {
        const rule = ruleByKey.get(`${decision.projection_rule_id}\u001f${decision.development_concern_key}`);
        if (!rule) {
          partial = true;
          errors.push({decision: decisionKey(decision), reason: "projection_rule_missing"});
          emitStatus({stage: "PROJECTION_AI_SKIPPED", state: "running", phase: "generation", reason, trigger, projection_rule_id: decision.projection_rule_id, development_concern_key: decision.development_concern_key, rejection_reason: "projection_rule_missing", ai_call_will_start: false, ...identity});
          continue;
        }
        emitStatus({stage: "PROJECTION_AI_REQUEST_STARTED", state: "running", phase: "generation", reason, trigger, projection_rule_id: decision.projection_rule_id, development_concern_key: decision.development_concern_key, ai_request_started: true, ai_call_will_start: true, ...timingDecisionDiagnostics(decision, preConfirmationTiming, inputs), ...identity});
        const result = await generateProjectionCandidate({
          decision,
          rule,
          currentState: inputs.currentState,
          sourceCandidates: inputs.sourceCandidates,
          currentStoryTime: inputs.currentStoryTime,
          storyContext: inputs.storyContext ?? [],
          generationContext: {
            floor_version: inputs.floor.version,
            current_story_time: inputs.currentStoryTime,
            current_character_floor: inputs.floor.version.floor,
            world_model_rule_refs: [`projection-rule:${rule.projection_rule_id}`],
            reference_story_time: inputs.currentStoryTime,
          },
          generateRaw: async generationInput => {
            if (typeof analyzer?.generateProjection !== "function") throw new Error("PROJECTION_ANALYZER_UNAVAILABLE");
            return analyzer.generateProjection(generationInput);
          },
          isStillCurrent: async ({phase}) => {
            if (destroyed || inFlight.get(identity.execution_id) === undefined) return false;
            return currentInputsMatch(identity.execution_id);
          },
        });
        const generatedProjectionIds = result.projection?.projection_id ? [result.projection.projection_id] : [];
        const validationResult = result.status === 'generated'
          ? 'passed'
          : ['validation_failed', 'invalid_json', 'assembly_failed'].includes(result.reason_code)
            ? 'failed'
            : null;
        emitStatus({stage: "PROJECTION_AI_REQUEST_COMPLETED", state: result.status === 'generated' ? "running" : "partial", phase: "generation", reason, trigger, projection_rule_id: decision.projection_rule_id, development_concern_key: decision.development_concern_key, ai_request_completed: true, ai_request_failed: result.status !== 'generated', candidate_count: generatedProjectionIds.length, candidate_validation_result: validationResult, validation_errors: result.errors ?? [], rejection_reason: result.reason_code ?? null, generated_projection_ids: generatedProjectionIds, ...identity});
        if (result.status === "stale") {
          emitStatus({state: "stale", phase: result.reason_code, reason, ...identity, started_at: startedAt});
          finishPipelineRun(identity.run_id, {
            execution_status: "BLOCKED",
            reason_code: "FLOOR_VERSION_CHANGED",
          });
          return {status: "stale", execution_id: identity.execution_id, run_id: identity.run_id, results: [result]};
        }
        if (result.status !== "generated") {
          partial = true;
          errors.push({decision: decisionKey(decision), reason: result.reason_code, errors: result.errors ?? []});
          continue;
        }
        if (!(await currentInputsMatch(identity.execution_id))) {
          emitStatus({state: "stale", phase: "before_persistence", reason, ...identity, started_at: startedAt});
          finishPipelineRun(identity.run_id, {
            execution_status: "BLOCKED",
            reason_code: "FLOOR_VERSION_CHANGED",
          });
          return {status: "stale", execution_id: identity.execution_id, run_id: identity.run_id, results: [result]};
        }
        try {
          await saveGeneratedProjection({
            chatId: identity.chat_id,
            ownerFloor: floorOwner(inputs.floor),
            floorVersion: inputs.floor.version,
            projectionCandidate: result.projection,
            traceContext: {
              projection_id: result.projection.projection_id,
              projection_rule_id: decision.projection_rule_id,
              development_concern_key: decision.development_concern_key,
              trigger,
            },
          });
          if (typeof saveProjectionEvidence === "function") {
            await saveProjectionEvidence({
              chatId: identity.chat_id,
              ownerFloor: floorOwner(inputs.floor),
              floorVersion: inputs.floor.version,
              evidenceRecord: {
                projection_id: result.projection.projection_id,
                source_event_ids: result.projection.source_event_ids,
                created_at_floor_version: inputs.floor.version,
                evidence_refs: result.projection.evidence_refs,
              },
              traceContext: {
                projection_id: result.projection.projection_id,
                projection_rule_id: decision.projection_rule_id,
                development_concern_key: decision.development_concern_key,
                trigger,
              },
            });
          }
          recordPipelineStage({
            stage: "PROJECTION_PERSISTENCE",
            execution_status: "SUCCEEDED",
            reason_code: "PROJECTION_PERSISTED",
            invoked: true,
            run_id: identity.run_id ?? null,
            chat_id: identity.chat_id,
            floor_version: identity.floor_version,
            output_count: 1,
            source_type: "EXECUTION_TRACE",
          });
        } catch (error) {
          partial = true;
          errors.push({decision: decisionKey(decision), reason: error?.code ?? error?.message ?? "persistence_failed"});
          recordPipelineStage({
            stage: "PROJECTION_PERSISTENCE",
            execution_status: "PERSIST_FAILED",
            reason_code: "PROJECTION_PERSISTENCE_FAILED",
            invoked: true,
            run_id: identity.run_id ?? null,
            chat_id: identity.chat_id,
            floor_version: identity.floor_version,
            error_code: error?.code ?? error?.message ?? "PROJECTION_PERSISTENCE_FAILED",
            source_type: "EXECUTION_TRACE",
          });
        }
      }
      let finalViews;
      let dto;
      try {
        finalViews = await getProjectionViews({chatId: identity.chat_id, endpointFloor: identity.floor_version.floor});
        dto = dtoFromViews(finalViews);
        await refreshProjectionContext?.({chatId: identity.chat_id});
      } catch (error) {
        recordPipelineStage({
          stage: "PROJECTION_READBACK",
          execution_status: "READBACK_FAILED",
          reason_code: "PROJECTION_READBACK_FAILED",
          invoked: true,
          run_id: identity.run_id ?? null,
          chat_id: identity.chat_id,
          floor_version: identity.floor_version,
          error_code: error?.code ?? error?.message ?? "PROJECTION_READBACK_FAILED",
          readback_succeeded: false,
          source_type: "EXECUTION_TRACE",
        });
        throw error;
      }
      const status = partial ? "partial" : "success";
      emitStatus({stage: "PROJECTION_READBACK", state: status, phase: "readback", reason, trigger, ...projectionViewDiagnostics(finalViews), projection_contribution_count: projectionViewDiagnostics(finalViews).context_visible_projection_count, ...identity, started_at: startedAt, finished_at: new Date().toISOString(), errors});
      recordPipelineStage({
        stage: "PROJECTION_READBACK",
        execution_status: "SUCCEEDED",
        reason_code: "PROJECTION_READBACK_COMPLETED",
        invoked: true,
        run_id: identity.run_id ?? null,
        chat_id: identity.chat_id,
        floor_version: identity.floor_version,
        input_count: finalViews?.all?.length ?? 0,
        output_count: finalViews?.all?.length ?? 0,
        readback_succeeded: true,
        source_type: "EXECUTION_TRACE",
      });
      finishPipelineRun(identity.run_id, {
        execution_status: status === "partial" ? "ATTEMPTED" : "SUCCEEDED",
        reason_code: status === "partial" ? "PROJECTION_PARTIAL" : "PROJECTION_COMPLETED",
      });
      finishActivity(identity, status, errors[0]);
      return {status, execution_id: identity.execution_id, run_id: identity.run_id, ...dto, errors};
    } catch (error) {
      emitStatus({stage: "PROJECTION_PROCESS_FAILED", state: "failed", phase: "projection", reason, trigger, ...identity, started_at: startedAt, finished_at: new Date().toISOString(), error_code: error?.code ?? error?.message ?? "PROJECTION_FAILED"});
      recordPipelineStage({
        stage: "PROJECTION_ELIGIBILITY",
        execution_status: "FAILED",
        reason_code: "PROJECTION_PROCESS_FAILED",
        invoked: true,
        run_id: identity.run_id ?? null,
        chat_id: identity.chat_id,
        floor_version: identity.floor_version,
        error_code: error?.code ?? error?.message ?? "PROJECTION_FAILED",
        source_type: "EXECUTION_TRACE",
      });
      finishPipelineRun(identity.run_id, {
        execution_status: "FAILED",
        reason_code: "PROJECTION_PROCESS_FAILED",
        error_code: error?.code ?? error?.message ?? "PROJECTION_FAILED",
      });
      finishActivity(identity, "failed", error);
      return {status: "failed", execution_id: identity.execution_id, run_id: identity.run_id, errors: [{reason: error?.code ?? error?.message ?? "PROJECTION_FAILED"}]};
    }
  }

  async function process({reason = "projection-refresh", trigger = "projection-refresh", runId = null} = {}) {
    if (destroyed) return {status: "destroyed"};
    if (enabledResolver() === false) return {status: "disabled"};
    const inputs = await collectInputs();
    if (!inputs?.floor?.version || inputs.currentStateStatus === "STATE_ERROR") return {status: "unavailable"};
    const execution_id = await executionIdentity(inputs);
    const resolvedRunId = runId ?? startPipelineRun({
      kind: "projection",
      trigger,
      reason,
      chat_id: inputs.floor.version.chat_id,
      floor_version: inputs.floor.version,
    });
    if (inFlight.has(execution_id)) {
      recordPipelineStage({
        stage: "PIPELINE_SCHEDULING",
        execution_status: "SKIPPED",
        reason_code: "PROJECTION_ALREADY_IN_FLIGHT",
        invoked: true,
        run_id: resolvedRunId,
        chat_id: inputs.floor.version.chat_id,
        floor_version: inputs.floor.version,
        input_count: 1,
        output_count: 0,
        source_type: "EXECUTION_TRACE",
      });
      finishPipelineRun(resolvedRunId, {
        execution_status: "SKIPPED",
        reason_code: "PROJECTION_ALREADY_IN_FLIGHT",
      });
      return inFlight.get(execution_id);
    }
    const identity = {
      execution_id,
      chat_id: inputs.floor.version.chat_id,
      floor_version: inputs.floor.version,
      run_id: resolvedRunId,
    };
    const promise = runExecution(inputs, identity, reason, trigger).finally(() => inFlight.delete(execution_id));
    inFlight.set(execution_id, promise);
    return promise;
  }

  /** Deterministic lifecycle-only path. It may append Projection lifecycle
   * records and refresh context, but it never evaluates eligibility, calls
   * process(), or reaches the analyzer/generation boundary. */
  async function tickLifecycleOnly({reason = 'story-time-lifecycle'} = {}) {
    if (destroyed) return {status: 'destroyed'};
    if (enabledResolver() === false) return {status: 'disabled'};
    const inputs = await collectInputs();
    if (!inputs?.floor?.version || inputs.currentStateStatus === 'STATE_ERROR') return {status: 'unavailable'};
    const execution_id = await executionIdentity(inputs);
    if (lifecycleInFlight.has(execution_id)) return lifecycleInFlight.get(execution_id);
    const work = (async () => {
      const views = await getProjectionViews({chatId: inputs.floor.version.chat_id, endpointFloor: inputs.floor.version.floor});
      const expiredWindows = new Map((inputs.trackingWindows ?? []).filter(window => window.status === 'expired').map(window => [window.tracking_window_id, window]));
      let expired = 0;
      for (const view of views?.all ?? []) {
        const window = expiredWindows.get(view.tracking_window_id);
        if (!window || view.tracking_scope !== 'pre_confirmation' || view.deleted || ['realized', 'contradicted', 'expired'].includes(view.factual_status)) continue;
        await saveEvolutionDecision({
          chatId: inputs.floor.version.chat_id,
          ownerFloor: floorOwner(inputs.floor),
          floorVersion: inputs.floor.version,
          projectionId: view.projection_id,
          decision: 'expired',
          evidenceRefs: [`tracking_window:${window.tracking_window_id}`],
        });
        expired += 1;
      }
      await refreshProjectionContext?.({chatId: inputs.floor.version.chat_id});
      return {status: 'success', execution_id, expired_projections: expired};
    })().finally(() => lifecycleInFlight.delete(execution_id));
    lifecycleInFlight.set(execution_id, work);
    return work;
  }

  async function getBusinessData() {
    let floor;
    try {
      floor = await resolveCurrentFloor();
    } catch {
      return {projections: [], projection_summary: {active_count: 0, recent: []}};
    }
    if (!floor?.version) return {projections: [], projection_summary: {active_count: 0, recent: []}};
    try {
      const views = await getProjectionViews({chatId: floor.version.chat_id, endpointFloor: floor.version.floor});
      return dtoFromViews(views);
    } catch {
      return {projections: [], projection_summary: {active_count: 0, recent: []}};
    }
  }

  async function deleteProjection({projectionId} = {}) {
    const inputs = await collectInputs();
    if (!inputs?.floor?.version) throw new Error("NO_CHARACTER_FLOOR");
    if (typeof inputs.deleteProjection !== "function") throw new Error("PROJECTION_DELETE_UNAVAILABLE");
    const result = await inputs.deleteProjection({
      chatId: inputs.floor.version.chat_id,
      ownerFloor: floorOwner(inputs.floor),
      floorVersion: inputs.floor.version,
      projectionId,
      evidenceRefs: ["user:delete"],
    });
    await refreshProjectionContext?.({chatId: inputs.floor.version.chat_id});
    return {...result, ...(await getBusinessData())};
  }

  function destroy() {
    destroyed = true;
    inFlight.clear();
  }

  return {
    process,
    tickLifecycleOnly,
    refreshProjection: () => process({reason: "projection-refresh"}),
    getBusinessData,
    deleteProjection,
    recordCompletedResponse,
    evaluateTimeoutNoPregnancy,
    handleAnalysisSuccess,
    destroy,
  };
}

import {evaluateProjectionEligibility, evaluateProjectionEvolution, normalizeProjectionRules} from "../core/projection-eligibility.js";
import {generateProjectionCandidate} from "../core/projection-generation.js";
import {hashText} from "./floor.js";

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

  async function runExecution(inputs, identity, reason, trigger) {
    const startedAt = new Date().toISOString();
    startActivity(identity);
    emitStatus({stage: "PROJECTION_PROCESS_STARTED", state: "running", phase: "process", reason, trigger, current_story_time: inputs.currentStoryTime ?? null, ...identity, started_at: startedAt});
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
        ? await resolvePreConfirmationTiming({inputs, views, execution: identity})
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
          return {status: "stale", execution_id: identity.execution_id, results: [result]};
        }
        if (result.status !== "generated") {
          partial = true;
          errors.push({decision: decisionKey(decision), reason: result.reason_code, errors: result.errors ?? []});
          continue;
        }
        if (!(await currentInputsMatch(identity.execution_id))) {
          emitStatus({state: "stale", phase: "before_persistence", reason, ...identity, started_at: startedAt});
          return {status: "stale", execution_id: identity.execution_id, results: [result]};
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
        } catch (error) {
          partial = true;
          errors.push({decision: decisionKey(decision), reason: error?.code ?? error?.message ?? "persistence_failed"});
        }
      }
      const finalViews = await getProjectionViews({chatId: identity.chat_id, endpointFloor: identity.floor_version.floor});
      const dto = dtoFromViews(finalViews);
      await refreshProjectionContext?.({chatId: identity.chat_id});
      const status = partial ? "partial" : "success";
      emitStatus({stage: "PROJECTION_READBACK", state: status, phase: "readback", reason, trigger, ...projectionViewDiagnostics(finalViews), projection_contribution_count: projectionViewDiagnostics(finalViews).context_visible_projection_count, ...identity, started_at: startedAt, finished_at: new Date().toISOString(), errors});
      finishActivity(identity, status, errors[0]);
      return {status, execution_id: identity.execution_id, ...dto, errors};
    } catch (error) {
      emitStatus({stage: "PROJECTION_PROCESS_FAILED", state: "failed", phase: "projection", reason, trigger, ...identity, started_at: startedAt, finished_at: new Date().toISOString(), error_code: error?.code ?? error?.message ?? "PROJECTION_FAILED"});
      finishActivity(identity, "failed", error);
      return {status: "failed", execution_id: identity.execution_id, errors: [{reason: error?.code ?? error?.message ?? "PROJECTION_FAILED"}]};
    }
  }

  async function process({reason = "projection-refresh", trigger = "projection-refresh"} = {}) {
    if (destroyed) return {status: "destroyed"};
    if (enabledResolver() === false) return {status: "disabled"};
    const inputs = await collectInputs();
    if (!inputs?.floor?.version || inputs.currentStateStatus === "STATE_ERROR") return {status: "unavailable"};
    const execution_id = await executionIdentity(inputs);
    if (inFlight.has(execution_id)) return inFlight.get(execution_id);
    const identity = {
      execution_id,
      chat_id: inputs.floor.version.chat_id,
      floor_version: inputs.floor.version,
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
    destroy,
  };
}

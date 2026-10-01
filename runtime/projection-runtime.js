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

  async function runExecution(inputs, identity, reason) {
    const startedAt = new Date().toISOString();
    startActivity(identity);
    emitStatus({state: "running", phase: "evolution", reason, ...identity, started_at: startedAt});
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
      if (eligibility.diagnostics?.some(item => item.code === "projection_rule_conflict")) {
        throw Object.assign(new Error("PROJECTION_ELIGIBILITY_FAILED"), {code: "PROJECTION_ELIGIBILITY_FAILED"});
      }

      emitStatus({state: "running", phase: "generation", reason, ...identity, started_at: startedAt});
      for (const decision of eligibility.decisions.filter(item => item.eligibility === "eligible" && !item.existing_projection_id)) {
        const rule = ruleByKey.get(`${decision.projection_rule_id}\u001f${decision.development_concern_key}`);
        if (!rule) {
          partial = true;
          errors.push({decision: decisionKey(decision), reason: "projection_rule_missing"});
          continue;
        }
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
      emitStatus({state: status, phase: "readback", reason, ...identity, started_at: startedAt, finished_at: new Date().toISOString(), errors});
      finishActivity(identity, status, errors[0]);
      return {status, execution_id: identity.execution_id, ...dto, errors};
    } catch (error) {
      emitStatus({state: "failed", phase: "projection", reason, ...identity, started_at: startedAt, finished_at: new Date().toISOString(), error_code: error?.code ?? error?.message ?? "PROJECTION_FAILED"});
      finishActivity(identity, "failed", error);
      return {status: "failed", execution_id: identity.execution_id, errors: [{reason: error?.code ?? error?.message ?? "PROJECTION_FAILED"}]};
    }
  }

  async function process({reason = "projection-refresh"} = {}) {
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
    const promise = runExecution(inputs, identity, reason).finally(() => inFlight.delete(execution_id));
    inFlight.set(execution_id, promise);
    return promise;
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
    refreshProjection: () => process({reason: "projection-refresh"}),
    getBusinessData,
    deleteProjection,
    destroy,
  };
}

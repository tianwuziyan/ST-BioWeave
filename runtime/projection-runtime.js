import {buildBuiltInPreConfirmationRules, builtInPreConfirmationBranchForConcern, builtInPreConfirmationStageCodeForConcern, evaluateProjectionEligibility, evaluateProjectionEvolution, getBuiltInPreConfirmationSchedule, isLegacyBuiltInPreConfirmationProjection, matchBuiltInObservedReaction, normalizeProjectionRules, resolveBuiltInPreConfirmationStageCode} from "../core/projection-eligibility.js";
import {createProjectionObservationRecord, resolveProjectionObservationRecords} from '../core/projection.js';
import {generateProjectionCandidate} from "../core/projection-generation.js";
import {hashText, sameFloorVersion} from "./floor.js";
import {differenceStoryTime} from "../story/time.js";
import {pregnancyIdentityMatches} from "../core/pregnancy-lifecycle.js";
import {isParticipantAggregationEvidenceComplete} from "../core/participant-aggregation.js";

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
    const status = payload.status ?? (['pregnancy_confirmation', 'pregnancy_loss', 'abortion', 'delivery'].includes(event?.type) ? event.type : null);
    return cycleId === identity.cycle_id
      && pregnancyIdentityMatches({
        subjectId: identity.subject_id,
        pregnancyId: identity.pregnancy_id ?? null,
        candidateSubjectId: subjectId,
        candidatePregnancyId: pregnancyId,
        candidateStatus: status,
        allowObservationPromotion: identity.pregnancy_id == null,
      })
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

function safeObservationFloorVersion(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const scalar = item => typeof item === 'string'
    ? item.slice(0, 160)
    : (typeof item === 'number' || typeof item === 'boolean') && Number.isFinite(item) ? item : null;
  return Object.fromEntries(['chat_id', 'message_id', 'floor', 'message_index', 'swipe_id', 'content_hash', 'message_version']
    .map(field => [field, scalar(value[field])]));
}

function safeObservationRecords(records = []) {
  return resolveProjectionObservationRecords(records).slice(-16).map(record => ({
    action: record.action ?? null,
    reaction_concept: record.reaction_concept ?? null,
    event_ids: Array.isArray(record.event_ids) ? [...record.event_ids].slice(0, 32) : [],
    owner_floor_version: safeObservationFloorVersion(record.created_at_floor_version),
  }));
}

function safeTriggeredSnapshots(snapshots = []) {
  return (Array.isArray(snapshots) ? snapshots : []).slice(-100).map(snapshot => ({
    subject_id: typeof snapshot?.subject_id === 'string' ? snapshot.subject_id.slice(0, 160) : null,
    status: ['active', 'terminated'].includes(snapshot?.status) ? snapshot.status : null,
    stage_code: typeof snapshot?.stage_code === 'string' && /^\d+-\d+$/.test(snapshot.stage_code) ? snapshot.stage_code : null,
    snapshot_created_floor: Number.isFinite(Number(snapshot?.created_at_floor_version?.floor))
      ? Number(snapshot.created_at_floor_version.floor)
      : null,
    triggered_count: Array.isArray(snapshot?.triggered) ? snapshot.triggered.length : 0,
    triggered: (Array.isArray(snapshot?.triggered) ? snapshot.triggered : []).slice(0, 100).map(item => ({
      projection_id: typeof item?.projection_id === 'string' ? item.projection_id.slice(0, 160) : null,
      reaction_concept: typeof item?.reaction_concept === 'string' ? item.reaction_concept.slice(0, 160) : null,
      event_ids: Array.isArray(item?.event_ids)
        ? item.event_ids.filter(value => typeof value === 'string').slice(0, 32).map(value => value.slice(0, 160))
        : [],
    })),
  }));
}

function safeTriggeredSnapshotSubjectSummaries(summaries = []) {
  return (Array.isArray(summaries) ? summaries : []).slice(0, 100).map(item => ({
    subject_id: typeof item?.subject_id === 'string' ? item.subject_id.slice(0, 160) : null,
    nearest_snapshot_found: item?.nearest_snapshot_found === true,
    nearest_snapshot_floor: Number.isFinite(Number(item?.nearest_snapshot_floor)) ? Number(item.nearest_snapshot_floor) : null,
    nearest_snapshot_status: ['active', 'terminated'].includes(item?.nearest_snapshot_status) ? item.nearest_snapshot_status : null,
    nearest_snapshot_stage_code: typeof item?.nearest_snapshot_stage_code === 'string' && /^\d+-\d+$/.test(item.nearest_snapshot_stage_code) ? item.nearest_snapshot_stage_code : null,
    nearest_snapshot_triggered_count: Number.isFinite(Number(item?.nearest_snapshot_triggered_count)) ? Math.max(0, Number(item.nearest_snapshot_triggered_count)) : 0,
    current_candidate_count: Number.isFinite(Number(item?.current_candidate_count)) ? Math.max(0, Number(item.current_candidate_count)) : 0,
    current_new_match_count: Number.isFinite(Number(item?.current_new_match_count)) ? Math.max(0, Number(item.current_new_match_count)) : 0,
    inherited_count: Number.isFinite(Number(item?.inherited_count)) ? Math.max(0, Number(item.inherited_count)) : 0,
    new_count: Number.isFinite(Number(item?.new_count)) ? Math.max(0, Number(item.new_count)) : 0,
    final_count: Number.isFinite(Number(item?.final_count)) ? Math.max(0, Number(item.final_count)) : 0,
    reason_code: typeof item?.reason_code === 'string' ? item.reason_code.slice(0, 160) : null,
    write_status: typeof item?.write_status === 'string' ? item.write_status.slice(0, 40) : null,
    readback_status: typeof item?.readback_status === 'string' ? item.readback_status.slice(0, 40) : null,
    readback_count: Number.isFinite(Number(item?.readback_count)) ? Math.max(0, Number(item.readback_count)) : null,
    expected_status: ['active', 'terminated'].includes(item?.expected_status) ? item.expected_status : null,
    expected_count: Number.isFinite(Number(item?.expected_count)) ? Math.max(0, Number(item.expected_count)) : null,
    readback_snapshot_status: ['active', 'terminated'].includes(item?.readback_snapshot_status) ? item.readback_snapshot_status : null,
  }));
}

function safeStorylineSnapshots(snapshots = []) {
  return (Array.isArray(snapshots) ? snapshots : [])
    .slice(0, 100)
    .map(snapshot => {
      const status = ['candidates', 'selected', 'terminated'].includes(snapshot?.status)
        ? snapshot.status
        : null;
      const subjectId = typeof snapshot?.subject_id === 'string' ? snapshot.subject_id.trim().slice(0, 160) : '';
      if (!status || !subjectId) return null;
      return {
        subject_id: subjectId,
        display_name: typeof snapshot?.display_name === 'string' ? snapshot.display_name.trim().slice(0, 160) : null,
        status,
        current_node_index: Number.isInteger(snapshot?.current_node_index) ? Math.max(0, snapshot.current_node_index) : 0,
        branches: (Array.isArray(snapshot?.branches) ? snapshot.branches : []).slice(0, 3).map(branch => {
          const legacyConclusionGoal = typeof branch?.conclusion_goal === 'string' ? branch.conclusion_goal.trim().slice(0, 1000) : '';
          return {
            title: typeof branch?.title === 'string' ? branch.title.trim().slice(0, 500) : '',
            premise: typeof branch?.premise === 'string' ? branch.premise.trim().slice(0, 1200) : '',
            nodes: (Array.isArray(branch?.nodes) ? branch.nodes : []).slice(0, 5).map(node => ({
              title: typeof node?.title === 'string' ? node.title.trim().slice(0, 300) : '',
              objective: typeof node?.objective === 'string' ? node.objective.trim().slice(0, 800) : '',
              completion_signal: typeof node?.completion_signal === 'string' ? node.completion_signal.trim().slice(0, 800) : '',
              conclusion_goal: typeof node?.conclusion_goal === 'string' && node.conclusion_goal.trim()
                ? node.conclusion_goal.trim().slice(0, 1000)
                : legacyConclusionGoal,
            })),
          };
        }),
      };
    })
    .filter(Boolean);
}

function aggregatedCandidateCount(view) {
  const evidence = view?.aggregation_evidence;
  if (!isParticipantAggregationEvidenceComplete(evidence)) return null;
  return new Set(evidence.participant_exposure_mapping.map(item => item.participant_id)).size;
}

function requiresParticipantAggregation(view) {
  return view?.tracking_scope === 'pre_confirmation' || view?.aggregation_path === 'participant_aggregation';
}

function isBuiltInStageProjection(view) {
  return view?.tracking_scope === 'pre_confirmation'
    && view?.aggregation_path === 'participant_aggregation'
    && Boolean(builtInPreConfirmationBranchForConcern(view?.development_concern_key));
}

function isObservedReactionProjection(view) {
  return view?.tracking_scope === 'pre_confirmation';
}

function toProjectionDTO(view, observedReaction = null, currentStoryTime = null) {
  if (!view || typeof view !== "object") return null;
  if (requiresParticipantAggregation(view) && !isParticipantAggregationEvidenceComplete(view.aggregation_evidence)) return null;
  const builtInBranch = builtInPreConfirmationBranchForConcern(view.development_concern_key);
  const currentStageCode = builtInBranch
    ? resolveBuiltInPreConfirmationStageCode({
      currentStoryTime,
      referenceStoryTime: view.timing?.reference_story_time,
    })
    : null;
  const currentStage = currentStageCode
    ? getBuiltInPreConfirmationSchedule().find(stage => builtInPreConfirmationStageCodeForConcern(`pre_confirmation_observation:${stage.branches[0]?.key}`) === currentStageCode)
    : null;
  return {
    id: view.projection_id,
    subject: {id: view.subject_id},
    rule: {
      id: view.projection_rule_id,
      concern_key: view.development_concern_key,
      ...(builtInBranch ? {
        label: builtInBranch.label,
        description: builtInBranch.description,
        observation_stage: {
          key: builtInBranch.stage_key,
          label: builtInBranch.stage_label,
          phase: builtInBranch.stage_phase,
          min_elapsed_story_days: builtInBranch.min_elapsed_story_days,
          max_elapsed_story_days: builtInBranch.max_elapsed_story_days,
        },
        min_elapsed_story_days: builtInBranch.min_elapsed_story_days,
        max_elapsed_story_days: builtInBranch.max_elapsed_story_days,
      } : {}),
    },
    concern_key: view.development_concern_key,
    aggregated_candidate_count: aggregatedCandidateCount(view),
    status: viewStatus(view),
    generated_statement: view.development?.next_signal ?? "",
    development_kind: view.development?.kind ?? null,
    source_refs: [...(view.source_event_ids ?? [])],
    timing: {
      reference_story_time: view.timing?.reference_story_time ?? null,
      current_story_time: currentStoryTime ?? view.timing?.current_story_time ?? null,
      ...(builtInBranch
        ? {
          observation_stage_key: currentStage?.key ?? builtInBranch.stage_key,
          observation_stage_code: currentStageCode ?? builtInPreConfirmationStageCodeForConcern(view.development_concern_key),
        }
        : {}),
    },
    created_story_time: view.timing?.current_story_time ?? view.timing?.reference_story_time ?? null,
    lifecycle: {
      factual_status: view.factual_status ?? "active",
      deleted: view.deleted === true,
    },
    ...(isObservedReactionProjection(view) ? {
      observed_reaction: {matched: observedReaction?.matched === true},
    } : {}),
    ...(view.confidence !== undefined ? {confidence: view.confidence} : {}),
    ...(view.uncertainty !== undefined ? {uncertainty: view.uncertainty} : {}),
  };
}

function dtoFromViews(views, {events = [], snapshotValid = false, includeDebug = false, currentStoryTime = null} = {}) {
  const all = Array.isArray(views?.all) ? views.all : [];
  const snapshots = Array.isArray(views?.triggered_snapshots) ? views.triggered_snapshots : [];
  const storylineSnapshots = safeStorylineSnapshots(views?.storyline_snapshots);
  const snapshotBySubject = new Map(snapshots
    .filter(snapshot => snapshot?.subject_id)
    .map(snapshot => [snapshot.subject_id, snapshot]));
  const observed = new Map();
  const observedDebug = [];
  for (const view of all) {
    if (!isObservedReactionProjection(view)) continue;
    const result = snapshotValid
      ? matchBuiltInObservedReaction({projectionView: view, events})
      : {matched: false, matched_event_ids: [], matched_kind: null, reason_code: 'SOURCE_SNAPSHOT_UNAVAILABLE'};
    const resolvedPersistedRecords = resolveProjectionObservationRecords(view.observation_records ?? []);
    const persistedRecords = safeObservationRecords(resolvedPersistedRecords);
    const latestPersisted = result.projection_concept
      ? resolvedPersistedRecords.find(record => record.reaction_concept === result.projection_concept) ?? null
      : null;
    const snapshot = snapshotBySubject.get(view.subject_id);
    const snapshotItem = snapshot?.status === 'active'
      ? snapshot.triggered?.find(item => item.projection_id === view.projection_id
        && item.reaction_concept === result.projection_concept) ?? null
      : null;
    const snapshotMatched = snapshot?.status === 'active' && Boolean(snapshotItem);
    const legacyMatched = !snapshot && latestPersisted?.action === 'triggered';
    const finalMatched = result.matched === true || snapshotMatched === true || legacyMatched;
    observed.set(view.projection_id, {...result, matched: finalMatched});
    if (includeDebug) {
      observedDebug.push({
        subject_id: view.subject_id ?? null,
        projection_id: view.projection_id ?? null,
        projection_concern_key: view.development_concern_key ?? null,
        matched: finalMatched,
        projection_concept: result.projection_concept ?? null,
        event_concepts: result.event_concepts ?? [],
        match_mode: result.match_mode ?? null,
        symptom_kind: result.matched_kind,
        matched_event_ids: result.matched_event_ids,
        reason_code: result.reason_code,
        stage_key: builtInPreConfirmationBranchForConcern(view.development_concern_key)?.stage_key ?? null,
        source_type: 'CURRENT_DERIVED',
        recognition: {
          matched: result.matched === true,
          projection_concept: result.projection_concept ?? null,
          event_concepts: result.event_concepts ?? [],
          match_mode: result.match_mode ?? null,
          reason_code: result.reason_code ?? null,
          matched_event_ids: result.matched_event_ids ?? [],
        },
        persisted: {
          latest_action: latestPersisted?.action ?? null,
          records: persistedRecords,
          triggered_snapshot: snapshot ? {
            present: true,
            status: snapshot.status ?? null,
            stage_code: snapshot.stage_code ?? null,
            snapshot_created_floor: Number.isFinite(Number(snapshot.created_at_floor_version?.floor))
              ? Number(snapshot.created_at_floor_version.floor)
              : null,
            matched: snapshotMatched,
            event_ids: snapshotItem?.event_ids ?? [],
          } : {
            present: false,
            status: null,
            snapshot_created_floor: null,
            matched: false,
            event_ids: [],
          },
          source: snapshotMatched
            ? 'CURRENT_FLOOR_TRIGGERED_SNAPSHOT'
            : latestPersisted?.action === 'triggered'
              ? 'LEGACY_OBSERVATION_FALLBACK'
              : null,
          status_code: snapshotMatched
            ? 'TRIGGERED_SNAPSHOT_MATCH'
            : snapshot
              ? 'TRIGGERED_SNAPSHOT_PRESENT_NOT_MATCHED'
              : latestPersisted?.action === 'triggered'
                ? 'RELEVANT_OBSERVATION_RECORD_READ'
                : latestPersisted
                  ? 'RELEVANT_OBSERVATION_RECORD_READ'
                  : 'NO_RELEVANT_OBSERVATION_RECORD',
        },
        final_usage: {
          product: {
            included: finalMatched,
            status_code: snapshotMatched
              ? 'PRODUCT_BADGE_MATCHED_FROM_TRIGGERED_SNAPSHOT'
              : finalMatched ? 'PRODUCT_BADGE_MATCHED' : 'PRODUCT_BADGE_NOT_MATCHED',
            source: snapshotMatched
              ? 'CURRENT_FLOOR_TRIGGERED_SNAPSHOT'
              : legacyMatched
                ? 'LEGACY_OBSERVATION_FALLBACK'
                : result.matched === true ? 'CURRENT_DERIVED' : null,
          },
          history: {
            included: false,
            source: snapshot ? 'CURRENT_FLOOR_TRIGGERED_SNAPSHOT' : latestPersisted ? 'LEGACY_OBSERVATION_FALLBACK' : null,
            status_code: snapshot ? 'HISTORY_RESOLVED_FROM_CURRENT_FLOOR_TRIGGERED_SNAPSHOT' : latestPersisted ? 'HISTORY_RESOLVED_AFTER_LEGACY_OBSERVATION_FALLBACK' : 'HISTORY_NOT_AVAILABLE',
          },
          context: {
            included: false,
            eligible: view.context_visible === true,
            status_code: view.context_visible === true ? 'CONTEXT_ELIGIBILITY_ONLY' : 'CONTEXT_NOT_ELIGIBLE',
          },
        },
      });
    }
  }
  const projections = all.map(view => toProjectionDTO(view, observed.get(view.projection_id), currentStoryTime)).filter(Boolean);
  const active = projections.filter(item => item.status === "active");
  const hasBuiltInProjection = projections.some(item => builtInPreConfirmationBranchForConcern(item.concern_key));
  const currentIds = new Set(all.map(view => view.projection_id));
  const currentObservationSubjects = new Set(all
    .filter(view => {
      if (!builtInPreConfirmationBranchForConcern(view?.development_concern_key)) return false;
      const elapsed = currentStoryTime && view?.timing?.reference_story_time
        ? differenceStoryTime(currentStoryTime, view.timing.reference_story_time)
        : null;
      const elapsedDays = elapsed?.unit === 'minute' ? Number(elapsed.value) / 1440 : Number(elapsed?.value);
      return Number.isFinite(elapsedDays) && elapsedDays >= 14 && elapsedDays <= 42;
    })
    .map(view => view.subject_id)
    .filter(Boolean));
  const historical = new Map();
  const legacyHistoricalRecords = resolveProjectionObservationRecords(views?.observation_records ?? []);
  const historicalRecords = [...snapshotBySubject.values()].flatMap(snapshot => snapshot.status === 'active'
    ? (snapshot.triggered ?? []).map(item => ({...item, subject_id: snapshot.subject_id, action: 'triggered', history_source: 'CURRENT_FLOOR_TRIGGERED_SNAPSHOT'}))
    : []).concat(legacyHistoricalRecords
      .filter(record => !snapshotBySubject.has(record?.subject_id))
      .map(record => ({...record, history_source: 'LEGACY_OBSERVATION_FALLBACK'})));
  for (const record of historicalRecords) {
    const reactionLabel = builtInPreConfirmationBranchForConcern(`pre_confirmation_observation:${record.reaction_concept}`)?.label;
    if (record.action !== 'triggered' || !currentObservationSubjects.has(record.subject_id) || currentIds.has(record.projection_id) || !record.subject_id || !reactionLabel) continue;
    historical.set(`${record.subject_id}\u001f${record.reaction_concept}`, {
      subject_id: record.subject_id,
      reaction_concept: record.reaction_concept,
      reaction_label: reactionLabel,
      projection_id: record.projection_id,
      history_source: record.history_source ?? 'LEGACY_OBSERVATION_FALLBACK',
    });
  }
  if (includeDebug) {
    for (const item of observedDebug) {
      const historicalItem = historical.get(`${item.subject_id}\u001f${item.projection_concept}`) ?? null;
      const historicalIncluded = Boolean(historicalItem);
      item.final_usage.history = {
        included: historicalIncluded,
        source: historicalItem?.history_source ?? item.final_usage.history.source ?? null,
        status_code: historicalIncluded
          ? historicalItem?.history_source === 'CURRENT_FLOOR_TRIGGERED_SNAPSHOT'
            ? 'HISTORY_TRIGGERED_INCLUDED_FROM_CURRENT_FLOOR_TRIGGERED_SNAPSHOT'
            : 'HISTORY_TRIGGERED_INCLUDED_FROM_LEGACY_OBSERVATION_FALLBACK'
          : item.final_usage.history.source
            ? item.final_usage.history.source === 'CURRENT_FLOOR_TRIGGERED_SNAPSHOT'
              ? 'HISTORY_NOT_INCLUDED_CURRENT_PROJECTION_FROM_TRIGGERED_SNAPSHOT'
              : 'HISTORY_NOT_INCLUDED_CURRENT_PROJECTION_FROM_LEGACY_OBSERVATION_FALLBACK'
            : 'HISTORY_NOT_INCLUDED',
      };
    }
  }
  const historicalDebug = [...historical.values()].slice(0, 100).map(item => ({
    subject_id: item.subject_id,
    reaction_concept: item.reaction_concept,
    reaction_label: item.reaction_label,
    projection_id: item.projection_id,
  }));
  return {
    projections,
    storyline_snapshots: storylineSnapshots,
    projection_summary: {
      active_count: active.length,
      recent: projections.slice(-3),
      historical_observed_reactions: [...historical.values()],
      ...(hasBuiltInProjection ? {observation_schedule: getBuiltInPreConfirmationSchedule()} : {}),
    },
    ...(includeDebug ? {
      projection_observed_reaction_debug: observedDebug.slice(0, 100),
      projection_observed_reaction_history: historicalDebug,
      projection_triggered_snapshots: safeTriggeredSnapshots(snapshots),
    } : {}),
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
    effective_min_story_days: decision.effective_min_story_days ?? instance?.effective_min_story_days ?? null,
    effective_max_story_days: decision.effective_max_story_days ?? instance?.effective_max_story_days ?? null,
    timing_state: decision.timing_status ?? null,
    timing_transition: decision.timing_status === 'window_open'
      ? decision.existing_projection_id ? 'window_open_existing_projection' : 'window_open_without_existing_projection'
      : null,
    compatible_exposure_count: exposureIds.length,
    compatible_exposure_event_ids: [...exposureIds].sort(),
    multiple_compatible_exposures: exposureIds.length > 1,
    aggregation_evidence_invalid_event_ids: decision.aggregation_evidence_invalid_event_ids ?? [],
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
  saveProjectionBatch,
  ensureProjectionFloorOwner = null,
  saveEvolutionDecision,
  saveProjectionLifecycleBatch = null,
  saveProjectionObservationBatch = null,
  saveProjectionTriggeredSnapshotBatch = null,
  resolvePreConfirmationTiming = null,
  refreshProjectionContext = null,
  saveProjectionDeliveryResponseBatch = null,
  saveProjectionDeliveryResponse = null,
  getProjectionDeliveryRecords = null,
  archiveAndReleasePregnancy = null,
  diagnostics = null,
  notify = () => {},
  activity = null,
  storylineRuntime = null,
} = {}) {
  if (typeof collectInputs !== "function") throw new TypeError("PROJECTION_INPUTS_REQUIRED");
  if (typeof resolveCurrentFloor !== "function") throw new TypeError("PROJECTION_FLOOR_REQUIRED");
  if (typeof getProjectionViews !== "function") throw new TypeError("PROJECTION_VIEWS_REQUIRED");
  if (typeof saveProjectionBatch !== "function") throw new TypeError("PROJECTION_BATCH_SAVE_REQUIRED");
  if (typeof saveEvolutionDecision !== "function") throw new TypeError("PROJECTION_EVOLUTION_SAVE_REQUIRED");

  const inFlight = new Map();
  let completedAutomaticExecution = null;
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

  async function persistObservedReactions(views, inputs, identity, reason, trigger) {
    if (typeof saveProjectionObservationBatch !== 'function' || !inputs?.floor?.version) return {status: 'unsupported'};
    const records = [];
    const explicitRecompute = /event[-_](edit|delete)|manual[-_]event/i.test(`${reason} ${trigger}`);
    for (const view of views?.all ?? []) {
      if (view?.tracking_scope !== 'pre_confirmation' || view?.deleted || view?.factual_status !== 'active') continue;
      const result = matchBuiltInObservedReaction({projectionView: view, events: inputs.events ?? []});
      const currentByConcept = new Map(resolveProjectionObservationRecords(view.observation_records ?? []).map(record => [record.reaction_concept, record]));
      if (result.matched === true && result.projection_concept && result.matched_event_ids?.length) {
        const existing = currentByConcept.get(result.projection_concept);
        const currentEventIds = new Set(result.matched_event_ids);
        const existingEventIds = new Set(existing?.event_ids ?? []);
        const sameMatchedEvents = existing
          && currentEventIds.size === existingEventIds.size
          && [...currentEventIds].every(eventId => existingEventIds.has(eventId));
        if (sameMatchedEvents && !explicitRecompute) continue;
        records.push(createProjectionObservationRecord({projection_id: view.projection_id, subject_id: view.subject_id, action: 'triggered', reaction_concept: result.projection_concept, event_ids: result.matched_event_ids, created_at_floor_version: inputs.floor.version}));
      } else if (explicitRecompute && result.projection_concept) {
        const existing = currentByConcept.get(result.projection_concept);
        if (existing?.action === 'triggered') records.push(createProjectionObservationRecord({projection_id: view.projection_id, subject_id: view.subject_id, action: 'revoked', reaction_concept: result.projection_concept, event_ids: existing.event_ids, created_at_floor_version: inputs.floor.version}));
      }
    }
    if (!records.length) return {status: 'deduped', record_count: 0};
    const result = await saveProjectionObservationBatch({chatId: identity.chat_id, ownerFloor: floorOwner(inputs.floor), floorVersion: inputs.floor.version, records, traceContext: {reason, trigger}});
    return {...result, record_count: records.length};
  }

  async function persistTriggeredSnapshots(views, inputs, identity, reason, trigger) {
    const persistenceSupported = typeof saveProjectionTriggeredSnapshotBatch === 'function' && Boolean(inputs?.floor?.version);
    const prior = new Map((views?.triggered_snapshots ?? []).map(snapshot => [snapshot.subject_id, snapshot]));
    const builtInViewsById = new Map((views?.all ?? [])
      .filter(view => builtInPreConfirmationBranchForConcern(view?.development_concern_key))
      .map(view => [view.projection_id, view]));
    const stageCodeFromSnapshot = snapshot => {
      if (typeof snapshot?.stage_code === 'string' && /^\d+-\d+$/.test(snapshot.stage_code)) return snapshot.stage_code;
      const codes = new Set((snapshot?.triggered ?? [])
        .map(item => builtInPreConfirmationStageCodeForConcern(builtInViewsById.get(item?.projection_id)?.development_concern_key))
        .filter(Boolean));
      return codes.size === 1 ? [...codes][0] : null;
    };
    const triggeredBySubject = new Map();
    const currentProjectionIdsBySubject = new Map();
    const explicitRecompute = /event[-_](edit|delete)|manual[-_]event/i.test(`${reason} ${trigger}`);
    const add = (subjectId, item) => {
      if (!subjectId || !item?.projection_id || !item?.reaction_concept) return;
      if (!triggeredBySubject.has(subjectId)) triggeredBySubject.set(subjectId, new Map());
      triggeredBySubject.get(subjectId).set(`${item.projection_id}\u001f${item.reaction_concept}`, {
        projection_id: item.projection_id,
        reaction_concept: item.reaction_concept,
        event_ids: [...new Set(item.event_ids ?? [])].sort(),
      });
    };
    for (const snapshot of prior.values()) {
      if (snapshot.status === 'active') for (const item of snapshot.triggered ?? []) add(snapshot.subject_id, item);
    }
    for (const record of resolveProjectionObservationRecords(views?.observation_records ?? [])) {
      if (record.action === 'triggered' && !prior.has(record.subject_id)) add(record.subject_id, record);
    }
    const activeSubjects = new Set();
    const matchedBySubject = new Map();
    const currentStageCodeBySubject = new Map();
    for (const view of views?.all ?? []) {
      if (!isObservedReactionProjection(view) || view.deleted || view.factual_status !== 'active') continue;
      activeSubjects.add(view.subject_id);
      const stageCode = resolveBuiltInPreConfirmationStageCode({
        currentStoryTime: inputs.currentStoryTime,
        referenceStoryTime: view?.timing?.reference_story_time,
      });
      if (stageCode && !currentStageCodeBySubject.has(view.subject_id)) currentStageCodeBySubject.set(view.subject_id, stageCode);
      if (!currentProjectionIdsBySubject.has(view.subject_id)) currentProjectionIdsBySubject.set(view.subject_id, new Set());
      currentProjectionIdsBySubject.get(view.subject_id).add(view.projection_id);
      if (!matchedBySubject.has(view.subject_id)) matchedBySubject.set(view.subject_id, new Set());
      const result = matchBuiltInObservedReaction({projectionView: view, events: inputs.events ?? []});
      if (result.matched === true && result.projection_concept && result.matched_event_ids?.length) {
        matchedBySubject.get(view.subject_id).add(`${view.projection_id}\u001f${result.projection_concept}`);
        add(view.subject_id, {projection_id: view.projection_id, reaction_concept: result.projection_concept, event_ids: result.matched_event_ids});
      }
    }
    // A complete Floor snapshot contains an explicit empty entry for every
    // currently observed subject. Without this seed, a subject with no new
    // match would be omitted and later reads could incorrectly inherit it
    // from an older Floor.
    for (const subjectId of activeSubjects) {
      if (!triggeredBySubject.has(subjectId)) triggeredBySubject.set(subjectId, new Map());
    }
    const snapshots = [];
    const subjectSummaries = [];
    for (const [subjectId, items] of triggeredBySubject) {
      const previous = prior.get(subjectId);
      const previousStageCode = stageCodeFromSnapshot(previous);
      const currentStageCode = currentStageCodeBySubject.get(subjectId) ?? null;
      const snapshotStageCode = currentStageCode ?? previousStageCode;
      const currentIds = currentProjectionIdsBySubject.get(subjectId) ?? new Set();
      const matched = matchedBySubject.get(subjectId) ?? new Set();
      if (explicitRecompute) {
        for (const item of [...items.values()]) {
          if (currentIds.has(item.projection_id) && !matched.has(`${item.projection_id}\u001f${item.reaction_concept}`)) {
            items.delete(`${item.projection_id}\u001f${item.reaction_concept}`);
          }
        }
      }
      const currentStageFloors = [...(views?.all ?? [])]
        .filter(view => view?.subject_id === subjectId && currentIds.has(view.projection_id))
        .map(view => Number(view?.created_at_floor_version?.floor))
        .filter(Number.isFinite);
      const currentStageFloor = currentStageFloors.length ? Math.max(...currentStageFloors) : null;
      const previousSnapshotFloor = Number(previous?.created_at_floor_version?.floor);
      const currentStageChanged = previous?.status === 'active' && currentStageCode !== null && previousStageCode !== null
        ? currentStageCode !== previousStageCode
        : previous?.status === 'active' && currentStageFloor !== null && Number.isFinite(previousSnapshotFloor)
          ? currentStageFloor > previousSnapshotFloor
          : false;
      const samePayload = previous?.status === 'active'
        ? (currentStageCode === null || previousStageCode === null || previousStageCode === currentStageCode)
          && JSON.stringify(previous.triggered ?? []) === JSON.stringify([...items.values()])
        // A brand-new subject with no match has no state transition to save.
        // Once a complete snapshot exists, the storage boundary writes the
        // explicit empty subject entry as part of the next changed batch.
        : items.size === 0;
      const observationEnded = [...(views?.all ?? [])].some(view => {
        if (view?.subject_id !== subjectId || !builtInPreConfirmationBranchForConcern(view?.development_concern_key)) return false;
        const elapsed = inputs.currentStoryTime && view?.timing?.reference_story_time
          ? differenceStoryTime(inputs.currentStoryTime, view.timing.reference_story_time)
          : null;
        return elapsed?.unit === 'day' && Number(elapsed.value) > 42;
      });
      const restartsAfterTermination = previous?.status === 'terminated'
        && currentStageFloor !== null
        && Number.isFinite(previousSnapshotFloor)
        && currentStageFloor > previousSnapshotFloor
        && !observationEnded;
      if (!activeSubjects.has(subjectId) && !observationEnded) continue;
      if (previous?.status === 'terminated' && !restartsAfterTermination) continue;
      if (observationEnded && previous?.status === 'active') snapshots.push({subject_id: subjectId, status: 'terminated', stage_code: snapshotStageCode, triggered: []});
      else if (activeSubjects.has(subjectId) && (currentStageChanged || explicitRecompute || !samePayload)) {
        snapshots.push({subject_id: subjectId, status: 'active', stage_code: snapshotStageCode, triggered: [...items.values()]});
      }
    }
    const snapshotBySubject = new Map(snapshots.map(snapshot => [snapshot.subject_id, snapshot]));
    if (snapshots.length) {
      // Persist one complete subject batch whenever any subject changes. The
      // unchanged subjects are included explicitly so the current Floor is
      // self-contained and cannot fall back to a different subject's older
      // Floor snapshot.
      for (const subjectId of activeSubjects) {
        if (snapshotBySubject.has(subjectId)) continue;
        snapshots.push({
          subject_id: subjectId,
          status: 'active',
          stage_code: currentStageCodeBySubject.get(subjectId) ?? stageCodeFromSnapshot(prior.get(subjectId)),
          triggered: [...(triggeredBySubject.get(subjectId)?.values() ?? [])],
        });
      }
    }
    snapshots.sort((left, right) => String(left.subject_id).localeCompare(String(right.subject_id)));
    const summarySubjects = new Set([...activeSubjects, ...prior.keys(), ...triggeredBySubject.keys()]);
    for (const subjectId of summarySubjects) {
      const previous = prior.get(subjectId);
      const previousStageCode = stageCodeFromSnapshot(previous);
      const previousItems = previous?.status === 'active' ? (previous.triggered ?? []) : [];
      const previousKeys = new Set(previousItems.map(item => `${item.projection_id}\u001f${item.reaction_concept}`));
      const matchedKeys = matchedBySubject.get(subjectId) ?? new Set();
      const finalItems = snapshotBySubject.get(subjectId)?.triggered
        ?? [...(triggeredBySubject.get(subjectId)?.values() ?? [])];
      const finalKeys = new Set(finalItems.map(item => `${item.projection_id}\u001f${item.reaction_concept}`));
      const currentCandidateCount = currentProjectionIdsBySubject.get(subjectId)?.size ?? 0;
      const currentNewMatchCount = [...matchedKeys].filter(key => !previousKeys.has(key)).length;
      const inheritedCount = [...finalKeys].filter(key => previousKeys.has(key)).length;
      const newCount = [...finalKeys].filter(key => !previousKeys.has(key)).length;
      const observationEnded = snapshotBySubject.get(subjectId)?.status === 'terminated';
      let reasonCode;
      if (!persistenceSupported) reasonCode = 'PERSISTENCE_UNSUPPORTED';
      else if (!previous && currentNewMatchCount === 0 && finalItems.length === 0) reasonCode = 'NO_PRIOR_SNAPSHOT_AND_NO_NEW_MATCH';
      else if (observationEnded) reasonCode = 'OBSERVATION_TERMINATED';
      else if (!currentNewMatchCount && inheritedCount) reasonCode = 'CARRIED_PRIOR_SNAPSHOT';
      else if (!finalItems.length) reasonCode = previous ? 'NO_NEW_MATCH' : 'NO_TRIGGERED_ITEMS';
      else reasonCode = 'SNAPSHOT_READY';
      subjectSummaries.push({
        subject_id: subjectId,
        nearest_snapshot_found: Boolean(previous),
        nearest_snapshot_floor: Number.isFinite(Number(previous?.created_at_floor_version?.floor)) ? Number(previous.created_at_floor_version.floor) : null,
        nearest_snapshot_status: previous?.status ?? null,
        nearest_snapshot_stage_code: previousStageCode,
        nearest_snapshot_triggered_count: previousItems.length,
        current_candidate_count: currentCandidateCount,
        current_new_match_count: currentNewMatchCount,
        inherited_count: inheritedCount,
        new_count: newCount,
        final_count: finalItems.length,
        expected_status: snapshotBySubject.get(subjectId)?.status ?? 'active',
        reason_code: reasonCode,
      });
    }
    const safeSummaries = safeTriggeredSnapshotSubjectSummaries(subjectSummaries);
    if (!persistenceSupported) return {status: 'unsupported', reason_code: 'PERSISTENCE_UNSUPPORTED', snapshot_count: 0, subject_summaries: safeSummaries};
    if (!snapshots.length) return {status: 'deduped', reason_code: 'NO_SNAPSHOT_CHANGE', snapshot_count: 0, subject_summaries: safeSummaries};
    try {
      const result = await saveProjectionTriggeredSnapshotBatch({chatId: identity.chat_id, ownerFloor: floorOwner(inputs.floor), floorVersion: inputs.floor.version, snapshots, traceContext: {reason, trigger}});
      return {...result, snapshot_count: snapshots.length, subject_summaries: safeSummaries};
    } catch (error) {
      try {
        if (error && typeof error === 'object') {
          error.projection_triggered_snapshot_subject_summaries = safeSummaries;
          error.projection_triggered_snapshot_snapshot_count = snapshots.length;
        }
      } catch {
        // Diagnostic enrichment is fail-open and must not replace the write error.
      }
      throw error;
    }
  }

  function emitStatus(payload) {
    notify({
      type: "PROJECTION_ANALYSIS_STATUS_CHANGED",
      payload,
      chatId: payload?.chat_id ?? getChatId?.(),
    });
  }

  function builtInStageStatus(items = []) {
    const candidates = (Array.isArray(items) ? items : [])
      .map(item => item?.projectionCandidate ?? item)
      .filter(isBuiltInStageProjection)
    return {
      subject_count: new Set(candidates.map(item => item.subject_id).filter(Boolean)).size,
      stage_keys: [...new Set(candidates
        .map(item => builtInPreConfirmationBranchForConcern(item.development_concern_key)?.stage_key)
        .filter(Boolean))].sort(),
      candidate_count: candidates.length,
    }
  }

  function completeBuiltInStageKeys(items = []) {
    const groups = new Map()
    for (const item of (Array.isArray(items) ? items : [])) {
      const candidate = item?.projectionCandidate ?? item
      if (!isBuiltInStageProjection(candidate)) continue
      const branch = builtInPreConfirmationBranchForConcern(candidate.development_concern_key)
      const evidence = candidate.aggregation_evidence
      const key = JSON.stringify([
        candidate.subject_id,
        evidence?.pregnancy_id ?? null,
        evidence?.cycle_id ?? null,
        candidate.mechanism?.key ?? null,
        branch?.stage_key ?? null,
      ])
      if (!groups.has(key)) groups.set(key, new Set())
      groups.get(key).add(branch?.key ?? null)
    }
    return new Set([...groups.entries()]
      .filter(([, branches]) => branches.size === 4)
      .map(([key]) => key))
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

  function startAutomaticPerformance(payload = {}) {
    try { return diagnostics?.startAutomaticProjectionRun?.(payload) ?? null; } catch { return null; }
  }

  function recordAutomaticPerformanceStage(payload = {}) {
    try { diagnostics?.recordAutomaticProjectionStage?.(payload); } catch { /* fail-open */ }
  }

  function finishAutomaticPerformance(payload = {}) {
    try { diagnostics?.finishAutomaticProjectionRun?.(payload); } catch { /* fail-open */ }
  }

  function performanceClock() {
    try { return typeof globalThis.performance?.now === 'function' ? globalThis.performance.now() : Date.now(); } catch { return Date.now(); }
  }

  async function measureAutomaticStage(runId, stage, callback, details = {}) {
    if (!runId) return callback();
    const started = performanceClock();
    try {
      const result = await callback();
      recordAutomaticPerformanceStage({run_id: runId, stage, status: 'SUCCEEDED', duration_ms: Math.max(0, Number((performanceClock() - started).toFixed(3))), ...details});
      return result;
    } catch (error) {
      recordAutomaticPerformanceStage({run_id: runId, stage, status: 'FAILED', duration_ms: Math.max(0, Number((performanceClock() - started).toFixed(3))), error_code: error?.code ?? error?.message ?? `${stage}_FAILED`, ...details});
      throw error;
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

  async function recordCompletedResponse({target, execution, inputs: suppliedInputs = null, deliveries: suppliedDeliveries = null} = {}) {
    const saveResponses = typeof saveProjectionDeliveryResponseBatch === 'function'
      ? async ({chatId, ownerFloor, floorVersion, records}) => saveProjectionDeliveryResponseBatch({chatId, ownerFloor, floorVersion, records})
      : typeof saveProjectionDeliveryResponse === 'function'
        ? async ({chatId, ownerFloor, floorVersion, records}) => {
          for (const deliveryRecord of records) {
            await saveProjectionDeliveryResponse({chatId, ownerFloor, floorVersion, deliveryRecord});
          }
        }
        : null;
    if (typeof getProjectionDeliveryRecords !== 'function' || !saveResponses) return {status: 'unsupported', observed: 0};
    const inputs = suppliedInputs ?? await collectInputs();
    const deliveries = Array.isArray(suppliedDeliveries)
      ? suppliedDeliveries
      : await getProjectionDeliveryRecords({chatId: target?.version?.chat_id, endpointFloor: target?.version?.floor, endpointIndex: target?.index});
    const existingResponseIds = new Set(deliveries.filter(item => item.response_id).map(item => item.response_id));
    const pendingDeliveries = deliveries.filter(item => item.status === 'readback_verified' && !item.response_id)
      .filter(delivery => deliveryIsBeforeResponse(delivery, target, execution));
    const responseIds = await Promise.all(pendingDeliveries.map(delivery =>
      hashText(JSON.stringify({delivery_id: delivery.delivery_id, response_floor_version: target.version}))));
    const records = [];
    for (const [index, delivery] of pendingDeliveries.entries()) {
      const responseId = `projection_response_${responseIds[index]}`;
      if (existingResponseIds.has(responseId)) continue;
      const identity = {subject_id: delivery.subject_id, pregnancy_id: delivery.pregnancy_id ?? null, cycle_id: delivery.cycle_id};
      const explicitFacts = lifecycleFactsFor(inputs.events, identity).map(event => event.event_id).filter(Boolean).sort();
      records.push({
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
      });
    }
    if (records.length) {
      await saveResponses({chatId: target.version.chat_id, ownerFloor: floorOwner(target), floorVersion: target.version, records});
    }
    const observedByDeliveryId = new Map(records.map(record => [record.delivery_id, record]));
    const responseDeliveries = deliveries.map(delivery => {
      const response = observedByDeliveryId.get(delivery.delivery_id);
      return response
        ? {...delivery, ...response, status: 'response_observed'}
        : delivery;
    });
    return {status: 'observed', observed: records.length, deliveries: responseDeliveries};
  }

  async function evaluateTimeoutNoPregnancy(target, {inputs: suppliedInputs = null, deliveries: suppliedDeliveries = null} = {}) {
    if (typeof getProjectionDeliveryRecords !== 'function' || typeof archiveAndReleasePregnancy !== 'function') return {status: 'unsupported', closed: 0};
    const inputs = suppliedInputs ?? await collectInputs();
    const deliveries = Array.isArray(suppliedDeliveries)
      ? suppliedDeliveries
      : await getProjectionDeliveryRecords({chatId: target?.version?.chat_id, endpointFloor: target?.version?.floor, endpointIndex: target?.index});
    const lifecycle = inputs.pregnancyLifecycleTimeline ?? {release_records: []};
    const released = new Set((lifecycle.release_records ?? []).filter(record => record.action === 'cycle-lock-released').map(record => `${record.subject_id}:${record.pregnancy_id ?? 'none'}:${record.cycle_id}`));
    let closed = 0;
    const deliveryCandidates = deliveries.filter(item => item.status === 'response_observed' && item.response_id && item.analysis_status === 'success');
    const aggregationCandidates = (inputs.participantAggregations ?? []).map(aggregation => ({
      ...aggregation,
      delivery_id: null,
      response_id: null,
    }));
    const candidates = [...new Map([...deliveryCandidates, ...aggregationCandidates]
      .filter(item => item?.aggregation_id)
      .map(item => [item.aggregation_id, item])).values()];
    for (const delivery of candidates) {
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
        operationKey: `timeout-no-pregnancy:${delivery.delivery_id ?? delivery.aggregation_id}`,
      });
      closed += 1;
    }
    return {status: 'evaluated', closed};
  }

  async function handleAnalysisSuccess({target, execution} = {}) {
    const runId = execution?.pipeline_run_id ?? null;
    const performanceRunId = startAutomaticPerformance({
      chat_id: target?.version?.chat_id,
      floor_version: target?.version,
      trigger: 'factual-success',
    });
    try {
      let current = null;
      try { current = await resolveCurrentFloor?.(); } catch { current = null; }
      if (!sameFloorOwner(current?.version, target?.version)) {
        finishPipelineRun(runId, {
          execution_status: "BLOCKED",
          reason_code: "FLOOR_VERSION_CHANGED",
        });
        finishAutomaticPerformance({run_id: performanceRunId, status: 'CANCELLED_STALE_CONTEXT', reason_code: 'FLOOR_VERSION_CHANGED'});
        return {status: 'stale', response: null, timeout: null, projection: null};
      }
      const inputs = await measureAutomaticStage(performanceRunId, 'INPUT_COLLECTION', collectInputs, {call_count: 1, read_count: 1});
      const deliveries = typeof getProjectionDeliveryRecords === 'function'
        ? await measureAutomaticStage(performanceRunId, 'DELIVERY_RESPONSE_READ', () => getProjectionDeliveryRecords({chatId: target?.version?.chat_id, endpointFloor: target?.version?.floor, endpointIndex: target?.index}), {call_count: 1, read_count: 1})
        : null;
      // Ordinary Projection response bookkeeping is independent from the
      // storyline settle/judge path. A stale batch response write must remain
      // visible as its own failure, but cannot prevent qualified storyline
      // inputs from reaching the storyline runtime below.
      let response = {status: 'skipped', observed: 0, deliveries};
      let responseError = null;
      try {
        response = await measureAutomaticStage(performanceRunId, 'DELIVERY_RESPONSE', () => recordCompletedResponse({target, execution, inputs, deliveries}), {call_count: 1, output_count: deliveries?.length ?? 0});
      } catch (error) {
        responseError = error;
        response = {status: 'failed', observed: 0, deliveries, error_code: error?.code ?? error?.message ?? 'DELIVERY_RESPONSE_FAILED'};
        // `measureAutomaticStage` already records the failed ordinary
        // Projection stage. Keep this local diagnostic marker separate from
        // storyline traces so the two failures cannot be conflated.
        try {
          diagnostics?.recordStorylineTrace?.({
            stage: 'STORYLINE_UPSTREAM_INDEPENDENT_FAILURE',
            phase: 'settle',
            status: 'continued',
            floor_version: target?.version ?? null,
            parent_run_id: performanceRunId,
            operation_id: `storyline-settle:${target?.version?.message_id ?? 'unknown'}:${target?.version?.message_version ?? 'unknown'}`,
            upstream_stage: 'DELIVERY_RESPONSE',
            error_code: response.error_code,
            storyline_continued: true,
          });
        } catch { /* diagnostics must never block storyline processing */ }
      }
      const timeout = await evaluateTimeoutNoPregnancy(target, {inputs, deliveries: response.deliveries ?? deliveries});
      const projection = await process({reason: 'factual-success', runId, inputs: timeout.closed ? null : inputs, performanceRunId, dedupeCompleted: true});
      finishAutomaticPerformance({run_id: performanceRunId, status: projection.status === 'failed' ? 'FAILED' : projection.status === 'partial' || responseError ? 'PARTIAL' : 'SUCCEEDED', reason_code: responseError ? 'ORDINARY_DELIVERY_RESPONSE_FAILED_STORYLINE_CONTINUED' : null, error_code: responseError?.code ?? responseError?.message ?? null});
      return {response, timeout, projection};
    } catch (error) {
      finishAutomaticPerformance({run_id: performanceRunId, status: 'FAILED', error_code: error?.code ?? error?.message ?? 'PROJECTION_POST_PROCESSING_FAILED', reason_code: 'PROJECTION_POST_PROCESSING_FAILED'});
      finishPipelineRun(runId, {
        execution_status: "FAILED",
        reason_code: "PROJECTION_POST_PROCESSING_FAILED",
        error_code: error?.code ?? error?.message ?? "PROJECTION_POST_PROCESSING_FAILED",
      });
      throw error;
    }
  }

  async function runExecution(inputs, identity, reason, trigger, {allowExternalApi = true} = {}) {
    const startedAt = new Date().toISOString();
    startActivity(identity);
    emitStatus({stage: "PROJECTION_PROCESS_STARTED", state: "running", phase: "process", reason, trigger, projection_route: allowExternalApi ? "analysis" : "internal", external_api_allowed: allowExternalApi, current_story_time: inputs.currentStoryTime ?? null, ...identity, started_at: startedAt});
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
    let generatedRecords = [];
    let generatedResults = [];
    try {
      let views = await measureAutomaticStage(identity.performance_run_id, 'INITIAL_PROJECTION_VIEWS', () => getProjectionViews({
        chatId: identity.chat_id,
        endpointFloor: identity.floor_version.floor,
        endpointIndex: inputs.floor?.index,
      }), {call_count: 1, read_count: 1, output_count: 0});
      const lifecycleDeletionRecords = [];
      const lifecycleEvolutionRecords = [];
      const scheduledDeletionIds = new Set();
      const legacyBuiltInViews = (views?.all ?? []).filter(view => !view?.deleted && isLegacyBuiltInPreConfirmationProjection(view));
      if (legacyBuiltInViews.length && (typeof saveProjectionLifecycleBatch === 'function' || typeof inputs.deleteProjection === 'function')) {
        for (const view of legacyBuiltInViews) {
          scheduledDeletionIds.add(view.projection_id);
          lifecycleDeletionRecords.push({
            projection_id: view.projection_id,
            action: 'deleted',
            created_at_floor_version: inputs.floor.version,
            evidence_refs: ['system:built-in-projection-upgrade'],
          });
        }
      }
      const preConfirmationTiming = typeof resolvePreConfirmationTiming === "function"
        ? await measureAutomaticStage(identity.performance_run_id, 'TIMING_RESOLUTION', () => resolvePreConfirmationTiming({inputs, views, execution: identity, run_id: identity.run_id ?? null}), {call_count: 1, read_count: 1})
        : null;
      const rules = normalizeProjectionRules(inputs.worldModel?.projection_rules ?? []);
      const ruleByKey = new Map(rules.map(rule => [
        `${rule.projection_rule_id}\u001f${rule.development_concern_key}`,
        rule,
      ]));
      const builtInEvolutionRules = !inputs.worldModel?.projection_rules?.length && preConfirmationTiming
        ? buildBuiltInPreConfirmationRules(preConfirmationTiming)
        : [];
      const evolutionWorldModel = builtInEvolutionRules.length
        ? {...inputs.worldModel, projection_rules: builtInEvolutionRules}
        : inputs.worldModel;

      let viewsChanged = false;
      for (const view of views?.all ?? []) {
        // A Story Time stage replacement is a snapshot change, not a factual
        // lifecycle event. The old stage remains in its original Floor and is
        // hidden by the endpoint resolver; never expire/delete it here.
        if (view?.deleted || isBuiltInStageProjection(view) || ["realized", "contradicted", "expired"].includes(view?.factual_status)) continue;
        const evolution = evaluateProjectionEvolution({
          projection: view,
          currentView: view,
          currentState: inputs.currentState,
          events: inputs.events,
          worldModel: evolutionWorldModel,
          currentStoryTime: inputs.currentStoryTime,
        });
        if (["realized", "contradicted", "expired"].includes(evolution.decision) && !scheduledDeletionIds.has(view.projection_id)) {
          lifecycleEvolutionRecords.push({
            projection_id: view.projection_id,
            action: evolution.decision,
            created_at_floor_version: inputs.floor.version,
            evidence_refs: (evolution.evidence_event_ids ?? []).map(id => `event:${id}`),
          });
        }
      }
      if (!inputs.worldModel?.projection_rules?.length && preConfirmationTiming) {
        const expectedBuiltInRules = buildBuiltInPreConfirmationRules(preConfirmationTiming);
        const expectedRuleIds = new Map(expectedBuiltInRules.map(rule => [
          `${rule.mechanism_key}\u001f${rule.development_concern_key}`,
          rule.projection_rule_id,
        ]));
        const staleBuiltInViews = (views?.all ?? []).filter(view => {
          if (isBuiltInStageProjection(view)) return false;
          const branch = builtInPreConfirmationBranchForConcern(view?.development_concern_key);
          if (!branch || view?.deleted || view?.aggregation_path !== 'participant_aggregation') return false;
          const expectedRuleId = expectedRuleIds.get(`${view?.mechanism?.key ?? ''}\u001f${view.development_concern_key}`);
          return Boolean(expectedRuleId && expectedRuleId !== view.projection_rule_id);
        });
        if (staleBuiltInViews.length && (typeof saveProjectionLifecycleBatch === 'function' || typeof inputs.deleteProjection === 'function')) {
          for (const view of staleBuiltInViews) {
            if (scheduledDeletionIds.has(view.projection_id)) continue;
            scheduledDeletionIds.add(view.projection_id);
            lifecycleDeletionRecords.push({
              projection_id: view.projection_id,
              action: 'deleted',
              created_at_floor_version: inputs.floor.version,
              evidence_refs: ['system:built-in-projection-schedule-upgrade'],
            });
          }
        }
      }
      if (lifecycleDeletionRecords.length) {
        const saveDeletions = typeof saveProjectionLifecycleBatch === 'function'
          ? () => saveProjectionLifecycleBatch({chatId: identity.chat_id, ownerFloor: floorOwner(inputs.floor), floorVersion: inputs.floor.version, records: lifecycleDeletionRecords, traceContext: {trigger}})
          : async () => {
            let changed = false;
            for (const record of lifecycleDeletionRecords) {
              const result = await inputs.deleteProjection({chatId: identity.chat_id, ownerFloor: floorOwner(inputs.floor), floorVersion: inputs.floor.version, projectionId: record.projection_id, evidenceRefs: record.evidence_refs});
              changed ||= !result || ['appended', 'created', 'updated'].includes(result.status);
            }
            return {status: changed ? 'appended' : 'deduped'};
          };
        const result = await measureAutomaticStage(identity.performance_run_id, 'LEGACY_PROJECTION_LIFECYCLE', saveDeletions, {call_count: 1, output_count: lifecycleDeletionRecords.length});
        viewsChanged ||= !result || ['appended', 'created', 'updated'].includes(result.status);
      }
      if (lifecycleEvolutionRecords.length) {
        const saveEvolutions = typeof saveProjectionLifecycleBatch === 'function'
          ? () => saveProjectionLifecycleBatch({chatId: identity.chat_id, ownerFloor: floorOwner(inputs.floor), floorVersion: inputs.floor.version, records: lifecycleEvolutionRecords, traceContext: {trigger}})
          : async () => {
            let changed = false;
            for (const record of lifecycleEvolutionRecords) {
              const result = await saveEvolutionDecision({chatId: identity.chat_id, ownerFloor: floorOwner(inputs.floor), floorVersion: inputs.floor.version, projectionId: record.projection_id, decision: record.action, evidenceRefs: record.evidence_refs});
              changed ||= !result || ['appended', 'created', 'updated'].includes(result.status);
            }
            return {status: changed ? 'appended' : 'deduped'};
          };
        const result = await measureAutomaticStage(identity.performance_run_id, 'LEGACY_PROJECTION_LIFECYCLE', saveEvolutions, {call_count: 1, output_count: lifecycleEvolutionRecords.length});
        viewsChanged ||= !result || ['appended', 'created', 'updated'].includes(result.status);
      }
      if (viewsChanged) {
        views = await measureAutomaticStage(identity.performance_run_id, 'LIFECYCLE_READBACK', () => getProjectionViews({
          chatId: identity.chat_id,
          endpointFloor: identity.floor_version.floor,
          endpointIndex: inputs.floor?.index,
        }), {call_count: 1, read_count: 1});
      }
      const eligibility = await measureAutomaticStage(identity.performance_run_id, 'ELIGIBILITY_EVALUATION', async () => evaluateProjectionEligibility({
        currentState: inputs.currentState,
        events: inputs.events,
        sourceCandidates: inputs.sourceCandidates,
        worldModel: inputs.worldModel,
        currentStoryTime: inputs.currentStoryTime,
        existingProjections: views?.all ?? [],
        preConfirmationTiming,
      }), {call_count: 1, read_count: 1, output_count: 0});
      for (const rule of eligibility.built_in_rules ?? []) {
        ruleByKey.set(`${rule.projection_rule_id}\u001f${rule.development_concern_key}`, rule);
      }
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
        projection_eligibility: eligibility.decisions.some(decision => decision.projection_source === 'built_in_pre_confirmation' && decision.eligibility === 'eligible')
          ? "BUILT_IN_PRE_CONFIRMATION"
          : eligibility.decisions.length ? "DECISIONS_EVALUATED" : "NO_ELIGIBLE_PROJECTION",
        projection_candidate_source: eligibility.decisions.some(decision => decision.projection_source === 'built_in_pre_confirmation' && decision.eligibility === 'eligible') ? 'built_in_pre_confirmation' : null,
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
      const reusableBuiltIn = eligibility.decisions.filter(decision =>
        decision.projection_source === 'built_in_pre_confirmation'
        && decision.eligibility === 'eligible'
        && decision.existing_projection_id,
      )
      const eligibleBuiltIn = eligibility.decisions.filter(decision =>
        decision.projection_source === 'built_in_pre_confirmation'
        && decision.eligibility === 'eligible',
      )
      if (eligibleBuiltIn.length >= 4 && reusableBuiltIn.length === eligibleBuiltIn.length) {
        emitStatus({
          stage: 'PROJECTION_STAGE_REUSED', state: 'success', phase: 'reuse', reason, trigger,
          ...identity,
          subject_count: new Set(reusableBuiltIn.map(decision => decision.subject_id).filter(Boolean)).size,
          reused_candidate_count: reusableBuiltIn.length,
          stage_keys: [...new Set(reusableBuiltIn
            .map(decision => builtInPreConfirmationBranchForConcern(decision.development_concern_key)?.stage_key)
            .filter(Boolean))].sort(),
        })
      }
      if (eligibility.diagnostics?.some(item => item.code === "projection_rule_conflict")) {
        throw Object.assign(new Error("PROJECTION_ELIGIBILITY_FAILED"), {code: "PROJECTION_ELIGIBILITY_FAILED"});
      }

      const generationDecisions = eligibility.decisions.filter(item => item.eligibility === "eligible" && !item.existing_projection_id);
      const deferredExternalApiDecisions = allowExternalApi
        ? []
        : generationDecisions.filter(item => item.projection_source !== 'built_in_pre_confirmation');
      const generationDecisionsToProcess = allowExternalApi
        ? generationDecisions
        : generationDecisions.filter(item => item.projection_source === 'built_in_pre_confirmation');
      const aiGenerationDecisions = generationDecisionsToProcess.filter(item => item.projection_source !== 'built_in_pre_confirmation');
      for (const decision of deferredExternalApiDecisions) {
        emitStatus({stage: "PROJECTION_AI_SKIPPED", state: "running", phase: "generation", reason, trigger, projection_rule_id: decision.projection_rule_id, development_concern_key: decision.development_concern_key, rejection_reason: "EXTERNAL_API_DEFERRED_TO_ANALYSIS_ROUTE", ai_call_will_start: false, projection_route: "internal", external_api_allowed: false, ...identity});
      }
      emitStatus({stage: "PROJECTION_AI_PLAN", state: "running", phase: "generation", reason, trigger, candidate_count: 0, ai_call_will_start: aiGenerationDecisions.length > 0, built_in_candidate_count: generationDecisionsToProcess.length - aiGenerationDecisions.length, deferred_external_api_candidate_count: deferredExternalApiDecisions.length, projection_route: allowExternalApi ? "analysis" : "internal", external_api_allowed: allowExternalApi, ...identity, started_at: startedAt});
      recordPipelineStage({
        stage: "PROJECTION_AI_SCHEDULING",
        execution_status: generationDecisionsToProcess.length > 0 ? "ATTEMPTED" : deferredExternalApiDecisions.length > 0 ? "SKIPPED" : "BLOCKED",
        reason_code: generationDecisionsToProcess.length > 0 ? "ELIGIBLE_DECISION_FOUND" : deferredExternalApiDecisions.length > 0 ? "EXTERNAL_API_DEFERRED" : "NO_ELIGIBLE_PROJECTION",
        invoked: true,
        run_id: identity.run_id ?? null,
        chat_id: identity.chat_id,
        floor_version: identity.floor_version,
        input_count: eligibility.decisions.length,
        output_count: generationDecisionsToProcess.length,
        projection_rules_available: rules.length > 0,
        projection_rules_count: rules.length,
        projection_eligibility: generationDecisionsToProcess.length > 0
          ? (aiGenerationDecisions.length > 0 ? "ELIGIBLE_DECISION_FOUND" : "BUILT_IN_PRE_CONFIRMATION")
          : deferredExternalApiDecisions.length > 0 ? "EXTERNAL_API_DEFERRED" : "NO_ELIGIBLE_PROJECTION",
        projection_candidate_source: generationDecisionsToProcess.some(decision => decision.projection_source === 'built_in_pre_confirmation') ? 'built_in_pre_confirmation' : null,
        timing_window_status: eligibility.decisions.map(decision => decision.timing_status).filter(Boolean).join(",") || null,
        projection_ai_request_started: false,
        projection_route: allowExternalApi ? "analysis" : "internal",
        external_api_allowed: allowExternalApi,
        source_type: "EXECUTION_TRACE",
      });
      for (const decision of generationDecisionsToProcess) {
        const rule = ruleByKey.get(`${decision.projection_rule_id}\u001f${decision.development_concern_key}`);
        if (!rule) {
          partial = true;
          errors.push({decision: decisionKey(decision), reason: "projection_rule_missing"});
          emitStatus({stage: "PROJECTION_AI_SKIPPED", state: "running", phase: "generation", reason, trigger, projection_rule_id: decision.projection_rule_id, development_concern_key: decision.development_concern_key, rejection_reason: "projection_rule_missing", ai_call_will_start: false, ...identity});
          continue;
        }
        const builtInCandidate = decision.projection_source === 'built_in_pre_confirmation';
        if (builtInCandidate) {
          recordPipelineStage({
            stage: "PROJECTION_BUILT_IN_CANDIDATE",
            execution_status: "ATTEMPTED",
            reason_code: "PARTICIPANT_AGGREGATION_SUCCEEDED",
            invoked: true,
            run_id: identity.run_id ?? null,
            chat_id: identity.chat_id,
            floor_version: identity.floor_version,
            subject_id: decision.subject_id,
            mechanism_key: rule.mechanism_key,
            cycle_id: timingDecisionDiagnostics(decision, preConfirmationTiming, inputs).cycle_id,
            aggregation_id: decision.aggregation_id,
            projection_rules_available: false,
            projection_rules_count: 0,
            projection_candidate_source: 'built_in_pre_confirmation',
            source_type: "EXECUTION_TRACE",
          });
          emitStatus({stage: "PROJECTION_BUILT_IN_CANDIDATE", state: "running", phase: "generation", reason, trigger, projection_rule_id: decision.projection_rule_id, development_concern_key: decision.development_concern_key, ai_request_started: false, ai_call_will_start: false, ...timingDecisionDiagnostics(decision, preConfirmationTiming, inputs), ...identity});
        } else {
          emitStatus({stage: "PROJECTION_AI_REQUEST_STARTED", state: "running", phase: "generation", reason, trigger, projection_rule_id: decision.projection_rule_id, development_concern_key: decision.development_concern_key, ai_request_started: true, ai_call_will_start: true, ...timingDecisionDiagnostics(decision, preConfirmationTiming, inputs), ...identity});
        }
          const result = await measureAutomaticStage(identity.performance_run_id, 'PROJECTION_GENERATION', () => generateProjectionCandidate({
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
            reference_story_time: preConfirmationTiming?.instances?.find(item => item.timing_instance_id === decision.timing_instance_id)?.reference_story_time ?? inputs.currentStoryTime,
          },
          generateRaw: async generationInput => {
            if (builtInCandidate) {
              const branch = builtInPreConfirmationBranchForConcern(decision.development_concern_key);
              return {development: {kind: decision.development_kind, description: branch?.description ?? '观察期内可能出现变化；这只是备选剧情方向，不是已确认怀孕事实。'}};
            }
            if (typeof analyzer?.generateProjection !== "function") throw new Error("PROJECTION_ANALYZER_UNAVAILABLE");
            return analyzer.generateProjection(generationInput);
          },
          isStillCurrent: async ({phase}) => {
            if (destroyed || inFlight.get(identity.in_flight_key) === undefined) return false;
            if (builtInCandidate) return true;
            return currentInputsMatch(identity.execution_id);
          },
        }), {call_count: 1, ai_called: !builtInCandidate});
        const generatedProjectionIds = result.projection?.projection_id ? [result.projection.projection_id] : [];
        const validationResult = result.status === 'generated'
          ? 'passed'
          : ['validation_failed', 'invalid_json', 'assembly_failed'].includes(result.reason_code)
            ? 'failed'
            : null;
        emitStatus({stage: builtInCandidate ? "PROJECTION_BUILT_IN_CANDIDATE_COMPLETED" : "PROJECTION_AI_REQUEST_COMPLETED", state: result.status === 'generated' ? "running" : "partial", phase: "generation", reason, trigger, projection_rule_id: decision.projection_rule_id, development_concern_key: decision.development_concern_key, ai_request_started: false, ai_request_completed: !builtInCandidate, ai_request_failed: !builtInCandidate && result.status !== 'generated', candidate_count: generatedProjectionIds.length, candidate_validation_result: validationResult, validation_errors: result.errors ?? [], rejection_reason: result.reason_code ?? null, generated_projection_ids: generatedProjectionIds, projection_candidate_source: builtInCandidate ? 'built_in_pre_confirmation' : null, ...identity});
        if (result.status === "stale") {
          emitStatus({state: "stale", phase: result.reason_code, reason, ...identity, started_at: startedAt});
          finishPipelineRun(identity.run_id, {
            execution_status: "BLOCKED",
            reason_code: "FLOOR_VERSION_CHANGED",
          });
          finishAutomaticPerformance({run_id: identity.performance_run_id, status: 'CANCELLED_STALE_CONTEXT', reason_code: 'FLOOR_VERSION_CHANGED'});
          return {status: "stale", execution_id: identity.execution_id, run_id: identity.run_id, results: [result]};
        }
        if (result.status !== "generated") {
          partial = true;
          errors.push({decision: decisionKey(decision), reason: result.reason_code, errors: result.errors ?? []});
          continue;
        }
        generatedResults.push(result);
        generatedRecords.push({
          projectionCandidate: result.projection,
          evidenceRecord: {
            projection_id: result.projection.projection_id,
            source_event_ids: result.projection.source_event_ids,
            created_at_floor_version: inputs.floor.version,
            evidence_refs: result.projection.evidence_refs,
          },
        });
      }
      if (generatedRecords.length) {
        const builtInRecords = generatedRecords.filter(item => isBuiltInStageProjection(item?.projectionCandidate))
        const completeBuiltInKeys = completeBuiltInStageKeys(generatedRecords)
        const incompleteBuiltInRecords = builtInRecords.filter(item => {
          const candidate = item.projectionCandidate
          const branch = builtInPreConfirmationBranchForConcern(candidate.development_concern_key)
          const evidence = candidate.aggregation_evidence
          const key = JSON.stringify([
            candidate.subject_id,
            evidence?.pregnancy_id ?? null,
            evidence?.cycle_id ?? null,
            candidate.mechanism?.key ?? null,
            branch?.stage_key ?? null,
          ])
          return !completeBuiltInKeys.has(key)
        })
        if (incompleteBuiltInRecords.length) {
          partial = true
          errors.push({reason: 'built_in_stage_incomplete', output_count: incompleteBuiltInRecords.length})
          generatedRecords = generatedRecords.filter(item => !incompleteBuiltInRecords.includes(item))
          generatedResults = generatedResults.filter(result => !incompleteBuiltInRecords.some(item => item.projectionCandidate?.projection_id === result.projection?.projection_id))
        }
        const builtInSnapshot = builtInStageStatus(generatedRecords)
        if (builtInSnapshot.candidate_count) emitStatus({
          stage: 'PROJECTION_STAGE_SNAPSHOT', state: 'planned', phase: 'persistence', reason, trigger,
          ...identity, snapshot_status: 'planned', ...builtInSnapshot,
        })
        if (generatedRecords.length && !(await currentInputsMatch(identity.execution_id))) {
          if (builtInSnapshot.candidate_count) emitStatus({
            stage: 'PROJECTION_STAGE_SNAPSHOT', state: 'failed', phase: 'persistence', reason, trigger,
            ...identity, snapshot_status: 'failed', failure_reason: 'stale', ...builtInSnapshot,
          })
          emitStatus({state: "stale", phase: "before_persistence", reason, ...identity, started_at: startedAt});
          finishPipelineRun(identity.run_id, {
            execution_status: "BLOCKED",
            reason_code: "FLOOR_VERSION_CHANGED",
          });
          finishAutomaticPerformance({run_id: identity.performance_run_id, status: 'CANCELLED_STALE_CONTEXT', reason_code: 'FLOOR_VERSION_CHANGED'});
          return {status: "stale", execution_id: identity.execution_id, run_id: identity.run_id, results: generatedResults};
        }
        if (generatedRecords.length) try {
          if (!allowExternalApi && typeof ensureProjectionFloorOwner === "function") {
            await measureAutomaticStage(
              identity.performance_run_id,
              'PROJECTION_FLOOR_OWNER_SEED',
              () => ensureProjectionFloorOwner({
                target: inputs.floor,
                reason,
                trigger,
              }),
              {call_count: 1, write_count: 1},
            );
          }
          await measureAutomaticStage(identity.performance_run_id, 'PROJECTION_PERSISTENCE', () => saveProjectionBatch({
            chatId: identity.chat_id,
            ownerFloor: floorOwner(inputs.floor),
            floorVersion: inputs.floor.version,
            records: generatedRecords,
            traceContext: {trigger},
          }), {call_count: 1, output_count: generatedRecords.length});
          recordPipelineStage({
            stage: "PROJECTION_PERSISTENCE",
            execution_status: "SUCCEEDED",
            reason_code: "PROJECTION_PERSISTED",
            invoked: true,
            run_id: identity.run_id ?? null,
            chat_id: identity.chat_id,
            floor_version: identity.floor_version,
            output_count: generatedRecords.length,
            source_type: "EXECUTION_TRACE",
          });
          if (builtInSnapshot.candidate_count) emitStatus({
            stage: 'PROJECTION_STAGE_SNAPSHOT', state: 'success', phase: 'persistence', reason, trigger,
            ...identity, snapshot_status: 'succeeded', ...builtInSnapshot,
          })
        } catch (error) {
          partial = true;
          errors.push({reason: error?.code ?? error?.message ?? "persistence_failed", output_count: generatedRecords.length});
          if (builtInSnapshot.candidate_count) emitStatus({
            stage: 'PROJECTION_STAGE_SNAPSHOT', state: 'failed', phase: 'persistence', reason, trigger,
            ...identity, snapshot_status: 'failed', failure_reason: error?.code ?? error?.message ?? 'persistence_failed', ...builtInSnapshot,
          })
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
        finalViews = generatedRecords.length || viewsChanged
          ? await measureAutomaticStage(identity.performance_run_id, 'FINAL_PROJECTION_READBACK', () => getProjectionViews({chatId: identity.chat_id, endpointFloor: identity.floor_version.floor, endpointIndex: inputs.floor?.index}), {call_count: 1, read_count: 1})
          : views;
        let observationSave;
        if (typeof saveProjectionTriggeredSnapshotBatch !== 'function') {
        recordPipelineStage({
          stage: 'PROJECTION_OBSERVATION_PERSISTENCE',
          execution_status: 'ATTEMPTED',
          reason_code: 'PROJECTION_OBSERVATION_PERSISTENCE_ATTEMPTED',
          invoked: true,
          run_id: identity.run_id ?? null,
          chat_id: identity.chat_id,
          floor_version: identity.floor_version,
          persistence_attempted: true,
          source_type: 'EXECUTION_TRACE',
        });
        try {
          observationSave = await persistObservedReactions(finalViews, inputs, identity, reason, trigger);
          recordPipelineStage({
            stage: 'PROJECTION_OBSERVATION_PERSISTENCE',
            execution_status: observationSave.status === 'appended' ? 'SUCCEEDED' : 'SKIPPED',
            reason_code: observationSave.status === 'appended'
              ? 'PROJECTION_OBSERVATION_PERSISTED'
              : observationSave.status === 'deduped' ? 'PROJECTION_OBSERVATION_DEDUPED' : 'PROJECTION_OBSERVATION_NOT_SUPPORTED',
            invoked: observationSave.status !== 'unsupported',
            run_id: identity.run_id ?? null,
            chat_id: identity.chat_id,
            floor_version: identity.floor_version,
            persistence_attempted: observationSave.status !== 'unsupported',
            persistence_succeeded: observationSave.status === 'appended' || observationSave.status === 'deduped',
            output_count: observationSave.record_count ?? 0,
            source_type: 'EXECUTION_TRACE',
          });
        } catch (error) {
          recordPipelineStage({
            stage: 'PROJECTION_OBSERVATION_PERSISTENCE',
            execution_status: 'PERSIST_FAILED',
            reason_code: 'PROJECTION_OBSERVATION_PERSISTENCE_FAILED',
            invoked: true,
            run_id: identity.run_id ?? null,
            chat_id: identity.chat_id,
            floor_version: identity.floor_version,
            persistence_attempted: true,
            persistence_succeeded: false,
            error_code: error?.code ?? error?.message ?? 'PROJECTION_OBSERVATION_PERSISTENCE_FAILED',
            source_type: 'EXECUTION_TRACE',
          });
          throw error;
        }
        if (observationSave.status === 'appended') {
          try {
            finalViews = await measureAutomaticStage(identity.performance_run_id, 'PROJECTION_OBSERVATION_READBACK', () => getProjectionViews({chatId: identity.chat_id, endpointFloor: identity.floor_version.floor, endpointIndex: inputs.floor?.index}), {call_count: 1, read_count: 1});
            recordPipelineStage({
              stage: 'PROJECTION_OBSERVATION_READBACK',
              execution_status: 'SUCCEEDED',
              reason_code: 'PROJECTION_OBSERVATION_READBACK_COMPLETED',
              invoked: true,
              run_id: identity.run_id ?? null,
              chat_id: identity.chat_id,
              floor_version: identity.floor_version,
              readback_attempted: true,
              readback_succeeded: true,
              source_type: 'EXECUTION_TRACE',
            });
          } catch (error) {
            recordPipelineStage({
              stage: 'PROJECTION_OBSERVATION_READBACK',
              execution_status: 'READBACK_FAILED',
              reason_code: 'PROJECTION_OBSERVATION_READBACK_FAILED',
              invoked: true,
              run_id: identity.run_id ?? null,
              chat_id: identity.chat_id,
              floor_version: identity.floor_version,
              readback_attempted: true,
              readback_succeeded: false,
              error_code: error?.code ?? error?.message ?? 'PROJECTION_OBSERVATION_READBACK_FAILED',
              source_type: 'EXECUTION_TRACE',
            });
            throw error;
          }
        }
        } else {
          observationSave = {status: 'unsupported'};
        }
        let snapshotSave;
        try {
          snapshotSave = await persistTriggeredSnapshots(finalViews, inputs, identity, reason, trigger);
          const snapshotStatus = snapshotSave.status ?? 'failed';
          recordPipelineStage({
            stage: 'PROJECTION_TRIGGERED_SNAPSHOT_PERSISTENCE',
            execution_status: snapshotStatus === 'appended' ? 'SUCCEEDED' : snapshotStatus === 'failed' ? 'PERSIST_FAILED' : 'SKIPPED',
            reason_code: snapshotStatus === 'appended'
              ? 'PROJECTION_TRIGGERED_SNAPSHOT_PERSISTED'
              : snapshotStatus === 'deduped'
                ? 'PROJECTION_TRIGGERED_SNAPSHOT_DEDUPED'
                : snapshotStatus === 'unsupported'
                  ? 'PROJECTION_TRIGGERED_SNAPSHOT_NOT_SUPPORTED'
                  : 'PROJECTION_TRIGGERED_SNAPSHOT_PERSISTENCE_FAILED',
            result_status: snapshotStatus,
            invoked: snapshotStatus !== 'unsupported' && snapshotStatus !== 'deduped',
            run_id: identity.run_id ?? null,
            chat_id: identity.chat_id,
            floor_version: identity.floor_version,
            persistence_attempted: snapshotStatus !== 'unsupported' && snapshotStatus !== 'deduped',
            persistence_succeeded: snapshotStatus === 'appended' || snapshotStatus === 'deduped',
            snapshot_count: snapshotSave.snapshot_count ?? 0,
            subject_summaries: safeTriggeredSnapshotSubjectSummaries((snapshotSave.subject_summaries ?? []).map(item => ({
              ...item,
              write_status: snapshotStatus,
            }))),
            source_type: 'EXECUTION_TRACE',
          });
        } catch (error) {
          recordPipelineStage({
            stage: 'PROJECTION_TRIGGERED_SNAPSHOT_PERSISTENCE',
            execution_status: 'PERSIST_FAILED',
            reason_code: 'PROJECTION_TRIGGERED_SNAPSHOT_PERSISTENCE_FAILED',
            result_status: 'failed',
            invoked: true,
            run_id: identity.run_id ?? null,
            chat_id: identity.chat_id,
            floor_version: identity.floor_version,
            persistence_attempted: true,
            persistence_succeeded: false,
            snapshot_count: error?.projection_triggered_snapshot_snapshot_count ?? null,
            subject_summaries: safeTriggeredSnapshotSubjectSummaries((snapshotSave?.subject_summaries ?? error?.projection_triggered_snapshot_subject_summaries ?? []).map(item => ({
              ...item,
              write_status: 'failed',
            }))),
            error_code: error?.code ?? error?.message ?? 'PROJECTION_TRIGGERED_SNAPSHOT_PERSISTENCE_FAILED',
            source_type: 'EXECUTION_TRACE',
          });
          throw error;
        }
        if (snapshotSave.status === 'appended') {
          try {
            finalViews = await measureAutomaticStage(identity.performance_run_id, 'PROJECTION_TRIGGERED_SNAPSHOT_READBACK', () => getProjectionViews({chatId: identity.chat_id, endpointFloor: identity.floor_version.floor, endpointIndex: inputs.floor?.index}), {call_count: 1, read_count: 1});
            const readbackBySubject = new Map((finalViews?.triggered_snapshots ?? []).map(snapshot => [snapshot.subject_id, snapshot]));
            const readbackSubjects = safeTriggeredSnapshotSubjectSummaries((snapshotSave.subject_summaries ?? []).map(item => {
              const snapshot = readbackBySubject.get(item.subject_id);
              return {
                ...item,
                write_status: 'appended',
                readback_status: snapshot ? 'FOUND' : 'NOT_FOUND',
                readback_count: snapshot ? (snapshot.triggered ?? []).length : 0,
                readback_snapshot_status: snapshot?.status ?? null,
                expected_status: item.status ?? 'active',
                expected_count: item.final_count ?? 0,
              };
            }));
            const readbackComplete = readbackSubjects.length > 0
              && readbackSubjects.every(item => item.readback_status === 'FOUND'
                && item.readback_snapshot_status === item.expected_status
                && item.readback_count === item.expected_count);
            recordPipelineStage({
              stage: 'PROJECTION_TRIGGERED_SNAPSHOT_READBACK',
              execution_status: readbackComplete ? 'SUCCEEDED' : 'READBACK_MISMATCH',
              reason_code: readbackComplete
                ? 'PROJECTION_TRIGGERED_SNAPSHOT_READBACK_COMPLETED'
                : 'PROJECTION_TRIGGERED_SNAPSHOT_READBACK_MISMATCH',
              result_status: 'appended',
              invoked: true,
              run_id: identity.run_id ?? null,
              chat_id: identity.chat_id,
              floor_version: identity.floor_version,
              readback_attempted: true,
              readback_succeeded: readbackComplete,
              snapshot_count: snapshotSave.snapshot_count ?? 0,
              subject_summaries: readbackSubjects,
              source_type: 'EXECUTION_TRACE',
            });
          } catch (error) {
            recordPipelineStage({
              stage: 'PROJECTION_TRIGGERED_SNAPSHOT_READBACK',
              execution_status: 'READBACK_FAILED',
              reason_code: 'PROJECTION_TRIGGERED_SNAPSHOT_READBACK_FAILED',
              result_status: 'failed',
              invoked: true,
              run_id: identity.run_id ?? null,
              chat_id: identity.chat_id,
              floor_version: identity.floor_version,
              readback_attempted: true,
              readback_succeeded: false,
              snapshot_count: snapshotSave.snapshot_count ?? 0,
              subject_summaries: safeTriggeredSnapshotSubjectSummaries((snapshotSave.subject_summaries ?? []).map(item => ({
                ...item,
                write_status: 'appended',
                readback_status: 'FAILED',
              }))),
              error_code: error?.code ?? error?.message ?? 'PROJECTION_TRIGGERED_SNAPSHOT_READBACK_FAILED',
              source_type: 'EXECUTION_TRACE',
            });
            throw error;
          }
        } else {
          recordPipelineStage({
            stage: 'PROJECTION_TRIGGERED_SNAPSHOT_READBACK',
            execution_status: 'SKIPPED',
            reason_code: snapshotSave.status === 'unsupported'
              ? 'PROJECTION_TRIGGERED_SNAPSHOT_READBACK_NOT_ATTEMPTED_UNSUPPORTED'
              : 'PROJECTION_TRIGGERED_SNAPSHOT_READBACK_NOT_ATTEMPTED_NO_WRITE',
            result_status: 'not_attempted',
            invoked: false,
            run_id: identity.run_id ?? null,
            chat_id: identity.chat_id,
            floor_version: identity.floor_version,
            readback_attempted: false,
            readback_succeeded: false,
            snapshot_count: 0,
            subject_summaries: safeTriggeredSnapshotSubjectSummaries((snapshotSave.subject_summaries ?? []).map(item => ({
              ...item,
              write_status: snapshotSave.status ?? 'failed',
              readback_status: 'NOT_ATTEMPTED',
            }))),
            source_type: 'EXECUTION_TRACE',
          });
        }
        await storylineRuntime?.settled?.({inputs, responseId: inputs.floor?.version?.content_hash ?? identity.run_id, body: inputs.floor?.narrative ?? '', settled: true, generation: identity});
        finalViews = await getProjectionViews({chatId: identity.chat_id, endpointFloor: inputs.floor.version.floor, endpointIndex: inputs.floor.index});
        dto = dtoFromViews(finalViews, {currentStoryTime: inputs.currentStoryTime});
        await measureAutomaticStage(identity.performance_run_id, 'PROJECTION_CONTEXT_REFRESH', () => refreshProjectionContext?.({chatId: identity.chat_id, businessData: inputs.businessData, projectionViews: finalViews, performanceRunId: identity.performance_run_id}), {call_count: 1});
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
      finishAutomaticPerformance({run_id: identity.performance_run_id, status: status === 'partial' ? 'PARTIAL' : 'SUCCEEDED'});
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
      finishAutomaticPerformance({run_id: identity.performance_run_id, status: 'FAILED', error_code: error?.code ?? error?.message ?? 'PROJECTION_FAILED'});
      finishActivity(identity, "failed", error);
      return {status: "failed", execution_id: identity.execution_id, run_id: identity.run_id, errors: [{reason: error?.code ?? error?.message ?? "PROJECTION_FAILED"}]};
    }
  }

  async function process({reason = "projection-refresh", trigger = "projection-refresh", runId = null, inputs: suppliedInputs = null, performanceRunId = null, dedupeCompleted = false, allowExternalApi = true} = {}) {
    if (destroyed) return {status: "destroyed"};
    if (enabledResolver() === false) return {status: "disabled"};
    const ownPerformanceRunId = performanceRunId ?? startAutomaticPerformance({chat_id: getChatId?.(), trigger});
    let inputs;
    try {
      inputs = suppliedInputs ?? await measureAutomaticStage(ownPerformanceRunId, 'INPUT_COLLECTION', collectInputs, {call_count: 1, read_count: 1});
    } catch (error) {
      finishAutomaticPerformance({run_id: ownPerformanceRunId, status: 'FAILED', reason_code: 'PROJECTION_INPUT_COLLECTION_FAILED', error_code: error?.code ?? error?.message ?? 'PROJECTION_INPUT_COLLECTION_FAILED'});
      throw error;
    }
    if (!inputs?.floor?.version || inputs.currentStateStatus === "STATE_ERROR") {
      finishAutomaticPerformance({run_id: ownPerformanceRunId, status: 'FAILED', reason_code: 'PROJECTION_INPUT_UNAVAILABLE'});
      return {status: "unavailable"};
    }
    if (suppliedInputs) {
      let currentFloor = null;
      try { currentFloor = await resolveCurrentFloor(); } catch { currentFloor = null; }
      if (!sameFloorVersion(currentFloor?.version, inputs.floor.version)) {
        finishAutomaticPerformance({run_id: ownPerformanceRunId, status: 'CANCELLED_STALE_CONTEXT', reason_code: 'FLOOR_VERSION_CHANGED'});
        return {status: "stale", reason: "FLOOR_VERSION_CHANGED"};
      }
    }
    const execution_id = await executionIdentity(inputs);
    const resolvedRunId = runId ?? startPipelineRun({
      kind: "projection",
      trigger,
      performance_run_id: ownPerformanceRunId,
      reason,
      chat_id: inputs.floor.version.chat_id,
      floor_version: inputs.floor.version,
    });
    const inFlightKey = `${execution_id}\u001f${allowExternalApi ? "analysis" : "internal"}`;
    if (inFlight.has(inFlightKey)) {
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
      finishAutomaticPerformance({run_id: ownPerformanceRunId, status: 'SKIPPED', reason_code: 'PROJECTION_ALREADY_IN_FLIGHT'});
      return inFlight.get(inFlightKey);
    }
    if (dedupeCompleted && completedAutomaticExecution?.execution_id === execution_id &&
        (allowExternalApi || completedAutomaticExecution.allowExternalApi === true)) {
      recordPipelineStage({
        stage: "PIPELINE_SCHEDULING",
        execution_status: "SKIPPED",
        reason_code: "PROJECTION_ALREADY_COMPLETED",
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
        reason_code: "PROJECTION_ALREADY_COMPLETED",
      });
      finishAutomaticPerformance({run_id: ownPerformanceRunId, status: "SKIPPED", reason_code: "PROJECTION_ALREADY_COMPLETED"});
      return completedAutomaticExecution.result;
    }
    const identity = {
      execution_id,
      chat_id: inputs.floor.version.chat_id,
      floor_version: inputs.floor.version,
      run_id: resolvedRunId,
      performance_run_id: ownPerformanceRunId,
      in_flight_key: inFlightKey,
    };
    const promise = runExecution(inputs, identity, reason, trigger, {allowExternalApi})
      .then(result => {
        if (dedupeCompleted && result?.status === "success")
          completedAutomaticExecution = {execution_id, allowExternalApi, result};
        return result;
      })
      .finally(() => inFlight.delete(inFlightKey));
    inFlight.set(inFlightKey, promise);
    return promise;
  }

  async function processInternal({reason = "settled-floor-internal", trigger = "automatic-internal", ...options} = {}) {
    return process({
      ...options,
      reason,
      trigger,
      dedupeCompleted: true,
      allowExternalApi: false,
    });
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
      const timeout = await evaluateTimeoutNoPregnancy(inputs.floor, {inputs});
      const effectiveInputs = timeout.closed ? await collectInputs() : inputs;
      const views = await getProjectionViews({chatId: effectiveInputs.floor.version.chat_id, endpointFloor: effectiveInputs.floor.version.floor, endpointIndex: effectiveInputs.floor.index});
      const expiredWindows = new Map((effectiveInputs.trackingWindows ?? []).filter(window => window.status === 'expired').map(window => [window.tracking_window_id, window]));
      let expired = 0;
      let viewsChanged = false;
      const expiredRecords = [];
      for (const view of views?.all ?? []) {
        const window = expiredWindows.get(view.tracking_window_id);
        if (!window || view.tracking_scope !== 'pre_confirmation' || view.deleted || ['realized', 'contradicted', 'expired'].includes(view.factual_status)) continue;
        expiredRecords.push({
          projection_id: view.projection_id,
          action: 'expired',
          created_at_floor_version: effectiveInputs.floor.version,
          evidence_refs: [`tracking_window:${window.tracking_window_id}`],
        });
      }
      if (expiredRecords.length) {
        let result;
        if (typeof saveProjectionLifecycleBatch === 'function') {
          result = await saveProjectionLifecycleBatch({
            chatId: effectiveInputs.floor.version.chat_id,
            ownerFloor: floorOwner(effectiveInputs.floor),
            floorVersion: effectiveInputs.floor.version,
            records: expiredRecords,
            traceContext: {reason},
          });
        } else {
          let changed = false;
          for (const record of expiredRecords) {
            result = await saveEvolutionDecision({
              chatId: effectiveInputs.floor.version.chat_id,
              ownerFloor: floorOwner(effectiveInputs.floor),
              floorVersion: effectiveInputs.floor.version,
              projectionId: record.projection_id,
              decision: record.action,
              evidenceRefs: record.evidence_refs,
            });
            changed ||= !result || ['appended', 'created', 'updated'].includes(result.status);
          }
          result = {status: changed ? 'appended' : 'deduped'};
        }
        viewsChanged = !result || ['appended', 'created', 'updated'].includes(result.status);
        expired = expiredRecords.length;
      }
      const finalViews = viewsChanged
        ? await getProjectionViews({chatId: effectiveInputs.floor.version.chat_id, endpointFloor: effectiveInputs.floor.version.floor, endpointIndex: effectiveInputs.floor.index})
        : views;
      await refreshProjectionContext?.({chatId: effectiveInputs.floor.version.chat_id, businessData: effectiveInputs.businessData, projectionViews: finalViews});
      return {status: 'success', execution_id, expired_projections: expired, timeout_closed: timeout.closed ?? 0};
    })().finally(() => lifecycleInFlight.delete(execution_id));
    lifecycleInFlight.set(execution_id, work);
    return work;
  }

  async function getBusinessData({businessData = null, includeDebug = false} = {}) {
    let floor;
    try {
      floor = await resolveCurrentFloor();
    } catch {
      return {projections: [], storyline_snapshots: [], projection_summary: {active_count: 0, recent: []}};
    }
    if (!floor?.version) return {projections: [], storyline_snapshots: [], projection_summary: {active_count: 0, recent: []}};
    try {
      const views = await getProjectionViews({chatId: floor.version.chat_id, endpointFloor: floor.version.floor, endpointIndex: floor.index});
      const snapshotValid = Boolean(
        businessData?.current_floor?.version
        && sameFloorVersion(businessData.current_floor.version, floor.version),
      );
      return dtoFromViews(views, {
        events: snapshotValid ? businessData.active_events : [],
        snapshotValid,
        includeDebug,
        currentStoryTime: businessData?.current_story_time ?? null,
      });
    } catch {
      return {projections: [], storyline_snapshots: [], projection_summary: {active_count: 0, recent: []}};
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
    await refreshProjectionContext?.({chatId: inputs.floor.version.chat_id, businessData: inputs.businessData});
    return {...result, ...(await getBusinessData())};
  }

  function destroy() {
    destroyed = true;
    inFlight.clear();
    completedAutomaticExecution = null;
  }

  function clearCompletedAutomaticExecutions() {
    completedAutomaticExecution = null;
  }

  return {
    process,
    processInternal,
    tickLifecycleOnly,
    refreshProjection: () => process({reason: "projection-refresh"}),
    getBusinessData,
    deleteProjection,
    cancelStoryline: () => storylineRuntime?.cancelStoryline?.() ?? {status: 'idle', cancelled: 0},
    recordCompletedResponse,
    evaluateTimeoutNoPregnancy,
    handleAnalysisSuccess,
    clearCompletedAutomaticExecutions,
    destroy,
  };
}

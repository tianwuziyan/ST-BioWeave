import {emptyStorylineSnapshot, recordStorylineBody, storylineJudgeDue, normalizeStorylineSnapshot, createStorylineSnapshot} from '../core/projection-storyline.js';
import {buildStorylineDesignMessages, buildStorylineJudgeMessages, parseStorylineDesignResponse, parseStorylineJudgeResponse} from '../ai/projection-storyline.js';
import {normalizePregnancyLifecycleFact, validatePregnancyLifecycleFact} from '../core/pregnancy-lifecycle.js';

const text = value => typeof value === 'string' ? value.trim() : '';
const STORYLINE_DEBUG_SECTIONS = new Set([
  '【剧情支线分析规则】', '【JSON 输出协议】', '【当前 World Model 参考】',
  '【其他参考数据】', '【外部记忆】', '【近期剧情正文】', '【目标人物】',
  '【人物资料】', '【已触发生理信号】', '【候选支线】', '【已选支线】', '【任务要求】',
]);
function safeFingerprint(value) {
  const source = String(value ?? '');
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `storyline_${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
function promptTraceSummary(messages) {
  try {
    return {
      message_count: messages.length,
      role_order: messages.map(message => message.role),
      messages: messages.map(message => ({
        role: message.role,
        length: typeof message.content === 'string' ? message.content.length : 0,
        fingerprint: safeFingerprint(message.content),
        sections: [...STORYLINE_DEBUG_SECTIONS].filter(section => String(message.content ?? '').includes(section)),
      })),
    };
  } catch {
    // Debug summarization must never block the actual storyline request.
    return null;
  }
}
function responseTraceSummary(raw) {
  const length = typeof raw === 'string' ? raw.length : 0;
  let shape = typeof raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim());
      shape = Array.isArray(parsed) ? 'array' : parsed && typeof parsed === 'object' ? 'object' : typeof parsed;
    } catch {
      shape = 'text';
    }
  } else if (raw && typeof raw === 'object') shape = Array.isArray(raw) ? 'array' : 'object';
  return {shape, length, fingerprint: safeFingerprint(raw)};
}
const subjectsFrom = inputs => Object.values(inputs?.businessData?.tracking_subjects ?? inputs?.trackingSubjects ?? {}).map(item => ({subject_id: text(item?.character_id ?? item?.subject_id), display_name: text(item?.display_name ?? item?.name), aliases: Array.isArray(item?.aliases) ? item.aliases : []})).filter(item => item.subject_id);
const sameVersion = (a, b) => ['chat_id', 'message_id', 'floor', 'swipe_id', 'content_hash', 'message_version'].every(field => String(a?.[field] ?? '') === String(b?.[field] ?? ''));
function previousStorylineEndpoint(floor) {
  const index = Number(floor?.index);
  if (Number.isInteger(index)) {
    return {endpointFloor: floor?.version?.floor, endpointIndex: index - 1};
  }
  const floorNumber = Number(floor?.version?.floor);
  if (Number.isFinite(floorNumber)) return {endpointFloor: floorNumber - 1};
  // A missing Floor boundary cannot safely expose an existing storyline.
  // Keep the read fail-closed instead of allowing the current endpoint through.
  return {endpointFloor: -1, endpointIndex: -1};
}
const MAX_SIGNAL_EVIDENCE_LENGTH = 500;
function readableSignalEvidence(triggeredItem, events = []) {
  const eventMap = new Map((Array.isArray(events) ? events : []).map(event => [event?.event_id, event]));
  const eventIds = Array.isArray(triggeredItem?.event_ids) ? triggeredItem.event_ids : [];
  return [...new Set(eventIds.flatMap(eventId => {
    const sourceEvidence = eventMap.get(eventId)?.source_evidence;
    const entries = Array.isArray(sourceEvidence) ? sourceEvidence : [sourceEvidence];
    return entries.map(entry => typeof entry === 'string' ? entry : entry?.text).map(value => text(value).slice(0, MAX_SIGNAL_EVIDENCE_LENGTH)).filter(Boolean);
  }))];
}
function readableTriggeredSignals(trigger, events) {
  return (trigger?.triggered ?? []).map(item => ({
    reaction_concept: item.reaction_concept,
    evidence: readableSignalEvidence(item, events),
  }));
}
export function createProjectionStorylineRuntime({analyzer, getProjectionViews, saveProjectionStorylineSnapshotBatch, saveProjectionStorylineDelivery = null, readStoryBodyByFloorVersion = null, archiveAndReleasePregnancy = null, resolveCurrentFloor, getChatId = () => null, enabledResolver = () => true, diagnostics = null, trace = () => {}} = {}) {
  if (typeof analyzer?.generateStoryline !== 'function') throw new TypeError('STORYLINE_ANALYZER_REQUIRED');
  if (typeof getProjectionViews !== 'function' || typeof saveProjectionStorylineSnapshotBatch !== 'function') throw new TypeError('STORYLINE_PERSISTENCE_REQUIRED');
  const inFlight = new Map();
  const requestControllers = new Map();
  let destroyed = false;
  let cancellationEpoch = 0;
  const isCancelled = error => error?.code === 'REQUEST_ABORTED' || error?.name === 'AbortError' || error?.aborted === true;
  const cancellationError = () => {
    const error = new Error('REQUEST_ABORTED');
    error.code = 'REQUEST_ABORTED';
    error.aborted = true;
    return error;
  };
  const emit = payload => {
    try { diagnostics?.recordStorylineTrace?.({...payload, chat_id: payload.chat_id ?? getChatId?.()}); } catch { /* fail-open */ }
    try { trace({stage: `STORYLINE_${payload.stage ?? 'TRACE'}`, ...payload}); } catch { /* fail-open */ }
  };

  async function recordSubmission({floor, subjectId, displayName = null, contextFingerprint = null, generationId = null} = {}) {
    if (typeof saveProjectionStorylineDelivery !== 'function' || !floor?.version || !text(subjectId)) return {status: 'unsupported'};
    const delivery = {kind: 'submission', subject_id: subjectId, response_id: generationId || floor.version.content_hash, context_fingerprint: contextFingerprint};
    emit({stage: 'CONTEXT_SUBMISSION_RECEIPT', floor_version: floor.version, subject_id: subjectId, display_name: displayName, phase: 'submission', status: 'started', delivery, io: {fingerprint: contextFingerprint}});
    try {
      const result = await saveProjectionStorylineDelivery({chatId: floor.version.chat_id, ownerFloor: {message_index: floor.index, message_id: floor.version.message_id}, floorVersion: floor.version, record: delivery});
      emit({stage: 'CONTEXT_SUBMISSION_RECEIPT', floor_version: floor.version, subject_id: subjectId, display_name: displayName, phase: 'submission', status: 'succeeded', result: result?.status, delivery, io: {fingerprint: contextFingerprint}});
      return result;
    } catch (error) {
      emit({stage: 'CONTEXT_SUBMISSION_RECEIPT', floor_version: floor.version, subject_id: subjectId, display_name: displayName, phase: 'submission', status: 'failed', error_code: error?.code ?? error?.message ?? 'STORYLINE_SUBMISSION_FAILED', delivery, io: {fingerprint: contextFingerprint}});
      throw error;
    }
  }

  async function saveVerified({chatId, floor, snapshots, generation, reason, expectedSiblings = []}) {
    emit({stage: 'SNAPSHOT_WRITE', floor_version: floor.version, phase: reason, status: 'started', reason, snapshot: snapshots[0], counts: {write: snapshots.length + expectedSiblings.length}});
    let result;
    try {
      result = await saveProjectionStorylineSnapshotBatch({chatId, ownerFloor: {message_index: floor.index, message_id: floor.version.message_id}, floorVersion: floor.version, snapshots, traceContext: {generation, reason}});
    } catch (error) {
      emit({stage: 'SNAPSHOT_WRITE', floor_version: floor.version, phase: reason, status: 'failed', reason, error_code: error?.code ?? error?.message ?? 'STORYLINE_SNAPSHOT_WRITE_FAILED', snapshot: snapshots[0]});
      throw error;
    }
    emit({stage: 'SNAPSHOT_WRITE', floor_version: floor.version, phase: reason, status: 'succeeded', reason, result: result?.status ?? 'appended', snapshot: snapshots[0], counts: {write: snapshots.length + expectedSiblings.length}});
    emit({stage: 'SNAPSHOT_READBACK', floor_version: floor.version, phase: reason, status: 'started', reason, snapshot: snapshots[0], counts: {read: 1}});
    let readback;
    try {
      readback = await getProjectionViews({chatId, endpointFloor: floor.version.floor, endpointIndex: floor.index});
    } catch (error) {
      emit({stage: 'SNAPSHOT_READBACK', floor_version: floor.version, phase: reason, status: 'failed', reason, error_code: error?.code ?? error?.message ?? 'STORYLINE_READBACK_FAILED', snapshot: snapshots[0]});
      throw error;
    }
    const bySubject = new Map((readback.storyline_snapshots ?? []).map(item => [item.subject_id, item]));
    // The persistence layer writes a complete current-Floor sibling batch and
    // therefore refreshes every sibling's owner version and digest. Normalize
    // the expected siblings to this write's Floor before comparing readback.
    const normalizedSiblings = expectedSiblings.map(item => createStorylineSnapshot({...item, created_at_floor_version: floor.version}));
    const expectedBySubject = new Map([...normalizedSiblings, ...snapshots].map(item => [item.subject_id, item]));
    if (bySubject.size !== expectedBySubject.size) {
      emit({stage: 'SNAPSHOT_READBACK', floor_version: floor.version, phase: reason, status: 'mismatch', reason, error_code: 'STORYLINE_READBACK_MISMATCH', snapshot: snapshots[0], counts: {read: bySubject.size}});
      throw new Error('STORYLINE_READBACK_MISMATCH');
    }
    for (const expected of expectedBySubject.values()) {
      const actual = bySubject.get(expected.subject_id);
      if (!actual
        || actual.snapshot_id !== expected.snapshot_id
        || actual.status !== expected.status
        || (actual.branches ?? []).length !== (expected.branches ?? []).length) {
        emit({stage: 'SNAPSHOT_READBACK', floor_version: floor.version, phase: reason, status: 'mismatch', reason, error_code: 'STORYLINE_READBACK_MISMATCH', snapshot: expected, counts: {read: bySubject.size}});
        throw new Error('STORYLINE_READBACK_MISMATCH');
      }
    }
    emit({stage: 'SNAPSHOT_READBACK', floor_version: floor.version, phase: reason, status: 'succeeded', reason, snapshot: snapshots[0], counts: {read: bySubject.size}});
    return result;
  }

  async function settled({inputs = null, responseId = null, body = '', settled = false, generation = null} = {}) {
    const settleEpoch = cancellationEpoch;
    const wasCancelled = () => destroyed || settleEpoch !== cancellationEpoch;
    if (destroyed || enabledResolver() === false || settled !== true) {
      emit({stage: 'SETTLE_REJECTED', phase: 'settle', status: 'rejected', reason: destroyed ? 'destroyed' : settled !== true ? 'not_settled' : 'disabled'});
      return {status: 'not_settled'};
    }
    const floor = inputs?.floor ?? await resolveCurrentFloor();
    if (!floor?.version || String(floor.version.chat_id) !== String(getChatId?.() ?? floor.version.chat_id)) {
      emit({stage: 'SETTLE_REJECTED', phase: 'settle', status: 'rejected', reason: 'stale', floor_version: floor?.version ?? null});
      return {status: 'stale'};
    }
    emit({stage: 'SETTLE_ACCEPTED', phase: 'settle', status: 'accepted', floor_version: floor.version, counts: {input: 1}});
    const chatId = floor.version.chat_id;
    emit({stage: 'INPUT_READ', phase: 'input', status: 'succeeded', floor_version: floor.version, counts: {read: 1}, io: {length: typeof body === 'string' ? body.length : 0}});
    emit({stage: 'PROJECTION_VIEWS_READ', phase: 'read', status: 'started', floor_version: floor.version, counts: {read: 1}});
    let views;
    try {
      views = await getProjectionViews({chatId, endpointFloor: floor.version.floor, endpointIndex: floor.index});
      emit({stage: 'PROJECTION_VIEWS_READ', phase: 'read', status: 'succeeded', floor_version: floor.version, counts: {read: 1, triggered: (views.triggered_snapshots ?? []).length, storyline: (views.storyline_snapshots ?? []).length, delivery: (views.storyline_delivery_records ?? []).length}});
    } catch (error) {
      emit({stage: 'PROJECTION_VIEWS_READ', phase: 'read', status: 'failed', floor_version: floor.version, error_code: error?.code ?? error?.message ?? 'STORYLINE_VIEWS_READ_FAILED', counts: {read: 1}});
      throw error;
    }
    // Triggered state belongs to the current settled Floor, but storyline
    // existence is intentionally resolved from the previous endpoint. A
    // current-Floor analysis may be rerun, and its old storyline snapshot
    // must not suppress a fresh design request for that same Floor.
    let previousViews;
    try {
      previousViews = await getProjectionViews({chatId, ...previousStorylineEndpoint(floor)});
      emit({stage: 'PROJECTION_VIEWS_READ', phase: 'read', status: 'succeeded', floor_version: floor.version, result: 'previous_endpoint', counts: {read: 1, storyline: (previousViews.storyline_snapshots ?? []).length, delivery: (previousViews.storyline_delivery_records ?? []).length}});
    } catch (error) {
      emit({stage: 'PROJECTION_VIEWS_READ', phase: 'read', status: 'failed', floor_version: floor.version, result: 'previous_endpoint', error_code: error?.code ?? error?.message ?? 'STORYLINE_PREVIOUS_VIEWS_READ_FAILED', counts: {read: 1}});
      throw error;
    }
    const previousSnapshots = new Map((previousViews.storyline_snapshots ?? []).map(item => [item.subject_id, normalizeStorylineSnapshot(item)]));
    const currentSnapshots = new Map((views.storyline_snapshots ?? []).map(item => [item.subject_id, normalizeStorylineSnapshot(item)]));
    // Current-Floor data is excluded only from the design-existence check.
    // Factual closure and response progression must continue from the latest
    // current endpoint state, including a snapshot written earlier in this
    // same Floor.  The previous endpoint remains the fallback for a mock or
    // legacy view that has not exposed the current complete collection yet.
    const snapshots = new Map([...previousSnapshots.entries(), ...currentSnapshots.entries()]);
    const snapshotSiblings = subjectId => {
      // Read from the mutable working map so a multi-subject settle keeps a
      // subject already replaced earlier in this same Floor write batch.
      const siblings = new Map(snapshots.values().map(item => [item.subject_id, item]));
      siblings.delete(subjectId);
      return [...siblings.values()];
    };
    const triggered = new Map((views.triggered_snapshots ?? []).filter(item => item.status === 'active' && (item.triggered ?? []).length).map(item => [item.subject_id, item]));
    const subjects = subjectsFrom(inputs);
    const factualEvents = (inputs?.events ?? []).filter(event => event?.status === 'confirmed' && (event?.type === 'pregnancy_confirmation' || (event?.type === 'pregnancy_lifecycle' && event?.state_fact?.payload?.status === 'not_pregnant')));
    const factualSubjects = new Set(factualEvents.flatMap(event => event?.state_fact?.subject_id ? [event.state_fact.subject_id] : event?.pregnancy_relevance?.gestational_subject_ids ?? []));
    for (const subjectId of factualSubjects) {
      const existing = snapshots.get(subjectId);
      if (!existing || existing.status === 'terminated') continue;
      const subject = subjects.find(item => item.subject_id === subjectId) ?? {display_name: ''};
      const notPregnant = factualEvents.some(event => event?.type === 'pregnancy_lifecycle' && event?.state_fact?.payload?.status === 'not_pregnant' && (event?.state_fact?.subject_id === subjectId || event?.pregnancy_relevance?.gestational_subject_ids?.includes(subjectId)));
      if (notPregnant) {
        emit({stage: 'NOT_PREGNANT_BINDING', floor_version: floor.version, subject_id: subjectId, display_name: subject.display_name, phase: 'closure', status: 'started'});
        if (typeof archiveAndReleasePregnancy !== 'function') {
          emit({stage: 'NOT_PREGNANT_BINDING', floor_version: floor.version, subject_id: subjectId, display_name: subject.display_name, phase: 'closure', status: 'failed', error_code: 'ARCHIVE_RELEASE_UNAVAILABLE'});
          continue;
        }
        const rawFactEvent = factualEvents.find(event => event?.type === 'pregnancy_lifecycle'
          && event?.state_fact?.payload?.status === 'not_pregnant'
          && (event?.state_fact?.subject_id === subjectId || event?.pregnancy_relevance?.gestational_subject_ids?.includes(subjectId)));
        const rawPayload = rawFactEvent?.state_fact?.payload ?? {};
        const aggregation = (inputs.participantAggregations ?? []).find(item => item?.subject_id === subjectId && item.status === 'succeeded' && item?.cycle_id === rawPayload.cycle_id);
        if (!aggregation) {
          emit({stage: 'NOT_PREGNANT_BINDING', floor_version: floor.version, subject_id: subjectId, display_name: subject.display_name, phase: 'closure', status: 'failed', error_code: 'ACTIVE_AGGREGATION_NOT_FOUND'});
          trace({stage: 'STORYLINE_CLOSURE_DEFERRED', subject_id: subjectId, error_code: 'ACTIVE_AGGREGATION_NOT_FOUND'});
          continue;
        }
        const fact = rawFactEvent?.type === 'pregnancy_lifecycle'
          ? normalizePregnancyLifecycleFact({subject_id: subjectId, pregnancy_id: null, cycle_id: aggregation.cycle_id, status: 'not_pregnant', source_event_id: rawFactEvent.event_id, evidence_refs: rawPayload.evidence_refs ?? [], source_floor_version: floor.version})
          : null;
        if (!fact || !validatePregnancyLifecycleFact(fact).ok) {
          emit({stage: 'NOT_PREGNANT_BINDING', floor_version: floor.version, subject_id: subjectId, display_name: subject.display_name, phase: 'closure', status: 'failed', error_code: 'INVALID_NOT_PREGNANT_FACT'});
          continue;
        }
        emit({stage: 'NOT_PREGNANT_BINDING', floor_version: floor.version, subject_id: subjectId, display_name: subject.display_name, phase: 'closure', status: 'succeeded', result: 'canonical_fact_validated'});
        try {
          emit({stage: 'NOT_PREGNANT_RELEASE', floor_version: floor.version, subject_id: subjectId, display_name: subject.display_name, phase: 'closure', status: 'started', result: 'archive_delete_release_readback_pending'});
          await archiveAndReleasePregnancy({ownerFloor: {message_index: floor.index, message_id: floor.version.message_id}, floorVersion: floor.version, aggregation, fact, closureReason: 'confirmed_not_pregnant', operationKey: `storyline-not-pregnant:${subjectId}:${aggregation.aggregation_id}`});
          emit({stage: 'NOT_PREGNANT_RELEASE', floor_version: floor.version, subject_id: subjectId, display_name: subject.display_name, phase: 'closure', status: 'succeeded', result: 'archive_delete_release_verified'});
        } catch (error) {
          emit({stage: 'NOT_PREGNANT_RELEASE', floor_version: floor.version, subject_id: subjectId, display_name: subject.display_name, phase: 'closure', status: 'failed', error_code: error?.code ?? error?.message ?? 'STORYLINE_CLOSURE_DEFERRED'});
          trace({stage: 'STORYLINE_CLOSURE_DEFERRED', subject_id: subjectId, error_code: error?.code ?? error?.message}); continue;
        }
      }
      const terminal = emptyStorylineSnapshot({subject_id: subjectId, display_name: subject.display_name, created_at_floor_version: floor.version});
      await saveVerified({chatId, floor, snapshots: [terminal], expectedSiblings: snapshotSiblings(subjectId), generation, reason: 'factual-closure'});
      snapshots.set(subjectId, terminal);
    }
    for (const [subjectId, trigger] of triggered) {
      if (wasCancelled()) return {status: 'cancelled'};
      if (!subjects.some(item => item.subject_id === subjectId)) subjects.push({subject_id: subjectId, display_name: ''});
      const subject = subjects.find(item => item.subject_id === subjectId);
      let snapshot = snapshots.get(subjectId);
      const key = `${chatId}:${subjectId}:${floor.version.message_id}:${floor.version.message_version}`;
      // Only the state at the previous endpoint answers whether this subject
      // already has storyline data. A stale non-terminal snapshot already
      // written to the current Floor must not suppress a same-Floor design
      // replacement; a current terminal tombstone remains authoritative.
      if (!previousSnapshots.has(subjectId) && snapshot?.status !== 'terminated') {
        if (wasCancelled()) return {status: 'cancelled'};
        if (inFlight.has(key)) continue;
        const controller = new AbortController();
        requestControllers.set(key, controller);
        let designApiStarted = false;
        let designApiCompleted = false;
        const request = (async () => {
          emit({stage: 'DESIGN_REQUEST', floor_version: floor.version, subject_id: subjectId, display_name: subject.display_name, phase: 'design', status: 'started', counts: {input: 1}});
          emit({stage: 'PROMPT_BUILD', floor_version: floor.version, subject_id: subjectId, display_name: subject.display_name, phase: 'design', status: 'started'});
          let messages;
          let promptSummary;
          try {
            messages = buildStorylineDesignMessages({
              displayName: subject.display_name,
              aliases: subject.aliases,
              characterContext: inputs?.characterProfiles?.[subjectId] ?? {},
              worldContext: inputs?.worldModel ?? {},
              worldbooks: inputs?.worldbooks ?? [],
              // Keep this structured until the storyline formatter so collection
              // items render as `- 内容` rather than a standalone `-` line.
              otherReferenceData: inputs?.otherReferenceData ?? {},
              externalMemory: inputs?.externalMemory ?? inputs?.external_memory ?? [],
              recentStory: inputs?.storyContext ?? floor.narrative ?? '',
              triggeredSignals: readableTriggeredSignals(trigger, inputs?.events),
            });
            promptSummary = promptTraceSummary(messages);
            emit({stage: 'PROMPT_BUILD', floor_version: floor.version, subject_id: subjectId, display_name: subject.display_name, phase: 'design', status: 'succeeded', message_summary: promptSummary});
          } catch (error) {
            emit({stage: 'PROMPT_BUILD', floor_version: floor.version, subject_id: subjectId, display_name: subject.display_name, phase: 'design', status: 'failed', error_code: error?.code ?? error?.message ?? 'STORYLINE_PROMPT_BUILD_FAILED'});
            throw error;
          }
          emit({stage: 'API_REQUEST', floor_version: floor.version, subject_id: subjectId, display_name: subject.display_name, phase: 'design', status: 'started', api_assignment: 'projection', projection_route: 'projection', message_summary: promptSummary});
          designApiStarted = true;
          const raw = await analyzer.generateStoryline({messages, response_format_capability: true, signal: controller.signal, onStorylineTrace: payload => emit({stage: 'API_ROUTE', floor_version: floor.version, subject_id: subjectId, display_name: subject.display_name, phase: 'design', status: 'selected', ...payload})});
          if (controller.signal.aborted) throw cancellationError();
          emit({stage: 'API_REQUEST', floor_version: floor.version, subject_id: subjectId, display_name: subject.display_name, phase: 'design', status: 'completed', api_assignment: 'projection', projection_route: 'projection', message_summary: promptSummary, response: responseTraceSummary(raw)});
          designApiCompleted = true;
          emit({stage: 'DESIGN_REQUEST', floor_version: floor.version, subject_id: subjectId, display_name: subject.display_name, phase: 'design', status: 'completed', counts: {output: 1}, io: {length: typeof raw === 'string' ? raw.length : 0}});
          const currentFloor = await resolveCurrentFloor();
          if (!sameVersion(currentFloor?.version, floor.version)) throw new Error('STORYLINE_DESIGN_STALE');
          let created;
          try { created = parseStorylineDesignResponse(raw, {subjectId, displayName: subject.display_name, floorVersion: floor.version}); }
          catch (error) {
            emit({stage: 'DESIGN_PARSE', floor_version: floor.version, subject_id: subjectId, display_name: subject.display_name, phase: 'design', status: 'failed', response_shape: responseTraceSummary(raw).shape, parse_outcome: 'rejected', error_code: error?.code ?? error?.message ?? 'STORYLINE_DESIGN_PARSE_FAILED'});
            throw error;
          }
          emit({stage: 'DESIGN_PARSE', floor_version: floor.version, subject_id: subjectId, display_name: subject.display_name, phase: 'design', status: 'succeeded', result: 'validated_snapshot', response_shape: responseTraceSummary(raw).shape, parse_outcome: 'validated_snapshot', snapshot: created, counts: {output: 1}});
          await saveVerified({chatId, floor, snapshots: [created], expectedSiblings: snapshotSiblings(subjectId), generation, reason: 'design'});
          snapshots.set(subjectId, created);
          return created;
        })();
        inFlight.set(key, request);
        try {
          snapshot = await request;
        } catch (error) {
          if (designApiStarted && !designApiCompleted) emit({stage: 'API_REQUEST', floor_version: floor.version, subject_id: subjectId, display_name: subject.display_name, phase: 'design', status: isCancelled(error) || controller.signal.aborted ? 'cancelled' : 'failed', api_assignment: 'projection', projection_route: 'projection', error_code: error?.code ?? error?.message ?? 'STORYLINE_API_REQUEST_FAILED'});
          emit({stage: 'DESIGN_REQUEST', floor_version: floor.version, subject_id: subjectId, display_name: subject.display_name, phase: 'design', status: isCancelled(error) || controller.signal.aborted ? 'cancelled' : 'failed', error_code: error?.code ?? error?.message ?? 'STORYLINE_DESIGN_FAILED'});
          trace({stage: isCancelled(error) || controller.signal.aborted ? 'STORYLINE_DESIGN_CANCELLED' : 'STORYLINE_DESIGN_FAILED', subject_id: subjectId, error_code: error?.code ?? error?.message});
          continue;
        } finally { inFlight.delete(key); requestControllers.delete(key); }
      }
      if (!snapshot || !text(responseId)) continue;
      // A submission receipt is the proof that the storyline was injected
      // before this response. The current endpoint may include historical
      // receipts, so read from it and exclude receipts created on this Floor;
      // a same-Floor reanalysis must not count its own new context as prior
      // evidence for the body being settled now.
      const priorSubmission = [...(views.storyline_delivery_records ?? [])]
        .filter(item => item.subject_id === subjectId && item.kind === 'submission' && !sameVersion(item.created_at_floor_version, floor.version))
        .sort((a, b) => Number(a.created_at_floor_version?.floor) - Number(b.created_at_floor_version?.floor)
          || String(a.created_at_floor_version?.message_id ?? '').localeCompare(String(b.created_at_floor_version?.message_id ?? '')))
        .at(-1);
      if (!priorSubmission?.context_fingerprint) continue;
      if (typeof saveProjectionStorylineDelivery === 'function') {
        const delivery = {kind: 'response', subject_id: subjectId, response_id: responseId, context_fingerprint: priorSubmission.context_fingerprint};
        emit({stage: 'RESPONSE_RECEIPT', floor_version: floor.version, subject_id: subjectId, display_name: subject.display_name, phase: snapshot.status === 'candidates' ? 'selection' : 'progression', status: 'started', delivery: {...delivery, floor_version: floor.version}});
        try {
          await saveProjectionStorylineDelivery({chatId, ownerFloor: {message_index: floor.index, message_id: floor.version.message_id}, floorVersion: floor.version, record: delivery});
          emit({stage: 'RESPONSE_RECEIPT', floor_version: floor.version, subject_id: subjectId, display_name: subject.display_name, phase: snapshot.status === 'candidates' ? 'selection' : 'progression', status: 'succeeded', delivery: {...delivery, floor_version: floor.version}});
        } catch (error) {
          emit({stage: 'RESPONSE_RECEIPT', floor_version: floor.version, subject_id: subjectId, display_name: subject.display_name, phase: snapshot.status === 'candidates' ? 'selection' : 'progression', status: 'failed', error_code: error?.code ?? error?.message ?? 'STORYLINE_RESPONSE_RECEIPT_FAILED', delivery: {...delivery, floor_version: floor.version}});
          continue;
        }
      }
      const deliveryViews = await getProjectionViews({chatId, endpointFloor: floor.version.floor, endpointIndex: floor.index});
      const alreadyCounted = snapshot.counted_response_ids.includes(responseId);
      const counted = recordStorylineBody(snapshot, responseId);
      if (!alreadyCounted && counted.valid_body_count !== snapshot.valid_body_count) {
      await saveVerified({chatId, floor, snapshots: [counted], expectedSiblings: snapshotSiblings(subjectId), generation, reason: 'body-count'});
      snapshots.set(subjectId, counted);
      }
      if (!storylineJudgeDue(counted)) continue;
      if (wasCancelled()) return {status: 'cancelled'};
      const responseReceipts = (deliveryViews.storyline_delivery_records ?? []).filter(item => item.subject_id === subjectId && item.kind === 'response' && counted.counted_response_ids.includes(item.response_id));
      emit({stage: 'BODY_READ', floor_version: floor.version, subject_id: subjectId, display_name: subject.display_name, phase: snapshot.status === 'candidates' ? 'selection' : 'progression', status: 'started', counts: {read: responseReceipts.length}, io: {floor_refs: responseReceipts.length}});
      let bodies = [];
      try {
        bodies = typeof readStoryBodyByFloorVersion === 'function' ? await Promise.all(responseReceipts.map(item => readStoryBodyByFloorVersion(item.floor_version))) : [];
        emit({stage: 'BODY_READ', floor_version: floor.version, subject_id: subjectId, display_name: subject.display_name, phase: snapshot.status === 'candidates' ? 'selection' : 'progression', status: bodies.length === 2 ? 'succeeded' : 'failed', counts: {read: bodies.length}, io: {floor_refs: responseReceipts.length, length: bodies.reduce((sum, item) => sum + (typeof item === 'string' ? item.length : 0), 0), body_refs: responseReceipts.map((receipt, index) => ({floor_version: receipt.floor_version, response_id: receipt.response_id, status: typeof bodies[index] === 'string' && bodies[index].trim() ? 'succeeded' : 'failed', length: typeof bodies[index] === 'string' ? bodies[index].length : 0}))}});
      } catch (error) {
        emit({stage: 'BODY_READ', floor_version: floor.version, subject_id: subjectId, display_name: subject.display_name, phase: snapshot.status === 'candidates' ? 'selection' : 'progression', status: 'failed', error_code: error?.code ?? error?.message ?? 'STORYLINE_BODY_READ_FAILED', counts: {read: 0}, io: {floor_refs: responseReceipts.length, body_refs: responseReceipts.map(receipt => ({floor_version: receipt.floor_version, response_id: receipt.response_id, status: 'failed', length: 0}))}});
      }
      if (bodies.length !== 2 || bodies.some(item => typeof item !== 'string' || !item.trim())) continue;
      emit({stage: 'CADENCE_DUE', floor_version: floor.version, subject_id: subjectId, display_name: subject.display_name, phase: snapshot.status === 'candidates' ? 'selection' : 'progression', status: 'due', due_attempt_id: counted.due_attempt_id, counts: {input: 2}});
      emit({stage: 'PROMPT_BUILD', floor_version: floor.version, subject_id: subjectId, display_name: subject.display_name, phase: snapshot.status === 'candidates' ? 'selection' : 'progression', status: 'started'});
        let judgeMessages;
      let judgePromptSummary;
      try {
        judgeMessages = buildStorylineJudgeMessages({
          snapshot: counted,
          body: bodies.map((item, index) => `正文${index + 1}：${item}`).join('\n'),
          triggeredSignals: readableTriggeredSignals(trigger, inputs?.events),
          characterContext: inputs?.characterProfiles?.[subjectId] ?? {},
          worldContext: inputs?.worldModel ?? {},
          worldbooks: inputs?.worldbooks ?? [],
          otherReferenceData: inputs?.otherReferenceData ?? {},
          externalMemory: inputs?.externalMemory ?? inputs?.external_memory ?? [],
        });
        judgePromptSummary = promptTraceSummary(judgeMessages);
        emit({stage: 'PROMPT_BUILD', floor_version: floor.version, subject_id: subjectId, display_name: subject.display_name, phase: snapshot.status === 'candidates' ? 'selection' : 'progression', status: 'succeeded', message_summary: judgePromptSummary});
      } catch (error) {
        emit({stage: 'PROMPT_BUILD', floor_version: floor.version, subject_id: subjectId, display_name: subject.display_name, phase: snapshot.status === 'candidates' ? 'selection' : 'progression', status: 'failed', error_code: error?.code ?? error?.message ?? 'STORYLINE_PROMPT_BUILD_FAILED'});
        throw error;
      }
      const phase = snapshot.status === 'candidates' ? 'selection' : 'progression';
      let apiStarted = false;
      let apiCompleted = false;
      try {
        emit({stage: 'JUDGE_REQUEST', floor_version: floor.version, subject_id: subjectId, display_name: subject.display_name, phase, status: 'started', attempt_id: counted.due_attempt_id, due_attempt_id: counted.due_attempt_id, counts: {input: 2}});
        emit({stage: 'API_REQUEST', floor_version: floor.version, subject_id: subjectId, display_name: subject.display_name, phase, status: 'started', api_assignment: 'projection', projection_route: 'projection', message_summary: judgePromptSummary, attempt_id: counted.due_attempt_id, due_attempt_id: counted.due_attempt_id});
        apiStarted = true;
        const judgeKey = `judge:${chatId}:${subjectId}:${counted.due_attempt_id}`;
        const controller = new AbortController();
        requestControllers.set(judgeKey, controller);
        const raw = await analyzer.generateStoryline({messages: judgeMessages, response_format_capability: true, signal: controller.signal, onStorylineTrace: payload => emit({stage: 'API_ROUTE', floor_version: floor.version, subject_id: subjectId, display_name: subject.display_name, phase, status: 'selected', ...payload, attempt_id: counted.due_attempt_id, due_attempt_id: counted.due_attempt_id})});
        if (controller.signal.aborted) throw cancellationError();
        emit({stage: 'API_REQUEST', floor_version: floor.version, subject_id: subjectId, display_name: subject.display_name, phase, status: 'completed', api_assignment: 'projection', projection_route: 'projection', message_summary: judgePromptSummary, response: responseTraceSummary(raw), attempt_id: counted.due_attempt_id, due_attempt_id: counted.due_attempt_id});
        apiCompleted = true;
        const currentFloor = await resolveCurrentFloor();
        if (!sameVersion(currentFloor?.version, floor.version)) throw new Error('STORYLINE_JUDGE_STALE');
        const currentViews = await getProjectionViews({chatId, endpointFloor: floor.version.floor, endpointIndex: floor.index});
        const currentSnapshot = (currentViews.storyline_snapshots ?? []).find(item => item.subject_id === subjectId);
        if (!currentSnapshot || currentSnapshot.snapshot_id !== counted.snapshot_id) throw new Error('STORYLINE_JUDGE_REVISION_STALE');
        let next;
        try { next = parseStorylineJudgeResponse(raw, counted); }
        catch (error) {
          emit({stage: 'JUDGE_PARSE', floor_version: floor.version, subject_id: subjectId, display_name: subject.display_name, phase, status: 'failed', response_shape: responseTraceSummary(raw).shape, parse_outcome: 'rejected', error_code: error?.code ?? error?.message ?? 'STORYLINE_JUDGE_PARSE_FAILED', attempt_id: counted.due_attempt_id, due_attempt_id: counted.due_attempt_id});
          throw error;
        }
        emit({stage: 'JUDGE_PARSE', floor_version: floor.version, subject_id: subjectId, display_name: subject.display_name, phase, status: 'succeeded', response_shape: responseTraceSummary(raw).shape, parse_outcome: next.status, attempt_id: counted.due_attempt_id, due_attempt_id: counted.due_attempt_id});
        emit({stage: 'JUDGE_REQUEST', floor_version: floor.version, subject_id: subjectId, display_name: subject.display_name, phase: snapshot.status === 'candidates' ? 'selection' : 'progression', status: 'completed', result: next.status, attempt_id: counted.due_attempt_id, due_attempt_id: counted.due_attempt_id, counts: {output: 1}});
        await saveVerified({chatId, floor, snapshots: [next], expectedSiblings: snapshotSiblings(subjectId), generation, reason: 'judge'});
        snapshots.set(subjectId, next);
      } catch (error) {
        if (apiStarted && !apiCompleted) emit({stage: 'API_REQUEST', floor_version: floor.version, subject_id: subjectId, display_name: subject.display_name, phase, status: isCancelled(error) ? 'cancelled' : 'failed', api_assignment: 'projection', projection_route: 'projection', error_code: error?.code ?? error?.message ?? 'STORYLINE_API_REQUEST_FAILED', attempt_id: counted.due_attempt_id, due_attempt_id: counted.due_attempt_id});
        emit({stage: 'JUDGE_RETRY', floor_version: floor.version, subject_id: subjectId, display_name: subject.display_name, phase: snapshot.status === 'candidates' ? 'selection' : 'progression', status: isCancelled(error) ? 'cancelled' : 'failed', error_code: error?.code ?? error?.message ?? 'STORYLINE_JUDGE_FAILED', attempt_id: counted.due_attempt_id, due_attempt_id: counted.due_attempt_id, counts: {input: 2}});
        trace({stage: isCancelled(error) ? 'STORYLINE_JUDGE_CANCELLED' : 'STORYLINE_JUDGE_FAILED', subject_id: subjectId, error_code: error?.code ?? error?.message});
      } finally {
        requestControllers.delete(`judge:${chatId}:${subjectId}:${counted.due_attempt_id}`);
      }
    }
    return {status: 'processed'};
  }
  function cancelStoryline() {
    cancellationEpoch += 1;
    let cancelled = 0;
    for (const controller of requestControllers.values()) {
      if (!controller.signal.aborted) {
        controller.abort();
        cancelled += 1;
      }
    }
    return {status: cancelled ? 'cancelled' : 'idle', cancelled};
  }
  return {settled, recordSubmission, cancelStoryline, destroy: () => {destroyed = true; cancellationEpoch += 1; for (const controller of requestControllers.values()) controller.abort(); requestControllers.clear(); inFlight.clear();}};
}

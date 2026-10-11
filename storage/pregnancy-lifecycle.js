import {emptyFloor} from './schema.js';
import {floorVersionFromData, hasCompleteFloorVersion, sameFloorVersion} from '../runtime/floor.js';
import {createFloorPersistenceCoordinator} from '../runtime/floor-persistence.js';
import {
  appendPregnancyLifecycleFact,
  buildArchiveSnapshot,
  buildCandidateRecord,
  cycleLockKey,
  emptyPregnancyLifecycleTimeline,
  normalizePregnancyLifecycleTimeline,
  validatePregnancyLifecycleFact,
} from '../core/pregnancy-lifecycle.js';

function error(code, details = {}) { const result = new Error(code); result.code = code; Object.assign(result, details); return result; }
function text(value) { return typeof value === 'string' && value.trim() !== ''; }
function ownerSelector(owner = {}) { return owner.message_index ?? owner.messageId ?? owner.message_id ?? owner.index; }
function ownerSwipe(owner = {}, version = {}) { return Number(owner.swipe_id ?? owner.swipeId ?? version.swipe_id); }
function clone(value) { return typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value)); }

export function createPregnancyLifecyclePersistence({store, resolveCurrentFloorVersion = null, enabledResolver = () => true, floorPersistence = null} = {}) {
  if (!store) throw new TypeError('STORE_REQUIRED');
  const persistence = floorPersistence ?? createFloorPersistenceCoordinator({store, enabledResolver});

  async function resolveOwner(input = {}) {
    if (enabledResolver() === false) throw error('BIOWEAVE_DISABLED');
    const selector = ownerSelector(input.ownerFloor ?? input);
    const version = input.floorVersion;
    if (selector === undefined || selector === null) throw error('FLOOR_OWNER_REQUIRED');
    if (!hasCompleteFloorVersion(version)) throw error('FLOOR_VERSION_REQUIRED');
    const swipeId = ownerSwipe(input.ownerFloor ?? input, version);
    if (!Number.isInteger(swipeId) || swipeId < 0 || store.getActiveSwipeId?.(selector) !== swipeId) throw error('FLOOR_SWIPE_STALE');
    const floorData = store.getFloor(selector, swipeId) ?? emptyFloor();
    if (!sameFloorVersion(floorVersionFromData(floorData), version)) throw error('FLOOR_VERSION_STALE');
    if (typeof resolveCurrentFloorVersion !== 'function' || !sameFloorVersion(await resolveCurrentFloorVersion({ownerFloor: {message_index: selector, message_id: version.message_id}, floorVersion: version, swipeId}), version)) throw error('FLOOR_VERSION_STALE');
    return {selector, swipeId, version, floorData, chatId: version.chat_id};
  }

  async function commitTimeline(resolved, timeline, operationType = 'pregnancy-lifecycle-patch', extra = {}) {
    return persistence.commitFloorPatch({
      owner: 'lifecycle',
      chatId: resolved.chatId,
      ownerFloor: {message_index: resolved.selector, message_id: resolved.version.message_id},
      swipeId: resolved.swipeId,
      floorVersion: resolved.version,
      patch: {pregnancy_lifecycle_timeline: timeline, ...extra},
      operation_type: operationType,
    });
  }

  async function appendFact({ownerFloor, floorVersion, fact} = {}) {
    const resolved = await resolveOwner({ownerFloor, floorVersion});
    const result = appendPregnancyLifecycleFact(resolved.floorData.pregnancy_lifecycle_timeline, fact);
    if (result.status === 'conflict' || result.status === 'fact_conflict') throw error('PREGNANCY_LIFECYCLE_FACT_CONFLICT');
    if (result.status === 'deduped') return result;
    await commitTimeline(resolved, result.timeline, 'pregnancy-lifecycle-fact-patch');
    return result;
  }

  async function saveCandidateRecord({ownerFloor, floorVersion, candidateRecord} = {}) {
    const resolved = await resolveOwner({ownerFloor, floorVersion});
    const timeline = normalizePregnancyLifecycleTimeline(resolved.floorData.pregnancy_lifecycle_timeline);
    const existing = timeline.candidate_records.find(item => item.candidate_record_id === candidateRecord?.candidate_record_id);
    if (existing) return {status: JSON.stringify(existing) === JSON.stringify(candidateRecord) ? 'deduped' : 'conflict', timeline};
    const next = {...timeline, candidate_records: [...timeline.candidate_records, clone(candidateRecord)]};
    await commitTimeline(resolved, next, 'pregnancy-candidate-patch');
    return {status: 'appended', timeline: next};
  }

  async function confirmFather({ownerFloor, floorVersion, subjectId, pregnancyId = null, cycleId, confirmedFactId = null} = {}) {
    const resolved = await resolveOwner({ownerFloor, floorVersion});
    const timeline = normalizePregnancyLifecycleTimeline(resolved.floorData.pregnancy_lifecycle_timeline);
    const matching = timeline.candidate_records.filter(item => item.subject_id === subjectId && (item.pregnancy_id ?? null) === (pregnancyId ?? null) && item.cycle_id === cycleId);
    const next = {...timeline, candidate_records: timeline.candidate_records.filter(item => !matching.includes(item))};
    next.release_records = [...next.release_records, {operation_key: `father-confirmed:${subjectId}:${pregnancyId ?? 'none'}:${cycleId}`, action: 'candidate-cleaned', subject_id: subjectId, pregnancy_id: pregnancyId, cycle_id: cycleId, confirmed_fact_id: confirmedFactId, created_at_floor_version: clone(resolved.version)}];
    await commitTimeline(resolved, next, 'pregnancy-candidate-confirmed-patch');
    return {status: matching.length ? 'cleaned' : 'deduped', timeline: next};
  }

  async function archiveAndRelease({ownerFloor, floorVersion, fact = null, closureReason = null, aggregation = null, candidateRecord = null, fatherStatus = 'unknown', operationKey = null} = {}) {
    const factResult = fact ? validatePregnancyLifecycleFact(fact) : {ok: false, value: null};
    if (fact && !factResult.ok) throw error('PREGNANCY_LIFECYCLE_FACT_INVALID', {details: factResult.errors});
    if (fact && !['not_pregnant', 'miscarriage', 'termination', 'delivery'].includes(factResult.value.status)) throw error('PREGNANCY_LIFECYCLE_NOT_TERMINAL');
    if (!fact && closureReason !== 'timeout_no_pregnancy') throw error('PREGNANCY_LIFECYCLE_CLOSURE_INVALID');
    const resolved = await resolveOwner({ownerFloor, floorVersion});
    let timeline = normalizePregnancyLifecycleTimeline(resolved.floorData.pregnancy_lifecycle_timeline);
    const identity = factResult.value ?? {subject_id: aggregation?.subject_id, pregnancy_id: aggregation?.pregnancy_id ?? null, cycle_id: aggregation?.cycle_id};
    const candidate = candidateRecord ?? timeline.candidate_records.find(item => item.subject_id === identity.subject_id && (item.pregnancy_id ?? null) === (identity.pregnancy_id ?? null) && item.cycle_id === identity.cycle_id) ?? null;
    const acceptedIds = [...new Set(aggregation?.accepted_exposure_event_ids ?? candidate?.source_exposure_event_ids ?? [])].filter(text).sort();
    const archive = buildArchiveSnapshot({fact: factResult.value, closureReason, aggregation, candidateRecord: candidate, floorVersion: resolved.version, exposureEventIds: acceptedIds, operationKey});
    const existingArchive = timeline.archives.find(item => item.archive_id === archive.archive_id);
    if (!existingArchive) {
      timeline = {...timeline, facts: factResult.value ? [...timeline.facts.filter(item => item.fact_id !== factResult.value.fact_id), factResult.value] : timeline.facts, archives: [...timeline.archives, archive]};
      await commitTimeline(resolved, timeline, 'pregnancy-lifecycle-archive-patch');
    }
    const archiveReadback = normalizePregnancyLifecycleTimeline(store.getFloor(resolved.selector, resolved.swipeId)?.pregnancy_lifecycle_timeline);
    if (!archiveReadback.archives.some(item => item.archive_id === archive.archive_id)) throw error('PREGNANCY_ARCHIVE_READBACK_FAILED');
    const existingRelease = archiveReadback.release_records.find(item => item.operation_key === archive.operation_key && item.action === 'cycle-lock-released');
    if (existingRelease) return {status: 'deduped', archive, deleted_event_ids: acceptedIds, lock_key: existingRelease.lock_key, timeline: archiveReadback};

    const currentEvents = Array.isArray(store.getFloor(resolved.selector, resolved.swipeId)?.events) ? store.getFloor(resolved.selector, resolved.swipeId).events : [];
    const presentIds = acceptedIds.filter(id => currentEvents.some(event => event?.event_id === id));
    if (presentIds.length !== acceptedIds.length && presentIds.length !== 0) throw error('PREGNANCY_EXPOSURE_IDS_NOT_CURRENT', {missing: acceptedIds.filter(id => !presentIds.includes(id))});
    const targetIds = new Set(acceptedIds);
    const deletionRecord = {operation_key: archive.operation_key, action: 'old-exposure-deleted', subject_id: identity.subject_id, pregnancy_id: identity.pregnancy_id, cycle_id: identity.cycle_id, deleted_event_ids: acceptedIds, created_at_floor_version: clone(resolved.version)};
    await persistence.commitFloorPatch({
      owner: 'lifecycle',
      chatId: resolved.chatId,
      ownerFloor: {message_index: resolved.selector, message_id: resolved.version.message_id},
      swipeId: resolved.swipeId,
      floorVersion: resolved.version,
      patchResolver: ({latest}) => {
        const latestTimeline = normalizePregnancyLifecycleTimeline(latest?.pregnancy_lifecycle_timeline);
        const nextTimeline = {
          ...latestTimeline,
          release_records: [
            ...latestTimeline.release_records.filter(item => item.operation_key !== deletionRecord.operation_key || item.action !== deletionRecord.action),
            deletionRecord,
          ],
        };
        const latestEvents = Array.isArray(latest?.events) ? latest.events : [];
        return {
          pregnancy_lifecycle_timeline: nextTimeline,
          events: latestEvents.filter(event => !targetIds.has(event?.event_id)),
        };
      },
      operation_type: 'pregnancy-exposure-delete-patch',
    });
    const readback = store.getFloor(resolved.selector, resolved.swipeId) ?? emptyFloor();
    if (!sameFloorVersion(floorVersionFromData(readback), resolved.version) || acceptedIds.some(id => (readback.events ?? []).some(event => event?.event_id === id))) throw error('PREGNANCY_EXPOSURE_READBACK_FAILED');
    const release = {operation_key: archive.operation_key, action: 'cycle-lock-released', subject_id: identity.subject_id, pregnancy_id: identity.pregnancy_id, cycle_id: identity.cycle_id, lock_key: cycleLockKey(identity), closure_reason: closureReason ?? null, father_status: fatherStatus === 'confirmed' ? 'confirmed' : 'unknown', created_at_floor_version: clone(resolved.version)};
    const finalTimeline = {...normalizePregnancyLifecycleTimeline(readback.pregnancy_lifecycle_timeline), release_records: [...normalizePregnancyLifecycleTimeline(readback.pregnancy_lifecycle_timeline).release_records.filter(item => item.operation_key !== release.operation_key || item.action !== release.action), release]};
    await commitTimeline({...resolved, floorData: readback}, finalTimeline, 'pregnancy-cycle-release-patch');
    const released = normalizePregnancyLifecycleTimeline(store.getFloor(resolved.selector, resolved.swipeId)?.pregnancy_lifecycle_timeline);
    if (!released.release_records.some(item => item.operation_key === release.operation_key && item.action === 'cycle-lock-released')) throw error('PREGNANCY_RELEASE_READBACK_FAILED');
    if (fatherStatus === 'confirmed' && candidate) await confirmFather({ownerFloor, floorVersion, subjectId: identity.subject_id, pregnancyId: identity.pregnancy_id, cycleId: identity.cycle_id});
    return {status: 'released', archive, deleted_event_ids: acceptedIds, lock_key: release.lock_key, timeline: released};
  }

  async function getTimeline({chatId, endpointIndex = Number.POSITIVE_INFINITY, endpointFloor = Number.POSITIVE_INFINITY} = {}) {
    const snapshot = store.getCurrentChatOwnerSnapshot(chatId);
    const entries = [];
    for (let index = 0; index < snapshot.messages.length; index += 1) {
      const swipeId = store.getActiveSwipeId?.(index);
      if (swipeId === null || swipeId === undefined || index > Number(endpointIndex)) continue;
      const floor = store.getFloor(index, swipeId) ?? emptyFloor();
      const version = floorVersionFromData(floor);
      if (!hasCompleteFloorVersion(version) || version.chat_id !== chatId || Number(version.floor) > Number(endpointFloor) || version.swipe_id !== swipeId) continue;
      const timeline = normalizePregnancyLifecycleTimeline(floor.pregnancy_lifecycle_timeline);
      if (timeline.facts.length || timeline.candidate_records.length || timeline.archives.length || timeline.release_records.length) entries.push(timeline);
    }
    return entries.reduce((result, item) => ({schema_version: 1, facts: [...result.facts, ...item.facts.filter(fact => !result.facts.some(existing => existing.fact_id === fact.fact_id))], candidate_records: [...result.candidate_records, ...item.candidate_records.filter(record => !result.candidate_records.some(existing => existing.candidate_record_id === record.candidate_record_id))], archives: [...result.archives, ...item.archives.filter(archive => !result.archives.some(existing => existing.archive_id === archive.archive_id))], release_records: [...result.release_records, ...item.release_records.filter(record => !result.release_records.some(existing => existing.operation_key === record.operation_key && existing.action === record.action))]}), emptyPregnancyLifecycleTimeline());
  }

  return {appendFact, saveCandidateRecord, confirmFather, archiveAndRelease, getTimeline, buildCandidateRecord};
}

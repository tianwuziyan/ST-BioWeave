import {floorVersionFromData, hasCompleteFloorVersion, sameFloorVersion} from '../runtime/floor.js';
import {cloneValue, emptyFloor} from './schema.js';
import {createFloorPersistenceCoordinator} from '../runtime/floor-persistence.js';
import {appendProjectionTimingBasis, appendProjectionTimingCreation, emptyProjectionTimingTimeline, normalizeProjectionTimingTimeline, resolveProjectionTimingTimeline} from '../core/projection-timing-persistence.js';
import {normalizeProjectionTimingInstance} from '../core/projection-timing.js';

function error(code) { const result = new Error(code); result.code = code; return result; }
function ownerSelector(owner = {}) { return owner.message_id ?? owner.messageId ?? owner.message_index ?? owner.messageIndex ?? owner.index; }
function ownerSwipe(owner = {}, version = {}) { return Number(owner.swipe_id ?? owner.swipeId ?? version.swipe_id); }
function assertVersion(record, version) { if (!sameFloorVersion(record?.created_at_floor_version, version)) throw error('FLOOR_VERSION_STALE'); }

export function createProjectionTimingPersistence({store, resolveCurrentFloorVersion = null, enabledResolver = () => true, floorPersistence = null} = {}) {
  if (!store) throw new TypeError('STORE_REQUIRED');
  const persistence = floorPersistence ?? createFloorPersistenceCoordinator({store, enabledResolver});
  function assertEnabled() { if (enabledResolver() === false) throw error('BIOWEAVE_DISABLED'); }
  async function resolveOwner(input = {}) {
    assertEnabled();
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
  async function mutateFloor(input, mutate) {
    const resolved = await resolveOwner(input);
    const normalized = normalizeProjectionTimingTimeline(resolved.floorData.projection_timing_timeline, {expectedChatId: resolved.chatId});
    if (normalized.conflicts.length || normalized.rejected.length) throw error('PROJECTION_TIMING_TIMELINE_INVALID');
    const result = mutate(normalized.timeline);
    if (result.status === 'deduped') return result;
    if (result.status === 'rejected' || result.status === 'conflict') throw error(result.code ?? 'PROJECTION_TIMING_CONFLICT');
    await persistence.commitFloorPatch({owner: 'projection', chatId: resolved.chatId, ownerFloor: {message_index: resolved.selector, message_id: resolved.version.message_id}, swipeId: resolved.swipeId, floorVersion: resolved.version, patch: {projection_timing_timeline: result.timeline}, operation_type: 'projection-timing-timeline-patch'});
    return result;
  }
  async function saveTimingInstance({chatId, ownerFloor, floorVersion, timingInstance} = {}) {
    const normalized = normalizeProjectionTimingInstance(timingInstance);
    if (normalized.created_at_floor_version.chat_id !== chatId) throw error('CHAT_SCOPE_MISMATCH');
    assertVersion(normalized, floorVersion);
    return mutateFloor({chatId, ownerFloor, floorVersion}, timeline => appendProjectionTimingCreation(normalized, {timeline, expectedChatId: chatId}));
  }
  async function appendTimingBasis({chatId, ownerFloor, floorVersion, timingInstanceId, sourceEventIds, sourceBasisRefs} = {}) {
    return mutateFloor({chatId, ownerFloor, floorVersion}, timeline => appendProjectionTimingBasis({timingInstanceId, sourceEventIds, sourceBasisRefs, createdAtFloorVersion: floorVersion}, {timeline}));
  }
  async function getTimingInstances({chatId, endpointFloor = Number.POSITIVE_INFINITY} = {}) {
    const snapshot = store.getCurrentChatOwnerSnapshot(chatId);
    const entries = [];
    for (let index = 0; index < snapshot.messages.length; index += 1) {
      const swipeId = store.getActiveSwipeId?.(index);
      if (swipeId === null || swipeId === undefined) continue;
      const floor = store.getFloor(index, swipeId);
      const version = floorVersionFromData(floor);
      if (!hasCompleteFloorVersion(version) || version.chat_id !== chatId || Number(version.floor) > Number(endpointFloor) || version.swipe_id !== swipeId) continue;
      const root = floor.projection_timing_timeline;
      if (!root) continue;
      const normalized = normalizeProjectionTimingTimeline(root, {expectedChatId: chatId});
      const creations = normalized.timeline.creations.filter(record => sameFloorVersion(record.created_at_floor_version, version));
      const basis_records = normalized.timeline.basis_records.filter(record => sameFloorVersion(record.created_at_floor_version, version));
      if (creations.length || basis_records.length) entries.push({creations, basis_records, lifecycle_records: []});
    }
    const resolved = resolveProjectionTimingTimeline(entries);
    const basisByTiming = new Map();
    for (const record of resolved.basis_records) {
      const current = basisByTiming.get(record.timing_instance_id) ?? {ids: [], refs: {}};
      current.ids.push(...record.source_event_ids);
      Object.assign(current.refs, record.source_basis_refs ?? {});
      basisByTiming.set(record.timing_instance_id, current);
    }
    resolved.creations = resolved.creations.map(record => {
      const additional = basisByTiming.get(record.timing_instance_id);
      if (!additional) return record;
      return {...record, source_event_ids: [...new Set([...record.source_event_ids, ...additional.ids])].sort(), source_basis_refs: {...record.source_basis_refs, ...additional.refs}};
    });
    return resolved;
  }
  return {saveTimingInstance, appendTimingBasis, getTimingInstances};
}

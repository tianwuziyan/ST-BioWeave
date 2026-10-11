import {floorVersionFromData, hasCompleteFloorVersion, sameFloorVersion} from '../runtime/floor.js';
import {emptyFloor} from './schema.js';
import {createFloorPersistenceCoordinator} from '../runtime/floor-persistence.js';
import {appendParticipantAggregation, emptyParticipantAggregationTimeline, normalizeParticipantAggregationTimeline, resolveParticipantAggregationTimeline} from '../core/participant-aggregation.js';

function error(code) { const result = new Error(code); result.code = code; return result; }
function ownerSelector(owner = {}) { return owner.message_id ?? owner.messageId ?? owner.message_index ?? owner.messageIndex ?? owner.index; }
function ownerSwipe(owner = {}, version = {}) { return Number(owner.swipe_id ?? owner.swipeId ?? version.swipe_id); }

export function createParticipantAggregationPersistence({store, resolveCurrentFloorVersion = null, enabledResolver = () => true, floorPersistence = null} = {}) {
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
  async function appendAggregation({chatId, ownerFloor, floorVersion, aggregation} = {}) {
    const resolved = await resolveOwner({chatId, ownerFloor, floorVersion});
    const current = normalizeParticipantAggregationTimeline(resolved.floorData.participant_aggregation_timeline, {expectedChatId: resolved.chatId});
    if (current.conflicts.length || current.rejected.length) throw error('PARTICIPANT_AGGREGATION_TIMELINE_INVALID');
    const result = appendParticipantAggregation(aggregation, {timeline: current.timeline, expectedChatId: resolved.chatId});
    if (result.status === 'conflict') throw error('PARTICIPANT_AGGREGATION_CONFLICT');
    if (result.status === 'deduped') return result;
    await persistence.commitFloorPatch({owner: 'participant_aggregation', chatId: resolved.chatId, ownerFloor: {message_index: resolved.selector, message_id: resolved.version.message_id}, swipeId: resolved.swipeId, floorVersion: resolved.version, patch: {participant_aggregation_timeline: result.timeline}, operation_type: 'participant-aggregation-patch'});
    return result;
  }
  async function getParticipantAggregations({chatId, endpointIndex = Number.POSITIVE_INFINITY, endpointFloor = Number.POSITIVE_INFINITY} = {}) {
    const snapshot = store.getCurrentChatOwnerSnapshot(chatId);
    const entries = [];
    for (let index = 0; index < snapshot.messages.length; index += 1) {
      const swipeId = store.getActiveSwipeId?.(index);
      if (swipeId === null || swipeId === undefined) continue;
      const floor = store.getFloor(index, swipeId) ?? emptyFloor();
      const version = floorVersionFromData(floor);
      if (!hasCompleteFloorVersion(version) || version.chat_id !== chatId || index > Number(endpointIndex) || Number(version.floor) > Number(endpointFloor) || version.swipe_id !== swipeId) continue;
      const normalized = normalizeParticipantAggregationTimeline(floor.participant_aggregation_timeline, {expectedChatId: chatId});
      const creations = normalized.timeline.creations.filter(record => sameFloorVersion(record.created_at_floor_version, version));
      const lifecycleRecords = normalized.timeline.lifecycle_records.filter(record => sameFloorVersion(record.created_at_floor_version, version));
      if (creations.length || lifecycleRecords.length) entries.push({creations, lifecycle_records: lifecycleRecords});
    }
    return resolveParticipantAggregationTimeline(entries);
  }
  return {emptyParticipantAggregationTimeline, appendAggregation, getParticipantAggregations};
}

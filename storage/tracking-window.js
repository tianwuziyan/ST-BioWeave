import { floorVersionFromData, hasCompleteFloorVersion, sameFloorVersion } from '../runtime/floor.js';
import { cloneValue, emptyFloor } from './schema.js';
import { createFloorPersistenceCoordinator } from '../runtime/floor-persistence.js';
import {
  appendTrackingWindowCreation,
  emptyTrackingWindowTimeline,
  normalizeTrackingWindowTimeline,
  resolveTrackingWindowTimeline,
} from '../core/tracking-window-persistence.js';
import { normalizeTrackingWindow } from '../core/tracking-window.js';

function error(code) { const result = new Error(code); result.code = code; return result; }
function ownerSelector(owner = {}) { return owner.message_id ?? owner.messageId ?? owner.message_index ?? owner.messageIndex ?? owner.index; }
function ownerSwipe(owner = {}, version = {}) { return Number(owner.swipe_id ?? owner.swipeId ?? version.swipe_id); }

export function createTrackingWindowPersistence({store, resolveCurrentFloorVersion = null, enabledResolver = () => true, floorPersistence = null} = {}) {
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
  async function saveTrackingWindowTimeline({chatId, ownerFloor, floorVersion, timeline} = {}) {
    const resolved = await resolveOwner({chatId, ownerFloor, floorVersion});
    const normalized = normalizeTrackingWindowTimeline(timeline, {expectedChatId: resolved.chatId});
    if (normalized.conflicts.length || normalized.rejected.length) throw error('TRACKING_WINDOW_TIMELINE_INVALID');
    await persistence.commitFloorPatch({
      owner: 'tracking',
      chatId: resolved.chatId,
      ownerFloor: {message_index: resolved.selector, message_id: resolved.version.message_id},
      swipeId: resolved.swipeId,
      floorVersion: resolved.version,
      patch: {tracking_window_timeline: normalized.timeline},
      operation_type: 'tracking-window-timeline-patch',
    });
    return normalized.timeline;
  }
  async function appendTrackingWindow({chatId, ownerFloor, floorVersion, window} = {}) {
    const resolved = await resolveOwner({chatId, ownerFloor, floorVersion});
    const current = normalizeTrackingWindowTimeline(resolved.floorData.tracking_window_timeline, {expectedChatId: resolved.chatId});
    const result = appendTrackingWindowCreation(normalizeTrackingWindow(window), {timeline: current.timeline, expectedChatId: resolved.chatId});
    if (result.status === 'conflict') throw error('TRACKING_WINDOW_CONFLICT');
    if (result.status === 'rejected') throw error(result.code ?? 'TRACKING_WINDOW_REJECTED');
    if (result.status === 'deduped') return result;
    await persistence.commitFloorPatch({owner: 'tracking', chatId: resolved.chatId, ownerFloor: {message_index: resolved.selector, message_id: resolved.version.message_id}, swipeId: resolved.swipeId, floorVersion: resolved.version, patch: {tracking_window_timeline: result.timeline}, operation_type: 'tracking-window-creation-patch'});
    return result;
  }
  async function getTrackingWindowTimeline({chatId, endpointFloor = Number.POSITIVE_INFINITY} = {}) {
    const snapshot = store.getCurrentChatOwnerSnapshot(chatId);
    const entries = [];
    for (let index = 0; index < snapshot.messages.length; index += 1) {
      const swipeId = store.getActiveSwipeId?.(index);
      if (swipeId === null || swipeId === undefined) continue;
      const floor = store.getFloor(index, swipeId) ?? emptyFloor();
      const version = floorVersionFromData(floor);
      if (!hasCompleteFloorVersion(version) || version.chat_id !== chatId || Number(version.floor) > Number(endpointFloor) || version.swipe_id !== swipeId) continue;
      const normalized = normalizeTrackingWindowTimeline(floor.tracking_window_timeline, {expectedChatId: chatId});
      if (normalized.timeline.creations.length || normalized.timeline.lifecycle_records.length) entries.push(normalized.timeline);
    }
    return resolveTrackingWindowTimeline(entries);
  }
  return {emptyTrackingWindowTimeline, saveTrackingWindowTimeline, appendTrackingWindow, getTrackingWindowTimeline};
}

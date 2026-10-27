import {emptyFloor} from './schema.js';
import {floorVersionFromData, hasCompleteFloorVersion, sameFloorVersion} from '../runtime/floor.js';
import {createFloorPersistenceCoordinator} from '../runtime/floor-persistence.js';
import {emptyPregnancyKnowledgeSnapshot, mergePregnancyKnowledgeSnapshots, normalizePregnancyKnowledgeSnapshot} from '../core/pregnancy-knowledge.js';

function fail(code, details = {}) { const error = new Error(code); error.code = code; Object.assign(error, details); return error; }
function ownerSelector(owner = {}) { return owner.message_index ?? owner.messageId ?? owner.message_id ?? owner.index; }
function ownerSwipe(owner = {}, version = {}) { return Number(owner.swipe_id ?? owner.swipeId ?? version.swipe_id); }

export function createPregnancyKnowledgePersistence({store, resolveCurrentFloorVersion = null, enabledResolver = () => true, floorPersistence = null} = {}) {
  if (!store) throw new TypeError('STORE_REQUIRED');
  const persistence = floorPersistence ?? createFloorPersistenceCoordinator({store, enabledResolver});

  async function resolveOwner(input = {}) {
    if (enabledResolver() === false) throw fail('BIOWEAVE_DISABLED');
    const selector = ownerSelector(input.ownerFloor ?? input);
    const version = input.floorVersion;
    if (selector === undefined || selector === null) throw fail('FLOOR_OWNER_REQUIRED');
    if (!hasCompleteFloorVersion(version)) throw fail('FLOOR_VERSION_REQUIRED');
    const swipeId = ownerSwipe(input.ownerFloor ?? input, version);
    if (!Number.isInteger(swipeId) || swipeId < 0 || store.getActiveSwipeId?.(selector) !== swipeId) throw fail('FLOOR_SWIPE_STALE');
    const floorData = store.getFloor(selector, swipeId) ?? emptyFloor();
    if (!sameFloorVersion(floorVersionFromData(floorData), version)) throw fail('FLOOR_VERSION_STALE');
    if (typeof resolveCurrentFloorVersion !== 'function' || !sameFloorVersion(await resolveCurrentFloorVersion({ownerFloor: {message_index: selector, message_id: version.message_id}, floorVersion: version, swipeId}), version)) throw fail('FLOOR_VERSION_STALE');
    return {selector, swipeId, version, floorData, chatId: version.chat_id};
  }

  async function saveSnapshot({ownerFloor, floorVersion, snapshot, mergeEntries = false} = {}) {
    const resolved = await resolveOwner({ownerFloor, floorVersion});
    const normalized = normalizePregnancyKnowledgeSnapshot(snapshot);
    if (!normalized) throw fail('PREGNANCY_KNOWLEDGE_SNAPSHOT_INVALID');
    if (!sameFloorVersion(normalized.created_at_floor_version, resolved.version)) throw fail('PREGNANCY_KNOWLEDGE_SNAPSHOT_OWNER_MISMATCH');
    let committedSnapshot = normalized;
    const result = await persistence.commitFloorPatch({
      owner: 'pregnancy_knowledge',
      chatId: resolved.chatId,
      ownerFloor: {message_index: resolved.selector, message_id: resolved.version.message_id},
      swipeId: resolved.swipeId,
      floorVersion: resolved.version,
      patchResolver: ({latest}) => {
        // Normal callers supply a complete replacement. Candidate processing
        // may opt into an additive commit-point rebase so concurrent candidate
        // additions cannot overwrite one another; this path never applies to
        // an explicit empty/replacement save.
        const latestSnapshot = normalizePregnancyKnowledgeSnapshot(latest?.pregnancy_knowledge_snapshot);
        committedSnapshot = mergeEntries && latestSnapshot
          ? mergePregnancyKnowledgeSnapshots(latestSnapshot, normalized.entries, resolved.version)
          : normalized;
        return {pregnancy_knowledge_snapshot: committedSnapshot};
      },
      operation_type: 'pregnancy-knowledge-snapshot-patch',
    });
    const readback = normalizePregnancyKnowledgeSnapshot(store.getFloor(resolved.selector, resolved.swipeId)?.pregnancy_knowledge_snapshot);
    if (!readback || JSON.stringify(readback) !== JSON.stringify(committedSnapshot)) throw fail('PREGNANCY_KNOWLEDGE_READBACK_FAILED');
    return {status: 'readback_verified', snapshot: readback, result};
  }

  async function getSnapshot({chatId, endpointIndex = Number.POSITIVE_INFINITY, endpointFloor = Number.POSITIVE_INFINITY} = {}) {
    const snapshot = store.getCurrentChatOwnerSnapshot(chatId);
    for (let index = Math.min(snapshot.messages.length - 1, Number(endpointIndex)); index >= 0; index -= 1) {
      const swipeId = store.getActiveSwipeId?.(index);
      if (swipeId === null || swipeId === undefined) continue;
      const floor = store.getFloor(index, swipeId) ?? emptyFloor();
      const version = floorVersionFromData(floor);
      if (!hasCompleteFloorVersion(version) || String(version.chat_id) !== String(chatId) || Number(version.floor) > Number(endpointFloor) || Number(version.swipe_id) !== Number(swipeId)) continue;
      const value = normalizePregnancyKnowledgeSnapshot(floor.pregnancy_knowledge_snapshot);
      if (!value || !sameFloorVersion(value.created_at_floor_version, version)) continue;
      const validEntries = value.entries.map(entry => ({
        ...entry,
        knowers: entry.knowers.filter(knower => {
          const source = knower.learned_at_floor_version;
          if (!hasCompleteFloorVersion(source)) return false;
          const sourceIndex = Number(source.floor);
          const sourceSwipe = Number(source.swipe_id);
          if (!Number.isInteger(sourceIndex) || sourceIndex < 0 || !Number.isInteger(sourceSwipe) || sourceSwipe < 0) return false;
          if (store.getActiveSwipeId?.(sourceIndex) !== sourceSwipe) return false;
          const sourceFloor = store.getFloor(sourceIndex, sourceSwipe);
          return sourceFloor && sameFloorVersion(floorVersionFromData(sourceFloor), source);
        }),
      })).filter(entry => entry.knowers.length);
      return {...value, entries: validEntries};
    }
    return null;
  }

  return {saveSnapshot, getSnapshot};
}

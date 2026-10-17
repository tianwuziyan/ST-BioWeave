import {floorVersionFromData, hasCompleteFloorVersion, sameFloorVersion} from '../runtime/floor.js';
import {durationMs, monotonicNow} from '../runtime/diagnostics.js';
import {cloneValue, emptyFloor} from './schema.js';
import {createFloorPersistenceCoordinator} from '../runtime/floor-persistence.js';
import {
  emptyParticipantAggregationSnapshot,
  normalizeParticipantAggregationSnapshot,
  normalizeParticipantAggregation,
  removeParticipantAggregation,
  replaceParticipantAggregationSnapshot,
  upsertParticipantAggregation,
} from '../core/participant-aggregation.js';

const ROOT = 'participant_aggregation_snapshot';

function error(code, details = {}) {
  const result = new Error(code);
  result.code = code;
  Object.assign(result, details);
  return result;
}
function ownerSelector(owner = {}) {
  // store.getFloor() addresses the chat-array slot; host message_id is only
  // provenance and must remain a fallback.
  return owner.message_index ?? owner.messageIndex ?? owner.index
    ?? owner.message_id ?? owner.messageId;
}
const VERSION_FIELDS = ['chat_id', 'message_id', 'floor', 'swipe_id', 'content_hash', 'message_version'];
function versionAudit(expected, actual) {
  const expectedValue = Object.fromEntries(VERSION_FIELDS.map(field => [field, expected?.[field] ?? null]));
  const actualValue = Object.fromEntries(VERSION_FIELDS.map(field => [field, actual?.[field] ?? null]));
  const mismatchFields = VERSION_FIELDS.filter(field => expectedValue[field] !== actualValue[field]);
  const typeMismatchFields = VERSION_FIELDS.filter(field =>
    expectedValue[field] !== actualValue[field]
      && String(expectedValue[field] ?? '') === String(actualValue[field] ?? ''),
  );
  return {
    expected: expectedValue,
    actual: actualValue,
    mismatch_fields: mismatchFields,
    type_mismatch_fields: typeMismatchFields,
  };
}
function ownerSwipe(owner = {}, version = {}) { return Number(owner.swipe_id ?? owner.swipeId ?? version.swipe_id); }
function hasOwn(value, key) { return Boolean(value && Object.prototype.hasOwnProperty.call(value, key)); }
function sameSnapshot(left, right) { return JSON.stringify(left) === JSON.stringify(right); }
function sameFloorOwnerIdentity(left, right) {
  return Boolean(left && right)
    && String(left.chat_id) === String(right.chat_id)
    && String(left.message_id) === String(right.message_id)
    && Number(left.floor) === Number(right.floor)
    && Number(left.swipe_id) === Number(right.swipe_id);
}
function isRepairableCurrentOwnerSlotMismatch(stored, current, editStart) {
  return hasCompleteFloorVersion(stored)
    && sameFloorOwnerIdentity(stored, current)
    && sameFloorVersion(editStart, current)
    && !sameFloorVersion(stored, current);
}
function itemIsWithinFloorBounds(item, rootVersion, endpointFloor) {
  const created = item?.created_at_floor_version;
  return hasCompleteFloorVersion(created)
    && String(created.chat_id) === String(rootVersion.chat_id)
    && Number(created.swipe_id) === Number(rootVersion.swipe_id)
    && Number.isFinite(Number(created.floor))
    && Number(created.floor) <= Number(rootVersion.floor)
    && Number(created.floor) <= Number(endpointFloor);
}

export function createParticipantAggregationPersistence({store, resolveCurrentFloorVersion = null, enabledResolver = () => true, floorPersistence = null, performanceStage = null} = {}) {
  if (!store) throw new TypeError('STORE_REQUIRED');
  const persistence = floorPersistence ?? createFloorPersistenceCoordinator({store, enabledResolver});
  const persistenceKind = 'PARTICIPANT_AGGREGATION';

  function reportPerformanceStage(payload) {
    try { performanceStage?.(payload); } catch { /* diagnostics are fail-open */ }
  }

  async function rejectVersion({code, expected, actual, owner, selector, swipeId, source}) {
    let authoritative = actual;
    let actualSource = source;
    if (typeof resolveCurrentFloorVersion === 'function' && source !== 'current_floor_resolver') {
      try {
        authoritative = await resolveCurrentFloorVersion({
          chatId: expected?.chat_id,
          ownerFloor: {message_index: selector, message_id: expected?.message_id},
          floorVersion: expected,
          swipeId,
        });
        actualSource = 'current_floor_resolver';
      } catch {
        actualSource = `${source}:current_floor_resolver_failed`;
      }
    }
    const storedAudit = versionAudit(expected, actual);
    const audit = versionAudit(expected, authoritative);
    const mismatchFields = [...new Set([
      ...storedAudit.mismatch_fields,
      ...audit.mismatch_fields,
    ])];
    const classification = sameFloorVersion(authoritative, expected)
      ? 'INTERNAL_OWNER_SLOT_MISMATCH'
      : audit.mismatch_fields.length > 0
        && audit.mismatch_fields.every(field => audit.type_mismatch_fields.includes(field))
        ? 'INTERNAL_FLOOR_VERSION_TYPE_MISMATCH'
        : authoritative
          ? 'TRUE_CONTEXT_VERSION_CHANGE'
          : 'VERSION_STATE_UNAVAILABLE';
    throw error(code, {
      validation_layer: 'participant_aggregation_storage_owner',
      validation_source: actualSource,
      owner_message_index: selector,
      owner_message_id: owner?.message_id ?? owner?.messageId ?? expected?.message_id ?? null,
      owner_swipe_id: Number.isInteger(Number(swipeId)) ? Number(swipeId) : null,
      expected_floor_version: audit.expected,
      actual_floor_version: audit.actual,
      stored_floor_version: storedAudit.actual,
      version_audit: {...audit, mismatch_fields: mismatchFields},
      stored_version_audit: storedAudit,
      version_classification: classification,
    });
  }

  async function resolveOwnerWithPerformance(input) {
    const operationId = input?.performanceOperationId;
    if (!operationId || typeof performanceStage !== 'function') return resolveOwner(input);
    const startedAt = monotonicNow();
    try {
      const result = await resolveOwner(input);
      reportPerformanceStage({
        operation_id: operationId,
        stage: 'PERSISTENCE_REQUEST_PREPARE',
        kind: 'ASYNC',
        status: 'SUCCEEDED',
        duration_ms: durationMs(startedAt),
        persistence_kind: persistenceKind,
        reason_code: 'PERSISTENCE_OWNER_RESOLVED',
      });
      return result;
    } catch (cause) {
      reportPerformanceStage({
        operation_id: operationId,
        stage: 'PERSISTENCE_REQUEST_PREPARE',
        kind: 'ASYNC',
        status: 'FAILED',
        duration_ms: durationMs(startedAt),
        persistence_kind: persistenceKind,
        reason_code: 'PERSISTENCE_OWNER_RESOLUTION_FAILED',
        error_code: cause?.code ?? cause?.message ?? 'PERSISTENCE_OWNER_RESOLUTION_FAILED',
      });
      throw cause;
    }
  }

  async function resolveOwner(input = {}) {
    if (enabledResolver() === false) throw error('BIOWEAVE_DISABLED');
    const owner = input.ownerFloor ?? input;
    const selector = ownerSelector(owner);
    const version = input.floorVersion;
    if (selector === undefined || selector === null) throw error('FLOOR_OWNER_REQUIRED');
    if (!hasCompleteFloorVersion(version)) throw error('FLOOR_VERSION_REQUIRED');
    const swipeId = ownerSwipe(owner, version);
    if (!Number.isInteger(swipeId) || swipeId < 0 || store.getActiveSwipeId?.(selector) !== swipeId) throw error('FLOOR_SWIPE_STALE');
    const floorData = store.getFloor(selector, swipeId) ?? emptyFloor();
    if (typeof resolveCurrentFloorVersion !== 'function') throw error('FLOOR_VERSION_RESOLVER_REQUIRED');
    const current = await resolveCurrentFloorVersion({
      chatId: version.chat_id,
      ownerFloor: {message_index: selector, message_id: version.message_id},
      floorVersion: version,
      swipeId,
    });
    const storedVersion = floorVersionFromData(floorData);
    if (input.editStartFloorVersion && !sameFloorVersion(input.editStartFloorVersion, current)) {
      await rejectVersion({
        code: 'FLOOR_VERSION_STALE',
        expected: input.editStartFloorVersion,
        actual: current,
        owner,
        selector,
        swipeId,
        source: 'edit_start_floor_version',
      });
    }
    const allowsPreEditSnapshot = input.operation_type === 'manual-timing-aggregation-reevaluation'
      && isRepairableCurrentOwnerSlotMismatch(storedVersion, current, input.editStartFloorVersion);
    if (!sameFloorVersion(storedVersion, version) && !allowsPreEditSnapshot) {
      await rejectVersion({
        code: 'FLOOR_VERSION_STALE',
        expected: version,
        actual: storedVersion,
        owner,
        selector,
        swipeId,
        source: 'stored_floor_slot',
      });
    }
    if (!sameFloorVersion(current, version)) {
      await rejectVersion({
        code: 'FLOOR_VERSION_STALE',
        expected: version,
        actual: current,
        owner,
        selector,
        swipeId,
        source: 'current_floor_resolver',
      });
    }
    return {selector, swipeId, version, floorData, chatId: version.chat_id};
  }

  async function mutateFloor(input, mutate) {
    const resolved = await resolveOwnerWithPerformance(input);
    let mutation = null;
    const result = await persistence.commitFloorPatch({
      owner: 'participant_aggregation',
      chatId: resolved.chatId,
      ownerFloor: {message_index: resolved.selector, message_id: resolved.version.message_id},
      swipeId: resolved.swipeId,
      floorVersion: resolved.version,
      operation_type: input.operation_type ?? 'participant-aggregation-snapshot-patch',
      traceContext: input.performanceOperationId
        ? {performance_operation_id: input.performanceOperationId, persistence_kind: persistenceKind}
        : undefined,
      patchResolver: async ({latest}) => {
        // Resolve the collection only after the Coordinator has entered its
        // serialized dispatch and read the current Context slot; this
        // preserves siblings across same-Floor updates initiated from stale
        // pre-queue reads.
        let raw = hasOwn(latest, ROOT) ? latest[ROOT] : null;
        if (!hasOwn(latest, ROOT)) {
          const inherited = await getParticipantAggregations({
            chatId: resolved.chatId,
            endpointFloor: resolved.version.floor,
            endpointIndex: resolved.selector,
          });
          raw = {schema_version: 1, items: inherited.items};
        }
        const normalized = normalizeParticipantAggregationSnapshot(raw, {expectedChatId: resolved.chatId});
        if (normalized.invalid || normalized.conflicts.length || normalized.rejected.length
            || normalized.snapshot.items.some(item => !itemIsWithinFloorBounds(item, resolved.version, resolved.version.floor))) {
          throw error('PARTICIPANT_AGGREGATION_SNAPSHOT_INVALID');
        }
        mutation = mutate(normalized.snapshot);
        if (mutation?.status === 'rejected' || mutation?.status === 'conflict') {
          throw error(mutation.code ?? 'PARTICIPANT_AGGREGATION_CONFLICT');
        }
        if (mutation?.status === 'deduped' || mutation?.status === 'not_found') {
          return {__floor_tx_noop: true};
        }
        if (mutation?.snapshot?.items?.some(item => !itemIsWithinFloorBounds(item, resolved.version, resolved.version.floor))) {
          throw error('PARTICIPANT_AGGREGATION_SNAPSHOT_INVALID');
        }
        return {[ROOT]: mutation.snapshot};
      },
    });
    return {...mutation, authoritativeReadback: result.authoritativeReadback, noWrite: result.noWrite === true, floor: result.floor};
  }

  async function upsertAggregation({chatId, ownerFloor, floorVersion, editStartFloorVersion, aggregation, operation_type, performanceOperationId} = {}) {
    const normalized = normalizeParticipantAggregation(aggregation);
    if (String(normalized.created_at_floor_version.chat_id) !== String(chatId)) throw error('CHAT_SCOPE_MISMATCH');
    return mutateFloor({chatId, ownerFloor, floorVersion, editStartFloorVersion, operation_type, performanceOperationId}, snapshot =>
      upsertParticipantAggregation(normalized, {snapshot, expectedChatId: chatId}));
  }

  async function removeAggregation({chatId, ownerFloor, floorVersion, editStartFloorVersion, aggregationId, aggregation_id, operation_type, performanceOperationId} = {}) {
    return mutateFloor({chatId, ownerFloor, floorVersion, editStartFloorVersion, operation_type, performanceOperationId}, snapshot =>
      removeParticipantAggregation(aggregationId ?? aggregation_id, {snapshot, expectedChatId: chatId}));
  }

  async function saveParticipantAggregationSnapshot({chatId, ownerFloor, floorVersion, items, operation_type, performanceOperationId} = {}) {
    return mutateFloor({chatId, ownerFloor, floorVersion, operation_type, performanceOperationId}, snapshot => {
      const next = replaceParticipantAggregationSnapshot(items, {expectedChatId: chatId});
      return sameSnapshot(snapshot, next)
        ? {status: 'deduped', snapshot}
        : {status: 'replaced', snapshot: next};
    });
  }

  async function clearAggregations({chatId, ownerFloor, floorVersion, operation_type, performanceOperationId} = {}) {
    return mutateFloor({chatId, ownerFloor, floorVersion, operation_type, performanceOperationId}, snapshot => {
      const next = emptyParticipantAggregationSnapshot();
      return sameSnapshot(snapshot, next)
        ? {status: 'deduped', snapshot}
        : {status: 'cleared', snapshot: next};
    });
  }

  async function resolveCandidateVersion({chatId, index, swipeId, version, allowCurrentOwnerSlotRepair = false, editStartFloorVersion = null, requireEditStartMatch = false} = {}) {
    if (typeof resolveCurrentFloorVersion !== 'function') return null;
    const current = await resolveCurrentFloorVersion({
      chatId,
      ownerFloor: {message_index: index, message_id: version.message_id},
      floorVersion: version,
      swipeId,
    });
    if (requireEditStartMatch && editStartFloorVersion && !sameFloorVersion(editStartFloorVersion, current)) {
      return {version: current, editStartMismatch: true};
    }
    if (sameFloorVersion(current, version)) return {version: current, repairedOwnerSlot: false};
    if (allowCurrentOwnerSlotRepair && isRepairableCurrentOwnerSlotMismatch(version, current, editStartFloorVersion)) {
      return {version: current, repairedOwnerSlot: true};
    }
    return null;
  }

  async function getParticipantAggregations({chatId, endpointIndex = Number.POSITIVE_INFINITY, endpointFloor = Number.POSITIVE_INFINITY, editStartFloorVersion = null} = {}) {
    const snapshot = store.getCurrentChatOwnerSnapshot(chatId);
    const upperFloor = Number(endpointFloor);
    const upperIndex = Number(endpointIndex);
    for (let index = Math.min(snapshot.messages.length - 1, upperIndex); index >= 0; index -= 1) {
      const swipeId = store.getActiveSwipeId?.(index);
      if (swipeId === null || swipeId === undefined) continue;
      const floor = store.getFloor(index, swipeId) ?? emptyFloor();
      const version = floorVersionFromData(floor);
      if (!hasCompleteFloorVersion(version) || String(version.chat_id) !== String(chatId) || Number(version.floor) > upperFloor || Number(version.swipe_id) !== Number(swipeId)) continue;
      const candidate = await resolveCandidateVersion({
        chatId,
        index,
        swipeId,
        version,
        // Only an explicitly bounded current-owner edit may inspect stale
        // module metadata. Historical slots remain exact-match only.
        allowCurrentOwnerSlotRepair: Number.isInteger(upperIndex) && index === upperIndex,
        editStartFloorVersion,
        requireEditStartMatch: Boolean(editStartFloorVersion) && Number.isInteger(upperIndex) && index === upperIndex,
      });
      if (candidate?.editStartMismatch) {
        await rejectVersion({
          code: 'FLOOR_VERSION_STALE',
          expected: editStartFloorVersion,
          actual: candidate.version,
          owner: {message_index: index, message_id: version.message_id},
          selector: index,
          swipeId,
          source: 'edit_start_floor_version',
        });
      }
      if (!candidate) continue;
      const current = candidate.version;
      if (!hasOwn(floor, ROOT)) continue;
      const normalized = normalizeParticipantAggregationSnapshot(floor[ROOT], {expectedChatId: chatId});
      if (normalized.invalid || normalized.conflicts.length || normalized.rejected.length) continue;
      if (normalized.snapshot.items.some(item => !itemIsWithinFloorBounds(item, version, upperFloor))) continue;
      return {
        items: normalized.snapshot.items.map(cloneValue),
        floor_version: cloneValue(current),
        source_index: index,
        version_classification: candidate.repairedOwnerSlot ? 'INTERNAL_OWNER_SLOT_MISMATCH' : 'AUTHORITATIVE_MATCH',
      };
    }
    return {items: [], floor_version: null, source_index: null};
  }

  return {
    emptyParticipantAggregationSnapshot,
    upsertAggregation,
    saveParticipantAggregationSnapshot,
    removeAggregation,
    clearAggregations,
    getParticipantAggregations,
  };
}

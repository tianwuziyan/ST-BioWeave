import {
  FLOOR_VERSION_FIELDS,
  hasCompleteFloorVersion,
  sameFloorVersion,
} from '../runtime/floor.js';
import { reduceState, STATE_SCHEMA_VERSION } from './state.js';

export const SNAPSHOT_SCHEMA_VERSION = 1;

const SNAPSHOT_FIELDS = Object.freeze(['schema_version', 'checkpoint', 'state']);
const CHECKPOINT_FIELDS = Object.freeze([...FLOOR_VERSION_FIELDS]);
const STATE_FIELDS = Object.freeze([
  'schema_version',
  'characters',
  'processed_event_ids',
  'diagnostics',
]);
const CHARACTER_STATE_FIELDS = Object.freeze([
  'identity',
  'reproductive_capabilities',
  'reproductive_exposure',
  'conception',
  'pregnancy',
  'cycle',
  'postpartum',
  'symptoms',
  'medical',
  'activity_chain',
]);

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function clone(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  if (Array.isArray(value)) return value.map(clone);
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
  return value;
}

function exactFields(value, fields) {
  if (!isRecord(value)) return false;
  const expected = new Set(fields);
  return Object.keys(value).every((key) => expected.has(key))
    && fields.every((field) => Object.prototype.hasOwnProperty.call(value, field));
}

function error(code, detail = null) {
  return { code, detail };
}

function validateCheckpoint(checkpoint, errors) {
  if (!hasCompleteFloorVersion(checkpoint)) {
    errors.push(error('checkpoint_floor_version_incomplete'));
    return false;
  }
  if (!exactFields(checkpoint, CHECKPOINT_FIELDS)) {
    errors.push(error('checkpoint_fields_invalid'));
    return false;
  }
  if (!Number.isInteger(checkpoint.swipe_id) || checkpoint.swipe_id < 0) {
    errors.push(error('checkpoint_swipe_id_invalid'));
    return false;
  }
  return true;
}

function validateState(state, errors) {
  if (!isRecord(state)) {
    errors.push(error('state_invalid'));
    return false;
  }
  if (state.schema_version !== STATE_SCHEMA_VERSION) {
    errors.push(error('state_schema_version_invalid'));
  }
  if (!exactFields(state, STATE_FIELDS)) {
    errors.push(error('state_fields_invalid'));
  }
  if (!isRecord(state.characters)) {
    errors.push(error('state_characters_invalid'));
  } else {
    for (const [characterId, character] of Object.entries(state.characters)) {
      if (!characterId || !isRecord(character) || !exactFields(character, CHARACTER_STATE_FIELDS)) {
        errors.push(error('state_character_invalid', characterId));
      }
    }
  }
  if (!Array.isArray(state.processed_event_ids)
    || state.processed_event_ids.some((eventId) => typeof eventId !== 'string' || !eventId)) {
    errors.push(error('state_processed_event_ids_invalid'));
  }
  if (!Array.isArray(state.diagnostics) || state.diagnostics.some((item) => !isRecord(item))) {
    errors.push(error('state_diagnostics_invalid'));
  }
  return errors.length === 0;
}

function ownerMessage(owner) {
  return owner?.message && typeof owner.message === 'object' ? owner.message : owner;
}

function isCharacterFloorOwner(owner) {
  const message = ownerMessage(owner);
  if (!message || message.is_user === true || message.is_system === true) return false;
  const role = String(message.role ?? '').trim().toLowerCase();
  return role !== 'user' && role !== 'system';
}

function ownerSwipeId(owner) {
  const message = ownerMessage(owner);
  return owner?.activeSwipeId ?? owner?.active_swipe_id ?? message?.swipe_id;
}

function ownerVersion(owner) {
  return owner?.floorVersion
    ?? owner?.floor_version
    ?? owner?.version
    ?? ownerMessage(owner)?.floor_version
    ?? null;
}

/** Validate a Floor-owned Current State checkpoint without reading persistence. */
export function validateSnapshot(snapshot, {
  owner = null,
  expectedChatId = null,
  expectedFloorVersion = null,
  currentFloorVersion = null,
} = {}) {
  const errors = [];
  if (!isRecord(snapshot) || !exactFields(snapshot, SNAPSHOT_FIELDS)) {
    errors.push(error('snapshot_fields_invalid'));
    return { ok: false, errors };
  }
  if (snapshot.schema_version !== SNAPSHOT_SCHEMA_VERSION) {
    errors.push(error('snapshot_schema_version_invalid'));
  }
  const checkpoint = isRecord(snapshot.checkpoint) ? snapshot.checkpoint : {};
  const checkpointValid = validateCheckpoint(snapshot.checkpoint, errors);
  const stateValid = validateState(snapshot.state, errors);
  if (owner !== null) {
    if (!isCharacterFloorOwner(owner)) errors.push(error('snapshot_owner_not_character_floor'));
    const activeSwipeId = ownerSwipeId(owner);
    if (activeSwipeId !== undefined && activeSwipeId !== null
      && (activeSwipeId !== checkpoint.swipe_id || !Number.isInteger(activeSwipeId))) {
      errors.push(error('snapshot_owner_swipe_mismatch'));
    }
    const version = ownerVersion(owner);
    if (version && !sameFloorVersion(checkpoint, version)) {
      errors.push(error('snapshot_owner_floor_version_mismatch'));
    }
  }
  if (expectedChatId !== null && checkpoint.chat_id !== expectedChatId) {
    errors.push(error('snapshot_chat_mismatch'));
  }
  if (expectedFloorVersion && !sameFloorVersion(checkpoint, expectedFloorVersion)) {
    errors.push(error('snapshot_floor_version_mismatch'));
  }
  if (currentFloorVersion) {
    if (checkpoint.chat_id !== currentFloorVersion.chat_id
      || checkpoint.floor > currentFloorVersion.floor) {
      errors.push(error('snapshot_checkpoint_in_future'));
    }
  }
  return { ok: checkpointValid && stateValid && errors.length === 0, errors };
}

export function createSnapshot({
  checkpoint,
  state,
  owner = null,
  expectedChatId = null,
  expectedFloorVersion = null,
} = {}) {
  const snapshot = {
    schema_version: SNAPSHOT_SCHEMA_VERSION,
    checkpoint: clone(checkpoint),
    state: clone(state),
  };
  const validation = validateSnapshot(snapshot, {
    owner,
    expectedChatId,
    expectedFloorVersion,
  });
  if (!validation.ok) {
    const failure = new Error('SNAPSHOT_INVALID');
    failure.code = 'SNAPSHOT_INVALID';
    failure.errors = validation.errors;
    throw failure;
  }
  return snapshot;
}

function floorEntry(entry) {
  return entry?.checkpoint ?? entry?.floorVersion ?? entry?.floor_version ?? entry;
}

function isValidCharacterFloorEntry(entry) {
  if (!entry || entry.is_user === true || entry.is_system === true) return false;
  const role = String(entry.role ?? entry.message?.role ?? '').trim().toLowerCase();
  if (role === 'user' || role === 'system') return false;
  const errors = [];
  return validateCheckpoint(floorEntry(entry), errors) && errors.length === 0;
}

function sameCheckpoint(left, right) {
  return sameFloorVersion(floorEntry(left), floorEntry(right));
}

/** Count valid Character Floor checkpoints since the previous Snapshot. */
export function shouldSnapshot({
  characterFloors = [],
  lastSnapshotCheckpoint = null,
  interval = 3,
  majorEvent = false,
} = {}) {
  if (majorEvent === true) return true;
  if (!Number.isInteger(interval) || interval < 1) return false;
  const validFloors = (Array.isArray(characterFloors) ? characterFloors : [])
    .filter(isValidCharacterFloorEntry);
  const markerIndex = lastSnapshotCheckpoint === null
    ? -1
    : validFloors.findIndex((entry) => sameCheckpoint(entry, lastSnapshotCheckpoint));
  const progression = validFloors.slice(markerIndex + 1);
  return progression.length >= interval;
}

export function restoreFromSnapshot({
  snapshot,
  events = [],
  currentStoryTime = null,
  characterFacts = {},
  reducer = reduceState,
} = {}) {
  const validation = validateSnapshot(snapshot);
  if (!validation.ok) {
    const failure = new Error('SNAPSHOT_INVALID');
    failure.code = 'SNAPSHOT_INVALID';
    failure.errors = validation.errors;
    throw failure;
  }
  return reducer({
    baseState: clone(snapshot.state),
    events,
    currentStoryTime,
    characterFacts,
  });
}

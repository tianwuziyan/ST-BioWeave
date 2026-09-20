import {
  CAPABILITY_KEYS,
  dedupeEvents,
  normalizeEvent,
  sortEvents,
  validateCharacterFacts,
  validateEvent,
} from './events.js';
import { differenceStoryDays, sortEventsByStoryTime } from '../story/time.js';

export const STATE_SCHEMA_VERSION = 1;

const IGNORED_STATUSES = new Set(['negated', 'fictional']);
const UNCERTAIN_STATUSES = new Set(['probable', 'ambiguous']);

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function clone(value) {
  return structuredClone(value);
}

function uniquePush(array, value) {
  if (value && !array.includes(value)) array.push(value);
}

function nullable(value) {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function emptyCapabilities() {
  return Object.fromEntries(CAPABILITY_KEYS.map((key) => [key, null]));
}

function emptyCharacterState(characterFacts = null, characterId = null) {
  const identity = isRecord(characterFacts?.identity)
    ? {
        character_id: characterId,
        display_name: nullable(characterFacts.identity.display_name),
        species: nullable(characterFacts.identity.species),
        biological_type: nullable(characterFacts.identity.biological_type),
      }
    : {
        character_id: characterId,
        display_name: null,
        species: null,
        biological_type: null,
      };
  const capabilities = isRecord(characterFacts?.reproductive_capabilities)
    ? Object.fromEntries(
        CAPABILITY_KEYS.map((key) => [
          key,
          [true, false, null].includes(characterFacts.reproductive_capabilities[key])
            ? characterFacts.reproductive_capabilities[key]
            : null,
        ]),
      )
    : emptyCapabilities();
  return {
    identity,
    reproductive_capabilities: capabilities,
    reproductive_exposure: {
      records: [],
      unresolved_records: [],
      last_exposure_event_id: null,
      last_exposure_story_time: null,
      elapsed_story_days: null,
    },
    conception: {
      status: 'unknown',
      pregnancy_ids: [],
      confirmed_event_ids: [],
      uncertain_event_ids: [],
    },
    pregnancy: {
      episodes: {},
      active_pregnancy_ids: [],
      current_status: 'unknown',
    },
    cycle: {
      factual_event_ids: [],
      uncertain_event_ids: [],
    },
    postpartum: {
      episodes: {},
      factual_event_ids: [],
      uncertain_event_ids: [],
    },
    symptoms: {
      records: [],
      uncertain_records: [],
    },
    medical: {
      records: [],
      uncertain_records: [],
    },
    activity_chain: {
      event_ids: [],
    },
  };
}

function normalizeEpisode(raw, pregnancyId) {
  const source = isRecord(raw) ? raw : {};
  return {
    pregnancy_id: pregnancyId,
    status: ['unknown', 'suspected', 'confirmed', 'ended'].includes(source.status)
      ? source.status
      : 'unknown',
    conception_event_ids: Array.isArray(source.conception_event_ids)
      ? source.conception_event_ids.filter(Boolean)
      : [],
    suspicion_event_ids: Array.isArray(source.suspicion_event_ids)
      ? source.suspicion_event_ids.filter(Boolean)
      : [],
    confirmation_event_ids: Array.isArray(source.confirmation_event_ids)
      ? source.confirmation_event_ids.filter(Boolean)
      : [],
    termination_event_ids: Array.isArray(source.termination_event_ids)
      ? source.termination_event_ids.filter(Boolean)
      : [],
    labor_event_ids: Array.isArray(source.labor_event_ids)
      ? source.labor_event_ids.filter(Boolean)
      : [],
    delivery_event_ids: Array.isArray(source.delivery_event_ids)
      ? source.delivery_event_ids.filter(Boolean)
      : [],
    postpartum_event_ids: Array.isArray(source.postpartum_event_ids)
      ? source.postpartum_event_ids.filter(Boolean)
      : [],
    uncertain_event_ids: Array.isArray(source.uncertain_event_ids)
      ? source.uncertain_event_ids.filter(Boolean)
      : [],
  };
}

function normalizeCharacterState(raw, characterId) {
  const result = emptyCharacterState(null, characterId);
  if (!isRecord(raw)) return result;
  if (isRecord(raw.identity)) {
    result.identity.display_name = nullable(raw.identity.display_name);
    result.identity.species = nullable(raw.identity.species);
    result.identity.biological_type = nullable(raw.identity.biological_type);
  }
  if (isRecord(raw.reproductive_capabilities)) {
    for (const key of CAPABILITY_KEYS) {
      if ([true, false, null].includes(raw.reproductive_capabilities[key])) {
        result.reproductive_capabilities[key] = raw.reproductive_capabilities[key];
      }
    }
  }
  const exposure = raw.reproductive_exposure;
  if (isRecord(exposure)) {
    result.reproductive_exposure.records = Array.isArray(exposure.records) ? clone(exposure.records) : [];
    result.reproductive_exposure.unresolved_records = Array.isArray(exposure.unresolved_records)
      ? clone(exposure.unresolved_records)
      : [];
    result.reproductive_exposure.last_exposure_event_id = nullable(exposure.last_exposure_event_id);
    result.reproductive_exposure.last_exposure_story_time = exposure.last_exposure_story_time
      ? clone(exposure.last_exposure_story_time)
      : null;
    result.reproductive_exposure.elapsed_story_days = Number.isInteger(exposure.elapsed_story_days)
      ? exposure.elapsed_story_days
      : null;
  }
  if (isRecord(raw.conception)) {
    result.conception.status = ['unknown', 'suspected', 'confirmed'].includes(raw.conception.status)
      ? raw.conception.status
      : 'unknown';
    result.conception.pregnancy_ids = Array.isArray(raw.conception.pregnancy_ids)
      ? raw.conception.pregnancy_ids.filter(Boolean)
      : [];
    result.conception.confirmed_event_ids = Array.isArray(raw.conception.confirmed_event_ids)
      ? raw.conception.confirmed_event_ids.filter(Boolean)
      : [];
    result.conception.uncertain_event_ids = Array.isArray(raw.conception.uncertain_event_ids)
      ? raw.conception.uncertain_event_ids.filter(Boolean)
      : [];
  }
  if (isRecord(raw.pregnancy)) {
    result.pregnancy.episodes = Object.fromEntries(
      Object.entries(raw.pregnancy.episodes ?? {}).map(([id, episode]) => [id, normalizeEpisode(episode, id)]),
    );
    result.pregnancy.active_pregnancy_ids = Array.isArray(raw.pregnancy.active_pregnancy_ids)
      ? raw.pregnancy.active_pregnancy_ids.filter(Boolean)
      : [];
    result.pregnancy.current_status = ['unknown', 'suspected', 'confirmed', 'ended'].includes(raw.pregnancy.current_status)
      ? raw.pregnancy.current_status
      : 'unknown';
  }
  if (isRecord(raw.cycle)) {
    result.cycle.factual_event_ids = Array.isArray(raw.cycle.factual_event_ids)
      ? raw.cycle.factual_event_ids.filter(Boolean)
      : [];
    result.cycle.uncertain_event_ids = Array.isArray(raw.cycle.uncertain_event_ids)
      ? raw.cycle.uncertain_event_ids.filter(Boolean)
      : [];
  }
  if (isRecord(raw.postpartum)) {
    result.postpartum.episodes = Object.fromEntries(
      Object.entries(raw.postpartum.episodes ?? {}).map(([id, episode]) => [id, clone(episode)]),
    );
    result.postpartum.factual_event_ids = Array.isArray(raw.postpartum.factual_event_ids)
      ? raw.postpartum.factual_event_ids.filter(Boolean)
      : [];
    result.postpartum.uncertain_event_ids = Array.isArray(raw.postpartum.uncertain_event_ids)
      ? raw.postpartum.uncertain_event_ids.filter(Boolean)
      : [];
  }
  if (isRecord(raw.symptoms)) {
    result.symptoms.records = Array.isArray(raw.symptoms.records) ? clone(raw.symptoms.records) : [];
    result.symptoms.uncertain_records = Array.isArray(raw.symptoms.uncertain_records)
      ? clone(raw.symptoms.uncertain_records)
      : [];
  }
  if (isRecord(raw.medical)) {
    result.medical.records = Array.isArray(raw.medical.records) ? clone(raw.medical.records) : [];
    result.medical.uncertain_records = Array.isArray(raw.medical.uncertain_records)
      ? clone(raw.medical.uncertain_records)
      : [];
  }
  if (isRecord(raw.activity_chain) && Array.isArray(raw.activity_chain.event_ids)) {
    result.activity_chain.event_ids = raw.activity_chain.event_ids.filter(Boolean);
  }
  return result;
}

function createState(baseState, characterFacts) {
  const state = {
    schema_version: STATE_SCHEMA_VERSION,
    characters: {},
    processed_event_ids: Array.isArray(baseState?.processed_event_ids)
      ? baseState.processed_event_ids.filter(Boolean)
      : [],
    diagnostics: Array.isArray(baseState?.diagnostics) ? clone(baseState.diagnostics) : [],
  };
  if (isRecord(baseState?.characters)) {
    for (const [characterId, character] of Object.entries(baseState.characters)) {
      state.characters[characterId] = normalizeCharacterState(character, characterId);
    }
  }
  for (const [characterId, facts] of Object.entries(characterFacts)) {
    if (!state.characters[characterId]) {
      state.characters[characterId] = emptyCharacterState(facts, characterId);
    } else if (isRecord(facts?.identity)) {
      state.characters[characterId].identity = {
        character_id: characterId,
        display_name: nullable(facts.identity.display_name),
        species: nullable(facts.identity.species),
        biological_type: nullable(facts.identity.biological_type),
      };
    }
  }
  return state;
}

function ensureCharacter(state, characterId, characterFacts) {
  if (!characterId) return null;
  if (!state.characters[characterId]) {
    state.characters[characterId] = emptyCharacterState(characterFacts[characterId], characterId);
  }
  return state.characters[characterId];
}

function addActivity(state, subjectId, eventId, characterFacts) {
  const character = ensureCharacter(state, subjectId, characterFacts);
  if (character) uniquePush(character.activity_chain.event_ids, eventId);
  return character;
}

function isIgnored(event) {
  return IGNORED_STATUSES.has(event.status);
}

function isUncertain(event) {
  return UNCERTAIN_STATUSES.has(event.status);
}

function stateFact(event) {
  return isRecord(event.state_fact) ? event.state_fact : null;
}

function addDiagnostic(state, diagnostic) {
  state.diagnostics.push({
    code: diagnostic.code,
    event_id: diagnostic.event_id ?? null,
    subject_id: diagnostic.subject_id ?? null,
    pregnancy_id: diagnostic.pregnancy_id ?? null,
    detail: diagnostic.detail ?? null,
  });
}

function episodeFor(character, pregnancyId) {
  if (!character.pregnancy.episodes[pregnancyId]) {
    character.pregnancy.episodes[pregnancyId] = normalizeEpisode(null, pregnancyId);
  }
  return character.pregnancy.episodes[pregnancyId];
}

function addPregnancyId(character, pregnancyId) {
  if (pregnancyId) uniquePush(character.conception.pregnancy_ids, pregnancyId);
}

function setConceptionStatus(character, status) {
  if (status === 'confirmed' || character.conception.status === 'unknown') {
    character.conception.status = status;
  } else if (status === 'suspected' && character.conception.status !== 'confirmed') {
    character.conception.status = 'suspected';
  }
}

function recordUncertainEpisode(episode, eventId) {
  uniquePush(episode.uncertain_event_ids, eventId);
}

function applyStateFact(state, event, characterFacts) {
  const fact = stateFact(event);
  if (!fact || !event.event_id) return;
  const character = addActivity(state, fact.subject_id, event.event_id, characterFacts);
  if (!character || isIgnored(event)) return;
  const uncertain = isUncertain(event);
  const payload = fact.payload ?? {};

  switch (event.type) {
    case 'conception': {
      const pregnancyId = payload.pregnancy_id;
      addPregnancyId(character, pregnancyId);
      const episode = episodeFor(character, pregnancyId);
      uniquePush(episode.conception_event_ids, event.event_id);
      if (uncertain) {
        uniquePush(character.conception.uncertain_event_ids, event.event_id);
        recordUncertainEpisode(episode, event.event_id);
        setConceptionStatus(character, 'suspected');
      } else {
        uniquePush(character.conception.confirmed_event_ids, event.event_id);
        setConceptionStatus(character, 'confirmed');
      }
      return;
    }
    case 'pregnancy_suspicion': {
      const pregnancyId = payload.pregnancy_id;
      if (!pregnancyId) {
        addDiagnostic(state, {
          code: 'unresolved_pregnancy_suspicion',
          event_id: event.event_id,
          subject_id: fact.subject_id,
        });
        return;
      }
      const episode = episodeFor(character, pregnancyId);
      uniquePush(episode.suspicion_event_ids, event.event_id);
      if (uncertain) recordUncertainEpisode(episode, event.event_id);
      if (episode.status === 'unknown') episode.status = 'suspected';
      addPregnancyId(character, pregnancyId);
      return;
    }
    case 'pregnancy_confirmation': {
      const pregnancyId = payload.pregnancy_id;
      const episode = episodeFor(character, pregnancyId);
      if (uncertain) {
        recordUncertainEpisode(episode, event.event_id);
        addPregnancyId(character, pregnancyId);
        if (episode.status === 'unknown') episode.status = 'suspected';
      } else if (episode.status === 'ended') {
        addDiagnostic(state, {
          code: 'pregnancy_episode_conflict',
          event_id: event.event_id,
          subject_id: fact.subject_id,
          pregnancy_id: pregnancyId,
          detail: 'confirmation_after_termination',
        });
      } else {
        episode.status = 'confirmed';
        uniquePush(episode.confirmation_event_ids, event.event_id);
        addPregnancyId(character, pregnancyId);
      }
      return;
    }
    case 'pregnancy_loss':
    case 'abortion': {
      const pregnancyId = payload.pregnancy_id;
      const episode = episodeFor(character, pregnancyId);
      if (uncertain) recordUncertainEpisode(episode, event.event_id);
      else uniquePush(episode.termination_event_ids, event.event_id);
      if (!uncertain) {
        if (episode.status === 'ended') {
          addDiagnostic(state, {
            code: 'pregnancy_episode_conflict',
            event_id: event.event_id,
            subject_id: fact.subject_id,
            pregnancy_id: pregnancyId,
            detail: 'repeated_termination',
          });
        } else {
          episode.status = 'ended';
          if (!episode.confirmation_event_ids.length) {
            addDiagnostic(state, {
              code: 'termination_without_confirmed_pregnancy',
              event_id: event.event_id,
              subject_id: fact.subject_id,
              pregnancy_id: pregnancyId,
            });
          }
        }
      }
      addPregnancyId(character, pregnancyId);
      return;
    }
    case 'labor': {
      const episode = episodeFor(character, payload.pregnancy_id);
      if (uncertain) recordUncertainEpisode(episode, event.event_id);
      else uniquePush(episode.labor_event_ids, event.event_id);
      addPregnancyId(character, payload.pregnancy_id);
      return;
    }
    case 'delivery': {
      const pregnancyId = payload.pregnancy_id;
      const episode = episodeFor(character, pregnancyId);
      if (uncertain) {
        recordUncertainEpisode(episode, event.event_id);
      } else {
        uniquePush(episode.delivery_event_ids, event.event_id);
        if (episode.status === 'ended') {
          addDiagnostic(state, {
            code: 'pregnancy_episode_conflict',
            event_id: event.event_id,
            subject_id: fact.subject_id,
            pregnancy_id: pregnancyId,
            detail: 'repeated_termination',
          });
        } else {
          episode.status = 'ended';
          if (!episode.confirmation_event_ids.length) {
            addDiagnostic(state, {
              code: 'termination_without_confirmed_pregnancy',
              event_id: event.event_id,
              subject_id: fact.subject_id,
              pregnancy_id: pregnancyId,
            });
          }
        }
      }
      addPregnancyId(character, pregnancyId);
      return;
    }
    case 'postpartum': {
      const pregnancyId = payload.pregnancy_id;
      addPregnancyId(character, pregnancyId);
      if (!character.postpartum.episodes[pregnancyId]) {
        character.postpartum.episodes[pregnancyId] = {
          pregnancy_id: pregnancyId,
          postpartum_id: payload.postpartum_id,
          event_ids: [],
          uncertain_event_ids: [],
        };
      }
      const postpartum = character.postpartum.episodes[pregnancyId];
      if (uncertain) uniquePush(postpartum.uncertain_event_ids, event.event_id);
      else {
        uniquePush(postpartum.event_ids, event.event_id);
        uniquePush(character.postpartum.factual_event_ids, event.event_id);
      }
      return;
    }
    case 'menstrual_event':
    case 'ovulation_event':
      uniquePush(
        uncertain ? character.cycle.uncertain_event_ids : character.cycle.factual_event_ids,
        event.event_id,
      );
      return;
    case 'fertility_change':
      if (!uncertain) {
        for (const [key, value] of Object.entries(payload.capability_changes ?? {})) {
          if (CAPABILITY_KEYS.includes(key) && [true, false, null].includes(value)) {
            character.reproductive_capabilities[key] = value;
          }
        }
      }
      return;
    case 'physical_symptom': {
      const record = {
        event_id: event.event_id,
        subject_id: fact.subject_id,
        story_time: clone(event.story_time),
        status: event.status,
        symptom: clone(payload.symptom),
      };
      (uncertain ? character.symptoms.uncertain_records : character.symptoms.records).push(record);
      return;
    }
    case 'medical_event':
    case 'other_biological': {
      const record = {
        event_id: event.event_id,
        subject_id: fact.subject_id,
        story_time: clone(event.story_time),
        status: event.status,
        fact: clone(payload.fact),
      };
      (uncertain ? character.medical.uncertain_records : character.medical.records).push(record);
      return;
    }
    default:
      return;
  }
}

function exposureRecord(event) {
  const relevance = event.pregnancy_relevance;
  return {
    event_id: event.event_id,
    subject_id: relevance.gestational_subject_ids[0],
    counterpart_ids: clone(relevance.counterpart_ids),
    reproductive_mechanism: clone(relevance.reproductive_mechanism),
    story_time: clone(event.story_time),
    status: event.status,
  };
}

function applyExposure(state, event, characterFacts) {
  if (event.pregnancy_relevance?.relevant !== true || isIgnored(event)) return;
  const subjectId = event.pregnancy_relevance.gestational_subject_ids[0];
  const character = addActivity(state, subjectId, event.event_id, characterFacts);
  if (!character) return;
  const record = exposureRecord(event);
  if (!character.reproductive_exposure.records.some((item) => item.event_id === event.event_id)) {
    character.reproductive_exposure.records.push(record);
  }
}

function refreshExposureDerived(state, currentStoryTime) {
  for (const character of Object.values(state.characters)) {
    const exposure = character.reproductive_exposure;
    const orderedRecords = sortEventsByStoryTime(exposure.records);
    exposure.records = orderedRecords.map((record) => clone(record));
    const ordered = orderedRecords.map((record) => ({
      event_id: record.event_id,
      story_time: record.story_time,
    }));
    const last = ordered.at(-1) ?? null;
    exposure.last_exposure_event_id = last?.event_id ?? null;
    exposure.last_exposure_story_time = last?.story_time ? clone(last.story_time) : null;
    exposure.elapsed_story_days = last
      ? differenceStoryDays(currentStoryTime, last.story_time)
      : null;
    exposure.unresolved_records = exposure.records
      .filter((record) => UNCERTAIN_STATUSES.has(record.status))
      .map((record) => clone(record));
  }
}

function refreshPregnancyDerived(state) {
  for (const character of Object.values(state.characters)) {
    const episodes = character.pregnancy.episodes;
    character.pregnancy.active_pregnancy_ids = Object.values(episodes)
      .filter((episode) => episode.status === 'suspected' || episode.status === 'confirmed')
      .map((episode) => episode.pregnancy_id);
    const active = Object.values(episodes).filter(
      (episode) => episode.status === 'suspected' || episode.status === 'confirmed',
    );
    if (active.some((episode) => episode.status === 'confirmed')) {
      character.pregnancy.current_status = 'confirmed';
    } else if (active.length) {
      character.pregnancy.current_status = 'suspected';
    } else if (Object.keys(episodes).length) {
      character.pregnancy.current_status = 'ended';
    } else {
      character.pregnancy.current_status = 'unknown';
    }
  }
}

function stableDiagnosticSort(left, right) {
  return String(left.code).localeCompare(String(right.code))
    || String(left.event_id ?? '').localeCompare(String(right.event_id ?? ''))
    || String(left.subject_id ?? '').localeCompare(String(right.subject_id ?? ''))
    || String(left.pregnancy_id ?? '').localeCompare(String(right.pregnancy_id ?? ''))
    || String(left.detail ?? '').localeCompare(String(right.detail ?? ''));
}

function stableEventFingerprint(event) {
  if (Array.isArray(event)) return `[${event.map(stableEventFingerprint).join(',')}]`;
  if (!event || typeof event !== 'object') return JSON.stringify(event);
  return `{${Object.keys(event).sort().map((key) => `${JSON.stringify(key)}:${stableEventFingerprint(event[key])}`).join(',')}}`;
}

function prepareEvents(events, state) {
  const normalized = Array.isArray(events) ? events.map((event) => normalizeEvent(event)) : [];
  const byId = new Map();
  const unique = [];
  const conflictingIds = new Set();
  for (const event of normalized) {
    if (!event.event_id) {
      addDiagnostic(state, { code: 'invalid_event', detail: 'event_id_required' });
      continue;
    }
    if (!byId.has(event.event_id)) {
      byId.set(event.event_id, event);
      unique.push(event);
      continue;
    }
    if (stableEventFingerprint(byId.get(event.event_id)) !== stableEventFingerprint(event)) {
      conflictingIds.add(event.event_id);
    }
  }
  for (const eventId of conflictingIds) {
    addDiagnostic(state, { code: 'event_id_conflict', event_id: eventId });
  }
  const candidates = unique.filter((event) => !conflictingIds.has(event.event_id));
  const valid = [];
  for (const event of candidates) {
    const validation = validateEvent(event, { strictCanonicalParticipants: true });
    if (!validation.ok) {
      addDiagnostic(state, {
        code: 'invalid_event',
        event_id: event.event_id,
        detail: validation.errors.join('|'),
      });
      continue;
    }
    valid.push(event);
  }
  return sortEvents(dedupeEvents(valid));
}

function finalizeState(state) {
  state.processed_event_ids = [...new Set(state.processed_event_ids)].filter(Boolean);
  state.diagnostics.sort(stableDiagnosticSort);
  for (const character of Object.values(state.characters)) {
    for (const episode of Object.values(character.pregnancy.episodes)) {
      for (const key of Object.keys(episode)) {
        if (Array.isArray(episode[key])) episode[key] = [...new Set(episode[key])];
      }
    }
    character.conception.pregnancy_ids = [...new Set(character.conception.pregnancy_ids)];
    character.pregnancy.active_pregnancy_ids = [...new Set(character.pregnancy.active_pregnancy_ids)];
  }
  return state;
}

/**
 * Reduce already-normalized biological facts into a transient Current State.
 * This function is intentionally independent of Runtime, Storage, AI and UI.
 */
export function reduceState({
  baseState = null,
  events = [],
  currentStoryTime = null,
  characterFacts = {},
} = {}) {
  const normalizedCharacterFacts = validateCharacterFacts(characterFacts);
  const state = createState(baseState, normalizedCharacterFacts);
  const preparedEvents = prepareEvents(events, state);
  for (const event of preparedEvents) {
    state.processed_event_ids.push(event.event_id);
    const fact = stateFact(event);
    if (event.pregnancy_relevance?.relevant === true) {
      const subjectId = event.pregnancy_relevance.gestational_subject_ids[0];
      addActivity(state, subjectId, event.event_id, normalizedCharacterFacts);
      applyExposure(state, event, normalizedCharacterFacts);
    }
    if (fact) applyStateFact(state, event, normalizedCharacterFacts);
  }
  refreshExposureDerived(state, currentStoryTime);
  refreshPregnancyDerived(state);
  return finalizeState(state);
}

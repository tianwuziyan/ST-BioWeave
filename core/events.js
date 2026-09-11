import {normalizeStoryTime} from '../story/time.js';

export const EVENT_SCHEMA_VERSION = 1;

export const EVENT_STATUS = Object.freeze([
  'confirmed',
  'probable',
  'ambiguous',
  'negated',
  'fictional',
]);

export const EVENT_TYPES = Object.freeze([
  'sexual_activity',
  'conception',
  'pregnancy_suspicion',
  'pregnancy_confirmation',
  'pregnancy_loss',
  'abortion',
  'labor',
  'delivery',
  'postpartum',
  'menstrual_event',
  'ovulation_event',
  'fertility_change',
  'physical_symptom',
  'medical_event',
  'other_biological',
]);

export const REPRODUCTIVE_ROLES = Object.freeze([
  'potential_gestational_subject',
  'potential_conception_source',
  'other_participant',
  'unknown',
]);

export const CAPABILITY_KEYS = Object.freeze([
  'can_produce_sperm',
  'can_produce_ova',
  'can_be_fertilized',
  'can_carry_pregnancy',
  'can_cause_pregnancy',
]);

export const STORY_TIME_PRECISIONS = Object.freeze([
  'year',
  'month',
  'day',
  'hour',
  'minute',
  'unknown',
]);

// Keep the singular export for callers that use the schema name as a lookup.
export const STORY_TIME_PRECISION = STORY_TIME_PRECISIONS;

export const BIOLOGICAL_EVENT_SCHEMA = Object.freeze({
  schema_version: EVENT_SCHEMA_VERSION,
  event_id: null,
  type: null,
  status: null,
  location: null,
  participants: [],
  pregnancy_relevance: {
    relevant: false,
    possible_conception: false,
    gestational_subject_ids: [],
    counterpart_ids: [],
    confidence: null,
  },
  source_evidence: [],
  source: {
    chat_id: null,
    message_id: null,
    floor: null,
    swipe_id: null,
    content_hash: null,
    message_version: null,
  },
  story_time: {
    display: null,
    normalized: null,
    day_index: null,
    calendar_id: null,
    provider: null,
    precision: 'unknown',
    confidence: null,
  },
});

function hasOwn(value, key) {
  return Boolean(value && Object.prototype.hasOwnProperty.call(value, key));
}

function recordValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function textValue(value) {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

function nullableText(value) {
  const text = textValue(value);
  return text || null;
}

function identifierValue(value) {
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function scalarValue(value) {
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return null;
}

function nullableNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function confidenceValue(value) {
  const parsed = nullableNumber(value);
  return parsed === null ? null : Math.max(0, Math.min(1, parsed));
}

function capabilityValue(value) {
  return value === true || value === false ? value : null;
}

function readCapability(source, key, aliases = []) {
  if (hasOwn(source, key)) return capabilityValue(source[key]);
  for (const alias of aliases) {
    if (hasOwn(source, alias)) return capabilityValue(source[alias]);
  }
  return null;
}

function normalizeIdArray(value) {
  const values = Array.isArray(value)
    ? value
    : typeof value === 'string' && !value.includes(',')
      ? [value]
      : [];
  const seen = new Set();
  const result = [];
  for (const item of values) {
    const id = identifierValue(item);
    // A comma-delimited string is never split into names or accidental IDs.
    if (!id || id.includes(',') || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}

function normalizeEvidence(value) {
  if (!Array.isArray(value)) return [];
  return value.map(item => {
    if (typeof item === 'string') {
      return {kind: 'unknown', text: item.trim()};
    }
    const source = recordValue(item);
    return {
      ...source,
      kind: nullableText(source.kind) ?? 'unknown',
      text: nullableText(source.text ?? source.content),
    };
  });
}

function normalizeCapabilities(rawParticipant) {
  const participant = recordValue(rawParticipant);
  const source = recordValue(hasOwn(participant, 'reproductive_capabilities_used')
    ? participant.reproductive_capabilities_used
    : participant.reproductive_capabilities);
  const merged = {...participant, ...source};
  return {
    can_produce_sperm: readCapability(merged, 'can_produce_sperm'),
    can_produce_ova: readCapability(merged, 'can_produce_ova'),
    can_be_fertilized: readCapability(merged, 'can_be_fertilized'),
    can_carry_pregnancy: readCapability(merged, 'can_carry_pregnancy'),
    can_cause_pregnancy: readCapability(merged, 'can_cause_pregnancy', ['can_fertilize']),
  };
}

function normalizeParticipant(rawParticipant = {}) {
  const source = recordValue(rawParticipant);
  const rawContext = recordValue(source.biological_context);
  return {
    ...source,
    character_id: identifierValue(source.character_id),
    display_name: nullableText(source.display_name),
    event_role: REPRODUCTIVE_ROLES.includes(source.event_role)
      ? source.event_role
      : 'unknown',
    biological_context: {
      ...rawContext,
      species: nullableText(rawContext.species),
      biological_type: nullableText(rawContext.biological_type),
    },
    reproductive_capabilities_used: normalizeCapabilities(source),
    evidence: normalizeEvidence(source.evidence),
  };
}

function normalizePregnancyRelevance(raw = {}) {
  const source = recordValue(raw);
  return {
    ...source,
    relevant: source.relevant === true,
    possible_conception: source.possible_conception === true,
    gestational_subject_ids: normalizeIdArray(source.gestational_subject_ids),
    counterpart_ids: normalizeIdArray(source.counterpart_ids),
    confidence: confidenceValue(source.confidence),
  };
}

function normalizeSource(raw = {}) {
  const source = recordValue(raw);
  return {
    ...source,
    chat_id: identifierValue(source.chat_id),
    message_id: scalarValue(source.message_id),
    floor: scalarValue(source.floor),
    swipe_id: scalarValue(source.swipe_id),
    content_hash: nullableText(source.content_hash),
    message_version: scalarValue(source.message_version),
  };
}

export function normalizeEvent(raw = {}) {
  const source = recordValue(raw);
  return {
    ...source,
    event_id: identifierValue(source.event_id),
    type: nullableText(source.type),
    status: nullableText(source.status),
    location: nullableText(source.location),
    participants: Array.isArray(source.participants)
      ? source.participants.map(normalizeParticipant)
      : [],
    pregnancy_relevance: normalizePregnancyRelevance(source.pregnancy_relevance),
    source_evidence: normalizeEvidence(source.source_evidence),
    source: normalizeSource(source.source),
    story_time: normalizeStoryTime(source.story_time),
    physical_effect: recordValue(source.physical_effect),
  };
}

function addError(errors, path) {
  if (!errors.includes(path)) errors.push(path);
}

function validScalar(value) {
  return value === null
    || (typeof value === 'number' && Number.isFinite(value))
    || (typeof value === 'string' && value.trim() !== '');
}

function validateEvidence(value, path, errors) {
  if (!Array.isArray(value)) {
    addError(errors, path);
    return;
  }
  value.forEach((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      addError(errors, `${path}[${index}]`);
      return;
    }
    if (!textValue(item.kind)) addError(errors, `${path}[${index}].kind`);
    if (!textValue(item.text)) addError(errors, `${path}[${index}].text`);
  });
}

export function validateEvent(event) {
  const errors = [];
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    return {ok: false, errors: ['event']};
  }

  let normalized;
  try {
    normalized = normalizeEvent(event);
  } catch (error) {
    return {ok: false, errors: [error?.message || 'event']};
  }
  if (!normalized.event_id) addError(errors, 'event_id');
  if (!EVENT_TYPES.includes(normalized.type)) addError(errors, 'type');
  if (!EVENT_STATUS.includes(normalized.status)) addError(errors, 'status');
  if (!normalized.source.chat_id) addError(errors, 'source.chat_id');

  const rawSource = recordValue(event.source);
  for (const key of ['message_id', 'floor', 'swipe_id', 'message_version']) {
    if (hasOwn(rawSource, key) && !validScalar(rawSource[key])) addError(errors, `source.${key}`);
  }
  if (hasOwn(rawSource, 'content_hash')
    && rawSource.content_hash !== null
    && (!textValue(rawSource.content_hash))) {
    addError(errors, 'source.content_hash');
  }

  if (hasOwn(event, 'participants') && !Array.isArray(event.participants)) {
    addError(errors, 'participants');
  }
  normalized.participants.forEach((participant, index) => {
    if (!participant.character_id) addError(errors, `participants[${index}].character_id`);
    if (!REPRODUCTIVE_ROLES.includes(participant.event_role)) {
      addError(errors, `participants[${index}].event_role`);
    }
    const capabilities = participant.reproductive_capabilities_used;
    for (const key of CAPABILITY_KEYS) {
      if (capabilities[key] !== null && capabilities[key] !== true && capabilities[key] !== false) {
        addError(errors, `participants[${index}].reproductive_capabilities_used.${key}`);
      }
    }
    const rawParticipant = event.participants?.[index];
    if (rawParticipant && typeof rawParticipant === 'object' && !Array.isArray(rawParticipant)) {
      if (hasOwn(rawParticipant, 'event_role')
        && !REPRODUCTIVE_ROLES.includes(rawParticipant.event_role)) {
        addError(errors, `participants[${index}].event_role`);
      }
      const rawCapabilities = hasOwn(rawParticipant, 'reproductive_capabilities_used')
        ? rawParticipant.reproductive_capabilities_used
        : rawParticipant.reproductive_capabilities;
      if (rawCapabilities !== undefined) {
        if (!rawCapabilities || typeof rawCapabilities !== 'object' || Array.isArray(rawCapabilities)) {
          addError(errors, `participants[${index}].reproductive_capabilities_used`);
        } else {
          for (const key of CAPABILITY_KEYS) {
            if (hasOwn(rawCapabilities, key)
              && rawCapabilities[key] !== null
              && rawCapabilities[key] !== true
              && rawCapabilities[key] !== false) {
              addError(errors, `participants[${index}].reproductive_capabilities_used.${key}`);
            }
          }
        }
      }
      if (hasOwn(rawParticipant, 'evidence')) {
        validateEvidence(rawParticipant.evidence, `participants[${index}].evidence`, errors);
      }
    }
  });

  if (hasOwn(event, 'pregnancy_relevance')
    && (!event.pregnancy_relevance || typeof event.pregnancy_relevance !== 'object'
      || Array.isArray(event.pregnancy_relevance))) {
    addError(errors, 'pregnancy_relevance');
  }
  const relevance = normalized.pregnancy_relevance;
  const rawRelevance = recordValue(event.pregnancy_relevance);
  for (const key of ['relevant', 'possible_conception']) {
    if (hasOwn(rawRelevance, key) && typeof rawRelevance[key] !== 'boolean') {
      addError(errors, `pregnancy_relevance.${key}`);
    }
  }
  for (const key of ['gestational_subject_ids', 'counterpart_ids']) {
    if (hasOwn(rawRelevance, key) && !Array.isArray(rawRelevance[key])) {
      addError(errors, `pregnancy_relevance.${key}`);
    }
  }
  if (hasOwn(rawRelevance, 'confidence')
    && rawRelevance.confidence !== null
    && (!Number.isFinite(Number(rawRelevance.confidence))
      || Number(rawRelevance.confidence) < 0
      || Number(rawRelevance.confidence) > 1)) {
    addError(errors, 'pregnancy_relevance.confidence');
  }
  if (!Array.isArray(relevance.gestational_subject_ids)) addError(errors, 'pregnancy_relevance.gestational_subject_ids');
  if (!Array.isArray(relevance.counterpart_ids)) addError(errors, 'pregnancy_relevance.counterpart_ids');
  if (relevance.confidence !== null && (!Number.isFinite(relevance.confidence) || relevance.confidence < 0 || relevance.confidence > 1)) {
    addError(errors, 'pregnancy_relevance.confidence');
  }

  if (hasOwn(event, 'source_evidence')) validateEvidence(event.source_evidence, 'source_evidence', errors);
  for (const key of ['message_id', 'floor', 'swipe_id', 'message_version']) {
    if (!validScalar(normalized.source[key])) addError(errors, `source.${key}`);
  }

  const storyTime = normalized.story_time;
  if (hasOwn(event, 'story_time')
    && (!event.story_time || typeof event.story_time !== 'object' || Array.isArray(event.story_time))) {
    addError(errors, 'story_time');
  }
  const rawStoryTime = recordValue(event.story_time);
  if (hasOwn(rawStoryTime, 'precision') && !STORY_TIME_PRECISIONS.includes(rawStoryTime.precision)) {
    addError(errors, 'story_time.precision');
  }
  const rawDayIndex = hasOwn(rawStoryTime, 'day_index') ? rawStoryTime.day_index : rawStoryTime.dayIndex;
  if ((hasOwn(rawStoryTime, 'day_index') || hasOwn(rawStoryTime, 'dayIndex'))
    && rawDayIndex !== null
    && rawDayIndex !== undefined
    && !Number.isFinite(Number(rawDayIndex))) {
    addError(errors, 'story_time.day_index');
  }
  if (hasOwn(rawStoryTime, 'confidence')
    && rawStoryTime.confidence !== null
    && (!Number.isFinite(Number(rawStoryTime.confidence))
      || Number(rawStoryTime.confidence) < 0
      || Number(rawStoryTime.confidence) > 1)) {
    addError(errors, 'story_time.confidence');
  }
  if (!STORY_TIME_PRECISIONS.includes(storyTime.precision)) addError(errors, 'story_time.precision');
  if (storyTime.day_index !== null && !Number.isFinite(storyTime.day_index)) addError(errors, 'story_time.day_index');
  if (storyTime.confidence !== null && (!Number.isFinite(storyTime.confidence) || storyTime.confidence < 0 || storyTime.confidence > 1)) {
    addError(errors, 'story_time.confidence');
  }

  return {ok: errors.length === 0, errors};
}

function sortableNumber(value, fallback) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function sortEvents(events = []) {
  if (!Array.isArray(events)) return [];
  return [...events].sort((left, right) => {
    const floorOrder = sortableNumber(left?.source?.floor, 0) - sortableNumber(right?.source?.floor, 0);
    if (floorOrder) return floorOrder;
    const leftDay = sortableNumber(left?.story_time?.day_index, Number.POSITIVE_INFINITY);
    const rightDay = sortableNumber(right?.story_time?.day_index, Number.POSITIVE_INFINITY);
    if (leftDay !== rightDay) return leftDay - rightDay;
    return String(left?.event_id ?? '').localeCompare(String(right?.event_id ?? ''));
  });
}

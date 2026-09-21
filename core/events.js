import { normalizeStoryTime } from '../story/time.js';

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
  'reproductive_source_attribution',
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
  'can_fertilize',
  'can_carry_pregnancy',
  'can_cause_pregnancy',
]);

export const STATE_FACT_EVENT_TYPES = Object.freeze([
  'conception',
  'pregnancy_suspicion',
  'pregnancy_confirmation',
  'reproductive_source_attribution',
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

const STATE_FACT_EVENT_TYPE_SET = new Set(STATE_FACT_EVENT_TYPES);
const STATE_FACT_REFERENCE_KINDS = new Set(['new', 'existing']);
const CANONICAL_CHARACTER_ID_PATTERN = /^char_\d{6}$/u;

export const PREGNANCY_RELEVANT_EXPOSURE_EVIDENCE_KIND =
  'pregnancy_relevant_exposure';

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
    reproductive_mechanism: {
      kind: null,
      label: null,
      pathway: null,
      world_model_rule_refs: [],
      evidence: [],
    },
    confidence: null,
  },
  source_evidence: [],
  physical_effect: {
    gestational_substance_intake: null,
  },
  // State facts are only present for type-specific state transitions. Exposure
  // remains authoritative in pregnancy_relevance and must not be duplicated.
  state_fact: null,
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
    precision: 'unknown',
    confidence: null,
  },
});

function hasOwn(value, key) {
  return Boolean(value && Object.prototype.hasOwnProperty.call(value, key));
}

function recordValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {};
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

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function normalizeStateFact(raw = null) {
  if (!isRecord(raw)) return null;
  const source = recordValue(raw);
  const payload = recordValue(source.payload);
  return {
    subject_id: identifierValue(source.subject_id),
    payload: { ...payload },
  };
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
  return value.map((item) => {
    if (typeof item === 'string') {
      return { kind: 'unknown', text: item.trim() };
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
  const source = recordValue(
    hasOwn(participant, 'reproductive_capabilities_used')
      ? participant.reproductive_capabilities_used
      : participant.reproductive_capabilities,
  );
  const merged = { ...participant, ...source };
  return {
    can_produce_sperm: readCapability(merged, 'can_produce_sperm'),
    can_produce_ova: readCapability(merged, 'can_produce_ova'),
    can_be_fertilized: readCapability(merged, 'can_be_fertilized'),
    can_fertilize: readCapability(merged, 'can_fertilize'),
    can_carry_pregnancy: readCapability(merged, 'can_carry_pregnancy'),
    can_cause_pregnancy: readCapability(merged, 'can_cause_pregnancy'),
  };
}

function normalizeParticipant(rawParticipant = {}) {
  const source = recordValue(rawParticipant);
  const rawContext = recordValue(source.biological_context);
  const {
    identity_status: _identityStatus,
    mention_id: _mentionId,
    alias_candidate: _aliasCandidate,
    identity_evidence: _identityEvidence,
    ...persistedSource
  } = source;
  return {
    ...persistedSource,
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

function normalizeParticipants(value) {
  if (!Array.isArray(value)) return [];
  const result = [];
  const indexes = new Map();
  for (const rawParticipant of value) {
    const participant = normalizeParticipant(rawParticipant);
    const characterId = participant.character_id;
    if (!characterId || !indexes.has(characterId)) {
      if (characterId) indexes.set(characterId, result.length);
      result.push(participant);
      continue;
    }
    // Preserve the existing last-record-wins compatibility behavior while
    // keeping the canonical participants list unique by character_id.
    result[indexes.get(characterId)] = participant;
  }
  return result;
}

function normalizePregnancyRelevance(raw = {}) {
  const source = recordValue(raw);
  const mechanism = recordValue(source.reproductive_mechanism);
  return {
    ...source,
    relevant: source.relevant === true,
    possible_conception: source.possible_conception === true,
    gestational_subject_ids: normalizeIdArray(source.gestational_subject_ids),
    counterpart_ids: normalizeIdArray(source.counterpart_ids),
    reproductive_mechanism: {
      kind: nullableText(mechanism.kind),
      label: nullableText(mechanism.label),
      pathway: nullableText(mechanism.pathway),
      world_model_rule_refs: normalizeIdArray(mechanism.world_model_rule_refs),
      evidence: normalizeEvidence(mechanism.evidence),
    },
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
    participants: normalizeParticipants(source.participants),
    pregnancy_relevance: normalizePregnancyRelevance(
      source.pregnancy_relevance,
    ),
    source_evidence: normalizeEvidence(source.source_evidence),
    source: normalizeSource(source.source),
    story_time: normalizeStoryTime(source.story_time, { formatDisplay: true }),
    physical_effect: recordValue(source.physical_effect),
    state_fact: normalizeStateFact(source.state_fact),
  };
}

export function hasStateFactContract(eventType) {
  return STATE_FACT_EVENT_TYPE_SET.has(eventType);
}

export function isCanonicalCharacterId(value) {
  return typeof value === 'string' && CANONICAL_CHARACTER_ID_PATTERN.test(value);
}

export function getStateFactStoryTime(event) {
  return normalizeStoryTime(event?.story_time ?? null);
}

function validStateFactReference(value, {allowNew = false} = {}) {
  if (!isRecord(value)) return false;
  if (!STATE_FACT_REFERENCE_KINDS.has(value.kind)) return false;
  if (value.kind === 'new') return allowNew && value.id === undefined;
  return typeof value.id === 'string' && value.id.trim() !== '';
}

function validateStateFactPayload(type, payload, errors, path) {
  const keys = Object.keys(payload);
  const only = (...allowed) => keys.every((key) => allowed.includes(key));
  const text = (value) => typeof value === 'string' && value.trim() !== '';
  const factRecord = (value, field) => {
    if (!isRecord(value) || !text(value.kind)) {
      addError(errors, `${path}.${field}`);
      return;
    }
    if (value.description !== undefined && value.description !== null && !text(value.description)) {
      addError(errors, `${path}.${field}.description`);
    }
  };

  switch (type) {
    case 'menstrual_event':
    case 'ovulation_event':
      if (keys.length !== 0) addError(errors, path);
      return;
    case 'conception':
      if (!only('pregnancy_id') || !text(payload.pregnancy_id)) addError(errors, path);
      return;
    case 'pregnancy_suspicion':
      if (!only('pregnancy_id', 'observation') || !Object.hasOwn(payload, 'observation')) {
        addError(errors, path);
      }
      if (payload.pregnancy_id !== undefined && payload.pregnancy_id !== null && !text(payload.pregnancy_id)) {
        addError(errors, `${path}.pregnancy_id`);
      }
      factRecord(payload.observation, 'observation');
      return;
    case 'pregnancy_confirmation':
      if (!only('pregnancy_id') || !text(payload.pregnancy_id)) addError(errors, path);
      return;
    case 'reproductive_source_attribution':
      if (!only('pregnancy_id', 'source_character_id', 'contribution_kind', 'attribution')
        || !text(payload.pregnancy_id)
        || !text(payload.source_character_id)
        || !text(payload.contribution_kind)
        || !['confirmed', 'excluded'].includes(payload.attribution)) addError(errors, path);
      return;
    case 'pregnancy_loss':
    case 'abortion':
      if (!only('pregnancy_id') || !text(payload.pregnancy_id)) addError(errors, path);
      return;
    case 'labor':
      if (!only('pregnancy_id', 'labor_id') || !text(payload.pregnancy_id) || !text(payload.labor_id)) addError(errors, path);
      return;
    case 'delivery':
      if (!only('pregnancy_id', 'delivery_id') || !text(payload.pregnancy_id) || !text(payload.delivery_id)) addError(errors, path);
      return;
    case 'postpartum':
      if (!only('pregnancy_id', 'postpartum_id') || !text(payload.pregnancy_id) || !text(payload.postpartum_id)) addError(errors, path);
      return;
    case 'fertility_change': {
      const changes = payload.capability_changes;
      if (!only('capability_changes') || !isRecord(changes) || !Object.keys(changes).length) {
        addError(errors, path);
        return;
      }
      for (const key of Object.keys(changes)) {
        if (!CAPABILITY_KEYS.includes(key) || ![true, false, null].includes(changes[key])) {
          addError(errors, `${path}.capability_changes.${key}`);
        }
      }
      return;
    }
    case 'physical_symptom':
      if (!only('symptom')) addError(errors, path);
      factRecord(payload.symptom, 'symptom');
      return;
    case 'medical_event':
      if (!only('fact')) addError(errors, path);
      factRecord(payload.fact, 'fact');
      return;
    case 'other_biological':
      if (!only('fact')) addError(errors, path);
      factRecord(payload.fact, 'fact');
      return;
    default:
      addError(errors, path);
  }
}

function validateStateFact(normalized, errors, {strictCanonicalParticipants = false} = {}) {
  const type = normalized.type;
  const stateFact = normalized.state_fact;
  const isExposure = normalized.pregnancy_relevance.relevant === true;
  if (isExposure) {
    if (stateFact !== null) addError(errors, 'state_fact');
    return;
  }
  if (type === 'sexual_activity') {
    if (stateFact !== null) addError(errors, 'state_fact');
    return;
  }
  if (!hasStateFactContract(type)) return;
  if (!stateFact) {
    addError(errors, 'state_fact');
    return;
  }
  if (!stateFact.subject_id) addError(errors, 'state_fact.subject_id');
  if (strictCanonicalParticipants && !isCanonicalCharacterId(stateFact.subject_id)) {
    addError(errors, 'state_fact.subject_id');
  }
  const participantIds = new Set(normalized.participants.map((item) => item.character_id).filter(Boolean));
  if (!participantIds.has(stateFact.subject_id)) addError(errors, 'state_fact.subject_id');
  validateStateFactPayload(type, stateFact.payload, errors, 'state_fact.payload');
}

export function validateCharacterFacts(raw = {}) {
  const source = isRecord(raw) ? raw : {};
  const result = {};
  for (const [characterId, value] of Object.entries(source)) {
    if (!isCanonicalCharacterId(characterId) || !isRecord(value) || !isRecord(value.identity) || value.identity.character_id !== characterId) continue;
    const capabilities = isRecord(value.reproductive_capabilities)
      ? Object.fromEntries(CAPABILITY_KEYS.map((key) => [key, [true, false, null].includes(value.reproductive_capabilities[key]) ? value.reproductive_capabilities[key] : null]))
      : Object.fromEntries(CAPABILITY_KEYS.map((key) => [key, null]));
    result[characterId] = {
      identity: {
        character_id: characterId,
        display_name: nullableText(value.identity.display_name),
        species: nullableText(value.identity.species),
        biological_type: nullableText(value.identity.biological_type),
      },
      reproductive_capabilities: capabilities,
      resolved_mechanism_facts: Array.isArray(value.resolved_mechanism_facts)
        ? value.resolved_mechanism_facts.map((item) => ({...recordValue(item)}))
        : [],
    };
  }
  return result;
}

function addError(errors, path) {
  if (!errors.includes(path)) errors.push(path);
}

function validScalar(value) {
  return (
    value === null ||
    (typeof value === 'number' && Number.isFinite(value)) ||
    (typeof value === 'string' && value.trim() !== '')
  );
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

function validateIdArrayShape(value, path, errors) {
  if (!Array.isArray(value)) return;
  value.forEach((item, index) => {
    const id = identifierValue(item);
    if (!id || id.includes(',')) addError(errors, `${path}[${index}]`);
  });
}

export function hasPregnancyRelevantExposureEvidence(value) {
  return (
    Array.isArray(value) &&
    value.some(
      (item) =>
        item &&
        typeof item === 'object' &&
        !Array.isArray(item) &&
        textValue(item.kind) === PREGNANCY_RELEVANT_EXPOSURE_EVIDENCE_KIND,
    )
  );
}

export function isPregnancyRelevantExposure(rawEvent) {
  const normalized = normalizeEvent(rawEvent);
  const relevance = normalized.pregnancy_relevance;
  return (
    validateEvent(normalized).ok &&
    !['negated', 'fictional'].includes(normalized.status) &&
    relevance.relevant === true &&
    relevance.gestational_subject_ids.length > 0 &&
    relevance.counterpart_ids.length > 0 &&
    hasPregnancyRelevantExposureEvidence(normalized.source_evidence)
  );
}

function validateExposureConsistency(normalized, participantIds, errors) {
  const relevance = normalized.pregnancy_relevance;
  const gestationalSubjectIds = relevance.gestational_subject_ids;
  const counterpartIds = relevance.counterpart_ids;
  const validateReferences = (ids, path) => {
    ids.forEach((id, index) => {
      if (!participantIds.has(id)) addError(errors, `${path}[${index}]`);
    });
  };

  validateReferences(
    gestationalSubjectIds,
    'pregnancy_relevance.gestational_subject_ids',
  );
  validateReferences(counterpartIds, 'pregnancy_relevance.counterpart_ids');

  if (relevance.relevant === true) {
    if (!gestationalSubjectIds.length)
      addError(errors, 'pregnancy_relevance.gestational_subject_ids');
    if (!counterpartIds.length)
      addError(errors, 'pregnancy_relevance.counterpart_ids');
    const exposureParticipantIds = new Set([
      ...gestationalSubjectIds,
      ...counterpartIds,
    ]);
    if (normalized.type === 'sexual_activity') {
      if (gestationalSubjectIds.length !== 1) {
        addError(errors, 'pregnancy_relevance.gestational_subject_ids');
      }
      const subjectSet = new Set(gestationalSubjectIds);
      counterpartIds.forEach((id, index) => {
        if (subjectSet.has(id))
          addError(errors, `pregnancy_relevance.counterpart_ids[${index}]`);
      });
      normalized.participants.forEach((participant, index) => {
        if (
          participant.character_id &&
          !exposureParticipantIds.has(participant.character_id)
        ) {
          addError(errors, `participants[${index}].character_id`);
        }
      });
      if (participantIds.size !== exposureParticipantIds.size)
        addError(errors, 'participants');
    } else {
      normalized.participants.forEach((participant, index) => {
        if (
          participant.character_id &&
          !exposureParticipantIds.has(participant.character_id)
        ) {
          addError(errors, `participants[${index}].character_id`);
        }
      });
    }
    if (!hasPregnancyRelevantExposureEvidence(normalized.source_evidence)) {
      addError(
        errors,
        `source_evidence.${PREGNANCY_RELEVANT_EXPOSURE_EVIDENCE_KIND}`,
      );
    }
  } else if (normalized.type === 'sexual_activity') {
    if (gestationalSubjectIds.length)
      addError(errors, 'pregnancy_relevance.gestational_subject_ids');
    if (counterpartIds.length)
      addError(errors, 'pregnancy_relevance.counterpart_ids');
    if (normalized.participants.length) addError(errors, 'participants');
  }

  if (
    normalized.physical_effect.gestational_substance_intake === true &&
    !hasPregnancyRelevantExposureEvidence(normalized.source_evidence)
  ) {
    addError(
      errors,
      `source_evidence.${PREGNANCY_RELEVANT_EXPOSURE_EVIDENCE_KIND}`,
    );
  }
}

export function validateEvent(
  event,
  { strictCanonicalParticipants = false } = {},
) {
  const errors = [];
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    return { ok: false, errors: ['event'] };
  }

  let normalized;
  try {
    normalized = normalizeEvent(event);
  } catch (error) {
    return { ok: false, errors: [error?.message || 'event'] };
  }
  if (!normalized.event_id) addError(errors, 'event_id');
  if (!EVENT_TYPES.includes(normalized.type)) addError(errors, 'type');
  if (!EVENT_STATUS.includes(normalized.status)) addError(errors, 'status');
  if (!normalized.source.chat_id) addError(errors, 'source.chat_id');

  const rawSource = recordValue(event.source);
  for (const key of ['message_id', 'floor', 'swipe_id', 'message_version']) {
    if (hasOwn(rawSource, key) && !validScalar(rawSource[key]))
      addError(errors, `source.${key}`);
  }
  if (
    hasOwn(rawSource, 'content_hash') &&
    rawSource.content_hash !== null &&
    !textValue(rawSource.content_hash)
  ) {
    addError(errors, 'source.content_hash');
  }

  if (hasOwn(event, 'participants') && !Array.isArray(event.participants)) {
    addError(errors, 'participants');
  }
  const rawParticipants = Array.isArray(event.participants)
    ? event.participants
    : [];
  if (strictCanonicalParticipants) {
    const seenParticipantIds = new Set();
    rawParticipants.forEach((rawParticipant, index) => {
      const characterId = identifierValue(rawParticipant?.character_id);
      if (!characterId || seenParticipantIds.has(characterId)) {
        if (characterId)
          addError(errors, `participants[${index}].character_id`);
        return;
      }
      seenParticipantIds.add(characterId);
    });
  }
  normalized.participants.forEach((participant, index) => {
    if (!participant.character_id)
      addError(errors, `participants[${index}].character_id`);
    if (!REPRODUCTIVE_ROLES.includes(participant.event_role)) {
      addError(errors, `participants[${index}].event_role`);
    }
    const capabilities = participant.reproductive_capabilities_used;
    for (const key of CAPABILITY_KEYS) {
      if (
        capabilities[key] !== null &&
        capabilities[key] !== true &&
        capabilities[key] !== false
      ) {
        addError(
          errors,
          `participants[${index}].reproductive_capabilities_used.${key}`,
        );
      }
    }
  });
  rawParticipants.forEach((rawParticipant, index) => {
    if (
      rawParticipant &&
      typeof rawParticipant === 'object' &&
      !Array.isArray(rawParticipant)
    ) {
      if (
        hasOwn(rawParticipant, 'event_role') &&
        !REPRODUCTIVE_ROLES.includes(rawParticipant.event_role)
      ) {
        addError(errors, `participants[${index}].event_role`);
      }
      const rawCapabilities = hasOwn(
        rawParticipant,
        'reproductive_capabilities_used',
      )
        ? rawParticipant.reproductive_capabilities_used
        : rawParticipant.reproductive_capabilities;
      if (rawCapabilities !== undefined) {
        if (
          !rawCapabilities ||
          typeof rawCapabilities !== 'object' ||
          Array.isArray(rawCapabilities)
        ) {
          addError(
            errors,
            `participants[${index}].reproductive_capabilities_used`,
          );
        } else {
          for (const key of CAPABILITY_KEYS) {
            if (
              hasOwn(rawCapabilities, key) &&
              rawCapabilities[key] !== null &&
              rawCapabilities[key] !== true &&
              rawCapabilities[key] !== false
            ) {
              addError(
                errors,
                `participants[${index}].reproductive_capabilities_used.${key}`,
              );
            }
          }
        }
      }
      if (hasOwn(rawParticipant, 'evidence')) {
        validateEvidence(
          rawParticipant.evidence,
          `participants[${index}].evidence`,
          errors,
        );
      }
    }
  });

  if (
    hasOwn(event, 'pregnancy_relevance') &&
    (!event.pregnancy_relevance ||
      typeof event.pregnancy_relevance !== 'object' ||
      Array.isArray(event.pregnancy_relevance))
  ) {
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
    if (!hasOwn(rawRelevance, key)) continue;
    if (!Array.isArray(rawRelevance[key])) {
      addError(errors, `pregnancy_relevance.${key}`);
    } else {
      validateIdArrayShape(
        rawRelevance[key],
        `pregnancy_relevance.${key}`,
        errors,
      );
    }
  }
  if (
    hasOwn(rawRelevance, 'confidence') &&
    rawRelevance.confidence !== null &&
    (!Number.isFinite(Number(rawRelevance.confidence)) ||
      Number(rawRelevance.confidence) < 0 ||
      Number(rawRelevance.confidence) > 1)
  ) {
    addError(errors, 'pregnancy_relevance.confidence');
  }
  if (!Array.isArray(relevance.gestational_subject_ids))
    addError(errors, 'pregnancy_relevance.gestational_subject_ids');
  if (!Array.isArray(relevance.counterpart_ids))
    addError(errors, 'pregnancy_relevance.counterpart_ids');
  const rawMechanism = recordValue(rawRelevance.reproductive_mechanism);
  if (
    hasOwn(rawRelevance, 'reproductive_mechanism') &&
    (!rawRelevance.reproductive_mechanism ||
      typeof rawRelevance.reproductive_mechanism !== 'object' ||
      Array.isArray(rawRelevance.reproductive_mechanism))
  ) {
    addError(errors, 'pregnancy_relevance.reproductive_mechanism');
  }
  for (const key of ['kind', 'label', 'pathway']) {
    if (
      hasOwn(rawMechanism, key) &&
      rawMechanism[key] !== null &&
      !textValue(rawMechanism[key])
    ) {
      addError(errors, `pregnancy_relevance.reproductive_mechanism.${key}`);
    }
  }
  for (const key of ['world_model_rule_refs', 'evidence']) {
    if (hasOwn(rawMechanism, key) && !Array.isArray(rawMechanism[key]))
      addError(errors, `pregnancy_relevance.reproductive_mechanism.${key}`);
  }
  if (Array.isArray(rawMechanism.world_model_rule_refs))
    validateIdArrayShape(
      rawMechanism.world_model_rule_refs,
      'pregnancy_relevance.reproductive_mechanism.world_model_rule_refs',
      errors,
    );
  if (hasOwn(rawMechanism, 'evidence'))
    validateEvidence(
      rawMechanism.evidence,
      'pregnancy_relevance.reproductive_mechanism.evidence',
      errors,
    );
  if (
    relevance.confidence !== null &&
    (!Number.isFinite(relevance.confidence) ||
      relevance.confidence < 0 ||
      relevance.confidence > 1)
  ) {
    addError(errors, 'pregnancy_relevance.confidence');
  }

  if (hasOwn(event, 'source_evidence'))
    validateEvidence(event.source_evidence, 'source_evidence', errors);
  if (
    hasOwn(event, 'physical_effect') &&
    event.physical_effect !== null &&
    (typeof event.physical_effect !== 'object' ||
      Array.isArray(event.physical_effect))
  ) {
    addError(errors, 'physical_effect');
  }
  const rawPhysicalEffect = recordValue(event.physical_effect);
  if (
    hasOwn(rawPhysicalEffect, 'gestational_substance_intake') &&
    rawPhysicalEffect.gestational_substance_intake !== null &&
    typeof rawPhysicalEffect.gestational_substance_intake !== 'boolean'
  ) {
    addError(errors, 'physical_effect.gestational_substance_intake');
  }
  if (hasOwn(event, 'state_fact') && event.state_fact !== null && !isRecord(event.state_fact)) {
    addError(errors, 'state_fact');
  }
  const participantIds = new Set(
    normalized.participants
      .map((participant) => participant.character_id)
      .filter(Boolean),
  );
  validateExposureConsistency(normalized, participantIds, errors);
  for (const key of ['message_id', 'floor', 'swipe_id', 'message_version']) {
    if (!validScalar(normalized.source[key])) addError(errors, `source.${key}`);
  }

  const storyTime = normalized.story_time;
  if (
    hasOwn(event, 'story_time') &&
    (!event.story_time ||
      typeof event.story_time !== 'object' ||
      Array.isArray(event.story_time))
  ) {
    addError(errors, 'story_time');
  }
  const rawStoryTime = recordValue(event.story_time);
  if (
    hasOwn(rawStoryTime, 'precision') &&
    !STORY_TIME_PRECISIONS.includes(rawStoryTime.precision)
  ) {
    addError(errors, 'story_time.precision');
  }
  const rawDayIndex = hasOwn(rawStoryTime, 'day_index')
    ? rawStoryTime.day_index
    : rawStoryTime.dayIndex;
  if (
    (hasOwn(rawStoryTime, 'day_index') || hasOwn(rawStoryTime, 'dayIndex')) &&
    rawDayIndex !== null &&
    rawDayIndex !== undefined &&
    !Number.isFinite(Number(rawDayIndex))
  ) {
    addError(errors, 'story_time.day_index');
  }
  if (
    hasOwn(rawStoryTime, 'confidence') &&
    rawStoryTime.confidence !== null &&
    (!Number.isFinite(Number(rawStoryTime.confidence)) ||
      Number(rawStoryTime.confidence) < 0 ||
      Number(rawStoryTime.confidence) > 1)
  ) {
    addError(errors, 'story_time.confidence');
  }
  if (!STORY_TIME_PRECISIONS.includes(storyTime.precision))
    addError(errors, 'story_time.precision');
  if (storyTime.day_index !== null && !Number.isFinite(storyTime.day_index))
    addError(errors, 'story_time.day_index');
  if (
    storyTime.confidence !== null &&
    (!Number.isFinite(storyTime.confidence) ||
      storyTime.confidence < 0 ||
      storyTime.confidence > 1)
  ) {
    addError(errors, 'story_time.confidence');
  }

  validateStateFact(normalized, errors, {strictCanonicalParticipants});

  return { ok: errors.length === 0, errors };
}

export function validateEventCollection(events = [], options = {}) {
  if (!Array.isArray(events)) return { ok: false, errors: ['events'] };
  const errors = [];
  const subjectEvents = new Map();
  const seenEventIds = new Map();
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    const eventId = identifierValue(event?.event_id);
    if (eventId && seenEventIds.has(eventId)) {
      const previous = seenEventIds.get(eventId);
      if (stableEventFingerprint(previous) !== stableEventFingerprint(event)) {
        addError(errors, `events[${index}].event_id_conflict`);
      }
      continue;
    }
    if (eventId) seenEventIds.set(eventId, event);
    const validation = validateEvent(event, options);
    for (const error of validation.errors) {
      addError(errors, `events[${index}]${error ? `.${error}` : ''}`);
    }
    let normalized;
    try {
      normalized = normalizeEvent(event);
    } catch {
      normalized = null;
    }
    const relevance = normalized?.pregnancy_relevance;
    if (relevance?.relevant !== true) {
      continue;
    }
    for (const [subjectIndex, subjectId] of relevance.gestational_subject_ids.entries()) {
      if (subjectEvents.has(subjectId)) {
        addError(
          errors,
          `events[${index}].pregnancy_relevance.gestational_subject_ids[${subjectIndex}]`,
        );
        continue;
      }
      subjectEvents.set(subjectId, index);
    }
  }
  return { ok: errors.length === 0, errors };
}

function stableEventValue(value) {
  if (Array.isArray(value)) return value.map(stableEventValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableEventValue(value[key])]),
  );
}

function stableEventFingerprint(value) {
  return JSON.stringify(stableEventValue(value));
}

export function dedupeEvents(events = []) {
  if (!Array.isArray(events)) return [];
  const result = [];
  const seen = new Map();
  for (const event of events) {
    const eventId = identifierValue(event?.event_id);
    if (!eventId || !seen.has(eventId)) {
      if (eventId) seen.set(eventId, event);
      result.push(event);
      continue;
    }
    if (stableEventFingerprint(seen.get(eventId)) !== stableEventFingerprint(event)) {
      result.push(event);
    }
  }
  return result;
}

function sortableNumber(value, fallback) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function sortEvents(events = []) {
  if (!Array.isArray(events)) return [];
  return [...events].sort((left, right) => {
    const floorOrder =
      sortableNumber(left?.source?.floor, 0) -
      sortableNumber(right?.source?.floor, 0);
    if (floorOrder) return floorOrder;
    const leftDay = sortableNumber(
      left?.story_time?.day_index,
      Number.POSITIVE_INFINITY,
    );
    const rightDay = sortableNumber(
      right?.story_time?.day_index,
      Number.POSITIVE_INFINITY,
    );
    if (leftDay !== rightDay) return leftDay - rightDay;
    return String(left?.event_id ?? '').localeCompare(
      String(right?.event_id ?? ''),
    );
  });
}

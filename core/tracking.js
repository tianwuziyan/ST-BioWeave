import {
  CAPABILITY_KEYS,
  normalizeEvent,
  sortEvents,
  validateEvent,
} from './events.js';

function recordValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function identifierValue(value) {
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function textValue(value) {
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function capabilityValue(value) {
  return value === true || value === false ? value : null;
}

function readCapability(source, key) {
  if (Object.prototype.hasOwnProperty.call(source, key)) return capabilityValue(source[key]);
  if (key === 'can_cause_pregnancy' && Object.prototype.hasOwnProperty.call(source, 'can_fertilize')) {
    return capabilityValue(source.can_fertilize);
  }
  return null;
}

function normalizeCapabilities(value = {}) {
  const source = recordValue(value);
  return Object.fromEntries(CAPABILITY_KEYS.map(key => [key, readCapability(source, key)]));
}

function participantEvidence(value) {
  if (!Array.isArray(value)) return [];
  return value.map(item => {
    if (typeof item === 'string') return item.trim();
    const source = recordValue(item);
    return textValue(source.text ?? source.content);
  }).filter(Boolean);
}

function profileFromParticipant(participant) {
  const context = recordValue(participant.biological_context);
  return {
    character_id: participant.character_id,
    display_name: participant.display_name ?? null,
    species: context.species ?? null,
    biological_type: context.biological_type ?? null,
    reproductive_capabilities: normalizeCapabilities(participant.reproductive_capabilities_used),
    evidence: participantEvidence(participant.evidence),
  };
}

function mergeProfiles(previous, next) {
  if (!previous) return next;
  const previousCapabilities = normalizeCapabilities(previous.reproductive_capabilities);
  const nextCapabilities = normalizeCapabilities(next.reproductive_capabilities);
  return {
    character_id: next.character_id,
    display_name: next.display_name ?? previous.display_name ?? null,
    species: next.species ?? previous.species ?? null,
    biological_type: next.biological_type ?? previous.biological_type ?? null,
    reproductive_capabilities: Object.fromEntries(CAPABILITY_KEYS.map(key => [
      key,
      nextCapabilities[key] === null ? previousCapabilities[key] : nextCapabilities[key],
    ])),
    evidence: [...new Set([...(previous.evidence ?? []), ...(next.evidence ?? [])])],
  };
}

function normalizeProfile(value, fallbackId = null) {
  const source = recordValue(value);
  const characterId = identifierValue(source.character_id ?? fallbackId);
  if (!characterId) return null;
  const context = recordValue(source.biological_context);
  return {
    character_id: characterId,
    display_name: textValue(source.display_name),
    species: textValue(source.species ?? context.species),
    biological_type: textValue(source.biological_type ?? context.biological_type),
    reproductive_capabilities: normalizeCapabilities(
      source.reproductive_capabilities ?? source.reproductive_capabilities_used,
    ),
    evidence: participantEvidence(source.evidence),
  };
}

function objectEntries(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? Object.entries(value)
    : [];
}

const REGISTRY_FIELDS = ['tracking_subjects', 'tracking_candidates', 'character_profiles', 'world_model'];

function meaningfulRegistryValue(value) {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return typeof value !== 'string' || value.trim().length > 0;
}

function findRegistryRoot(previousChat) {
  const roots = [
    previousChat,
    previousChat?.bioweave,
    previousChat?.chat_metadata?.bioweave,
    previousChat?.chatMetadata?.bioweave,
    previousChat?.registry,
  ].filter(root => root && typeof root === 'object' && !Array.isArray(root));
  const merged = {};
  for (const field of REGISTRY_FIELDS) {
    const fallback = roots.find(root => Object.prototype.hasOwnProperty.call(root, field));
    if (!fallback) continue;
    const source = roots.find(root => meaningfulRegistryValue(root[field])) ?? fallback;
    merged[field] = source[field];
  }
  return merged;
}

function previousSubjects(previousChat) {
  const root = findRegistryRoot(previousChat);
  const subjects = {};
  for (const [key, value] of objectEntries(root.tracking_subjects)) {
    const source = recordValue(value);
    const characterId = identifierValue(source.character_id ?? key);
    if (!characterId) continue;
    subjects[characterId] = {
      character_id: characterId,
      display_name: textValue(source.display_name),
      created_from_event_id: identifierValue(source.created_from_event_id),
      exposure_event_ids: Array.isArray(source.exposure_event_ids)
        ? source.exposure_event_ids.map(identifierValue).filter(Boolean)
        : [],
      status: source.status === 'active' ? 'active' : 'inactive',
    };
  }
  return subjects;
}

function previousProfiles(previousChat) {
  const root = findRegistryRoot(previousChat);
  const profiles = {};
  for (const [key, value] of objectEntries(root.character_profiles)) {
    const profile = normalizeProfile(value, key);
    if (profile) profiles[profile.character_id] = profile;
  }
  return profiles;
}

function previousCandidates(previousChat) {
  const root = findRegistryRoot(previousChat);
  const candidates = {};
  for (const [key, value] of objectEntries(root.tracking_candidates)) {
    const source = recordValue(value);
    const characterId = identifierValue(source.character_id ?? key);
    if (!characterId) continue;
    const exposureRecords = Array.isArray(source.exposure_records)
      ? source.exposure_records.map(record => {
        const item = recordValue(record);
        const eventId = identifierValue(item.event_id);
        if (!eventId) return null;
        return {
          event_id: eventId,
          story_time: {...recordValue(item.story_time)},
          source: {...recordValue(item.source)},
        };
      }).filter(Boolean)
      : [];
    const exposureEventIds = Array.isArray(source.exposure_event_ids)
      ? source.exposure_event_ids.map(identifierValue).filter(Boolean)
      : [];
    for (const record of exposureRecords) {
      if (!exposureEventIds.includes(record.event_id)) exposureEventIds.push(record.event_id);
    }
    candidates[characterId] = {
      character_id: characterId,
      display_name: textValue(source.display_name),
      exposure_event_ids: exposureEventIds,
      exposure_records: exposureRecords,
      eligibility: 'pending',
      species: textValue(source.species),
      biological_type: textValue(source.biological_type),
      reproductive_capabilities: normalizeCapabilities(source.reproductive_capabilities),
      evidence: participantEvidence(source.evidence),
    };
  }
  return candidates;
}

const EXCLUDED_EVENT_STATUSES = new Set(['negated', 'fictional']);

function normalizeTrackingEvent(rawEvent) {
  try {
    const event = normalizeEvent(rawEvent);
    return {
      event,
      valid: validateEvent(event).ok,
    };
  } catch {
    return {event: null, valid: false};
  }
}

function validTrackingEvent(rawEvent) {
  const result = normalizeTrackingEvent(rawEvent);
  return result.valid ? result.event : null;
}

function eventDecisionReasons(event, valid) {
  if (!valid) return ['INVALID_EVENT'];

  const reasons = [];
  if (event.type !== 'sexual_activity') reasons.push('NOT_SEXUAL_ACTIVITY');
  if (EXCLUDED_EVENT_STATUSES.has(event.status)) reasons.push('EVENT_STATUS_EXCLUDED');
  if (event.pregnancy_relevance.relevant !== true) reasons.push('PREGNANCY_RELEVANCE_FALSE');
  if (event.pregnancy_relevance.possible_conception !== true) reasons.push('POSSIBLE_CONCEPTION_FALSE');
  return reasons;
}

function participantCandidates(event) {
  const participants = new Map();
  const participantIds = [];
  for (const participant of event?.participants ?? []) {
    const characterId = participant.character_id;
    if (!characterId) continue;
    if (!participants.has(characterId)) participantIds.push(characterId);
    // Match the existing eligibility behavior: a duplicate participant ID uses
    // the last participant record supplied by the event.
    participants.set(characterId, participant);
  }

  const candidateIds = [];
  const seen = new Set();
  for (const characterId of event?.pregnancy_relevance?.gestational_subject_ids ?? []) {
    if (seen.has(characterId)) continue;
    seen.add(characterId);
    candidateIds.push(characterId);
  }
  for (const characterId of participantIds) {
    if (seen.has(characterId)) continue;
    seen.add(characterId);
    candidateIds.push(characterId);
  }

  return {participants, candidateIds};
}

function trackingContext(previousChat) {
  const root = findRegistryRoot(previousChat);
  return {
    worldModel: recordValue(root.world_model),
    profiles: previousProfiles(previousChat),
    candidates: previousCandidates(previousChat),
  };
}

function worldModelType(worldModel, identity) {
  if (!identity?.species || !identity?.biological_type) return null;
  const speciesMatches = (Array.isArray(worldModel?.species) ? worldModel.species : [])
    .filter(species => textValue(species?.name) === identity.species);
  if (speciesMatches.length !== 1) return null;
  const types = Array.isArray(speciesMatches[0].biological_types)
    ? speciesMatches[0].biological_types
    : [];
  const typeMatches = types.filter(type => textValue(type?.name) === identity.biological_type);
  return typeMatches.length === 1 ? typeMatches[0] : null;
}

function identityField(records, field) {
  let value = null;
  let conflict = false;
  for (const record of records) {
    const next = textValue(record?.[field]);
    if (!next) continue;
    if (value && value !== next) conflict = true;
    else value = next;
  }
  return {value: conflict ? null : value, conflict};
}

function resolveIdentity(participantRecords, profile, previousCandidate) {
  const contextRecords = participantRecords.map(participant => recordValue(participant.biological_context));
  contextRecords.push({
    species: profile?.species,
    biological_type: profile?.biological_type,
  });
  contextRecords.push({
    species: previousCandidate?.species,
    biological_type: previousCandidate?.biological_type,
  });
  const species = identityField(contextRecords, 'species');
  const biologicalType = identityField(contextRecords, 'biological_type');
  return {
    species: species.value,
    biological_type: biologicalType.value,
    conflict: species.conflict || biologicalType.conflict,
  };
}

function resolveCapabilities(participantRecords, profile, baseline) {
  const capabilities = normalizeCapabilities(baseline);
  const individualValues = Object.fromEntries(CAPABILITY_KEYS.map(key => [key, null]));
  const conflicts = new Set();
  const sources = [profile?.reproductive_capabilities, ...participantRecords.map(
    participant => participant?.reproductive_capabilities_used,
  )];
  for (const source of sources) {
    const normalized = normalizeCapabilities(source);
    for (const key of CAPABILITY_KEYS) {
      if (normalized[key] === null || conflicts.has(key)) continue;
      if (individualValues[key] !== null && individualValues[key] !== normalized[key]) {
        conflicts.add(key);
        capabilities[key] = null;
        continue;
      }
      individualValues[key] = normalized[key];
      capabilities[key] = normalized[key];
    }
  }
  return capabilities;
}

function resolvedParticipantFacts(participantRecords, profile, previousCandidate, worldModel) {
  const identity = resolveIdentity(participantRecords, profile, previousCandidate);
  const type = identity.conflict ? null : worldModelType(worldModel, identity);
  return {
    identity,
    capabilities: identity.conflict
      ? normalizeCapabilities()
      : resolveCapabilities(participantRecords, profile, type?.capabilities),
  };
}

function decisionForParticipant({
  valid,
  characterId,
  participant,
  gestationalSubjectIds,
  eventReasons,
  capabilities,
}) {
  const reasons = [...eventReasons];
  if (!participant) {
    reasons.push('PARTICIPANT_NOT_FOUND');
  } else if (!gestationalSubjectIds.has(characterId)) {
    reasons.push('NOT_GESTATIONAL_SUBJECT');
  } else if (valid && reasons.length === 0) {
    const canCarryPregnancy = capabilities?.can_carry_pregnancy ?? null;
    if (canCarryPregnancy === null) reasons.push('CAN_CARRY_PREGNANCY_UNKNOWN');
    if (canCarryPregnancy === false) reasons.push('CAN_CARRY_PREGNANCY_FALSE');
  }

  const canResolveEligibility = Boolean(
    valid
      && reasons.every(reason => reason === 'CAN_CARRY_PREGNANCY_UNKNOWN'
        || reason === 'CAN_CARRY_PREGNANCY_FALSE'),
  );
  const canCarryPregnancy = capabilities?.can_carry_pregnancy ?? null;
  const eligibility = !canResolveEligibility
    ? 'ineligible'
    : canCarryPregnancy === true
      ? 'eligible'
      : canCarryPregnancy === false
        ? 'ineligible'
        : 'pending';
  return {character_id: characterId, eligibility, reasons};
}

/**
 * Resolve one Event participant through the shared three-state path. The
 * optional Chat context supplies World Model and previously trusted profile
 * evidence; it never creates an identity from labels or display names.
 */
export function trackingDecisionPath(rawEvent, previousChat = null) {
  const normalized = normalizeTrackingEvent(rawEvent);
  const event = normalized.event;
  if (!event) {
    return {
      event: null,
      decisions: [{character_id: null, eligibility: 'ineligible', reasons: ['INVALID_EVENT']}],
    };
  }

  const eventReasons = eventDecisionReasons(event, normalized.valid);
  const {participants, candidateIds} = participantCandidates(event);
  const gestationalSubjectIds = new Set(event.pregnancy_relevance.gestational_subject_ids);
  const context = trackingContext(previousChat);
  const decisions = candidateIds.map(characterId => {
    const participant = participants.get(characterId);
    const profile = context.profiles[characterId];
    const previousCandidate = context.candidates[characterId];
    const facts = resolvedParticipantFacts(
      participant ? [participant] : [],
      profile,
      previousCandidate,
      context.worldModel,
    );
    return decisionForParticipant({
      valid: normalized.valid,
      characterId,
      participant,
      gestationalSubjectIds,
      eventReasons,
      capabilities: facts.capabilities,
    });
  });

  if (!decisions.length && !normalized.valid) {
    decisions.push({character_id: null, eligibility: 'ineligible', reasons: eventReasons});
  }
  return {event, decisions};
}

/**
 * Return stable character IDs that are explicitly marked as gestational
 * subjects by a validated sexual-activity event.
 */
export function eligibleGestationalSubjects(rawEvent, previousChat = null) {
  return trackingDecisionPath(rawEvent, previousChat).decisions
    .filter(decision => decision.eligibility === 'eligible')
    .map(decision => decision.character_id);
}

export function pendingGestationalSubjects(rawEvent, previousChat = null) {
  return trackingDecisionPath(rawEvent, previousChat).decisions
    .filter(decision => decision.eligibility === 'pending')
    .map(decision => decision.character_id);
}

/**
 * Explain the read-only tracking decision for each event participant or
 * gestational-subject candidate. The returned reason codes are stable and
 * never infer eligibility from participant labels.
 */
export function explainTrackingDecision(rawEvent, previousChat = null) {
  return trackingDecisionPath(rawEvent, previousChat).decisions;
}

function uniqueEventList(events) {
  const byId = new Map();
  for (const rawEvent of sortEvents(Array.isArray(events) ? events : [])) {
    const event = validTrackingEvent(rawEvent);
    if (!event?.event_id || byId.has(event.event_id)) continue;
    byId.set(event.event_id, event);
  }
  return [...byId.values()];
}

function addExposure(subject, eventId) {
  if (!subject.exposure_event_ids.includes(eventId)) subject.exposure_event_ids.push(eventId);
}

function addExposureRecord(candidate, event) {
  if (candidate.exposure_event_ids.includes(event.event_id)) return;
  candidate.exposure_event_ids.push(event.event_id);
  candidate.exposure_records.push({
    event_id: event.event_id,
    story_time: {...recordValue(event.story_time)},
    source: {...recordValue(event.source)},
  });
}

function collectExposureCandidates(events) {
  const candidates = new Map();
  const activeEventIds = new Set();
  const validEvents = uniqueEventList(events);
  for (const event of validEvents) {
    const relevance = event.pregnancy_relevance;
    const isExposure = event.type === 'sexual_activity'
      && !EXCLUDED_EVENT_STATUSES.has(event.status)
      && relevance.relevant === true
      && relevance.possible_conception === true;
    if (!isExposure) continue;
    activeEventIds.add(event.event_id);
    const participants = new Map(event.participants
      .filter(participant => participant.character_id)
      .map(participant => [participant.character_id, participant]));
    for (const characterId of relevance.gestational_subject_ids) {
      const participant = participants.get(characterId);
      let candidate = candidates.get(characterId);
      if (!candidate) {
        candidate = {
          character_id: characterId,
          display_name: participant?.display_name ?? null,
          exposure_event_ids: [],
          exposure_records: [],
          participant_records: [],
          evidence: [],
        };
        candidates.set(characterId, candidate);
      }
      if (!candidate.display_name && participant?.display_name) candidate.display_name = participant.display_name;
      addExposureRecord(candidate, event);
      candidate.evidence.push(...participantEvidence(event.source_evidence));
      if (participant) {
        candidate.participant_records.push(participant);
        candidate.evidence.push(...participantEvidence(participant.evidence));
      }
    }
  }
  return {candidates, activeEventIds};
}

/**
 * Rebuild the Chat-local tracking index from the currently valid Floor-bound
 * events. The index stores IDs and small profile facts only; complete events
 * and counterpart lists remain in the event source of truth.
 */
export function rebuildTrackingRegistry(events = [], previousChat = null) {
  // Derived registry state is rebuilt from current valid Floor facts; see .trellis/spec/domain/floor-state.md.
  const subjects = {};
  const profiles = previousProfiles(previousChat);
  const oldSubjects = previousSubjects(previousChat);
  const context = trackingContext(previousChat);
  const {candidates, activeEventIds} = collectExposureCandidates(events);
  const trackingCandidates = {};

  for (const candidate of candidates.values()) {
    const characterId = candidate.character_id;
    const participant = candidate.participant_records.at(-1) ?? null;
    const profile = profiles[characterId];
    const previousCandidate = context.candidates[characterId];
    const facts = resolvedParticipantFacts(
      candidate.participant_records,
      profile,
      previousCandidate,
      context.worldModel,
    );
    const decision = decisionForParticipant({
      valid: true,
      characterId,
      participant,
      gestationalSubjectIds: new Set([characterId]),
      eventReasons: [],
      capabilities: facts.capabilities,
    });

    for (const participantRecord of candidate.participant_records) {
      profiles[characterId] = mergeProfiles(profiles[characterId], profileFromParticipant(participantRecord));
    }

    if (decision.eligibility === 'pending') {
      trackingCandidates[characterId] = {
        character_id: characterId,
        display_name: candidate.display_name ?? profile?.display_name ?? null,
        exposure_event_ids: [...candidate.exposure_event_ids],
        exposure_records: candidate.exposure_records.map(record => ({
          event_id: record.event_id,
          story_time: {...record.story_time},
          source: {...record.source},
        })),
        eligibility: 'pending',
        species: facts.identity.species,
        biological_type: facts.identity.biological_type,
        reproductive_capabilities: facts.capabilities,
        evidence: [...new Set([
          ...(profile?.evidence ?? []),
          ...candidate.evidence,
        ])],
      };
      continue;
    }
    if (decision.eligibility !== 'eligible' || !participant) continue;

    const firstExposureEventId = candidate.exposure_event_ids[0];
    const existing = subjects[characterId] ?? {
      character_id: characterId,
      display_name: candidate.display_name ?? participant.display_name ?? null,
      created_from_event_id: firstExposureEventId,
      exposure_event_ids: [],
      status: 'active',
    };
    if (!existing.display_name && (candidate.display_name || participant.display_name)) {
      existing.display_name = candidate.display_name ?? participant.display_name;
    }
    for (const eventId of candidate.exposure_event_ids) addExposure(existing, eventId);
    const previous = oldSubjects[characterId];
    const createdFrom = previous?.created_from_event_id;
    if (createdFrom && existing.exposure_event_ids.includes(createdFrom)) {
      existing.created_from_event_id = createdFrom;
    }
    subjects[characterId] = existing;
  }

  // Every active reference is recreated from this run's event IDs. This
  // intentionally drops subjects and references whose Floor/Swipe was removed.
  for (const subject of Object.values(subjects)) {
    subject.exposure_event_ids = subject.exposure_event_ids.filter(eventId => activeEventIds.has(eventId));
    if (!subject.exposure_event_ids.length) {
      delete subjects[subject.character_id];
      continue;
    }
    subject.status = 'active';
    if (!subject.exposure_event_ids.includes(subject.created_from_event_id)) {
      subject.created_from_event_id = subject.exposure_event_ids[0];
    }
  }

  const registry = {
    tracking_subjects: subjects,
    tracking_candidates: trackingCandidates,
    character_profiles: profiles,
  };
  // These aliases are intentionally non-enumerable: persistence has one
  // canonical shape while pure callers may use the shorter registry terms.
  Object.defineProperties(registry, {
    subjects: {enumerable: false, get: () => registry.tracking_subjects},
    candidates: {enumerable: false, get: () => registry.tracking_candidates},
    profiles: {enumerable: false, get: () => registry.character_profiles},
  });
  return registry;
}

export const buildTrackingRegistry = rebuildTrackingRegistry;

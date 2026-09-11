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

function normalizeCapabilities(value = {}) {
  const source = recordValue(value);
  return Object.fromEntries(CAPABILITY_KEYS.map(key => [key, capabilityValue(source[key])]));
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

function findRegistryRoot(previousChat) {
  const roots = [
    previousChat,
    previousChat?.bioweave,
    previousChat?.chat_metadata?.bioweave,
    previousChat?.chatMetadata?.bioweave,
    previousChat?.registry,
  ];
  return roots.find(root => root && typeof root === 'object'
    && (root.tracking_subjects || root.character_profiles)) ?? {};
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

function trackingDecisionPath(rawEvent) {
  const normalized = normalizeTrackingEvent(rawEvent);
  const event = normalized.event;
  if (!event) {
    return {
      event: null,
      decisions: [{character_id: null, eligible: false, reasons: ['INVALID_EVENT']}],
    };
  }

  const eventReasons = eventDecisionReasons(event, normalized.valid);
  const {participants, candidateIds} = participantCandidates(event);
  const gestationalSubjectIds = new Set(event.pregnancy_relevance.gestational_subject_ids);
  const decisions = candidateIds.map(characterId => {
    const participant = participants.get(characterId);
    const reasons = [...eventReasons];

    if (!participant) {
      reasons.push('PARTICIPANT_NOT_FOUND');
    } else if (!gestationalSubjectIds.has(characterId)) {
      reasons.push('NOT_GESTATIONAL_SUBJECT');
    } else {
      const canCarryPregnancy = participant.reproductive_capabilities_used.can_carry_pregnancy;
      if (canCarryPregnancy === null) reasons.push('CAN_CARRY_PREGNANCY_UNKNOWN');
      if (canCarryPregnancy === false) reasons.push('CAN_CARRY_PREGNANCY_FALSE');
    }

    return {
      character_id: characterId,
      eligible: reasons.length === 0,
      reasons,
    };
  });

  if (!decisions.length && !normalized.valid) {
    decisions.push({character_id: null, eligible: false, reasons: eventReasons});
  }
  return {event, decisions};
}

/**
 * Return stable character IDs that are explicitly marked as gestational
 * subjects by a validated sexual-activity event.
 */
export function eligibleGestationalSubjects(rawEvent) {
  return trackingDecisionPath(rawEvent).decisions
    .filter(decision => decision.eligible)
    .map(decision => decision.character_id);
}

/**
 * Explain the read-only tracking decision for each event participant or
 * gestational-subject candidate. The returned reason codes are stable and
 * never infer eligibility from participant labels.
 */
export function explainTrackingDecision(rawEvent) {
  return trackingDecisionPath(rawEvent).decisions;
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

/**
 * Rebuild the Chat-local tracking index from the currently valid Floor-bound
 * events. The index stores IDs and small profile facts only; complete events
 * and counterpart lists remain in the event source of truth.
 */
export function rebuildTrackingRegistry(events = [], previousChat = null) {
  const subjects = {};
  const profiles = previousProfiles(previousChat);
  const oldSubjects = previousSubjects(previousChat);
  const activeEventIds = new Set();

  for (const event of uniqueEventList(events)) {
    const candidateIds = eligibleGestationalSubjects(event);
    if (!candidateIds.length) continue;
    activeEventIds.add(event.event_id);
    const participants = new Map(
      event.participants
        .filter(participant => participant.character_id)
        .map(participant => [participant.character_id, participant]),
    );
    for (const characterId of candidateIds) {
      const participant = participants.get(characterId);
      if (!participant) continue;
      const existing = subjects[characterId] ?? {
        character_id: characterId,
        display_name: participant.display_name ?? null,
        created_from_event_id: event.event_id,
        exposure_event_ids: [],
        status: 'active',
      };
      if (!existing.display_name && participant.display_name) existing.display_name = participant.display_name;
      addExposure(existing, event.event_id);
      subjects[characterId] = existing;

      const previous = oldSubjects[characterId];
      const createdFrom = previous?.created_from_event_id;
      if (createdFrom && existing.exposure_event_ids.includes(createdFrom)) {
        existing.created_from_event_id = createdFrom;
      }
      profiles[characterId] = mergeProfiles(profiles[characterId], profileFromParticipant(participant));
    }
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
    character_profiles: profiles,
  };
  // These aliases are intentionally non-enumerable: persistence has one
  // canonical shape while pure callers may use the shorter registry terms.
  Object.defineProperties(registry, {
    subjects: {enumerable: false, get: () => registry.tracking_subjects},
    profiles: {enumerable: false, get: () => registry.character_profiles},
  });
  return registry;
}

export const buildTrackingRegistry = rebuildTrackingRegistry;

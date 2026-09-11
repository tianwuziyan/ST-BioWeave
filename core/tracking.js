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

function validTrackingEvent(rawEvent) {
  try {
    const event = normalizeEvent(rawEvent);
    return validateEvent(event).ok ? event : null;
  } catch {
    return null;
  }
}

/**
 * Return stable character IDs that are explicitly marked as gestational
 * subjects by a validated sexual-activity event.
 */
export function eligibleGestationalSubjects(rawEvent) {
  const event = validTrackingEvent(rawEvent);
  if (!event
    || event.type !== 'sexual_activity'
    || event.status === 'negated'
    || event.status === 'fictional'
    || event.pregnancy_relevance.relevant !== true
    || event.pregnancy_relevance.possible_conception !== true) {
    return [];
  }

  const participants = new Map(
    event.participants
      .filter(participant => participant.character_id)
      .map(participant => [participant.character_id, participant]),
  );
  const eligible = [];
  const seen = new Set();
  for (const characterId of event.pregnancy_relevance.gestational_subject_ids) {
    const participant = participants.get(characterId);
    if (!participant
      || participant.reproductive_capabilities_used.can_carry_pregnancy !== true
      || seen.has(characterId)) continue;
    seen.add(characterId);
    eligible.push(characterId);
  }
  return eligible;
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

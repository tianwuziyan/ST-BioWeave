function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalized(value) {
  const result = text(value);
  return result ? result.normalize('NFKC').toLocaleLowerCase() : null;
}

function aggregationKey(observation) {
  return [
    observation.body_site ?? 'general',
    observation.laterality ?? 'unspecified',
    observation.factual_kind ?? 'unknown',
  ].join('|');
}

const severityRank = {unknown: 0, mild: 1, moderate: 2, severe: 3};

/** Presentation-only summary of the supplied active observations. */
export function summarizeActiveHealthSeverity(observations = []) {
  const active = Array.isArray(observations) ? observations : [];
  if (!active.length) return 'normal';
  let highest = 'unknown';
  for (const observation of active) {
    const severity = normalized(observation?.severity);
    if (severityRank[severity] > severityRank[highest]) highest = severity;
  }
  return highest;
}

/** Presentation-only grouping. It never changes observation lifecycle or authority. */
export function aggregateActiveHealthObservations(observations = []) {
  const groups = new Map();
  for (const observation of Array.isArray(observations) ? observations : []) {
    const key = aggregationKey(observation);
    const existing = groups.get(key);
    if (existing) {
      existing.source_observation_ids.push(observation.source_event_id);
      const description = text(observation.description);
      if (description && !existing.descriptions.includes(description)) existing.descriptions.push(description);
      continue;
    }
    groups.set(key, {
      group_key: key,
      body_site: observation.body_site ?? null,
      display_site: observation.body_site ?? 'general',
      laterality: observation.laterality ?? null,
      factual_kind: observation.factual_kind ?? null,
      description: text(observation.description),
      descriptions: text(observation.description) ? [text(observation.description)] : [],
      source_observation_ids: [observation.source_event_id],
    });
  }
  return [...groups.values()].sort((left, right) =>
    String(left.group_key).localeCompare(String(right.group_key)));
}

export function healthObservationPresentationIdentity(event) {
  const payload = record(event?.state_fact?.payload);
  const fact = record(payload.symptom ?? payload.fact);
  return {
    factual_kind: normalized(fact.kind) ?? text(event?.type) ?? 'unknown',
    body_site: normalized(fact.body_site),
    laterality: text(fact.laterality),
  };
}

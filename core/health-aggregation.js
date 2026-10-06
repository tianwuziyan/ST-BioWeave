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

function aggregationKey(item) {
  const site = normalized(item.body_site);
  const laterality = item.laterality ?? 'unspecified';
  return site
    ? `site|${site}|${laterality}`
    : `missing|${item.source_event_id}`;
}

function commonRecoveryStage(observations) {
  const stages = [...new Set(observations.map(item => item?.recovery_stage ?? null))];
  return stages.length === 1 && stages[0] ? stages[0] : null;
}

function commonCurrentDescription(observations) {
  const descriptions = [...new Set(observations.map(item => text(item?.current_description)).filter(Boolean))];
  return descriptions.length === 1 ? descriptions[0] : null;
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
  const add = (item) => {
    const key = aggregationKey(item);
    const existing = groups.get(key);
    if (existing) {
      existing.source_event_ids.push(item.source_event_id);
      existing.source_observation_ids.push(item.source_event_id);
      const description = text(item.description);
      if (description && !existing.descriptions.includes(description)) existing.descriptions.push(description);
      existing.health_observations.push({
        description,
        factual_kind: item.factual_kind ?? null,
          severity: item.severity ?? 'unknown',
          source_event_id: item.source_event_id,
          recovery_stage: item.recovery_stage ?? null,
          current_description: text(item.current_description ?? item.description),
        });
        existing.recovery_stage = commonRecoveryStage(existing.health_observations);
        existing.current_description = commonCurrentDescription(existing.health_observations);
      return;
    }
    groups.set(key, {
      group_key: key,
      body_site: item.body_site ?? null,
      display_site: item.body_site ?? 'general',
      laterality: item.laterality ?? null,
      factual_kind: item.factual_kind ?? null,
      description: text(item.description),
      descriptions: text(item.description) ? [text(item.description)] : [],
      health_observations: [{description: text(item.description), current_description: text(item.current_description ?? item.description), factual_kind: item.factual_kind ?? null, severity: item.severity ?? 'unknown', source_event_id: item.source_event_id, recovery_stage: item.recovery_stage ?? null}],
      recovery_stage: item.recovery_stage ?? null,
      current_description: text(item.current_description ?? item.description),
      source_observation_ids: [item.source_event_id],
      source_event_ids: [item.source_event_id],
    });
  };
  for (const observation of Array.isArray(observations) ? observations : []) add(observation);
  return [...groups.values()].sort((left, right) =>
    String(left.group_key).localeCompare(String(right.group_key)));
}

export function healthObservationPresentationIdentity(event) {
  const payload = record(event?.state_fact?.payload);
  const fact = record(payload.symptom ?? payload.fact);
  return {
    factual_kind: normalized(fact.kind) ?? text(event?.type) ?? 'unknown',
    body_site: text(fact.body_site),
    laterality: text(fact.laterality),
  };
}

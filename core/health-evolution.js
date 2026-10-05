import {compareStoryTime, differenceStoryDays} from '../story/time.js';
import {healthAssessmentEligibility} from './health-assessment.js';
import {
  aggregateActiveHealthObservations,
  healthObservationPresentationIdentity,
  summarizeActiveHealthSeverity,
} from './health-aggregation.js';

function clone(value) {
  return value === undefined ? value : structuredClone(value);
}

function assessmentByEvent(assessments) {
  return new Map((Array.isArray(assessments) ? assessments : [])
    .filter(item => item?.source_event_id)
    .map(item => [item.source_event_id, item]));
}

function isExpectedRecoveryReached(currentStoryTime, assessment) {
  const boundary = assessment?.expected_recovery?.boundary;
  if (boundary) {
    const comparison = compareStoryTime(currentStoryTime, boundary);
    return comparison !== null && comparison >= 0;
  }
  const duration = Number(assessment?.expected_recovery?.duration?.story_days);
  const reference = assessment?.reference_story_time;
  if (!Number.isFinite(duration) || duration < 0 || !reference) return false;
  const elapsed = differenceStoryDays(currentStoryTime, reference);
  return elapsed !== null && elapsed >= duration;
}

function observationSort(left, right) {
  return String(left.source_event_id).localeCompare(String(right.source_event_id));
}

function buildObservation(event, assessment, currentStoryTime) {
  const identity = healthObservationPresentationIdentity(event);
  const persistence = assessment?.persistence ?? 'unknown';
  const naturalRecovery = assessment?.natural_recovery ?? 'unknown';
  const hasExpectedRecovery = Boolean(
    assessment?.expected_recovery?.boundary || assessment?.expected_recovery?.duration,
  );
  const closed = persistence === 'short_term'
    && naturalRecovery === 'eligible'
    && isExpectedRecoveryReached(currentStoryTime, assessment);
  if (closed) return null;
  return {
    source_event_id: event.event_id,
    assessment_id: assessment?.assessment_id ?? null,
    severity: assessment?.severity ?? 'unknown',
    factual_kind: identity.factual_kind,
    description: event.state_fact?.payload?.symptom?.description
      ?? event.state_fact?.payload?.fact?.description
      ?? null,
    body_site: identity.body_site,
    laterality: identity.laterality,
    persistence,
    natural_recovery: naturalRecovery,
    reference_story_time: clone(assessment?.reference_story_time ?? event.story_time),
    earliest_recovery: clone(assessment?.earliest_recovery ?? null),
    expected_recovery: clone(assessment?.expected_recovery ?? null),
    status: hasExpectedRecovery && persistence === 'short_term' && naturalRecovery === 'eligible'
      ? 'active_before_expected_boundary'
      : 'active_or_unresolved',
  };
}

export function emptyCurrentHealthState() {
  return {schema_version: 1, characters: {}};
}

/**
 * Pure observation lifecycle calculation. Each surviving health observation
 * owns its Assessment and recovery boundary; presentation grouping is separate.
 */
export function deriveCurrentHealthState({events = [], assessments = [], currentStoryTime = null} = {}) {
  const assessmentMap = assessmentByEvent(assessments);
  const characters = {};
  for (const event of Array.isArray(events) ? events : []) {
    if (!healthAssessmentEligibility(event).eligible) continue;
    const subject = event?.state_fact?.subject_id;
    if (!subject) continue;
    const observation = buildObservation(event, assessmentMap.get(event.event_id), currentStoryTime);
    if (!observation) continue;
    characters[subject] ??= {active_observations: [], grouped_issues: [], current_health_summary: null};
    characters[subject].active_observations.push(observation);
  }
  for (const character of Object.values(characters)) {
    character.active_observations.sort(observationSort);
    character.grouped_issues = aggregateActiveHealthObservations(character.active_observations);
    character.severity_summary = summarizeActiveHealthSeverity(character.active_observations);
  }
  return {schema_version: 1, characters};
}

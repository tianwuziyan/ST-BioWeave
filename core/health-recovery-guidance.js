import {differenceStoryDays, compareStoryTime} from '../story/time.js';

export const HEALTH_RECOVERY_STAGES = Object.freeze(['early', 'recovering', 'near_recovery']);

const stageRank = Object.freeze({early: 0, recovering: 1, near_recovery: 2});

function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function guidanceFingerprint(value) {
  const source = text(value);
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `guidance_${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function finiteNonNegative(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function stageForRatio(ratio) {
  if (ratio < 1 / 3) return 'early';
  if (ratio < 2 / 3) return 'recovering';
  return 'near_recovery';
}

function expectedDuration(observation) {
  const reference = observation?.reference_story_time;
  const boundary = observation?.expected_recovery?.boundary;
  if (reference && boundary) {
    const duration = differenceStoryDays(boundary, reference);
    if (duration !== null && duration > 0) return duration;
  }
  return finiteNonNegative(observation?.expected_recovery?.duration?.story_days);
}

function elapsedDuration(observation, currentStoryTime) {
  if (!observation?.reference_story_time || !currentStoryTime) return null;
  return differenceStoryDays(currentStoryTime, observation.reference_story_time);
}

export function evaluateHealthRecoveryStage(observation, currentStoryTime) {
  if (
    observation?.persistence !== 'short_term' ||
    observation?.natural_recovery !== 'eligible'
  ) return null;

  const duration = expectedDuration(observation);
  const elapsed = elapsedDuration(observation, currentStoryTime);
  if (duration === null || elapsed === null || elapsed < 0 || duration <= 0) return null;

  const boundary = observation?.expected_recovery?.boundary;
  if (boundary && compareStoryTime(currentStoryTime, boundary) === null) return null;
  if (elapsed >= duration) return null;

  return stageForRatio(Math.max(0, Math.min(1, elapsed / duration)));
}

export function selectHealthRecoveryGuidance(observation, currentStoryTime) {
  const stage = evaluateHealthRecoveryStage(observation, currentStoryTime);
  const guidance = text(observation?.recovery_stage_guidance?.[stage]);
  return {stage, guidance: guidance || null};
}

function siteLabel(observation) {
  const site = text(observation?.body_site);
  if (!site || site === 'general') return '全身';
  const laterality = text(observation?.laterality);
  const side = {left: '左', right: '右', bilateral: '双侧', midline: '中线'}[laterality.toLowerCase()] ?? '';
  const names = {
    wrist: '手腕',
    ankle: '脚踝',
    hand: '手',
    arm: '手臂',
    leg: '腿',
    head: '头部',
    chest: '胸部',
    abdomen: '腹部',
  };
  return side + (names[site.toLowerCase()] ?? site);
}

function issueLabel(observation) {
  const kind = text(observation?.factual_kind);
  const labels = {
    pain: '疼痛',
    fever: '发热',
    nausea: '恶心',
    fatigue: '乏力',
    abrasion: '擦伤',
    sprain: '扭伤',
    infection: '感染',
  };
  return labels[kind.toLowerCase()] ?? kind;
}

function presentationKey(observation) {
  return [
    siteLabel(observation),
    issueLabel(observation),
  ].join('|');
}

function groupGuidance(observations, currentStoryTime, subjectId, trace) {
  const groups = new Map();
  for (const observation of observations) {
    const selection = selectHealthRecoveryGuidance(observation, currentStoryTime);
    const stage = selection.stage;
    const profileAvailable = Boolean(observation?.recovery_stage_guidance);
    trace?.({
      stage: 'HEALTH_RECOVERY_STAGE_SELECTED',
      source_event_id: observation?.source_event_id ?? null,
      character_id: subjectId,
      assessment_id: observation?.assessment_id ?? null,
      recovery_stage: stage,
      stage_selection_outcome: stage ? 'selected' : 'not_selected',
      stage_selection_reason: stage ? 'stage_selected' : 'not_selected_by_existing_health_rules',
      profile_available: profileAvailable,
      active: true,
    });
    const guidance = selection.guidance;
    if (!stage || !guidance || !text(observation?.factual_kind)) continue;
    trace?.({
      stage: 'HEALTH_RECOVERY_GUIDANCE_SELECTED',
      source_event_id: observation?.source_event_id ?? null,
      character_id: subjectId,
      assessment_id: observation?.assessment_id ?? null,
      recovery_stage: stage,
      guidance_present: true,
      guidance_fingerprint: guidanceFingerprint(guidance),
    });
    const key = presentationKey(observation);
    const current = groups.get(key);
    if (!current || stageRank[stage] < stageRank[current.stage]) {
      groups.set(key, {
        site: siteLabel(observation),
        issue: issueLabel(observation),
        stage,
        guidance: [guidance],
        guidance_fingerprints: [guidanceFingerprint(guidance)],
      });
    } else {
      if (stageRank[stage] < stageRank[current.stage]) current.stage = stage;
      if (!current.guidance.includes(guidance)) {
        current.guidance.push(guidance);
        current.guidance_fingerprints.push(guidanceFingerprint(guidance));
      }
    }
  }
  return [...groups.values()].sort((left, right) =>
    left.site.localeCompare(right.site) ||
    left.issue.localeCompare(right.issue));
}

/**
 * Build non-factual recovery guidance from the already-derived active Health
 * State. No AI, storage, Event, Assessment, or lifecycle mutation belongs here.
 */
export function buildHealthRecoveryGuidance({currentHealthState = null, currentStoryTime = null, trace = null} = {}) {
  const result = [];
  const characters = currentHealthState?.characters;
  if (!characters || typeof characters !== 'object' || Array.isArray(characters)) return result;

  for (const [subjectId, character] of Object.entries(characters)) {
    const active = Array.isArray(character?.active_observations) ? character.active_observations : [];
    const observations = active.map(item => ({...item}));
    const groups = groupGuidance(observations, currentStoryTime, subjectId, trace);
    if (!groups.length) continue;
    const bySite = new Map();
    for (const group of groups) {
      const existing = bySite.get(group.site) ?? [];
      existing.push(group);
      bySite.set(group.site, existing);
    }
    for (const [site, issues] of bySite) {
      result.push({
        subject_id: subjectId,
        body_site: site,
        stage: issues.reduce((earliest, item) =>
          stageRank[item.stage] < stageRank[earliest] ? item.stage : earliest, issues[0].stage),
        guidance: issues.flatMap(item => item.guidance).join(' '),
        guidance_fingerprints: issues.flatMap(item => item.guidance_fingerprints),
      });
    }
  }
  return result.sort((left, right) =>
    String(left.subject_id).localeCompare(String(right.subject_id)) ||
    String(left.body_site).localeCompare(String(right.body_site)));
}

import {differenceStoryTime} from '../story/time.js';

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function episodeStatus(character) {
  const pregnancy = object(character?.pregnancy);
  const episodes = object(pregnancy.episodes);
  const entries = Object.entries(episodes).filter(([, episode]) => object(episode).status === 'confirmed');
  if (entries.length) {
    const activeIds = new Set(Array.isArray(pregnancy.active_pregnancy_ids) ? pregnancy.active_pregnancy_ids.map(value => String(value)) : []);
    return entries.find(([id]) => activeIds.has(String(id))) ?? entries[0];
  }
  if (pregnancy.current_status === 'suspected') return [null, null];
  return [null, null];
}

function earliestComparableEvent(events, currentStoryTime = null) {
  const candidates = (Array.isArray(events) ? events : []).filter(event => event?.story_time)
  const comparable = currentStoryTime
    ? candidates.filter(event => {
        try {
          const difference = differenceStoryTime(currentStoryTime, event.story_time)
          return Boolean(difference && Number.isFinite(Number(difference.value)))
        } catch {
          return false
        }
      })
    : candidates
  if (!comparable.length) return null
  return comparable.reduce((earliest, candidate) => {
    try {
      const difference = differenceStoryTime(candidate.story_time, earliest.story_time)
      return difference && Number(difference.value) < 0 ? candidate : earliest
    } catch {
      return earliest
    }
  }, comparable[0])
}

function anchorTime(episode, events, currentStoryTime = null) {
  const ids = [
    ...(Array.isArray(episode?.conception_event_ids) ? episode.conception_event_ids : []),
  ];
  const byId = new Map((Array.isArray(events) ? events : []).map(event => [event?.event_id, event]));
  const conception = ids.map(id => byId.get(id)).filter(Boolean);
  const conceptionAnchor = earliestComparableEvent(conception, currentStoryTime)
  if (conceptionAnchor) return conceptionAnchor;
  const confirmationIds = Array.isArray(episode?.confirmation_event_ids) ? episode.confirmation_event_ids : [];
  return earliestComparableEvent(confirmationIds.map(id => byId.get(id)).filter(Boolean), currentStoryTime);
}

function unresolvedSuspicionSubjects(events) {
  const subjects = new Set();
  const projectingStatuses = new Set(['confirmed', 'probable', 'ambiguous']);
  for (const event of Array.isArray(events) ? events : []) {
    if (event?.type !== 'pregnancy_suspicion' || !projectingStatuses.has(event?.status)) continue;
    const subjectId = String(event?.state_fact?.subject_id ?? '').trim();
    const payload = object(event?.state_fact?.payload);
    // This is deliberately a read-only fallback for the UI.  A suspicion
    // without a pregnancy_id must not create an episode or mutate State.
    if (!subjectId || payload.pregnancy_id || payload.pregnancy_ref) continue;
    if (!Object.hasOwn(payload, 'observation')) continue;
    subjects.add(subjectId);
  }
  return subjects;
}

function weeksFor(episode, events, currentStoryTime) {
  if (!episode || !currentStoryTime) return null;
  const anchor = anchorTime(episode, events, currentStoryTime);
  if (!anchor?.story_time) return null;
  let difference;
  try { difference = differenceStoryTime(currentStoryTime, anchor.story_time); } catch { return null; }
  if (!difference || !Number.isFinite(Number(difference.value))) return null;
  const days = difference.unit === 'minute' ? Number(difference.value) / 1440 : Number(difference.value);
  if (days < 0) return null;
  return Math.floor(days / 7);
}

/** Read-only UI projection. It never mutates State or Floor data. */
export function derivePregnancyStatus({currentState = null, events = [], currentStoryTime = null} = {}) {
  const characters = object(currentState?.characters);
  const suspicionSubjects = unresolvedSuspicionSubjects(events);
  const subjectIds = new Set([...Object.keys(characters), ...suspicionSubjects]);
  return [...subjectIds].map(subjectId => {
    const character = characters[subjectId] ?? null;
    const [pregnancyId, episode] = episodeStatus(character);
    const currentStatus = object(character?.pregnancy).current_status ?? 'unknown';
    const status = pregnancyId
      ? 'confirmed'
      : currentStatus === 'suspected'
        ? 'suspected'
        : currentStatus === 'ended'
          ? 'ended'
          : suspicionSubjects.has(subjectId)
            ? 'suspected'
            : 'unknown';
    return {
      subject_id: subjectId,
      status,
      pregnancy_id: pregnancyId,
      gestational_weeks: status === 'confirmed' ? weeksFor(episode, events, currentStoryTime) : null,
    };
  });
}

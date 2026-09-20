import {ordinalOf} from '../business/calendar/date.js';
import {parseStoryTimeDate} from './time.js';

// BioWeave only needs elapsed-time arithmetic for biological tracking. Custom
// era labels use the built-in Gregorian month/leap-year rules without becoming
// Gregorian identities or requiring a user-managed calendar registry.
export const BIOWEAVE_ERA_CALENDAR = Object.freeze({kind: 'era-standard'});

function textValue(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function eraOf(value) {
  const display = textValue(value?.display ?? value);
  return display ? parseStoryTimeDate(display)?.eraLabel ?? null : null;
}

function parsedDate(value) {
  const display = textValue(value?.display ?? value);
  return display ? parseStoryTimeDate(display) : null;
}

export function createCalendarResolver() {
  function resolve({story_time: storyTime = null, era_label: eraLabel = null} = {}) {
    const era = textValue(eraLabel) ?? eraOf(storyTime);
    if (era) {
      return {
        descriptor: BIOWEAVE_ERA_CALENDAR,
        calendar_id: null,
        era_label: era,
        calculation_level: 2,
        failure_reason: null,
      };
    }
    return {
      descriptor: null,
      calendar_id: null,
      era_label: null,
      calculation_level: null,
      failure_reason: null,
    };
  }

  function resolvePair(left, right) {
    const leftResolved = resolve({story_time: left});
    const rightResolved = resolve({story_time: right});
    const leftEra = leftResolved.era_label ?? eraOf(left);
    const rightEra = rightResolved.era_label ?? eraOf(right);
    if (leftEra && rightEra && leftEra !== rightEra) {
      return {
        descriptor: null,
        calendar_id: null,
        era_label: null,
        calculation_level: null,
        failure_reason: 'ERA_MISMATCH',
      };
    }
    return leftEra ? leftResolved : rightEra ? rightResolved : {
      descriptor: null,
      calendar_id: null,
      era_label: null,
      calculation_level: null,
      failure_reason: null,
    };
  }

  return {resolve, resolvePair};
}

export function calendarDateForStoryTime(value) {
  return parsedDate(value);
}

export function ordinalInYear(value) {
  const date = parsedDate(value);
  return date ? ordinalOf(date, BIOWEAVE_ERA_CALENDAR) : null;
}

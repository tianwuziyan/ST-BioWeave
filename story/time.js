import {
  addCalendarDays,
  daysInMonth,
  isGregorian,
  ordinalOf,
  validateCalendarDescriptor,
} from '../business/calendar/date.js';
import { matchTraditionalTime, parseCnDate, parseTraditionalTime } from '../utils/cn-date.js';

export { matchTraditionalTime, parseCnDate, parseTraditionalTime };
export const parseStoryTimeDate = parseCnDate;
export const parseStoryTimeTime = parseTraditionalTime;

export const STORY_TIME_PRECISION = Object.freeze({
  YEAR: 'year',
  MONTH: 'month',
  DAY: 'day',
  HOUR: 'hour',
  MINUTE: 'minute',
  UNKNOWN: 'unknown',
});

export const STORY_TIME_PRECISIONS = Object.freeze(Object.values(STORY_TIME_PRECISION));

function hasOwn(value, key) {
  return Boolean(value && Object.prototype.hasOwnProperty.call(value, key));
}

function recordValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
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

function finiteNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function confidenceValue(value) {
  const parsed = finiteNumber(value);
  return parsed === null ? null : Math.max(0, Math.min(1, parsed));
}

function validPrecision(value) {
  return STORY_TIME_PRECISIONS.includes(value) ? value : null;
}

function strictDayIndex(normalized) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null;
  const [year, month, day] = normalized.split('-').map(Number);
  const timestamp = Date.UTC(year, month - 1, day);
  const date = new Date(timestamp);
  if (date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day) {
    return null;
  }
  return Math.floor(timestamp / 86400000);
}

function calendarIdentity(calendar) {
  return nullableText(calendar?.calendar_id ?? calendar?.calendarId ?? calendar?.id);
}

function calendarYearLength(calendar) {
  if (!validateCalendarDescriptor(calendar) || isGregorian(calendar)) return null;
  const total = calendar.months.reduce((sum, month) => sum + Number(month.days), 0);
  return Number.isInteger(total) && total > 0 ? total : null;
}

function customCalendarDayIndex(date, calendar) {
  const yearLength = calendarYearLength(calendar);
  if (yearLength === null || !Number.isInteger(date?.year)) return null;
  const ordinal = ordinalOf(date, calendar);
  if (!Number.isInteger(ordinal)) return null;
  if (Number.isInteger(calendar.epochYear)) {
    const epochOrdinal = Number.isInteger(calendar.epochOrdinal) ? calendar.epochOrdinal : 1;
    return (date.year - calendar.epochYear) * yearLength + ordinal - epochOrdinal;
  }
  if (calendar.absoluteCycle === true) return (date.year - 1) * yearLength + ordinal - 1;
  return null;
}

function parseCalendarDateValue(value, calendar) {
  const source = sourceStoryTime(value);
  const display = nullableText(source.display);
  if (!display) return null;
  const parsed = parseDisplayDate(display, calendar);
  if (!parsed) return null;
  return {
    ...parsed,
    day_index: customCalendarDayIndex(parsed, calendar),
  };
}

function customCalendarDifference(left, right, calendar) {
  if ((isGregorian(calendar) && calendar?.kind !== 'era-standard') || !isGregorian(calendar)) return null;
  const leftDate = parseCalendarDateValue(left, calendar);
  const rightDate = parseCalendarDateValue(right, calendar);
  if (!leftDate || !rightDate) return null;
  if ((leftDate.eraLabel || null) !== (rightDate.eraLabel || null)) return null;
  const leftOrdinal = ordinalOf(leftDate, calendar);
  const rightOrdinal = ordinalOf(rightDate, calendar);
  if (!Number.isInteger(leftOrdinal) || !Number.isInteger(rightOrdinal)) return null;
  if (leftDate.year === rightDate.year) return leftOrdinal - rightOrdinal;
  const yearLength = year => {
    let total = 0;
    for (let month = 1; month <= 12; month += 1) total += daysInMonth(calendar, month, year);
    return total;
  };
  if (leftDate.year > rightDate.year) {
    let difference = leftOrdinal - rightOrdinal;
    for (let year = rightDate.year; year < leftDate.year; year += 1) difference += yearLength(year);
    return difference;
  }
  let difference = leftOrdinal - rightOrdinal;
  for (let year = leftDate.year; year < rightDate.year; year += 1) difference -= yearLength(year);
  return difference;
}

function normalizeDayIndex(value) {
  const parsed = finiteNumber(value);
  return parsed === null ? null : Math.trunc(parsed);
}

function sourceStoryTime(raw) {
  if (typeof raw === 'string') return {display: raw};
  const source = recordValue(raw);
  if (source.story_time && typeof source.story_time === 'object' && !Array.isArray(source.story_time)) {
    return source.story_time;
  }
  return source;
}

function hasStructuredDate(source) {
  return ['normalized', 'iso_date', 'isoDate', 'date', 'iso', 'day_index', 'dayIndex']
    .some(key => hasOwn(source, key) && source[key] !== null && source[key] !== undefined && source[key] !== '');
}

function parsedDateKey(date, calendar) {
  if (!date) return null;
  if (date.eraLabel || date.year == null || !isGregorian(calendar)) {
    return `cn-${date.year == null ? 0 : date.year}-${date.month}-${date.day}`;
  }
  return `${String(date.year).padStart(4, '0')}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
}

function parsedDateDisplay(date) {
  if (!date) return null;
  const year = date.year == null ? '' : `${date.eraLabel || ''}${date.year}年`;
  return `${year}${date.month}月${date.day}日`;
}

function sameParsedDate(left, right) {
  return Boolean(left && right)
    && left.year === right.year
    && left.month === right.month
    && left.day === right.day
    && (left.eraLabel || null) === (right.eraLabel || null);
}

function isDateContinuation(value) {
  return /[0-9０-９年月日初第节節]/u.test(value);
}

function parseDisplayDateCandidate(value, calendar = null) {
  const parsed = parseCnDate(value, {calendar});
  if (parsed || !/元\s*年/u.test(value)) return parsed;
  // parseCnDate already understands 元 as a year-first token. For an
  // era-prefixed first year, give the unchanged parser its equivalent 一年
  // spelling and keep the original text for display replacement.
  return parseCnDate(value.replace(/元(?=\s*年)/gu, '一'), {calendar});
}

function findParsedDateSpan(rawDisplay, parsedDate, calendar = null) {
  const value = String(rawDisplay ?? '');
  for (let start = 0; start < value.length; start += 1) {
    for (let end = start + 1; end <= value.length; end += 1) {
      if (!sameParsedDate(parseDisplayDateCandidate(value.slice(start, end), calendar), parsedDate)) continue;
      const hasDaySuffix = value[end] === '日';
      const dateEnd = hasDaySuffix ? end + 1 : end;
      const next = value[dateEnd];
      if (hasDaySuffix || next === undefined || !isDateContinuation(next)) {
        return {start, end: dateEnd};
      }
      if (!sameParsedDate(
        parseDisplayDateCandidate(value.slice(start, dateEnd + 1), calendar),
        parsedDate,
      )) {
        return {start, end: dateEnd};
      }
    }
  }
  return null;
}

/**
 * Format only a parsed date within a display string. The remainder is kept
 * verbatim so arbitrary time or narrative text is not interpreted here.
 */
export function formatParsedDateDisplay(rawDisplay, parsedDate, {calendar = null} = {}) {
  if (!parsedDate || typeof rawDisplay !== 'string') return rawDisplay;
  const span = findParsedDateSpan(rawDisplay, parsedDate, calendar);
  if (!span) return rawDisplay;
  const trailing = rawDisplay.slice(span.end);
  if (!trailing.trim() && !(/[年]/u.test(rawDisplay.slice(span.start, span.end))
    && /[月日]/u.test(rawDisplay.slice(span.start, span.end)))) {
    return rawDisplay;
  }
  const separator = trailing && !/^\s/.test(trailing) ? ' ' : '';
  return `${rawDisplay.slice(0, span.start)}${parsedDateDisplay(parsedDate)}${separator}${trailing}`;
}

function parseDisplayDate(rawDisplay, calendar = null) {
  let best = parseDisplayDateCandidate(rawDisplay, calendar);
  const score = value => (value?.year == null ? 0 : 1) + (value?.eraLabel ? 1 : 0);
  for (let end = 1; end <= rawDisplay.length; end += 1) {
    const prefix = parseDisplayDateCandidate(rawDisplay.slice(0, end), calendar);
    if (!prefix) continue;
    if (!best || score(prefix) > score(best) || score(prefix) === score(best)) best = prefix;
  }
  return best;
}

function traditionalTimeDisplay(time) {
  return `${String(time.hour).padStart(2, '0')}:${String(time.minute).padStart(2, '0')}`;
}

function traditionalTimePrecision(time) {
  return time.segment || time.marks > 0 ? STORY_TIME_PRECISION.MINUTE : STORY_TIME_PRECISION.HOUR;
}

function numericTimeMatch(text) {
  const value = String(text ?? '');
  const match = /(?:^|[T\s])(?:(上午|下午|晚上|夜间)\s*)?(\d{1,2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:\d{2})?(?=$|\s|[｜|,，。])/u.exec(value);
  if (!match) return null;
  let hour = Number(match[2]);
  const minute = Number(match[3]);
  const second = match[4] == null ? null : Number(match[4]);
  if (match[1] && hour > 12) return null;
  if (match[1] === '下午' || match[1] === '晚上' || match[1] === '夜间') hour = hour === 12 ? 12 : hour + 12;
  if (match[1] === '上午' && hour === 12) hour = 0;
  if (hour < 0 || hour > 23 || minute > 59 || (second !== null && second > 59)) return null;
  return {
    hour,
    minute,
    ...(second === null ? {} : {second}),
    timezone: match[5] ?? null,
    text: match[0].trim(),
    index: match.index + (match[0].startsWith('T') || match[0].startsWith(' ') ? 1 : 0),
  };
}

function timeFromDisplay(display) {
  const traditional = matchTraditionalTime(display, {search: true, includeInvalid: true});
  if (traditional?.invalid) return traditional;
  return traditional ?? numericTimeMatch(display);
}

function isCompleteTimeText(text, time) {
  return Boolean(time && time.text && time.text.trim() === String(text ?? '').trim());
}

function timePrecision(time) {
  return time?.branch ? traditionalTimePrecision(time) : time?.second != null
    ? STORY_TIME_PRECISION.MINUTE
    : STORY_TIME_PRECISION.MINUTE;
}

function shiftedParsedDate(date, calendar, dayOffset) {
  if (!dayOffset) return date;
  if (isGregorian(calendar) && (date.eraLabel || date.year == null)) return null;
  const shifted = addCalendarDays({
    year: date.year == null ? null : date.year,
    month: date.month,
    day: date.day,
  }, dayOffset, calendar);
  return shifted ? {...date, ...shifted} : null;
}

function dateTextWithoutTraditionalTime(display, time) {
  if (!time) return display;
  return `${display.slice(0, time.index)} ${display.slice(time.index + time.text.length)}`;
}

function normalizeStoryTimeCandidateValue(value, calendar) {
  const normalized = normalizeStoryTime(value);
  const source = sourceStoryTime(value);
  if (!normalized.display) return normalized;
  const parsed = parseDisplayDate(normalized.display, calendar);
  const formattedDisplay = formatParsedDateDisplay(normalized.display, parsed, {calendar});
  if (hasStructuredDate(source)) {
    if (formattedDisplay === normalized.display) return normalized;
    return normalizeStoryTime({
      ...normalized,
      display: formattedDisplay,
    });
  }
  const timeMatch = timeFromDisplay(normalized.display);
  if (timeMatch?.invalid) return normalized;
  const time = timeMatch;
  const dateText = time ? normalized.display.slice(0, time.index) : normalized.display;
  if (time?.branch && matchTraditionalTime(dateText, {search: true, includeInvalid: true})) return normalized;
  const parsedDate = parseCnDate(dateText, {calendar});
  if (!parsedDate && (!time || dateText.trim())) return normalized;
  const precision = normalized.precision === STORY_TIME_PRECISION.UNKNOWN
    ? time ? timePrecision(time) : STORY_TIME_PRECISION.DAY
    : normalized.precision;
  if (!parsedDate) {
    return normalizeStoryTime({
      ...normalized,
      normalized: traditionalTimeDisplay(time),
      day_index: null,
      precision,
    });
  }
  const shifted = time ? shiftedParsedDate(parsedDate, calendar, time.dayOffset) : parsedDate;
  if (!shifted) {
    return normalizeStoryTime({
      ...normalized,
      display: formattedDisplay,
      normalized: null,
      day_index: null,
      precision,
    });
  }
  const canonical = parsedDateKey(shifted, calendar);
  const clock = time
    ? `${String(time.hour).padStart(2, '0')}:${String(time.minute).padStart(2, '0')}${time.second == null ? '' : `:${String(time.second).padStart(2, '0')}`}${time.timezone ?? ''}`
    : null;
  const normalizedValue = clock ? `${canonical}T${clock}` : canonical;
  const customDayIndex = customCalendarDayIndex(shifted, calendar);
  return normalizeStoryTime({
    ...normalized,
    display: formattedDisplay,
    normalized: normalizedValue,
    calendar_id: calendarIdentity(calendar) ?? normalized.calendar_id,
    day_index: customDayIndex ?? strictDayIndex(canonical),
    precision,
  });
}

export function normalizeStoryTime(raw = null, defaults = {}) {
  const source = sourceStoryTime(raw);
  const options = recordValue(defaults);
  const normalized = nullableText(
    source.normalized
      ?? source.iso_date
      ?? source.isoDate
      ?? source.date
      ?? source.iso,
  );
  const rawPrecision = source.precision ?? source.granularity;
  const precision = validPrecision(rawPrecision)
    ?? (normalized && /^\d{4}-\d{2}-\d{2}$/.test(normalized)
      ? STORY_TIME_PRECISION.DAY
      : STORY_TIME_PRECISION.UNKNOWN);
  const rawDayIndex = hasOwn(source, 'day_index') ? source.day_index : source.dayIndex;
  const dayIndexProvided = hasOwn(source, 'day_index') || hasOwn(source, 'dayIndex');
  const dayIndex = dayIndexProvided
    ? normalizeDayIndex(rawDayIndex)
    : precision === STORY_TIME_PRECISION.DAY && normalized
      ? strictDayIndex(normalized)
      : null;
  const calendarId = nullableText(
    source.calendar_id
      ?? source.calendarId,
  );
  const rawDisplay = nullableText(source.display);
  const display = options.formatDisplay === true && rawDisplay
    ? formatParsedDateDisplay(
      rawDisplay,
      parseDisplayDate(rawDisplay, options.calendar ?? null),
      {calendar: options.calendar ?? null},
    )
    : rawDisplay;
  return {
    display,
    normalized,
    day_index: dayIndex,
    calendar_id: calendarId,
    precision,
    confidence: confidenceValue(source.confidence),
  };
}

export function formatStoryTime(storyTime, emptyLabel = '未知时间') {
  const display = typeof storyTime === 'string'
    ? storyTime.trim()
    : nullableText(recordValue(storyTime).display);
  return display || emptyLabel;
}

/**
 * Resolve only the first non-empty Floor line as a Story Time header.
 * Narrative history is intentionally outside this boundary.
 */
export function resolveStoryTimeHeader(content, {normalize = null, calendar = null} = {}) {
  const header = String(content ?? '')
    .split(/\r?\n/u)
    .map(line => line.trim())
    .find(Boolean);
  if (!header) return null;

  const parsedDate = parseDisplayDate(header, calendar);
  if (!parsedDate) return null;
  const span = findParsedDateSpan(header, parsedDate, calendar);
  if (!span || span.start !== 0) return null;

  const trailing = header.slice(span.end).trim();
  const time = trailing ? timeFromDisplay(trailing) : null;
  if (trailing && (!time || !isCompleteTimeText(trailing, time))) return null;
  const precision = time ? timePrecision(time) : STORY_TIME_PRECISION.DAY;
  const raw = {display: header, precision};
  const resolved = typeof normalize === 'function'
    ? normalize(raw)
    : normalizeStoryTimeCandidateValue(raw, calendar);
  if (!resolved || (!resolved.display && resolved.normalized === null && resolved.day_index === null)) return null;
  return {
    ...resolved,
    display: header,
    precision: resolved.precision === STORY_TIME_PRECISION.UNKNOWN ? precision : resolved.precision,
  };
}

/**
 * Parse one trusted Story Time candidate. This is deliberately not a
 * narrative scanner: callers must establish the candidate's provenance first.
 */
export function parseStoryTimeCandidate(value, {calendar = null} = {}) {
  const text = textValue(value);
  if (!text) return null;
  const parsed = parseDisplayDate(text, calendar);
  if (!parsed) {
    const time = timeFromDisplay(text);
    if (!time || !isCompleteTimeText(text, time)) return null;
    return normalizeStoryTimeCandidateValue({display: text}, calendar);
  }
  const span = findParsedDateSpan(text, parsed, calendar);
  if (!span) return null;
  const trailing = text.slice(span.end).trim();
  const time = trailing ? timeFromDisplay(trailing) : null;
  if (trailing && (!time || !isCompleteTimeText(trailing, time))) return null;
  const result = normalizeStoryTimeCandidateValue({display: text}, calendar);
  return result?.display ? {...result, display: text} : null;
}

function differenceFromValues(left, right) {
  const normalizeForDifference = value => {
    const normalized = normalizeStoryTime(value);
    if (normalized.day_index !== null || !normalized.display) return normalized;
    return parseStoryTimeCandidate(normalized.display) ?? normalized;
  };
  const leftTime = normalizeForDifference(left);
  const rightTime = normalizeForDifference(right);
  if (leftTime.day_index === null || rightTime.day_index === null) return null;
  return leftTime.day_index - rightTime.day_index;
}

function storyTimeDomain(value) {
  const normalized = normalizeStoryTime(value);
  if (normalized.calendar_id) return `calendar:${normalized.calendar_id}`;
  return 'default';
}

function comparableStoryTimes(left, right) {
  const a = normalizeStoryTime(left);
  const b = normalizeStoryTime(right);
  return a.day_index !== null
    && b.day_index !== null
    && storyTimeDomain(a) === storyTimeDomain(b);
}

/**
 * Compare two normalized Story Time values. A null result means that the
 * values belong to different/unknown story-time domains or lack day_index.
 */
export function compareStoryTime(left, right) {
  if (!comparableStoryTimes(left, right)) return null;
  const leftIndex = normalizeStoryTime(left).day_index;
  const rightIndex = normalizeStoryTime(right).day_index;
  return leftIndex === rightIndex ? 0 : leftIndex < rightIndex ? -1 : 1;
}

export function differenceStoryDays(left, right) {
  const eraDifference = customCalendarDifference(left, right, {kind: 'era-standard'});
  if (eraDifference !== null) return eraDifference;
  if (!comparableStoryTimes(left, right)) return null;
  return normalizeStoryTime(left).day_index - normalizeStoryTime(right).day_index;
}

function normalizedClockMinutes(value) {
  const normalized = normalizeStoryTime(value).normalized;
  const match = typeof normalized === 'string'
    ? normalized.match(/T(\d{2}):(\d{2})(?::\d{2})?$/u)
    : null;
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour >= 0 && hour < 24 && minute >= 0 && minute < 60
    ? hour * 60 + minute
    : null;
}

/**
 * Return a deterministic, already-comparable Story Time difference. The
 * signed value is left minus right: positive means left is later. Clock-level
 * precision is used only when both values carry a reliable normalized clock
 * and refer to the same story day; otherwise the result stays day-based.
 */
export function differenceStoryTime(left, right) {
  const eraDifference = customCalendarDifference(left, right, {kind: 'era-standard'});
  if (eraDifference !== null) return {value: eraDifference, unit: 'day'};
  if (!comparableStoryTimes(left, right)) return null;
  const leftTime = normalizeStoryTime(left);
  const rightTime = normalizeStoryTime(right);
  const dayDifference = leftTime.day_index - rightTime.day_index;
  const preciseClock = ['hour', 'minute'].includes(leftTime.precision)
    && ['hour', 'minute'].includes(rightTime.precision)
    && dayDifference === 0;
  if (preciseClock) {
    const leftMinutes = normalizedClockMinutes(leftTime);
    const rightMinutes = normalizedClockMinutes(rightTime);
    if (leftMinutes !== null && rightMinutes !== null) {
      return {value: leftMinutes - rightMinutes, unit: 'minute'};
    }
  }
  if (dayDifference === 0) return {value: 0, unit: 'day'};
  return {value: dayDifference, unit: 'day'};
}

function provenanceCompare(left, right) {
  const floorLeft = Number(left?.source?.floor);
  const floorRight = Number(right?.source?.floor);
  const safeLeft = Number.isFinite(floorLeft) ? floorLeft : 0;
  const safeRight = Number.isFinite(floorRight) ? floorRight : 0;
  return safeLeft - safeRight
    || String(left?.source?.message_id ?? '').localeCompare(String(right?.source?.message_id ?? ''))
    || Number(left?.source?.swipe_id ?? 0) - Number(right?.source?.swipe_id ?? 0)
    || String(left?.event_id ?? '').localeCompare(String(right?.event_id ?? ''));
}

/**
 * Story-time chronology is intentionally separate from the Event domain's
 * provenance order. Incomparable times deterministically fall back to source
 * Floor/message/Swipe/Event identity order.
 */
export function sortEventsByStoryTime(events = []) {
  if (!Array.isArray(events)) return [];
  return [...events].sort((left, right) => {
    const leftTime = normalizeStoryTime(left?.story_time);
    const rightTime = normalizeStoryTime(right?.story_time);
    const leftDomain = storyTimeDomain(leftTime);
    const rightDomain = storyTimeDomain(rightTime);
    if (leftDomain !== rightDomain) return leftDomain.localeCompare(rightDomain);
    if (leftTime.day_index !== null && rightTime.day_index !== null) {
      const compared = leftTime.day_index - rightTime.day_index;
      if (compared !== 0) return compared;
    }
    return provenanceCompare(left, right);
  });
}

export const normalizeStoryTimeValue = normalizeStoryTime;
export const formatStoryTimeDisplay = formatStoryTime;

function resolverResult(calendarResolver, value) {
  try {
    return calendarResolver?.resolve?.({story_time: value}) ?? null;
  } catch {
    return null;
  }
}

function resolverPair(calendarResolver, left, right) {
  try {
    return calendarResolver?.resolvePair?.(left, right) ?? null;
  } catch {
    return null;
  }
}

/**
 * BioWeave's sole Story Time facade. Calendar resolution is injected only as
 * a Chat-local configuration seam; no external time source is consulted.
 */
export function createStoryTime({calendarResolver = null, currentTime = null, floorTimes = null} = {}) {
  const calendarFor = value => resolverResult(calendarResolver, value)?.descriptor ?? null;
  const normalize = value => {
    const resolution = resolverResult(calendarResolver, value);
    return normalizeStoryTimeCandidateValue(value, resolution?.descriptor ?? null);
  };
  const current = () => normalize(currentTime);
  const atFloor = floor => {
    if (floorTimes instanceof Map) return normalize(floorTimes.get(floor) ?? floorTimes.get(String(floor)) ?? null);
    if (floorTimes && typeof floorTimes === 'object') return normalize(floorTimes[floor] ?? floorTimes[String(floor)] ?? null);
    return normalize(null);
  };
  const diff = (left, right) => {
    const resolved = resolverPair(calendarResolver, left, right);
    if (resolved?.descriptor) {
      const leftValue = normalizeStoryTimeCandidateValue(left, resolved.descriptor);
      const rightValue = normalizeStoryTimeCandidateValue(right, resolved.descriptor);
      const custom = customCalendarDifference(leftValue, rightValue, resolved.descriptor);
      if (custom !== null) return {value: custom, unit: 'day'};
    }
    return differenceStoryTime(normalize(left), normalize(right));
  };
  return {
    current,
    atFloor,
    diff,
    calendar: () => calendarFor(currentTime),
    getCurrentTime: current,
    getTimeAtFloor: atFloor,
    getDateDifference: diff,
    getCalendar: () => calendarFor(currentTime),
    getCalendarFor: calendarFor,
    getCalendarDebug: value => resolverResult(calendarResolver, value),
    normalize,
    format: value => formatStoryTime(value),
  };
}

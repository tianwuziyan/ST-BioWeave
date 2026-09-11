export const STORY_TIME_PRECISION = Object.freeze({
  YEAR: 'year',
  MONTH: 'month',
  DAY: 'day',
  HOUR: 'hour',
  MINUTE: 'minute',
  UNKNOWN: 'unknown',
});

export const STORY_TIME_PRECISIONS = Object.freeze(Object.values(STORY_TIME_PRECISION));

export const STORY_TIME_PROVIDER = Object.freeze({
  SEVEN_DAYS_CAL: 'seven_days_cal',
  FALLBACK: 'bioweave_fallback',
});

export const STORY_TIME_PROVIDERS = STORY_TIME_PROVIDER;

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
  const provider = nullableText(source.provider) ?? nullableText(options.provider);
  const calendarId = nullableText(
    source.calendar_id
      ?? source.calendarId,
  );
  return {
    display: nullableText(source.display),
    normalized,
    day_index: dayIndex,
    calendar_id: calendarId,
    provider,
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

function invoke(source, names, args = []) {
  if (!source) return {called: false, value: undefined};
  for (const name of names) {
    if (typeof source[name] === 'function') {
      try {
        return {called: true, value: source[name](...args)};
      } catch {
        return {called: true, value: undefined};
      }
    }
  }
  return {called: false, value: undefined};
}

function staticValue(source, names) {
  if (!source) return undefined;
  for (const name of names) {
    if (hasOwn(source, name) && typeof source[name] !== 'function') return source[name];
  }
  return undefined;
}

function normalizeProviderValue(value, provider) {
  if (value === undefined || value === null) return null;
  return normalizeStoryTime(value, {provider});
}

function hasTimeValue(value) {
  return Boolean(value && (
    value.display !== null
    || value.normalized !== null
    || value.day_index !== null
  ));
}

function differenceFromValues(left, right) {
  const leftTime = normalizeStoryTime(left);
  const rightTime = normalizeStoryTime(right);
  if (leftTime.day_index === null || rightTime.day_index === null) return null;
  return leftTime.day_index - rightTime.day_index;
}

/**
 * Adapter for a SevenDaysCal-compatible public provider. It only invokes
 * methods supplied by the caller; it never imports or reads SevenDaysCal's
 * private store.
 */
export function createSevenDaysCalProvider(provider = null) {
  const source = provider;
  return {
    getCurrentTime() {
      const result = invoke(source, ['getCurrentTime', 'getCurrentStoryTime', 'current']);
      const value = result.called ? result.value : typeof source === 'function' ? source() : staticValue(source, ['current_time', 'currentTime']);
      return normalizeProviderValue(value, STORY_TIME_PROVIDER.SEVEN_DAYS_CAL);
    },
    getTimeAtFloor(floor) {
      const result = invoke(source, ['getTimeAtFloor', 'getStoryTimeAtFloor', 'atFloor', 'timeAtFloor'], [floor]);
      const value = result.called
        ? result.value
        : staticValue(source, ['floor_times', 'floorTimes', 'at_floor', 'atFloor'])?.[floor];
      return normalizeProviderValue(value, STORY_TIME_PROVIDER.SEVEN_DAYS_CAL);
    },
    getDateDifference(left, right) {
      const result = invoke(source, ['getDateDifference', 'difference', 'diff'], [left, right]);
      return result.called && result.value !== undefined && result.value !== null
        ? result.value
        : differenceFromValues(left, right);
    },
    getCalendar() {
      const result = invoke(source, ['getCalendar', 'calendar']);
      return result.called ? result.value ?? null : staticValue(source, ['calendar_data', 'calendar']) ?? null;
    },
  };
}

export const createSevenDaysCalStoryTimeProvider = createSevenDaysCalProvider;
export const createSevenDaysCalAdapter = createSevenDaysCalProvider;

function floorValue(source, floor) {
  const floorTimes = source?.floor_times ?? source?.floorTimes ?? source?.at_floor ?? source?.atFloor;
  if (floorTimes instanceof Map) return floorTimes.get(floor) ?? floorTimes.get(String(floor));
  if (Array.isArray(floorTimes)) {
    return floorTimes.find(item => String(item?.floor) === String(floor))?.story_time
      ?? floorTimes.find(item => String(item?.floor) === String(floor));
  }
  if (floorTimes && typeof floorTimes === 'object') return floorTimes[floor] ?? floorTimes[String(floor)];
  return undefined;
}

/**
 * A deliberately conservative local provider. It accepts structured values
 * supplied by the caller and never turns display text into a date.
 */
export function createFallbackStoryTimeProvider(input = {}) {
  const source = recordValue(input);
  const currentValue = () => {
    const result = invoke(source, ['getCurrentTime', 'getCurrentStoryTime', 'current']);
    if (result.called) return result.value;
    return source.current_time
      ?? source.currentTime
      ?? source.current
      ?? source.story_time
      ?? (hasOwn(source, 'display') || hasOwn(source, 'normalized') || hasOwn(source, 'day_index') ? source : null);
  };
  const floorValueFromSource = floor => {
    const result = invoke(source, ['getTimeAtFloor', 'getStoryTimeAtFloor', 'atFloor', 'timeAtFloor'], [floor]);
    return result.called ? result.value : floorValue(source, floor);
  };
  return {
    getCurrentTime() {
      return normalizeProviderValue(currentValue(), STORY_TIME_PROVIDER.FALLBACK);
    },
    getTimeAtFloor(floor) {
      return normalizeProviderValue(floorValueFromSource(floor), STORY_TIME_PROVIDER.FALLBACK);
    },
    getDateDifference(left, right) {
      const result = invoke(source, ['getDateDifference', 'difference', 'diff'], [left, right]);
      return result.called && result.value !== undefined && result.value !== null
        ? result.value
        : differenceFromValues(left, right);
    },
    getCalendar() {
      const result = invoke(source, ['getCalendar', 'calendar']);
      return result.called ? result.value ?? null : source.calendar ?? source.calendar_data ?? null;
    },
  };
}

export const createFallbackProvider = createFallbackStoryTimeProvider;
export const normalizeStoryTimeValue = normalizeStoryTime;
export const formatStoryTimeDisplay = formatStoryTime;

function configuredStoryTime(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false;
  return ['provider', 'primaryProvider', 'sevenDaysCalProvider', 'fallbackProvider', 'fallback'].some(key => hasOwn(input, key));
}

export function createStoryTime(input = null) {
  const config = configuredStoryTime(input) ? input : {provider: input};
  const primarySource = config.sevenDaysCalProvider ?? config.primaryProvider ?? config.provider;
  const fallbackSource = config.fallbackProvider ?? config.fallback;
  const primary = primarySource ? createSevenDaysCalProvider(primarySource) : null;
  const fallback = createFallbackStoryTimeProvider(fallbackSource ?? {});

  function read(method, args = []) {
    const primaryValue = primary?.[method]?.(...args) ?? null;
    if (method === 'getCalendar') {
      return primaryValue ?? fallback?.[method]?.(...args) ?? null;
    }
    if (hasTimeValue(primaryValue)) return primaryValue;
    const fallbackValue = fallback?.[method]?.(...args) ?? null;
    return hasTimeValue(fallbackValue) ? fallbackValue : null;
  }

  function diff(left, right) {
    const primaryValue = primary?.getDateDifference?.(left, right);
    if (primaryValue !== undefined && primaryValue !== null) return primaryValue;
    const fallbackValue = fallback?.getDateDifference?.(left, right);
    if (fallbackValue !== undefined && fallbackValue !== null) return fallbackValue;
    return differenceFromValues(left, right);
  }

  return {
    current: () => read('getCurrentTime'),
    atFloor: floor => read('getTimeAtFloor', [floor]),
    diff,
    calendar: () => read('getCalendar'),
    getCurrentTime: () => read('getCurrentTime'),
    getTimeAtFloor: floor => read('getTimeAtFloor', [floor]),
    getDateDifference: diff,
    getCalendar: () => read('getCalendar'),
    normalize: value => normalizeStoryTime(value),
    format: value => formatStoryTime(value),
  };
}

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createFallbackStoryTimeProvider,
  createSevenDaysCalProvider,
  createStoryTime,
  formatParsedDateDisplay,
  formatStoryTime,
  normalizeStoryTime,
  parseStoryTimeDate,
  parseStoryTimeTime,
} from '../story/time.js';

test('normalizeStoryTime keeps structured values and derives day_index only from canonical normalized dates', () => {
  const exact = normalizeStoryTime({
    display: '2026-08-20',
    normalized: '2026-08-20',
    precision: 'day',
    provider: 'test',
  });
  assert.equal(exact.day_index, 20685);
  assert.equal(exact.provider, 'test');

  const vague = normalizeStoryTime({display: '第三天', precision: 'unknown'});
  assert.equal(vague.display, '第三天');
  assert.equal(vague.normalized, null);
  assert.equal(vague.day_index, null);

  const explicitUnknown = normalizeStoryTime({
    display: '某年某月',
    normalized: '2026-08-20',
    precision: 'month',
    day_index: null,
  });
  assert.equal(explicitUnknown.day_index, null);
});

test('normalizeStoryTime only formats a parsed display when explicitly requested', () => {
  const raw = {
    display: '天河四十二年三月十八日午时至未时',
    normalized: '0042-03-18T12:45:00',
    day_index: 42,
    calendar_id: 'tianhe',
    provider: 'narrative',
    precision: 'hour',
    confidence: 0.73,
  };
  assert.equal(normalizeStoryTime(raw).display, raw.display);
  assert.equal(
    normalizeStoryTime(raw, {formatDisplay: true}).display,
    '天河42年3月18日 午时至未时',
  );
});

test('formatStoryTime returns display and never reparses normalized values', () => {
  assert.equal(formatStoryTime({display: '黄昏', normalized: '2026-08-20', day_index: 20685}), '黄昏');
  assert.equal(formatStoryTime({display: null, normalized: '2026-08-20', day_index: 20685}), '未知时间');
});

test('formatParsedDateDisplay replaces only the reliable date and preserves arbitrary trailing text', () => {
  const cases = [
    ['天河四十二年三月十八日午时至未时', '天河42年3月18日 午时至未时'],
    ['天河四十二年三月十八日未时', '天河42年3月18日 未时'],
    ['天河四十二年三月十八日未时三刻', '天河42年3月18日 未时三刻'],
    ['天河四十二年三月十八日未时3刻', '天河42年3月18日 未时3刻'],
    ['天河四十二年三月十八日任意后续文本', '天河42年3月18日 任意后续文本'],
  ];
  for (const [rawDisplay, expected] of cases) {
    const parsed = parseStoryTimeDate(rawDisplay);
    assert.ok(parsed, rawDisplay);
    assert.equal(formatParsedDateDisplay(rawDisplay, parsed), expected, rawDisplay);
  }
  const dateOnly = '天河四十二年三月十八日';
  assert.equal(
    formatParsedDateDisplay(dateOnly, parseStoryTimeDate(dateOnly)),
    '天河42年3月18日',
  );
  const alreadySeparated = '天河四十二年三月十八日 未时至未时';
  assert.equal(
    formatParsedDateDisplay(alreadySeparated, parseStoryTimeDate(alreadySeparated)),
    '天河42年3月18日 未时至未时',
  );
  const numericDate = '2024年02月29日午时至未时';
  assert.equal(
    formatParsedDateDisplay(numericDate, parseStoryTimeDate('2024年02月29日')),
    '2024年2月29日 午时至未时',
  );
});

test('SevenDaysCal provider is injectable and fallback accepts only structured values', () => {
  const sevenDaysCal = createSevenDaysCalProvider({
    getCurrentTime: () => ({display: 'day 4', normalized: null, day_index: null, precision: 'unknown'}),
    getTimeAtFloor: floor => floor === 2 ? {display: '2026-08-20', normalized: '2026-08-20', precision: 'day'} : null,
  });
  assert.equal(sevenDaysCal.getCurrentTime().provider, 'seven_days_cal');
  assert.equal(sevenDaysCal.getTimeAtFloor(2).day_index, 20685);

  const fallback = createFallbackStoryTimeProvider({
    current: {display: '模糊时间', precision: 'unknown'},
    floorTimes: {3: {display: '2026-08', normalized: '2026-08', precision: 'month'}},
  });
  assert.equal(fallback.getCurrentTime().provider, 'bioweave_fallback');
  assert.equal(fallback.getCurrentTime().day_index, null);
  assert.equal(fallback.getTimeAtFloor(3).day_index, null);
});

test('SevenDaysCal provider parses trusted raw Chinese dates at its input boundary', () => {
  const provider = createSevenDaysCalProvider({
    getCurrentTime: () => '2024年2月29日',
    getTimeAtFloor: floor => floor === 4 ? {display: '中秋节', precision: 'unknown'} : null,
  });
  assert.deepEqual(provider.getCurrentTime(), {
    display: '2024年2月29日',
    normalized: '2024-02-29',
    day_index: 19782,
    calendar_id: null,
    provider: 'seven_days_cal',
    precision: 'day',
    confidence: null,
  });
  assert.deepEqual(provider.getTimeAtFloor(4), {
    display: '中秋节',
    normalized: 'cn-0-8-15',
    day_index: null,
    calendar_id: null,
    provider: 'seven_days_cal',
    precision: 'day',
    confidence: null,
  });
});

test('StoryTime exposes traditional time parsing and normalizes pure times without changing display', () => {
  const pureTimes = [
    ['未时', '13:00', 'hour'],
    ['丑时', '01:00', 'hour'],
    ['子时', '23:00', 'hour'],
    ['丑时一刻', '01:15', 'minute'],
    ['丑时１刻', '01:15', 'minute'],
    ['丑时壹刻', '01:15', 'minute'],
    ['丑时三刻', '01:45', 'minute'],
    ['丑时3刻', '01:45', 'minute'],
    ['丑时叁刻', '01:45', 'minute'],
    ['丑时四刻', '02:00', 'minute'],
    ['丑时八刻', '03:00', 'minute'],
    ['丑時８刻', '03:00', 'minute'],
    ['丑时捌刻', '03:00', 'minute'],
  ];
  for (const [display, normalized, precision] of pureTimes) {
    const value = createSevenDaysCalProvider({getCurrentTime: () => display}).getCurrentTime();
    assert.equal(value.display, display);
    assert.equal(value.normalized, normalized);
    assert.equal(value.day_index, null);
    assert.equal(value.precision, precision);
  }
  assert.deepEqual(parseStoryTimeTime('子时八刻'), {
    branch: '子', marks: 8, hour: 1, minute: 0, dayOffset: 1,
  });
});

test('StoryTime combines trusted dates and traditional times, including Gregorian rollover', () => {
  const provider = createSevenDaysCalProvider({
    getCurrentTime: () => '２０２４年０２月２９日子時８刻',
  });
  assert.deepEqual(provider.getCurrentTime(), {
    display: '2024年2月29日 子時８刻',
    normalized: '2024-03-01T01:00',
    day_index: 19783,
    calendar_id: null,
    provider: 'seven_days_cal',
    precision: 'minute',
    confidence: null,
  });

  const sameDay = createSevenDaysCalProvider({
    getCurrentTime: () => '2024-02-29丑时4刻',
  }).getCurrentTime();
  assert.equal(sameDay.display, '2024年2月29日 丑时4刻');
  assert.equal(sameDay.normalized, '2024-02-29T02:00');
  assert.equal(sameDay.day_index, 19782);

  const openEra = createSevenDaysCalProvider({
    getCurrentTime: () => '赤曜历十二年霜月初七 丑時３刻',
  }).getCurrentTime();
  assert.deepEqual(openEra, {
    display: '赤曜历12年7月7日 丑時３刻',
    normalized: 'cn-12-7-7T01:45',
    day_index: null,
    calendar_id: null,
    provider: 'seven_days_cal',
    precision: 'minute',
    confidence: null,
  });
});

test('StoryTime combines generic open-era dates with traditional times', () => {
  const cases = [
    ['天河四十二年三月十八日未时', '天河42年3月18日 未时', 'cn-42-3-18T13:00'],
    ['任意纪年十二年霜月初七未时三刻', '任意纪年12年7月7日 未时三刻', 'cn-12-7-7T13:45'],
    ['任意纪年十二年霜月初七未时3刻', '任意纪年12年7月7日 未时3刻', 'cn-12-7-7T13:45'],
  ];
  for (const [input, display, normalized] of cases) {
    assert.deepEqual(createSevenDaysCalProvider({getCurrentTime: () => input}).getCurrentTime(), {
      display,
      normalized,
      day_index: null,
      calendar_id: null,
      provider: 'seven_days_cal',
      precision: normalized.endsWith('T13:00') ? 'hour' : 'minute',
      confidence: null,
    }, input);
  }
});

test('StoryTime keeps date plus invalid traditional marks conservative', () => {
  for (const display of ['2024年2月29日 丑时0刻', '2024年2月29日 丑时9刻']) {
    assert.deepEqual(createSevenDaysCalProvider({getCurrentTime: () => display}).getCurrentTime(), {
      display,
      normalized: null,
      day_index: null,
      calendar_id: null,
      provider: 'seven_days_cal',
      precision: 'unknown',
      confidence: null,
    }, display);
  }
});

test('StoryTime does not normalize partial traditional-time matches', () => {
  for (const display of [
    '2024年2月29日丑时4刻5',
    '2024年2月29日丑时abc刻',
    '2024年2月29日丑时4刻后文',
  ]) {
    assert.deepEqual(createSevenDaysCalProvider({getCurrentTime: () => display}).getCurrentTime(), {
      display,
      normalized: null,
      day_index: null,
      calendar_id: null,
      provider: 'seven_days_cal',
      precision: 'unknown',
      confidence: null,
    }, display);
  }
});

test('StoryTime uses injected custom calendar capabilities without inventing an absolute index', () => {
  const customCalendar = {
    kind: 'custom',
    id: 'custom-story',
    months: [
      {name: '霜季', days: 20},
      {name: '雨季', days: 25},
    ],
  };
  const provider = createSevenDaysCalProvider({
    getCurrentTime: () => '三年霜季二十日子时八刻',
    getCalendar: () => customCalendar,
  });
  assert.deepEqual(provider.getCurrentTime(), {
    display: '3年1月20日 子时八刻',
    normalized: 'cn-3-2-1T01:00',
    day_index: null,
    calendar_id: null,
    provider: 'seven_days_cal',
    precision: 'minute',
    confidence: null,
  });
});

test('structured SevenDaysCal fields remain authoritative over display parsing', () => {
  const provider = createSevenDaysCalProvider({
    getCurrentTime: () => ({
      display: '中秋节',
      normalized: '2026-08-20',
      day_index: 20685,
      precision: 'day',
    }),
  });
  assert.deepEqual(provider.getCurrentTime(), {
    display: '中秋节',
    normalized: '2026-08-20',
    day_index: 20685,
    calendar_id: null,
    provider: 'seven_days_cal',
    precision: 'day',
    confidence: null,
  });
});

test('structured SevenDaysCal values format a date display independently of normalized fields', () => {
  const provider = createSevenDaysCalProvider({
    getCurrentTime: () => ({
      display: '天河四十二年三月十八日未时3刻',
      normalized: '0042-03-18T13:45:00',
      day_index: 42,
      calendar_id: 'tianhe',
      precision: 'minute',
      confidence: 0.81,
    }),
  });
  assert.deepEqual(provider.getCurrentTime(), {
    display: '天河42年3月18日 未时3刻',
    normalized: '0042-03-18T13:45:00',
    day_index: 42,
    calendar_id: 'tianhe',
    provider: 'seven_days_cal',
    precision: 'minute',
    confidence: 0.81,
  });

  const dateOnly = createSevenDaysCalProvider({
    getCurrentTime: () => ({
      display: '天河四十二年三月十八日',
      normalized: 'cn-42-3-18',
      day_index: null,
      precision: 'day',
    }),
  }).getCurrentTime();
  assert.equal(dateOnly.display, '天河42年3月18日');
  assert.equal(dateOnly.normalized, 'cn-42-3-18');
  assert.equal(dateOnly.day_index, null);
});

test('narrative provider keeps structured fields while formatting its date display', () => {
  const source = {
    display: '天河四十二年三月十八日午时至未时',
    normalized: '0042-03-18T12:45:00',
    day_index: 42,
    calendar_id: 'tianhe',
    provider: 'narrative',
    precision: 'hour',
    confidence: 0.73,
  };
  const storyTime = createStoryTime({
    provider: {getCurrentTime: () => source},
  });

  assert.deepEqual(storyTime.current(), {
    display: '天河42年3月18日 午时至未时',
    normalized: source.normalized,
    day_index: source.day_index,
    calendar_id: source.calendar_id,
    provider: source.provider,
    precision: source.precision,
    confidence: source.confidence,
  });
});

test('SevenDaysCal provider keeps open era dates structured without inventing a Gregorian index', () => {
  const provider = createSevenDaysCalProvider({
    getCurrentTime: () => '某任意纪年十九年中秋节',
  });
  assert.deepEqual(provider.getCurrentTime(), {
    display: '某任意纪年十九年中秋节',
    normalized: 'cn-19-8-15',
    day_index: null,
    calendar_id: null,
    provider: 'seven_days_cal',
    precision: 'day',
    confidence: null,
  });
});

test('createStoryTime uses SevenDaysCal first and falls back without turning display text into a date', () => {
  const storyTime = createStoryTime({
    provider: {getCurrentTime: () => null},
    fallbackProvider: {current: {display: '只用于显示', precision: 'unknown'}},
  });
  assert.deepEqual(storyTime.current(), {
    display: '只用于显示',
    normalized: null,
    day_index: null,
    calendar_id: null,
    provider: 'bioweave_fallback',
    precision: 'unknown',
    confidence: null,
  });
});

test('fallback and formatter never parse traditional time display text', () => {
  const fallback = createFallbackStoryTimeProvider({current: {display: '子时八刻', precision: 'unknown'}});
  assert.deepEqual(fallback.getCurrentTime(), {
    display: '子时八刻',
    normalized: null,
    day_index: null,
    calendar_id: null,
    provider: 'bioweave_fallback',
    precision: 'unknown',
    confidence: null,
  });
  assert.equal(formatStoryTime({display: '丑時３刻', normalized: '01:45'}), '丑時３刻');

  const fallbackDate = createFallbackStoryTimeProvider({
    current: {display: '天河四十二年三月十八日午时至未时', precision: 'unknown'},
  }).getCurrentTime();
  assert.equal(fallbackDate.display, '天河四十二年三月十八日午时至未时');
  assert.equal(fallbackDate.normalized, null);
});

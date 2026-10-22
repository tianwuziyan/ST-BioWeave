import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createStoryTime, compareStoryTime, differenceStoryDays, differenceStoryTime,
  sortEventsByStoryTime, formatParsedDateDisplay, formatStoryTime,
  normalizeStoryTime, parseStoryTimeCandidate, parseStoryTimeDate,
  parseStoryTimeTime, resolveStoryTimeHeader,
} from '../story/time.js';
import {createCalendarResolver} from '../story/calendar.js';
import {createStoryTimeCoordinator, extractFloorStoryTimeCandidates} from '../story/coordinator.js';

function storyTimeWithCalendar() {
  return createStoryTime({calendarResolver: createCalendarResolver()});
}

test('differenceStoryTime returns comparable day and clock differences', () => {
  const current = {display: '当前', normalized: '2026-08-20T12:00', day_index: 20685, calendar_id: 'main', precision: 'hour'};
  const earlierClock = {display: '较早', normalized: '2026-08-20T10:00', day_index: 20685, calendar_id: 'main', precision: 'hour'};
  const earlierDay = {display: '前几日', normalized: '2026-08-17', day_index: 20682, calendar_id: 'main', precision: 'day'};
  assert.deepEqual(differenceStoryTime(current, earlierClock), {value: 120, unit: 'minute'});
  assert.deepEqual(differenceStoryTime(current, earlierDay), {value: 3, unit: 'day'});
  assert.equal(differenceStoryTime(current, {...earlierDay, calendar_id: 'other'}), null);
  assert.equal(differenceStoryTime(current, {display: '未知'}), null);
});

test('differenceStoryTime preserves clock precision across a day boundary', () => {
  const later = {normalized: '2026-08-21T01:00', day_index: 20686, calendar_id: 'main', precision: 'hour'};
  const earlier = {normalized: '2026-08-20T23:00', day_index: 20685, calendar_id: 'main', precision: 'hour'};
  assert.deepEqual(differenceStoryTime(later, earlier, {includeCrossDayClock: true}), {value: 120, unit: 'minute'});
});

test('Floor Story Time resolution uses only the first non-empty header line', () => {
  const header = resolveStoryTimeHeader(['羲和元年五月初四 午时', '她回忆羲和元年三月四日发生的事情'].join('\n'));
  assert.equal(header.display, '羲和元年五月初四 午时');
  assert.equal(header.normalized, 'cn-1-5-4T11:00');
  assert.equal(resolveStoryTimeHeader('她回忆羲和元年三月四日发生的事情'), null);
});

test('target-specific Story Time info resolves without scanning the current Floor', async () => {
  let contextReads = 0;
  const coordinator = createStoryTimeCoordinator({
    st: {getContext() { contextReads += 1; return {chat: []}; }},
    chat: {},
    store: {},
    storyTime: createStoryTime(),
  });
  const target = {
    index: 3,
    message: {role: 'assistant', content: '2026-09-20 14:30'},
    swipeId: 0,
    version: {
      chat_id: 'chat-story-time',
      message_id: 'floor-3',
      floor: 3,
      swipe_id: 0,
      content_hash: 'hash-3',
      message_version: 1,
    },
  };

  const info = await coordinator.resolveFloorStoryTimeInfo(target);
  assert.equal(info.floor.version.message_id, 'floor-3');
  assert.equal(info.story_time.normalized, '2026-09-20T14:30');
  assert.equal(info.status, 'ready');
  assert.equal(info.trace_summary.entry_count, 1);
  assert.equal(info.trace[0].candidate, undefined);
  assert.equal(info.trace[0].candidate_source, 'first_line_header');
  assert.equal(contextReads, 0);
  assert.deepEqual(await coordinator.resolveFloorStoryTime(target), info.story_time);
});

test('concurrent target-specific Story Time reads keep their debug traces isolated', async () => {
  const coordinator = createStoryTimeCoordinator({
    st: {},
    chat: {},
    store: {},
    storyTime: createStoryTime(),
  });
  const targetA = {
    index: 3,
    message: {role: 'assistant', content: '2026-09-20 14:30'},
    swipeId: 0,
    version: {
      chat_id: 'chat-story-time',
      message_id: 'floor-a',
      floor: 3,
      swipe_id: 0,
      content_hash: 'hash-a',
      message_version: 1,
    },
  };
  const targetB = {
    index: 4,
    message: {role: 'assistant', content: '2026-10-21 09:00'},
    swipeId: 0,
    version: {
      chat_id: 'chat-story-time',
      message_id: 'floor-b',
      floor: 4,
      swipe_id: 0,
      content_hash: 'hash-b',
      message_version: 1,
    },
  };

  const [infoA, infoB] = await Promise.all([
    coordinator.resolveFloorStoryTimeInfo(targetA),
    coordinator.resolveFloorStoryTimeInfo(targetB),
  ]);
  assert.equal(infoA.floor.version.message_id, 'floor-a');
  assert.equal(infoA.story_time.normalized, '2026-09-20T14:30');
  assert.equal(infoA.trace_summary.candidate_sources[0], 'first_line_header');
  assert.equal(infoB.floor.version.message_id, 'floor-b');
  assert.equal(infoB.story_time.normalized, '2026-10-21T09:00');
  assert.equal(infoB.trace_summary.candidate_sources[0], 'first_line_header');
});

test('canonical parser supports Gregorian forms and validates dates', () => {
  for (const value of ['2026-09-20', '2026/09/20', '2026.09.20', '2026-09-20 14:30', '2026-09-20T14:30:25', '2026年9月20日', '2026年九月二十日']) assert.ok(parseStoryTimeCandidate(value), value);
  assert.equal(parseStoryTimeCandidate('2024-02-29').day_index, 19782);
  assert.deepEqual(createStoryTime().normalize({display: '2026-09-20T14:30'}), {
    display: '2026年9月20日 T14:30',
    normalized: '2026-09-20T14:30',
    day_index: 20716,
    calendar_id: null,
    precision: 'minute',
    confidence: null,
  });
  assert.equal(parseStoryTimeCandidate('2026-02-29'), null);
  assert.equal(parseStoryTimeCandidate('2026-04-31'), null);
  assert.equal(parseStoryTimeCandidate('9月20日').day_index, null);
});

test('canonical parser rejects version, IP, numeric, and URL fragments', () => {
  for (const value of ['1.2.3', '192.168.1.1', '2026.09', '20260920', '2026-09-20-123', 'https://example.test/2026-09-20']) assert.equal(parseStoryTimeCandidate(value), null, value);
});

test('Gregorian display-only values receive local deterministic differences', () => {
  const storyTime = createStoryTime();
  assert.deepEqual(storyTime.getDateDifference({display: '2026-05-04'}, {display: '2026-03-04'}), {value: 61, unit: 'day'});
  assert.equal(compareStoryTime({display: '2026-03-04'}, {display: '2026-05-04'}), -1);
  assert.deepEqual(differenceStoryTime({display: '2026-05-04'}, {display: '2026-03-04'}), {value: 61, unit: 'day'});
});

test('display-only clock values share minute semantics with the facade', () => {
  const earlier = {display: '2026-09-20 10:00'};
  const later = {display: '2026-09-20 12:00'};
  assert.equal(compareStoryTime(earlier, later), -1);
  assert.deepEqual(differenceStoryTime(later, earlier), {value: 120, unit: 'minute'});
  assert.equal(differenceStoryDays(later, earlier), 0);
  assert.deepEqual(createStoryTime().getDateDifference(later, earlier), {value: 120, unit: 'minute'});
});

test('structured-only and day-index-only Gregorian values remain comparable', () => {
  assert.equal(compareStoryTime({normalized: '2024-02-29', precision: 'day'}, {day_index: 19782}), 0);
  assert.deepEqual(differenceStoryTime({normalized: '2024-03-01', precision: 'day'}, {day_index: 19782}), {value: 1, unit: 'day'});
  assert.equal(compareStoryTime({normalized: '2024-02-29', day_index: null}, {day_index: 19782}), null);
});

test('Floor candidate extraction is bounded and excludes narrative history', () => {
  const candidates = extractFloorStoryTimeCandidates([
    '[affinity_status]', '『2026-09-20 · 周日 · 14:30｜地点』', '[/affinity_status]',
    '[SYNOPSIS_BLOCK]', 'TIME: 2026-09-21 09:00', '[/SYNOPSIS_BLOCK]',
    '<content>', '她回忆起 2025-01-03 的事情。', '</content>',
  ].join('\n'));
  assert.deepEqual(candidates.slice(0, 2), [
    {source: 'synopsis_time', value: '2026-09-21 09:00'},
    {source: 'affinity_status', value: '2026-09-20 14:30'},
  ]);
  assert.equal(candidates.some(candidate => candidate.value === '2025-01-03'), false);
});

test('Story Time compares compatible domains without a provider dimension', () => {
  const day1 = {normalized: '2026-08-20', day_index: 20685, calendar_id: 'main', precision: 'day'};
  const day2 = {normalized: '2026-08-22', day_index: 20687, calendar_id: 'main', precision: 'day'};
  const otherCalendar = {normalized: '2026-08-22', day_index: 20687, calendar_id: 'other', precision: 'day'};
  assert.equal(compareStoryTime(day1, day2), -1);
  assert.equal(differenceStoryDays(day2, day1), 2);
  assert.equal(compareStoryTime(day1, otherCalendar), null);
});

test('Gregorian structured and display-only values can prove a shared calculation domain', () => {
  const event = {
    display: '2026-01-01',
    normalized: '2026-01-01',
    day_index: 20454,
    calendar_id: 'main',
    precision: 'day',
  };
  const current = {
    display: '2026-04-01',
    normalized: null,
    day_index: null,
    calendar_id: null,
    precision: 'day',
  };
  assert.equal(compareStoryTime(current, event), 1);
  assert.deepEqual(differenceStoryTime(current, event), {value: 90, unit: 'day'});
  assert.equal(differenceStoryDays(current, event), 90);
});

test('Story Time ordering remains separate from provenance ordering', () => {
  const events = [
    {event_id: 'later-floor', source: {floor: 2}, story_time: {day_index: 10, calendar_id: 'main'}},
    {event_id: 'earlier-story', source: {floor: 1}, story_time: {day_index: 20, calendar_id: 'main'}},
    {event_id: 'unknown-time', source: {floor: 3}, story_time: {day_index: null, calendar_id: 'main'}},
  ];
  assert.deepEqual(sortEventsByStoryTime(events).map(event => event.event_id), ['later-floor', 'earlier-story', 'unknown-time']);
});

test('Story Time event ordering parses display-only dates and supports both directions', () => {
  const events = [
    {event_id: 'b', story_time: {display: '2026-03-15'}},
    {event_id: 'a', story_time: {display: '2026年1月1日'}},
    {event_id: 'c', story_time: {display: '2026年2月10日'}},
  ];
  assert.deepEqual(sortEventsByStoryTime(events).map(event => event.event_id), ['a', 'c', 'b']);
  assert.deepEqual(sortEventsByStoryTime(events, {descending: true}).map(event => event.event_id), ['b', 'c', 'a']);
  assert.deepEqual(events.map(event => event.event_id), ['b', 'a', 'c']);
});

test('Story Time event ordering keeps incomparable pairs stable without guessing', () => {
  const events = [
    {event_id: 'unknown', story_time: {display: '未知'}},
    {event_id: 'later', story_time: {display: '2026-03-15'}},
    {event_id: 'earlier', story_time: {display: '2026-01-01'}},
    {event_id: 'custom', story_time: {display: '三月四日', calendar_id: 'custom-story'}},
  ];
  assert.deepEqual(sortEventsByStoryTime(events).map(event => event.event_id), ['unknown', 'earlier', 'later', 'custom']);
  assert.deepEqual(sortEventsByStoryTime(events, {descending: true}).map(event => event.event_id), ['unknown', 'later', 'earlier', 'custom']);
});

test('normalizeStoryTime keeps structured values and does not expose provider', () => {
  const exact = normalizeStoryTime({display: '2026-08-20', normalized: '2026-08-20', precision: 'day'});
  assert.equal(exact.day_index, 20685);
  assert.equal('provider' in exact, false);
  assert.deepEqual(normalizeStoryTime({display: '第三天', precision: 'unknown'}), {display: '第三天', normalized: null, day_index: null, calendar_id: null, precision: 'unknown', confidence: null});
});

test('formatting a parsed date preserves unrelated trailing text', () => {
  const raw = '天河四十二年三月十八日午时至未时';
  assert.equal(formatParsedDateDisplay(raw, parseStoryTimeDate(raw)), '天河42年3月18日 午时至未时');
  assert.equal(formatStoryTime({display: '黄昏', normalized: '2026-08-20'}), '黄昏');
});

test('local parser supports traditional times, aliases, and open-era dates', () => {
  for (const [text, year, month, day] of [['羲和元年正月初一', 1, 1, 1], ['羲和一年十一月初十', 1, 11, 10], ['羲和十年十一月廿一', 10, 11, 21], ['羲和十年十二月三十', 10, 12, 30]]) assert.deepEqual(parseStoryTimeDate(text), {year, month, day, eraLabel: '羲和'});
  assert.deepEqual(parseStoryTimeTime('巳时初'), {branch: '巳', marks: 0, segment: '初', hour: 9, minute: 0, dayOffset: 0});
  assert.deepEqual(parseStoryTimeTime('巳时中'), {branch: '巳', marks: 4, segment: '中', hour: 10, minute: 0, dayOffset: 0});
  assert.deepEqual(parseStoryTimeTime('巳时末'), {branch: '巳', marks: 8, segment: '末', hour: 11, minute: 0, dayOffset: 0});
  assert.deepEqual(parseStoryTimeTime('未时'), {branch: '未', marks: 0, hour: 13, minute: 0, dayOffset: 0});
});

test('BioWeave Calendar Resolver and local Calendar Engine calculate same-era differences', () => {
  const storyTime = storyTimeWithCalendar();
  const current = storyTime.normalize({display: '羲和元年五月初四 午时'});
  const event = storyTime.normalize({display: '羲和1年3月4日 巳时中'});
  assert.equal(current.normalized, 'cn-1-5-4T11:00');
  assert.equal(event.normalized, 'cn-1-3-4T10:00');
  assert.equal(current.day_index, null);
  assert.equal(event.day_index, null);
  assert.deepEqual(storyTime.getDateDifference(current, event), {value: 61, unit: 'day'});
});

test('same era-standard dates share comparison and difference semantics', () => {
  const dates = ['羲和元年三月四日', '羲和元年三月十五日', '羲和元年三月二十日']
    .map(display => storyTimeWithCalendar().normalize({display}));
  assert.equal(compareStoryTime(dates[0], dates[1]), -1);
  assert.equal(compareStoryTime(dates[1], dates[2]), -1);
  assert.equal(compareStoryTime(dates[0], dates[2]), -1);
  assert.deepEqual(differenceStoryTime(dates[2], dates[0]), {value: 16, unit: 'day'});
  assert.equal(compareStoryTime(dates[0], dates[2]) < 0, differenceStoryTime(dates[0], dates[2]).value < 0);
});

test('era-standard comparison preserves month, year, and leap-day arithmetic', () => {
  const normalize = value => storyTimeWithCalendar().normalize({display: value});
  const monthStart = normalize('羲和元年三月一日');
  const monthEnd = normalize('羲和元年二月二十八日');
  assert.equal(compareStoryTime(monthEnd, monthStart), -1);
  assert.deepEqual(differenceStoryTime(monthStart, monthEnd), {value: 1, unit: 'day'});
  const leapDay = normalize('羲和四年二月二十九日');
  const nextDay = normalize('羲和四年三月一日');
  assert.equal(compareStoryTime(leapDay, nextDay), -1);
  assert.deepEqual(differenceStoryTime(nextDay, leapDay), {value: 1, unit: 'day'});
  const nextYear = normalize('羲和五年正月一日');
  assert.equal(compareStoryTime(nextDay, nextYear), -1);
  assert.ok(differenceStoryTime(nextYear, nextDay).value > 0);
});

test('same-day clock precision is reflected by comparison without changing Story Days', () => {
  const earlier = storyTimeWithCalendar().normalize({display: '羲和元年三月四日 巳时初'});
  const later = storyTimeWithCalendar().normalize({display: '羲和元年三月四日 午时初'});
  assert.equal(compareStoryTime(earlier, later), -1);
  assert.deepEqual(differenceStoryTime(later, earlier), {value: 120, unit: 'minute'});
  assert.equal(differenceStoryDays(later, earlier), 0);
});

test('different eras and unknown dates remain incomparable', () => {
  const xihe = storyTimeWithCalendar().normalize({display: '羲和元年三月四日'});
  const tianhe = storyTimeWithCalendar().normalize({display: '天河元年三月四日'});
  assert.equal(compareStoryTime(xihe, tianhe), null);
  assert.equal(differenceStoryTime(xihe, tianhe), null);
  assert.equal(compareStoryTime({...xihe, calendar_id: 'other'}, {...xihe, calendar_id: 'different'}), null);
  assert.equal(compareStoryTime({display: '未知'}, {display: '未知'}), null);
});

test('an explicit custom calendar does not compare with an unscoped date', () => {
  const customDate = {display: '2026-03-04', calendar_id: 'custom-story'};
  const unscopedDate = {display: '2026-03-05'};
  assert.equal(compareStoryTime(customDate, unscopedDate), null);
  assert.equal(differenceStoryTime(customDate, unscopedDate), null);
});

test('proven conflicts remain unresolved instead of selecting a date silently', () => {
  const conflicting = {display: '2026-03-04', normalized: '2026-03-05', day_index: 20522, precision: 'day'};
  assert.equal(compareStoryTime(conflicting, {display: '2026-03-05'}), null);
  assert.equal(differenceStoryTime(conflicting, {display: '2026-03-04'}), null);
});

test('injected custom calendars keep local month arithmetic without inventing Gregorian dates', () => {
  const calendar = {
    kind: 'custom',
    id: 'custom-story',
    months: [{name: '霜季', days: 20}, {name: '雨季', days: 25}],
  };
  const resolver = {
    resolve: () => ({descriptor: calendar}),
    resolvePair: () => ({descriptor: calendar}),
  };
  const storyTime = createStoryTime({calendarResolver: resolver});
  const earlier = {display: '星海纪元三年霜季十九日'};
  const later = {display: '星海纪元三年雨季一日'};
  assert.deepEqual(storyTime.getDateDifference(later, earlier), {value: 2, unit: 'day'});
  assert.equal(storyTime.normalize(earlier).day_index, null);
});

test('Custom dates retain display-only day_index while using local elapsed arithmetic', () => {
  const storyTime = createStoryTime();
  const current = storyTime.normalize({display: '羲和元年五月初四 午时'});
  assert.equal(current.normalized, 'cn-1-5-4T11:00');
  assert.equal(current.day_index, null);
  assert.deepEqual(storyTime.getDateDifference(current, {display: '羲和1年3月4日 巳时中'}), {value: 61, unit: 'day'});
});

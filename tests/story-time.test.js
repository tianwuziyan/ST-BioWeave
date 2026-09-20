import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createStoryTime, compareStoryTime, differenceStoryDays, differenceStoryTime,
  sortEventsByStoryTime, formatParsedDateDisplay, formatStoryTime,
  normalizeStoryTime, parseStoryTimeCandidate, parseStoryTimeDate,
  parseStoryTimeTime, resolveStoryTimeHeader,
} from '../story/time.js';
import {createCalendarResolver} from '../story/calendar.js';
import {extractFloorStoryTimeCandidates} from '../story/coordinator.js';

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

test('Floor Story Time resolution uses only the first non-empty header line', () => {
  const header = resolveStoryTimeHeader(['羲和元年五月初四 午时', '她回忆羲和元年三月四日发生的事情'].join('\n'));
  assert.equal(header.display, '羲和元年五月初四 午时');
  assert.equal(header.normalized, 'cn-1-5-4T11:00');
  assert.equal(resolveStoryTimeHeader('她回忆羲和元年三月四日发生的事情'), null);
});

test('canonical parser supports Gregorian forms and validates dates', () => {
  for (const value of ['2026-09-20', '2026/09/20', '2026.09.20', '2026-09-20 14:30', '2026-09-20T14:30:25', '2026年9月20日', '2026年九月二十日']) assert.ok(parseStoryTimeCandidate(value), value);
  assert.equal(parseStoryTimeCandidate('2024-02-29').day_index, 19782);
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

test('Story Time ordering remains separate from provenance ordering', () => {
  const events = [
    {event_id: 'later-floor', source: {floor: 2}, story_time: {day_index: 10, calendar_id: 'main'}},
    {event_id: 'earlier-story', source: {floor: 1}, story_time: {day_index: 20, calendar_id: 'main'}},
    {event_id: 'unknown-time', source: {floor: 3}, story_time: {day_index: null, calendar_id: 'main'}},
  ];
  assert.deepEqual(sortEventsByStoryTime(events).map(event => event.event_id), ['later-floor', 'earlier-story', 'unknown-time']);
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

test('Custom dates retain display-only day_index while using local elapsed arithmetic', () => {
  const storyTime = createStoryTime();
  const current = storyTime.normalize({display: '羲和元年五月初四 午时'});
  assert.equal(current.normalized, 'cn-1-5-4T11:00');
  assert.equal(current.day_index, null);
  assert.deepEqual(storyTime.getDateDifference(current, {display: '羲和1年3月4日 巳时中'}), {value: 61, unit: 'day'});
});

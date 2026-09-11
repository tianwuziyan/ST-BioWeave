import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createFallbackStoryTimeProvider,
  createSevenDaysCalProvider,
  createStoryTime,
  formatStoryTime,
  normalizeStoryTime,
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

test('formatStoryTime returns display and never reparses normalized values', () => {
  assert.equal(formatStoryTime({display: '黄昏', normalized: '2026-08-20', day_index: 20685}), '黄昏');
  assert.equal(formatStoryTime({display: null, normalized: '2026-08-20', day_index: 20685}), '未知时间');
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

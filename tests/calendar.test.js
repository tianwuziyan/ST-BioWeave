import test from 'node:test';
import assert from 'node:assert/strict';
import {createCalendarResolver, ordinalInYear} from '../story/calendar.js';
import {createStoryTime} from '../story/time.js';

test('era dates use BioWeave standard month arithmetic without configuration', () => {
  const storyTime = createStoryTime({calendarResolver: createCalendarResolver()});
  const current = storyTime.normalize({display: '羲和元年五月初四 午时'});
  const event = storyTime.normalize({display: '羲和1年3月4日 巳时中'});
  assert.equal(current.calendar_id, null);
  assert.equal(current.day_index, null);
  assert.equal(event.day_index, null);
  assert.deepEqual(storyTime.getDateDifference(current, event), {value: 61, unit: 'day'});
  assert.equal(ordinalInYear(current), 124);
});

test('same era is required for elapsed-time arithmetic', () => {
  const storyTime = createStoryTime({calendarResolver: createCalendarResolver()});
  assert.deepEqual(
    storyTime.getDateDifference(
      {display: '羲和元年五月初四'},
      {display: '羲和元年三月四日'},
    ),
    {value: 61, unit: 'day'},
  );
  assert.equal(
    storyTime.getDateDifference(
      {display: '羲和元年五月初四'},
      {display: '太初元年三月四日'},
    ),
    null,
  );
});

test('same era cross-year arithmetic reuses leap-year rules', () => {
  const storyTime = createStoryTime({calendarResolver: createCalendarResolver()});
  assert.deepEqual(
    storyTime.getDateDifference(
      {display: '羲和二年一月二十日'},
      {display: '羲和元年十二月二十日'},
    ),
    {value: 31, unit: 'day'},
  );
  assert.deepEqual(
    storyTime.getDateDifference(
      {display: '羲和二年三月一日'},
      {display: '羲和元年二月二十八日'},
    ),
    {value: 366, unit: 'day'},
  );
});

test('Gregorian dates keep built-in arithmetic and do not need an era resolver', () => {
  const storyTime = createStoryTime();
  assert.deepEqual(storyTime.getDateDifference({display: '2024-03-01'}, {display: '2024-02-28'}), {value: 2, unit: 'day'});
  assert.deepEqual(storyTime.getDateDifference({display: '2026-05-04'}, {display: '2026-03-04'}), {value: 61, unit: 'day'});
});

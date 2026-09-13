import test from 'node:test'
import assert from 'node:assert/strict'
import {
  addCalendarDays,
  calendarDate,
  dateFromOrdinal,
  daysInMonth,
  formatCalendarDate,
  isGregorian,
  ordinalOf,
  parseCalendarDate,
  validateCalendarDate,
  validateCalendarDescriptor,
  weekdayFor,
} from '../business/calendar/date.js'

const customCalendar = {
  kind: 'custom',
  id: 'custom-30',
  weekdayCycle: 7,
  months: [
    { name: '霜季', days: 30 },
    { name: '雨季', days: 30 },
    { name: '风季', days: 30 },
  ],
}

test('calendar date helpers preserve Gregorian and custom descriptor boundaries', () => {
  assert.equal(isGregorian(null), true)
  assert.equal(isGregorian({ kind: 'gregorian' }), true)
  assert.equal(isGregorian(customCalendar), false)
  assert.equal(validateCalendarDescriptor(customCalendar), true)
  assert.equal(validateCalendarDescriptor({ kind: 'custom', months: [] }), false)
  assert.equal(validateCalendarDescriptor({ kind: 'custom', months: [{ days: 0 }] }), false)
  assert.deepEqual(calendarDate('2024', '2', '29'), { year: 2024, month: 2, day: 29 })
})

test('Gregorian date validation and ordinal conversion include leap years', () => {
  assert.equal(daysInMonth(null, 2, 2024), 29)
  assert.equal(daysInMonth(null, 2, 2023), 28)
  assert.equal(validateCalendarDate(calendarDate(2024, 2, 29), null), true)
  assert.equal(validateCalendarDate(calendarDate(2023, 2, 29), null), false)
  assert.equal(validateCalendarDate(calendarDate(2024, 13, 1), null), false)
  assert.equal(ordinalOf(calendarDate(2024, 2, 29), null), 60)
  assert.deepEqual(dateFromOrdinal(60, null, 2024), calendarDate(2024, 2, 29))
  assert.equal(dateFromOrdinal(366, null, 2023), null)
})

test('custom calendar date validation and calculations do not use Gregorian Date', () => {
  assert.equal(daysInMonth(customCalendar, 1), 30)
  assert.equal(validateCalendarDate(calendarDate(3, 2, 30), customCalendar), true)
  assert.equal(validateCalendarDate(calendarDate(3, 2, 31), customCalendar), false)
  assert.equal(ordinalOf(calendarDate(3, 2, 1), customCalendar), 31)
  assert.deepEqual(dateFromOrdinal(31, customCalendar, 3), calendarDate(3, 2, 1))
  assert.deepEqual(addCalendarDays(calendarDate(3, 1, 30), 1, customCalendar), calendarDate(3, 2, 1))
  assert.equal(addCalendarDays(calendarDate(3, 1, 1), -1, customCalendar), null)
  assert.equal(addCalendarDays(calendarDate(null, 3, 30), 1, customCalendar), null)
  assert.equal(weekdayFor(calendarDate(3, 1, 1), customCalendar), null)
  assert.equal(weekdayFor(calendarDate(null, 1, 1), customCalendar, { ordinal: 1, weekday: 1 }), 1)
})

test('calendar string parsing and formatting preserve null-year custom dates', () => {
  assert.deepEqual(parseCalendarDate('2024-02-29'), calendarDate(2024, 2, 29))
  assert.equal(parseCalendarDate('2023-02-29'), null)
  assert.deepEqual(parseCalendarDate('null-02-30', customCalendar), calendarDate(null, 2, 30))
  assert.equal(parseCalendarDate('null-02-31', customCalendar), null)
  assert.equal(formatCalendarDate(calendarDate(2024, 2, 9)), '2024-02-09')
  assert.equal(formatCalendarDate(calendarDate(null, 2, 9)), 'null-02-09')
  assert.equal(formatCalendarDate({ year: 1, month: 0, day: 1 }), '0001-00-01')
})

test('Gregorian addCalendarDays crosses month and year boundaries', () => {
  assert.deepEqual(addCalendarDays(calendarDate(2024, 2, 28), 1, null), calendarDate(2024, 2, 29))
  assert.deepEqual(addCalendarDays(calendarDate(2024, 12, 31), 1, null), calendarDate(2025, 1, 1))
  assert.deepEqual(addCalendarDays(calendarDate(2025, 1, 1), -1, null), calendarDate(2024, 12, 31))
  assert.equal(addCalendarDays(calendarDate(2025, 1, 1), 0.5, null), null)
})

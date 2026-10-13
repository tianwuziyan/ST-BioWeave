import test from 'node:test';
import assert from 'node:assert/strict';
import {compareStoryTime} from '../story/time.js';
import {deriveTrackingWindows} from '../core/tracking-window.js';
import {normalizeEvent, PREGNANCY_RELEVANT_EXPOSURE_EVIDENCE_KIND} from '../core/events.js';

function exposure(eventId, storyTime) {
  return normalizeEvent({
    event_id: eventId,
    type: 'sexual_activity',
    status: 'confirmed',
    story_time: storyTime,
    source: {chat_id: 'story-time-baseline', message_id: eventId, floor: 1, swipe_id: 0, content_hash: eventId, message_version: 'v1'},
    participants: [
      {character_id: 'char_subject', event_role: 'potential_gestational_subject', reproductive_capabilities_used: {can_carry_pregnancy: true}},
      {character_id: `char_source_${eventId}`, event_role: 'potential_conception_source', reproductive_capabilities_used: {can_cause_pregnancy: true}},
    ],
    pregnancy_relevance: {
      relevant: true,
      possible_conception: true,
      gestational_subject_ids: ['char_subject'],
      counterpart_ids: [`char_source_${eventId}`],
      reproductive_mechanism: {kind: 'fertilization'},
    },
    source_evidence: [{kind: PREGNANCY_RELEVANT_EXPOSURE_EVIDENCE_KIND, text: 'baseline exposure'}],
  });
}

function observe(eventStoryTime, currentStoryTime = null) {
  let diagnostics = null;
  const windows = deriveTrackingWindows([exposure('baseline', eventStoryTime)], {
    chatId: 'story-time-baseline',
    currentStoryTime,
    onDiagnostics: value => { diagnostics = value; },
  });
  return {diagnostics, windows};
}

test('canonical Gregorian Story Time uses the fast path without changing authoritative ordering', () => {
  const eventTime = {normalized: '2026-01-01', day_index: 20454, precision: 'day'};
  const currentTime = {normalized: '2026-01-02', day_index: 20455, precision: 'day'};
  assert.equal(compareStoryTime(eventTime, currentTime), -1);
  const result = observe(eventTime, currentTime);
  assert.equal(result.windows.length, 1);
  assert.ok(result.diagnostics.fast_story_time_compare_count > 0);
});

test('custom normalized Story Time uses the fast path within one calendar domain', () => {
  const eventTime = {display: '羲和元年三月四日', normalized: 'cn-1-3-4', calendar_id: 'xihe', precision: 'day'};
  const currentTime = {display: '羲和元年三月五日', normalized: 'cn-1-3-5', calendar_id: 'xihe', precision: 'day'};
  assert.equal(compareStoryTime(eventTime, currentTime), -1);
  const result = observe(eventTime, currentTime);
  assert.equal(result.windows.length, 1);
  assert.ok(result.diagnostics.fast_story_time_compare_count > 0);
});

test('incompatible calendar IDs remain incomparable and do not become a new ordering rule', () => {
  const eventTime = {display: '羲和元年三月四日', normalized: 'cn-1-3-4', calendar_id: 'xihe', precision: 'day'};
  const currentTime = {display: '天河元年三月五日', normalized: 'cn-1-3-5', calendar_id: 'tianhe', precision: 'day'};
  assert.equal(compareStoryTime(eventTime, currentTime), null);
  const result = observe(eventTime, currentTime);
  assert.equal(result.windows.length, 1);
  assert.ok(result.diagnostics.fast_story_time_compare_count > 0);
});

test('a missing custom calendar ID records the existing fast-path compatibility difference', () => {
  const eventTime = {display: '羲和元年三月四日', normalized: 'cn-1-3-4', precision: 'day'};
  const currentTime = {display: '羲和元年三月五日', normalized: 'cn-1-3-5', calendar_id: 'xihe', precision: 'day'};
  assert.equal(compareStoryTime(eventTime, currentTime), null);
  const result = observe(eventTime, currentTime);
  assert.equal(result.windows.length, 1);
  assert.ok(result.diagnostics.fast_story_time_compare_count > 0);
});

test('field conflicts retain the current fast-path difference from authoritative comparison', () => {
  const eventTime = {display: '2026-01-02', normalized: '2026-01-01', day_index: 20455, precision: 'day'};
  const currentTime = {display: '2026-01-02', normalized: '2026-01-02', day_index: 20455, precision: 'day'};
  assert.equal(compareStoryTime(eventTime, currentTime), null);
  const result = observe(eventTime, currentTime);
  assert.equal(result.windows.length, 0);
  assert.ok(result.diagnostics.fast_story_time_compare_count > 0);
});

test('different precision and unknown Story Time remain observable without changing comparison semantics', () => {
  const precise = observe(
    {normalized: '2026-01-01T10:00', day_index: 20454, precision: 'hour'},
    {normalized: '2026-01-01T12:00', day_index: 20454, precision: 'hour'},
  );
  assert.equal(precise.windows.length, 1);
  assert.ok(precise.diagnostics.fast_story_time_compare_count > 0);

  const unknown = observe({display: '未知', normalized: null, day_index: null, precision: 'unknown'}, {display: '仍未知', normalized: null, day_index: null, precision: 'unknown'});
  assert.equal(compareStoryTime({display: '未知'}, {display: '仍未知'}), null);
  assert.equal(unknown.windows.length, 0);
  assert.equal(unknown.diagnostics.fast_story_time_compare_count, 0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEvent, PREGNANCY_RELEVANT_EXPOSURE_EVIDENCE_KIND } from '../core/events.js';
import {
  activeTrackingWindows,
  areCompatibleTrackingWindowExposures,
  buildTrackingWindowCycleId,
  deriveTrackingWindows,
  mergeTrackingSubjectsWithActivePregnancies,
  windowCycleMatchesTiming,
} from '../core/tracking-window.js';
import { rebuildTrackingRegistry } from '../core/tracking.js';
import { resolveProjectionTimingInstance } from '../core/projection-timing.js';
import { buildProjectionRuleId, evaluateProjectionEligibility } from '../core/projection-eligibility.js';
import { createTrackingRuntime } from '../runtime/tracking-runtime.js';

function exposure({eventId, subjectId = 'char-subject', mechanism = 'fertilization', day = 1, carry = true} = {}) {
  return {
    event_id: eventId,
    type: 'sexual_activity',
    status: 'confirmed',
    story_time: {day_index: day},
    source: {chat_id: 'chat-window', message_id: `message-${eventId}`, floor: day, swipe_id: 0, content_hash: `hash-${eventId}`, message_version: `v-${eventId}`},
    participants: [
      {character_id: subjectId, display_name: 'Subject', event_role: 'potential_gestational_subject', reproductive_capabilities_used: {can_carry_pregnancy: carry}},
      {character_id: `counterpart-${eventId}`, display_name: 'Counterpart', event_role: 'potential_conception_source', reproductive_capabilities_used: {can_cause_pregnancy: true}},
    ],
    pregnancy_relevance: {relevant: true, possible_conception: true, gestational_subject_ids: [subjectId], counterpart_ids: [`counterpart-${eventId}`], reproductive_mechanism: {kind: mechanism}},
    source_evidence: [{kind: PREGNANCY_RELEVANT_EXPOSURE_EVIDENCE_KIND, text: 'factual exposure'}],
  };
}

function terminal({eventId, type = 'pregnancy_confirmation', subjectId = 'char-subject', day = 3, pregnancyId = 'pregnancy-1'} = {}) {
  const payload = {pregnancy_id: pregnancyId};
  if (type === 'delivery') payload.delivery_id = eventId;
  return {
    event_id: eventId,
    type,
    status: 'confirmed',
    story_time: {day_index: day},
    source: {chat_id: 'chat-window', message_id: `message-${eventId}`, floor: day, swipe_id: 0, content_hash: `hash-${eventId}`, message_version: `v-${eventId}`},
    participants: [{character_id: subjectId, event_role: 'potential_gestational_subject'}],
    pregnancy_relevance: {relevant: false, possible_conception: false, gestational_subject_ids: [], counterpart_ids: []},
    state_fact: {subject_id: subjectId, payload},
  };
}

test('first exposure creates deterministic open Window and compatible basis attaches', () => {
  const first = normalizeEvent(exposure({eventId: 'exposure-a', day: 1}));
  const second = normalizeEvent(exposure({eventId: 'exposure-b', day: 2}));
  assert.equal(areCompatibleTrackingWindowExposures(first, second), true);
  const firstBuild = deriveTrackingWindows([first], {chatId: 'chat-window'});
  const secondBuild = deriveTrackingWindows([second, first], {chatId: 'chat-window'});
  assert.equal(firstBuild.length, 1);
  assert.equal(firstBuild[0].status, 'open');
  assert.equal(secondBuild.length, 1);
  assert.deepEqual(secondBuild[0].source_event_ids, ['exposure-a', 'exposure-b']);
  assert.equal(secondBuild[0].cycle_id, buildTrackingWindowCycleId({chatId: 'chat-window', subjectId: 'char-subject', mechanismKey: 'fertilization', firstEvent: first}));
});

test('different mechanism and subject create independent Windows', () => {
  const windows = deriveTrackingWindows([
    exposure({eventId: 'a', day: 1}),
    exposure({eventId: 'b', mechanism: 'parthenogenesis', day: 2}),
    exposure({eventId: 'c', subjectId: 'char-other', day: 3}),
  ], {chatId: 'chat-window'});
  assert.equal(windows.length, 3);
  assert.equal(new Set(windows.map(window => window.tracking_window_id)).size, 3);
});

test('confirmation resolves, conception does not, loss and abortion terminate, and terminal windows do not reopen', () => {
  const confirmed = deriveTrackingWindows([
    exposure({eventId: 'exposure-a', day: 1}),
    terminal({eventId: 'confirmation', day: 3}),
    exposure({eventId: 'future-exposure', day: 4}),
  ], {chatId: 'chat-window'});
  assert.deepEqual(new Set(confirmed.map(window => window.status)), new Set(['resolved_pregnant']));
  const conception = deriveTrackingWindows([exposure({eventId: 'exposure-a', day: 1}), terminal({eventId: 'conception', type: 'conception', day: 3})], {chatId: 'chat-window'});
  assert.equal(conception[0].status, 'open');
  for (const type of ['pregnancy_loss', 'abortion']) {
    const result = deriveTrackingWindows([exposure({eventId: 'exposure-a', day: 1}), terminal({eventId: type, type, day: 3})], {chatId: 'chat-window'});
    assert.equal(result[0].status, 'terminated');
  }
  const delivery = deriveTrackingWindows([
    exposure({eventId: 'exposure-a', day: 1}),
    terminal({eventId: 'confirmation', day: 3}),
    terminal({eventId: 'delivery', type: 'delivery', day: 4}),
    exposure({eventId: 'new-round', day: 5}),
  ], {chatId: 'chat-window'});
  assert.deepEqual(new Set(delivery.map(window => window.status)), new Set(['resolved_pregnant', 'open']));
});

test('confirmed-pregnancy guard retains historical exposures and rebuilds deterministically', () => {
  const events = [
    exposure({eventId: 'before-confirmation', day: 1}),
    exposure({eventId: 'same-story-time', day: 3}),
    terminal({eventId: 'confirmation', day: 3}),
    exposure({eventId: 'after-confirmation', day: 4}),
  ];
  const result = deriveTrackingWindows(events, {chatId: 'chat-window'});
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].source_event_ids, ['before-confirmation', 'same-story-time']);
  assert.equal(result[0].status, 'resolved_pregnant');
  assert.deepEqual(deriveTrackingWindows([...events].reverse(), {chatId: 'chat-window'}), result);
});

test('Tracking Runtime exposes resolved Window source candidates without factual attribution', async () => {
  const events = [
    normalizeEvent(exposure({eventId: 'candidate-exposure', day: 1})),
    normalizeEvent(terminal({eventId: 'candidate-confirmation', day: 3, pregnancyId: 'pregnancy-candidate'})),
  ];
  const windows = deriveTrackingWindows(events, {chatId: 'chat-window'});
  const runtime = createTrackingRuntime({
    collectTrackingInputs: async () => ({activeEvents: events, trackingWindows: windows, worldModel: null}),
    getToken: () => ({chatId: 'chat-window'}),
    assertToken: () => {},
    enqueueRefresh: refresh => refresh(),
    notify: () => {},
  });
  const result = await runtime.refreshTrackingRegistry();
  assert.deepEqual(result.reproductive_source_candidates.map(item => ({
    pregnancy_id: item.pregnancy_id,
    source_character_id: item.candidate.source_character_id,
    contribution_kind: item.candidate.contribution_kind,
  })), [{pregnancy_id: 'pregnancy-candidate', source_character_id: 'counterpart-candidate-exposure', contribution_kind: null}]);
  assert.equal(result.reproductive_source_candidates[0].candidate.compatibility, null);
});

test('surviving factual basis rebuilds deterministically after source edit or deletion', () => {
  const first = normalizeEvent(exposure({eventId: 'basis-a', day: 1}));
  const second = normalizeEvent(exposure({eventId: 'basis-b', day: 2}));
  const full = deriveTrackingWindows([first, second], {chatId: 'chat-window'});
  const reversed = deriveTrackingWindows([second, first], {chatId: 'chat-window'});
  assert.deepEqual(reversed, full);
  const edited = normalizeEvent(exposure({eventId: 'basis-a', day: 1, mechanism: 'other'}));
  const afterEdit = deriveTrackingWindows([edited, second], {chatId: 'chat-window'});
  assert.equal(afterEdit.length, 2);
  const afterDelete = deriveTrackingWindows([second], {chatId: 'chat-window'});
  assert.deepEqual(afterDelete[0].source_event_ids, ['basis-b']);
});

test('only open Windows feed Tracking Subject/Candidate; false capability stays inactive', () => {
  const first = exposure({eventId: 'exposure-a', day: 1});
  const windows = deriveTrackingWindows([first], {chatId: 'chat-window'});
  assert.ok(Object.keys(rebuildTrackingRegistry([first], {trackingWindows: windows}).tracking_subjects).length === 1);
  assert.deepEqual(rebuildTrackingRegistry([first], {trackingWindows: windows.map(window => ({...window, status: 'terminated', terminal_event_id: 'x', terminal_reason: 'abortion'}))}).tracking_subjects, {});
  const candidate = exposure({eventId: 'candidate', subjectId: 'char-candidate', carry: null, day: 2});
  const candidateWindows = deriveTrackingWindows([candidate], {chatId: 'chat-window'});
  assert.ok(rebuildTrackingRegistry([candidate], {trackingWindows: candidateWindows}).tracking_candidates['char-candidate']);
  const inactive = exposure({eventId: 'inactive', subjectId: 'char-inactive', carry: false, day: 3});
  const inactiveWindows = deriveTrackingWindows([inactive], {chatId: 'chat-window'});
  const inactiveRegistry = rebuildTrackingRegistry([inactive], {trackingWindows: inactiveWindows});
  assert.deepEqual(inactiveRegistry.tracking_subjects, {});
  assert.deepEqual(inactiveRegistry.tracking_candidates, {});
});

test('Timing Instance and Window share cycle identity without resampling', () => {
  const basis = normalizeEvent(exposure({eventId: 'timing-exposure', day: 10}));
  const windows = deriveTrackingWindows([basis], {chatId: 'chat-window'});
  const timing = resolveProjectionTimingInstance({
    chatId: 'chat-window', subjectId: 'char-subject', mechanismKey: 'fertilization', firstEvent: basis,
    config: {schema_version: 1, config_version: 1, base_min_story_days: 10, base_max_story_days: 20, variance_ratio: 0.2, variance_cap_story_days: 3, total_adjustment_cap_story_days: 2},
    floorVersion: basis.source, rng: () => 1,
  });
  assert.equal(windowCycleMatchesTiming(windows[0], timing), true);
  assert.equal(timing.sampled_individual_offset_story_days, 3);
});

test('symptoms, suspicion, timing missed, and Projection are not Window terminal evidence', () => {
  const result = deriveTrackingWindows([
    exposure({eventId: 'exposure-a', day: 1}),
    terminal({eventId: 'suspicion', type: 'pregnancy_suspicion', day: 2}),
    terminal({eventId: 'symptom', type: 'physical_symptom', day: 3}),
  ], {chatId: 'chat-window'});
  assert.equal(activeTrackingWindows(result).length, 1);
});

test('pre-confirmation Projection Eligibility requires an open Window without changing Projection lifecycle', () => {
  const basis = normalizeEvent(exposure({eventId: 'projection-exposure', day: 1}));
  const content = {
    schema_version: 1,
    mechanism_key: 'fertilization',
    development_concern_key: 'detection',
    development_kind: 'possible_detection',
    trigger: {kind: 'immediate_after_event', source_event_type: 'sexual_activity'},
    requirements: {capabilities: [], source_compatibility: 'not_required', contributor_relationships: []},
    realization: null, contradiction: null, expiration: null,
  };
  const rule = {...content, projection_rule_id: buildProjectionRuleId(content)};
  const timing = resolveProjectionTimingInstance({chatId: 'chat-window', subjectId: 'char-subject', mechanismKey: 'fertilization', firstEvent: basis, config: {schema_version: 1, config_version: 1, base_min_story_days: 0, base_max_story_days: 10, variance_ratio: 0, variance_cap_story_days: 0, total_adjustment_cap_story_days: 0}, floorVersion: basis.source, rng: () => 0.5});
  const windows = deriveTrackingWindows([basis], {chatId: 'chat-window'});
  const open = evaluateProjectionEligibility({events: [basis], currentState: {characters: {'char-subject': {reproductive_capabilities: {}}}}, worldModel: {projection_rules: [rule]}, currentStoryTime: {day_index: 1}, preConfirmationTiming: {enabled: true, instances: [timing], windows}});
  assert.equal(open.decisions[0].eligibility, 'eligible');
  const closed = evaluateProjectionEligibility({events: [basis], currentState: {characters: {'char-subject': {reproductive_capabilities: {}}}}, worldModel: {projection_rules: [rule]}, currentStoryTime: {day_index: 1}, preConfirmationTiming: {enabled: true, instances: [timing], windows: windows.map(window => ({...window, status: 'resolved_pregnant', terminal_event_id: 'confirmation', terminal_reason: 'pregnancy_confirmation'}))}});
  assert.equal(closed.decisions[0].reason_code, 'tracking_window_not_open');
});

test('active factual Pregnancy Episode keeps a confirmed character visible after Window closure', () => {
  const subjects = mergeTrackingSubjectsWithActivePregnancies({}, {
    characters: {
      'char-confirmed': {pregnancy: {current_status: 'confirmed', active_pregnancy_ids: ['pregnancy-1']}},
      'char-ended': {pregnancy: {current_status: 'ended', active_pregnancy_ids: []}},
    },
  });
  assert.equal(subjects['char-confirmed'].factual_pregnancy_state, 'confirmed');
  assert.equal(subjects['char-ended'], undefined);
});

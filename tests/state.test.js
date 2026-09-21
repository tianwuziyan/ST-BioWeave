import test from 'node:test';
import assert from 'node:assert/strict';
import { reduceState } from '../core/state.js';

const SUBJECT = 'char_000001';
const SOURCE = 'char_000002';

function storyTime(day) {
  return {
    display: `day ${day}`,
    normalized: `0001-01-${String(day).padStart(2, '0')}`,
    day_index: day,
    calendar_id: 'calendar-main',
    precision: 'day',
    confidence: 1,
  };
}

function facts(extra = {}) {
  return {
    [SUBJECT]: {
      identity: {
        character_id: SUBJECT,
        display_name: 'Subject',
        species: 'Species-A',
        biological_type: 'Type-A',
      },
      reproductive_capabilities: {
        can_carry_pregnancy: true,
        can_be_fertilized: true,
      },
      ...extra,
    },
  };
}

function event({
  event_id,
  type = 'physical_symptom',
  status = 'confirmed',
  day = 1,
  floor = day,
  subject_id = SUBJECT,
  payload = { symptom: { kind: 'observed', description: 'fact' } },
  participants = [subject_id],
  pregnancyRelevance = null,
  story = storyTime(day),
}) {
  return {
    event_id,
    type,
    status,
    source: {
      chat_id: 'chat-1',
      message_id: `message-${event_id}`,
      floor,
      swipe_id: 0,
      content_hash: `hash-${event_id}`,
      message_version: 'v1',
    },
    story_time: story,
    participants: participants.map((character_id) => ({ character_id, event_role: 'unknown' })),
    pregnancy_relevance: pregnancyRelevance ?? {
      relevant: false,
      possible_conception: false,
      gestational_subject_ids: [],
      counterpart_ids: [],
      confidence: null,
    },
    state_fact: payload === undefined ? null : { subject_id, payload },
  };
}

function exposure({ event_id, day, floor = day, status = 'confirmed', possible_conception = true } = {}) {
  const result = event({
    event_id: event_id ?? `exposure-${day}`,
    type: 'sexual_activity',
    status,
    day,
    floor,
    participants: [SUBJECT, SOURCE],
    payload: undefined,
    pregnancyRelevance: {
      relevant: true,
      possible_conception,
      gestational_subject_ids: [SUBJECT],
      counterpart_ids: [SOURCE],
      reproductive_mechanism: {
        kind: 'test-mechanism',
        label: null,
        pathway: null,
        world_model_rule_refs: [],
        evidence: [],
      },
      confidence: 1,
    },
  });
  result.state_fact = null;
  result.source_evidence = [{ kind: 'pregnancy_relevant_exposure', text: 'explicit exposure' }];
  return result;
}

function attribution({
  event_id,
  pregnancy_id = 'preg-a',
  source_character_id = SOURCE,
  contribution_kind = 'genetic',
  attribution: relationshipStatus = 'confirmed',
  status = 'confirmed',
  day = 2,
  floor = day,
} = {}) {
  return event({
    event_id: event_id ?? `attribution-${source_character_id}-${relationshipStatus}`,
    type: 'reproductive_source_attribution',
    status,
    day,
    floor,
    participants: [SUBJECT, source_character_id],
    payload: {
      pregnancy_id,
      source_character_id,
      contribution_kind,
      attribution: relationshipStatus,
    },
  });
}

function reduce(events, options = {}) {
  return reduceState({
    events,
    characterFacts: facts(),
    currentStoryTime: storyTime(20),
    ...options,
  });
}

test('empty input is a stable versioned state', () => {
  const state = reduceState();
  assert.deepEqual(state, reduceState());
  assert.equal(state.schema_version, 1);
  assert.deepEqual(state.characters, {});
  assert.deepEqual(state.processed_event_ids, []);
  assert.deepEqual(state.diagnostics, []);
});

test('same input is deep-equal, input order is irrelevant, and input is not mutated', () => {
  const events = [
    event({ event_id: 'symptom-late', day: 4 }),
    event({ event_id: 'symptom-early', day: 2 }),
  ];
  const original = structuredClone(events);
  const first = reduce(events);
  const second = reduce([...events].reverse());
  assert.deepEqual(first, second);
  assert.deepEqual(events, original);
});

test('characterFacts creates only canonical characters and keeps source counterparts out', () => {
  const state = reduce([exposure({ event_id: 'exposure-1', day: 1 })]);
  assert.deepEqual(Object.keys(state.characters), [SUBJECT]);
  assert.equal(state.characters[SOURCE], undefined);
});

test('exposure records preserve sources, possible conception, chronology, and elapsed Story Time', () => {
  const state = reduce([
    exposure({ event_id: 'exposure-late', day: 9, floor: 1 }),
    exposure({ event_id: 'exposure-early', day: 3, floor: 2 }),
  ]);
  const exposureState = state.characters[SUBJECT].reproductive_exposure;
  assert.deepEqual(exposureState.records.map((record) => record.event_id), [
    'exposure-early',
    'exposure-late',
  ]);
  assert.equal(exposureState.last_exposure_event_id, 'exposure-late');
  assert.equal(exposureState.elapsed_story_days, 11);
  assert.deepEqual(state.processed_event_ids, ['exposure-late', 'exposure-early']);
  assert.equal(state.characters[SUBJECT].conception.status, 'unknown');
});

test('incomparable Story Time produces unknown elapsed time', () => {
  const state = reduce([exposure({ event_id: 'exposure-1', day: 3 })], {
    currentStoryTime: { ...storyTime(20), calendar_id: 'other-calendar' },
  });
  assert.equal(state.characters[SUBJECT].reproductive_exposure.elapsed_story_days, null);
});

test('status semantics preserve confirmed facts and ignore negated or fictional facts', () => {
  const state = reduce([
    event({ event_id: 'negated', status: 'negated', day: 1 }),
    event({ event_id: 'fictional', status: 'fictional', day: 2 }),
    event({ event_id: 'probable', status: 'probable', day: 3 }),
    event({ event_id: 'confirmed', status: 'confirmed', day: 4 }),
    event({ event_id: 'ambiguous', status: 'ambiguous', day: 5 }),
  ]);
  const character = state.characters[SUBJECT];
  assert.deepEqual(character.symptoms.records.map((record) => record.event_id), ['confirmed']);
  assert.deepEqual(character.symptoms.uncertain_records.map((record) => record.event_id), ['probable', 'ambiguous']);
  assert.deepEqual(character.activity_chain.event_ids, ['negated', 'fictional', 'probable', 'confirmed', 'ambiguous']);
});

test('conception is factual only for confirmed typed conception events', () => {
  const state = reduce([
    event({
      event_id: 'possible-conception-only',
      type: 'sexual_activity',
      participants: [SUBJECT, SOURCE],
      payload: undefined,
      pregnancyRelevance: {
        relevant: true,
        possible_conception: true,
        gestational_subject_ids: [SUBJECT],
        counterpart_ids: [SOURCE],
        confidence: 1,
      },
    }),
    event({
      event_id: 'probable-conception',
      type: 'conception',
      status: 'probable',
      payload: { pregnancy_id: 'preg-a' },
    }),
    event({
      event_id: 'confirmed-conception',
      type: 'conception',
      status: 'confirmed',
      payload: { pregnancy_id: 'preg-a' },
    }),
  ]);
  const conception = state.characters[SUBJECT].conception;
  assert.equal(conception.status, 'confirmed');
  assert.deepEqual(conception.confirmed_event_ids, ['confirmed-conception']);
  assert.deepEqual(conception.uncertain_event_ids, ['probable-conception']);
});

test('suspicion does not confirm pregnancy and unresolved suspicion gets no artificial ID', () => {
  const state = reduce([
    event({
      event_id: 'suspicion-without-id',
      type: 'pregnancy_suspicion',
      payload: { observation: { kind: 'test', description: 'observed' } },
    }),
    event({
      event_id: 'suspicion-a',
      type: 'pregnancy_suspicion',
      payload: { pregnancy_id: 'preg-a', observation: { kind: 'test' } },
    }),
  ]);
  const character = state.characters[SUBJECT];
  assert.equal(character.pregnancy.current_status, 'suspected');
  assert.equal(character.pregnancy.episodes['preg-a'].status, 'suspected');
  assert.equal(Object.keys(character.pregnancy.episodes).length, 1);
  assert.equal(character.conception.status, 'unknown');
  assert.equal(state.diagnostics.some((item) => item.code === 'unresolved_pregnancy_suspicion'), true);
});

test('pregnancy episodes are isolated and termination preserves history', () => {
  const state = reduce([
    event({
      event_id: 'confirm-a',
      type: 'pregnancy_confirmation',
      payload: { pregnancy_id: 'preg-a' },
      day: 2,
    }),
    event({
      event_id: 'loss-a',
      type: 'pregnancy_loss',
      payload: { pregnancy_id: 'preg-a' },
      day: 5,
    }),
    event({
      event_id: 'confirm-b',
      type: 'pregnancy_confirmation',
      payload: { pregnancy_id: 'preg-b' },
      day: 8,
    }),
  ]);
  const pregnancy = state.characters[SUBJECT].pregnancy;
  assert.equal(pregnancy.episodes['preg-a'].status, 'ended');
  assert.equal(pregnancy.episodes['preg-b'].status, 'confirmed');
  assert.deepEqual(pregnancy.active_pregnancy_ids, ['preg-b']);
  assert.deepEqual(pregnancy.episodes['preg-a'].confirmation_event_ids, ['confirm-a']);
  assert.deepEqual(pregnancy.episodes['preg-a'].termination_event_ids, ['loss-a']);
});

test('confirmed and excluded contributor facts aggregate without a single-source assumption', () => {
  const state = reduce([
    event({ event_id: 'conception-a', type: 'conception', payload: { pregnancy_id: 'preg-a' }, day: 1 }),
    attribution({ event_id: 'confirm-b', source_character_id: 'char_000002', contribution_kind: 'genetic' }),
    attribution({ event_id: 'confirm-c', source_character_id: 'char_000003', contribution_kind: 'magical' }),
    attribution({ event_id: 'exclude-d', source_character_id: 'char_000004', contribution_kind: 'genetic', attribution: 'excluded' }),
  ]);
  const contributors = state.characters[SUBJECT].pregnancy.episodes['preg-a'].contributors;
  assert.deepEqual(contributors.confirmed.map((item) => item.source_character_id), ['char_000002', 'char_000003']);
  assert.equal(contributors.confirmed[1].contribution_kind, 'magical');
  assert.deepEqual(contributors.excluded.map((item) => item.source_character_id), ['char_000004']);
  assert.deepEqual(contributors.conflicts, []);
});

test('attribution cannot create a Pregnancy Episode or a pregnancy fact', () => {
  const state = reduce([attribution({ event_id: 'orphan-attribution', pregnancy_id: 'preg-missing' })]);
  const character = state.characters[SUBJECT];
  assert.deepEqual(character.pregnancy.episodes, {});
  assert.equal(character.pregnancy.current_status, 'unknown');
  assert.equal(character.conception.status, 'unknown');
  assert.equal(state.diagnostics.some((item) => item.code === 'unresolved_reproductive_source_attribution'), true);
});

test('probable, ambiguous, negated, and fictional attribution never changes factual contributors', () => {
  const state = reduce([
    event({ event_id: 'conception-a', type: 'conception', payload: { pregnancy_id: 'preg-a' }, day: 1 }),
    attribution({ event_id: 'probable-attribution', status: 'probable', source_character_id: 'char_000002' }),
    attribution({ event_id: 'ambiguous-attribution', status: 'ambiguous', source_character_id: 'char_000003' }),
    attribution({ event_id: 'negated-attribution', status: 'negated', source_character_id: 'char_000004' }),
    attribution({ event_id: 'fictional-attribution', status: 'fictional', source_character_id: 'char_000005' }),
  ]);
  const contributors = state.characters[SUBJECT].pregnancy.episodes['preg-a'].contributors;
  assert.deepEqual(contributors.confirmed, []);
  assert.deepEqual(contributors.excluded, []);
  assert.equal(state.diagnostics.filter((item) => item.code === 'invalid_event').length, 0);
});

test('same contributor relationship conflict is fail-closed and input order independent', () => {
  const base = event({ event_id: 'conception-a', type: 'conception', payload: { pregnancy_id: 'preg-a' }, day: 1 });
  const confirmed = attribution({ event_id: 'relationship-confirmed', source_character_id: 'char_000002', day: 2, floor: 2 });
  const excluded = attribution({ event_id: 'relationship-excluded', source_character_id: 'char_000002', attribution: 'excluded', day: 3, floor: 3 });
  const first = reduce([base, confirmed, excluded]);
  const second = reduce([excluded, confirmed, base]);
  const firstContributors = first.characters[SUBJECT].pregnancy.episodes['preg-a'].contributors;
  const secondContributors = second.characters[SUBJECT].pregnancy.episodes['preg-a'].contributors;
  assert.deepEqual(firstContributors, secondContributors);
  assert.deepEqual(firstContributors.confirmed, []);
  assert.deepEqual(firstContributors.excluded, []);
  assert.equal(firstContributors.conflicts.length, 1);
  assert.equal(first.diagnostics.some((item) => item.code === 'reproductive_source_attribution_conflict'), true);
});

test('duplicate attribution events dedupe and baseState remains immutable during replay', () => {
  const initial = reduce([event({ event_id: 'conception-a', type: 'conception', payload: { pregnancy_id: 'preg-a' }, day: 1 })]);
  const baseBefore = structuredClone(initial);
  const fact = attribution({ event_id: 'confirm-c', source_character_id: 'char_000003', contribution_kind: 'magical' });
  const fullReplay = reduce([event({ event_id: 'conception-a', type: 'conception', payload: { pregnancy_id: 'preg-a' }, day: 1 }), fact]);
  const replayed = reduceState({ baseState: initial, events: [fact, structuredClone(fact)], characterFacts: facts(), currentStoryTime: storyTime(20) });
  assert.deepEqual(replayed, fullReplay);
  assert.deepEqual(initial, baseBefore);
  const contributors = replayed.characters[SUBJECT].pregnancy.episodes['preg-a'].contributors;
  assert.equal(contributors.confirmed.length, 1);
  assert.deepEqual(contributors.confirmed[0].event_ids, ['confirm-c']);
});

test('abortion and delivery end only their referenced episode; labor does not deliver', () => {
  const laborOnly = reduce([
    event({ event_id: 'confirm-a', type: 'pregnancy_confirmation', payload: { pregnancy_id: 'preg-a' }, day: 1 }),
    event({ event_id: 'labor-a', type: 'labor', payload: { pregnancy_id: 'preg-a', labor_id: 'labor-a' }, day: 2 }),
  ]);
  assert.equal(laborOnly.characters[SUBJECT].pregnancy.episodes['preg-a'].status, 'confirmed');
  assert.deepEqual(laborOnly.characters[SUBJECT].pregnancy.episodes['preg-a'].delivery_event_ids, []);

  const ended = reduce([
    event({ event_id: 'confirm-a', type: 'pregnancy_confirmation', payload: { pregnancy_id: 'preg-a' }, day: 1 }),
    event({ event_id: 'abortion-a', type: 'abortion', payload: { pregnancy_id: 'preg-a' }, day: 2 }),
    event({ event_id: 'confirm-b', type: 'pregnancy_confirmation', payload: { pregnancy_id: 'preg-b' }, day: 3 }),
    event({ event_id: 'delivery-b', type: 'delivery', payload: { pregnancy_id: 'preg-b', delivery_id: 'delivery-b' }, day: 4 }),
  ]);
  assert.equal(ended.characters[SUBJECT].pregnancy.episodes['preg-a'].status, 'ended');
  assert.equal(ended.characters[SUBJECT].pregnancy.episodes['preg-b'].status, 'ended');
  assert.deepEqual(ended.characters[SUBJECT].pregnancy.episodes['preg-b'].delivery_event_ids, ['delivery-b']);
  assert.deepEqual(ended.characters[SUBJECT].postpartum.factual_event_ids, []);
});

test('postpartum is factual only when an explicit postpartum Event exists', () => {
  const state = reduce([
    event({
      event_id: 'postpartum-a',
      type: 'postpartum',
      payload: { pregnancy_id: 'preg-a', postpartum_id: 'post-a' },
    }),
  ]);
  assert.deepEqual(state.characters[SUBJECT].postpartum.factual_event_ids, ['postpartum-a']);
  assert.equal(state.characters[SUBJECT].postpartum.episodes['preg-a'].postpartum_id, 'post-a');
});

test('cycle and fertility facts do not infer future cycle or capability aliases', () => {
  const state = reduce([
    event({ event_id: 'menstrual', type: 'menstrual_event', payload: {}, day: 1 }),
    event({ event_id: 'ovulation', type: 'ovulation_event', payload: {}, day: 2 }),
    event({
      event_id: 'fertility',
      type: 'fertility_change',
      payload: { capability_changes: { can_fertilize: true, can_carry_pregnancy: null } },
      day: 3,
    }),
  ]);
  const character = state.characters[SUBJECT];
  assert.deepEqual(character.cycle.factual_event_ids, ['menstrual', 'ovulation']);
  assert.equal(character.reproductive_capabilities.can_fertilize, true);
  assert.equal(character.reproductive_capabilities.can_cause_pregnancy, null);
  assert.equal(character.reproductive_capabilities.can_carry_pregnancy, null);
});

test('fertilization and pregnancy-causation capabilities remain independent tri-state facts', () => {
  const state = reduce([
    event({
      event_id: 'fertility-independent',
      type: 'fertility_change',
      payload: {capability_changes: {can_fertilize: true, can_cause_pregnancy: false}},
    }),
  ]);
  assert.equal(state.characters[SUBJECT].reproductive_capabilities.can_fertilize, true);
  assert.equal(state.characters[SUBJECT].reproductive_capabilities.can_cause_pregnancy, false);
});

test('medical and symptom facts remain factual records without cross-domain inference', () => {
  const state = reduce([
    event({ event_id: 'symptom', type: 'physical_symptom', payload: { symptom: { kind: 'nausea' } } }),
    event({ event_id: 'medical', type: 'medical_event', payload: { fact: { kind: 'diagnosis' } } }),
  ]);
  const character = state.characters[SUBJECT];
  assert.equal(character.symptoms.records[0].symptom.kind, 'nausea');
  assert.equal(character.medical.records[0].fact.kind, 'diagnosis');
  assert.equal(character.pregnancy.current_status, 'unknown');
});

test('duplicate identical events dedupe and conflicting IDs produce a diagnostic', () => {
  const identical = event({ event_id: 'same-event' });
  const deduped = reduce([identical, structuredClone(identical)]);
  assert.deepEqual(deduped.processed_event_ids, ['same-event']);
  assert.deepEqual(deduped.characters[SUBJECT].symptoms.records.map((record) => record.event_id), ['same-event']);

  const conflict = reduce([
    event({ event_id: 'conflict', day: 1 }),
    event({ event_id: 'conflict', day: 2 }),
  ]);
  assert.deepEqual(conflict.processed_event_ids, []);
  assert.deepEqual(conflict.diagnostics.map((item) => item.code), ['event_id_conflict']);
});

test('unknown termination is recorded without manufacturing confirmed pregnancy', () => {
  const state = reduce([
    event({
      event_id: 'loss-unknown',
      type: 'pregnancy_loss',
      payload: { pregnancy_id: 'preg-unknown' },
    }),
  ]);
  const character = state.characters[SUBJECT];
  assert.equal(character.pregnancy.episodes['preg-unknown'].status, 'ended');
  assert.deepEqual(character.pregnancy.active_pregnancy_ids, []);
  assert.equal(
    state.diagnostics.some((item) => item.code === 'termination_without_confirmed_pregnancy'),
    true,
  );
});

test('baseState plus later events matches full replay and does not mutate baseState', () => {
  const first = [
    event({ event_id: 'confirm-a', type: 'pregnancy_confirmation', payload: { pregnancy_id: 'preg-a' }, day: 1 }),
    event({ event_id: 'symptom-a', day: 2 }),
  ];
  const later = [
    event({ event_id: 'loss-a', type: 'pregnancy_loss', payload: { pregnancy_id: 'preg-a' }, day: 4 }),
  ];
  const baseState = reduce(first);
  const baseCopy = structuredClone(baseState);
  const resumed = reduce(later, { baseState });
  const full = reduce([...first, ...later]);
  assert.deepEqual(resumed, full);
  assert.deepEqual(baseState, baseCopy);
});

test('two characters remain isolated and display names never become identity keys', () => {
  const other = 'char_000003';
  const state = reduce([
    event({ event_id: 'other-symptom', subject_id: other, participants: [other], day: 1 }),
  ], {
    characterFacts: {
      ...facts(),
      [other]: {
        identity: { character_id: other, display_name: 'Subject', species: null, biological_type: null },
      },
    },
  });
  assert.deepEqual(Object.keys(state.characters).sort(), [SUBJECT, other].sort());
  assert.deepEqual(state.characters[SUBJECT].symptoms.records, []);
  assert.equal(state.characters[other].symptoms.records[0].event_id, 'other-symptom');
  assert.equal(state.characters.Subject, undefined);
});

test('rebuilds a 500-event active history without changing factual semantics', () => {
  const events = Array.from({ length: 500 }, (_, index) =>
    event({
      event_id: `symptom-${index}`,
      day: (index % 30) + 1,
      floor: index + 1,
    }),
  );
  const state = reduce(events, { currentStoryTime: storyTime(31) });
  assert.equal(state.processed_event_ids.length, 500);
  assert.equal(state.characters[SUBJECT].symptoms.records.length, 500);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildEventIdentityContinuityCandidates,
  reconcileEventIdentityHints,
  selectEventIdentityResolutionCandidates,
} from '../runtime/character-event-analysis.js';
import {
  normalizeCharacterRegistry,
  reconcileDerivedEventIdentityReferences,
  resolveEventAnalysisIdentities,
} from '../core/identity.js';

function analysisInput() {
  return {
    character_registry: {
      schema_version: 1,
      entities: {
        char_000002: {
          character_id: 'char_000002',
          display_name: '柳如烟',
          aliases: [],
        },
      },
    },
    tracking_windows: [{subject_id: 'char_000003', status: 'open'}],
    participant_aggregations: [],
    existing_events: [{
      participants: [{character_id: 'char_000003', display_name: '柳如烟'}],
    }],
  };
}

test('Event identity tolerance repairs one stale legal ID from active continuity', () => {
  const input = analysisInput();
  const candidates = buildEventIdentityContinuityCandidates(input);
  const reconciled = reconcileEventIdentityHints({
    events: [{
      participants: [{
        identity_status: 'existing',
        character_id: 'char_000002',
        display_name: '柳如烟',
      }],
      pregnancy_relevance: {
        gestational_subject_ids: ['char_000002'],
        counterpart_ids: [],
      },
      state_fact: {subject_id: 'char_000002'},
    }],
  }, candidates);

  assert.deepEqual(reconciled.mappings, [{
    supplied_id: 'char_000002',
    canonical_id: 'char_000003',
  }]);
  assert.equal(reconciled.analysis.events[0].participants[0].character_id, 'char_000003');
  assert.deepEqual(reconciled.analysis.events[0].pregnancy_relevance.gestational_subject_ids, ['char_000003']);
  assert.equal(reconciled.analysis.events[0].state_fact.subject_id, 'char_000003');

  const registry = normalizeCharacterRegistry(input.character_registry);
  registry.entities.char_000003 = {
    character_id: 'char_000003',
    display_name: '柳如烟',
    aliases: [],
  };
  const resolved = resolveEventAnalysisIdentities(reconciled.analysis, {
    registry,
    allowNameOnlyExisting: true,
    continuityCandidates: candidates,
    preferContinuityIdentity: true,
  });
  assert.equal(resolved.ok, true);
  assert.equal(resolved.events[0].participants[0].character_id, 'char_000003');
});

test('Event identity tolerance leaves ambiguous same-name continuity unresolved', () => {
  const input = {
    ...analysisInput(),
    tracking_windows: [
      {subject_id: 'char_000003', status: 'open'},
      {subject_id: 'char_000004', status: 'open'},
    ],
    existing_events: [{
      participants: [
        {character_id: 'char_000003', display_name: '柳如烟'},
        {character_id: 'char_000004', display_name: '柳如烟'},
      ],
    }],
  };
  const candidates = buildEventIdentityContinuityCandidates(input);
  const reconciled = reconcileEventIdentityHints({
    events: [{
      participants: [{
        identity_status: 'existing',
        character_id: 'char_000002',
        display_name: '柳如烟',
      }],
    }],
  }, candidates);
  assert.deepEqual(reconciled.mappings, []);
  assert.deepEqual(reconciled.diagnostics, []);
});

test('Event identity tolerance reuses one active continuity ID when the model labels it new', () => {
  const input = {
    character_registry: {
      schema_version: 1,
      entities: {
        char_000001: {
          character_id: 'char_000001',
          display_name: '觉心',
          aliases: [],
        },
      },
    },
    tracking_windows: [{subject_id: 'char_000003', status: 'open'}],
    participant_aggregations: [],
    existing_events: [{
      participants: [{character_id: 'char_000003', display_name: '柳如烟'}],
    }],
  };
  const candidates = buildEventIdentityContinuityCandidates(input);
  const rawAnalysis = {
    events: [{
      participants: [{
        identity_status: 'new',
        character_id: null,
        mention_id: 'mention-liuruyan',
        display_name: '柳如烟',
      }],
    }],
  };
  const selected = selectEventIdentityResolutionCandidates(rawAnalysis, candidates);
  assert.deepEqual(selected.map(candidate => candidate.character_id), ['char_000003']);

  const registry = normalizeCharacterRegistry(input.character_registry);
  registry.entities.char_000003 = {
    character_id: 'char_000003',
    display_name: '柳如烟',
    aliases: [],
  };
  const resolved = resolveEventAnalysisIdentities(rawAnalysis, {
    registry,
    continuityCandidates: selected,
    preferContinuityIdentity: true,
  });
  assert.equal(resolved.ok, true);
  assert.equal(resolved.events[0].participants[0].character_id, 'char_000003');
  assert.equal(resolved.registry.entities.char_000002, undefined);
});

test('Event identity tolerance fails closed when new mention matches multiple active continuity IDs', () => {
  const input = {
    character_registry: {schema_version: 1, entities: {}},
    tracking_windows: [
      {subject_id: 'char_000003', status: 'open'},
      {subject_id: 'char_000004', status: 'open'},
    ],
    existing_events: [{
      participants: [
        {character_id: 'char_000003', display_name: '柳如烟'},
        {character_id: 'char_000004', display_name: '柳如烟'},
      ],
    }],
  };
  const candidates = buildEventIdentityContinuityCandidates(input);
  const rawAnalysis = {
    events: [{
      participants: [{
        identity_status: 'new',
        character_id: null,
        mention_id: 'mention-ambiguous',
        display_name: '柳如烟',
      }],
    }],
  };
  const selected = selectEventIdentityResolutionCandidates(rawAnalysis, candidates);
  const registry = normalizeCharacterRegistry(input.character_registry);
  for (const candidate of selected) registry.entities[candidate.character_id] = candidate;
  const resolved = resolveEventAnalysisIdentities(rawAnalysis, {
    registry,
    continuityCandidates: selected,
    preferContinuityIdentity: true,
  });
  assert.equal(resolved.ok, false);
  assert.equal(resolved.errors[0].error_code, 'identity_unresolved');
  assert.equal(resolved.registry.entities.char_000003.display_name, '柳如烟');
  assert.equal(resolved.registry.entities.char_000004.display_name, '柳如烟');
  assert.equal(resolved.registry.entities.char_000001, undefined);
});

test('Event identity tolerance keeps explicit distinct-new mentions separate', () => {
  const rawAnalysis = {
    events: [{
      participants: [{
        identity_status: 'new',
        character_id: null,
        mention_id: 'mention-distinct-liuruyan',
        display_name: '柳如烟',
        identity_evidence: [{
          kind: 'explicit_distinct_entity',
          text: '明确说明这是另一位同名人物',
        }],
      }],
    }],
  };
  const continuity = [{
    character_id: 'char_000003',
    display_name: '柳如烟',
    aliases: [],
  }];
  const registry = normalizeCharacterRegistry({
    schema_version: 1,
    entities: {
      char_000003: continuity[0],
    },
  });

  const resolved = resolveEventAnalysisIdentities(rawAnalysis, {
    registry,
    continuityCandidates: continuity,
    preferContinuityIdentity: true,
  });

  assert.equal(resolved.ok, true);
  assert.equal(resolved.events[0].participants[0].character_id, 'char_000004');
  assert.equal(resolved.registry.entities.char_000003.display_name, '柳如烟');
  assert.equal(resolved.registry.entities.char_000004.display_name, '柳如烟');
});

test('derived identity reconciliation collapses one orphaned same-name ID without mutating Floor events', () => {
  const registry = normalizeCharacterRegistry({
    schema_version: 1,
    entities: {
      char_000002: {character_id: 'char_000002', display_name: '柳如烟', aliases: []},
    },
  });
  const events = [{
    event_id: 'evt-stale-liuruyan',
    participants: [
      {character_id: 'char_000003', display_name: '柳如烟'},
      {character_id: 'char_000010', display_name: '大夫'},
    ],
    pregnancy_relevance: {
      gestational_subject_ids: ['char_000003'],
      counterpart_ids: ['char_000010'],
    },
    state_fact: {
      subject_id: 'char_000003',
      payload: {source_character_id: 'char_000003'},
    },
  }];

  const reconciled = reconcileDerivedEventIdentityReferences(events, registry);

  assert.deepEqual(reconciled.mappings, [{
    stale_id: 'char_000003',
    canonical_id: 'char_000002',
  }]);
  assert.equal(reconciled.events[0].participants[0].character_id, 'char_000002');
  assert.deepEqual(reconciled.events[0].pregnancy_relevance.gestational_subject_ids, ['char_000002']);
  assert.equal(reconciled.events[0].state_fact.subject_id, 'char_000002');
  assert.equal(reconciled.events[0].state_fact.payload.source_character_id, 'char_000002');
  assert.equal(events[0].participants[0].character_id, 'char_000003');
  assert.equal(events[0].state_fact.subject_id, 'char_000003');
});

test('derived identity reconciliation fails closed for same-name registry ambiguity', () => {
  const registry = normalizeCharacterRegistry({
    schema_version: 1,
    entities: {
      char_000002: {character_id: 'char_000002', display_name: '柳如烟', aliases: []},
      char_000004: {character_id: 'char_000004', display_name: '柳如烟', aliases: []},
    },
  });
  const events = [{
    participants: [{character_id: 'char_000003', display_name: '柳如烟'}],
    pregnancy_relevance: {gestational_subject_ids: ['char_000003'], counterpart_ids: []},
  }];

  const reconciled = reconcileDerivedEventIdentityReferences(events, registry);

  assert.deepEqual(reconciled.mappings, []);
  assert.equal(reconciled.events[0].participants[0].character_id, 'char_000003');
  assert.deepEqual(reconciled.diagnostics, [{
    stale_id: 'char_000003',
    display_names: ['柳如烟'],
    candidate_ids: ['char_000002', 'char_000004'],
    reason_code: 'derived_identity_mapping_ambiguous',
  }]);
});

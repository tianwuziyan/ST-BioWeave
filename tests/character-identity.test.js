import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bootstrapLegacyCharacterRegistry,
  bootstrapCharacterRegistryFromLegacy,
  collectExactCharacterCandidateIds,
  collectExactCharacterCandidates,
  createEmptyCharacterRegistry,
  createOpaqueCharacterId,
  discoverAliasCandidate,
  hasCharacterId,
  normalizeCharacterRegistry,
  persistAliasCandidate,
  registerNewCharacter,
  renameCharacter,
  resolveEventAnalysisIdentities,
  resolveMentionIdentity,
  resolveRawParticipantIdentities,
  resolveRawParticipantIdentity,
} from '../core/identity.js';

function registryWith(...entries) {
  return normalizeCharacterRegistry({
    schema_version: 1,
    entities: Object.fromEntries(
      entries.map((entry) => [entry.character_id, entry]),
    ),
  });
}

function explicitAlias(value = '鸢儿', kind = 'nickname') {
  return {
    value,
    kind,
    confidence: 0.99,
    identity_evidence: [{ kind: 'explicit_alias', text: `以后叫我${value}` }],
  };
}

test('registry entries are keyed by canonical IDs and clone without shared state', () => {
  const raw = registryWith({
    character_id: 'char_001',
    display_name: '沈祁鸢',
    aliases: ['祁鸢', '祁鸢'],
  });
  const clone = normalizeCharacterRegistry(raw);

  assert.deepEqual(clone.entities, {
    char_001: {
      character_id: 'char_001',
      display_name: '沈祁鸢',
      aliases: ['祁鸢'],
    },
  });
  clone.entities.char_001.aliases.push('鸢儿');
  assert.deepEqual(raw.entities.char_001.aliases, ['祁鸢']);
  assert.equal(hasCharacterId(clone, 'char_001'), true);
  assert.equal(hasCharacterId(clone, '沈祁鸢'), false);
});

test('exact display and alias lookup returns a complete candidate set', () => {
  const registry = registryWith(
    { character_id: 'char_001', display_name: '晚晚', aliases: ['鸢儿'] },
    { character_id: 'char_002', display_name: '晚晚', aliases: ['鸢儿'] },
    { character_id: 'char_003', display_name: '晚安', aliases: ['晚晚'] },
  );

  assert.deepEqual(
    [...collectExactCharacterCandidates(registry, '鸢儿')],
    ['char_001', 'char_002'],
  );
  assert.deepEqual(collectExactCharacterCandidateIds(registry, '晚晚'), [
    'char_001',
    'char_002',
    'char_003',
  ]);
  assert.deepEqual(
    collectExactCharacterCandidateIds(
      normalizeCharacterRegistry({
        entities: {
          char_003: registry.entities.char_003,
          char_001: registry.entities.char_001,
          char_002: registry.entities.char_002,
        },
      }),
      '晚晚',
    ),
    ['char_001', 'char_002', 'char_003'],
  );
  assert.equal(resolveMentionIdentity({ registry, mention: '鸢儿' }).ok, false);
});

test('same-sounding display names remain separate canonical entities', () => {
  const registry = registryWith(
    { character_id: 'char_001', display_name: '沈祁鸢', aliases: [] },
    { character_id: 'char_002', display_name: '沈琪媛', aliases: [] },
  );

  assert.deepEqual(collectExactCharacterCandidateIds(registry, '沈祁鸢'), [
    'char_001',
  ]);
  assert.deepEqual(collectExactCharacterCandidateIds(registry, '沈琪媛'), [
    'char_002',
  ]);
  assert.notEqual(
    collectExactCharacterCandidateIds(registry, '沈祁鸢')[0],
    collectExactCharacterCandidateIds(registry, '沈琪媛')[0],
  );
  assert.deepEqual(Object.keys(registry.entities).sort(), [
    'char_001',
    'char_002',
  ]);
});

test('opaque IDs are Runtime-generated and nickname-only newcomers keep their ID', () => {
  const uuidId = createOpaqueCharacterId({
    randomUUID: () => '00000000-0000-4000-8000-000000000001',
  });
  assert.equal(uuidId, 'char_00000000-0000-4000-8000-000000000001');
  assert.doesNotMatch(uuidId, /沈祁鸢|鸢儿|晚晚/);

  const registry = createEmptyCharacterRegistry();
  const result = registerNewCharacter(
    registry,
    { display_name: '鸢儿' },
    {
      idFactory: () => 'char_runtime_001',
    },
  );
  assert.equal(result.ok, true);
  assert.equal(result.identity_status, 'new');
  assert.equal(result.character_id, 'char_runtime_001');
  assert.deepEqual(result.entry, {
    character_id: 'char_runtime_001',
    display_name: '鸢儿',
    aliases: [],
  });
  assert.equal(hasCharacterId(result.registry, 'char_runtime_001'), true);
  assert.equal(hasCharacterId(result.registry, '鸢儿'), false);
  assert.deepEqual(registry, createEmptyCharacterRegistry());
});

test('existing identity requires registry membership and unresolved never creates an ID', () => {
  const registry = registryWith({
    character_id: 'char_001',
    display_name: '沈祁鸢',
    aliases: ['鸢儿'],
  });
  const existing = resolveRawParticipantIdentity(registry, {
    identity_status: 'existing',
    character_id: 'char_001',
    mention_id: 'mention-1',
  });
  assert.equal(existing.ok, true);
  assert.equal(existing.character_id, 'char_001');

  const unknown = resolveRawParticipantIdentity(registry, {
    identity_status: 'existing',
    character_id: 'shen_qi_yuan',
    mention_id: 'mention-2',
  });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.character_id, null);
  assert.equal(unknown.error_code, 'unknown_existing_character_id');
  assert.deepEqual(unknown.registry, registry);

  const unresolved = resolveRawParticipantIdentity(registry, {
    identity_status: 'unresolved',
    character_id: null,
    mention_id: 'mention-3',
    display_name: '不确定的人',
  });
  assert.equal(unresolved.ok, false);
  assert.equal(unresolved.character_id, null);
  assert.deepEqual(unresolved.registry, registry);

  const missingStatus = resolveRawParticipantIdentity(registry, {
    character_id: 'char_001',
    mention_id: 'legacy-shaped-without-status',
  });
  assert.equal(missingStatus.ok, false);
  assert.equal(missingStatus.error_code, 'identity_status_required');
  assert.equal(
    resolveRawParticipantIdentity(
      registry,
      { character_id: 'char_001' },
      { allowLegacy: true },
    ).ok,
    true,
  );
});

test('mention resolution is separate from alias discovery and persistence', () => {
  const registry = registryWith({
    character_id: 'char_001',
    display_name: '沈祁鸢',
    aliases: [],
  });
  const continuity = resolveMentionIdentity({
    registry,
    mention: '鸢儿',
    contextual_character_id: 'char_001',
    context_evidence: [
      { kind: 'narrative_continuity', text: '前句已经指向同一人物' },
    ],
  });
  assert.equal(continuity.ok, true);
  assert.equal(continuity.character_id, 'char_001');
  assert.equal(
    discoverAliasCandidate(undefined, [
      { kind: 'narrative_continuity', text: '鸢儿随后起身' },
    ]),
    null,
  );

  const rawMention = resolveRawParticipantIdentity(registry, {
    identity_status: 'existing',
    character_id: 'char_001',
    mention_id: 'mention-continuity',
    display_name: '鸢儿',
  });
  assert.equal(rawMention.ok, true);
  assert.equal(rawMention.alias_candidate, null);
  assert.deepEqual(rawMention.registry.entities.char_001.aliases, []);

  const candidate = discoverAliasCandidate(explicitAlias(), undefined);
  assert.deepEqual(candidate?.value, '鸢儿');
  const persisted = persistAliasCandidate(registry, 'char_001', candidate);
  assert.equal(persisted.accepted, true);
  assert.deepEqual(persisted.registry.entities.char_001.aliases, ['鸢儿']);
  assert.deepEqual(registry.entities.char_001.aliases, []);
});

test('high confidence without establishment evidence and contextual references are rejected', () => {
  for (const value of ['姐姐', '那个女孩', '她']) {
    assert.equal(
      discoverAliasCandidate({ value, kind: 'nickname', confidence: 1 }, [
        { kind: 'narrative', text: `${value}出现` },
      ]),
      null,
    );
  }
  assert.equal(
    discoverAliasCandidate({ value: '鸢儿', kind: 'nickname', confidence: 1 }, [
      { kind: 'narrative', text: '连续性推断' },
    ]),
    null,
  );

  const registry = registryWith({
    character_id: 'char_001',
    display_name: '沈祁鸢',
    aliases: [],
  });
  const rejected = persistAliasCandidate(registry, 'char_001', {
    value: '鸢儿',
    kind: 'nickname',
    confidence: 1,
  });
  assert.equal(rejected.accepted, false);
  assert.deepEqual(rejected.registry, registry);
});

test('alias establishment accepts only stable name kinds and allows alias collisions', () => {
  const first = registryWith({
    character_id: 'char_001',
    display_name: '沈祁鸢',
    aliases: [],
  });
  const firstAccepted = persistAliasCandidate(
    first,
    'char_001',
    explicitAlias('晚晚'),
  );
  const secondAccepted = persistAliasCandidate(
    firstAccepted.registry,
    'char_002',
    explicitAlias('晚晚'),
  );
  assert.equal(secondAccepted.accepted, false);

  const withSecond = registryWith(
    { character_id: 'char_001', display_name: '甲', aliases: ['晚晚'] },
    { character_id: 'char_002', display_name: '乙', aliases: ['晚晚'] },
  );
  assert.deepEqual(collectExactCharacterCandidateIds(withSecond, '晚晚'), [
    'char_001',
    'char_002',
  ]);
  assert.equal(
    resolveMentionIdentity({ registry: withSecond, mention: '晚晚' }).reason,
    'ambiguous_exact_match',
  );
  assert.deepEqual(
    [
      ...collectExactCharacterCandidates(
        normalizeCharacterRegistry({
          entities: {
            char_002: withSecond.entities.char_002,
            char_001: withSecond.entities.char_001,
          },
        }),
        '晚晚',
      ),
    ],
    ['char_001', 'char_002'],
  );

  const explicit = persistAliasCandidate(
    first,
    'char_001',
    explicitAlias('晚晚', 'name_variant'),
  );
  assert.equal(explicit.accepted, true);
  assert.equal(explicit.registry.entities.char_001.aliases[0], '晚晚');
});

test('new identity re-checks display and alias collisions before registration', () => {
  const registry = registryWith(
    { character_id: 'char_001', display_name: '甲', aliases: ['晚晚'] },
    { character_id: 'char_002', display_name: '乙', aliases: ['晚晚'] },
  );
  const ambiguous = registerNewCharacter(
    registry,
    { display_name: '晚晚' },
    { idFactory: () => 'char_new' },
  );
  assert.equal(ambiguous.ok, false);
  assert.equal(ambiguous.error_code, 'identity_unresolved');
  assert.deepEqual(ambiguous.registry, registry);

  const cautious = registerNewCharacter(
    registry,
    { display_name: '甲' },
    { idFactory: () => 'char_new' },
  );
  assert.equal(cautious.ok, false);
  assert.equal(cautious.error_code, 'identity_unresolved');
  assert.deepEqual(cautious.candidate_ids, ['char_001']);

  const distinct = registerNewCharacter(
    registry,
    {
      display_name: '甲',
      identity_evidence: [
        { kind: 'explicit_new_entity', text: '另一个人物也叫甲。' },
      ],
    },
    { idFactory: () => 'char_new_distinct' },
  );
  assert.equal(distinct.ok, true);
  assert.equal(distinct.identity_status, 'new');
  assert.equal(distinct.character_id, 'char_new_distinct');
  assert.equal(hasCharacterId(distinct.registry, 'char_new_distinct'), true);

  const sameName = resolveRawParticipantIdentities(
    [
      {
        identity_status: 'new',
        character_id: null,
        mention_id: 'same-name-a',
        display_name: '张伟',
      },
      {
        identity_status: 'new',
        character_id: null,
        mention_id: 'same-name-b',
        display_name: '张伟',
      },
    ],
    createEmptyCharacterRegistry(),
    {
      idFactory: (() => {
        const ids = ['char_same_name_a', 'char_same_name_b'];
        return () => ids.shift();
      })(),
    },
  );
  assert.equal(sameName.ok, true);
  assert.deepEqual(
    sameName.participants.map((item) => item.character_id),
    ['char_same_name_a', 'char_same_name_b'],
  );
  assert.deepEqual(Object.keys(sameName.registry.entities).sort(), [
    'char_same_name_a',
    'char_same_name_b',
  ]);
});

test('ambiguous exact alias matches require contextual evidence for an existing ID', () => {
  const registry = registryWith(
    { character_id: 'char_001', display_name: '甲', aliases: ['晚晚'] },
    { character_id: 'char_002', display_name: '乙', aliases: ['晚晚'] },
  );
  const unresolved = resolveRawParticipantIdentity(registry, {
    identity_status: 'existing',
    character_id: 'char_001',
    mention_id: 'ambiguous-mention',
    display_name: '晚晚',
  });
  assert.equal(unresolved.ok, false);
  assert.equal(unresolved.error_code, 'identity_unresolved');
  assert.deepEqual(unresolved.candidate_ids, ['char_001', 'char_002']);

  const resolved = resolveRawParticipantIdentity(registry, {
    identity_status: 'existing',
    character_id: 'char_001',
    mention_id: 'ambiguous-mention',
    display_name: '晚晚',
    identity_evidence: [
      { kind: 'narrative_context', text: '本楼明确说明晚晚来自甲的房间。' },
    ],
  });
  assert.equal(resolved.ok, true);
  assert.equal(resolved.character_id, 'char_001');
});

test('canonicalization deduplicates only after resolution and rejects raw handle conflicts atomically', () => {
  const registry = registryWith({
    character_id: 'char_001',
    display_name: '甲',
    aliases: [],
  });
  const resolved = resolveRawParticipantIdentities(
    [
      {
        identity_status: 'existing',
        character_id: 'char_001',
        mention_id: 'm1',
        display_name: '甲',
      },
      {
        identity_status: 'existing',
        character_id: 'char_001',
        mention_id: 'm2',
        display_name: '甲',
      },
    ],
    registry,
  );
  assert.equal(resolved.ok, true);
  assert.equal(resolved.participants.length, 1);
  assert.equal(resolved.participants[0].character_id, 'char_001');
  assert.equal('mention_id' in resolved.participants[0], false);

  const conflict = resolveRawParticipantIdentities(
    [
      {
        identity_status: 'existing',
        character_id: 'char_001',
        mention_id: 'same-handle',
      },
      {
        identity_status: 'new',
        character_id: null,
        mention_id: 'same-handle',
        display_name: '乙',
      },
    ],
    registry,
    { idFactory: () => 'char_002' },
  );
  assert.equal(conflict.ok, false);
  assert.equal(conflict.errors[0].error_code, 'raw_identity_conflict');
  assert.deepEqual(conflict.registry, registry);
  assert.equal(hasCharacterId(conflict.registry, 'char_002'), false);
});

test('event identity resolution converts provisional references before domain validation', () => {
  const raw = {
    schema_version: 1,
    events: [
      {
        type: 'sexual_activity',
        participants: [
          {
            identity_status: 'new',
            character_id: null,
            mention_id: 'subject',
            display_name: '鸢儿',
          },
          {
            identity_status: 'existing',
            character_id: 'char_source',
            mention_id: 'source',
            display_name: '甲',
          },
        ],
        pregnancy_relevance: {
          gestational_subject_ids: ['subject'],
          counterpart_ids: ['source'],
        },
        location: '传灯院',
      },
    ],
  };
  const registry = registryWith({
    character_id: 'char_source',
    display_name: '甲',
    aliases: [],
  });
  const result = resolveEventAnalysisIdentities(raw, {
    registry,
    narrative: '沈祁鸢坐在传灯院。',
    idFactory: () => 'char_runtime_subject',
  });
  assert.equal(result.ok, true);
  assert.deepEqual(
    result.events[0].pregnancy_relevance.gestational_subject_ids,
    ['char_runtime_subject'],
  );
  assert.deepEqual(result.events[0].pregnancy_relevance.counterpart_ids, [
    'char_source',
  ]);
  assert.equal(result.events[0].location, '传灯院');
  assert.equal(
    result.events[0].participants[0].character_id,
    'char_runtime_subject',
  );
  assert.equal(hasCharacterId(result.registry, 'char_runtime_subject'), true);
  assert.deepEqual(result.character_registry, result.registry);
  assert.deepEqual(result.alias_candidates, []);
  assert.equal(raw.events[0].participants[0].character_id, null);
});

test('rename keeps one canonical ID and preserves the old stable display form as an alias', () => {
  const registry = registryWith({
    character_id: 'char_001',
    display_name: '鸢儿',
    aliases: [],
  });
  const renamed = renameCharacter(registry, 'char_001', '沈祁鸢');
  assert.equal(renamed.ok, true);
  assert.deepEqual(renamed.registry.entities, {
    char_001: {
      character_id: 'char_001',
      display_name: '沈祁鸢',
      aliases: ['鸢儿'],
    },
  });
  assert.equal(Object.keys(renamed.registry.entities).length, 1);
  assert.deepEqual(
    collectExactCharacterCandidateIds(renamed.registry, '鸢儿'),
    ['char_001'],
  );
  assert.equal(hasCharacterId(renamed.registry, 'char_001'), true);

  const revealed = resolveRawParticipantIdentity(
    registryWith({
      character_id: 'char_002',
      display_name: '小七',
      aliases: [],
    }),
    {
      identity_status: 'existing',
      character_id: 'char_002',
      mention_id: 'real-name-reveal',
      display_name: '苏晚',
      identity_evidence: [
        { kind: 'explicit_name_revelation', text: '小七真正的名字叫苏晚。' },
      ],
    },
  );
  assert.equal(revealed.ok, true);
  assert.deepEqual(revealed.registry.entities.char_002, {
    character_id: 'char_002',
    display_name: '苏晚',
    aliases: ['小七'],
  });
});

test('legacy bootstrap preserves old IDs and never merges same-name or same-alias entries', () => {
  const legacyEvents = [
    {
      participants: [
        { character_id: 'legacy-a', display_name: '同名', aliases: ['晚晚'] },
        { character_id: 'legacy-b', display_name: '同名', aliases: ['晚晚'] },
      ],
    },
  ];
  const bootstrapped = bootstrapCharacterRegistryFromLegacy({
    events: legacyEvents,
    character_profiles: {
      'legacy-c': {
        character_id: 'legacy-c',
        display_name: '同名',
        aliases: ['晚晚'],
      },
    },
  });

  assert.deepEqual(Object.keys(bootstrapped.entities).sort(), [
    'legacy-a',
    'legacy-b',
    'legacy-c',
  ]);
  assert.deepEqual(collectExactCharacterCandidateIds(bootstrapped, '同名'), [
    'legacy-a',
    'legacy-b',
    'legacy-c',
  ]);
  assert.deepEqual(collectExactCharacterCandidateIds(bootstrapped, '晚晚'), [
    'legacy-a',
    'legacy-b',
    'legacy-c',
  ]);
  assert.equal(hasCharacterId(bootstrapped, 'legacy-a'), true);
  assert.equal(hasCharacterId(bootstrapped, '同名'), false);
});

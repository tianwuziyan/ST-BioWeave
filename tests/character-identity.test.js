import test from 'node:test';
import assert from 'node:assert/strict';
import {
  IDENTITY_ERROR_CODES,
  collectExactCharacterCandidateIds,
  collectExactCharacterCandidates,
  createEmptyCharacterRegistry,
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

const NAMES = Object.freeze({
  subject: '雾棱',
  source: '弦禾',
  alias: '砾芽',
  second: '星砾',
  renamed: '澄环',
  nickname: '岚屿',
  ambiguous: '折光',
});

function registryWith(...entries) {
  return normalizeCharacterRegistry({
    schema_version: 1,
    entities: Object.fromEntries(
      entries.map((entry) => [entry.character_id, entry]),
    ),
  });
}

function participant({
  status = 'new',
  characterId = null,
  mentionId,
  displayName,
  ...rest
}) {
  const value = {
    identity_status: status,
    character_id: characterId,
    display_name: displayName,
    ...rest,
  };
  if (mentionId !== undefined) value.mention_id = mentionId;
  return value;
}

function explicitAlias(value = NAMES.nickname, kind = 'nickname') {
  return {
    value,
    kind,
    confidence: 0.99,
    identity_evidence: [{ kind: 'explicit_alias', text: `以后叫我${value}` }],
  };
}

function identityEvent(participants, subjects = [], counterparts = []) {
  return {
    type: 'sexual_activity',
    participants,
    pregnancy_relevance: {
      gestational_subject_ids: subjects,
      counterpart_ids: counterparts,
    },
  };
}

test('registry entries remain keyed by canonical IDs and clone without shared state', () => {
  const raw = registryWith({
    character_id: 'char_000001',
    display_name: NAMES.subject,
    aliases: [NAMES.alias, NAMES.alias],
  });
  const clone = normalizeCharacterRegistry(raw);

  assert.deepEqual(clone.entities, {
    char_000001: {
      character_id: 'char_000001',
      display_name: NAMES.subject,
      aliases: [NAMES.alias],
    },
  });
  clone.entities.char_000001.aliases.push(NAMES.nickname);
  assert.deepEqual(raw.entities.char_000001.aliases, [NAMES.alias]);
  assert.equal(hasCharacterId(clone, 'char_000001'), true);
  assert.equal(hasCharacterId(clone, NAMES.subject), false);
});

test('exact display and alias lookup returns every candidate without merging names', () => {
  const registry = registryWith(
    { character_id: 'char_000001', display_name: NAMES.ambiguous, aliases: [NAMES.alias] },
    { character_id: 'char_000002', display_name: NAMES.ambiguous, aliases: [NAMES.alias] },
    { character_id: 'char_000003', display_name: NAMES.second, aliases: [NAMES.ambiguous] },
  );

  assert.deepEqual(
    [...collectExactCharacterCandidates(registry, NAMES.alias)],
    ['char_000001', 'char_000002'],
  );
  assert.deepEqual(collectExactCharacterCandidateIds(registry, NAMES.ambiguous), [
    'char_000001',
    'char_000002',
    'char_000003',
  ]);
  assert.equal(
    resolveMentionIdentity({ registry, mention: NAMES.alias }).ok,
    false,
  );
});

test('same-sounding original names remain separate canonical entities', () => {
  const registry = registryWith(
    { character_id: 'char_000001', display_name: '雾棱', aliases: [] },
    { character_id: 'char_000002', display_name: '雾棱', aliases: [] },
  );

  assert.deepEqual(collectExactCharacterCandidateIds(registry, '雾棱'), [
    'char_000001',
    'char_000002',
  ]);
  assert.deepEqual(Object.keys(registry.entities).sort(), [
    'char_000001',
    'char_000002',
  ]);
});

test('sequential allocation uses max plus one, preserves sparse gaps, and ignores injected factories', () => {
  let idFactoryCalled = false;
  const first = registerNewCharacter(
    createEmptyCharacterRegistry(),
    { display_name: NAMES.subject, mention_id: 'mention-1' },
    {
      idFactory: () => {
        idFactoryCalled = true;
        return 'char_runtime_001';
      },
    },
  );
  assert.equal(first.ok, true);
  assert.equal(first.character_id, 'char_000001');
  assert.equal(idFactoryCalled, false);

  const sparse = registryWith(
    { character_id: 'char_000001', display_name: '甲棱', aliases: [] },
    { character_id: 'char_000003', display_name: '乙棱', aliases: [] },
    { character_id: 'char_000007', display_name: '丙棱', aliases: [] },
    { character_id: 'char_runtime_001', display_name: '旧形', aliases: [] },
  );
  const next = registerNewCharacter(sparse, {
    display_name: NAMES.source,
    mention_id: 'mention-2',
  });
  assert.equal(next.ok, true);
  assert.equal(next.character_id, 'char_000008');

  const rawRegistry = {
    entities: {
      char_000002: {
        character_id: 'char_000002',
        display_name: '丁棱',
        aliases: [],
      },
      malformed_key: {
        character_id: 'char_000009',
        display_name: '戊棱',
        aliases: [],
      },
    },
  };
  const rawNext = registerNewCharacter(rawRegistry, {
    display_name: NAMES.second,
    mention_id: 'mention-3',
  });
  assert.equal(rawNext.ok, true);
  assert.equal(rawNext.character_id, 'char_000003');
});

test('sequential allocation accepts the maximum ID once and then fails closed at exhaustion', () => {
  const almostFull = registryWith({
    character_id: 'char_999998',
    display_name: NAMES.subject,
    aliases: [],
  });
  const last = registerNewCharacter(almostFull, {
    display_name: NAMES.source,
    mention_id: 'mention-4',
  });
  assert.equal(last.ok, true);
  assert.equal(last.character_id, 'char_999999');

  const exhausted = registerNewCharacter(last.registry, {
    display_name: NAMES.second,
    mention_id: 'mention-5',
  });
  assert.equal(exhausted.ok, false);
  assert.equal(
    exhausted.error_code,
    IDENTITY_ERROR_CODES.CHARACTER_ID_SEQUENCE_EXHAUSTED,
  );
  assert.deepEqual(exhausted.registry, last.registry);
});

test('new identity rejects every supplied provisional ID and never accepts idFactory output', () => {
  const registry = createEmptyCharacterRegistry();
  const missingMention = registerNewCharacter(registry, {
    display_name: NAMES.subject,
  });
  assert.equal(missingMention.ok, false);
  assert.equal(
    missingMention.error_code,
    IDENTITY_ERROR_CODES.MENTION_ID_REQUIRED,
  );
  assert.deepEqual(missingMention.registry, registry);

  const injected = registerNewCharacter(registry, {
    character_id: 'char_runtime_001',
    display_name: NAMES.subject,
    mention_id: 'provisional-mention',
  });
  assert.equal(injected.ok, false);
  assert.equal(
    injected.error_code,
    IDENTITY_ERROR_CODES.PROVISIONAL_ID_NOT_ALLOWED,
  );
  assert.deepEqual(injected.registry, registry);

  const resolved = resolveRawParticipantIdentity(registry, {
    identity_status: 'new',
    character_id: 'char_000321',
    mention_id: 'provisional-mention',
    display_name: NAMES.subject,
  });
  assert.equal(resolved.ok, false);
  assert.equal(
    resolved.error_code,
    IDENTITY_ERROR_CODES.PROVISIONAL_ID_NOT_ALLOWED,
  );
  assert.deepEqual(resolved.registry, registry);
});

test('existing identity uses exact unique display or alias fallback and rejects zero or ambiguous candidates', () => {
  const registry = registryWith(
    {
      character_id: 'char_000004',
      display_name: NAMES.subject,
      aliases: [NAMES.alias],
    },
    {
      character_id: 'char_000005',
      display_name: '折线',
      aliases: [NAMES.ambiguous],
    },
    {
      character_id: 'char_000006',
      display_name: '环线',
      aliases: [NAMES.ambiguous],
    },
  );

  const exactDisplay = resolveRawParticipantIdentity(registry, {
    identity_status: 'existing',
    character_id: NAMES.subject,
    display_name: NAMES.subject,
    mention_id: 'display-fallback',
  });
  assert.equal(exactDisplay.ok, true);
  assert.equal(exactDisplay.character_id, 'char_000004');
  assert.equal(exactDisplay.resolution, 'exact_unique_display_fallback');
  assert.equal(hasCharacterId(exactDisplay.registry, NAMES.subject), false);

  const idOnlyName = resolveRawParticipantIdentity(registry, {
    identity_status: 'existing',
    character_id: NAMES.subject,
  });
  assert.equal(idOnlyName.ok, false);
  assert.equal(
    idOnlyName.error_code,
    IDENTITY_ERROR_CODES.UNKNOWN_EXISTING_CHARACTER_ID,
  );

  const exactAlias = resolveRawParticipantIdentity(registry, {
    identity_status: 'existing',
    character_id: 'name-shaped-id',
    display_name: NAMES.alias,
    mention_id: 'alias-fallback',
  });
  assert.equal(exactAlias.ok, true);
  assert.equal(exactAlias.character_id, 'char_000004');

  const suppliedAlias = resolveRawParticipantIdentity(registry, {
    identity_status: 'existing',
    character_id: 'another-shaped-id',
    alias: NAMES.alias,
    identity_evidence: [
      { kind: 'explicit_alias', text: `称呼是${NAMES.alias}` },
    ],
  });
  assert.equal(suppliedAlias.ok, true);
  assert.equal(suppliedAlias.character_id, 'char_000004');

  const missing = resolveRawParticipantIdentity(registry, {
    identity_status: 'existing',
    character_id: 'unknown-shaped-id',
    display_name: '无此实体',
  });
  assert.equal(missing.ok, false);
  assert.equal(
    missing.error_code,
    IDENTITY_ERROR_CODES.UNKNOWN_EXISTING_CHARACTER_ID,
  );

  const ambiguous = resolveRawParticipantIdentity(registry, {
    identity_status: 'existing',
    character_id: 'ambiguous-shaped-id',
    display_name: NAMES.ambiguous,
  });
  assert.equal(ambiguous.ok, false);
  assert.equal(ambiguous.error_code, IDENTITY_ERROR_CODES.IDENTITY_UNRESOLVED);
  assert.deepEqual(ambiguous.candidate_ids, ['char_000005', 'char_000006']);
  assert.deepEqual(ambiguous.registry, registry);

  const noLegacyStatus = resolveRawParticipantIdentity(registry, {
    character_id: 'char_000004',
  });
  assert.equal(noLegacyStatus.ok, false);
  assert.equal(
    noLegacyStatus.error_code,
    IDENTITY_ERROR_CODES.IDENTITY_STATUS_REQUIRED,
  );
});

test('new identity re-checks exact collisions and only explicit distinct evidence permits a same-name entity', () => {
  const registry = registryWith({
    character_id: 'char_000001',
    display_name: NAMES.subject,
    aliases: [NAMES.alias],
  });
  const cautious = registerNewCharacter(registry, {
    display_name: NAMES.subject,
    mention_id: 'mention-6',
  });
  assert.equal(cautious.ok, false);
  assert.equal(cautious.error_code, IDENTITY_ERROR_CODES.IDENTITY_UNRESOLVED);
  assert.deepEqual(cautious.candidate_ids, ['char_000001']);

  const distinct = registerNewCharacter(registry, {
    display_name: NAMES.subject,
    mention_id: 'mention-7',
    identity_evidence: [
      { kind: 'explicit_new_entity', text: `另一个人物也叫${NAMES.subject}` },
    ],
  });
  assert.equal(distinct.ok, true);
  assert.equal(distinct.character_id, 'char_000002');
  assert.equal(hasCharacterId(distinct.registry, 'char_000002'), true);
});

test('mention resolution stays separate from alias discovery, persistence, and rename', () => {
  const registry = registryWith({
    character_id: 'char_000001',
    display_name: NAMES.subject,
    aliases: [],
  });
  const continuity = resolveMentionIdentity({
    registry,
    mention: NAMES.alias,
    contextual_character_id: 'char_000001',
    context_evidence: [{ kind: 'narrative_continuity', text: '前句指向同一实体' }],
  });
  assert.equal(continuity.ok, true);
  assert.equal(continuity.character_id, 'char_000001');
  assert.equal(
    discoverAliasCandidate({ value: NAMES.alias, kind: 'nickname' }, [
      { kind: 'narrative_continuity', text: '普通称呼' },
    ]),
    null,
  );

  const candidate = discoverAliasCandidate(explicitAlias(), undefined);
  assert.deepEqual(candidate?.value, NAMES.nickname);
  const persisted = persistAliasCandidate(registry, 'char_000001', candidate);
  assert.equal(persisted.accepted, true);
  assert.deepEqual(persisted.registry.entities.char_000001.aliases, [NAMES.nickname]);
  assert.deepEqual(registry.entities.char_000001.aliases, []);

  const renamed = renameCharacter(
    persisted.registry,
    'char_000001',
    NAMES.renamed,
  );
  assert.equal(renamed.ok, true);
  assert.deepEqual(renamed.registry.entities.char_000001, {
    character_id: 'char_000001',
    display_name: NAMES.renamed,
    aliases: [NAMES.nickname, NAMES.subject],
  });
});

test('different response-local mentions allocate independently without same-name auto-merge', () => {
  const distinct = resolveRawParticipantIdentities(
    [
      participant({ mentionId: 'mention-a', displayName: NAMES.subject }),
      participant({ mentionId: 'mention-b', displayName: NAMES.second }),
    ],
    createEmptyCharacterRegistry(),
  );
  assert.equal(distinct.ok, true);
  assert.deepEqual(
    distinct.participants.map((item) => item.character_id),
    ['char_000001', 'char_000002'],
  );

  const sameName = resolveRawParticipantIdentities(
    [
      participant({ mentionId: 'same-name-a', displayName: NAMES.subject }),
      participant({ mentionId: 'same-name-b', displayName: NAMES.subject }),
    ],
    createEmptyCharacterRegistry(),
  );
  assert.equal(sameName.ok, true);
  assert.deepEqual(
    sameName.participants.map((item) => item.character_id),
    ['char_000001', 'char_000002'],
  );
  assert.deepEqual(Object.keys(sameName.registry.entities).sort(), [
    'char_000001',
    'char_000002',
  ]);
});

test('raw participant conflicts remain atomic after canonical deduplication checks', () => {
  const registry = registryWith(
    { character_id: 'char_000001', display_name: NAMES.subject, aliases: [] },
    { character_id: 'char_000002', display_name: NAMES.source, aliases: [] },
  );
  const duplicateCanonical = resolveRawParticipantIdentities(
    [
      participant({
        status: 'existing',
        characterId: 'char_000001',
        mentionId: 'same-canonical-a',
        displayName: NAMES.subject,
      }),
      participant({
        status: 'existing',
        characterId: 'char_000001',
        mentionId: 'same-canonical-b',
        displayName: NAMES.subject,
      }),
    ],
    registry,
  );
  assert.equal(duplicateCanonical.ok, true);
  assert.equal(duplicateCanonical.participants.length, 1);

  const conflict = resolveRawParticipantIdentities(
    [
      participant({
        status: 'existing',
        characterId: 'char_000001',
        mentionId: 'same-handle',
        displayName: NAMES.subject,
      }),
      participant({
        status: 'existing',
        characterId: 'char_000002',
        mentionId: 'same-handle',
        displayName: NAMES.source,
      }),
    ],
    registry,
  );
  assert.equal(conflict.ok, false);
  assert.equal(
    conflict.errors[0].error_code,
    IDENTITY_ERROR_CODES.RAW_IDENTITY_CONFLICT,
  );
  assert.deepEqual(conflict.registry, registry);
});

test('one response shares mention IDs across Events and remaps same-event and cross-event pregnancy references', () => {
  const raw = {
    schema_version: 1,
    events: [
      identityEvent(
        [
          participant({ mentionId: 'subject', displayName: NAMES.subject }),
          participant({ mentionId: 'source', displayName: NAMES.source }),
        ],
        ['subject'],
        ['source'],
      ),
      identityEvent(
        [
          participant({ mentionId: 'subject', displayName: NAMES.subject }),
          participant({ mentionId: 'source', displayName: NAMES.source }),
        ],
        ['subject'],
        ['source'],
      ),
      identityEvent([], ['subject'], ['source']),
    ],
  };
  const result = resolveEventAnalysisIdentities(raw, {
    registry: createEmptyCharacterRegistry(),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(Object.keys(result.registry.entities).sort(), [
    'char_000001',
    'char_000002',
  ]);
  assert.equal(result.mention_to_canonical.get('subject'), 'char_000001');
  assert.equal(result.mention_to_canonical.get('source'), 'char_000002');
  for (const event of result.events) {
    assert.deepEqual(
      event.pregnancy_relevance.gestational_subject_ids,
      ['char_000001'],
    );
    assert.deepEqual(event.pregnancy_relevance.counterpart_ids, ['char_000002']);
  }
  for (const event of result.events.slice(0, 2)) {
    assert.deepEqual(
      event.participants.map((item) => item.character_id),
      ['char_000001', 'char_000002'],
    );
    assert.equal('mention_id' in event.participants[0], false);
    assert.equal('identity_status' in event.participants[0], false);
  }
  assert.deepEqual(result.character_registry, result.registry);
  assert.equal(raw.events[0].participants[0].character_id, null);
});

test('the same mention with conflicting identity data fails the complete Event response atomically', () => {
  const raw = {
    events: [
      identityEvent([
        participant({ mentionId: 'shared', displayName: NAMES.subject }),
      ]),
      identityEvent([
        participant({ mentionId: 'shared', displayName: NAMES.second }),
      ]),
    ],
  };
  const registry = createEmptyCharacterRegistry();
  const result = resolveEventAnalysisIdentities(raw, { registry });

  assert.equal(result.ok, false);
  assert.equal(
    result.errors[0].error_code,
    IDENTITY_ERROR_CODES.RAW_IDENTITY_CONFLICT,
  );
  assert.deepEqual(result.registry, registry);
  assert.deepEqual(result.character_registry, registry);
  assert.deepEqual(result.events, []);
});

test('a later unresolved Event discards earlier registrations and references atomically', () => {
  const raw = {
    events: [
      identityEvent([
        participant({ mentionId: 'fresh', displayName: NAMES.subject }),
      ]),
      identityEvent([
        participant({
          status: 'existing',
          characterId: 'hallucinated-id',
          displayName: '无此实体',
          mentionId: 'hallucinated',
        }),
      ]),
    ],
  };
  const registry = createEmptyCharacterRegistry();
  const result = resolveEventAnalysisIdentities(raw, { registry });

  assert.equal(result.ok, false);
  assert.equal(
    result.errors[0].error_code,
    IDENTITY_ERROR_CODES.UNKNOWN_EXISTING_CHARACTER_ID,
  );
  assert.deepEqual(result.registry, registry);
  assert.deepEqual(result.character_registry, registry);
  assert.deepEqual(result.events, []);
  assert.equal(raw.events[0].participants[0].character_id, null);
});

test('cross-event references can resolve a mention from an earlier Event even when it is absent from the later participants', () => {
  const result = resolveEventAnalysisIdentities(
    {
      events: [
        identityEvent([
          participant({ mentionId: 'subject', displayName: NAMES.subject }),
          participant({ mentionId: 'source', displayName: NAMES.source }),
        ]),
        identityEvent([], ['subject'], ['source']),
      ],
    },
    { registry: createEmptyCharacterRegistry() },
  );

  assert.equal(result.ok, true);
  assert.deepEqual(
    result.events[1].pregnancy_relevance.gestational_subject_ids,
    ['char_000001'],
  );
  assert.deepEqual(result.events[1].pregnancy_relevance.counterpart_ids, [
    'char_000002',
  ]);
});

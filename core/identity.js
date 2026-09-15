export const CHARACTER_REGISTRY_SCHEMA_VERSION = 1;

export const IDENTITY_STATUSES = Object.freeze([
  'existing',
  'new',
  'unresolved',
]);

export const ALIAS_KINDS = Object.freeze(['name_variant', 'nickname']);

export const ALIAS_ESTABLISHMENT_EVIDENCE_KINDS = Object.freeze([
  'explicit_alias',
  'explicit_alias_establishment',
  'explicit_name_revelation',
  'explicit_name_variant',
  'explicit_nickname',
  'alias_establishment',
  'display_name_update',
  'name_revelation',
  'name_variant_establishment',
  'nickname_establishment',
]);

const DISPLAY_NAME_UPDATE_EVIDENCE_KINDS = new Set([
  'display_name_update',
  'explicit_name_revelation',
  'name_revelation',
]);

const DISTINCT_NEW_ENTITY_EVIDENCE_KINDS = new Set([
  'distinct_entity',
  'explicit_distinct_entity',
  'explicit_new_entity',
  'new_entity',
  'new_entity_establishment',
]);

export const IDENTITY_ERROR_CODES = Object.freeze({
  INVALID_IDENTITY_STATUS: 'invalid_identity_status',
  IDENTITY_STATUS_REQUIRED: 'identity_status_required',
  EXISTING_ID_REQUIRED: 'existing_character_id_required',
  UNKNOWN_EXISTING_CHARACTER_ID: 'unknown_existing_character_id',
  PROVISIONAL_ID_NOT_ALLOWED: 'provisional_character_id_not_allowed',
  IDENTITY_UNRESOLVED: 'identity_unresolved',
  DISPLAY_NAME_REQUIRED: 'display_name_required',
  DISPLAY_NAME_NOT_PERSISTABLE: 'display_name_not_persistable',
  CHARACTER_ID_COLLISION: 'character_id_collision',
  UNKNOWN_CHARACTER_ID: 'unknown_character_id',
  ALIAS_CANDIDATE_REJECTED: 'alias_candidate_rejected',
  RAW_IDENTITY_CONFLICT: 'raw_identity_conflict',
  INVALID_PARTICIPANT_COLLECTION: 'invalid_participant_collection',
  INVALID_REFERENCE_COLLECTION: 'invalid_reference_collection',
  UNKNOWN_REFERENCE: 'unknown_identity_reference',
});

const CONTEXTUAL_REFERENCE_VALUES = new Set([
  '我',
  '你',
  '他',
  '她',
  '它',
  '我们',
  '你们',
  '他们',
  '她们',
  '它们',
  '自己',
  '其',
  '此人',
  '彼此',
  '姐姐',
  '哥哥',
  '妹妹',
  '弟弟',
  '妈妈',
  '母亲',
  '爸爸',
  '父亲',
  '爷爷',
  '奶奶',
  '叔叔',
  '阿姨',
  '姑姑',
  '舅舅',
  '老师',
  '师父',
  '师兄',
  '师姐',
  '师弟',
  '师妹',
  '公主',
  '殿下',
  '陛下',
  '大人',
  '夫人',
  '小姐',
  '先生',
  '少爷',
  '老爷',
  '将军',
  '掌门',
  '前辈',
  '后辈',
  '主人',
  '客人',
  '朋友',
  '恋人',
  '丈夫',
  '妻子',
  '爱人',
  '同事',
  '队长',
  '医生',
  '护士',
  '老板',
  '店主',
  '女孩',
  '男孩',
  '女子',
  '男人',
  '女人',
  '少女',
  '少年',
  '孩子',
  '小孩',
  '人',
  '某人',
  '那个人',
  '这个人',
  '那个女孩',
  '这个女孩',
  '那个男孩',
  '这个男孩',
  '对方',
  '家伙',
  '来人',
  '身影',
  '人影',
  '陌生人',
  '一人',
  '一名女子',
  '一名男子',
  'i',
  'me',
  'you',
  'he',
  'she',
  'it',
  'we',
  'they',
  'them',
  'someone',
  'somebody',
  'the girl',
  'the boy',
  'the woman',
  'the man',
]);

const CONTEXTUAL_REFERENCE_PATTERN =
  /^(?:这|那|某|一名|一位|一个|该).*(?:人|女孩|男孩|女子|男子|男人|女人|孩子|家伙|身影|人影)$/;

let fallbackIdCounter = 0;

function hasOwn(value, key) {
  return Boolean(value && Object.prototype.hasOwnProperty.call(value, key));
}

function recordValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {};
}

function cloneValue(value) {
  if (Array.isArray(value)) return value.map((item) => cloneValue(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, cloneValue(item)]),
    );
  }
  return value;
}

function textValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function nullableText(value) {
  const text = textValue(value);
  return text || null;
}

function identifierValue(value) {
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function compareIds(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortedIds(ids) {
  return [...ids].sort(compareIds);
}

function setObjectValue(object, key, value) {
  Object.defineProperty(object, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

function normalizeConfidence(value) {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.min(1, parsed));
}

function normalizeEvidence(value) {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return values
    .map((item) => {
      if (typeof item === 'string') {
        const text = textValue(item);
        return text ? { kind: '', text } : null;
      }
      const source = recordValue(item);
      const kind = textValue(source.kind);
      const text = textValue(source.text ?? source.quote ?? source.content);
      if (!kind && !text) return null;
      return { ...cloneValue(source), kind, text };
    })
    .filter(Boolean);
}

function identityEvidenceFrom(source, options = {}) {
  if (Array.isArray(options)) return options;
  const optionSource = recordValue(options);
  if (hasOwn(optionSource, 'identity_evidence'))
    return optionSource.identity_evidence;
  if (hasOwn(optionSource, 'identityEvidence'))
    return optionSource.identityEvidence;
  if (hasOwn(optionSource, 'evidence')) return optionSource.evidence;
  return source.identity_evidence ?? source.identityEvidence ?? [];
}

function meaningfulContextEvidence(value) {
  if (value === true) return true;
  if (typeof value === 'string') return Boolean(textValue(value));
  if (Array.isArray(value))
    return value.some((item) => meaningfulContextEvidence(item));
  if (value && typeof value === 'object') {
    return Object.values(value).some((item) => meaningfulContextEvidence(item));
  }
  return false;
}

function normalizeAliases(value, displayName = null) {
  if (!Array.isArray(value)) return [];
  const aliases = [];
  const seen = new Set();
  for (const item of value) {
    const alias = textValue(item);
    if (
      !alias ||
      alias === displayName ||
      seen.has(alias) ||
      isContextualReferenceValue(alias)
    )
      continue;
    seen.add(alias);
    aliases.push(alias);
  }
  return aliases;
}

function rawEntityEntries(value) {
  if (Array.isArray(value)) {
    return value.map((item) => [
      identifierValue(recordValue(item).character_id),
      item,
    ]);
  }
  return Object.entries(recordValue(value));
}

function resolveContextualCharacterId(options = {}) {
  const source = recordValue(options);
  return identifierValue(
    source.contextual_character_id ??
      source.contextualCharacterId ??
      source.selected_character_id ??
      source.selectedCharacterId,
  );
}

function resolveContextEvidence(options = {}) {
  const source = recordValue(options);
  return (
    source.context_evidence ??
    source.contextEvidence ??
    source.selection_evidence ??
    source.selectionEvidence
  );
}

function shouldPersistAliases(options = {}) {
  const source = recordValue(options);
  return (
    source.persistAlias === true ||
    source.persistAliases === true ||
    source.persist_aliases === true
  );
}

function resolveCandidateChoice(candidateIds, options = {}) {
  const ids = sortedIds(candidateIds);
  if (ids.length === 1) return { character_id: ids[0], reason: 'exact_unique' };

  const contextualCharacterId = resolveContextualCharacterId(options);
  if (
    contextualCharacterId &&
    ids.includes(contextualCharacterId) &&
    meaningfulContextEvidence(resolveContextEvidence(options))
  ) {
    return {
      character_id: contextualCharacterId,
      reason: 'context_disambiguated',
    };
  }

  if (
    ids.length === 0 &&
    contextualCharacterId &&
    meaningfulContextEvidence(resolveContextEvidence(options))
  ) {
    return {
      character_id: contextualCharacterId,
      reason: 'contextual_resolution',
    };
  }

  return null;
}

function canonicalParticipant(source, characterId, entry) {
  const participant = cloneValue(source);
  delete participant.identity_status;
  delete participant.identityStatus;
  delete participant.mention_id;
  delete participant.mentionId;
  delete participant.alias_candidate;
  delete participant.aliasCandidate;
  delete participant.identity_evidence;
  delete participant.identityEvidence;
  participant.character_id = characterId;
  participant.display_name =
    entry.display_name ?? nullableText(source.display_name);
  return participant;
}

function resolutionFailure(
  registry,
  source,
  status,
  errorCode,
  candidateIds = [],
  extra = {},
) {
  const nextRegistry = cloneCharacterRegistry(registry);
  return {
    ok: false,
    resolved: false,
    identity_status: 'unresolved',
    source_identity_status: status,
    character_id: null,
    mention_id: textValue(source.mention_id ?? source.mentionId) || null,
    candidate_ids: sortedIds(candidateIds),
    candidates: sortedIds(candidateIds),
    entry: null,
    participant: null,
    registry: nextRegistry,
    character_registry: cloneValue(nextRegistry),
    error_code: errorCode,
    ...extra,
  };
}

function resolutionSuccess(
  registry,
  source,
  sourceStatus,
  characterId,
  entry,
  extra = {},
) {
  const aliasCandidate = discoverAliasCandidate(
    source.alias_candidate ?? source.aliasCandidate,
    identityEvidenceFrom(source),
    { entry },
  );
  const nextRegistry = cloneCharacterRegistry(registry);
  return {
    ok: true,
    resolved: true,
    identity_status: sourceStatus === 'new' ? 'new' : 'existing',
    source_identity_status: sourceStatus,
    character_id: characterId,
    mention_id: textValue(source.mention_id ?? source.mentionId) || null,
    candidate_ids: [characterId],
    candidates: [characterId],
    entry: cloneValue(entry),
    participant: canonicalParticipant(source, characterId, entry),
    alias_candidate: aliasCandidate,
    registry: nextRegistry,
    character_registry: cloneValue(nextRegistry),
    error_code: null,
    ...extra,
  };
}

function resultWithRegistry(base, fields = {}) {
  const registry = cloneCharacterRegistry(base);
  return { registry, character_registry: cloneValue(registry), ...fields };
}

/**
 * Create the additive registry shape. Ownership is supplied by the caller;
 * Floor-derived history is persisted in the Floor snapshot rather than here.
 * The registry remains independent from tracking_subjects, tracking_candidates,
 * and character_profiles.
 */
export function createEmptyCharacterRegistry() {
  return {
    schema_version: CHARACTER_REGISTRY_SCHEMA_VERSION,
    entities: {},
  };
}

/**
 * Normalize one registry entry. The registry key is authoritative for the
 * canonical ID; display names and aliases are never used as keys.
 */
export function normalizeCharacterEntry(raw = {}, characterId = null) {
  const source = recordValue(raw);
  const id = identifierValue(characterId ?? source.character_id);
  if (!id) return null;
  const displayName = nullableText(source.display_name);
  return {
    character_id: id,
    display_name: displayName,
    aliases: normalizeAliases(source.aliases, displayName),
  };
}

/**
 * Normalize an untrusted/legacy registry without mutating its input.
 * Historical IDs are retained as supplied; only their entry shape is cleaned.
 */
export function normalizeCharacterRegistry(raw = {}) {
  const source = recordValue(raw);
  const entities = {};
  for (const [key, value] of rawEntityEntries(source.entities)) {
    const id = identifierValue(key ?? recordValue(value).character_id);
    const entry = normalizeCharacterEntry(value, id);
    if (entry) setObjectValue(entities, entry.character_id, entry);
  }
  return {
    schema_version: CHARACTER_REGISTRY_SCHEMA_VERSION,
    entities,
  };
}

/** Return a deep clone of the normalized registry. */
export function cloneCharacterRegistry(registry = {}) {
  return cloneValue(normalizeCharacterRegistry(registry));
}

/** Return whether an exact canonical ID is a member of the registry. */
export function hasCharacterId(registry = {}, characterId) {
  const id = identifierValue(characterId);
  const normalized = normalizeCharacterRegistry(registry);
  return Boolean(id && hasOwn(normalized.entities, id));
}

export const registryHasCharacterId = hasCharacterId;

/** Return a cloned entry for an exact canonical ID, or null. */
export function getCharacterEntry(registry = {}, characterId) {
  const id = identifierValue(characterId);
  const normalized = normalizeCharacterRegistry(registry);
  if (!id || !hasOwn(normalized.entities, id)) return null;
  return cloneValue(normalized.entities[id]);
}

/**
 * Project registry entries for an Analyzer candidate block. The result is
 * deterministic by canonical ID and contains no tracking/profile data.
 */
export function projectCharacterRegistryCandidates(registry = {}) {
  const normalized = normalizeCharacterRegistry(registry);
  return sortedIds(Object.keys(normalized.entities)).map((id) =>
    cloneValue(normalized.entities[id]),
  );
}

export const projectCharacterCandidates = projectCharacterRegistryCandidates;

/**
 * Generate an opaque Runtime ID. A supplied/runtime crypto.randomUUID is
 * preferred. The fallback is random/time based and never reads a name.
 */
export function createOpaqueCharacterId(options = {}) {
  const source = recordValue(options);
  const cryptoSource = source.crypto ?? globalThis.crypto;
  const randomUUID = source.randomUUID ?? cryptoSource?.randomUUID;
  if (typeof randomUUID === 'function') {
    try {
      const token = textValue(randomUUID.call(cryptoSource));
      if (token) return token.startsWith('char_') ? token : `char_${token}`;
    } catch {
      // Fall through to the dependency-free opaque fallback.
    }
  }

  fallbackIdCounter += 1;
  const now = typeof source.now === 'function' ? source.now() : Date.now();
  const timePart = Number.isFinite(now) ? Math.floor(now).toString(36) : '0';
  const randomPart = Math.random().toString(36).slice(2, 10) || '0';
  return `char_${timePart}_${randomPart}_${fallbackIdCounter.toString(36)}`;
}

export const generateOpaqueCharacterId = createOpaqueCharacterId;

/**
 * Collect every entity whose display name or alias exactly matches value.
 * This intentionally returns a set rather than selecting the first entity.
 */
export function collectExactCharacterCandidates(registry = {}, value) {
  const needle = textValue(value);
  const normalized = normalizeCharacterRegistry(registry);
  const candidates = new Set();
  if (!needle) return candidates;

  for (const entry of Object.values(normalized.entities)) {
    if (entry.display_name === needle || entry.aliases.includes(needle)) {
      candidates.add(entry.character_id);
    }
  }
  return new Set(sortedIds(candidates));
}

export const collectExactCandidates = collectExactCharacterCandidates;

export function collectExactCharacterCandidateIds(registry = {}, value) {
  return sortedIds(collectExactCharacterCandidates(registry, value));
}

export const findCharacterCandidates = collectExactCharacterCandidateIds;

/** Return whether a value is a contextual reference, not a stable name. */
export function isContextualReferenceValue(value) {
  const normalized = textValue(value);
  if (!normalized) return false;
  const lower = normalized.toLowerCase();
  return (
    CONTEXTUAL_REFERENCE_VALUES.has(normalized) ||
    CONTEXTUAL_REFERENCE_VALUES.has(lower) ||
    CONTEXTUAL_REFERENCE_PATTERN.test(normalized)
  );
}

/**
 * Resolve a mention for current narrative use only. A unique exact match is
 * resolved; collisions require explicit contextual disambiguation. This
 * function never changes aliases or registry entries.
 */
export function resolveMentionIdentity({
  registry = {},
  mention,
  ...options
} = {}) {
  const normalized = normalizeCharacterRegistry(registry);
  const candidates = collectExactCharacterCandidateIds(normalized, mention);
  const choice = resolveCandidateChoice(candidates, options);
  if (!choice) {
    return {
      ok: false,
      resolved: false,
      status: 'unresolved',
      identity_status: 'unresolved',
      character_id: null,
      candidate_ids: candidates,
      candidates,
      reason:
        candidates.length > 1 ? 'ambiguous_exact_match' : 'no_reliable_match',
      registry: cloneCharacterRegistry(normalized),
    };
  }

  return {
    ok: true,
    resolved: true,
    status: 'resolved',
    identity_status: 'existing',
    character_id: choice.character_id,
    candidate_ids: candidates.length ? candidates : [choice.character_id],
    candidates: candidates.length ? candidates : [choice.character_id],
    reason: choice.reason,
    entry: getCharacterEntry(normalized, choice.character_id),
    registry: cloneCharacterRegistry(normalized),
  };
}

export const resolveMention = resolveMentionIdentity;

/**
 * Verify explicit, structured alias-establishment evidence. Continuity,
 * co-occurrence, confidence, or an ordinary mention alone do not qualify.
 */
export function hasExplicitAliasEstablishmentEvidence(value) {
  return normalizeEvidence(value).some(
    (item) =>
      ALIAS_ESTABLISHMENT_EVIDENCE_KINDS.includes(item.kind) &&
      Boolean(item.text),
  );
}

/**
 * A display-name change needs explicit revelation evidence. A participant
 * mention that happens to use a different display form is not enough to
 * mutate the registry.
 */
export function hasExplicitDisplayNameUpdateEvidence(value) {
  return normalizeEvidence(value).some(
    (item) =>
      DISPLAY_NAME_UPDATE_EVIDENCE_KINDS.has(item.kind) && Boolean(item.text),
  );
}

function hasExplicitDistinctNewEntityEvidence(value) {
  return normalizeEvidence(value).some(
    (item) =>
      DISTINCT_NEW_ENTITY_EVIDENCE_KINDS.has(item.kind) && Boolean(item.text),
  );
}

/**
 * Discover an alias candidate without persisting it. The candidate must be a
 * name variant/nickname with explicit establishment evidence and a stable,
 * non-contextual value.
 */
export function discoverAliasCandidate(
  rawCandidate,
  identityEvidence,
  options = {},
) {
  const source = recordValue(rawCandidate);
  const value = textValue(source.value ?? source.alias);
  const kind = textValue(source.kind);
  const evidence = normalizeEvidence(
    identityEvidence === undefined
      ? (source.identity_evidence ?? source.identityEvidence)
      : identityEvidence,
  );
  const optionSource = recordValue(options);
  const entry = recordValue(optionSource.entry);
  const displayName = nullableText(
    optionSource.display_name ?? optionSource.displayName ?? entry.display_name,
  );
  const existingAliases = Array.isArray(optionSource.existing_aliases)
    ? optionSource.existing_aliases
        .map((item) => textValue(item))
        .filter(Boolean)
    : Array.isArray(entry.aliases)
      ? entry.aliases
      : [];

  if (
    !value ||
    !ALIAS_KINDS.includes(kind) ||
    isContextualReferenceValue(value)
  )
    return null;
  if (value === displayName || existingAliases.includes(value)) return null;
  if (!hasExplicitAliasEstablishmentEvidence(evidence)) return null;

  return {
    value,
    kind,
    confidence: normalizeConfidence(source.confidence),
    identity_evidence: cloneValue(evidence),
  };
}

export const validateAliasCandidate = discoverAliasCandidate;

/**
 * Runtime-only alias persistence. The default is rejection-safe: callers
 * must invoke this operation explicitly after deciding to accept a candidate.
 */
export function persistAliasCandidate(
  registry = {},
  characterId,
  rawCandidate,
  options = {},
) {
  const base = normalizeCharacterRegistry(registry);
  const id = identifierValue(characterId);
  if (!id || !hasOwn(base.entities, id)) {
    return resultWithRegistry(base, {
      ok: false,
      accepted: false,
      character_id: id,
      alias: null,
      reason: IDENTITY_ERROR_CODES.UNKNOWN_CHARACTER_ID,
    });
  }

  const source = recordValue(rawCandidate);
  const candidate = discoverAliasCandidate(
    source,
    identityEvidenceFrom(source, options),
    { entry: base.entities[id] },
  );
  if (!candidate) {
    return resultWithRegistry(base, {
      ok: false,
      accepted: false,
      character_id: id,
      alias: null,
      reason: IDENTITY_ERROR_CODES.ALIAS_CANDIDATE_REJECTED,
    });
  }

  const next = cloneCharacterRegistry(base);
  next.entities[id].aliases = [...next.entities[id].aliases, candidate.value];
  return {
    ok: true,
    accepted: true,
    character_id: id,
    alias: candidate.value,
    candidate,
    reason: null,
    registry: next,
    character_registry: cloneValue(next),
  };
}

export const acceptAliasCandidate = persistAliasCandidate;

/**
 * Update one display name without changing the canonical ID. By default the
 * old stable display form is retained as an alias; no entity merge occurs.
 */
export function updateCharacterDisplayName(
  registry = {},
  characterId,
  displayName,
  options = {},
) {
  const base = normalizeCharacterRegistry(registry);
  const id = identifierValue(characterId);
  const nextName = nullableText(displayName);
  if (!id || !hasOwn(base.entities, id)) {
    return resultWithRegistry(base, {
      ok: false,
      character_id: id,
      display_name: null,
      previous_display_name: null,
      alias_added: false,
      reason: IDENTITY_ERROR_CODES.UNKNOWN_CHARACTER_ID,
    });
  }
  if (!nextName) {
    return resultWithRegistry(base, {
      ok: false,
      character_id: id,
      display_name: null,
      previous_display_name: base.entities[id].display_name,
      alias_added: false,
      reason: IDENTITY_ERROR_CODES.DISPLAY_NAME_REQUIRED,
    });
  }
  if (isContextualReferenceValue(nextName)) {
    return resultWithRegistry(base, {
      ok: false,
      character_id: id,
      display_name: null,
      previous_display_name: base.entities[id].display_name,
      alias_added: false,
      reason: IDENTITY_ERROR_CODES.DISPLAY_NAME_NOT_PERSISTABLE,
    });
  }

  const next = cloneCharacterRegistry(base);
  const entry = next.entities[id];
  const previousDisplayName = entry.display_name;
  const preservePreviousAsAlias =
    recordValue(options).preservePreviousAsAlias !== false;
  let aliasAdded = false;
  if (
    preservePreviousAsAlias &&
    previousDisplayName &&
    previousDisplayName !== nextName &&
    !entry.aliases.includes(previousDisplayName) &&
    !isContextualReferenceValue(previousDisplayName)
  ) {
    entry.aliases = [...entry.aliases, previousDisplayName];
    aliasAdded = true;
  }
  entry.display_name = nextName;
  return {
    ok: true,
    character_id: id,
    display_name: nextName,
    previous_display_name: previousDisplayName,
    alias_added: aliasAdded,
    reason: null,
    registry: next,
    character_registry: cloneValue(next),
  };
}

export const renameCharacter = updateCharacterDisplayName;

function generatedCharacterId(registry, options = {}) {
  const source = recordValue(options);
  const factory =
    typeof source.idFactory === 'function'
      ? source.idFactory
      : () => createOpaqueCharacterId(source);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const generated = identifierValue(factory());
    if (generated && !hasOwn(registry.entities, generated)) return generated;
  }
  return null;
}

function candidateIdsForNewCharacter(
  registry,
  displayName,
  aliasCandidate,
  options = {},
) {
  const candidates = new Set(
    collectExactCharacterCandidates(registry, displayName),
  );
  if (aliasCandidate) {
    for (const id of collectExactCharacterCandidates(
      registry,
      aliasCandidate.value,
    ))
      candidates.add(id);
  }
  const excluded = new Set(recordValue(options).excludeCharacterIds ?? []);
  return sortedIds([...candidates].filter((id) => !excluded.has(id)));
}

/**
 * Re-check a proposed new identity against the current registry, then either
 * reuse a reliably selected entity or register one opaque Runtime ID.
 */
export function registerNewCharacter(
  registry = {},
  rawParticipant = {},
  options = {},
) {
  const base = normalizeCharacterRegistry(registry);
  const source = recordValue(rawParticipant);
  const suppliedId = identifierValue(source.character_id);
  if (suppliedId) {
    return resultWithRegistry(base, {
      ok: false,
      resolved: false,
      identity_status: 'unresolved',
      character_id: null,
      entry: null,
      candidate_ids: [],
      error_code: IDENTITY_ERROR_CODES.PROVISIONAL_ID_NOT_ALLOWED,
    });
  }

  const displayName = nullableText(source.display_name);
  if (!displayName) {
    return resultWithRegistry(base, {
      ok: false,
      resolved: false,
      identity_status: 'unresolved',
      character_id: null,
      entry: null,
      candidate_ids: [],
      error_code: IDENTITY_ERROR_CODES.DISPLAY_NAME_REQUIRED,
    });
  }
  if (isContextualReferenceValue(displayName)) {
    return resultWithRegistry(base, {
      ok: false,
      resolved: false,
      identity_status: 'unresolved',
      character_id: null,
      entry: null,
      candidate_ids: [],
      error_code: IDENTITY_ERROR_CODES.DISPLAY_NAME_NOT_PERSISTABLE,
    });
  }

  const aliasCandidate = discoverAliasCandidate(
    source.alias_candidate ?? source.aliasCandidate,
    identityEvidenceFrom(source),
  );
  const candidateIds = candidateIdsForNewCharacter(
    base,
    displayName,
    aliasCandidate,
    options,
  );
  const choice = resolveCandidateChoice(candidateIds, options);
  const distinctNewEntity = hasExplicitDistinctNewEntityEvidence(
    identityEvidenceFrom(source),
  );
  const contextSelectedExisting =
    choice &&
    ['context_disambiguated', 'contextual_resolution'].includes(choice.reason);
  if (
    candidateIds.length > 0 &&
    (!choice || (!contextSelectedExisting && !distinctNewEntity))
  ) {
    return resultWithRegistry(base, {
      ok: false,
      resolved: false,
      identity_status: 'unresolved',
      character_id: null,
      entry: null,
      candidate_ids: candidateIds,
      error_code: IDENTITY_ERROR_CODES.IDENTITY_UNRESOLVED,
    });
  }

  if (choice && !distinctNewEntity) {
    let next = cloneCharacterRegistry(base);
    let aliasPersisted = false;
    if (shouldPersistAliases(options) && aliasCandidate) {
      const persisted = persistAliasCandidate(
        next,
        choice.character_id,
        aliasCandidate,
      );
      next = persisted.registry;
      aliasPersisted = persisted.accepted;
    }
    return {
      ok: true,
      resolved: true,
      identity_status: 'existing',
      source_identity_status: 'new',
      resolution: 'reused_existing',
      character_id: choice.character_id,
      candidate_ids: candidateIds,
      entry: getCharacterEntry(next, choice.character_id),
      alias_candidate: aliasCandidate,
      alias_persisted: aliasPersisted,
      error_code: null,
      registry: next,
    };
  }

  const characterId = generatedCharacterId(base, options);
  if (!characterId) {
    return resultWithRegistry(base, {
      ok: false,
      resolved: false,
      identity_status: 'unresolved',
      character_id: null,
      entry: null,
      candidate_ids: [],
      error_code: IDENTITY_ERROR_CODES.CHARACTER_ID_COLLISION,
    });
  }

  const next = cloneCharacterRegistry(base);
  next.entities[characterId] = {
    character_id: characterId,
    display_name: displayName,
    aliases: [],
  };
  let finalRegistry = next;
  let aliasPersisted = false;
  if (shouldPersistAliases(options) && aliasCandidate) {
    const persisted = persistAliasCandidate(next, characterId, aliasCandidate);
    finalRegistry = persisted.registry;
    aliasPersisted = persisted.accepted;
  }
  return {
    ok: true,
    resolved: true,
    identity_status: 'new',
    source_identity_status: 'new',
    resolution: 'registered_new',
    character_id: characterId,
    candidate_ids: [],
    entry: getCharacterEntry(finalRegistry, characterId),
    alias_candidate: aliasCandidate,
    alias_persisted: aliasPersisted,
    error_code: null,
    registry: finalRegistry,
  };
}

/**
 * Resolve one raw Analyzer participant. Existing IDs are membership-checked;
 * new IDs are ignored/rejected until Runtime registration; unresolved input
 * cannot produce a canonical ID. Alias persistence is opt-in.
 */
export function resolveRawParticipantIdentity(
  registry = {},
  rawParticipant = {},
  options = {},
) {
  const base = normalizeCharacterRegistry(registry);
  const source = recordValue(rawParticipant);
  const suppliedId = identifierValue(source.character_id);
  const requestedStatus = textValue(
    source.identity_status ?? source.identityStatus,
  );
  const allowLegacy = recordValue(options).allowLegacy === true;
  const status =
    requestedStatus || (allowLegacy && suppliedId ? 'existing' : null);

  if (!status) {
    return resolutionFailure(
      base,
      source,
      status,
      IDENTITY_ERROR_CODES.IDENTITY_STATUS_REQUIRED,
    );
  }
  if (!IDENTITY_STATUSES.includes(status)) {
    return resolutionFailure(
      base,
      source,
      status,
      IDENTITY_ERROR_CODES.INVALID_IDENTITY_STATUS,
    );
  }
  if (status === 'unresolved') {
    return resolutionFailure(
      base,
      source,
      status,
      IDENTITY_ERROR_CODES.IDENTITY_UNRESOLVED,
    );
  }
  if (status === 'existing') {
    if (!suppliedId) {
      return resolutionFailure(
        base,
        source,
        status,
        IDENTITY_ERROR_CODES.EXISTING_ID_REQUIRED,
      );
    }
    if (!hasOwn(base.entities, suppliedId)) {
      if (allowLegacy) {
        const legacyRegistry = cloneCharacterRegistry(base);
        legacyRegistry.entities[suppliedId] = {
          character_id: suppliedId,
          display_name: nullableText(source.display_name),
          aliases: [],
        };
        return resolutionSuccess(
          legacyRegistry,
          source,
          status,
          suppliedId,
          legacyRegistry.entities[suppliedId],
          {
            resolution: 'legacy_bootstrap',
            alias_candidate: null,
            alias_persisted: false,
            source_character_id: suppliedId,
          },
        );
      }
      return resolutionFailure(
        base,
        source,
        status,
        IDENTITY_ERROR_CODES.UNKNOWN_EXISTING_CHARACTER_ID,
        collectExactCharacterCandidateIds(base, source.display_name),
      );
    }

    if (!(allowLegacy && !requestedStatus)) {
      const mention = nullableText(source.display_name);
      const candidateIds = mention
        ? collectExactCharacterCandidateIds(base, mention)
        : [];
      if (candidateIds.length && !candidateIds.includes(suppliedId)) {
        return resolutionFailure(
          base,
          source,
          status,
          IDENTITY_ERROR_CODES.IDENTITY_UNRESOLVED,
          candidateIds,
        );
      }
      if (candidateIds.length > 1) {
        const choice = resolveCandidateChoice(candidateIds, {
          ...options,
          contextual_character_id: suppliedId,
          context_evidence:
            resolveContextEvidence(options) ??
            identityEvidenceFrom(source) ??
            source.evidence,
        });
        if (!choice || choice.character_id !== suppliedId) {
          return resolutionFailure(
            base,
            source,
            status,
            IDENTITY_ERROR_CODES.IDENTITY_UNRESOLVED,
            candidateIds,
          );
        }
      }
    }

    let next = cloneCharacterRegistry(base);
    let entry = next.entities[suppliedId];
    const proposedDisplayName = nullableText(source.display_name);
    if (
      proposedDisplayName &&
      proposedDisplayName !== entry.display_name &&
      hasExplicitDisplayNameUpdateEvidence(identityEvidenceFrom(source))
    ) {
      const updated = updateCharacterDisplayName(
        next,
        suppliedId,
        proposedDisplayName,
      );
      if (!updated.ok) {
        return resolutionFailure(
          base,
          source,
          status,
          updated.reason ?? IDENTITY_ERROR_CODES.DISPLAY_NAME_NOT_PERSISTABLE,
        );
      }
      next = updated.registry;
      entry = next.entities[suppliedId];
    }
    const aliasCandidate = discoverAliasCandidate(
      source.alias_candidate ?? source.aliasCandidate,
      identityEvidenceFrom(source),
      { entry },
    );
    let aliasPersisted = false;
    if (shouldPersistAliases(options) && aliasCandidate) {
      const persisted = persistAliasCandidate(next, suppliedId, aliasCandidate);
      next = persisted.registry;
      aliasPersisted = persisted.accepted;
    }
    return resolutionSuccess(next, source, status, suppliedId, entry, {
      resolution: 'existing_membership',
      alias_candidate: aliasCandidate,
      alias_persisted: aliasPersisted,
      source_character_id: suppliedId,
    });
  }

  if (suppliedId) {
    return resolutionFailure(
      base,
      source,
      status,
      IDENTITY_ERROR_CODES.PROVISIONAL_ID_NOT_ALLOWED,
    );
  }
  const registered = registerNewCharacter(base, source, options);
  if (!registered.ok) {
    return {
      ...registered,
      resolved: false,
      identity_status: 'unresolved',
      source_identity_status: status,
      mention_id: textValue(source.mention_id ?? source.mentionId) || null,
      candidates: registered.candidate_ids ?? [],
      participant: null,
      entry: null,
    };
  }

  const entry = registered.entry;
  return resolutionSuccess(
    registered.registry,
    source,
    'new',
    registered.character_id,
    entry,
    {
      resolution: registered.resolution,
      alias_candidate: registered.alias_candidate,
      alias_persisted: registered.alias_persisted,
      source_character_id: null,
    },
  );
}

export const resolveParticipantIdentity = resolveRawParticipantIdentity;

function rawHandle(source, status) {
  const mentionId = textValue(source.mention_id ?? source.mentionId);
  if (mentionId) return mentionId;
  if (status === 'existing') return identifierValue(source.character_id);
  return null;
}

/**
 * Resolve a participant collection atomically. Raw handles are checked for
 * conflicting canonical results before canonical-ID deduplication.
 */
export function resolveRawParticipantIdentities(
  rawParticipants,
  registry = {},
  options = {},
) {
  const base = normalizeCharacterRegistry(registry);
  if (!Array.isArray(rawParticipants)) {
    return {
      ok: false,
      resolved: false,
      participants: [],
      resolutions: [],
      errors: [
        { error_code: IDENTITY_ERROR_CODES.INVALID_PARTICIPANT_COLLECTION },
      ],
      registry: base,
      character_registry: cloneValue(base),
    };
  }

  let working = cloneCharacterRegistry(base);
  const resolutions = [];
  const participants = [];
  const handles = new Map();
  const canonicalIds = new Set();
  const errors = [];
  const createdCharacterIds = new Set();

  rawParticipants.forEach((rawParticipant, index) => {
    if (errors.length) return;
    const source = recordValue(rawParticipant);
    const requestedStatus = textValue(
      source.identity_status ?? source.identityStatus,
    );
    const status =
      requestedStatus ||
      (recordValue(options).allowLegacy === true &&
      identifierValue(source.character_id)
        ? 'existing'
        : null);
    const result = resolveRawParticipantIdentity(working, source, {
      ...options,
      excludeCharacterIds: [...createdCharacterIds],
    });
    if (!result.ok) {
      errors.push({
        ...result,
        path: `participants[${index}]`,
      });
      return;
    }

    const handle = rawHandle(source, status);
    if (handle) {
      const previous = handles.get(handle);
      if (previous && previous.character_id !== result.character_id) {
        errors.push({
          error_code: IDENTITY_ERROR_CODES.RAW_IDENTITY_CONFLICT,
          path: `participants[${index}]`,
          mention_id: handle,
          candidate_ids: sortedIds([
            previous.character_id,
            result.character_id,
          ]),
        });
        return;
      }
      if (!previous)
        handles.set(handle, {
          character_id: result.character_id,
          source_status: status,
        });
    }

    working = result.registry;
    if (
      result.source_identity_status === 'new' &&
      result.resolution === 'registered_new'
    ) {
      createdCharacterIds.add(result.character_id);
    }
    resolutions.push({
      ok: true,
      mention_id: result.mention_id,
      source_character_id: result.source_character_id,
      source_identity_status: result.source_identity_status,
      character_id: result.character_id,
      entry: cloneValue(result.entry),
      alias_candidate: cloneValue(result.alias_candidate),
    });
    if (!canonicalIds.has(result.character_id)) {
      canonicalIds.add(result.character_id);
      participants.push(result.participant);
    }
  });

  if (errors.length) {
    return {
      ok: false,
      resolved: false,
      participants: [],
      resolutions: [],
      errors,
      registry: base,
      character_registry: cloneValue(base),
    };
  }

  const rawToCanonical = new Map();
  for (const resolution of resolutions) {
    if (resolution.mention_id)
      rawToCanonical.set(resolution.mention_id, resolution.character_id);
    if (resolution.source_character_id)
      rawToCanonical.set(
        resolution.source_character_id,
        resolution.character_id,
      );
  }
  return {
    ok: true,
    resolved: true,
    participants,
    resolutions,
    raw_to_canonical: rawToCanonical,
    registry: working,
    character_registry: cloneValue(working),
    alias_candidates: resolutions
      .filter((resolution) => resolution.alias_candidate)
      .map((resolution) => ({
        ...cloneValue(resolution.alias_candidate),
        character_id: resolution.character_id,
      })),
    errors: [],
  };
}

export const resolveParticipantIdentities = resolveRawParticipantIdentities;

function canonicalReference(value, resolution, registry) {
  const reference = identifierValue(value);
  if (!reference)
    return { ok: false, error_code: IDENTITY_ERROR_CODES.UNKNOWN_REFERENCE };
  if (resolution.raw_to_canonical.has(reference)) {
    return {
      ok: true,
      character_id: resolution.raw_to_canonical.get(reference),
    };
  }
  if (hasCharacterId(registry, reference))
    return { ok: true, character_id: reference };
  return {
    ok: false,
    error_code: IDENTITY_ERROR_CODES.UNKNOWN_REFERENCE,
    value: reference,
  };
}

function resolveEventIdentityOptions(
  registryOrOptions = {},
  maybeOptions = {},
) {
  const source = recordValue(registryOrOptions);
  const looksLikeRegistry = hasOwn(source, 'entities');
  if (looksLikeRegistry) {
    return {
      registry: registryOrOptions,
      options: recordValue(maybeOptions),
    };
  }
  return {
    registry: source.registry ?? source.character_registry ?? {},
    options: source,
  };
}

/**
 * Resolve an AI analysis envelope before Event/domain validation. Participant
 * handles in pregnancy reference arrays are converted to canonical IDs; any
 * unresolved participant/reference aborts the whole result and returns the
 * original registry clone.
 */
export function resolveEventAnalysisIdentities(
  rawAnalysis,
  registryOrOptions = {},
  maybeOptions = {},
) {
  const { registry, options } = resolveEventIdentityOptions(
    registryOrOptions,
    maybeOptions,
  );
  const base = normalizeCharacterRegistry(registry);
  const source = recordValue(rawAnalysis);
  const rawEvents = Array.isArray(rawAnalysis)
    ? rawAnalysis
    : Array.isArray(source.events)
      ? source.events
      : null;
  if (!rawEvents) {
    return {
      ok: false,
      resolved: false,
      events: [],
      analysis: null,
      errors: [{ error_code: 'invalid_event_collection' }],
      registry: base,
      character_registry: cloneValue(base),
      alias_candidates: [],
    };
  }

  let working = cloneCharacterRegistry(base);
  const canonicalEvents = [];
  const allResolutions = [];
  const errors = [];

  rawEvents.forEach((rawEvent, eventIndex) => {
    if (errors.length) return;
    const event = recordValue(rawEvent);
    const participantResolution = resolveRawParticipantIdentities(
      event.participants ?? [],
      working,
      options,
    );
    if (!participantResolution.ok) {
      errors.push(
        ...participantResolution.errors.map((error) => ({
          ...error,
          path: `events[${eventIndex}].${error.path ?? 'participants'}`,
        })),
      );
      return;
    }
    working = participantResolution.registry;
    allResolutions.push(...participantResolution.resolutions);

    const rawToCanonical = participantResolution.raw_to_canonical;
    const nextEvent = cloneValue(event);
    nextEvent.participants = participantResolution.participants;
    if (
      event.pregnancy_relevance &&
      typeof event.pregnancy_relevance === 'object' &&
      !Array.isArray(event.pregnancy_relevance)
    ) {
      const relevance = cloneValue(event.pregnancy_relevance);
      for (const field of ['gestational_subject_ids', 'counterpart_ids']) {
        if (!hasOwn(relevance, field)) continue;
        if (!Array.isArray(relevance[field])) {
          errors.push({
            error_code: IDENTITY_ERROR_CODES.INVALID_REFERENCE_COLLECTION,
            path: `events[${eventIndex}].pregnancy_relevance.${field}`,
          });
          return;
        }
        const canonicalReferences = [];
        for (const value of relevance[field]) {
          const resolvedReference = canonicalReference(
            value,
            participantResolution,
            working,
          );
          if (!resolvedReference.ok) {
            errors.push({
              ...resolvedReference,
              path: `events[${eventIndex}].pregnancy_relevance.${field}`,
            });
            return;
          }
          if (!canonicalReferences.includes(resolvedReference.character_id)) {
            canonicalReferences.push(resolvedReference.character_id);
          }
        }
        relevance[field] = canonicalReferences;
      }
      nextEvent.pregnancy_relevance = relevance;
    }
    canonicalEvents.push(nextEvent);
  });

  if (errors.length) {
    return {
      ok: false,
      resolved: false,
      events: [],
      analysis: null,
      resolutions: [],
      errors,
      registry: base,
      character_registry: cloneValue(base),
      alias_candidates: [],
    };
  }

  const aliasCandidates = [];
  const aliasCandidateKeys = new Set();
  for (const resolution of allResolutions) {
    if (!resolution.alias_candidate) continue;
    const key = `${resolution.character_id}\u0000${resolution.alias_candidate.value}`;
    if (aliasCandidateKeys.has(key)) continue;
    aliasCandidateKeys.add(key);
    aliasCandidates.push({
      ...cloneValue(resolution.alias_candidate),
      character_id: resolution.character_id,
    });
  }
  aliasCandidates.sort(
    (left, right) =>
      compareIds(left.character_id, right.character_id) ||
      compareIds(left.value, right.value),
  );

  const result = {
    ok: true,
    resolved: true,
    events: canonicalEvents,
    resolutions: allResolutions,
    registry: working,
    character_registry: cloneValue(working),
    alias_candidates: aliasCandidates,
    errors: [],
  };
  if (Array.isArray(rawAnalysis)) return result;
  result.analysis = { ...cloneValue(source), events: canonicalEvents };
  return result;
}

function legacyIdentifier(value) {
  if (typeof value === 'string') return value || null;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function appendLegacyRecord(
  records,
  characterId,
  displayName = null,
  aliases = [],
) {
  const id = legacyIdentifier(characterId);
  if (!id) return;
  const existing = records.get(id) ?? {
    character_id: id,
    display_name: null,
    aliases: [],
  };
  const nextDisplayName = nullableText(displayName);
  if (!existing.display_name && nextDisplayName)
    existing.display_name = nextDisplayName;
  if (Array.isArray(aliases)) {
    for (const alias of aliases) {
      const value = textValue(alias);
      if (
        value &&
        value !== existing.display_name &&
        !existing.aliases.includes(value) &&
        !isContextualReferenceValue(value)
      ) {
        existing.aliases.push(value);
      }
    }
  }
  records.set(id, existing);
}

function collectLegacyProfileRecords(profiles, records) {
  if (Array.isArray(profiles)) {
    for (const profile of profiles) {
      const source = recordValue(profile);
      appendLegacyRecord(
        records,
        source.character_id,
        source.display_name,
        source.aliases,
      );
    }
    return;
  }
  const source = recordValue(profiles);
  if (hasOwn(source, 'character_id')) {
    appendLegacyRecord(
      records,
      source.character_id,
      source.display_name,
      source.aliases,
    );
    return;
  }
  for (const [key, value] of Object.entries(source)) {
    const profile = recordValue(value);
    appendLegacyRecord(
      records,
      profile.character_id ?? key,
      profile.display_name,
      profile.aliases,
    );
  }
}

function collectLegacyEventRecords(events, records) {
  const values = Array.isArray(events) ? events : events ? [events] : [];
  for (const event of values) {
    const source = recordValue(event);
    for (const participant of Array.isArray(source.participants)
      ? source.participants
      : []) {
      const item = recordValue(participant);
      appendLegacyRecord(
        records,
        item.character_id,
        item.display_name,
        item.aliases,
      );
    }
    const relevance = recordValue(source.pregnancy_relevance);
    for (const field of ['gestational_subject_ids', 'counterpart_ids']) {
      for (const characterId of Array.isArray(relevance[field])
        ? relevance[field]
        : []) {
        appendLegacyRecord(records, characterId);
      }
    }
  }
}

/**
 * Explicit legacy-migration helper: bootstrap only IDs already present in
 * caller-supplied legacy Events/profiles. Ordinary Runtime analysis must not
 * call this helper. It never derives an ID from a name, merges entries, or
 * rewrites historical Events.
 */
export function bootstrapLegacyCharacterRegistry(
  input = {},
  maybeProfiles = {},
  maybeRegistry = null,
) {
  let events = [];
  let profiles = {};
  let registry = maybeRegistry;
  const source = recordValue(input);

  if (Array.isArray(input)) {
    events = input;
    profiles = maybeProfiles;
  } else if (Array.isArray(input?.events)) {
    events = input.events;
    profiles =
      input.character_profiles ??
      input.characterProfiles ??
      input.profiles ??
      maybeProfiles;
    registry =
      input.character_registry ??
      input.characterRegistry ??
      input.registry ??
      registry;
  } else if (hasOwn(input, 'event_id') || Array.isArray(input?.participants)) {
    events = [input];
    profiles = maybeProfiles;
  } else if (input?.entities) {
    registry = input;
  } else {
    profiles =
      input.character_profiles ??
      input.characterProfiles ??
      input.profiles ??
      maybeProfiles;
    registry =
      input.character_registry ??
      input.characterRegistry ??
      input.registry ??
      registry;
  }

  const base = normalizeCharacterRegistry(registry ?? {});
  const records = new Map();
  collectLegacyEventRecords(events, records);
  collectLegacyProfileRecords(profiles, records);

  const next = cloneCharacterRegistry(base);
  for (const [characterId, record] of records) {
    if (hasOwn(next.entities, characterId)) continue;
    setObjectValue(next.entities, characterId, {
      character_id: characterId,
      display_name: record.display_name,
      aliases: [...record.aliases].filter(
        (alias) => alias !== record.display_name,
      ),
    });
  }
  return next;
}

export const bootstrapLegacyRegistry = bootstrapLegacyCharacterRegistry;

/** Runtime-shaped alias for bootstrapping IDs from legacy Event/profile data. */
export function bootstrapCharacterRegistryFromLegacy(
  input = {},
  maybeProfiles = {},
  maybeRegistry = null,
) {
  return bootstrapLegacyCharacterRegistry(input, maybeProfiles, maybeRegistry);
}

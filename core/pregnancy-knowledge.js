import {reduceState} from './state.js';

export const PREGNANCY_KNOWLEDGE_SCHEMA_VERSION = 1;

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function clone(value) {
  if (value === undefined || value === null || typeof value !== 'object') return value;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return Array.isArray(value)
    ? value.map(clone)
    : Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
}

function version(value) {
  const source = record(value);
  return {
    chat_id: source.chat_id ?? null,
    message_id: source.message_id ?? null,
    floor: source.floor ?? null,
    swipe_id: source.swipe_id ?? null,
  };
}

function validVersion(value) {
  const next = version(value);
  return next.chat_id !== null && next.message_id !== null && next.floor !== null && next.swipe_id !== null;
}

export function knowledgeKey(subjectId, pregnancyId) {
  return `${text(subjectId)}\u001f${text(pregnancyId)}`;
}

export function normalizePregnancyKnowledgeEntry(value) {
  const source = record(value);
  const knowers = [];
  const seen = new Set();
  for (const item of Array.isArray(source.knowers) ? source.knowers : []) {
    const characterId = text(item?.character_id);
    if (!characterId || seen.has(characterId)) continue;
    seen.add(characterId);
    knowers.push({
      character_id: characterId,
      learned_at_floor_version: version(item?.learned_at_floor_version),
      evidence_fingerprint: text(item?.evidence_fingerprint) || null,
    });
  }
  knowers.sort((a, b) => a.character_id.localeCompare(b.character_id));
  return {
    schema_version: PREGNANCY_KNOWLEDGE_SCHEMA_VERSION,
    subject_id: text(source.subject_id) || null,
    pregnancy_id: text(source.pregnancy_id) || null,
    knowers,
    updated_at_floor_version: version(source.updated_at_floor_version),
  };
}

export function validatePregnancyKnowledgeEntry(value) {
  const entry = normalizePregnancyKnowledgeEntry(value);
  const errors = [];
  if (!entry.subject_id) errors.push('subject_id');
  if (!entry.pregnancy_id) errors.push('pregnancy_id');
  if (!validVersion(entry.updated_at_floor_version)) errors.push('updated_at_floor_version');
  for (const [index, knower] of entry.knowers.entries()) {
    if (!validVersion(knower.learned_at_floor_version)) errors.push(`knowers[${index}].learned_at_floor_version`);
  }
  return {ok: errors.length === 0, errors, value: entry};
}

export function emptyPregnancyKnowledgeSnapshot() {
  return {schema_version: PREGNANCY_KNOWLEDGE_SCHEMA_VERSION, complete: true, entries: [], created_at_floor_version: null};
}

export function normalizePregnancyKnowledgeSnapshot(value) {
  const source = record(value);
  if (source.schema_version !== PREGNANCY_KNOWLEDGE_SCHEMA_VERSION || source.complete !== true) return null;
  const entries = [];
  const seen = new Set();
  for (const item of Array.isArray(source.entries) ? source.entries : []) {
    const result = validatePregnancyKnowledgeEntry(item);
    if (!result.ok) continue;
    const key = knowledgeKey(result.value.subject_id, result.value.pregnancy_id);
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push(result.value);
  }
  entries.sort((a, b) => knowledgeKey(a.subject_id, a.pregnancy_id).localeCompare(knowledgeKey(b.subject_id, b.pregnancy_id)));
  const snapshot = {
    schema_version: PREGNANCY_KNOWLEDGE_SCHEMA_VERSION,
    complete: true,
    entries,
    created_at_floor_version: source.created_at_floor_version ? version(source.created_at_floor_version) : null,
  };
  return snapshot;
}

export function buildPregnancyKnowledgeSnapshot(entries = [], floorVersion = null) {
  const normalized = [];
  const seen = new Set();
  for (const item of Array.isArray(entries) ? entries : []) {
    const result = validatePregnancyKnowledgeEntry(item);
    if (!result.ok) continue;
    const key = knowledgeKey(result.value.subject_id, result.value.pregnancy_id);
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(result.value);
  }
  normalized.sort((a, b) => knowledgeKey(a.subject_id, a.pregnancy_id).localeCompare(knowledgeKey(b.subject_id, b.pregnancy_id)));
  return {schema_version: PREGNANCY_KNOWLEDGE_SCHEMA_VERSION, complete: true, entries: normalized, created_at_floor_version: floorVersion ? version(floorVersion) : null};
}

export function mergePregnancyKnowledgeSnapshots(previous, additions = [], floorVersion = null) {
  const current = normalizePregnancyKnowledgeSnapshot(previous) ?? emptyPregnancyKnowledgeSnapshot();
  const byKey = new Map(current.entries.map(entry => [knowledgeKey(entry.subject_id, entry.pregnancy_id), clone(entry)]));
  for (const addition of Array.isArray(additions) ? additions : []) {
    const result = validatePregnancyKnowledgeEntry(addition);
    if (!result.ok) continue;
    const key = knowledgeKey(result.value.subject_id, result.value.pregnancy_id);
    const existing = byKey.get(key) ?? {...result.value, knowers: []};
    const knowers = new Map(existing.knowers.map(item => [item.character_id, item]));
    for (const knower of result.value.knowers) knowers.set(knower.character_id, knower);
    byKey.set(key, {...existing, knowers: [...knowers.values()], updated_at_floor_version: floorVersion ? version(floorVersion) : existing.updated_at_floor_version});
  }
  return buildPregnancyKnowledgeSnapshot([...byKey.values()], floorVersion);
}

export function projectPregnancyKnowledgeForPrompt(snapshot, registry, events = null) {
  const entities = record(registry?.entities);
  const state = Array.isArray(events) ? reduceState({events}) : null;
  const result = [];
  for (const entry of normalizePregnancyKnowledgeSnapshot(snapshot)?.entries ?? []) {
    const subject = entities[entry.subject_id];
    if (state) {
      const episodes = state.characters?.[entry.subject_id]?.pregnancy?.episodes ?? {};
      const confirmed = Object.values(episodes).filter(episode => episode?.status === 'confirmed');
      if (confirmed.length !== 1 || confirmed[0].pregnancy_id !== entry.pregnancy_id) continue;
    }
    const knowers = entry.knowers.map(item => entities[item.character_id]).filter(Boolean).map(item => ({display_name: item.display_name, aliases: item.aliases ?? []}));
    if (!subject?.display_name || !knowers.length) continue;
    result.push({subject_id: entry.subject_id, subject: {display_name: subject.display_name, aliases: subject.aliases ?? []}, knowers});
  }
  return result;
}

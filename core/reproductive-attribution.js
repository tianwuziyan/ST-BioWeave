export const REPRODUCTIVE_ATTRIBUTION_SCHEMA_VERSION = 1;
export const ATTRIBUTION_VALUES = Object.freeze(['confirmed', 'excluded']);

const CANDIDATE_FIELDS = new Set(['schema_version', 'subject_id', 'source_character_id', 'source_event_ids', 'mechanism_key', 'contribution_kind', 'compatibility']);
const RELATIONSHIP_FIELDS = new Set(['relationship_key', 'subject_id', 'source_character_id', 'contribution_kind']);
const ATTRIBUTION_FIELDS = new Set(['schema_version', 'pregnancy_id', 'subject_id', 'confirmed', 'excluded', 'candidates', 'unresolved', 'conflicts']);

function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function clone(value) { return typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value)); }
function text(value) { return typeof value === 'string' && value.trim() !== ''; }
function ids(value, required = true) { return Array.isArray(value) && (!required || value.length > 0) && value.every(text) && new Set(value).size === value.length; }
function relationshipKey({subject_id, source_character_id, contribution_kind}) { return `${subject_id}|${source_character_id}|${contribution_kind}`; }
function validateCommon(value, fields, path, errors) { if (!isRecord(value)) { errors.push(`${path}:invalid`); return; } for (const key of Object.keys(value)) if (!fields.has(key)) errors.push(`${path}.${key}:unexpected_field`); }

export function createReproductiveSourceCandidate(value = {}) {
  const result = {schema_version: REPRODUCTIVE_ATTRIBUTION_SCHEMA_VERSION, subject_id: value.subject_id ?? null, source_character_id: value.source_character_id ?? null, source_event_ids: [...(value.source_event_ids ?? [])].sort(), mechanism_key: value.mechanism_key ?? null, contribution_kind: value.contribution_kind ?? null, compatibility: [true, false, null].includes(value.compatibility) ? value.compatibility : null};
  const validation = validateReproductiveSourceCandidate(result); if (!validation.ok) throw new TypeError(validation.errors.join(', ')); return clone(result);
}
export function validateReproductiveSourceCandidate(value) {
  const errors = []; validateCommon(value, CANDIDATE_FIELDS, 'candidate', errors); if (value?.schema_version !== REPRODUCTIVE_ATTRIBUTION_SCHEMA_VERSION) errors.push('candidate.schema_version:invalid'); if (!text(value?.subject_id)) errors.push('candidate.subject_id:required'); if (!text(value?.source_character_id)) errors.push('candidate.source_character_id:required'); if (!ids(value?.source_event_ids)) errors.push('candidate.source_event_ids:required'); if (!text(value?.mechanism_key)) errors.push('candidate.mechanism_key:required'); if (!text(value?.contribution_kind)) errors.push('candidate.contribution_kind:required'); if (![true, false, null].includes(value?.compatibility)) errors.push('candidate.compatibility:invalid'); return {ok: errors.length === 0, errors};
}
export function buildContributorRelationship(value) { const result = {relationship_key: relationshipKey(value), subject_id: value.subject_id, source_character_id: value.source_character_id, contribution_kind: value.contribution_kind}; const errors = []; validateCommon(result, RELATIONSHIP_FIELDS, 'relationship', errors); if (!text(result.subject_id) || !text(result.source_character_id) || !text(result.contribution_kind)) errors.push('relationship:incomplete'); if (errors.length) throw new TypeError(errors.join(', ')); return result; }
function validateRelationship(value, path, errors) { validateCommon(value, RELATIONSHIP_FIELDS, path, errors); if (!text(value?.relationship_key) || !text(value?.subject_id) || !text(value?.source_character_id) || !text(value?.contribution_kind)) errors.push(`${path}:incomplete`); if (value?.relationship_key !== relationshipKey(value ?? {})) errors.push(`${path}.relationship_key:not_deterministic`); }

export function createContributorAttribution(value = {}) {
  const result = {schema_version: REPRODUCTIVE_ATTRIBUTION_SCHEMA_VERSION, pregnancy_id: value.pregnancy_id ?? null, subject_id: value.subject_id ?? null, confirmed: (value.confirmed ?? []).map(buildContributorRelationship), excluded: (value.excluded ?? []).map(buildContributorRelationship), candidates: (value.candidates ?? []).map(createReproductiveSourceCandidate), unresolved: value.unresolved === true, conflicts: clone(value.conflicts ?? [])};
  const validation = validateContributorAttribution(result); if (!validation.ok) throw new TypeError(validation.errors.join(', ')); return clone(result);
}
export function validateContributorAttribution(value) {
  const errors = []; validateCommon(value, ATTRIBUTION_FIELDS, 'attribution', errors); if (value?.schema_version !== REPRODUCTIVE_ATTRIBUTION_SCHEMA_VERSION) errors.push('attribution.schema_version:invalid'); if (!text(value?.pregnancy_id)) errors.push('attribution.pregnancy_id:required'); if (!text(value?.subject_id)) errors.push('attribution.subject_id:required'); for (const field of ['confirmed', 'excluded', 'candidates']) if (!Array.isArray(value?.[field])) errors.push(`attribution.${field}:array`); (value?.confirmed ?? []).forEach((item, index) => validateRelationship(item, `attribution.confirmed[${index}]`, errors)); (value?.excluded ?? []).forEach((item, index) => validateRelationship(item, `attribution.excluded[${index}]`, errors)); (value?.candidates ?? []).forEach((item, index) => { const result = validateReproductiveSourceCandidate(item); if (!result.ok) errors.push(...result.errors.map(error => `attribution.candidates[${index}].${error}`)); }); if (typeof value?.unresolved !== 'boolean') errors.push('attribution.unresolved:invalid'); if (!Array.isArray(value?.conflicts)) errors.push('attribution.conflicts:array'); return {ok: errors.length === 0, errors};
}
export function aggregateContributorAttribution({pregnancy_id, subject_id, candidates = [], attributionEvents = []} = {}) {
  const normalizedCandidates = candidates.map(createReproductiveSourceCandidate).filter(candidate => candidate.compatibility !== false && candidate.subject_id === subject_id);
  const confirmed = new Map(); const excluded = new Map(); const conflicts = [];
  for (const event of attributionEvents) { if (!isRecord(event) || !ATTRIBUTION_VALUES.includes(event.attribution)) continue; if (event.pregnancy_id !== pregnancy_id || event.subject_id !== subject_id) continue; const relationship = buildContributorRelationship(event); const target = event.attribution === 'confirmed' ? confirmed : excluded; if (!target.has(relationship.relationship_key)) target.set(relationship.relationship_key, relationship); }
  for (const key of confirmed.keys()) if (excluded.has(key)) conflicts.push({code: 'attribution_conflict', relationship_key: key});
  const candidateKeys = new Set(normalizedCandidates.map(candidate => relationshipKey(candidate)));
  const unresolved = conflicts.length > 0 || normalizedCandidates.some(candidate => candidate.compatibility === null) || [...candidateKeys].some(key => !confirmed.has(key) && !excluded.has(key));
  return createContributorAttribution({pregnancy_id, subject_id, confirmed: [...confirmed.values()], excluded: [...excluded.values()], candidates: normalizedCandidates, unresolved, conflicts});
}

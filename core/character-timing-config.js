export const CHARACTER_TIMING_CONFIG_SCHEMA_VERSION = 1;

const CONFIG_FIELDS = new Set([
  'schema_version', 'config_version', 'base_min_story_days',
  'base_max_story_days', 'variance_ratio', 'variance_cap_story_days',
  'total_adjustment_cap_story_days',
]);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
  if (value === undefined || value === null || typeof value !== 'object') return value;
  if (typeof structuredClone === 'function') return structuredClone(value);
  if (Array.isArray(value)) return value.map(clone);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
}

function finiteNonNegative(value, field, errors) {
  if (!Number.isFinite(Number(value)) || Number(value) < 0) errors.push(`${field}:invalid`);
}

export function validateCharacterTimingConfig(value) {
  const errors = [];
  if (!isRecord(value)) return {ok: false, errors: ['character_timing_config:invalid']};
  for (const key of Object.keys(value)) if (!CONFIG_FIELDS.has(key)) errors.push(`character_timing_config.${key}:unexpected`);
  if (value.schema_version !== CHARACTER_TIMING_CONFIG_SCHEMA_VERSION) errors.push('character_timing_config.schema_version:invalid');
  if (!Number.isInteger(value.config_version) || value.config_version < 1) errors.push('character_timing_config.config_version:invalid');
  for (const field of ['base_min_story_days', 'base_max_story_days', 'variance_ratio', 'variance_cap_story_days', 'total_adjustment_cap_story_days']) finiteNonNegative(value[field], field, errors);
  if (Number.isFinite(Number(value.base_min_story_days)) && Number.isFinite(Number(value.base_max_story_days)) && Number(value.base_max_story_days) < Number(value.base_min_story_days)) errors.push('character_timing_config.base_max_story_days:before_min');
  return {ok: errors.length === 0, errors};
}

export function normalizeCharacterTimingConfig(value, {configVersion = null} = {}) {
  if (!isRecord(value)) return null;
  const normalized = {
    schema_version: CHARACTER_TIMING_CONFIG_SCHEMA_VERSION,
    config_version: Number.isInteger(value.config_version) && value.config_version > 0 ? value.config_version : (Number.isInteger(configVersion) && configVersion > 0 ? configVersion : 1),
    base_min_story_days: Number(value.base_min_story_days),
    base_max_story_days: Number(value.base_max_story_days),
    variance_ratio: Number(value.variance_ratio),
    variance_cap_story_days: Number(value.variance_cap_story_days),
    total_adjustment_cap_story_days: Number(value.total_adjustment_cap_story_days),
  };
  const validation = validateCharacterTimingConfig(normalized);
  if (!validation.ok) throw new TypeError(validation.errors.join(', '));
  return normalized;
}

export function resolveCharacterTimingConfig({override = null, baseline = null} = {}) {
  if (override !== null && override !== undefined) return {config: normalizeCharacterTimingConfig(override), overridden: true};
  if (baseline !== null && baseline !== undefined) return {config: normalizeCharacterTimingConfig(baseline), overridden: false};
  return {config: null, overridden: false};
}

export function readCharacterTimingConfig(chat, characterId) {
  const key = typeof characterId === 'string' ? characterId.trim() : '';
  if (!key) return {config: null, overridden: false};
  const override = chat?.settings?.character_timing_configs?.[key];
  return override ? {config: normalizeCharacterTimingConfig(override), overridden: true} : {config: null, overridden: false};
}

export function withCharacterTimingConfig(chat, characterId, config) {
  const key = typeof characterId === 'string' ? characterId.trim() : '';
  if (!key) throw new TypeError('character_id:required');
  const next = clone(chat ?? {});
  next.settings = isRecord(next.settings) ? next.settings : {};
  next.settings.character_timing_configs = isRecord(next.settings.character_timing_configs) ? next.settings.character_timing_configs : {};
  const normalized = normalizeCharacterTimingConfig({...config, config_version: Number(next.settings.character_timing_configs[key]?.config_version ?? 0) + 1});
  next.settings.character_timing_configs[key] = normalized;
  return next;
}

export function resetCharacterTimingConfig(chat, characterId) {
  const key = typeof characterId === 'string' ? characterId.trim() : '';
  if (!key) throw new TypeError('character_id:required');
  const next = clone(chat ?? {});
  next.settings = isRecord(next.settings) ? next.settings : {};
  next.settings.character_timing_configs = isRecord(next.settings.character_timing_configs) ? next.settings.character_timing_configs : {};
  delete next.settings.character_timing_configs[key];
  return next;
}

/**
 * BioWeave's persistence ownership registry.
 *
 * The registry is deliberately data-only.  It does not know about the host
 * storage adapter and it does not perform a recursive walk.  Clear and
 * lifecycle code use this table to decide which *named* roots they may touch.
 * Keeping the table independent from storage.js also gives contract tests a
 * cycle-free way to compare the registry with the schema defaults.
 */

export const LIFECYCLE_SCHEMA_VERSION = 1;

export const LIFECYCLE_DOMAINS = Object.freeze({
  STRUCTURAL: 'structural',
  GLOBAL_SETTINGS: 'global_settings',
  CHAT_SETTINGS: 'chat_settings',
  LIFECYCLE_MARKER: 'lifecycle_marker',
  WORLD: 'world',
  CHARACTER: 'character',
  EVENTS: 'events',
  FLOOR_ANALYSIS: 'floor_analysis',
  FLOOR_IDENTITY: 'floor_identity',
  RUNTIME_CACHE: 'runtime_cache',
  ALL: 'all',
});

const GLOBAL_FIELDS = Object.freeze([
  'api_source',
  'default_profile_id',
  'api_profiles',
  'api_model_caches',
  'assignments',
  'api_request_settings',
  'recent_story_global',
  'analysis_prompt',
  'show_floating_launcher',
  'floating_launcher_theme',
]);

const GLOBAL_FIELDS_REGISTRY = Object.freeze(
  Object.fromEntries(
    GLOBAL_FIELDS.map((field) => [
      field,
      Object.freeze({
        scope: 'global',
        domain: LIFECYCLE_DOMAINS.GLOBAL_SETTINGS,
        clear: 'preserve',
      }),
    ]),
  ),
);

// The names here intentionally mirror emptyChat() rather than every possible
// key a caller might put in an arbitrary object.  A new persistent root must
// be added to both the schema and this table; the contract test then fails if
// only one side is changed.
const CHAT_FIELDS = Object.freeze({
  schema_version: Object.freeze({
    scope: 'chat',
    domain: 'structural',
    clear: 'preserve',
  }),
  chat_scope: Object.freeze({
    scope: 'chat',
    domain: 'structural',
    clear: 'preserve',
  }),
  settings: Object.freeze({
    scope: 'chat',
    domain: LIFECYCLE_DOMAINS.CHAT_SETTINGS,
    clearOn: Object.freeze([]),
    clear: 'preserve',
  }),
  data_lifecycle: Object.freeze({
    scope: 'chat',
    domain: LIFECYCLE_DOMAINS.LIFECYCLE_MARKER,
    clearOn: Object.freeze([]),
    clear: 'preserve',
    empty: Object.freeze({}),
  }),
});

// Floor keys are the roots that can occur inside an exact message or
// per-Swipe BioWeave owner.  floor_version is retained for compatibility with
// older callers that persisted it beside analysis rather than inside it.
const FLOOR_FIELDS = Object.freeze({
  v: Object.freeze({
    scope: 'floor',
    domain: 'structural',
    clear: 'preserve',
  }),
  floor_version: Object.freeze({
    scope: 'floor',
    domain: LIFECYCLE_DOMAINS.FLOOR_ANALYSIS,
    clearOn: Object.freeze([]),
    kind: 'binding_metadata',
  }),
  analysis: Object.freeze({
    scope: 'floor',
    domain: LIFECYCLE_DOMAINS.FLOOR_ANALYSIS,
    clearOn: Object.freeze(['character', 'all']),
  }),
  events: Object.freeze({
    scope: 'floor',
    domain: LIFECYCLE_DOMAINS.EVENTS,
    clearOn: Object.freeze(['character', 'all']),
  }),
  character_registry: Object.freeze({
    scope: 'floor',
    domain: LIFECYCLE_DOMAINS.FLOOR_IDENTITY,
    kind: 'authoritative_floor_snapshot',
    clearOn: Object.freeze(['character', 'all']),
  }),
  snapshot: Object.freeze({
    scope: 'floor',
    domain: LIFECYCLE_DOMAINS.FLOOR_ANALYSIS,
    kind: 'derived_checkpoint_cache',
    clearOn: Object.freeze(['character', 'all']),
  }),
  projection_timeline: Object.freeze({
    scope: 'floor',
    domain: LIFECYCLE_DOMAINS.CHARACTER,
    kind: 'append_only_projection_timeline',
    clearOn: Object.freeze(['character', 'all']),
  }),
  world_model: Object.freeze({
    scope: 'floor',
    domain: LIFECYCLE_DOMAINS.WORLD,
    empty: null,
    clearOn: Object.freeze(['world', 'all']),
  }),
  world_model_meta: Object.freeze({
    scope: 'floor',
    domain: LIFECYCLE_DOMAINS.WORLD,
    empty: null,
    clearOn: Object.freeze(['world', 'all']),
  }),
});

// User clear operations are intentionally allowlist-based.  A future Floor
// field is preserved until its ownership and clear semantics are explicitly
// added here; it must never become clearable merely by existing in a Floor.
export const USER_CLEARABLE_FLOOR_FIELDS = Object.freeze({
  character: Object.freeze(['analysis', 'events', 'character_registry', 'snapshot', 'projection_timeline']),
  world: Object.freeze(['world_model', 'world_model_meta']),
  all: Object.freeze([
    'analysis',
    'events',
    'character_registry',
    'snapshot',
    'projection_timeline',
    'world_model',
    'world_model_meta',
  ]),
});

const RUNTIME_FIELDS = Object.freeze([
  'in_flight_analysis',
  'abort_controller',
  'terminal_status',
  'worldbook_cache',
  'tracking_cache',
]);

export const CHAT_SCHEMA_KEYS = Object.freeze(Object.keys(CHAT_FIELDS));
export const FLOOR_SCHEMA_KEYS = Object.freeze(Object.keys(FLOOR_FIELDS));
export const GLOBAL_SCHEMA_KEYS = GLOBAL_FIELDS;

export const CHAT_FIELD_REGISTRY = CHAT_FIELDS;
export const FLOOR_FIELD_REGISTRY = FLOOR_FIELDS;
export const GLOBAL_FIELD_REGISTRY = GLOBAL_FIELDS_REGISTRY;

export const LIFECYCLE_REGISTRY = Object.freeze({
  schema_version: LIFECYCLE_SCHEMA_VERSION,
  global: Object.freeze({
    namespace: 'extensionSettings.bioweave',
    clearable: false,
    fields: GLOBAL_FIELDS,
    fieldRegistry: GLOBAL_FIELDS_REGISTRY,
  }),
  chat: CHAT_FIELDS,
  floor: FLOOR_FIELDS,
  runtime: Object.freeze({
    namespace: 'runtime',
    clearable: false,
    fields: RUNTIME_FIELDS,
  }),
  domains: Object.freeze(Object.values(LIFECYCLE_DOMAINS)),
});

// Compatibility aliases make the ownership table easy to discover from
// runtime code without introducing a second registry.
export const DATA_LIFECYCLE_REGISTRY = LIFECYCLE_REGISTRY;
export const LIFECYCLE_OWNERSHIP_REGISTRY = LIFECYCLE_REGISTRY;

export function getLifecycleRegistry() {
  return LIFECYCLE_REGISTRY;
}

export function getFieldDefinition(scope, field) {
  const table =
    scope === 'global'
      ? GLOBAL_FIELDS_REGISTRY
      : scope === 'chat'
        ? CHAT_FIELDS
        : scope === 'floor'
          ? FLOOR_FIELDS
          : null;
  return table?.[field] ?? null;
}

export function isRegisteredField(scope, field) {
  return Boolean(getFieldDefinition(scope, field));
}

export function getClearableFields(scope, operation) {
  if (scope === 'floor' && USER_CLEARABLE_FLOOR_FIELDS[operation])
    return [...USER_CLEARABLE_FLOOR_FIELDS[operation]];
  const table =
    scope === 'global'
      ? GLOBAL_FIELDS_REGISTRY
      : scope === 'chat'
        ? CHAT_FIELDS
        : scope === 'floor'
          ? FLOOR_FIELDS
          : {};
  return Object.entries(table)
    .filter(([, definition]) => definition.clearOn?.includes(operation))
    .map(([field]) => field);
}

export function getFieldsForDomain(domain, scope = null) {
  const tables = scope
    ? [
        scope === 'global'
          ? GLOBAL_FIELDS_REGISTRY
          : scope === 'chat'
            ? CHAT_FIELDS
            : scope === 'floor'
              ? FLOOR_FIELDS
              : {},
      ]
    : [CHAT_FIELDS, FLOOR_FIELDS];
  return tables.flatMap((table) =>
    Object.entries(table)
      .filter(([, definition]) => definition.domain === domain)
      .map(([field]) => field),
  );
}

export function getAllRegisteredFields(scope) {
  if (scope === 'global') return [...GLOBAL_SCHEMA_KEYS];
  if (scope === 'chat') return [...CHAT_SCHEMA_KEYS];
  if (scope === 'floor') return [...FLOOR_SCHEMA_KEYS];
  return [...CHAT_SCHEMA_KEYS, ...FLOOR_SCHEMA_KEYS];
}

function suppliedKeys(value, fallback) {
  if (Array.isArray(value)) return value.map((key) => String(key));
  if (value && typeof value === 'object') return Object.keys(value);
  return [...fallback];
}

/**
 * Contract-test helper.  It throws instead of returning a soft warning so a
 * newly added persistent root cannot silently escape lifecycle review.
 */
export function assertLifecycleRegistryCoverage({
  chatKeys,
  floorKeys,
  chatSchema,
  floorSchema,
} = {}) {
  const chat = suppliedKeys(chatKeys ?? chatSchema, CHAT_SCHEMA_KEYS);
  const floor = suppliedKeys(floorKeys ?? floorSchema, FLOOR_SCHEMA_KEYS);
  const missingChat = chat.filter((key) => !CHAT_FIELDS[key]);
  const missingFloor = floor.filter((key) => !FLOOR_FIELDS[key]);
  const result = {
    ok: missingChat.length === 0 && missingFloor.length === 0,
    missing: { chat: missingChat, floor: missingFloor },
    classified: {
      chat: chat.filter((key) => Boolean(CHAT_FIELDS[key])),
      floor: floor.filter((key) => Boolean(FLOOR_FIELDS[key])),
    },
  };
  if (!result.ok) {
    const error = new Error('LIFECYCLE_REGISTRY_INCOMPLETE');
    error.code = 'LIFECYCLE_REGISTRY_INCOMPLETE';
    error.missing = result.missing;
    throw error;
  }
  return result;
}

export const validateLifecycleRegistry = assertLifecycleRegistryCoverage;

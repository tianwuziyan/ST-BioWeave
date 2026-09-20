# BioWeave Data Lifecycle

> Status: normative developer contract and audited data map. The current
> checkout implements the registry, Clear Service, source-targeted Start New
> Chat cleanup, mutation invalidation, Settings UI, and automated contract
> tests. Real SillyTavern host acceptance remains a separate required check.

This is the detailed lifecycle contract for BioWeave. The existing
`Floor State Ownership Contract` remains authoritative for Floor ownership;
this document adds the clear, Chat-boundary, mutation-invalidation, and
persistence rules around that ownership. When a later implementation adds a
field, the lifecycle registry is the source of truth: the field must be
classified there and this contract must be re-audited before the implementation
is accepted.

The contract uses **MUST** for an invariant, **MUST NOT** for a forbidden
state transition, and **MAY** only for an explicitly safe compatibility path.

## 1. Scope and audit status

The lifecycle boundary covers:

- extension-global BioWeave settings;
- current-Chat metadata;
- every message-owned and Swipe-owned Floor slot, including inactive and
  historical Swipe slots;
- materialized character, World, Event, Snapshot, Projection, index, and
  tracking state; and
- Runtime and UI transient work that can otherwise write after its owner has
  changed.

The field inventory below was audited against the current checkout's
`storage/schema.js`, `storage/store.js`, `runtime/chat.js`,
`runtime/events.js`, `runtime/event-analysis.js`, `runtime/floor.js`,
`ai/worldbook.js`, and the Core schemas. The current code exposes the Chat
token, exact per-Swipe reads, six-field Floor Version checks, Event provenance
filtering, in-flight analysis maps, worldbook cache generation, the centralized
registry in `storage/lifecycle.js`, and the shared Clear Service in
`storage/clear.js`. The registry and schema are the source of truth for future
additions; a field is not complete until both are updated and the contract
tests pass.

The pinned SillyTavern/ST-SevenDaysCal lifecycle audit recorded the following
host sequence for the release used by the task:

1. `doNewChat()` waits for the current save, clears the in-memory Chat,
   changes the character Chat filename, and calls `getChat()`.
2. `getChatResult()` loads or creates the target Chat and emits
   `CHAT_CHANGED` with the new current Chat identity.
3. The official `CHAT_CREATED` event is emitted only when the load produced a
   fresh first message. Its payload does not carry a cancellable pre-new-chat
   source identity.
4. The audited host has no cancellable pre-new-chat extension event. The
   `clearChat({ clearData: true })` path also does not provide one.

This host evidence is a design premise to verify again in the target
SillyTavern build. It explains why a bare `CHAT_CREATED`, a bare
`CHAT_CHANGED`, or a button label cannot authorize destructive cleanup.

## 2. Non-negotiable invariants

1. `extensionSettings.bioweave` and the SillyTavern Secret Store are outside
   every Chat-local clear operation.
2. Chat text, Swipe text, and unrelated host/plugin fields are preserved by
   every BioWeave clear operation.
3. A Floor fact belongs to the exact message owner or exact
   `swipe_info[swipe_id]` owner whose complete six-field Floor Version produced
   it. A Chat-level projection or Runtime cache cannot become a second source.
4. Ordinary `CHAT_CHANGED`, existing-Chat loading, refresh, initialization, and
   character switching load or rebind owners. They preserve the source Chat.
5. Only a verified, one-shot Start New Chat transition may destructively clear
   source Chat A. The source identity is captured before the boundary and is
   never resolved from the mutable current Chat after the boundary.
6. Every derived value and API historical input is rebuilt from current,
   version-valid Floor facts. A deleted, Swipe-inactive, or stale fact has no
   valid provenance.
7. Every asynchronous operation carries an owner and epoch boundary. Abort is
   attempted, but the commit guard remains authoritative when a host ignores
   `AbortSignal`.
8. A persistence operation reports `confirmed`, `failed`, or `unknown` state.
   Only a confirmed save may be reported as success.

## 3. Ownership map

| Owner | Actual location | Owned meaning | Lifecycle treatment |
| --- | --- | --- | --- |
| Extension-global settings | `SillyTavern.getContext().extensionSettings.bioweave` | API source, API Profiles, opaque Secret references, task assignments, request settings, prompts, model-list caches, and global recent-story regex | Preserved by all Chat and Start New Chat operations |
| Chat-local metadata | `context.chatMetadata.bioweave` (also exposed as `chat_metadata.bioweave` by some host code) | Chat settings, materialized character/tracking projections, relationships, indexes, lifecycle markers, and ignored legacy World Model residue | Targeted by Manual Clear; source-targeted by verified Start New Chat; legacy World Model fields are never a runtime source |
| Ordinary-message Floor | `message.extra.bioweave` when the message has no Swipe structure | Analysis, Events, identity snapshot, Snapshot, and Projection for that message Floor | Read/write only through the storage abstraction; full clear removes the owned root |
| Per-Swipe Floor | `message.swipe_info[swipe_id].extra.bioweave` when Swipe structure exists | Independent analysis and derived Floor data for that exact Swipe | Every existing slot is enumerated; active selection never authorizes fallback to another slot |
| Runtime transient | Runtime/UI memory: tokens, epochs, AbortControllers, in-flight maps, terminal maps, caches, refresh chains, drafts, and status DTOs | Transient work, read projections, diagnostics, and cache acceleration | Abort, invalidate, and discard on owner changes; never a persistent fact source |

For a structured message, `swipe_info[0]` is a real owner just like every
other Swipe. The lifecycle walker MUST include Swipe 0, inactive Swipes, and
historical Swipes still present in the host object. `message.extra.bioweave`
is not a fallback for a structured message. If a host leaves an owned
BioWeave mirror there, a full clear inspects and removes that mirror as
cleanup, but ordinary reads never use it as Floor provenance.

The host message text (`mes`, `content`, or equivalent), `swipes[]` text,
other `message.extra` keys, other `swipe_info[*]` keys, other
`chatMetadata` keys, and all unrelated plugin data are not BioWeave clear
targets.

## 4. Audited schema and locations

### 4.1 Extension-global `extensionSettings.bioweave`

The canonical normalized global fields in `storage/schema.js` are:

| Field | Shape and ownership |
| --- | --- |
| `api_source` | `sillytavern` or `bioweave`; global API source selector |
| `default_profile_id` | Nullable stable Profile ID; global default |
| `api_profiles` | Map of Profile IDs to `{profile_id, name, provider, api_url, model, context_size, max_output_tokens, temperature, secret_ref}` |
| `api_model_caches` | Map of existing Profile IDs to `{profile_id, models[], refreshed_at}`; global model-list cache |
| `assignments` | `{world_analysis, event_analysis, projection, history_scan}`; each value is `default`, `sillytavern`, a stable Profile ID, or `null` |
| `api_request_settings` | `{timeout, retry_count}`; timeout is an integer in milliseconds and retry count is an integer from 0 through 3 |
| `analysis_prompt` | `{system_top, task, input_prefix, input_suffix, system_bottom, labels{character, worldbooks, recent_story, external_memory}}` |
| `recent_story_global` | `{regex_rules[]}` only; global rules apply before Chat-local rules |
| Other normalized extension fields | Extension-global configuration retained by the normalizer; a future field requires registry classification before persistence |

`world_analysis_prompt` is a legacy read compatibility source. Canonical
saves use `analysis_prompt`; neither name becomes Chat-local data.

API Profile `secret_ref` is an opaque reference only. The API key value is
owned by the host Secret Store and is never copied into Chat metadata, a
message or Swipe Floor, Event, Snapshot, Projection, log, export, prompt
preview, or lifecycle snapshot.

**Global preservation rule:** no Manual Clear, source Chat cleanup, mutation
invalidation, Chat switch, refresh, initialization, or character switch may
read-modify-write this root as a deletion side effect. The clear service MUST
not call Secret Store read, write, delete, or cleanup APIs. Contract tests MUST
deep-compare the global fixture before and after every clear operation and spy
on the Secret Store for zero calls.

### 4.2 Chat-local `chatMetadata.bioweave`

`emptyChat(chatId)` in `storage/schema.js` defines the current Chat root:

| Field | Current schema shape | Lifecycle classification |
| --- | --- | --- |
| `schema_version` | Numeric schema marker | Structural; retained/reset to the clean schema |
| `chat_scope.chat_id` | `{chat_id}` | Structural owner binding; always matches the target Chat |
| `character_profiles` | Character ID keyed object | Chat-level character projection |
| `character_registry` | `{schema_version: 1, entities: {…}}` | Chat-level materialized projection/cache; never ordinary historical input |
| `tracking_subjects` | Character ID keyed active-subject index | Character-derived projection |
| `tracking_candidates` | Character ID keyed pending-exposure index | Character-derived projection |
| `relationships` | Array | Character-derived projection |
| `settings` | See the nested inventory below | Chat configuration; preserved by Character and World clear |
| `index` | `{snapshot_floors[], last_processed_floor}` | Derived scheduling/index hint |
| `data_lifecycle` | `{character_reset: {chat_id, message_id, message_index, floor, created_at} | null}` | Lifecycle marker; the registry defines its reset semantics |

The `data_lifecycle.character_reset` marker is a Chat-local rebuild boundary.
Character clear records the last existing message identity and index, so
historical Events remain physically available but cannot immediately
repopulate the cleared projection. Clear All resets the marker with the clean
Chat shape. The registry, not a field-name convention, defines this behavior.
When Character clear runs in an empty Chat, the marker stores
`message_index: -1`, an explicit boundary before the first future message.
A Floor that existed at the boundary may re-enter the derived projection only
after a successful analysis completed after the reset marker was created;
older unchanged facts at that boundary remain excluded.

The current `settings` object is:

```text
enabled
analysis_interval
snapshot_interval
projection_enabled
retry_failed_analysis
context_injection: { enabled, max_tokens }
worldbooks: { mode, selected[] }
recent_story: { enabled, floor_count, regex_rules[], regex_user_enabled }
external_memory: { anima, baobaoshu, database_memory }
prompts: { prefix, suffix, task }
```

`worldbooks.selected[]` contains stable source and child identifiers. A
Worldbook child is `{source_id, entry_id, enabled}`; a Character Card field is
`{source_id, field_key, enabled}`. Source content, labels, request headers,
and token estimates are Runtime/source-loader data, not persisted Chat
facts.

The current `world_model` schema is the final nested field set below:

```text
world_model:
  schema_version
  species[]:
    name
    description
    biological_types[]:
      name
      description
      capabilities:
        can_produce_sperm
        can_produce_ova
        can_be_fertilized
        can_fertilize
        can_carry_pregnancy
      reproduction_rules:
        fertilization
        pregnancy_or_carrying
        cycle
        ovulation
        gestation
        labor
      lifecycle: { maturation, aging }
      special_rules[]
  medical_context: { childbirth_difficulty, care_level, evidence }
  exceptions[]
  unknowns[]
```

World Model scalar capability and rule values retain the existing `null`,
known absence, or known-text semantics. Lifecycle clearing does not alter
those domain meanings.

`character_profiles` contains the normalized Event-derived profile projection
currently produced by `core/tracking.js`; `tracking_subjects` stores stable
character indexes and Event ID references; `tracking_candidates` stores
pending exposure records, Story Time, Floor/Swipe source, identity,
capabilities, and evidence. Their detailed business fields are owned by the
Event/Tracking contracts, not guessed by the clear walker. The registry
classifies each root even when a root has no independent fixed schema.

### 4.3 Floor and Swipe roots

`emptyFloor()` in `storage/schema.js` defines the current Floor root:

```text
v
floor_version
analysis
events[]
character_registry
world_model
world_model_meta
history
snapshot
projections[]
```

The root is stored in `message.extra.bioweave` for an ordinary message, or in
the exact `message.swipe_info[swipe_id].extra.bioweave` slot for a structured
message. `analysis` currently contains the successful or terminal attempt
record, including `status`, the bound `floor_version`, attempt timestamps and
diagnostic/last-attempt fields as produced by `runtime/floor.js` and
`runtime/event-analysis.js`. A failed attempt may retain `last_success`; a
stale version never makes that old success active.

`world_model` and `world_model_meta` are World-domain fields in the same exact
Floor/Swipe owner. They are not Chat-level runtime state. World Model saves
replace only these two fields and preserve `analysis`, `events`,
`character_registry`, `history`, `snapshot`, and `projections`. Character/Event
saves replace only their own fields and preserve the World fields. The shared
Floor container does not merge these business owners.

The canonical `events[]` field set from `core/events.js` is:

```text
event:
  schema_version
  event_id
  type
  status
  location
  participants[]:
    character_id
    display_name
    event_role
    biological_context: { species, biological_type }
    reproductive_capabilities_used:
      can_produce_sperm
      can_produce_ova
      can_be_fertilized
      can_carry_pregnancy
      can_cause_pregnancy
    evidence[]: { kind, text }
  pregnancy_relevance:
    relevant
    possible_conception
    gestational_subject_ids[]
    counterpart_ids[]
    confidence
  source_evidence[]: { kind, text }
  physical_effect: { gestational_substance_intake }
  source:
    chat_id
    message_id
    floor
    swipe_id
    content_hash
    message_version
  story_time:
    display
    normalized
    day_index
    calendar_id
    provider
    precision
    confidence
```

For pregnancy-related `sexual_activity`, identity, participant closure, and
subject-local Event rules remain those of the Event Pipeline contract. The
lifecycle contract only determines whether the owning Floor/Swipe remains
valid and whether the Event can contribute to derived state.

`floor.character_registry` has the normalized shape
`{schema_version: 1, entities: {[character_id]: entry}}`. Each entry contains
`character_id`, `display_name`, and `aliases[]`. It is a cumulative canonical
identity snapshot owned by that successful Floor. It is not the same as the
Chat-level `character_registry` projection.

The only formal new `character_id` shape is `char_` plus six decimal digits,
from `char_000001` through `char_999999`. Runtime allocates it from the
selected previous surviving snapshot; it does not use a Chat-global counter,
name-derived value, UUID, timestamp, random value, migration, or tombstone.
Development-era IDs are outside the current Contract and are not read or
migrated by the production identity path.

`floor_version` is a binding-metadata compatibility root. It is not an
independent Floor fact and never replaces the six-field Version checks. The
working-tree schema also reserves `history` as a Floor root, but the connected
State/Snapshot/Projection reducer and a separate historical table are not
present. Both roots are classified by the registry so a later implementation
cannot bypass lifecycle semantics.

`snapshot` and `projections[]` are current schema slots. Their fields still
require registry classification. Because the current slots do not establish a
uniform per-record dependency key, a targeted clear must remove a slot
conservatively whenever the registry cannot prove that an entry is
independent; it must never preserve an untraceable or world-dependent record
by guesswork.

### 4.4 Runtime transient state

Runtime memory is disposable and is never an alternate persistence layer. The
current audit identified these owners:

- `runtime/event-analysis.js`: `inFlight` keyed by the complete Floor
  Version, `lastTerminal`, `attemptSequence`, `registryRefreshChain`, and the
  `AbortController` and terminal status held by each execution;
- `ai/worldbook.js`: `list`, `contents`, `inFlight`, `listInFlight`, and
  `generation` in the worldbook cache;
- `runtime/chat.js`: active Chat identity, `{chatId, epoch}` token, and
  boundary subscribers;
- `ui/app.js`: route/focus, `settingsState`, `businessState`, analysis-source
  state, source-save chains/timers, request sequences, World Model drafts and
  AbortController, preview state, and Popup-confirmation guards.

Clear and Chat-boundary handling invalidates the relevant Runtime owners,
advances the epoch, clears stale caches/status entries, and rebuilds business
state from current valid storage. Runtime state is never sufficient proof that
a clear or save succeeded.

## 5. Lifecycle registry and ownership contract

The registry is the single declaration of domain, owner, location, and
lifecycle action. It is not a second storage layer and it does not authorize
recursive deletion. The current domain vocabulary is:

| Domain | Current fields/locations | Ownership and lifecycle |
| --- | --- | --- |
| `global_settings` | `extensionSettings.bioweave` and its recognized fields | Guarded, global, never clearable by this contract |
| `chat_settings` | `chatMetadata.bioweave.settings` | Chat configuration; preserve for Character/World clear, reset for All |
| `world` | Floor `world_model`, Floor `world_model_meta`; future explicit world references | Floor-owned World Model history; clear World and All across exact message/Swipe owners |
| `character` | Chat `character_profiles`, Chat `character_registry`, `tracking_subjects`, `tracking_candidates`, `relationships`; character-dependent derived records in Floor `snapshot`/`projections` | Current character projection; clear Character and All; rebuild only from valid facts after a reset boundary |
| `events` | Floor `events[]` in the exact message/Swipe owner | Historical/causal Floor facts; preserve for Character/World clear, remove for All/source clear, invalidate by provenance |
| `floor_analysis` | Floor `analysis` | Attempt/result metadata bound to a Floor Version; preserve for Character/World clear, invalidate when Version/owner is stale, remove for All/source clear |
| `floor_identity` | Floor `character_registry` | Floor-owned canonical identity snapshot; preserve for Character/World clear while its Floor remains valid, remove for All/source clear |
| `lifecycle_marker` | Chat `data_lifecycle.character_reset` | Rebuild boundary metadata; preserve/update for Character clear, reset for All |
| `snapshot` | Floor `snapshot` | Derived historical/state slot; targeted by registry dependency, removed by All/source clear |
| `projection` | Floor `projections[]` and Chat `index` hints | Materialized derived state; targeted by registry dependency, rebuilt from current valid facts, removed by All/source clear |
| `history` | Reserved Floor root `history` (currently an empty/null compatibility slot); no connected historical table/reducer | Semantic category for future history fields; current historical facts are Floor `events[]` and Floor identity snapshots, each subject to provenance |
| `runtime_cache` | Runtime/UI maps, chains, drafts, controllers, and status DTOs | Transient; abort/invalidate/discard, never a clearable fact source |
| `all` | The complete current Chat BioWeave root plus every owned message and Swipe root | The union of all Chat-local/Floor-local BioWeave domains; excludes global settings, Secret Store, text, and unrelated fields |

`chat_scope.chat_id` and `schema_version`/`v` are structural markers. A clear
operation writes the clean structural shape for the target owner; it does not
delete the identity marker needed to keep the data scoped.

### Registry enforcement

Contract tests MUST enumerate every key in `emptyChat(chatId)` and
`emptyFloor()` and require a registry classification. The fixture MUST also
cover nested persistent fields that the schema owns, including all World Model
fields, Chat settings, index hints, Event fields, identity snapshots, and all
Swipe roots. A newly persisted key without a domain, owner, exact location,
clear behavior, mutation behavior, Swipe behavior, provenance rule, async
guard, failure policy, and test is a contract failure.

The current implementation includes the versioned
`data_lifecycle.character_reset` boundary, `floor_version`, the reserved
`history` root, dependency provenance for analysis results, and source
transition ownership metadata. Any future root must be added to the registry
before it is persisted; the contract test is intentionally fail-closed for an
unregistered schema key.

## 6. Clear operations

### 6.1 Common clear-engine sequence

Manual clear and verified Start New Chat source cleanup MUST use the same
registry-driven removal plan and coverage. They differ only in the owner
adapter: Manual Clear targets the current Chat; Start New Chat targets the
captured source Chat identity.

The clear engine follows this sequence:

1. Resolve an immutable target owner. Capture the current `{chatId, epoch}`
   token for a current-Chat operation, or validate the source identity and
   transition token for a source operation.
2. Read the latest owned Chat root and enumerate every message and every
   existing Swipe slot through the storage abstraction. Build a plan only
   from registry-listed fields; preserve text and unrelated host/plugin keys.
3. Capture the previous owned values required for known-failure rollback.
   A source snapshot is bounded and contains identity, revision, and rollback
   material only; it is never a whole-Chat replacement payload.
4. Abort and invalidate work owned by the target, advance its epoch, and
   invalidate derived/cache entries before applying the plan.
5. Reassert the owner immediately before mutation. A current-Chat operation
   rejects a changed token. A source operation rechecks the captured source
   identity and revision, not the mutable current Chat.
6. Apply exact Chat fields and exact message/Swipe BioWeave roots. A full
   clear removes BioWeave roots from all ordinary messages and all
   `swipe_info[*]` slots while preserving their surrounding objects.
7. Persist through the storage-layer mutation boundary. Source cleanup uses a
   source-targeted save adapter that reads the latest source and merges the
   exact owned removals; it never calls a mutable-current-Chat save with the
   old source snapshot.
8. Await persistence and reassert the intended owner. A confirmed result
   clears stale Runtime/UI projections and triggers a rebuild from current
   valid facts.
9. Return a structured result. A known save failure restores the captured
   in-memory state without a blind compensating write. An unknown commit state
   remains unknown and is never reported as success.

A repeated clear is idempotent and returns `ok: true, changed: false` when the
target already has the requested clean state. A stale or ambiguous owner is a
failed/no-op result; it is never a destructive guess.

The stable result shape is:

```js
{
  ok: true,
  changed: true,
  operation: "character" | "world" | "all",
  domain: "character" | "world" | "all",
  chatId: "target-owner-id",
  removed: {
    chatFields: [],
    floorSlots: 0,
    swipeSlots: 0,
    messageExtraSlots: 0,
    floorFields: [],
  },
  invalidated: {
    runtime: true,
    domains: [],
  },
  persistence: {
    commitState: "confirmed",
    attempted: true,
    partial: false,
  },
  previousSnapshot: { chatRoot: null, slots: [] },
  error: null,
}
```

Failure results retain the same shape with `ok: false`, a stable error code,
and `commitState: "failed"` or `"unknown"`. The UI shows success only for
`ok: true` with confirmed persistence.

### 6.2 Manual Character clear

The Character operation removes the current Chat's materialized character
state:

- Chat `character_profiles`, Chat `character_registry`,
  `tracking_subjects`, `tracking_candidates`, and `relationships`;
- character-derived `index` entries and character-dependent Floor
  `snapshot`/`projections` identified by the registry; and
- character Runtime caches, in-flight work, and derived UI state.

It preserves:

- Floor `world_model`, Floor `world_model_meta`, Chat `settings`, and
  independent Chat configuration;
- Floor `analysis`, Floor `events[]`, and valid Floor-owned
  `character_registry` identity snapshots;
- Chat text, all Swipe text, unrelated fields, global settings, and the Secret
  Store.

Because a Runtime rebuild from valid Events could otherwise repopulate the
projection immediately, the implementation persists the bounded, versioned
`character_reset` boundary described above. The marker is a rebuild boundary,
not a second fact source: post-reset Floors may create new projection state,
including a boundary Floor only after it is successfully reanalyzed after the
reset; old unchanged facts remain historical and provenance-bound.

### 6.3 Manual World clear

The World operation removes from every existing exact message/Swipe Floor
owner:

- Floor `world_model` and `world_model_meta`;
- the derived index hint as classified by the registry; and
- World-dependent Floor `snapshot`/`projections` entries, or the whole
  derived slot when exact dependency preservation cannot be proven.

It preserves Chat settings, independent character projections, Floor Events,
Floor analysis, Floor identity snapshots, Chat/Swipe text, unrelated data,
global settings, and the Secret Store. It does not clear or rewrite
Character/Event-owned Floor fields during the World-domain operation.

The audit found no current persisted `world_entity_id`, `rule_id`, or
equivalent foreign-key field in the Character or Tracking schema. Therefore
the current schema has no World foreign key to rewrite. Any future
world-derived Character reference MUST be registered with an explicit clear
or dirty/rebuild rule before it is accepted; a dangling reference is never
silently retained.

### 6.4 Manual Clear All

Clear All removes only the BioWeave Chat-local namespace:

- replace `chatMetadata.bioweave` with the clean `emptyChat(chatId)` shape;
- remove the BioWeave root from every ordinary `message.extra.bioweave` owner;
- remove the BioWeave root from every existing
  `message.swipe_info[swipe_id].extra.bioweave` owner, including Swipe 0,
  inactive Swipes, and historical Swipes; and
- invalidate all character, World, Event, analysis, identity, Snapshot,
  Projection, index, tracking, cache, and UI-derived state for that Chat.

The walker preserves all surrounding host objects: Chat metadata outside the
BioWeave key, message bodies, every Swipe body, other `extra` keys, other
Swipe fields, and unrelated plugin data. It never touches
`extensionSettings.bioweave` or the Secret Store. Manual Clear All and the
verified Start New Chat source operation MUST have identical BioWeave-owned
removal coverage in contract tests.

### 6.5 Clear matrix

| Target | Chat metadata removed/reset | Floor/Swipe treatment | Facts/projections retained | Runtime and global treatment |
| --- | --- | --- | --- | --- |
| Character | Character projection roots, character-derived index, and any registered reset boundary | Remove registered character-facing Snapshot/Projection data in every message and every Swipe owner | World Model, settings, Events, analysis, valid Floor identity snapshots, text, Swipe text, unrelated fields | Abort/invalidate character work; preserve global settings and Secret Store |
| World | Floor `world_model`, Floor `world_model_meta`, World-derived index/reference state | Remove or conservatively invalidate World-dependent Snapshot/Projection data in every message and every Swipe owner | Character projection, settings, Events, analysis, valid Floor identity snapshots, text, Swipe text, unrelated fields | Abort/invalidate World/cache work; preserve global settings and Secret Store |
| All | Replace Chat BioWeave root with clean scoped schema | Remove every BioWeave root from every ordinary message and every Swipe slot | Chat metadata outside BioWeave, text, Swipe text, unrelated plugin fields | Abort/invalidate all work; preserve global settings and Secret Store |
| Start New source A | Same All plan, applied to immutable source A | Same All traversal across A's metadata, ordinary messages, and all Swipe slots | A's text, Swipe text, unrelated fields, and global settings | A is invalidated; B is loaded clean and is never the source target |

## 7. User-facing clear boundary

Manual clear is exposed only in BioWeave Settings under the independent
`数据管理` section. It has exactly three operations: clear Character, clear
World, and clear All. Each operation states the current-Chat deletion and
retention scope using the matrix above.

The UI delegates to the clear service/runtime facade. It does not name or
delete storage fields. Each operation uses the existing host Popup confirmation
and Toast path, disables the three actions while an operation is pending,
prevents duplicate invocation, reports no-op/success/failure distinctly, and
refreshes the empty or rebuilt state only after confirmed persistence.

The three confirmation messages are intentionally operation-specific. The
current production copy is:

```text
人物：当前 Chat「{chatId}」的人物数据将被永久删除且不可撤销：删除人物当前状态、tracking、人物派生结果和人物 runtime cache；聊天正文、所有 Swipe 正文、事件/楼层分析、其它插件 chat/message/swipe extra、API / Secret / 全局设置均保留。确定继续吗？
世界：当前 Chat「{chatId}」的世界数据将被永久删除且不可撤销：删除 World Model、世界派生引用和世界 runtime cache；人物独立数据、事件/楼层分析、聊天正文、所有 Swipe 正文、其它插件 chat/message/swipe extra、API / Secret / 全局设置均保留。确定继续吗？
全部：当前 Chat「{chatId}」的全部 BioWeave 数据将被永久删除且不可撤销：删除 Chat-local、Floor-local、Swipe-local 与 derived BioWeave 数据；聊天正文、所有 Swipe 正文、其它插件 chat/message/swipe extra、API / Secret / 全局设置均保留。确定继续吗？
```

`{chatId}` is replaced by the current Chat label at render time. Any copy
change MUST preserve the operation-specific deletion/retention boundary and
remain synchronized with `ui/app.js` and the UI framework contract.

Start New Chat has no BioWeave button and no additional BioWeave confirmation.
The native SillyTavern Start New Chat action is the only user trigger. Its
source cleanup is authorized by the lifecycle evidence proof in the next
section, not by UI text, a DOM listener, or a second confirmation dialog.

## 8. Chat lifecycle and source ownership

### 8.1 Ordinary Chat boundary

`CHAT_CHANGED` is a loading/rebinding boundary. It does not imply a new Chat
and never calls a destructive clear by itself.

The following paths preserve their source Chat and load only the target owner:

- selecting an existing Chat;
- a bare `CHAT_CHANGED` event;
- page refresh or plugin initialization;
- switching characters or groups;
- reopening or remounting the UI; and
- returning to a previously existing Chat.

The storage read is scoped by `chat_scope.chat_id`. A target with no matching
BioWeave root receives the clean default shape; a source Chat remains stored
exactly as it was. Pending work owned by the old Chat is aborted/invalidated,
and a late result fails its owner/epoch guard.

### 8.2 Verified Start New Chat A to B

Start New Chat is a destructive source-A `Clear All` operation followed by a
clean target-B load. It removes BioWeave-owned Chat metadata and every
message/Swipe Floor root from A while preserving A's text and unrelated data;
B starts with the clean default BioWeave state and is never used as A's clear
target. The source owner is locked before the host boundary and remains the
target even after the current Chat becomes B.

The one-shot transition token is created only when all available evidence
agrees:

1. Source A is the active owner with a valid, non-stale boundary token and a
   bounded source snapshot.
2. The pre-boundary Chat index came from the official host Chat-list/context
   adapter. Target B has a different immutable identity and was absent from
   that index.
3. The immediately preceding boundary is paired with the official
   `CHAT_CHANGED(B)` and then the official `CHAT_CREATED(B)` for the same
   target.
4. Character/group ownership is unchanged. If the host adapter exposes an
   explicit freshness result, it must not report `false`; in the audited
   release the official creation event paired with B's absence from the
   pre-boundary index is the available freshness proof.
5. The transition token is current, not superseded, and not consumed.

Missing, contradictory, or out-of-order evidence fails closed: no source
clear is attempted. In particular:

- `CHAT_CREATED` alone never clears a Chat;
- `CHAT_CHANGED` alone never clears a Chat;
- an existing Chat load, refresh, initialization, or character switch never
  creates a destructive transition; and
- button text, DOM selectors, an empty message array, or a filename heuristic
  never proves user intent.

After B is current, the coordinator:

1. aborts/invalidate work owned by A;
2. consumes the one-shot transition token only after the complete proof;
3. reads the latest persisted A through an immutable source-targeted adapter;
4. revalidates A's identity and latest source revision; the captured revision
   remains transition evidence, while a custom adapter may additionally enforce
   it as a server CAS;
5. merges exact BioWeave-owned removals into that latest A state; and
6. awaits a source-targeted save and verifies A again.

The source snapshot is used only for identity, revision comparison, owner
verification, and known-failure rollback. It is never written back as a
whole-Chat replacement. The latest-source read and field-level merge preserve
Chat A message text, every Swipe text, unrelated plugin fields, and safe
boundary-time updates. If latest-source verification or exact field merging
is unavailable, the operation fails closed without writing A or B.

There is no cancellable pre-new-chat host hook in the audited release. If host
transition has already completed and source persistence fails, the coordinator
cannot retroactively cancel that host transition. It reports failed or
unknown source cleanup, leaves B untouched, records the source owner and result
for an explicit owner-targeted retry/diagnostic path, and never reports
success or redirects cleanup to B.

The lifecycle flow is:

```text
active A
  -> capture A identity/revision + pre-boundary Chat index
  -> host boundary
  -> CHAT_CHANGED(B): bind/load B, abort A work, no destructive clear
  -> CHAT_CREATED(B): pair official evidence with one current transition token
  -> latest-read A by immutable identity
  -> exact BioWeave-owned field merge on A
  -> source-targeted save + post-save A verification
  -> B remains clean; current Runtime owner is B
  -> returning to A shows preserved text/unrelated data and empty BioWeave
```

## 9. Message, Event, Floor, and Swipe mutation

### 9.1 Floor Version and previous resolution

The authoritative Floor Version contains exactly:

```text
chat_id, message_id, floor, swipe_id, content_hash, message_version
```

`runtime/floor.js` computes the content hash from the current selected message
or Swipe text. An Event is active only when its complete `source` exactly
matches the current Floor Version and the owning message/Swipe still exists.

For a target Floor, Runtime scans older current messages and selects the
nearest candidate only when all of these are true:

1. the message still exists;
2. its current active Swipe is selected;
3. the exact owner slot is readable through `storage/store.js`;
4. the stored and recomputed six-field Floor Versions match;
5. `analysis.status` is `success`;
6. the candidate Floor is lower than the target; and
7. its Events and identity snapshot pass current provenance validation.

When no candidate passes, the API receives the exact empty previous shape:

```json
{
  "analysis": null,
  "events": [],
  "character_registry": { "schema_version": 1, "entities": {} }
}
```

The target's old analysis, a stale Chat projection, `last_processed_floor`, a
deleted registry entry, another Swipe, and a Runtime cache are never previous
state. `last_processed_floor` is a scheduling hint only.

### 9.2 Mutation invalidation matrix

| Lifecycle input | Required invalidation and preservation |
| --- | --- |
| `MESSAGE_EDITED` or regenerated text | Recompute the affected Floor Version; make the old active-slot analysis and Events inactive; invalidate downstream active-path derived data from the earliest affected Floor; retain a non-active Swipe slot only when its own text and provenance are unchanged |
| `MESSAGE_DELETED` or history truncation | Identify the earliest changed message by stable identity/sequence, remove ownership of the deleted message, invalidate every downstream active-path Floor/derived result, and rebuild from surviving current owners; never recreate the deleted message or facts from an index |
| `MESSAGE_SWIPED` | Select only the new active Swipe's exact owner, invalidate downstream derived state whose dependency chain changed, preserve independent non-active Swipe analysis when its source is unchanged, and rebuild Chat-level projections from the new active path |
| `MESSAGE_SWIPE_DELETED` | The deleted Swipe contributes no Floor, previous state, Event, or derived reference; preserve other existing Swipe owners and rebuild the active path |
| direct Event edit | Preserve `event_id` and authoritative `source`, validate the complete affected Event collection atomically, save through the Floor abstraction, and rebuild Tracking/projections from valid Events |
| direct Event delete | Remove the Event from its owning Floor collection and rebuild all derived references; dangling Event IDs are removed |
| any mutation during analysis | Abort/invalidate affected execution and require owner, epoch, and Floor Version checks before a response can commit |

New analysis results carry dependency provenance for the active Floor-Version
chain. A retained non-active Swipe result is reusable after switching back
when its source Floor Version is still valid; dependency changes still
invalidate downstream Chat-level state. A result without provenance is treated
conservatively and is not allowed to reintroduce downstream state.

The mutation flow is:

```text
host message/Swipe change
  -> read current message collection and exact owner slots
  -> compare stable identity + six-field Floor Versions
  -> locate earliest affected Floor
  -> abort affected work and advance epoch
  -> invalidate stale downstream sources/projections
  -> retain only independent unchanged Swipe owners
  -> rebuild Events/Tracking/Character/World-dependent projections
  -> persist the safe invalidation through the storage boundary
```

## 10. Async ownership, abort, and late commits

Every analysis, clear, source transition, cache refresh, and Chat-local save
captures:

- `chatId` and the current Chat epoch;
- target message/Floor/Swipe identity where applicable;
- the complete Floor Version or source revision where applicable; and
- the one-shot transition token for Start New Chat.

Before API result handling, derived rebuild, Floor write, Chat write, or
post-save success notification, the operation MUST assert the same owner and
epoch. It MUST also assert the target's current six-field Floor Version for a
Floor operation, or the immutable source identity/revision for a source
operation.

Clear, Chat changes, message edits/deletions, and Swipe changes abort in-flight
work where possible, advance the relevant epoch, remove stale terminal/cache
entries, and rebuild from current storage. A host that ignores abort is still
safe because the late result fails the commit guard. No late API result may
write into Chat B, repopulate a cleared Chat, or revive a deleted/stale
message, Swipe, Event, projection, or tracking subject.

Worldbook source cache invalidation uses its generation boundary. Source
refresh results from an older generation cannot write into the new Chat or
source selection. UI request sequences and drafts are presentation state; they
cannot authorize a storage commit.

## 11. Persistence outcomes and rollback

The storage adapter is the only business writer for Chat and Floor data. A
clear or invalidation operation has three explicit persistence outcomes:

| Commit state | Meaning | Required behavior |
| --- | --- | --- |
| `confirmed` | The host save resolved and the intended owner was revalidated after the save | Return `ok: true`; clear stale Runtime/UI state and rebuild |
| `failed` | The host reported a known rejection before an ambiguous commit | Restore captured in-memory values when safe, return `ok: false`, retain a stable error code, and show failure feedback |
| `unknown` | Timeout, disconnect, or host behavior leaves commit state ambiguous | Do not report success; do not blindly compensate or overwrite from an old snapshot; re-read/retry only through an explicit owner-targeted path |

Known-failure rollback is an in-memory restoration of the exact captured
owned values. It is not a blind second save that could overwrite concurrent
host changes. For source A, a failed/unknown cleanup remains associated with A
and is recorded for an explicit owner-targeted retry/diagnostic path. The
current Chat B is never used as a substitute target and B is never modified to
hide an A failure.

Analysis cancellation and stale-owner exits preserve a prior successful
Floor result for diagnostics when it remains stored, but the old result is
inactive after a Floor Version change. A failed force refresh does not replace
the previous success with partial Events.

## 12. Lifecycle flow summary

The complete owner-to-sink flow is:

```text
host Chat/message/Swipe state
  -> current owner resolution
  -> exact Chat/Floor storage read
  -> six-field Floor Version + provenance validation
  -> current valid Events/identity facts
  -> derived Tracking/Character/World/Snapshot/Projection/API input
  -> UI business projection
```

For a clear operation, insert the following owner-safe boundary:

```text
resolve target owner
  -> capture token/revision + rollback values
  -> abort/invalidate transient work
  -> registry-driven exact clear plan
  -> owner assertion
  -> field-level mutation preserving host data
  -> awaited persistence
  -> post-save owner assertion
  -> confirmed result or explicit failed/unknown result
  -> rebuild from current valid owners
```

The source of truth is always the current host message/Swipe collection and
the exact storage owner. A cache, index, snapshot used as a whole-chat
replacement, Chat-level historical map, or old Runtime DTO cannot bypass this
flow.

## 13. Future Definition of Done

The lifecycle implementation is complete only when every row has code,
contract-test evidence, and an honest host-validation status. The registry is
the source of truth for the paths used by each answer.

| Gate | Required answer and evidence |
| --- | --- |
| Domain | Every persisted field is assigned to exactly one primary lifecycle domain; `history` is represented only by real owner fields, not an invented ledger |
| Ownership | Each value identifies its owner as global, Chat, message, exact Swipe, derived, or Runtime transient, with a clear owner assertion |
| Location | The exact storage path is listed, including `chatMetadata.bioweave`, `message.extra.bioweave`, and every `message.swipe_info[*].extra.bioweave` slot |
| Manual clear | Character, World, and All use one registry-driven Clear Service; the matrix proves deletion and retention for each domain |
| New Chat | Existing Chat and ordinary `CHAT_CHANGED` preserve source; only a one-shot transition proven by source snapshot, pre-boundary index, official lifecycle evidence, target freshness, and owner identity clears source A |
| Mutation | `MESSAGE_EDITED`, `MESSAGE_DELETED`, and history truncation locate earliest affected provenance and invalidate downstream active-path state without recreating deleted owners |
| Swipe | Swipe 0 and every historical/inactive Swipe are covered; switching preserves independent unchanged sources, deleting removes only the deleted owner, and no fallback crosses Swipe boundaries |
| Provenance | Every active Event, identity snapshot, projection reference, and API historical fact points to a current six-field Floor Version and existing owner |
| Async | Analysis, clear, cache refresh, and UI/runtime operations carry owner/epoch/revision checks; abort and late-commit guards are tested |
| Failure | Confirmed, failed, and unknown persistence states are structured; failure and unknown states never produce a success Toast or silent source substitution |
| Rollback | Known failures restore safe in-memory values without whole-snapshot overwrite or blind compensating writes; unknown state has an explicit retry/re-read path |
| Tests | Contract tests enumerate schema fields, fail on unregistered persistent keys, cover all Swipe slots, compare global fixtures deeply, spy on zero Secret Store calls, and exercise Manual All/source equivalence, existing Chat, refresh, character switch, mutations, races, late responses, duplicate events, and rollback/unknown saves |
| Docs | This document, `docs/DATA-MODEL.md`, `.trellis/spec/domain/floor-state.md`, and the short AI rule point to the same registry and implementation; every future persistent field is re-audited before landing |
| Host acceptance | Real SillyTavern Desktop, Tablet, and Mobile lifecycle and Settings acceptance is recorded separately from Node tests and static checks |

### Required contract-test cases

At minimum, the automated suite MUST prove:

1. The global `extensionSettings.bioweave` fixture is deep-equal before and
   after Character, World, All, and source-A clears, and the Secret Store spy
   records no access.
2. Manual All and Start New Chat source cleanup remove the same Chat metadata,
   ordinary message, Swipe 0, inactive Swipe, and historical Swipe BioWeave
   roots.
3. Chat A's text, all Swipe text, unrelated metadata, and unrelated message
   fields survive source cleanup; B is clean; returning to A, refreshing, or
   switching characters does not resurrect A's BioWeave data.
4. Selecting an existing Chat and a bare `CHAT_CHANGED` never clear the source.
5. Missing/ambiguous/out-of-order source evidence returns an explicit safe
   result; a duplicate or late `CHAT_CREATED` consumes at most one transition
   token.
6. Message edit/delete/truncation and Swipe switch/delete remove stale
   provenance, keep earlier valid Floors, retain only independent unchanged
   Swipe analysis, and rebuild all derived references without dangling Event
   IDs.
7. A late analysis response, clear response, or source save cannot commit into
   a new Chat, a new Swipe, a changed Floor Version, or a cleared owner.
8. Known save rejection, unknown save state, duplicate clear, and source-save
   race produce structured results and never false success.

## 14. Implementation status and re-audit rule

The current checkout implements the registry, shared Clear Service,
source-targeted Start New Chat cleanup, Settings data-management controls,
Floor/Swipe invalidation, async owner guards, and the listed automated tests.
`npm test`, `npm run check`, and changed-module syntax checks are the automated
evidence for this checkout. Real SillyTavern Desktop/Tablet/Mobile acceptance
remains separate because Node fixtures cannot prove the host's installed
lifecycle and persistence behavior.

When the final code differs from a planned name or path, update the registry
and this document to the actual path. When the host lifecycle differs from the
audited release, stop the destructive path, record the evidence, and revise
the transition proof before enabling source cleanup. A passing Node test or
static check never substitutes for real host persistence and lifecycle
acceptance.

Related contracts:

- [Data Model](./DATA-MODEL.md) for field shape and API/Secret boundaries;
- [Floor State Ownership](../.trellis/spec/domain/floor-state.md) for the
  detailed Floor/Swipe source-of-truth and provenance contract;
- [Event Pipeline](../.trellis/spec/domain/event-pipeline.md) for Event and
  Tracking semantics; and
- [World Model](../.trellis/spec/domain/world-model.md) for World evidence and
  configuration boundaries.

# State Management

BioWeave uses small, explicit state owners instead of a global store. The
SillyTavern Chat is the dynamic-data boundary; the UI keeps only presentation
state such as the focused route and theme choice.

## 1. Scope / Trigger

This contract applies whenever code reads or writes BioWeave data, responds to
a SillyTavern lifecycle event, or starts an asynchronous operation that may
finish after the user changes Chat, edits a message, or changes a swipe.

The trigger is a cross-layer boundary change involving the host context,
`runtime/`, `storage/`, `runtime/floor.js`, or `ui/app.js`.

## 2. Signatures

The existing modules own these contracts:

```js
createChatBoundary({getChatId})
  .current() -> chatId
  .token() -> {chatId, epoch}
  .assert(token) -> true | throws Error('STALE_CHAT')
  .subscribe(listener) -> unsubscribe()

createStore(adapter, boundary)
  .getChat(chatId) -> ChatData
  .saveChat(chatId, data) -> Promise<void>
  .getFloor(messageId, swipeId) -> FloorData | null
  .saveFloor(messageId, swipeId, data) -> Promise<void>

floorVersion({chatId, messageId, floor, swipeId, text, messageVersion})
  -> {chat_id, message_id, floor, swipe_id, content_hash, message_version}
```

The host adapter reads the current context through
`SillyTavern.getContext()` on each operation. It uses `chatId`, `chat`,
`chatMetadata`, `saveMetadata`, `saveChat`, `eventSource`, and `eventTypes`.
Long-lived references to `chatMetadata` or `chat` are forbidden because the
host replaces them when Chat changes.

## 3. Contracts

### Chat data

`chat_metadata.bioweave` must contain `chat_scope.chat_id` equal to the
requested Chat ID. Missing data or a scope mismatch returns a fresh default
Chat structure. The data is cloned at the storage boundary.

### Floor data

For a message without `swipes` or `swipe_info`, use
`message.extra.bioweave`. When either swipe structure exists, every swipe,
including swipe `0`, uses only
`message.swipe_info[swipe_id].extra.bioweave`. A missing swipe does not fall
back to another swipe's result.

### Floor Version

Automatic analysis may be skipped only when the saved result is successful and
all six identity fields match: `chat_id`, `message_id`, `floor`, `swipe_id`,
`content_hash`, and `message_version`. A changed message body or swipe must
therefore produce a new version. Manual refresh always runs.

### Asynchronous writes

An async write captures `{chatId, epoch}` before it starts and asserts the same
token after the host save finishes. A changed Chat throws `STALE_CHAT`; the
caller must not copy the result into the new Chat.

### Secrets

Storage removes obvious secret value fields recursively, including `api_key`,
`apiKey`, `authorization`, and bearer/token values. `secret_ref` and
`secret_id` are safe references and remain. API keys must never be part of
Chat metadata, Floor data, events, snapshots, projections, logs, exports, or
Prompt Inspector payloads.

### Worldbook source selection

The settings UI owns an in-memory source catalog. The “世界书来源” view contains
character-card fields and Worldbook entries; Recent Story and external memory
providers have separate Chat-local settings and are not catalog entries. Only
stable child selections and small settings are persisted; catalog content is
not part of Chat data and is not an injection payload.

#### Signatures

```js
loadAnalysisSources({context, fetchRef, getRequestHeaders})
  -> Promise<{sources: AnalysisSource[], warning: string | null}>

normalizeWorldbookSettings(raw)
  -> {mode: 'selected_only' | 'all' | 'none',
      selected: [
        {source_id: string, entry_id: string, enabled: true},
        {source_id: string, field_key: string, enabled: true}
      ]}

normalizeRecentStorySettings(raw)
  -> {enabled: boolean, floor_count: integer,
      regex_rules: [{pattern: string, type: 'extract' | 'exclude', enabled: boolean}]}

normalizeRecentStoryGlobalSettings(raw)
  -> {regex_rules: [{pattern: string, type: 'extract' | 'exclude', enabled: boolean}]}

mergeRecentStorySettings(globalSettings, characterSettings)
  -> current Chat settings with regex_rules ordered global then character

normalizeExternalMemorySettings(raw)
  -> {sevendayscal: boolean, anima: boolean,
      baobaoshu: boolean, database_memory: boolean}

worldbookSelectionState(source, selected)
  -> {total_count: integer, selected_count: integer,
      checked: boolean, indeterminate: boolean}

setWorldbookEntriesSelection(selected, source, enabled)
  -> enabled child selections for source entries only
```

#### Contracts

- Every source has a stable `source_id` and one of the explicit
  `source_type` values `character_card`, `worldbook`, `recent_story`, or
  `sevendayscal`. The selector page renders only the first two; the latter two
  are independent settings/status values.
- A SillyTavern Worldbook source uses the host `file_id`/stable source key;
  its display `label` is never the persisted identity.
- A Worldbook child uses the host entry `uid`/`id`/object key as `entry_id`;
  a character-card child uses the raw stable field key as `field_key`.
- The character-card selector exposes only `description`, `opening:main`, and
  `opening:alternate:<index>` fields. The opening fields preserve the source
  order and remain separate selection items; internal card fields are not
  user-facing selector rows.
- The settings view has independent collapsible `character_card` and
  `worldbook` sections. Worldbook sources are grouped using the loader's
  `character_worldbook` scope, with unlinked available books in the global
  group; display names are not used for grouping.
- A worldbook parent checkbox is presentation state derived from entry
  selections. `checked` means all stable entries are selected,
  `indeterminate` means some are selected, and the parent control is never
  persisted as a source-level selection. Batch changes remove stale
  source-level selections and write only `{source_id, entry_id, enabled}`.
- An opening-group parent checkbox is presentation state derived from
  `opening:main` and `opening:alternate:<index>` field selections. Its batch
  changes write only `{source_id, field_key, enabled}` child items; the group
  itself is never persisted.
- `chat_metadata.bioweave.settings.worldbooks` stores only `mode` and enabled
  child selections. It does not store source labels, source content, request
  headers, or token-estimate caches. `recent_story` stores only its toggle and
  floor count; `external_memory` stores only provider toggles.
- Extension settings store `recent_story_global.regex_rules` only. Global rules
  have no floor-count or USER-floor switch and never carry Secret fields. The
  existing `chat_metadata.bioweave.settings.recent_story.regex_rules` remains
  the current Chat/character-card scope; old rules are not promoted. Analysis
  merges global rules before current-Chat rules, while the floor-0 raw-content
  and default USER-floor bypass remain unchanged.
- 角色卡、最近剧情、构画数据和外部记忆是分析输入配置，不是最终 Tavern
  Context 输出。
- Analysis-source refresh and selection writes capture the current Chat token;
  a stale Chat cannot apply its result to the new Chat.
- `context/builder.js` and `setExtensionPrompt` are not called by the selector.

#### Validation & Error Matrix

| Condition | Result |
| --- | --- |
| Worldbook item has no `file_id`, `host_key`, or stable `source_id` | Skip the item; never use display `name` as its identity |
| Unknown `source_type` | Reject the source DTO |
| Worldbook list request fails but public names are available | Use the public host-name fallback and surface a safe warning |
| Worldbook list request fails and no fallback exists | Keep the previous catalog; retain the current selection and show a safe warning |
| Chat changes during refresh or save | Reject the stale result/write; do not copy it into the new Chat |
| SevenDaysCal is absent | Keep an unavailable external-provider status; the selector remains usable |

#### Good / Base / Bad Cases

- Good: Store `st-worldbook:<file_id>` and its stable `entry_id` while
  rendering the returned display name/title only as a label.
- Base: Keep a selected ID whose source is temporarily unavailable, so a
  transient refresh failure does not silently erase user intent.
- Bad: Store a worldbook display name, loaded entries, or a SevenDaysCal
  private Store snapshot in Chat metadata.

#### Tests Required

- Assert same-name Worldbooks with different `file_id` values receive
  different `source_id` values.
- Assert missing stable identifiers are skipped and unknown source types are
  rejected.
- Assert source search, selection, select-all/select-none and token estimates
  do not mutate the persisted catalog content.
- Assert the card source exposes only `description` and separate stable
  opening field keys for the primary and every alternate greeting.
- Assert linked/global groups use source scopes and parent selection derives
  checked, unchecked, and indeterminate states without a parent DTO.
- Assert Chat A and Chat B keep independent `settings.worldbooks` values and
  stale async refresh/save results are rejected.

#### Wrong vs Correct

```js
// Wrong: display text becomes the Chat identity and source content is saved.
chat.settings.worldbooks = {selected: [{source_id: source.name, entries: source.content}]};
```

```js
// Correct: persist only the stable source identity in the current Chat.
chat.settings.worldbooks = {
  mode: 'selected_only',
  selected: [{source_id: source.source_id, entry_id: entry.entry_id, enabled: true}],
};
```

## 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| Requested Chat ID is not the current `chatId` | Return default on read; throw `STALE_CHAT` on async write |
| `chat_scope.chat_id` does not match | Throw `CHAT_SCOPE_MISMATCH` on write; return default on read |
| Floor Version is missing or changed | Automatic analysis is allowed |
| Same successful Floor Version | Automatic analysis is skipped |
| Analysis attempt fails with an older success | Keep the old result in `last_success`; retain it for display/recovery and allow retry |
| Message has swipe structure | Read/write only the requested `swipe_info[swipe_id]` slot |
| Message is deleted or unavailable | Do not create an independent BioWeave Floor database |
| Host context or required save API is unavailable | Throw a descriptive `ST_*_UNAVAILABLE` error |

## 5. Good / Base / Bad Cases

- Good: Capture Chat A's token, save its Floor, and reject the completion after
  the boundary moves to Chat B.
- Good: Save swipe 0 and swipe 1 on the same message and retrieve each value
  from its own `swipe_info` slot.
- Base: A new Chat or message has no BioWeave data and receives the default
  schema without sharing references with another Chat.
- Bad: Store a `currentCharacter` object as the global BioWeave root or use a
  character name as the dynamic-data key.
- Bad: Treat a successful result for the previous text or previous swipe as a
  match for the current Floor Version.
- Bad: Put a provider API key in `chat_metadata.bioweave` or in
  `message.extra.bioweave`.

## 6. Tests Required

- Chat boundary test: a token becomes invalid after `getChatId()` changes and
  the error is `STALE_CHAT`.
- Floor decision test: same successful version skips, edited version runs,
  failed result retries, and a failed refresh preserves the previous success.
- Storage round-trip test: ordinary message storage and swipe 0/1 storage do
  not cross-read or cross-write.
- Scope test: another Chat receives defaults and a stale async save rejects.
- Secret test: `api_key`/`apiKey` values are absent after storage while
  `secret_ref` remains.
- Host smoke test: official lifecycle listeners use `removeListener` and are
  all removed by `runtime.destroy()`.

## 7. Wrong vs Correct

### Wrong

```js
// Wrong: caches a Chat object and makes swipe 0 share message.extra.
const chat = SillyTavern.getContext().chat;
message.extra.bioweave = value;
```

### Correct

```js
// Correct: read the current host context per operation and isolate every swipe.
const context = SillyTavern.getContext();
context.chat[messageIndex].swipe_info[swipeId].extra.bioweave = value;
await context.saveChat();
```

This contract intentionally leaves AI analysis, complete state reduction, and
full UI v2 data wiring to later tasks.

## API Profile and Secret Store Contract

### 1. Scope / Trigger

This contract applies when code adds or changes an API Profile, assigns a
Profile to a BioWeave task, writes a provider secret, or tests an API
connection. API Profiles are extension-global configuration; they are not
Chat-instance-local biological data.

### 2. Signatures

```js
createSecretStore({fetchRef, getRequestHeaders,
  secretKey = 'api_key_custom', endpoint = '/api/secrets'})
  .write(value) -> Promise<opaqueSecretId | null>
  .remove(opaqueSecretId) -> Promise<boolean>
  .get() -> throws Error('ST_SECRET_READ_DISABLED')

createApiProfileStore(adapter, {secretStore})
  .getSettings() -> SafeExtensionSettings
  .getApiRequestSettings() -> {timeout: integer, retry_count: integer}
  .saveApiRequestSettings(raw) -> Promise<{timeout: integer, retry_count: integer}>
  .listProfiles() -> SafeApiProfile[]
  .getProfile(profileId) -> SafeApiProfile | null
  .saveProfile(rawProfile) -> Promise<SafeApiProfile>
  .withTestProfile(rawProfile, callback) -> Promise<callback result>
  .deleteProfile(profileId) -> Promise<boolean>
  .setApiSource(source) -> Promise<'sillytavern' | 'bioweave'>
  .setDefaultProfile(profileId) -> Promise<string | null>
  .setAssignment(slot, profileIdOrSillyTavern) -> Promise<string | null>
```

The SillyTavern adapter reads `context.extensionSettings.bioweave` and saves
it through `context.saveSettingsDebounced()`. Independent requests use the
host `ChatCompletionService.processRequest()` with `chat_completion_source:
'custom'`, `custom_url`, and `secret_id`. The current-host API uses the host
`ChatCompletionService.processRequest()` request shape when available and
falls back to the public `context.generateRaw()` capability on older hosts.

### 3. Contracts

- A safe Profile contains `profile_id`, `name`, `provider`, `api_url`,
  `model`, `context_size`, `max_output_tokens`, `temperature`, and nullable
  `secret_ref`; it never contains `api_key`, `timeout`, or `retry_count`.
- Secret writes POST `{key: 'api_key_custom', value, label}` to
  `/api/secrets/write`; deletion POSTs `{key: 'api_key_custom', id}` to
  `/api/secrets/delete`. BioWeave never calls `/api/secrets/find`.
- Extension-global API settings store the canonical `api_source` marker, an
  optional `default_profile_id`, four assignment slots, and
  `api_request_settings: {timeout, retry_count}`. Assignment slots store only
  the `default` marker, a stable Profile ID, the canonical `sillytavern`
  marker, or `null`. `timeout` is integer milliseconds with a default of
  `180000`; `retry_count` is an integer from `0` to `3` with a default of `1`.
- Profile and assignment settings are saved under extension-global settings;
  Chat metadata, Floor data, Event, Snapshot, Projection, log, export, and
  Prompt Inspector payloads must not contain them.
- `withTestProfile` never writes extension settings. A newly entered Key may be
  written to the host Secret Store only long enough to run the callback, and
  its opaque reference must be deleted in a `finally` path. The callback only
  receives a safe Profile and never receives the plaintext Key.
- Connection-test results may contain `ok`, safe status, configured/current
  model, latency, and HTTP status or a fixed safe error summary. They must not
  contain request bodies, response bodies, headers, URLs with secrets, or raw
  exceptions.

### UI draft state

The settings route keeps an in-memory draft separate from the saved Profile.
`ui/app.js` captures all form controls on `input` and keys the draft by stable
`profile_id`, using `__new__` for a new Profile. Save and test operations read
that draft rather than treating the DOM as the source of truth. A successful
save replaces it with the normalized saved Profile and clears only the Key
input; a failed save or any test result keeps the draft for the next render.
The public settings-state inspection also masks draft Key values. Drafts are
never passed to Chat/Floor storage or written to extension settings.

The API source request-settings fields display `timeout` as seconds for users,
while the canonical extension-global `api_request_settings` stores it as
integer milliseconds (`250`–`600000`). The form boundary converts seconds to
milliseconds before the immediate global save and converts the saved value
back to seconds when rendering. `retry_count` is displayed and stored as an
integer from `0` to `3`. Neither field is part of a saved Profile or Chat-local
data, and every analysis/test/model request receives these global settings
through `options.requestSettings`.

### 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| API URL is not HTTP(S), contains credentials, or a secret query value | Normalize to invalid; saving throws `API_PROFILE_INVALID` |
| API URL ends in `/chat/completions` or `/completions` | Strip the suffix before saving/requesting |
| Required URL or Model is missing | Do not write Secret or extension settings; throw `API_PROFILE_INVALID` |
| New Secret write fails or returns no opaque ID | Keep the previous Profile/reference; throw an `ST_SECRET_*` error |
| Extension settings save fails after a new Secret write | Restore host settings when possible and remove the new reference |
| Old Secret cleanup fails after a new reference is saved | Keep the new reference, surface `ST_SECRET_DELETE_FAILED`, never restore the old reference |
| Profile deletion cleanup fails | Remove the Profile/assignments from settings, surface `ST_SECRET_DELETE_FAILED`, and do not expose the Secret value |
| Profile has no Secret reference | Independent request uses a sentinel `secret_id`; it must not fall through to the host's active custom key |
| Current API is selected | Call host `generateRaw`; do not read or copy the host API key |
| Timeout input is a finite seconds value | Clamp to the safe range in the UI and persist the corresponding integer milliseconds in `api_request_settings` |
| Timeout or retry input is blank/non-numeric | Let global request-settings normalization apply the safe default; never persist the raw UI string or copy it into a Profile |

### 5. Good / Base / Bad Cases

- Good: Save an API key through the host Secret endpoint, persist only its
  returned ID in `extensionSettings.bioweave.api_profiles`, then pass that ID
  to the host custom backend.
- Base: Edit non-secret fields while leaving the password input empty; retain
  the existing `secret_ref` without rendering the key back into the DOM.
- Good: Change timeout or retry count in the API source section, save it
  immediately under `extensionSettings.bioweave.api_request_settings`, close
  and reopen the panel, and render the same values without opening a Profile
  editor.
- Bad: Put `api_key` in a Profile object, Chat metadata, a request error, or
  a test-result string, even if the object is later passed through a generic
  serializer.
- Bad: Call `/api/secrets/find` in the browser or omit `secret_id` for a
  keyless custom Profile, because either action can expose or implicitly reuse
  a host secret.
- Bad: Read `profile.timeout` or `profile.retry_count` as the request policy;
  an old saved Profile can silently restore the former 30-second default.

### 6. Tests Required

- Normalize a Profile and assert that API key fields and nested secret values
  are absent while `secret_ref` remains.
- Exercise new-key, retain-key, replace-key, clear-key, delete, and cleanup
  failure paths; assert settings contain no key and stale references are not
  restored.
- Capture Secret HTTP calls and assert only write/delete endpoints and
  `api_key_custom` are used; assert `.get()` is disabled.
- Capture custom-backend request data and assert `custom_url` is normalized,
  `secret_id` is opaque/sentinel, and `api_key` is absent.
- Capture `generateRaw` for current API testing and assert no host key is
  copied; assert failure results do not include raw exception text.
- Exercise a test-only new Key and assert the callback receives only an opaque
  reference, the temporary reference is deleted, and extension settings are
  unchanged.
- Normalize and round-trip `api_request_settings`; assert legacy Profile
  `timeout`/`retry_count` values are discarded and cannot control a request.
- Render API request controls outside the Profile form and assert timeout is
  presented in seconds, immediate global saves use milliseconds, and requests
  receive the saved global timeout/retry values.
- Render the settings page with a draft and assert the draft values survive a
  render, the password input is empty for a saved Profile, advanced settings
  are collapsed by default, and the four assignments include `default` and
  `null` options.

### 7. Wrong vs Correct

#### Wrong

```js
// Wrong: reads a Secret into the extension and persists it with the Profile.
const key = await secretStore.get(profile.secret_ref);
await saveGlobalSettings({...settings, api_profiles: {...profile, api_key: key}});
```

#### Correct

```js
// Correct: write once, persist only the opaque reference, and let the host
// resolve it while proxying the request.
const secretRef = await secretStore.write(passwordInput.value);
await profileStore.saveProfile({...formData, secret_ref: secretRef});
await context.ChatCompletionService.processRequest({
  chat_completion_source: 'custom',
  custom_url: profile.api_url,
  secret_id: profile.secret_ref,
});
```

```js
// Correct: request policy is global and saved immediately, independent of Profiles.
const requestSettings = await profileStore.saveApiRequestSettings({
  timeout: timeoutSeconds * 1000,
  retry_count: retryCount,
});
await callOpenAICompatible(profile, messages, {requestSettings});
```

## World Model Species / Biological Type Contract

### 1. Scope / Trigger

This contract applies when the World Model schema, AI response normalizer,
Chat-local save path, or World Model view/editor reads or writes biological
classification data. The trigger is a cross-layer payload change where species
recognition and biological-type recognition must remain independent.

### 2. Signatures

```js
normalizeWorldModel(raw, options?)
  -> {schema_version, species, medical_context, exceptions, unknowns}

parseWorldModelResponse(raw)
  -> normalized World Model or throws Error('WORLD_MODEL_INVALID')

species[].biological_types[].capabilities
  -> {can_produce_sperm, can_produce_ova, can_be_fertilized,
      can_fertilize, can_carry_pregnancy}
```

### 3. Contracts

- The top-level World Model contains `schema_version`, `species`,
  `medical_context`, `exceptions`, and `unknowns`. `biological_types` never
  appears at the top level.
- Each `species` item contains `name`, `description`, and its own
  `biological_types` array. Species must not carry an aggregate
  `capabilities` object.
- Species recognition and type recognition are separate decisions. Human
  ordinary sex/body/reproductive evidence with no explicit non-human evidence
  may create the default species `人类`, but recognizing that species does not
  create any biological type.
- During AI analysis, a biological type is saved only when the current
  `AnalysisInput` contains it or explicitly describes that it exists in the
  same species context. Evidence for one species cannot authorize a type in a
  different species; deterministic semantic evidence such as `极少女剑灵`
  still supports `女性` under `剑灵`. Type names are open; the schema does not
  enumerate `男性` / `女性` / `双性`, and it can represent classifications such
  as `Alpha`, `Beta`, and `Omega` without inventing combinations. A manual
  editor change is explicit user intent and remains subject to structural
  normalization, not AI evidence filtering.
- Capabilities exist only on an individual biological type and are each
  independently `true`, `false`, or `null`. A type name, gender label, pronoun,
  title, appearance, or body shape does not fill them automatically.
- The non-human capability Evidence Gate applies to both boolean directions:
  `true` requires same-species/type field-local evidence of the ability, and
  `false` requires same-species/type field-local evidence of explicit inability
  or impossibility. No evidence, no observation, no actual record, an
  unspecified field, or pseudo-pregnancy alone is non-evidence and remains
  `null`; it must not be converted to `false`. The human baseline exception
  remains unchanged.
- Human baseline reproduction rules apply only after an identified human type;
  precedence is explicit story fact > explicit world/Worldbook rule > explicit
  individual exception > ordinary human baseline. They do not merge
  capabilities across types or apply to an identified non-human species.
- BioWeave's canonical fixed dual type name is `双性`. Temporary dualization,
  body modification, an ambiguous individual state, or a source/attribute
  alias is not fixed-type evidence. The analysis-only guard may remove such
  unsupported familiar labels and close matching `unknowns`; manual edits are
  not evidence-filtered.
- Non-human capabilities, reproduction rules, lifecycle, and special rules
  remain `null` without corresponding species-linked mechanism evidence. An
  explicit statement that one specific human baseline portion is shared can
  fill only that portion; a non-human type name or humanoid anatomy never
  authorizes the rest of the human template.

### 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| Top-level `biological_types` is present | Throw `WORLD_MODEL_INVALID`; never guess a species owner |
| Strict response has no `species` array or a species has no `biological_types` array | Throw `WORLD_MODEL_INVALID` |
| Species has a `capabilities` field | Drop it during normalization; never persist species-level capabilities |
| Type name is outside any familiar sex list | Accept it as an open type name and keep capability values evidence-based |
| Capability or non-human rule evidence is missing | Normalize that individual field to `null` |
| Non-human capability is only absent, unobserved, unrecorded, or pseudo-pregnancy evidence | Keep the capability `null`; do not infer `false` |
| Non-human capability has explicit same-type inability evidence | Allow that individual capability to be `false` |
| AI returns an unsupported familiar biological type, species-unlinked type, or dual unknown | Remove it from analysis output; manual editing is not filtered |

### 5. Good / Base / Bad Cases

- Good: male evidence produces `人类 → 男性`; male plus female evidence
  produces `人类 → 男性、女性`.
- Good: “剑灵基本为男性，极少女剑灵” produces `剑灵 → 男性、女性`.
- Good: human male/female evidence elsewhere does not authorize `妖 → 男性`
  or `魔 → 女性`; without species-linked evidence those arrays stay empty.
- Good: a non-human type with direct sperm, cycle, or lifespan evidence keeps
  only those corresponding fields; unrelated capabilities and rules remain
  `null`.
- Base: a species is identified but no type is explicitly present; retain the
  species with an empty `biological_types` array and do not invent one.
- Bad: identify `人类` and then add male, female, and dual types merely
  because they are common human categories.
- Bad: set all capabilities to `true` because a type is called `双性`, `Alpha`,
  or `Omega`.

### 6. Tests Required

- Assert the schema and normalized payload have nested species and no
  top-level `biological_types` or species-level capabilities.
- Assert the old flat payload is rejected rather than migrated.
- Assert one-type, two-type, human default, explicit non-human, and empty-type
  species examples preserve exactly the types represented by evidence.
- Assert open type names survive normalization and missing capabilities become
  `null` instead of inferred values.
- Assert the prompt states the two-step recognition rule and the UI renders and
  edits the same species → type hierarchy.
- Assert existing AnalysisInput, request message roles, Chat-local writes,
  failure retention, and source summaries remain unchanged.

### 7. Wrong vs Correct

#### Wrong

```js
{
  biological_types: [{name: '男性', capabilities: {}}],
  species: [{name: '人类'}]
}
```

#### Correct

```js
{
  species: [{
    name: '人类',
    biological_types: [{
      name: '男性',
      capabilities: {can_produce_sperm: null, can_carry_pregnancy: null}
    }]
  }]
}
```

## World UI module draft contract

### 1. Scope / Trigger

This contract applies when `ui/world.js` and `ui/app.js` render or edit the
existing Chat-local World Model. It covers presentation-only section drafts;
it does not change the World Model schema or its analyzer contract.

### 2. Signatures

```js
resolveWorldModelSelection(model, speciesIndex?, typeIndex?)
  -> {speciesIndex: integer | null, typeIndex: integer | null}

getWorldModelSection(model, section, selection)
  -> cloned section value

applyWorldModelSection(model, section, draft, selection)
  -> cloned World Model with exactly one section replaced

extractWorldModelSection(form, section)
  -> normalized section value
```

### 3. Contracts

- `worldModelState` may hold `selectedSpeciesIndex`, `selectedTypeIndex`,
  `editingSection`, `sectionDraft`, and `sectionDirty` as UI state only.
- `editingSection` is one of the seven known section keys or `null`; the UI
  renders one active form at a time and never creates a whole-model editor.
- Type-level sections are read from the selected
  `species[].biological_types[]`; `medical_context`, `exceptions`, and
  `unknowns` remain top-level sections. Biological type names are open strings
  and must be rendered without a fixed male/female filter.
- A successful save normalizes a cloned current model, replaces only the
  selected section, and persists the existing Chat object with that model.
  Existing `last_saved_at` / `last_saved_by` metadata may be updated only when
  those properties already exist; no metadata field is created by the UI.
- A failed save leaves the previously persisted model, the active section,
  and the current draft available for the next render. Switching type, section,
  or running analysis checks dirty draft state before discarding it.
- Capability values are rendered as `是` / `否` / `未知` for `true` / `false` /
  `null` and all World UI labels and controls are Chinese.

### 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| Unknown section key | Reject the UI action; do not mutate the model |
| Save a type-level section | Replace only the selected type's matching key |
| Save a world-level section | Replace only `medical_context`, `exceptions`, or `unknowns` |
| Save normalization or Chat persistence fails | Keep old model and current draft; show a safe notice |
| `last_saved_at` / `last_saved_by` is absent | Do not add either property |
| Dirty draft and type/section switch | Ask for confirmation before discarding |

### 5. Good / Base / Bad Cases

- Good: edit `capabilities` for one selected type and keep every other type,
  section, and world-level value byte-for-byte equivalent after save.
- Base: an identified species has an empty `biological_types` array; render an
  empty state without inventing a type.
- Bad: serialize the whole page form as a replacement World Model or add
  default biological types because the UI knows common labels.

### 6. Tests Required

- Render all seven section edit actions and exactly one active section form.
- Assert dynamic names such as `双性`, `Alpha`, `Beta`, and `Omega` remain
  visible without filtering, and assert all tri-state labels are Chinese.
- Apply a type-level and a world-level section patch and assert every other
  section remains unchanged.
- Exercise failed-save and cancel paths and assert the old model and active
  draft are retained appropriately.
- Run the World UI responsive-contract, syntax, focused, and full test suites.

### 7. Wrong vs Correct

```js
// Wrong: replace all sections from a page-wide draft.
await runtime.store.saveChat(chatId, {...chat, world_model: pageDraft});
```

```js
// Correct: clone and replace one selected section before saving.
const nextModel = applyWorldModelSection(currentModel, section, draft, selection);
await runtime.store.saveChat(chatId, {...chat, world_model: nextModel});
```

## Recent Story Regex Collection

### 1. Scope / Trigger

The recent-story settings and `AnalysisInput.recent_story.items` path apply
the user's ordered extraction/cleaning rules independently to each Chat floor.

### 2. Signatures

```js
normalizeRecentStorySettings(raw)
  -> {enabled, floor_count, regex_rules, regex_user_enabled}

applyRecentStoryRegex(content, rules)
  -> string
```

### 3. Contracts

- Each floor starts with its own raw content; floors remain in original order
  and retain their original `floor` value.
- Enabled `exclude` rules run first, in their stored order, against the floor's
  original text and remove matching text.
- Enabled `extract` rules all read the same cleaned text. Their results are
  appended by rule order, then by match order, with one newline between blocks.
- A capture-group rule emits all non-empty capture groups per match; a rule
  without capture groups emits the full match. Regexes are global by default.
- Empty or disabled rule sets return the floor text unchanged. Invalid rules
  are skipped without aborting the remaining rules.
- Floor `0` is the opening greeting and never receives recent-story regex
  processing, regardless of `regex_user_enabled`.
- USER floors remain raw by default. Regex processing for USER floors is only
  enabled when the Chat-local `regex_user_enabled` flag is `true`; assistant and
  system floors continue to use the ordered rules.
- The World Model assistant message contains only the resulting floor text,
  joined in order; it does not add a floor heading or `[Floor · role]` marker.
- `extensionSettings.bioweave.recent_story_global.regex_rules` is plugin-level
  configuration and applies to every character card. It contains only rules;
  it must not acquire `floor_count`, `enabled`, or `regex_user_enabled`.
- `chat_metadata.bioweave.settings.recent_story.regex_rules` remains the
  current Chat/character-card scope. Existing rules stay in this scope and are
  not promoted automatically. Before collection, merge global rules first and
  Chat-local rules second; the merged list is then processed with the same
  per-floor semantics below.
- The settings UI must route every regex input, add, move, and remove action by
  an explicit `global`/`character` scope marker. A missing marker defaults to
  the Chat-local character scope for backward safety.

### 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| `/pattern/flags` omits `g` | Add `g` before compiling |
| Invalid pattern or flags | Skip that rule; preserve other processing |
| Only cleaning rules remain | Return cleaned, trimmed floor text |
| A floor becomes empty after processing | Omit that floor from `recent_story.items` |
| Global settings contain an empty rule or non-rule field | Ignore the empty global rule and discard all non-rule fields; never persist Chat read controls at extension level |
| Existing Chat-local rules are loaded after adding global rules | Keep them Chat-local and execute them after global rules; never rewrite them as global |

### 5. Good / Base / Bad Cases

- Good: date extraction and body extraction both read the same cleaned floor,
  producing `date\nbody`.
- Base: a debug-tag exclusion appears between two extraction rules; exclusion
  still happens before extraction.
- Bad: feed the first extraction result into the second extraction rule; this
  loses independent fields from the original floor.

### 6. Tests Required

- Assert no-rule and disabled-rule inputs remain unchanged.
- Assert cleaning runs before extraction even when the stored order interleaves
  the two types.
- Assert multiple extraction rules preserve rule order and collect from the same
  cleaned source.
- Assert two floors are processed independently and retain their floor IDs.
- Assert floor `0` bypasses regex processing.
- Assert USER floors bypass regex by default and are processed when the
  Chat-local opt-in is enabled.
- Assert global rules are stored in extension settings, while character rules
  remain in Chat metadata.
- Assert global rules run before character rules and both scopes preserve their
  own order and enabled flags.
- Assert adding or editing a rule in one scope does not change the other scope.

### 7. Wrong vs Correct

#### Wrong

```js
let text = floorText;
for (const rule of rules) text = applyOneRule(text, rule);
```

#### Correct

```js
const cleaned = applyAllExclusions(floorText, excludeRules);
const parts = extractRules.flatMap(rule => extractAll(cleaned, rule));
return parts.join('\n');
```

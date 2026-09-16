# Technical Design

## 1. Audited ownership model

The current BioWeave implementation has four different persistence owners. The
clear implementation will preserve those owners instead of treating every
`bioweave` property as one undifferentiated blob.

| Owner | Actual location | Meaning |
| --- | --- | --- |
| Global settings | `extensionSettings.bioweave` | API source, profiles, model caches, assignments, request settings, prompt, global recent-story rules, and other extension settings. Never a clear target. |
| Chat-local metadata | `chatMetadata.bioweave` | World Model, Chat settings, materialized character/tracking projections, relationships, index hints, and lifecycle markers. |
| Floor-local source | `message.extra.bioweave` or the exact `message.swipe_info[swipe_id].extra.bioweave` slot | Current-version Floor analysis, validated Events, cumulative Floor-owned identity registry, and reserved snapshot/projection slots. |
| Runtime transient state | Runtime/UI memory | In-flight executions, AbortControllers, terminal status maps, source/worldbook caches, refresh chains, and UI business state. |

The current schema does not persist a separate `history` table or a connected
State/Projection/Snapshot reducer. `core/state.js`, `core/projection.js`, and
`core/snapshot.js` are pure/skeleton helpers. The lifecycle registry will still
reserve their real Floor fields so a later implementation cannot bypass clear
semantics.

The six-field Floor Version remains authoritative:
`chat_id`, `message_id`, `floor`, `swipe_id`, `content_hash`, and
`message_version`. `message.extra` and `swipe_info[*].extra` remain storage
owners only through `storage/store.js`; UI and business code will not write
them directly.

## 2. Central lifecycle registry

Add `storage/lifecycle.js` as the single data-domain declaration. It will export
the domain names, Chat-local field classification, Floor field classification,
clear dependencies, and the fields that are structural rather than clearable.

The real domains are:

- `global_settings`: documented and guarded, but not clearable by this task.
- `chat_settings`: `settings`; preserved by character/world clear and reset by
  full Chat-local clear.
- `world`: `world_model`, `world_model_meta`.
- `character`: Chat-level `character_profiles`, `character_registry`,
  `tracking_subjects`, `tracking_candidates`, `relationships`, plus
  character-facing Floor `snapshot`/`projections` derived data.
- `events`: Floor `events[]`, the historical/causal source facts.
- `floor_analysis`: Floor `analysis` and its version/attempt status.
- `floor_identity`: Floor-owned `character_registry`; this is identity history
  needed for provenance and Event editing, not the Chat character projection.
- `snapshot`: Floor `snapshot`.
- `projection`: Floor `projections`.
- `runtime_cache`: transient analysis/UI/cache state.
- `all`: the complete current Chat-local BioWeave namespace and every owned
  message/Swipe Floor root; it never includes global settings or message text.

The registry will make the important distinction explicit: Chat
`character_registry` is a materialized projection and may be cleared by the
character action, while Floor `character_registry` is an authoritative
identity snapshot and is retained by character/world clear unless a Floor
mutation makes its owner stale. Full clear removes both.

## 3. Clear Service and persistence boundary

Add `storage/clear.js` with a `createClearService` factory. Its public methods
will be `clearCharacterData`, `clearWorldData`, and `clearAllBioWeaveData`.
The UI will call the Runtime facade only; it will never name storage fields.
The same service will expose a source-owned
`clearSourceChatBioWeave(sourceOwner)` operation for the Start New Chat
coordinator. It is deliberately not an alias for `clearCurrentChat`: every
source clear carries an immutable source Chat identity and is persisted through
an adapter that targets that identity explicitly.

Each operation follows this sequence:

1. Capture the current Chat ID and `chat.token()`.
2. Build a domain-specific clear plan from the registry and current owned
   slots. No recursive deletion and no unlisted key expansion.
3. Capture the previous Chat root and every owned Floor/Swipe value touched by
   the plan.
4. Abort/invalidate runtime work and advance the Chat epoch for the destructive
   boundary. A source-owned operation invalidates the source owner even if the
   current Chat has already become B.
5. Assert the new operation token still owns the same Chat before applying the
   plan. For a source-owned operation, assert the captured source identity and
   source snapshot identity instead of consulting the mutable current Chat.
6. Apply only the plan's Chat fields and owned Floor roots.
7. Persist through one storage-layer Chat mutation boundary where the host can
   save metadata and message changes together; use the existing metadata saver
   only for a metadata-only fallback. Source cleanup uses a source-targeted
   host save with Chat A's official character/file identity, never the current
   Chat B.
8. Await the persist result and assert the intended owner again. Current Chat
   changes during the await are allowed; changing the captured source identity
   is not.
9. On explicit failure, restore the captured in-memory snapshot without issuing
   a blind compensating write. On an explicitly unknown commit state, leave the
   state as-is, return `commitState: "unknown"`, and never report success.
   The source coordinator records the source owner and result for an explicit
   owner-targeted retry/diagnostic path; it never silently substitutes Chat B.
10. On success, clear runtime/UI transient state and return the structured
    result.

The result shape will be stable and idempotent:

```js
{
  ok: true,
  changed: true,
  domain: "character",
  chatId: "...",
  removed: { chatFields: [], floorSlots: 0, swipeSlots: 0 },
  invalidated: { runtime: true, domains: ["character", "projection"] },
  persistence: { commitState: "confirmed" }
}
```

An empty operation returns `{ok: true, changed: false, ...}`. A stale owner or
save failure returns `ok: false` with an error code and persistence state; the
UI must not show a success toast for it.

### Source Chat ownership for Start New Chat

The current SillyTavern release was audited before choosing this boundary. In
`public/script.js`, `doNewChat()` waits for the current save, clears the
in-memory chat, changes the character's chat filename, and calls `getChat()`.
`getChatResult()` then saves/loads the new chat and emits `CHAT_CHANGED` with
the new current Chat ID. It emits the official `CHAT_CREATED` event only when
the load produced a fresh first message. `event_types` contains
`CHAT_CREATED`, but there is no cancellable `NEW_CHAT` event or source Chat ID
in its payload. `clearChat({ clearData: true })` also emits no pre-transition
extension event. Consequently, neither `CHAT_CREATED` alone nor a
`CHAT_CHANGED` followed by `CHAT_CREATED` is sufficient evidence.

The runtime will keep a bounded, in-memory `SourceChatSnapshot` for the active
owner while it is still readable, plus the last verified host Chat index:

```text
{
  sourceChatId,
  characterId/groupId,
  characterName/avatar,
  chatMetadata,
  messagesIncludingAllSwipeInfo,
  sourceRevision,
  knownChatIdsBeforeBoundary
}
```

The one-shot `StartNewChatTransition` is created only when all available host
evidence agrees:

1. The previous active owner A has a valid snapshot and a non-stale epoch.
2. The target identity B is different from A and was absent from the
   pre-boundary host Chat index. The index is obtained through the official ST
   chat-list/context adapter, not inferred from a filename or button label.
3. The official `CHAT_CREATED` event is for the same target B and is paired
   with the immediately preceding boundary token.
4. The host character/group owner is unchanged, and the official
   `CHAT_CREATED(B)` evidence represents a fresh Chat. If an adapter exposes an
   explicit freshness result, `false` rejects the transition; the audited
   release has no separate freshness API, so the event plus pre-boundary index
   are the proof. Initialization, reload, character switching, and an existing
   Chat load cannot satisfy this proof.
5. `consumed` is false and the transition token has not been superseded by a
   later event.

If any evidence is missing, contradictory, or arrives out of order, the
transition fails closed: no destructive clear is attempted. This explicitly
avoids treating any `CHAT_CREATED` event as user intent. Ordinary
`CHAT_CHANGED` only records/loads owners; it never creates a destructive
transition by itself.

On a verified transition, the runtime first aborts/invalidate tasks owned by A,
then calls `clearSourceChatBioWeave({ sourceOwner: A, transitionToken })` after
B is current. The captured snapshot is used for owner verification, rollback,
and revision evidence only. It is never used as a full replacement payload.
The source-targeted adapter reads the latest persisted Chat A by its immutable
identity and replans/merges the exact BioWeave-owned removals into that latest
state. A custom adapter may enforce the captured revision as a server CAS. The
official SillyTavern adapter has no server revision/CAS endpoint, so its
content digest is owner evidence and its latest-read/field-merge/post-save-read
path preserves boundary-time updates without claiming server-side CAS. The
merge preserves message text, Swipe text, other-plugin metadata and
boundary-time updates. If latest-source verification or field-level merge is
unavailable, the operation fails closed rather than overwriting A with an old
snapshot.

This is the only destructive action tied to Chat creation:

```text
current A snapshot + verified host index
  -> CHAT_CHANGED(B): capture A, abort/invalidate A, load B; no clear
  -> CHAT_CREATED(B): validate transition evidence and consume one token
  -> latest-read A + exact owned-field merge
  -> clearSourceChatBioWeave(A): remove A metadata/floors/all swipes
  -> await source-targeted save and verify A
  -> B remains clean; current runtime binds only to B
```

An existing Chat that is selected later is restored exactly as stored. Page
refresh, plugin initialization, character switching, and a bare `CHAT_CHANGED`
never run source cleanup. The host's own new-chat operation has no pre-event
cancellation hook in the audited release, so a confirmed persistence failure
cannot roll back the already completed host transition; it must be surfaced as
a failed source cleanup and recorded with its source owner for an explicit
owner-targeted retry/diagnostic path, never reported as success and never
redirected to B.

## 4. Domain semantics

### Character clear

Clear the Chat-level character projection:
`character_profiles`, Chat `character_registry`, `tracking_subjects`,
`tracking_candidates`, `relationships`, and the derived index hint. Clear
character-facing Floor snapshots/projections in every existing message/Swipe
slot while preserving Floor analysis, Events, and Floor-owned identity
snapshots. Those Events remain physically available for explicit history/audit
reads, while the current character projection excludes pre-reset facts until
a new post-reset Floor is available.

Because the Runtime deliberately rebuilds tracking from valid Floor Events, an
empty Chat projection alone would immediately be repopulated. The plan writes a
versioned Chat-local `data_lifecycle.character_reset` boundary containing the
last existing message identity, message index, and floor when available.
Registry rebuilds continue to retain historical Events physically, but only
materialize character tracking from messages after that boundary. A new
post-reset Floor can create new tracking state. This makes the reset durable
across reloads without deleting historical facts or using an unsafe runtime-only
flag.
An empty Chat uses `message_index: -1` as the explicit boundary before the
first post-reset message.

The Floor identity registry is not cleared by this action: it is the source
needed to resolve canonical IDs and is not the current character state. This is
the intentional adjustment required by the existing Floor State Ownership
Contract.

### World clear

Clear `world_model` and `world_model_meta`, reset the derived index hint, and
clear world-dependent Floor snapshots/projections. Preserve Chat settings,
character projections, Floor Events, Floor analysis, and Floor identity
history.

The audit found no persisted `world_entity_id`, `rule_id`, or equivalent
foreign-key field in the current character/tracking schema. Character profiles
contain event-derived species/type/capability facts, not references to a World
Model entity. Therefore the current implementation has no dangling reference
to rewrite. Runtime reads/rebuilds will use the now-empty World Model; any
future world-derived reference must be added to the lifecycle registry and
cleared or marked dirty before that field is accepted.

### Full Chat-local clear

Replace only the BioWeave Chat root with `emptyChat(chatId)` and remove the
BioWeave root from every ordinary message and every `swipe_info[*]` slot,
including non-active Swipe slots and Swipe 0. Preserve the Chat root itself
only as the clean schema shape; preserve all other `chatMetadata` keys,
message text, `swipes` text, and unrelated `extra` keys. This action also
removes the character reset marker and resets Chat-local settings to defaults.
It never reads, writes, or deletes `extensionSettings.bioweave` or the Secret
Store.

## 5. Message and Swipe invalidation

Extend `runtime/event-analysis.js` with a centralized invalidation path and a
source snapshot of current active Floor identities. The snapshot compares
stable message identity, active Swipe, content hash, message version, and
Floor. It is used only to locate the earliest affected Floor; current valid
Floor reads remain the authority.

- Message deletion compares the pre/post source sequence, finds the first
  changed position, and clears every owned Floor/Swipe root from the earliest
  affected Floor onward. Earlier valid Floors remain. The physically deleted
  message is not recreated.
- Message edit/update clears the edited message's active slot and invalidates
  later active-path derived data. Non-active Swipe slots whose source text did
  not change are retained as independent source candidates; later active
  results without valid dependency provenance are cleared conservatively.
- Swipe switch/deletion does not delete every Swipe root. It keeps each Swipe's
  own Floor analysis when its source is unchanged, rebuilds Chat-level derived
  state from the new active path, and clears affected active-path downstream
  results. New successful analysis records will carry a compact dependency hash
  of the active Floor-version chain. When switching back, a retained Swipe
  result is reusable only when that dependency hash matches; old records with
  no dependency provenance are treated conservatively.
- Invalidation aborts in-flight work targeting the affected path, advances the
  epoch, removes stale terminal/cache entries, persists the safe invalidation,
  and rebuilds tracking from current valid Floors.

This gives the reference project's “earliest affected” behavior while using
BioWeave's actual Floor Version/provenance instead of treating an array index as
a durable identity.

## 6. Chat lifecycle and async ownership

`CHAT_CHANGED` is the normal loading boundary, not the destructive trigger. The
implementation does not inspect a “new chat” button. After a boundary it
captures the previous source owner for possible `CHAT_CREATED` confirmation,
aborts old analysis, advances the epoch, clears source/worldbook/UI transient
caches, and loads data from the current Chat owner:

- An existing Chat with a matching `chat_scope.chat_id` restores its own
  Chat-local data and exact message/Swipe slots.
- A newly created Chat is recognized only through the complete host evidence
  proof described above: source/target transition token, pre-boundary Chat
  index, official creation confirmation, and unchanged host owner. It starts
  with no character/world/Event/projection state while reusing only global
  settings. The preceding source Chat is then destructively scrubbed by
  identity. A clean B is never used as the target of A's cleanup.

The audited release does not provide a cancellable pre-new-chat extension
event. Therefore the adapter's safety contract is: source identity and source
snapshot must be verified before any source write; if verification or source
persistence is unavailable, abort the BioWeave source cleanup, return an
explicit failure, and leave B untouched. No heuristic based on button text,
DOM selectors, or a bare empty `CHAT_CHANGED` is permitted.

Every async analysis/clear operation captures `chatId`, epoch, and source
identity/hash. Before every commit it asserts all three. Clear and lifecycle
events abort where possible and still rely on epoch/source checks when a host
ignores AbortSignal. No late API result can commit into another Chat or revive
cleared data.

## 7. UI integration

Add a single “数据管理” settings disclosure in the BioWeave plugin's existing
“设置” page using the existing settings components, Popup confirmation, Toasts,
danger action class, and `data-bioweave-action` delegation. No clear action is
added to the character/world pages, and no “clear and start new chat” button is
added. The section contains exactly the three user clear operations and says
that they affect only the current Chat. Each action states what is deleted and
what remains, including that chat/Swipe text, unrelated plugin data, and
API/global configuration are retained. Every action uses a second-step Popup
confirmation (never `window.confirm`), disables all three buttons while any
operation is in flight, prevents double invocation, and reports no-op,
success, or persistence failure distinctly. Success triggers an in-place
business/UI refresh and empty state; failure leaves the UI in a failed state
and never shows a success toast.

The UI framework config, framework guide, HTML example, full reference, and
production settings markup will be updated together. No new secret/runtime
data is added to the reference/example markup.

## 8. Contract enforcement

Add lifecycle contract tests that:

- enumerate every current Chat/Floor schema key and require a registry domain;
- construct a complete fixture containing every clearable Chat/Floor field and
  assert full clear leaves no BioWeave Chat-local/Floor roots;
- deep-compare global settings and a Secret Store spy before/after every clear;
- verify all Swipe slots and unrelated message/metadata keys survive as
  required;
- cover reset marker behavior, existing/new Chat boundaries, deletion/edit /
  Swipe dependency invalidation, late API responses, double clear, and
  explicit/unknown persistence failures.

The formal `docs/bioweave-data-lifecycle.md` is the detailed single source of
truth. `AGENTS.md` and the Trellis Floor State spec will contain short pointers
and hard gates rather than a second copy of the whole contract.

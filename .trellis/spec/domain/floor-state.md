# Floor State Ownership Contract

This is the single detailed contract for Floor ownership, lifecycle,
previous-state resolution, derived-state invalidation, and API provenance in
BioWeave. Domain documents may link here, but must not define a competing
history or ownership model.

The data flow is intentionally one-way:

```text
current message + active Swipe
  -> authoritative Floor Version
  -> Floor/Swipe analysis, Events, and cumulative canonical identity snapshot
  -> current valid Floor facts
  -> derived runtime state, registries, UI model, and API context
```

The contract applies to storage, Floor/version code, analysis, Events,
tracking, registries, character state, World Model state, API context, and any
new disease, medication, reproduction, exposure, or other cross-Floor state.

## 1. Source of Truth

A Floor-derived analysis, Event, or biological fact belongs to the message
Floor that produced it and, when the message has Swipe structure, to the
active message's durable per-Swipe slot. The authoritative binding is the
complete six-field Floor Version owned by `runtime/floor.js`:

`chat_id`, `message_id`, `floor`, `swipe_id`, `content_hash`, and
`message_version`.

`storage/store.js` is the business storage boundary. Its read/write contract
is:

- an ordinary message uses `message.extra.bioweave`;
- a message with Swipe structure uses exactly
  `message.swipe_info[swipe_id].extra.bioweave`;
- the requested message, Chat, and Swipe must still exist;
- an Event is active only when its complete `source` matches the current
  Floor Version.

The active-message `extra` projection that a host may maintain while changing
Swipes is a host mirror. It does not create a second owner. A Chat-level map
such as `chatMetadata.floors[mesId]`, a registry, or an in-memory cache is not
a historical source of Floor facts. BioWeave does not add a permanent Floor ID
database.

Chat Metadata may still own independent configuration: user choices, role or
plugin settings, current Character Card/Persona context, and other explicitly
authoritative Chat-local values. Historical World Model state is not Chat
configuration: `world_model` and `world_model_meta` are Floor-owned fields.
Floor-derived canonical identity history is Floor-owned cumulative snapshot
state; it is not Chat configuration.
If a Chat-level
`character_registry` is retained, it is only a materialized projection/cache
or an explicitly bounded legacy-migration input; it is never an independent
historical source for Analyzer API input. Event-derived profile fields and all
historical biological facts remain subject to the Floor ownership and
provenance rules below.

## 2. Floor lifecycle

The current message collection and host-owned message/Swipe slots determine
validity on every read. Lifecycle handlers can trigger a rebuild for
responsiveness, but correctness must be recoverable without trusting a
deletion callback or a stale cache.

| Lifecycle change                           | Required result                                                                                                                                                                                                                                                                               |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| First analysis or successful reanalysis    | Save the complete analysis, Events, and cumulative canonical identity snapshot in the existing message/Swipe Floor slot, bound to the current six-field version.                                                                                                                            |
| Manual regeneration or force reanalysis    | Replace that slot's successful result for the same current version; do not accumulate a second history record. The target is never its own previous state.                                                                                                                                    |
| Edit or regenerated text                   | Recompute `content_hash` and/or `message_version`. The old result is stale and its Events are inactive until a successful result for the new version is saved. A failed attempt may preserve the old stored result for diagnostics, but it cannot make old Events active for the new version. |
| Message deletion                           | The message's Floor facts disappear from active reads. Rebuild derived state from the remaining current messages.                                                                                                                                                                             |
| Multi-Floor deletion or history truncation | Every removed message loses ownership of its facts; no array index, registry, summary, cache, or Chat hint may recreate them.                                                                                                                                                                 |
| Swipe deletion                             | The deleted `swipe_info[swipe_id]` owner contributes no Floor, previous state, Event, or derived reference.                                                                                                                                                                                   |
| Swipe switch                               | Reads select only the newly active Swipe's slot. Facts from another Swipe are inactive even when the message and Floor number are the same.                                                                                                                                                   |
| Chat reload or plugin reload               | Recompute from the current host message collection and valid slots, including Floor-owned canonical identity snapshots. Runtime memory is disposable.                                                                                                                                            |
| Chat switch                                | Chat scope and token checks prevent reads or writes from crossing Chats; pending work must not save facts into the new Chat.                                                                                                                                                                  |

An inactive or missing Floor is represented by the existing empty storage
shape, not by a fallback to another message, Swipe, or Chat-level historical
copy.

### Business-domain separation inside one Floor

The Floor object is a storage container, not a merged business owner. World
Model and Character/Event Analysis share Floor Version, Store, owner slots,
invalidation, and business-neutral traversal only. World Model owns its world
rules/prompt/parser/normalizer/evidence guard and its own persistence/resolver;
Character/Event owns identity, registry, profile/context, participant
resolution, BiologicalEvent, Tracking, and its own validation/persistence.

Saving one domain must preserve the other domain's valid fields. A World Model
save may replace only `world_model` and `world_model_meta`; Character/Event
analysis may replace only `analysis`, `events`, and `character_registry`.
Cross-domain clearing is allowed only when the lifecycle contract explicitly
invalidates the complete Floor Version or owner. Neither domain may place its
resolver or save logic inside the other domain's business helper.

## 3. Per-swipe ownership

For a structured message, `swipe_info[swipe_id].extra.bioweave` is the durable
owner of that Swipe's Floor state. Store callers pass the requested Swipe ID
through the existing Floor storage abstraction; they do not inspect or mutate
host slots themselves.

Reads must not fall through from a missing or stale slot to another Swipe,
the active-message mirror, `chatMetadata`, a registry, or a runtime cache.
The active Swipe is selected from the current host message. A Floor Event
whose `source.swipe_id` differs from that active Swipe is not part of current
state. Switching back to a still-existing Swipe may reveal that Swipe's own
valid slot; deleting it cannot.

This per-Swipe boundary is also the ownership rule for future disease or
exposure facts. A disease fact produced while Swipe 2 is active belongs to
Swipe 2's Floor slot, not to the message as an undifferentiated Chat fact.

## 4. Previous Floor Resolution

For a target Floor, Runtime scans the current Chat's messages from the target
message index minus one toward older messages. It selects the nearest
candidate that satisfies every condition:

1. the candidate message still exists;
2. its current active Swipe is selected;
3. the exact active-Swipe Floor slot is readable through `store`;
4. the candidate's recomputed Floor Version is complete and exactly equals the
   stored analysis version;
5. `analysis.status === "success"`;
6. the candidate Floor is lower than the target Floor; and
7. the candidate Events pass current-version filtering; and
8. the candidate owner contains a normalized cumulative
   `character_registry` snapshot when identity history is requested.

The target's own old analysis and Events are structurally excluded by starting
the scan before the target. A target's old result, Chat Metadata, a runtime
cache, a deleted registry entry, or `last_processed_floor` is never a
previous-state fallback. A stale candidate is skipped so that an older valid
candidate may be selected.

When no candidate passes, the normalized previous value is exactly:

```json
{
  "analysis": null,
  "events": [],
  "character_registry": { "schema_version": 1, "entities": {} }
}
```

The `character_registry` returned for a valid candidate is read from that same
candidate's exact Floor/Swipe owner slot. It is a cumulative snapshot as of
that Floor, not a Chat-global ledger. The target Floor's old snapshot is
excluded by the same scan boundary as its old analysis and Events. A candidate
without a valid snapshot cannot fall back to Chat Metadata; its identity
history is empty until an explicit, bounded legacy migration establishes an
owner snapshot.

The same rule applies during reanalysis, after message or Swipe deletion,
after edit/regeneration, after history truncation, and after reload.

## 5. Derived State

Current valid Floor facts are the only input for materialized runtime state:

- active tracking subjects and pending candidates;
- exposure/Event references, indexes, summaries, counts, and UI models;
- event-derived portions of character profiles or registries, including the
  canonical identity snapshot owned by each successful Floor;
- current biological state, including a future disease tracker; and
- historical biological context sent to an API.

`core/tracking.js` rebuilds its active projection from the current valid Event
collection. It may retain sanitized historical profile/configuration data when
the existing schema allows it, but such data is not an active subject and
cannot stand in for a deleted Event. Stable references point back to current
Event IDs and their Floor/Swipe provenance; a registry does not duplicate the
complete Event fact.

Chat Metadata must be classified by provenance:

- **A. Authoritative configuration** — user, role, plugin, or explicit current
  Character Card/Persona/World Model configuration. This remains Chat-owned and
  is preserved when a Floor disappears. It is distinct from the historical
  canonical identities learned by BioWeave analysis.
- **B. Derived state** — tracking subjects, candidates, event-derived profile
  fields, registries, indexes, summaries, counts, UI models, and caches. This
  is a materialized view, never a second source of truth.

For B, the only valid model is:

```text
derivedState = derive(currentValidFloorFacts, authoritativeConfiguration)
```

It must not be implemented as `merge(previousDerivedState,
currentValidFloorFacts)` unless every retained fact has explicit, still-valid
Floor provenance and passes current validity checks. A mixed profile or
registry is handled field by field: independent configuration is not deleted
merely because a related Floor was deleted, while Floor-derived evidence is
never allowed to become an independent historical ledger. In particular,
Floor-derived canonical identity history is stored as a cumulative snapshot on
each successful Floor owner. Cumulative does not mean global authoritative
ownership: deleting or invalidating the latest owner removes identities that
only it can prove, and the next valid older Floor snapshot becomes the source
for subsequent history.

For a future disease state tracker, the diagnosis/exposure/medication fact is
a Floor fact; the current disease state, subject index, and UI/API projection
are derived state. Deleting its owning message or Swipe, changing its Floor
Version, or removing it from history removes it from the current projection.
An independent tracking preference remains Chat configuration. Current
Character Card/Persona identity context remains configuration/context; a
canonical identity first established by historical BioWeave analysis remains
Floor-owned snapshot state.

## 6. Provenance

Every persisted Floor Event and every historical biological fact that crosses
an API boundary must be traceable to a still-existing, version-valid Floor
slot. The trace includes the complete Floor Version and, for projections,
the originating Event ID where applicable.

The validity chain is:

```text
message + active Swipe + current text/version
  -> complete Floor Version
  -> Event.source equality
  -> derived reference or API fact
```

An object that only exists in a Chat cache, runtime cache, deleted registry,
old active-message mirror, or `last_processed_floor` has no valid provenance.
Caches may accelerate recomputation, but they cannot repair missing
provenance or resurrect a deleted/stale fact.

## 7. API Input Boundary

`runtime/event-analysis.js` owns previous-Floor resolution and passes the
result into `ai/input-builder.js`. The input builder normalizes the
already checked state; it does not discover historical BioWeave facts in Chat
Metadata, registries, or runtime memory.

`existing_bioweave` and any future disease/medication/exposure history in an
AI request must therefore be one of:

- the nearest successful previous Floor's current-version analysis and active
  Events, with complete provenance; or
- the exact empty shape `{ "analysis": null, "events": [],
  "character_registry": emptyRegistry }` when no legal previous Floor exists.

The API must never receive facts from the target Floor's old result, a
deleted message/Swipe, a stale Floor Version, an orphan registry entry, or a
cache that cannot be traced to a current valid Floor. The target's
`floor_version` and `current_floor` describe the current input; they do not
authorize historical fallback.

## 8. `last_processed_floor`

`last_processed_floor` is a Chat index hint for scheduling, interval checks,
performance, or UI status. It is not a Floor owner, cursor for historical
recovery, Event index, or registry validity marker.

It may be absent, reset, lower than a newly rebuilt projection, or higher
than the remaining message collection without changing which Floors are
valid. Recomputing active state must scan current messages and version-valid
slots. A value in this field can skip an automatic request, but it can never
supply `existing_bioweave`, restore a deleted subject, or keep a stale Event
active.

## 9. Mutation Safety

Business code uses the existing Floor storage abstraction for every Floor read
and write. The abstraction owns host compatibility, Chat scope checks, cloning
and the ordinary-message/per-Swipe slot distinction. Callers do not
double-write host fields, directly mutate `message.extra` or
`message.swipe_info[swipe_id].extra`, or write a Chat-level Floor history map.

Successful analysis replaces the existing owner slot with the complete
current-version result. Failed, cancelled, stale-Chat, or invalid responses
must not commit new Events or derived facts. Preserving a prior successful
result for diagnostics does not make it active when its source version is
stale. Registry rebuilds occur from the current active collection and drop
orphan Event IDs, candidates, subjects, and event-derived references.

Event edits validate the complete affected Event collection before saving.
Deletion and lifecycle refreshes rebuild from current storage rather than
depending on one handler to erase every projection. Chat configuration and
independent identity/configuration semantics remain intact while
Floor-derived fields are invalidated.

No second historical database, permanent Floor ID ledger, or alternate
business writer is introduced to make lifecycle behavior appear durable.

## 10. Concrete Runtime Guardrails

### 1. Scope / Trigger

This section makes the ownership contract executable at the storage, Runtime,
Tracking, and API boundaries. It is required whenever a change can make a
Floor-derived value survive message deletion, Swipe deletion/switching,
version changes, reload, or an asynchronous analysis completion.

### 2. Signatures

- `store.getFloor(messageId, swipeId)` reads the requested message/Swipe owner;
  `store.getActiveFloor(messageId)` selects the current host active Swipe.
- `store.saveFloor(messageId, swipeId, data)` writes one existing owner slot and
  rejects a missing structured Swipe with `SWIPE_NOT_FOUND`.
- World Model resolution is exposed by the World/Floor boundary (for example,
  `resolveWorldModelAtOrBefore` and `resolveWorldModelStrictlyBefore`). It is
  not a Character Registry helper. A shared traversal primitive, if needed,
  must remain unaware of World Model, Events, analysis, and registry meaning.
- `findPreviousSuccessfulBioWeave(target)` returns either the nearest valid
  `{ analysis, events, character_registry }` from one Floor owner or exactly
  `{ analysis: null, events: [], character_registry: emptyRegistry }`.
- `rebuildTrackingRegistry(activeEvents, chatConfig)` returns the materialized
  `tracking_subjects`, `tracking_candidates`, and event-derived
  `character_profiles` for that `activeEvents` collection. It must not own,
  write, or refresh Floor `world_model` / `world_model_meta`; World Model is
  passed to Event Analysis only as an already resolved input DTO.

### 3. Contracts

- A structured message is readable only through
  `swipe_info[swipe_id].extra.bioweave` for an existing current Swipe. The
  active-message mirror, another Swipe, Chat Metadata, and runtime cache are
  not fallbacks.
- `activeEvents`, Tracking projections, API `existing_bioweave`, and all future
  Floor-derived history are functions of current valid Floor slots and complete
  six-field Versions. A Chat projection may be persisted for speed, but a read
  must be correct when that projection is stale or absent.
- `character_registry` in a successful Floor owner contains the cumulative
  canonical identity snapshot as of that Floor (`character_id`, display name,
  aliases). Its validity is bound to the same successful analysis and complete
  six-field Floor Version. It may only be read from the current valid
  message/per-Swipe owner. Cumulative does not mean global authoritative
  ownership.
- A Chat-level `character_registry`, if retained, is only a materialized
  projection/cache or explicitly bounded legacy-migration input. It is not an
  Analyzer historical source and cannot restore a deleted, stale, or
  Swipe-inactive snapshot. Current Character Card/Persona/World Model data
  remains independent configuration/context; historical World Model data is
  read only from its own valid Floor owner.
- Character/Event analysis, identity resolution, Character Registry updates,
  Tracking rebuilds, and Event CRUD must preserve valid Floor World Model
  fields. World Model AI/manual saves must preserve valid analysis, Events, and
  Character Registry fields. A combined update helper is forbidden.
- `last_processed_floor` is recomputed from current successful valid Floors when
  needed for scheduling. It never supplies historical input or validates a fact.

### 4. Validation & Error Matrix

| Condition | Required result |
|---|---|
| Structured active Swipe or its owner slot is absent | Read the empty Floor shape; do not read a mirror or create a slot; a save fails with `SWIPE_NOT_FOUND`. |
| Stored Floor Version is incomplete, stale, or differs from current text/Swipe | Exclude its analysis and Events from active state and previous/API history. |
| Candidate is the target Floor, not lower, not current active Swipe, or not `success` | Skip it and continue scanning older messages. |
| No candidate passes every previous-state check | Pass `{ analysis: null, events: [], character_registry: emptyRegistry }`; never consult Chat derived state or a cache. |
| Chat invalidation, owner deletion, or Version change happens during analysis | Abort/ignore the old execution and do not save its Events or terminal facts to a different owner. |
| Current valid Floor collection changes | Rebuild subjects, candidates, profiles, references, counts, and API history from that collection. |

### 5. Good / Base / Bad Cases

- **Good**: `3F -> A`, `6F -> B`, `9F -> C`; reanalyzing `9F` sends `B`, then
  deleting `9F` makes a later target use `B` again.
- **Base**: all analyzed owner messages are removed; reload produces empty
  active Events, empty previous, and empty event-derived Tracking state while
  preserving independent identity/configuration values.
- **Bad**: `Math.max(oldLastProcessed, targetFloor)`, merging an old
  `tracking_candidates` map, or falling back from a missing Swipe slot to
  `message.extra` resurrects a fact without current Floor provenance.

### 6. Tests Required

Regression tests must assert both the source and the API sink: target
self-exclusion and nearest previous; deletion/truncation fallback; empty
previous; Swipe isolation/deletion; stale Version invalidation; current-facts-
only Tracking rebuild; in-flight invalidation; hint recomputation; and reload
after deleting all analyzed owners. Request bodies must not contain deleted
Event IDs, profile evidence, or derived candidates.

### 7. Wrong vs Correct

```js
// Wrong: a stale Chat projection authorizes the next analysis.
const profiles = chatData.character_profiles;
const candidates = chatData.tracking_candidates;

// Correct: Chat fields are only the destination of a rebuild.
const activeEvents = collectCurrentValidFloorEvents();
const registry = rebuildTrackingRegistry(activeEvents, {
  world_model: resolveWorldModelStrictlyBefore(target)?.model ?? null,
});
const previous = findPreviousSuccessfulBioWeave(target);
```

## 11. Feature Development Checklist

Before adding any cross-Floor feature, answer all of these questions in the
design and executable tests:

1. Is each value a Floor fact, authoritative configuration, or derived state?
   For a disease tracker, identify the diagnosis/exposure fact and the derived
   current disease state separately.
2. If the Floor that produced the fact is deleted, should the fact continue to
   exist?
3. If it should not continue to exist, does it naturally disappear from every
   derived projection and API input?
4. Are Swipe A and Swipe B completely isolated, including after switching or
   deleting one Swipe?
5. Does a Floor Version change immediately invalidate the old fact and its
   provenance?
6. Does Chat Metadata contain a second copy of a Floor-derived fact, or is it
   only A-configuration or a rebuildable B-projection?
7. Can API input reference a Floor, Swipe, Event, or derived fact that no
   longer exists or is no longer version-valid?
8. Can plugin reload, Chat reload, history truncation, and multi-Floor
   deletion rebuild the correct state using only current valid Floors?

The implementation must also keep `last_processed_floor` as a hint, use the
Floor storage abstraction, and include regression assertions for target
self-exclusion, nearest valid previous, empty previous, active-Swipe
isolation, stale-version invalidation, deleted-owner exclusion, API
provenance, and orphan-free derived state. If any answer is unclear, do not
implement the feature yet.

## 12. Data lifecycle pointer

The detailed clear, Chat-boundary, mutation, async, and persistence contract is
maintained in [BioWeave Data Lifecycle](../../docs/bioweave-data-lifecycle.md).
This pointer does not replace or alter the Floor ownership rules above.

Lifecycle implementations MUST preserve this contract while applying the
registry-driven rules:

- Manual Character and World clear may invalidate their derived
  Snapshot/Projection state, but retain valid Floor `analysis`, `events[]`,
  and Floor-owned `character_registry` identity snapshots.
- Manual All and verified Start New Chat source cleanup remove the BioWeave
  root from the Chat and from every ordinary message and exact
  `swipe_info[*]` owner, including inactive/history Swipes, while preserving
  text and unrelated fields.
- Ordinary `CHAT_CHANGED` loads the target and preserves the source. A
  destructive source clear requires an immutable source identity, a one-shot
  transition token, official lifecycle evidence, and post-save owner checks;
  a bare `CHAT_CREATED` never supplies that proof.
- Edit, deletion, Swipe changes, and async completions continue to use the
  complete six-field Floor Version and reject stale provenance or late writes.

The lifecycle registry is the source of truth for any future persisted field;
new fields require domain, exact owner/location, clear and mutation behavior,
provenance, async guards, and contract-test coverage before acceptance.

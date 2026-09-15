# Technical Design

## 1. Single contract and information hierarchy

`.trellis/spec/domain/floor-state.md` is the only detailed authority for Floor
ownership, lifecycle, previous resolution, derived-state invalidation and API
provenance. `AGENTS.md` carries a short trigger pointer and five redlines;
`event-pipeline.md` and `world-model.md` retain their domain-specific material
and point back to the Floor contract. The same rules are not copied into
README or several competing architecture documents.

The design vocabulary is:

```text
current message + active Swipe
  -> authoritative Floor Version
  -> Floor/Swipe analysis and events
  -> current valid Floor facts
  -> derived runtime state, registries and API context
```

Chat Metadata may contain authoritative user/role/plugin configuration. A
registry, index, summary, cache, tracking subject/candidate map, or
event-derived profile field is a materialized view and cannot become an
independent historical ledger.

## 2. Evidence-backed boundaries

- `runtime/floor.js` owns the six-field version identity and current-version
  Event filtering.
- `storage/store.js` owns Floor reads and writes. Its current adapter contract
  reads ordinary messages from `message.extra` and structured messages from the
  requested `message.swipe_info[swipe_id].extra` slot.
- `runtime/event-analysis.js` owns previous-Floor resolution, active-Floor
  collection, API input assembly and lifecycle coordination.
- `core/tracking.js` owns the projection from validated Events to tracking
  subjects/candidates and registry-facing views.
- `ai/input-builder.js` is the normalization boundary; it must receive
  already-provenance-checked state rather than discovering history in host
  metadata.

The existing tests in `tests/runtime.test.js`,
`tests/event-analysis-runtime.test.js`, `tests/floor.test.js` and
`tests/tracking.test.js` are the executable examples. New assertions should
exercise these public seams and leave unrelated business behavior untouched.

## 3. Storage and Swipe contract

Keep all business callers on the store abstraction. The implementation may
adapt host compatibility at `runtime/events.js`, but callers do not directly
mutate `message.extra`, `message.swipe_info` or a Chat-level Floor map.

For a message without a Swipe structure, the normal Floor slot is
`message.extra.bioweave`. For a structured message, the requested Swipe slot
is the durable owner. Reads must not fall through to another Swipe or to a
Chat cache. Any active-message mirror required by the host remains a mirror;
the per-Swipe slot and message lifecycle determine validity. The reference
`ST-SevenDaysCal/snapshot.js` documents this host-facing distinction and is
evidence for the boundary, not a reason to add a second history store.

## 4. Previous resolution and lifecycle

`findPreviousSuccessfulBioWeave()` remains a current-message scan: walk toward
older messages, select the active Swipe, read its exact Floor slot, compute the
current text version, require complete version equality and successful
analysis, and return the nearest candidate whose Floor is lower than the
target. The target's own old slot is structurally excluded. Empty previous is
represented by the existing `{ analysis: null, events: [] }` shape.

The same current-message/version rule applies after deletion, Swipe deletion
or switch, edit/regeneration, history truncation and reload. Lifecycle handlers
may trigger invalidation or rebuild for responsiveness, but correctness must
come from the current message collection and valid Floor slots.

## 5. Derived registry and API boundary

Tests will lock the distinction between Floor facts and Chat projections:

- rebuild inputs are current valid Floor Events plus explicitly authoritative
  configuration;
- deleted or stale Floors cannot leave subjects, candidates, event references,
  capabilities or other Floor-derived evidence in the active projection;
- a mixed character profile/registry is checked by provenance, so independent
  identity/configuration continuity is not accidentally treated as a Floor
  fact;
- business DTOs and analysis inputs use the current valid projection;
- `existing_bioweave` and any historical biological state in API input carry a
  valid Floor provenance, and are empty when no valid previous Floor exists;
- `last_processed_floor` is tested only as a recomputable scheduling hint.

The task does not introduce a broad registry or repository abstraction. If a
test exposes a real violation at an existing boundary, the implementation
phase may make the smallest local correction required by the contract; a
business feature rewrite is out of scope.

## 6. Documentation and comment placement

Add one concise comment near the Floor storage abstraction, one near previous
resolution/API assembly, and one near derived registry rebuild. Each comment
names the ownership rule and points to `.trellis/spec/domain/floor-state.md`.
The detailed rationale, lifecycle matrix and checklist remain in the spec so
comments do not drift into a second contract.

## 7. Verification

After implementation, format every modified source/test/document file with the
repository-local Prettier installation before running follow-up checks. Then
run the focused Floor/runtime/tracking tests, `npm test`, and `npm run check`.
Also inspect links, placeholder text, the final diff and the working-tree
boundary. Real SillyTavern lifecycle behavior remains a separate manual host
acceptance item if the host is unavailable.

# Technical Design

## Boundary and shape

Use one small pure diagnostic helper plus existing owners:

1. A pure World Model diagnostic utility owns deterministic canonical serialization, fingerprinting, open-string address inventory, field-presence summaries, comparison, and address diff. It must not import UI, storage writers, or analysis execution code.
2. Runtime diagnostics expose the latest transient World execution/fact-delta diagnostic state and a read-only authoritative Floor snapshot method. Runtime may retain only diagnostic metadata/model copies in memory; no new persistent field or Floor slot is introduced.
3. `ui/app.js` remains the presentation owner and supplies the current `worldModelState` plus a last-render diagnostic record. The render path records the exact canonical/ViewModel data identity it consumed, not merely a render event.
4. Settings Debug Popup/export code calls a fresh async collector at the user action boundary. The collector reads Runtime diagnostic state, the existing authoritative Floor resolver/read API, current UI state, and last-render diagnostic, then invokes the pure comparison helper and combines the current trace buffer as history.

## Proposed data flow

```text
Settings open/refresh/copy/export action
  -> collectWorldModelLiveState()
     -> capture target identity + started_at + snapshot_id
     -> read runtime diagnostic state (no analysis)
     -> read existing authoritative World/Floor resolver (no writer)
     -> read current app worldModelState
     -> read last render diagnostic
     -> verify target identity; at most one retry
     -> fingerprint/count/address inventory + comparisons/diffs
     -> capture completed_at and trace buffer metadata
  -> render/copy/export { DEBUG METADATA, WORLD MODEL LIVE STATE, HISTORY TRACE }
```

The live section is sampled at action time. The history section remains the event buffer and is explicitly labeled as such; it is never used as a substitute for any live layer.

## Identity and fingerprint

- Canonicalization recursively sorts object keys, preserves array order, preserves primitive types, and does not mutate input.
- `null` is represented by a stable `null` state and no hash; absent/unavailable fields remain explicit status values rather than being converted to empty objects.
- Reuse the existing SHA-256 implementation (`runtime/floor.js` / `utils/hash.js`) through a narrow helper. Because the existing digest is async, the fingerprint API may be async; full hash remains machine-readable and a shortened display form can be added at formatting time.
- Address inventory emits sorted unique `Species` and `Species / Biological_Type` addresses from the actual model. It is schema-generic and has no species-name branches.
- Field summaries are presence-sensitive and keep `true`, `false`, `null`, missing, and collection counts distinct; they do not dump full model bodies.

## Layer contracts

- Latest Supplement / Fact Delta: read the latest retained transient execution diagnostic, not the last arbitrary trace entry. Include execution IDs and existing summary counters. Candidate fingerprint is populated only when a candidate/accepted model is already retained; otherwise `unavailable` with `candidate_not_retained`.
- Runtime: expose the latest transient runtime World state diagnostic with target identity, model fingerprint, counts, and addresses. If no current retained state matches the active target, report unavailable rather than using stale execution history.
- Floor: use the current authoritative resolver/read path, validate the returned Floor Version against the active target, and report read failure with a stable error code without throwing through the settings export.
- UI: use the `worldModelState` closure directly. When UI has a canonical model DTO, compute both canonical and ViewModel fingerprints as appropriate; otherwise only expose ViewModel fingerprint with a source label.
- Render: at the actual `render()` call, record the model/ViewModel identity and counts consumed for the World route. Do not scrape DOM or store DOM.

## Async consistency

Capture target before reads and again after all reads. Compare the complete six-field Floor identity plus chat. If it changed, do not compare layers as a normal snapshot; mark `snapshot_consistent: false`, set `snapshot_invalidation_reason: active_target_changed_during_collection`, and optionally retry once from a fresh target. If the retry also changes, return the invalid snapshot with explicit identity-before/after fields.

## Compatibility and safety

- No business logic, parser, prompt, Evidence Guard, schema, resolver semantics, or coordinator behavior changes.
- No new persistence root, Floor field, chat-level fact, or Debug writer.
- Existing `getPersistenceTrace()` remains available and is copied only as the HISTORY TRACE portion. Its capacity/truncation metadata is reported from the actual buffer; no truncation claim is invented.
- Diagnostic callback failures are swallowed or represented as unavailable and cannot fail World analysis or UI rendering.

## Test strategy

Add a focused diagnostic test module for the pure helper and collector with abstract `Species-A`, `Species-B`, `Type-A`, `Type-B`, `Type-C` fixtures. Stub read-only runtime/Floor/UI providers and writer spies. Keep existing World Model business tests unchanged except for any needed trace assertions. Add/extend static gate assertions to ensure Debug/UI modules do not introduce Floor writers.

## Rollback

Rollback is file-scoped: remove the diagnostic helper, collector wiring, render diagnostic hook, and focused tests while retaining existing trace behavior. No persisted data migration or Floor cleanup is required.

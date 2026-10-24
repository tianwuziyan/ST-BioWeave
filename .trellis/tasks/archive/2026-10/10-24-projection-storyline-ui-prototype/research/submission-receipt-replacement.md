# Research: Same-Floor storyline submission receipt replacement

- Query: Why `storyline_delivery_records` accumulates same-Floor submission receipts, and where repeated same-Floor test generation should replace rather than accumulate them.
- Scope: internal
- Date: 2026-10-24

## Findings

### Root cause

The accumulation is an identity/append-semantics mismatch, not a Floor ownership bypass.

- `runtime/projection-context.js:467-470` records a storyline submission after every successful non-read-only context write when the prompt contains the storyline block. It iterates each non-terminated storyline snapshot.
- `runtime/projection-storyline-runtime.js:98-103` creates a submission receipt whose identity includes `generationId` (falling back to `floor.version.content_hash`) and whose context fingerprint is the current prompt fingerprint.
- `core/projection-storyline.js:36,79-80` builds `delivery_record_id` from `kind`, `subject_id`, `response_id`, the full `floor_version`, and `context_fingerprint`. Therefore, a repeated test generation on the same Floor with a new generation ID or changed prompt fingerprint is intentionally a new ID.
- `core/projection-persistence.js:96-98` normalizes storyline deliveries by `delivery_record_id`, and `appendProjectionStorylineDelivery()` only deduplicates an exact ID/content repeat. A different generation ID/fingerprint is appended.
- `storage/projection.js:78-105,270-272` correctly enforces current Character Floor/active Swipe/six-field version and commits through the normal projection Floor coordinator; it does not define the record identity and is not the source of accumulation.

This also explains why the current runtime test at `tests/projection-storyline.test.js:486-510` only verifies that same-Floor receipts are excluded as prior evidence. It does not assert that repeated same-Floor submissions are collapsed. Existing context tests (`tests/projection-context.test.js:636-662`) verify that an unchanged cached context avoids a second write, but a new generation/context refresh can still legitimately invoke the receipt writer.

### Minimal safe change boundary

Implement replacement in the shared core append/normalization semantics, reached through `storage/projection.js`, rather than adding cleanup in runtime:

1. Keep `buildStorylineDeliveryId()` unchanged for provenance/debug identity and for historical records.
2. In `appendProjectionStorylineDelivery()` (and/or its input normalization path), treat a `kind === 'submission'` as current-Floor singleton per `(subject_id, created_at_floor_version)`. Before appending the new normalized submission, remove/replace all existing submission records for the same subject and exact six-field `created_at_floor_version`.
3. Preserve all `response` records, all submissions on different Floors, and submissions for other subjects. Exact same-record repeat should remain `deduped`; a changed same-Floor record should return a replace/changed status so `mutateFloor()` commits the cleaned collection.
4. If old duplicate same-Floor records already exist, the replacement operation should filter all matching records, not only the first one. This makes the next valid write self-healing without a broad migration.

The comparison must use all six Floor Version fields (`chat_id`, `message_id`, `floor`, `swipe_id`, `content_hash`, `message_version`), not numeric floor alone. The existing Floor validation in `storage/projection.js:81-83` already rejects stale/mixed records before mutation, so the replacement does not weaken ownership checks.

### Storage vs runtime ownership

Old records should be removed/replaced at the core persistence append boundary, not by `runtime/projection-context.js` or `runtime/projection-storyline-runtime.js`. The runtime knows when a context was generated, but it does not own the Floor timeline and cannot safely rewrite prior receipts without bypassing the coordinator. The storage facade already supplies the correct owner/version transaction (`storage/projection.js:270-272`); the core append function is the narrowest place to express the collection invariant.

Runtime changes are unnecessary unless the product intentionally wants a different receipt cadence. Keep the runtime's same-Floor exclusion in `runtime/projection-storyline-runtime.js:324-334`: a receipt generated on the current response Floor must not become evidence for that same settlement. Replacement only prevents duplicate current-Floor historical receipts; it does not make them prior evidence.

### Tests to add/update

- Add a persistence test adjacent to `tests/projection-persistence.test.js:810-832` using two `createStorylineDelivery({kind:'submission', subject_id:'char-1', ...})` records with the same full Floor Version but different generation/response ID and fingerprint. Assert the second write changes the timeline but leaves exactly one same-Floor submission, and that an exact repeat remains deduped/no additional save.
- Include a pre-seeded timeline containing two same-Floor submission records with different IDs, then write a third; assert all same-subject/same-Floor submissions collapse to the new one while a response and another subject remain.
- Add/extend a runtime/context regression only if desired to document that repeated test generation invokes the writer; the behavioral guarantee belongs in persistence tests.
- Existing tests to preserve: same-Floor receipts are not prior evidence (`tests/projection-storyline.test.js:486-510`), read-only context never writes a storyline receipt (`tests/projection-context.test.js:688-710`), and exact idempotency behavior in the projection persistence suite.

### Related specs and docs

- `.trellis/spec/domain/floor-state.md` (projection storyline contract): delivery replay is historical, receipts require a prior valid Floor submission, and Floor ownership/version rules apply.
- `docs/bioweave-data-lifecycle.md:317-333`: `storyline_delivery_records` are Floor-owned submission/response receipts used for cadence; current response Floors must not retroactively consume context generated after them.
- `docs/ARCHITECTURE.md:197-200` places storyline snapshots/receipts in the current legal Floor projection-view and runtime diagnostics boundary.

The existing docs remain accurate if the change is described as same-Floor submission replacement/idempotency. If the record invariant becomes normative, add one sentence to the lifecycle contract stating that active same-Floor submission receipts are singleton per subject while response receipts remain appendable.

## Caveats / Not Found

- No existing test currently covers two different same-Floor storyline submission IDs in one `storyline_delivery_records` collection; current tests cover exact repeats and the “not prior evidence” rule only.
- `normalizeProjectionTimeline()` currently deduplicates storyline receipts by delivery ID and can retain pre-existing duplicates. Replacement logic must therefore remove every matching same-Floor submission during a new write; a pure ID-key change would not clean old data.
- This investigation did not edit production code, tests, specs, or docs.

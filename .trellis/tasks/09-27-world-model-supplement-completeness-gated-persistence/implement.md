# Implementation Plan

1. Audit current tree, retry wrapper, Supplement analyzer/protocol, runtime World save path, UI application-state adoption, diagnostics, and protected Floor boundaries.
2. Add/adjust protocol helpers and focused tests for stable target IDs, coverage dispositions, identity reviews, exact accounting, non-target Facts, and completeness failure.
3. Reuse the current attempt/retry path and add explicit incomplete diagnostics without creating a second retry framework.
4. Add bounded recent execution summaries and `latest_nonempty_fact_delta`; update the existing Settings LIVE STATE view only as needed for clarity.
5. Add the no-op persistence gate at the runtime candidate-vs-authoritative decision. Implement UI adoption gating only after proving the existing application-state hook and stale/idempotent behavior.
6. Run focused tests and static boundary checks; review the diff for forbidden Floor/UI/Evidence Guard changes.
7. Run `node --check` on all modified JS, `npm run check`, and `git diff --check`; leave changes uncommitted and unpushed.

## Current implementation audit/result

- Existing retry path is `runtime/event-analysis.js::runAnalysisStageWithRetry`: one
  configured stage budget is reused for analyzer, completion, persistence and readback
  failures; an analyzer completeness error therefore retries through the same path and
  reaches terminal failure without entering `saveWorldModel`.
- Existing Supplement path is response -> Fact Delta parser -> resolver -> existing
  Evidence Guard -> internal Patch v2 -> `runtime/world-analysis.js::saveWorldModel`.
  Coverage and Identity Review are now independent transient protocol sections; Facts
  remain on the existing parser/resolver/Guard path.
- Coverage IDs and identity subject IDs are deterministic `*-v1-####` IDs based on the
  sorted/deterministic builder order. Coverage disposition is exact `EMITTED` or
  `NO_EVIDENCE`; identity review is exact `REVIEWED` and species-level only.
- The runtime now compares the normalized candidate against the authoritative current
  Floor World Model before save. Equal candidates emit `WORLD_PERSISTENCE_SKIPPED` with
  `canonical_noop` and do not call `saveWorldModel` or create a Floor transaction.
- UI-gated adoption is intentionally deferred: the existing UI path calls
  `runtime.saveWorldModel` directly for manual edits and has no exact candidate-revision,
  owner/epoch/idempotent acknowledgement hook for automatic adoption. Adding one would
  create a second writer/ambiguous acknowledgement contract, so no UI gate was invented.

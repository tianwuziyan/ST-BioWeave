# Projection Runtime Integration Design

## Architecture boundary

Introduce `runtime/projection-runtime.js` as the Projection Runtime feature owner. `runtime/events.js` only composes and wires it, `runtime/event-analysis.js` exposes the already-derived factual inputs/success boundary, `storage/projection.js` remains the Floor-owned persistence facade, and UI modules consume Runtime DTOs.

Projection is an independent post-processing pipeline:

```text
factual Floor success
  -> read current Projection views
  -> evolution
  -> persist terminal lifecycle
  -> reread views
  -> eligibility
  -> serial generation of missing eligible identities
  -> Floor-owned persistence
  -> reread views
  -> Runtime DTO / Context / UI refresh
```

It never changes factual Event, Registry, State, or Snapshot semantics and never blocks their successful persistence.

## Execution identity and concurrency

Use the repository's existing canonical serialization/hash utility rather than a new unstable hash. The execution key contains Chat identity, complete source Floor Version, active Swipe, factual-basis fingerprint, and World/projection-rule fingerprint. A Runtime-local single-flight map is keyed by this execution identity. Logical `projection_id` remains the durable dedupe identity and is never substituted by the execution key.

Execution is serial per eligible decision. A completed candidate is persisted before the next decision begins. A sibling failure produces partial failure without rolling back already confirmed candidates.

## Data and guards

At start, collect authoritative valid Events, source candidates, Current Biological State, Character Facts, World Model, Story Time, and current Projection views. Before AI, after AI, and immediately before persistence, verify Chat, owner message, complete Floor Version, active Swipe, execution key, source-basis fingerprint, Story Time, World/rule identity, and subject/rule/concern identity. Any mismatch returns stale and writes nothing.

`storage/projection.js` remains the final owner/version/Swipe guard. No second persistence root or Snapshot copy is introduced.

## Evolution and eligibility

Evolution runs only for non-terminal current views. `keep_active` and `unresolved` write nothing. `realized`, `contradicted`, and `expired` use `saveEvolutionDecision()`, then views are reread. Eligibility is then evaluated against the reread views. Only eligible decisions without an existing same identity may call generation. Missing contributor evidence remains unresolved.

## Generation and AI boundary

Adapt the existing `ai/analyzer.js::generateProjection` to the existing `generateProjectionCandidate()` callback. Do not duplicate prompts, schema, parsing, or validation. Use one request per decision, no batch, concurrency one, deterministic canonical-ID ordering. Raw AI responses are never persisted.

## Context and DTO boundary

Runtime DTOs are mapped only from `getProjectionViews()`. `collectActiveBusinessData()` returns DTOs and summaries without executing Projection. Context refresh consumes persisted `context_visible` views only. The factual execution captures its Context before post-processing; newly generated same-Floor Projections cannot be fed back into that execution. Context may be refreshed after post-processing for subsequent factual execution.

## UI boundary

`ui/projection.js` renders the DTO list, status, empty state, refresh, and existing append-only delete operation. `ui/overview.js` receives only active count/recent summary. Neither module reads storage or invokes AI or business rules.

## Failure and retry

All Projection errors are Projection-only. Eligibility/evolution failure stops the current Projection execution before generation. Per-decision AI/validation failure does not roll back successful siblings. Persistence failure is independently retryable. Ordinary reads never retry or generate. `refreshProjection` is the explicit Projection-only retry entry point; a later successful factual Floor may naturally run a new execution if the logical identity is still absent.

## Compatibility and rollback

Existing Core, persistence, Snapshot, StateReducer, World Model, Tracking Window, Gestational Age/EDD, and Genealogy contracts remain unchanged. If a direct persistence or core contract gap is discovered, stop and report `CONTRACT_GAP_REQUIRES_CORE_CHANGE` instead of creating a parallel implementation.

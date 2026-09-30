# Technical Design

## Boundary

Keep the change in the existing UI presentation/interaction boundary. Add one
small pure active-data predicate in the World UI module (or reuse it if an
equivalent canonical helper is found during implementation). `worldPage()` and
the Full action gate both consume that predicate. The click handler must read
`worldModelState.model` at click time; it must not trust rendered text or a DOM
data attribute.

## Empty Semantics

`hasWorldModelData(rawModel)` is a pure helper. It first normalizes the supplied
active model through `normalizeStoredWorldModel()` and then checks only actual
canonical world facts:

- any normalized `species[]` entry counts as active species data;
- `medical_context` counts only when at least one normalized field contains
  non-empty text;
- `exceptions[]` counts only when an entry has non-empty `statement`,
  `applies_to`, or `evidence`;
- a non-empty normalized `unknowns[]` or `projection_rules[]` counts as data.

Default arrays, nulls, empty strings, and the normalized default medical
context do not count. `world_model_meta.archived_species[]`, debug/meta,
analysis bookkeeping, timestamps, and schema/version fields are excluded.
Invalid/unavailable input is treated as empty for the CTA predicate, while the
existing UI-ready and Runtime validation paths remain unchanged.

This predicate is only for CTA existence. It must not weaken the existing
`buildWorldModelViewModel()` UI-ready gate or alter Runtime/analysis semantics.

## Interaction Flow

```text
render worldPage(model)
  -> active World Model predicate
  -> busy label if Full is running
  -> otherwise 开始分析 / 重新分析

Full click
  -> if busy: existing abort-confirmation path
  -> otherwise current active World Model predicate
       -> empty: analyzeWorldModel('full')
       -> populated: confirmWithPopup(...)
            -> false: return
            -> true: analyzeWorldModel('full')
```

The confirmation is awaited before the Full flow is invoked. The cancellation
branch performs no clear, save, AI, busy transition, or state mutation. The
existing Full Runtime path remains the sole owner of replacement persistence
and archive handling.

## Compatibility and Risks

- Preserve `data-bioweave-action` selectors, function signatures, busy/cancel
  behavior, and the Supplement branch.
- Keep the current `worldPage()` body behavior for valid populated models.
- Test direct rendering separately from app click behavior so stale-state and
  confirmation cancellation are observable.

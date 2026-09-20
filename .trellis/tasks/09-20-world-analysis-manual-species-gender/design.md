# Technical Design

## Boundary

The existing World Model contract remains authoritative. Manual collection edits operate on a cloned canonical `world_model` DTO and reuse the existing World/Floor Runtime save seam. No schema migration, Chat-level state, manual override layer, provenance field, or AI incremental-analysis refactor is introduced.

## Data flow

```text
current UI model
  -> clone + targeted collection update
  -> normalizeWorldModel()
  -> runtime.saveWorldModel({ model, meta: existingMeta })
  -> current Floor owner via store.saveFloor()
  -> authoritative result returned to UI
```

The Runtime keeps the existing chat token, current Floor Version, active Swipe, owner verification, and stale-write assertions. `saveWorldModel()` continues to replace only `world_model` and `world_model_meta`; the UI passes the resolved meta unchanged.

## Canonical shapes

- New species: `{ name: trimmedName, description: null, biological_types: [] }`, then canonicalized through `normalizeWorldModel()` so the existing schema remains the sole source of defaults and validation.
- New biological type: a complete existing biological type object with the requested trimmed `name`, nullable description, null capability/rule/lifecycle fields, and empty `special_rules`; it is appended only to the selected species. This is an existing schema object, not a second simplified type schema.
- Duplicate checks compare trimmed names within the target collection. No case folding or aggressive semantic normalization is added.

## UI/state

`ui/world.js` renders two compact Font Awesome action groups: one in the species section header and one in the biological_types section header. Species and biological type cards are selection buttons only; no card carries an add/delete action. Runtime state keeps `selectedSpecies` and `selectedBiologicalType` separately, each with name snapshots for fail-closed stale-target validation. Inline add rows remain local and work in narrow panels. Section controls carry `title` and `aria-label`, and become disabled while the World Model state is busy.

`ui/app.js` owns the async mutation flow. A single mutation helper clones the current model, applies one species/type operation, canonicalizes it, captures the current meta unchanged, sets busy, calls `runtime.saveWorldModel()`, verifies the analysis chat token, then updates UI only after successful persistence. On failure it leaves the prior authoritative UI model untouched, clears busy, and reports through the existing notification path.

Before every delete, the corresponding selection is validated against the current model and its name snapshots; a mismatch fails closed without mutating data. Switching species clears the biological type selection. Successful species deletion clears both selections; successful type deletion clears only the type selection. Successful additions select the newly created item. Empty collections render existing empty states without inventing fallback entries.

## AI interaction

`analyzeWorldModel()` remains a full replacement save. A subsequent AI result that omits a manually added item can replace it. Tests document this behavior; no merge or manual provenance is added.

## Compatibility and rollback

Existing section editing, World Model reload/resolution, Floor lifecycle clear behavior, and all other domains remain unchanged. If implementation fails, revert only the new collection helpers, UI controls/styles, tests, and task artifacts; do not alter Floor ownership or storage contracts.

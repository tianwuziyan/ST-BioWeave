# Technical Design

## Boundaries

`core/world-species-archive.js` is a pure transformation boundary. It accepts canonical model/meta values and returns cloned `{model, meta}` results or a fail-closed diagnostic. It owns identity normalization, archive entry normalization, duplicate/collision decisions, minimal references, and deterministic archived subtree filtering.

UI remains an orchestrator/consumer: it reads the current selected canonical subtree, calls the pure module, then calls the existing runtime save once with both outputs. UI does not access Floor storage or the Coordinator.

World runtime remains the persistence and analysis owner. `saveWorldModel` stays the only World writer. `resolveWorldModelAtOrBefore` returns the current authoritative model/meta pair; Full and Supplement derive archive references from that metadata at the analysis input boundary.

## Data contract

```json
{
  "world_model": { "species": [] },
  "world_model_meta": {
    "archived_species": [
      {
        "species": { "name": "Species-A", "description": "...", "biological_types": [] },
        "archived_at": "2026-09-29T00:00:00.000Z",
        "archived_by": "manual"
      }
    ]
  }
}
```

`world_model` remains canonical active knowledge. `archived_species` is Floor-owned metadata and is never normalized into the canonical model. Archive references expose only stable identity fields (currently `name`) to prompts and diagnostics.

## Analysis flow

Full: resolve current Floor metadata → build minimal archive reference → pass it in Full analysis input → production Full prompt states exclusion → normalize model → deterministic archived subtree filter → existing `saveWorldModel` transaction/readback.

Supplement: resolve model/meta → build minimal archive reference → pass it in patch input → `buildWorldModelPatchMessagesV2` renders a dedicated exclusion section → Fact Delta resolves addresses → archived identity gate rejects the full species/type subtree with `ARCHIVED_SPECIES_EXCLUDED` → existing Patch v2 merge/persistence remains unchanged.

The archived gate is identity-based and deterministic. It does not inspect narrative meaning, classify semantics, or alter the wire format. It runs after canonical address resolution and before accepted operations are merged.

## UI state

Add a small archive-view state to the existing World UI state. The active selector continues to receive only `model.species`. The archive view receives `meta.archived_species`, renders names only, and dispatches restore with an archive index/identity. Restore and archive both save `{model, meta}` once, then use existing authoritative UI state/readback behavior.

## Lifecycle and compatibility

Register `world_model_meta.archived_species` as part of the existing World Floor field; World clear and All clear remove it together with `world_model_meta`. Missing metadata normalizes to an empty archive, preserving old Floors. No new storage root, schema version, Chat map, or blacklist is introduced.

## Risks and rollback

Risk is accidental re-identification through type/detail Facts or Full output. The shared identity gate and final Full filter cover both paths. If implementation fails validation, revert only task-owned files/patches; existing World persistence and schema remain untouched.

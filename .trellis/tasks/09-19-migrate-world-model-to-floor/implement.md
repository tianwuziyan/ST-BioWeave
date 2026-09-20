# Implementation plan

World Model Floor migration does not merge the World Model domain with
Character/Event Analysis. Floor Store is shared infrastructure only.

1. Activate the task only after this plan is approved; load `trellis-before-dev` and the domain/frontend spec indexes.
2. Update schemas, Floor normalization, lifecycle registry/clear rules, and lifecycle/domain documentation. Verify old Floor shapes remain readable and record the World/Character ownership split.
3. Implement World Model resolver/save behavior in the World/Floor seam only; expose only the runtime methods UI and Event Analysis need. Do not place World resolver logic in Character Registry helpers.
4. Replace UI load/AI-save/manual-save Chat metadata paths with current-Floor resolver/save calls; preserve token, version, abort, and notification behavior.
5. Replace Event Analysis Chat-level read with strict prior-Floor resolution. Confirm target-floor semantics in tests and retain normal AI DTO `world_model` fields; Event Analysis only consumes the resolved DTO.
6. Add focused tests for schema/store, resolver, AI/manual persistence, deletion/invalidation, Swipe branching, legacy behavior, future-floor isolation, and cross-domain ownership preservation. Extend existing fixtures rather than creating a parallel store.
7. Update README/DATA-MODEL/lifecycle docs and perform global source search distinguishing Floor state from AI DTO/schema fields.
8. Run `npm test`, targeted world/floor/runtime tests, `node --check` on changed JS where applicable, and Trellis quality check. Inspect `git diff` and `git status` before reporting.
9. Real-host acceptance remains required after plugin refresh: ordinary message, multiple Swipes, edit/delete, deletion of latest model Floor, Chat switch, and UI manual/AI saves.

## Risky files / rollback points

- `storage/schema.js`, `storage/store.js`, `storage/lifecycle.js`: ownership and compatibility boundary.
- `runtime/floor.js`, `runtime/event-analysis.js`, `runtime/events.js`: version-valid historical resolution and public runtime API.
- `ui/app.js`: current UI load and two save paths.
- `docs/bioweave-data-lifecycle.md`, `.trellis/spec/domain/floor-state.md`, README/DATA-MODEL: normative contract synchronization.
- `.trellis/spec/domain/world-model.md`, `.trellis/spec/domain/event-pipeline.md`, `.trellis/spec/frontend/state-management.md`: explicit World/Character/Event business boundary and no-cross-domain writer examples.

Rollback points are after schema/lifecycle, after runtime resolver, after UI migration, and after tests/docs. Never use destructive Git reset/clean; preserve unrelated work if it appears.

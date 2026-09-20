# Implementation Plan

1. [x] Load the domain/frontend specs and current task artifacts before editing; verify the worktree remains clean and record the exact current World Model seams.
2. [x] Add focused pure helpers in the existing World Model UI/domain seam for cloning, canonical new species/type defaults, trimmed duplicate checks, and targeted species/type updates without mutating unrelated fields.
3. [x] Extend `ui/world.js` with species-scoped “性别 / 生物类型” rendering, two section-local icon-only action groups, separate runtime selections, and inline add forms. Preserve empty states, narrow layout, Font Awesome dependency, and accessibility attributes.
4. [x] Extend `ui/app.js` event delegation and async save flow. Reuse `runtime.saveWorldModel()`, preserve resolved meta, guard busy/stale Chat state, and update state only after persistence succeeds.
5. [x] Add tests for species/type add/delete, empty/duplicate input, deep preservation of unrelated model data and meta, reload behavior, Floor/Swipe isolation, failed persistence recovery, and AI full-replacement interaction.
6. [x] Run focused World Model/UI tests, then `npm test`, `npm run check`, `node --check` on every modified JS file, and `git diff --check`.
7. [x] Inspect the final diff for forbidden Chat/global/local persistence, schema duplication, unrelated domain changes, and commit/push absence. Real SillyTavern refresh plus Desktop/Tablet/Mobile acceptance remains a handoff item.

## Risk gates

- Do not write product code before task activation and `trellis-before-dev`.
- If current resolver/save signatures differ from the audited state, stop and re-audit instead of bypassing the Runtime facade.
- If canonicalization rejects the new object shape, adapt to the existing schema helpers; do not weaken validation.
- If a save fails, do not assign the candidate model to UI state.

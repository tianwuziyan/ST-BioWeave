# Polish Floating Launcher UI

## Goal

Polish the existing Floating Launcher host UI without changing Runtime Activity,
analysis, projection, storage business semantics, or the magic-wand entry.

## Requirements

- Add a compact top-bar icon beside the theme control that toggles the existing
  `show_floating_launcher` global preference and stays synchronized with Settings.
- Make all Floating Launcher user-facing Settings text concise Chinese and place
  the section immediately before the final debug section.
- Remove `floating_launcher_snap_to_edge` completely from code, tests, schema,
  persistence, and documentation; drag release only clamps and saves.
- Reduce visible launcher chrome to approximately 38–40px while retaining a
  usable 44px-or-larger interaction area.
- Verify the existing Activity busy → running class/state → CSS animation path;
  running gets restrained rotation/breathing, while idle/success/error do not.
- Preserve reduced-motion behavior, click/drag semantics, exact-position restore,
  magic-wand visibility, and all business/runtime contracts.

## Acceptance Criteria

- [ ] Top-bar and Settings toggles use the same persisted preference and update
  the launcher immediately in both directions.
- [ ] No user-visible Floating Launcher section text contains the old English
  product labels.
- [ ] Snap code, setting, tests, and docs are absent.
- [ ] Drag, clamp, reload, state rendering, reduced-motion, placement, and
  synchronization regressions are covered by tests.
- [ ] `node --check`, focused tests, `npm run check`, and `git diff --check` pass.

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.

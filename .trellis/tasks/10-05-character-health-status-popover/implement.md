# Execution Plan

1. Re-read exact current context before editing and confirm worktree scope; preserve unrelated changes.
2. Update `ui/characters.js`: replace the body health section with the title-bar button and A-variant popover markup; keep Runtime-only fields, canonical source hooks, empty state, and three-column issue rows.
3. Update `ui/app.js`: add health popover state/toggle/close helpers, wire the existing delegated action path, outside-click behavior, Escape priority, and cleanup on character/route/panel lifecycle changes.
4. Update `style.css`: add scoped button/status/popover/source-list styles matching the attachment and existing tokens, with Desktop/iPad and Mobile media behavior and overflow guards.
5. Update focused tests for button states, no duplicate body section, single/multiple sources, outside click, Escape priority, and lifecycle cleanup.
6. Check affected Markdown/UI reference files and synchronize only docs whose current claims or examples become stale; do not copy static prototype data or variant controls.
7. Run `node --check` on changed JavaScript, focused UI tests, `npm run check`, and `git diff --check`; inspect status/diff and report baseline failures separately.
8. Record real-host acceptance checklist for Desktop, iPad, and Mobile; do not commit or push.

## Validation commands

- `git status --short`
- `node --check ui/characters.js`
- `node --check ui/app.js`
- `node --test tests/phase2a-ui.test.js tests/ui.test.js`
- `npm run check`
- `git diff --check`

## Review gates

- No Runtime/Domain/Storage/Projection files modified.
- No B/C variant, switcher, static demo data, or URL variant parameter in production files.
- `data-bioweave-action="view-health-source-event"` and canonical Event IDs remain unchanged.
- Markdown/UI framework synchronization is checked against the final diff.

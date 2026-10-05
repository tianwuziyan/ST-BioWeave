# Technical Design Plan

## Boundaries

- `ui/characters.js` remains the sole owner of Character Details markup and only consumes the existing `currentHealthState` DTO. It will extract a compact read-only health presentation from `current_health_summary` and `grouped_issues`, while keeping existing source-event filtering and navigation hooks.
- `ui/app.js` remains the lifecycle/event owner. A small local health-popover state will be coordinated with the existing alias/timing popovers, outside-click delegation, Escape priority, route changes, focus changes, close, and destroy paths.
- `style.css` receives a page-scoped `bioweave-character-health-*` presentation block based on the attachment A geometry and existing tokens. Desktop/iPad use absolute positioning below the identity header; Mobile uses a fixed bottom surface with bounded height and no page overflow.
- `tests/phase2a-ui.test.js` receives focused rendering/source-hook regressions; app-level tests receive interaction/lifecycle regressions using the existing fake DOM/app harness where appropriate.

## Data flow and contracts

1. `businessState.currentHealthState` is passed unchanged from `ui/app.js` to `charactersPage()`.
2. The selected canonical character ID indexes `currentHealthState.characters[characterId]`.
3. UI derives only presentation facts already supplied by Runtime: issue presence, summary text, grouped issue descriptions/sites, and source observation IDs. It does not calculate severity or lifecycle.
4. Source IDs are filtered against current character-owned active Events using the existing helper, then rendered with the existing `view-health-source-event` action and `data-bioweave-event-id`.
5. The popover itself is rendered only when local `healthPopoverState` targets the selected character; when closed or stale, no old markup remains.

## Accessibility and lifecycle

- Health button uses `aria-expanded` and stable `aria-controls="bioweave-character-health-popover"` while rendered; popover uses `role="dialog"`, `aria-labelledby`, and a labelled close button.
- Opening focuses the close button when the DOM is available; closing restores focus to the health button only if it is still connected and still targets the same character.
- Outside click closes only the health popover, while clicks on the health button toggle it. Alias/timing popovers keep their existing behavior.
- Escape order is health popover, alias editor, timing editor, world archive, then main panel. Route/person/chat changes reset the local state before render.

## Compatibility and rollback

- No Runtime DTO or persistence changes are required.
- The old health section renderer and only its now-unused presentation styles/tests are removed or updated in the same change; the source filtering/navigation helper is retained.
- Rollback is limited to the new Character UI markup, app-local popover lifecycle, scoped CSS, tests, and synchronized UI documentation. Existing unrelated worktree changes must remain untouched.

# Quality Guidelines

BioWeave UI changes are checked as host-integration code, not only as isolated
JavaScript. A passing Node test does not prove that a SillyTavern menu click
survives a mobile viewport or host drawer overlay.

## Forbidden Patterns

- Do not use BioState, bw-*, bw-, bio-*, or avatar-specific selectors.
- Do not mount the main UI inside #extensionsMenu.
- Do not call document.body.click() to force the host dropdown closed.
- Do not use a non-null cache as a DOM liveness check; use isConnected or
  document containment.
- Do not add a permanent top-level BioWeave button as a fallback for a broken
  extension-menu path.
- Do not put API, Worldbook, World Model, Event, Snapshot, Projection, or log
  business data into UI mock DTOs.

## Required Patterns

- Use #extensionsMenu only for one stable BioWeave entry and clean it up on
  destroy/reload.
- Use mountBioWeave, openBioWeave, closeBioWeave, and destroyBioWeave as
  idempotent lifecycle boundaries.
- Keep the documentElement-level overlay above ordinary host overlays but below
  SillyTavern modal and Toast layers, with explicit
  top/left and 100vw/100vh plus 100dvw/100dvh sizing, min-width: 0, internal
  scrolling, and safe-area handling. Do not rely on inset: 0 for the mobile host.
- Use CSS tokens for Tavern/day/night themes. Theme changes must only update
  BioWeave root state and local persistence.
- Keep the complete route set in a real DOM top routebar; on mobile it becomes
  a compact multi-row grid rather than a horizontal scroller or visual-only
  carousel.

### World page reference alignment

When a provided static HTML reference is the visual source of truth, keep the
override local to `.bioweave-world-model-page` and explicitly reset inherited
BioWeave/SillyTavern styles that affect the reference measurements. This
includes margins, borders, display modes, grid gaps, and native control font
properties; do not rely on the existing generic `.bioweave-*` rules winning by
order alone.

```css
.bioweave-world-model-page .bioweave-world-model-title-copy {
  margin-top: 0;
  border-top: 0;
}
```

Map colors through the existing BioWeave theme tokens, but keep reference
values such as `14px/1.5`, `38px` controls, and the `768px` / `1200px`
responsive boundaries in the page-scoped block. Never use a global `body`,
`button`, or generic BioWeave selector to repair World UI appearance.

## Testing Requirements

- Run npm test, npm run check, and node --check for changed JavaScript.
- Add a focused regression when changing a lifecycle, host event, route, or
  responsive contract.
- Use a real browser or SillyTavern page for Desktop, Tablet, and Mobile
  smoke checks. Drawer/pointer interception may be recorded diagnostically,
  but manually closing the drawer is not an accepted opening prerequisite.
- Confirm no ordinary mobile horizontal overflow and confirm that the menu
  closes without removing the body overlay.

## Code Review Checklist

- [ ] Main UI is outside #extensionsMenu.
- [ ] Root and menu registration are unique after init, host DOM rebuild, close,
      reopen, Chat change, and destroy.
- [ ] No host theme mutation or global body class is introduced.
- [ ] All own selectors use bioweave-*.
- [ ] Unfinished business pages are explicit placeholders, not fake persisted
      data.
- [ ] Node tests and browser smoke checks both passed or the remaining host
      limitation is stated.

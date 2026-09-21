# Design QA

- source visual truth: `docs/CHARACTERS_PAGE_DEDUP_PROTOTYPE.html?variant=A`
- implementation: `docs/UI_FULL_REFERENCE.html?route=characters&device=desktop&theme=dark`
- browser: Codex in-app browser
- desktop viewport: `1280 × 720`, device pixel ratio `2`
- mobile state: reference page `device=mobile`, dark theme
- verified states: default character detail, nickname editor open/closed, first event expanded/collapsed, desktop/mobile switch

## Full-view comparison

The implementation keeps the selected A layout's visual hierarchy: a compact character list, one identity header, one continuous detail surface, three-column capability/state summaries, and compact event rows. The reference keeps BioWeave's existing shell, navigation, tokens, and sample data while adopting the selected information architecture.

## Focused comparison

Focused inspection covered the character workspace because this is the changed surface. Measured desktop values match the agreed contract:

- character workspace columns: `220px 661px`
- workspace gap: `9px`
- character rows: `42px`
- collapsed event summaries: `42px`
- nickname editor: contained inside the detail surface with compact delete/cancel/save controls
- event expansion: only supplemental content is added; date, relative time, type, location, and related subject are not repeated

## Responsive and interaction findings

- Desktop preserves the balanced two-column layout and sticky character list.
- Mobile returns to one column without inner horizontal overflow in the inspected viewport.
- Normal tracked characters omit the redundant “追踪中” badge; exceptional/unknown status remains visible.
- The nickname editor toggles correctly and does not create a second identity card.
- Event disclosure toggles correctly and retains a one-line collapsed summary on desktop.
- Browser console inspection reported no warnings or errors.

## Comparison history

1. First implementation pass matched the selected A direction.
2. Removed stale duplicate summary styling from the synchronized example and removed redundant border declarations from the full reference.
3. Rechecked desktop, nickname-open, event-expanded, and mobile states; no blocking visual or interaction defects remained.

final result: passed

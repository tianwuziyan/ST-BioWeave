# Design

## Boundary

Only `ui/app.js`, `ui/settings.js`, `floating-launcher.js`, `style.css`, the
global UI preference contract, related tests, and existing UI/lifecycle docs may
change. Event Analysis, World Analysis, Projection, Snapshot, Floor,
StateReducer, Runtime Activity, and AI scheduling remain untouched.

## Decisions

- The header button is a view/control for the existing global
  `show_floating_launcher` preference. It calls the same `profileStore.setUiPreference`
  path as Settings and the existing `onUiPreferencesChanged` callback updates the
  single launcher registration.
- Remove snap at its source: preference normalization, store write allowlist,
  launcher preference shape, snap helper, and release call all disappear.
- Keep the transparent button hit area at 44px minimum and reduce only the
  visible circular chrome with an inner SVG wrapper/visual sizing.
- Use the existing `is-running` class and `data-state` as the activity seam;
  rotate only the SVG icon and use restrained button/status breathing.
- Move the existing launcher disclosure to the final settings position before
  the existing Story Time/debug disclosure; do not create a second settings UI.

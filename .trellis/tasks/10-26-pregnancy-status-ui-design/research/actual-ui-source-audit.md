# Research: actual production UI source audit

- Query: Identify the real production UI source and compare it with the current pregnancy preview HTML.
- Scope: internal
- Date: 2026-10-27

## Findings

The current production UI is not a standalone HTML document. It is assembled at runtime from `index.js`, `ui/app.js`, the page modules under `ui/`, and the extension stylesheet `style.css`:

- `manifest.json:4-5` declares `index.js` as the extension JavaScript entry and `style.css` as the production stylesheet.
- `index.js:1-3, 43-63` creates the Runtime and `createApp()`, mounts the BioWeave overlay, and registers the host launcher.
- `ui/app.js:92-102` owns the canonical route table and all eight production routes: overview, characters, events, projection, genealogy, world, settings, and state.
- `ui/app.js:474-482` creates production navigation buttons with `bioweave-route-item`, Font Awesome icons, and `data-route`.
- `ui/app.js:4797-4921` renders the selected production page into `.bioweave-main`, passes live Runtime DTOs into the page module, and synchronizes active navigation state.
- `ui/app.js:6826-6837` creates the actual production shell: `.bioweave-app-header`, `.bioweave-routebar`, and `.bioweave-main` inside the `#bioweave-overlay` / `#bioweave-panel` lifecycle.
- `ui/characters.js:506-526, 609-725` renders the production Characters page using `bioweave-page`, `bioweave-character-workspace`, `bioweave-character-list-pane`, `bioweave-character-detail-pane`, and live tracking/event/state inputs.
- `ui/projection.js:433-467, 471-515` renders the production Projection detail and `ui/projection.js:494-505` renders the production Projection page using `bioweave-projection-page`, `bioweave-projection-workspace`, `bioweave-projection-people-panel`, and `bioweave-projection-detail`.
- `style.css:1-45, 103-320` defines the production overlay, panel, header, routebar, page layout, and tokens. Additional production corrections and responsive rules continue at `style.css:5320-5645`, `style.css:5851-5901`, `style.css:7223-7509`, and `style.css:8141-8665`.

The current preview is based on `docs/UI_FULL_REFERENCE.html`, which is a separate static prototype rather than the production render source:

- `docs/UI_FULL_REFERENCE.html:1-120` defines its own document-level CSS variables and `body`/`.host` presentation.
- `docs/UI_FULL_REFERENCE.html:2910-2920` defines a standalone `.panel` shell with `.app-header`, `.routebar`, and `.main`, not the production `.bioweave-*` shell.
- `docs/UI_FULL_REFERENCE.html:3132-3146` creates static prototype route buttons and its own render loop; this is not `ui/app.js`.
- The current file `.trellis/tasks/10-26-pregnancy-status-ui-design/pregnancy-status-ui-addition-real-ui.html:2933-2945` therefore copies the static prototype shell (`.host`, `.panel`, `.app-header`, `.routebar`, `.main`) rather than the real production shell.
- The same preview file `:3735-3757` contains a second standalone static data/render implementation. It uses non-production classes such as `.page`, `.character-workspace`, `.projection-workspace`, `.badge`, `.button`, and hard-coded sample subjects; it does not call `createApp()`, `overviewPage()`, `charactersPage()`, or `projectionPage()` and cannot reproduce Runtime-driven production rendering.

Concrete source mismatch:

| Area | Production source | Current preview source |
| --- | --- | --- |
| Entry | `manifest.json:4-5`, `index.js:43-63` | standalone HTML document |
| Shell | `ui/app.js:6826-6837`, `.bioweave-*` rules in `style.css` | `UI_FULL_REFERENCE.html:2910-2945`, `.panel`/`.routebar`/`.main` |
| Routes | `ui/app.js:92-102`, eight live routes | static prototype route array in `UI_FULL_REFERENCE.html:3132+` |
| Characters | `ui/characters.js:609-725`, Runtime DTOs | hard-coded `subjects` in preview `:3737-3744` |
| Projection | `ui/projection.js:471-515`, actual storyline/projection DTOs | custom static `projection()` in preview `:3755` |
| Styling | `style.css`, including later override blocks | inline CSS copied from the static reference plus additions |

Therefore the previous claim that the preview was an exact copy of the current real UI is not supported by the repository evidence. `docs/UI_FULL_REFERENCE.html` is useful as a design/reference document, but it is not the correct copy source for an exact production UI preview.

## Correct copy strategy

For an exact standalone preview, the source of truth must be the production implementation itself:

1. Reuse the production shell DOM from `ui/app.js:6826-6837`.
2. Reproduce the production route/page markup by using the existing page module renderers or by extracting their current output, not by copying the static reference page functions.
3. Include the complete production `style.css` rules, or an extracted scoped copy with the same `.bioweave-*` selectors, token values, responsive overrides, and late correction blocks.
4. Add pregnancy status/knowledge markup only at the existing production insertion points in `ui/overview.js`, `ui/characters.js`, and `ui/projection.js`; do not replace those pages with a parallel `subjects`/`route` renderer.
5. Keep the preview data-only and isolated if it must remain a standalone HTML file, but make its DOM/classes/markup identical to the production output and clearly label the sample DTOs as preview data.

## Related specs

- `AGENTS.md` requires UI work to read `docs/ui-framework.config.json`, `docs/UI_FRAMEWORK.md`, and `docs/UI_FRAMEWORK_EXAMPLE.html`, but it also says production UI must preserve real interfaces and hooks.
- `.trellis/spec/frontend/component-guidelines.md` says `ui/app.js` owns the presentation route and stable DOM lifecycle, page modules return fragments, and UI must use `bioweave-*` classes and explicit data actions.
- `docs/ARCHITECTURE.md` identifies `ui/app.js` as UI orchestration, `ui/characters.js` as Characters UI, and `ui/projection.js` / `runtime/projection-runtime.js` as Projection owners.

## Caveats / Not Found

- No repository file is a generated, full-fidelity standalone snapshot of the live production DOM plus all runtime state. The exact production UI exists as JavaScript-rendered DOM plus `style.css`.
- `docs/UI_FULL_REFERENCE.html` is dated 2026-10-25, while production `ui/app.js` and `style.css` contain later/current production-specific shell and correction rules; this explains visual drift.
- This audit made no code or documentation changes outside this research file.

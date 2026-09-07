# Research: SevenDaysCal entry/modal integration boundary

- Query: At the current default-branch commit of `atonal519/ST-SevenDaysCal`, determine how the extension registers under `#extensionsMenu`, how that click opens the main UI, which SillyTavern popup/DOM contracts it uses, its mobile/tablet CSS and lifecycle behavior, and how those choices compare with BioWeave's pre-fix `index.js`, `ui/app.js`, and `style.css` snapshot.
- Scope: mixed (pinned upstream source, SillyTavern 1.18.0 host source, and current local BioWeave source)
- Date: 2026-09-05

## Findings

### Source snapshot

- GitHub reports the repository default branch as `master`. Its head was rechecked immediately before this note was written and was [`d172dbcad07dd49674e5fe00e8d7505abd0cce48`](https://github.com/atonal519/ST-SevenDaysCal/commit/d172dbcad07dd49674e5fe00e8d7505abd0cce48), commit message `release: v3.6.7`, authored 2026-09-05 14:52:44 UTC.
- The pinned [`manifest.json`](https://github.com/atonal519/ST-SevenDaysCal/blob/d172dbcad07dd49674e5fe00e8d7505abd0cce48/manifest.json#L1-L10) declares extension version `3.6.7`, `index.js` as its script, and `style.css` as its stylesheet.
- Because this task's observed host is SillyTavern 1.18.0, host behavior below is cross-checked against tag `1.18.0`, commit [`51ad27fb86d39a3daca3adaa970375c9670c12df`](https://github.com/SillyTavern/SillyTavern/commit/51ad27fb86d39a3daca3adaa970375c9670c12df), rather than inferred from a newer moving branch.

### Files found

| File | One-line description |
| --- | --- |
| [`ST-SevenDaysCal/index.js`](https://github.com/atonal519/ST-SevenDaysCal/blob/d172dbcad07dd49674e5fe00e8d7505abd0cce48/index.js) | Registers the wand entry, pre-injects the main Shadow DOM hosts, opens/closes the panel, reacts to Chat changes, and synchronizes the mobile visual viewport. |
| [`ST-SevenDaysCal/modal.js`](https://github.com/atonal519/ST-SevenDaysCal/blob/d172dbcad07dd49674e5fe00e8d7505abd0cce48/modal.js) | Implements a local Promise-based secondary-dialog manager; it is not SillyTavern's `Popup` class. |
| [`ST-SevenDaysCal/style.css`](https://github.com/atonal519/ST-SevenDaysCal/blob/d172dbcad07dd49674e5fe00e8d7505abd0cce48/style.css) | Styles the desktop floating sheet, the `<=640px` near-fullscreen variant, and custom dialog overlays. |
| [`ST-SevenDaysCal/manifest.json`](https://github.com/atonal519/ST-SevenDaysCal/blob/d172dbcad07dd49674e5fe00e8d7505abd0cce48/manifest.json) | Pins the inspected release identity (`3.6.7`). |
| `index.js` | BioWeave's host-menu registration and extension lifecycle boundary; relevant patterns begin at `index.js:19` and `index.js:97`. |
| `ui/app.js` | BioWeave's pre-fix body-level overlay lifecycle, presentation state, delegated actions, and Chat-change handling; relevant patterns begin at `ui/app.js:80`, `ui/app.js:297`, and `ui/app.js:395`. |
| `style.css` | BioWeave's fixed overlay, three responsive modes, safe areas, internal scrolling, and mobile bottom navigation; relevant patterns begin at `style.css:6`, `style.css:484`, and `style.css:539`. |

### 1. Exact `#extensionsMenu` entry registration

1. On jQuery DOM-ready, SevenDaysCal calls `injectExtButton()` before `injectModal()` ([upstream `index.js:1777-1787`](https://github.com/atonal519/ST-SevenDaysCal/blob/d172dbcad07dd49674e5fe00e8d7505abd0cce48/index.js#L1777-L1787)).
2. `injectExtButton()` constructs one outer `div` with ID `sp_open_wand` and host-style classes `list-group-item flex-container flexGap5`. Its icon is another `div` with `fa-solid fa-calendar-days extensionsMenuExtensionButton`, followed by the text `构画` ([upstream `index.js:2587-2593`](https://github.com/atonal519/ST-SevenDaysCal/blob/d172dbcad07dd49674e5fe00e8d7505abd0cce48/index.js#L2587-L2593)). It does not set `role`, `tabindex`, or a keyboard handler.
3. The insertion target is **not unconditionally** `#extensionsMenu`: it prefers `#sp_wand_container` when that element exists, otherwise it uses `#extensionsMenu`. It refuses to insert when no target exists or any `#sp_open_wand` already exists, and otherwise appends with `insertAdjacentHTML('beforeend', ...)` ([upstream `index.js:2595-2600`](https://github.com/atonal519/ST-SevenDaysCal/blob/d172dbcad07dd49674e5fe00e8d7505abd0cce48/index.js#L2595-L2600)).
4. If the first mount attempt returns false, it observes `document.body` with `{childList: true, subtree: true}`. The observer disconnects after the first successful mount ([upstream `index.js:2602-2605`](https://github.com/atonal519/ST-SevenDaysCal/blob/d172dbcad07dd49674e5fe00e8d7505abd0cce48/index.js#L2602-L2605)). Therefore it handles a menu that appears late, but it does not keep watching after a successful mount for a later host-menu rebuild.
5. In SillyTavern 1.18.0, `#extensionsMenu` is rendered from `wandMenu.html` and appended directly to `document.body`; the stock template has several `*_wand_container` children but no `#sp_wand_container` ([host `wandMenu.html:1-17`](https://github.com/SillyTavern/SillyTavern/blob/51ad27fb86d39a3daca3adaa970375c9670c12df/public/scripts/templates/wandMenu.html#L1-L17), [host `extensions.js:688-696`](https://github.com/SillyTavern/SillyTavern/blob/51ad27fb86d39a3daca3adaa970375c9670c12df/public/scripts/extensions.js#L688-L696)). In that host version, the normal SevenDaysCal target is consequently the direct `#extensionsMenu` fallback.
6. The chosen classes are genuine host conventions: SillyTavern sizes `.extensionsMenuExtensionButton`, makes the icon ignore pointer events, and styles direct `#extensionsMenu` children / `.list-group-item` rows ([host `style.css:1117-1168`](https://github.com/SillyTavern/SillyTavern/blob/51ad27fb86d39a3daca3adaa970375c9670c12df/public/style.css#L1117-L1168)).

### 2. Exact click-to-main-UI path

- Registration attaches a native `click` listener directly to `#sp_open_wand`, with `openSchedule` itself as the callback. There is no `preventDefault()`, `stopPropagation()`, synthetic body click, pointer/touch duplicate, or timeout at this boundary ([upstream `index.js:2595-2600`](https://github.com/atonal519/ST-SevenDaysCal/blob/d172dbcad07dd49674e5fe00e8d7505abd0cce48/index.js#L2595-L2600)).
- The call chain is `#sp_open_wand click -> openSchedule() -> showPanel()`. `openSchedule()` then resets to a clean schedule-home state, restores the last main view when applicable, or renders the cached/empty schedule ([upstream `index.js:4573-4604`](https://github.com/atonal519/ST-SevenDaysCal/blob/d172dbcad07dd49674e5fe00e8d7505abd0cce48/index.js#L4573-L4604)).
- `showPanel()` does not mount a new window. It selects the already-injected light-DOM host `#sp-modal-root`, sets it to `display:block` at opacity zero, animates opacity to one over 180 ms, then schedules `positionPanel()` and `syncMobileViewport()` on a zero-delay timer ([upstream `index.js:4606-4617`](https://github.com/atonal519/ST-SevenDaysCal/blob/d172dbcad07dd49674e5fe00e8d7505abd0cce48/index.js#L4606-L4617)).
- SillyTavern 1.18.0 owns menu closure: its `html` click handler fades out the dropdown for clicks outside a three-item allowlist and flips its private `isDropdownVisible` flag ([host `extensions.js:703-722`](https://github.com/SillyTavern/SillyTavern/blob/51ad27fb86d39a3daca3adaa970375c9670c12df/public/scripts/extensions.js#L703-L722)). Because SevenDaysCal neither stops propagation nor puts its main host under the menu, the same click opens SevenDaysCal synchronously and then bubbles to SillyTavern's closure handler.
- `closePanel()` cancels active subordinate UI/dialog work and animates `#sp-modal-root` back to `display:none`; it retains the main host and its listeners for the next open ([upstream `index.js:4619-4631`](https://github.com/atonal519/ST-SevenDaysCal/blob/d172dbcad07dd49674e5fe00e8d7505abd0cce48/index.js#L4619-L4631)).

### 3. Popup/modal APIs and DOM conventions

#### SillyTavern APIs actually used at this boundary

- `index.js` imports host state/lifecycle surfaces (`getContext`, `extension_settings`, `eventSource`, and `event_types`) from SillyTavern modules ([upstream `index.js:1-5`](https://github.com/atonal519/ST-SevenDaysCal/blob/d172dbcad07dd49674e5fe00e8d7505abd0cce48/index.js#L1-L5)). The UI lifecycle also closes its custom dialogs on `event_types.CHAT_CHANGED` ([upstream `index.js:1439-1447`](https://github.com/atonal519/ST-SevenDaysCal/blob/d172dbcad07dd49674e5fe00e8d7505abd0cce48/index.js#L1439-L1447)).
- It uses SillyTavern's DOM/CSS conventions `#extensionsMenu`, `.list-group-item`, `.flex-container`, `.flexGap5`, `.extensionsMenuExtensionButton`, `--SmartTheme*` variables, and the host Font Awesome stylesheet.

#### Popup/modal APIs not used

- A full-text inspection of the pinned `index.js` and `modal.js` found no import or reference to SillyTavern's `Popup`, `POPUP_TYPE`, `Popup.show.*`, or `callGenericPopup`. Those are real host APIs in SillyTavern 1.18.0 ([host `popup.js:91-148`](https://github.com/SillyTavern/SillyTavern/blob/51ad27fb86d39a3daca3adaa970375c9670c12df/public/scripts/popup.js#L91-L148), [host `popup.js:904-915`](https://github.com/SillyTavern/SillyTavern/blob/51ad27fb86d39a3daca3adaa970375c9670c12df/public/scripts/popup.js#L904-L915)); SevenDaysCal does not use them for either its main shell or `modal.js` dialogs.

#### Custom main host and secondary-dialog conventions

- `injectModal()` creates a separate `#sp-dialog-host` (`position:fixed; inset:0; z-index:2000003; pointer-events:none`), attaches an open shadow root, injects SevenDaysCal CSS plus SillyTavern's Font Awesome CSS, and appends the host to `document.documentElement` ([upstream `index.js:2735-2746`](https://github.com/atonal519/ST-SevenDaysCal/blob/d172dbcad07dd49674e5fe00e8d7505abd0cce48/index.js#L2735-L2746)).
- It separately creates the hidden main `#sp-modal-root`, gives that light-DOM host fixed positioning and z-index `2000001`, attaches another open shadow root, inserts `.sp-backdrop` and `.sp-sheet`, and appends the host to `document.documentElement` ([upstream `index.js:3367-3395`](https://github.com/atonal519/ST-SevenDaysCal/blob/d172dbcad07dd49674e5fe00e8d7505abd0cce48/index.js#L3367-L3395)). Thus neither the main UI nor secondary dialogs are descendants of `#extensionsMenu`.
- The Shadow DOM is an explicit isolation boundary against SillyTavern global selectors. Theme custom properties still inherit into the shadow tree, and the extension mirrors its `sp-day` / `sp-night` classes onto the inner wrapper ([upstream `index.js:3367-3394`](https://github.com/atonal519/ST-SevenDaysCal/blob/d172dbcad07dd49674e5fe00e8d7505abd0cce48/index.js#L3367-L3394), [upstream `index.js:7666-7688`](https://github.com/atonal519/ST-SevenDaysCal/blob/d172dbcad07dd49674e5fe00e8d7505abd0cce48/index.js#L7666-L7688)).
- Local `modal.js` enforces one active `#sp-addon-dialog`, mounts it into the injected dialog shadow root, closes on backdrop-only click or Escape, unsubscribes its Chat-change listener on completion, removes the overlay, and resolves its Promise ([upstream `modal.js:17-64`](https://github.com/atonal519/ST-SevenDaysCal/blob/d172dbcad07dd49674e5fe00e8d7505abd0cce48/modal.js#L17-L64)). Its sheets use `role="dialog"` and `aria-modal="true"` ([upstream `modal.js:67-88`](https://github.com/atonal519/ST-SevenDaysCal/blob/d172dbcad07dd49674e5fe00e8d7505abd0cce48/modal.js#L67-L88)); the main `.sp-sheet` itself has no equivalent dialog role in `index.js`.

### 4. Mobile/tablet CSS and lifecycle details

#### Layout breakpoints

- The base (`>640px`) shell is a 360 px wide fixed floating `.sp-sheet` at `top:80px; right:20px`, with `max-height:85vh`, a 44 px left rail, and an overflow-clipped content column ([upstream `style.css:226-285`](https://github.com/atonal519/ST-SevenDaysCal/blob/d172dbcad07dd49674e5fe00e8d7505abd0cce48/style.css#L226-L285), [upstream `style.css:292-407`](https://github.com/atonal519/ST-SevenDaysCal/blob/d172dbcad07dd49674e5fe00e8d7505abd0cce48/style.css#L292-L407)).
- Its shell has one mobile cutoff, `max-width:640px`; there is no tablet-specific shell breakpoint. Therefore common 768 px and 1024 px tablet widths use the same 360 px floating desktop card and vertical rail. Widths 641-767 also stay on that desktop path.
- At `<=640px`, the light-DOM root becomes a fixed `100dvw x 100dvh` non-interactive layer. The sheet is re-enabled for pointer events and becomes a centered near-fullscreen card (`100dvw - 20px`, height based on `100dvh` minus margins and safe-area insets); the resize handle is hidden ([upstream `style.css:2273-2320`](https://github.com/atonal519/ST-SevenDaysCal/blob/d172dbcad07dd49674e5fe00e8d7505abd0cce48/style.css#L2273-L2320)). It retains the 44 px left navigation rail; it does not switch to a bottom-navigation model.
- The comments explicitly say this near-fullscreen top/left/translate strategy was retained because `inset:0` and top-plus-bottom variants failed on the target mobile browser ([upstream `style.css:2273-2277`](https://github.com/atonal519/ST-SevenDaysCal/blob/d172dbcad07dd49674e5fe00e8d7505abd0cce48/style.css#L2273-L2277)). The mobile shell uses `dvw`/`dvh` directly and does not provide a `vw`/`vh` fallback in that rule.

#### Mobile viewport lifecycle

- JavaScript defines mobile as `window.innerWidth <= 640` ([upstream `index.js:1660-1662`](https://github.com/atonal519/ST-SevenDaysCal/blob/d172dbcad07dd49674e5fe00e8d7505abd0cce48/index.js#L1660-L1662)). On mobile open, `positionPanel()` clears desktop inline position/height state, invokes viewport synchronization, and installs listeners once for window resize/orientation plus `visualViewport` resize/scroll ([upstream `index.js:7876-7908`](https://github.com/atonal519/ST-SevenDaysCal/blob/d172dbcad07dd49674e5fe00e8d7505abd0cce48/index.js#L7876-L7908)).
- `syncMobileViewport()` only runs while the mobile root is visible. It temporarily appends a probe to `document.body` to resolve safe-area top/bottom values, uses `visualViewport.height` and `offsetTop` to account for iOS keyboard displacement, writes pixel `top`/`height`/`maxHeight` values to `.sp-sheet`, preserves settings scroll position, and scroll-corrects the focused form control ([upstream `index.js:7910-7964`](https://github.com/atonal519/ST-SevenDaysCal/blob/d172dbcad07dd49674e5fe00e8d7505abd0cce48/index.js#L7910-L7964)). At tablet widths above 640 this correction path is skipped.
- Custom editor dialogs are fixed overlays independent of the main panel. Their sheets cap height with `100dvh`; at `<=640px`, editor width becomes 100% and max-height becomes `100dvh - 20px` ([upstream `style.css:3688-3753`](https://github.com/atonal519/ST-SevenDaysCal/blob/d172dbcad07dd49674e5fe00e8d7505abd0cce48/style.css#L3688-L3753)).

#### Retention, Chat changes, and teardown

- Main close is hide/reuse, not unmount/remount. A Chat change invalidates async work, cancels custom dialogs, resets view state, and, if the main host is visible, renders the new Chat into the same host ([upstream `index.js:1844-1942`](https://github.com/atonal519/ST-SevenDaysCal/blob/d172dbcad07dd49674e5fe00e8d7505abd0cce48/index.js#L1844-L1942)).
- The inspected entry observer is deliberately one-shot after successful insertion. The viewport listeners are guarded by `viewportSyncBound`, but no corresponding removal path exists in the pinned `index.js`. Likewise, `injectModal()` has no existing-host deduplication or exported main-host destroy path. These facts are relevant to BioWeave's stronger repeated-initialization/destroy acceptance criteria; they are not evidence that normal single-load SevenDaysCal usage duplicates nodes.

### 5. Concise comparison with pre-fix BioWeave

| Boundary | SevenDaysCal 3.6.7 | BioWeave pre-fix source |
| --- | --- | --- |
| Menu target | Prefers optional `#sp_wand_container`, otherwise `#extensionsMenu`; host-style row `#sp_open_wand`. | Targets only `#extensionsMenu`; creates exactly one `#bioweave-extensions-menu-entry` (`index.js:38`, `index.js:41`, `index.js:44`). |
| Entry semantics | Click-only `div`; no role/tabindex; a one-shot late-mount observer disconnects after success. | Host classes plus `interactable`, `role=menuitem`, `tabindex=0`; click and Enter/Space share one handler; duplicate IDs/listeners are cleaned (`index.js:46`, `index.js:47`, `index.js:52`, `index.js:62`). The body observer remains active for host rebuilds and has an unregister path (`index.js:75`, `index.js:82`). |
| Click timing | Calls `openSchedule()` synchronously and relies on the click bubbling to SillyTavern's `html` handler to close the menu. | Calls `preventDefault()` and schedules `openBioWeave()` for the next task, without synthesizing `document.body.click()` (`index.js:28`, `index.js:62`). This explicitly decouples opening from host dropdown close/reflow. |
| Main UI ownership | Pre-injected hidden `#sp-modal-root` under `document.documentElement`; UI lives in an open Shadow DOM. | `document.body > #bioweave-overlay > #bioweave-panel`; mount repairs parentage, discards disconnected caches, and collapses duplicate IDs (`ui/app.js:105`, `ui/app.js:120`, `ui/app.js:131`, `ui/app.js:139`). |
| Popup implementation | Does not use SillyTavern `Popup`; owns both its main Shadow DOM sheet and a local `modal.js` manager in a second shadow host. | Also owns its main DOM dialog rather than calling SillyTavern `Popup`, but uses a single light-DOM overlay/panel with delegated events and `role=dialog` / `aria-modal=true` (`ui/app.js:395`, `ui/app.js:403`). |
| Open/close/destroy | Open/show and close/hide reuse a long-lived pre-injected host. There is no complete main-host/listener teardown path in the inspected files. | Explicit idempotent `mount/open/close/destroy` boundaries; close hides and destroy removes owned DOM/listeners/subscriptions (`ui/app.js:155`, `ui/app.js:166`, `ui/app.js:175`, `ui/app.js:489`). `index.js` exposes disable/delete cleanup and allows safe re-init (`index.js:97`, `index.js:109`, `index.js:123`). |
| Responsive modes | Desktop floating card for all widths above 640; near-fullscreen card below/equal to 640; vertical rail remains. | Three explicit modes: desktop `>=1200` left navigation, tablet `768-1199` top compact navigation, and mobile `<768` single-column plus five-item bottom navigation / real More menu (`style.css:478`, `style.css:484`, `style.css:539`, `style.css:641`, `style.css:678`; markup at `ui/app.js:425`, `ui/app.js:435`). |
| Viewport/safe area | Mobile CSS uses `dvw/dvh`; JS uses safe-area probes plus `visualViewport` keyboard correction. The path does not run above 640. | Fixed inset overlay uses `100vh` then `100dvh`, safe-area padding, internal scrolling, `min-width:0`, and no JS visual-viewport listener (`style.css:6`, `style.css:15`, `style.css:18`, `style.css:22`). Mobile bottom-navigation height/padding includes the bottom safe area (`style.css:550`, `style.css:641`). |
| Chat lifecycle | Keeps the main window connected and, when visible, resets/re-renders it for the new Chat; custom decision dialogs close. | Keeps the overlay lifecycle independent of Chat, resets presentation route/focus on Chat change, and renders only when open (`ui/app.js:297`). Runtime subscriptions are detached on root teardown (`ui/app.js:365`). |
| Stacking/theme isolation | Main host z-index `2000001`, secondary host `2000003`; Shadow DOM blocks host selector leakage while inheriting `--SmartTheme*` tokens. | Overlay z-index `30000`; no Shadow DOM, so selector ownership relies on the `bioweave-*` namespace and scoped token rules (`style.css:11`, `style.css:35`). |

### External references

- SevenDaysCal default-branch snapshot: [`d172dbcad07dd49674e5fe00e8d7505abd0cce48`](https://github.com/atonal519/ST-SevenDaysCal/tree/d172dbcad07dd49674e5fe00e8d7505abd0cce48), release `3.6.7`.
- SillyTavern host snapshot used for the active task's installed-version behavior: tag [`1.18.0`](https://github.com/SillyTavern/SillyTavern/tree/51ad27fb86d39a3daca3adaa970375c9670c12df).
- SillyTavern extension-menu creation/close behavior: [`public/scripts/extensions.js:688`](https://github.com/SillyTavern/SillyTavern/blob/51ad27fb86d39a3daca3adaa970375c9670c12df/public/scripts/extensions.js#L688-L723).
- SillyTavern popup API reference implementation: [`public/scripts/popup.js:91`](https://github.com/SillyTavern/SillyTavern/blob/51ad27fb86d39a3daca3adaa970375c9670c12df/public/scripts/popup.js#L91-L148) and [`public/scripts/popup.js:904`](https://github.com/SillyTavern/SillyTavern/blob/51ad27fb86d39a3daca3adaa970375c9670c12df/public/scripts/popup.js#L904-L915).

### Related specs and task artifacts

- `.trellis/spec/frontend/component-guidelines.md`: documentElement-level overlay contract, synchronous canonical click, idempotent lifecycle, and responsive navigation.
- `.trellis/spec/frontend/quality-guidelines.md`: forbids mounting the main UI in `#extensionsMenu` or forcing host closure with `document.body.click()`; requires mobile host smoke testing.
- `.trellis/spec/frontend/state-management.md`: Chat is the dynamic-data scope while `ui/app.js` owns presentation-only state and must unsubscribe lifecycle listeners.
- `.trellis/tasks/09-05-bioweave-ui-foundation-responsive/prd.md`: acceptance criteria for the menu-to-overlay boundary and Desktop/Tablet/Mobile behavior.
- `.trellis/tasks/09-05-bioweave-ui-foundation-responsive/design.md`: intended stable menu registration and overlay lifecycle.
- `.trellis/tasks/09-05-bioweave-ui-foundation-responsive/implement.md`: planned implementation and real-host verification order.
- `.trellis/tasks/09-05-bioweave-ui-foundation-responsive/research/sillytavern-ui-lifecycle.md`: prior live-host observations, including drawer interception at mobile widths.

## Caveats / Not Found

- This is a source-level boundary analysis; SevenDaysCal itself was not installed or executed. Mobile/tablet conclusions come from the pinned JavaScript/CSS and the SillyTavern 1.18.0 host source.
- `master` is mutable. All SevenDaysCal links are pinned to `d172dbcad07dd49674e5fe00e8d7505abd0cce48`; a later default-branch commit may differ.
- `#sp_wand_container` was not found in SillyTavern 1.18.0's stock `wandMenu.html` or in the three inspected SevenDaysCal files outside the one target lookup. Its creator/compatibility history is therefore not established here.
- No SillyTavern `Popup`/`POPUP_TYPE`/`callGenericPopup` use was found in the pinned SevenDaysCal `index.js` or `modal.js`; the local file named `modal.js` should not be mistaken for a wrapper around that host API.
- No tablet-specific panel breakpoint or tablet-specific JavaScript lifecycle was found. Calling the `>640px` behavior "tablet" is an inference from the absence of another shell branch, not a named upstream mode.

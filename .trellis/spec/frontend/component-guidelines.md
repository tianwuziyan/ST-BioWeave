# Component Guidelines

BioWeave uses plain DOM modules and one lightweight app owner. A page module
returns a small HTML fragment; ui/app.js owns the presentation route, focus,
theme, event delegation, and stable DOM lifecycle. Do not introduce a
component framework or a new service/registry layer for the UI shell.

## Scenario: SillyTavern menu to BioWeave overlay

### 1. Scope / Trigger

This contract applies when the extension is initialized, when
#extensionsMenu is created or rebuilt, or when a user opens/closes the
BioWeave UI from Desktop, Tablet, or Mobile.

### 2. Signatures

    registerExtensionsMenuEntry(app, documentRef, observerCtor)
      -> unregister()

    createOverlayLifecycle({
      documentRef, overlayId, rootId, createOverlay, createRoot,
      initializeRoot, teardownRoot
    })
      -> {mount, open, close, destroy, getRoot, getOverlay}

    createApp(runtime)
      -> {mountBioWeave, openBioWeave, closeBioWeave, destroyBioWeave}

### 3. Contracts

- #extensionsMenu contains only the
  #bioweave-extensions-menu-entry launch item.
- The UI boundary is document.documentElement > #bioweave-overlay >
  #bioweave-panel; the panel must never be a child of the temporary menu.
- The menu handler uses the host canonical click plus Enter/Space keyboard
  path and opens synchronously without preventDefault() or a timer. It must
  not synthesize document.body.click() or add duplicate touch/pointer paths.
- At most one menu registration owns a given document. A new registration
  must invoke the previous unregister function before attaching its observer;
  otherwise a stale observer can reclaim the entry handler after a DOM change.
- mountBioWeave() reuses a connected root and discards a cached root whose
  isConnected is false. openBioWeave() is safe after closeBioWeave();
  destroyBioWeave() removes only BioWeave-owned DOM and listeners.
- The root uses bioweave-* classes and has no avatar-dependent layout.
- Responsive styles use the fixed breakpoints >=1200, 768-1199, and <768;
  all three widths use the documentElement-level top routebar, with a
  compact multi-row route grid on mobile and safe-area padding.

### 4. Validation & Error Matrix

| Condition | Required behavior |
| --- | --- |
| documentRef and both documentElement/body hosts unavailable | menu registration is a no-op; UI mount returns null |
| #extensionsMenu absent at initialization | wait for a body subtree mutation; do not create a top-level replacement button |
| registerExtensionsMenuEntry called again for the same document | disconnect the old observer/handler before the new registration takes ownership |
| Host menu hidden/rebuilt after entry click | synchronous open shows the independent documentElement overlay |
| Cached overlay/root is disconnected | tear down old listeners, recreate exactly one connected overlay/root |
| Duplicate BioWeave ID exists | keep one connected node and remove the other BioWeave-owned nodes |
| close followed by open | preserve the single root and show it again |
| Mobile width below 768px | show the compact top route grid and single-column content; document width must not overflow |

### 5. Good / Base / Bad Cases

- Good: follow the proven SevenDaysCal boundary: canonical click synchronously
  shows a pre-mounted, documentElement-level fixed host.
- Good: keep focusedCharacterId as presentation focus while Chat remains the
  dynamic-data scope.
- Base: no characters/events/world model exist yet; page modules show empty
  states or explicitly marked demo DTOs.
- Bad: append #bioweave-panel inside #extensionsMenu.
- Bad: use a non-null cached root as proof that it is still in the document.
- Bad: add pointerdown, touchstart, and click handlers for the same menu
  action, creating duplicate opens on mobile.
- Bad: replace the entry handler but leave the previous registration's
  MutationObserver active; it can restore the stale handler later.

### 6. Tests Required

- Lifecycle DOM test: one mount, repeated open, close/open, detached root
  recreation, and idempotent destroy.
- Menu test: click opens synchronously without cancellation or body.click(),
  duplicate entries collapse, menu recreation restores one entry, and a
  second registration disconnects the first observer permanently.
- Browser smoke test: real DOM preview at 1200x800, 1024x800, and 390x844
  checks the navigation mode, More menu, theme selection, documentElement overlay,
  and documentElement.scrollWidth <= innerWidth.

### 7. Wrong vs Correct

#### Wrong

    entry.addEventListener('click', () => {
      app.openBioWeave();
      document.body.click();
    });

#### Correct

    entry.addEventListener('click', () => app.openBioWeave());

For registration ownership, keep one unregister function per document:

    activeMenuRegistrations.get(documentRef)?.();
    activeMenuRegistrations.set(documentRef, unregister);

## Page module conventions

- Keep one stable page responsibility per existing ui/*.js file.
- Accept a small options object for presentation focus, for example
  charactersPage({characterId});人物详情使用同页纵向 sections，不维护详情 Tab state。
- Return accessible HTML with buttons/links carrying explicit
  data-route/data-character-* actions; do not bind a separate listener to
  every page fragment.
- Use empty states for unfinished business layers. Do not create mock storage
  or write demo DTOs into Chat metadata or Floor data.

## SillyTavern host feedback and Popup conventions

### 1. Scope / Trigger

Use this contract for all transient notifications, user confirmations, and
complex modal content opened by BioWeave inside SillyTavern. These interactions
must use the host-owned feedback and Popup lifecycle instead of introducing a
second BioWeave modal system.

### 2. Signatures

    notify(message, type = 'info', documentRef)
      -> void

    confirmWithPopup(title, message)
      -> Promise<boolean>

    new Popup(content, POPUP_TYPE.DISPLAY, title, options).show()
      -> Promise<unknown>

### 3. Contracts

- Ordinary non-blocking `success`, `error`, `warning`, and `info` feedback must
  go through the shared `notify()` helper, which delegates to the
  SillyTavern/toastr notification system. Do not insert transient page notices
  that shift the current layout.
- All transient operation results use this same path, including successful or
  failed saves, API operation results, cancellations, timeouts, and ordinary
  warnings or informational updates. The Toast type must preserve the business
  meaning: successful analysis and manual World Model section saves use
  `success`; a confirmed `REQUEST_ABORTED` uses `info`; `REQUEST_TIMEOUT` and
  other genuine analysis or save failures use `error`.
- A confirmed cancellation is reported only after the active request actually
  reaches its `REQUEST_ABORTED` cleanup path. Canceling, closing, or dismissing
  the confirmation Popup (including Escape) is not a cancellation and must not
  emit a cancellation Toast or change the in-flight request.
- Inline page notices are reserved for persistent page state that remains
  relevant until the user repairs or reloads it, such as an invalid persisted
  World Model. They must not be used for save success/failure, API success or
  failure, cancellation, timeout, or other transient operation feedback.
- Operations that require an explicit user decision must use
  `SillyTavern.getContext().Popup.show.confirm()` through the shared
  `confirmWithPopup()` helper. This includes deleting an API Profile,
  discarding unsaved World Model edits, terminating an active World Model
  analysis, and any other destructive or task-interrupting operation.
- Confirmation callers may proceed only when `confirmWithPopup()` returns
  `true`, which means the host result strictly matched
  `POPUP_RESULT.AFFIRMATIVE`. Cancel, close, Escape, unavailable APIs, and Popup
  failures all cancel the requested operation without changing its state.
- Complex DOM content such as Analysis Debug must use the host `Popup` class
  with `POPUP_TYPE.DISPLAY`. SillyTavern owns its modal lifecycle, backdrop,
  stacking, close control, and Escape behavior.
- Never use `window.confirm()`, a custom overlay/modal/dialog/backdrop, an
  embedded BioWeave confirmation card, or a locally managed Escape listener as
  a confirmation or DISPLAY Popup fallback.

### 4. Validation & Error Matrix

| Condition | Required behavior |
| --- | --- |
| Ordinary notification | Call `notify()` with the intended Toast type |
| Confirmation returns `POPUP_RESULT.AFFIRMATIVE` | Return `true`; the caller may perform the confirmed operation |
| Confirmation is canceled, closed, or dismissed with Escape | Return `false`; leave state and in-flight work unchanged |
| `Popup.show.confirm` or `POPUP_RESULT.AFFIRMATIVE` is unavailable | Show a safe error Toast and return `false` |
| Confirmation Popup throws | Show a safe error Toast and return `false` |
| DISPLAY Popup API/type is unavailable or opening throws | Show a safe error Toast and do not create a custom modal |

### 5. Good / Base / Bad Cases

- Good: `await confirmWithPopup(title, message)` and mutate state only after a
  `true` result.
- Good: render complex content into a host `Popup` using
  `POPUP_TYPE.DISPLAY` and let the host own close/backdrop/Escape behavior.
- Base: missing Popup support produces a Toast and safely cancels the action.
- Bad: fall back to `window.confirm()`, append a confirmation card to the
  BioWeave root, or create local modal/backdrop CSS and state.

### 6. Tests Required

- Mock `Popup.show.confirm` and assert the exact title/message plus strict
  affirmative gating for every confirmation action.
- Cover cancel, close/dismiss, thrown/unavailable Popup, and repeated-click
  cases; assert no destructive action, state reset, or duplicate request.
- Cover World Model success (`success` Toast), confirmed cancellation
  (`REQUEST_ABORTED` with an `info` Toast), timeout and genuine failures
  (`error` Toast), and manual section save outcomes. Assert that these
  transient messages never appear in the World Model page notice DOM; if a
  persistent invalid-model notice remains, test that it is still rendered.
- Keep source-level regressions that reject custom confirmation
  modal/dialog/overlay selectors and `window.confirm()`.
- Mock `Popup` plus `POPUP_TYPE.DISPLAY` for complex content and assert that
  unavailable host support produces only the safe Toast path.

### 7. Wrong vs Correct

#### Wrong

    const confirmed = window.confirm(message);
    if (!confirmed) openBioWeaveConfirmModal();

#### Correct

    const confirmed = await confirmWithPopup(title, message);
    if (!confirmed) return;
    performConfirmedOperation();

## Scenario: shared SillyTavern Analysis Debug Popup

### 1. Scope / Trigger

Use this contract whenever more than one BioWeave route opens the temporary
AnalysisInput/World Model debug view through SillyTavern Popup.

### 2. Signatures

    openAnalysisDebugPopup({usePromptDraft = false})
      -> Promise<boolean>

    renderAnalysisDebugPopupContent({analysisPreview, worldAnalysisPrompt,
      worldAnalysisPromptDraft, openSettingsSections, theme, documentRef})
      -> HTMLElement | string

### 3. Contracts

- All entry points call one route-independent Popup helper. The helper uses the
  host `Popup` with `POPUP_TYPE.DISPLAY`, empty title, `wide: true`, and
  `allowVerticalScrolling: true`.
- Settings entry points may capture the current prompt draft; other routes use
  the saved prompt and must not inherit a stale settings draft.
- Popup content must reuse `renderAnalysisDebugPopupContent()` and its
  standalone `renderAnalysisInputPreview()`; message previews continue to use
  the real `buildWorldModelMessages()`.
- Because SillyTavern moves Popup content outside `#bioweave-panel`, refresh and
  structure/raw mode actions are delegated on the Popup content element itself.
- A page that opens this Popup must not also render an embedded copy of the
  debug card or maintain a toggle state for Popup visibility.

### 4. Message preview typography

- `renderWorldModelMessagePreview()` must give every API message body
  (including independent `system_top` and `system_bottom` SYSTEM messages) a
  dedicated `.bioweave-world-model-message-content` element/class.
- The message-preview container and body must explicitly use
  `text-align: left`; do not rely on the host Popup's inherited text alignment.
- Message bodies must preserve prompt newlines and wrap long URLs/JSON with
  `white-space: pre-wrap`, `overflow-wrap: anywhere`, and
  `word-break: break-word`.
- Popup-wide `pre` rules must exclude the message-content class so raw/trace
  formatting does not override message-preview wrapping. Keep all selectors
  under BioWeave Analysis Debug/message-preview scope; never change global
  SillyTavern Popup CSS.
- When the message preview is enabled, `renderAnalysisInputPreview()` must
  create one `messages = buildWorldModelMessages(input, promptSettings)` value
  for that render. Structure cards and raw JSON must both consume this same
  value; never stringify the `AnalysisInput` object as the API raw view.
- If the debug view also exposes structured `AnalysisInput` details, keep them
  as a separately labelled section; the structure/raw mode switch is reserved
  for the actual World Model API messages.

### 5. Validation & Error Matrix

| Condition | Required behavior |
| --- | --- |
| Host Popup or DISPLAY type unavailable | Show the existing safe error Toast and do not create a custom modal |
| Settings entry has unsaved prompt fields | Capture and render `draft ?? saved` values |
| World Model entry has no settings page draft | Read saved prompt from the profile store/state fallback |
| Popup content is moved by host | Content-local refresh/mode listener remains functional |
| World page receives legacy preview/toggle props | Ignore them; do not render an embedded debug card |

### 6. Good / Base / Bad Cases

- Good: settings and World Model buttons construct the same Popup shape and
  renderer while choosing their intended prompt source.
- Base: closing the host Popup does not rerender or resize the underlying page.
- Bad: keep a route guard that blocks World Model, duplicate the Popup listener
  in `world.js`, or fake a Popup with an in-page overlay/CSS card.

### 7. Tests Required

- Exercise both root action paths and compare Popup type, title, options and
  content markers.
- Assert settings draft text appears only from the settings entry and saved
  prompt text appears from the World Model entry.
- Trigger refresh and structure/raw mode on the Popup content element and
  assert its HTML updates without relying on root delegation.
- Assert World Model HTML keeps the action button but contains no embedded
  `data-bioweave-analysis-preview` card or dynamic “收起” label.

### 8. Wrong vs Correct

#### Wrong

    if (route !== 'settings') return false;
    worldPage({showAnalysisInput: true, analysisPreview});

#### Correct

    await openAnalysisDebugPopup({usePromptDraft: route === 'settings'});
    // worldPage renders only its action button; Popup owns the debug view.

## Scenario: World Analysis prompt boundary SYSTEM messages

### 1. Scope / Trigger

This contract applies when adding, reading, saving, rendering, previewing, or
sending fields under the global `world_analysis_prompt` configuration.

### 2. Signatures

    normalizeWorldAnalysisPrompt(raw)
      -> {system_top, task, input_prefix, input_suffix, system_bottom, labels}

    buildWorldModelMessages(analysisInput, promptSettings)
      -> Array<{role: 'system' | 'assistant' | 'user', content: string}>

    saveWorldAnalysisPrompt(patch)
      -> normalized complete world_analysis_prompt

### 3. Contracts

- `system_top` and `system_bottom` default to `''`, use the shared prompt-text
  normalization, and are limited to 20,000 characters.
- Missing or `undefined` fields in a partial save preserve the corresponding
  normalized stored values; an explicit empty string clears that field.
- After placeholder expansion, a non-empty `system_top` is an independent
  absolute first message and a non-empty `system_bottom` is an independent
  absolute last message. Never concatenate either into another message.
- The middle sequence remains core SYSTEM, AnalysisInput SYSTEM, recent-story
  ASSISTANT, and final-instruction USER.
- The settings preview and the analyzer request must both consume
  `buildWorldModelMessages()`; rendering code must not recreate message order.

### 4. Validation & Error Matrix

| Condition | Required behavior |
| --- | --- |
| Old config omits both boundary fields | Normalize both to `''`; do not migrate or overwrite existing prompt fields |
| Boundary value is not a string | Normalize it to the empty default |
| Boundary value exceeds 20,000 characters | Trim and truncate with the shared prompt-text rule |
| Expanded boundary text is empty | Do not create an empty SYSTEM message |
| Partial save omits task/input fields or labels | Preserve their existing normalized values |

### 5. Good / Base / Bad Cases

- Good: `TOP → core → AnalysisInput → recent story → final USER → BOTTOM`,
  where TOP and BOTTOM are separate SYSTEM messages.
- Base: empty boundaries keep the original four-message request unchanged.
- Bad: append `system_top` to the core prompt, place `system_bottom` before the
  final USER, or implement a separate preview-only message builder.

### 6. Tests Required

- Assert exact first and last message objects for literal `TOP` and `BOTTOM`.
- Assert the four middle messages equal the empty-boundary baseline.
- Assert empty/whitespace boundaries produce no empty SYSTEM message.
- Assert both fields normalize, truncate, round-trip through storage, and
  expand the existing user/character placeholders.
- Assert the settings page exposes both textareas and previews the same order.

### 7. Wrong vs Correct

#### Wrong

    coreSystem.content += settings.system_top
    messages.splice(messages.length - 1, 0, {role: 'system', content: settings.system_bottom})

#### Correct

    if (systemTop) messages.unshift({role: 'system', content: systemTop})
    if (systemBottom) messages.push({role: 'system', content: systemBottom})

## Scenario: cancellable World Model analysis

### 1. Scope / Trigger

Use this contract when the World Model analysis action is invoked while an
existing analysis request is still running.

### 2. Signatures

    requestAbortWorldModelAnalysis()
      -> Promise<boolean>

    analyzeWorldModel()
      -> Promise<void>

    analyzer.analyzeWorldModel({analysisInput, signal})
      -> Promise<WorldModel>

### 3. Contracts

- The World Model analysis button remains enabled while `worldModelState.busy`
  is true; its busy label may be `分析中…`.
- A busy-button click only enters `requestAbortWorldModelAnalysis()`. It must
  not start another analysis, clear the model, set `busy` false, or call
  `abort()` before confirmation.
- The helper keeps a reference to the current round's `AbortController` and
  uses `confirmWithPopup('终止世界模型分析', '当前分析仍在进行，是否终止本次分析？')`.
  A guard prevents more than one confirmation Popup while the first is open.
- This confirmation inherits the host Popup convention above: it must reach
  `Popup.show.confirm` through `confirmWithPopup()` and has no custom modal,
  dialog, overlay, or `window.confirm()` fallback.
- Negative, dismissed, unavailable, or failed confirmation leaves the current
  request and UI state untouched. Only an affirmative result may call the
  matching controller's `abort()`.
- `analyzeWorldModel()` passes that controller's `signal` to the analyzer and
  owns busy/error cleanup in its existing success/catch path; `finally` only
  clears the controller reference if it is still the current round.

### 4. Validation & Error Matrix

| Condition | Required behavior |
| --- | --- |
| Idle analysis button | Start exactly one World Model analysis |
| Busy button, no confirmation yet | Keep request running; do not abort or start another request |
| Confirmation canceled or dismissed | Keep `busy`, model, and signal unchanged |
| Confirmation accepted | Abort only the matching current controller; let analysis catch/finally clean up |
| Confirmation Popup already open | Ignore subsequent busy-button clicks |
| Request finishes before confirmation resolves | Do not abort a finished or newer request |

### 5. Good / Base / Bad Cases

- Good: `busy click → confirm → affirmative → controller.abort()`.
- Base: `busy click → cancel` leaves the request and button unchanged.
- Bad: disable the busy button, call `abort()` before the Popup result, or
  manually assign `worldModelState.busy = false` from the confirmation helper.

### 6. Tests Required

- Assert the busy button has no `disabled` attribute and the idle path starts
  one analysis.
- Resolve the confirmation as negative/dismissed and assert no abort, no
  second analyzer call, and the busy markup remains present.
- Click while confirmation is pending and assert only one confirmation call.
- Resolve affirmative, observe the analyzer's signal abort exactly once, and
  assert the existing model is preserved after catch/finally cleanup.

### 7. Wrong vs Correct

#### Wrong

    if (worldModelState.busy) {
      worldModelAbortController.abort();
      worldModelState = {...worldModelState, busy: false};
    }

#### Correct

    if (worldModelState.busy) {
      await requestAbortWorldModelAnalysis();
      return;
    }

## Worldbook source selector conventions

The settings page renders the character-card and Worldbook selectors as two
independent native `details` sections. Character cards expose only the stable
`description`, `opening:main`, and `opening:alternate:<index>` fields. The
opening fields are rendered inside their own disclosure group so the primary
greeting and every alternate greeting can be selected independently.

Worldbook sources are grouped from normalized `scopes`, not from display
names. Each book renders an independent disclosure control and parent
checkbox, but the parent state is derived from the complete book entry list:

```js
const state = worldbookSelectionState(source, selected);
toggle.checked = state.checked;
toggle.indeterminate = state.indeterminate;
```

When the list is searched, only entry rows are filtered. The parent state and
its batch operation must continue to use the unfiltered source, and the
persisted Chat value must contain only `{source_id, entry_id, enabled}` child
items.

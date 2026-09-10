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
  mobile navigation has a real More menu and safe-area padding.

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
| Mobile width below 768px | show single-column content and bottom navigation; document width must not overflow |

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
  charactersPage({characterId, characterDetailTab}).
- Return accessible HTML with buttons/links carrying explicit
  data-route/data-character-* actions; do not bind a separate listener to
  every page fragment.
- Use empty states for unfinished business layers. Do not create mock storage
  or write demo DTOs into Chat metadata or Floor data.

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

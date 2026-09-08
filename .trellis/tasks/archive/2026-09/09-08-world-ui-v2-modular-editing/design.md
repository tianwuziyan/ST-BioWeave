# Technical Design: World UI v2 模块化编辑

## Current boundary

Keep the existing data flow unchanged:

```text
Chat-local World Model
  -> ui/app.js loads and normalizes it
  -> ui/world.js renders species/type selection and sections
  -> one section draft is captured in UI state
  -> normalizeWorldModel validates the combined result
  -> existing runtime.store.saveChat persists the current Chat
```

The UI does not add a storage API, schema field, model ID, or business-layer
normalizer. Manual edits remain explicit user intent and use the existing
structural `normalizeWorldModel` path; they do not invoke AI analysis guards.

## Presentation model

Extend the existing `worldModelState` with presentation-only state:

```js
{
  selectedSpeciesIndex: number | null,
  selectedTypeIndex: number | null,
  editingSection: null | 'capabilities' | 'reproduction_rules' |
    'lifecycle' | 'special_rules' | 'medical_context' |
    'exceptions' | 'unknowns',
  sectionDraft: object | null,
  sectionDirty: boolean,
  busy: boolean,
  notice: string | null
}
```

Selection is an index pair because the existing schema has no stable UI IDs.
The first available species/type is selected by default without assuming any
specific name. Species cards render every type from the model; an empty type
array renders a Chinese empty state and does not fabricate a type.

Only one section draft exists. A type or section switch checks `sectionDirty`;
if dirty, use the existing browser confirmation boundary with the Chinese
message `当前修改尚未保存，是否放弃？`. Cancel leaves the current draft intact.

## Renderer structure

Keep the renderer in `ui/world.js` and split it into small pure functions:

- species selector/card renderer;
- selected type detail renderer;
- capabilities section;
- reproduction rules section;
- lifecycle section;
- special rules section;
- medical context section;
- exceptions section;
- unknowns section;
- one-section editor renderer;
- section extraction/application helper used by tests and app save flow.

The detail area renders only the selected type. World-level sections are always
separate from type-level sections. Section forms stay in their original card;
there is no JSON textarea or full-screen editor.

## Save contract

On save, read only the active section form, create a normalized copy of the
current model, and replace exactly one path:

- type-level sections replace the selected type's section;
- `medical_context` replaces only `model.medical_context`;
- `exceptions` replaces only `model.exceptions`;
- `unknowns` replaces only `model.unknowns`.

The current Chat object is otherwise copied unchanged into the existing
`runtime.store.saveChat(chatId, data)` call. Preserve existing metadata fields;
only update existing manual-save metadata if those fields are already present
in the current model metadata. Do not create schema fields.

Capture and assert the existing `{chatId, token}` around the async save. On
normal success update the in-memory model and clear only the active draft. On
validation, storage, or stale-Chat failure, keep the old model, draft, and
active section, then render a Chinese notice.

## Responsive layout

Use existing breakpoints and CSS variables:

- Desktop: species cards across the page; detail/world rules columns around
  2:1; type detail sections in two columns.
- Tablet: species cards wrap; type detail sections remain two columns; world
  rules move below the detail area.
- Mobile: all World content is one column; selector buttons wrap or scroll
  within the page; section edit controls remain at least touch-sized.

Do not alter the overlay, navigation, theme implementation, or host menu.
Do not add World-specific logo artwork.

## Compatibility and rollback

Existing saved World Models remain readable because the data shape is unchanged.
Reverting the UI commit restores the old renderer without any storage migration.
The implementation must leave `storage/schema.js`, `ai/analyzer.js`,
`ai/prompts.js`, and `ai/input-builder.js` unchanged.

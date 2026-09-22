# Technical Design: Chat-local BioWeave master switch

## Architecture and boundaries

Use the existing `settings.enabled` field in the Chat metadata DTO. Add one
normalization/read helper at the storage/runtime boundary so missing values
resolve to `true` without mutating old Chats until an explicit save. The helper
must read only the current Chat owner and preserve the existing `chat_scope`
and storage epoch checks.

The Runtime owns the authoritative guard. The intended flow is:

```text
Chat metadata settings.enabled
        ↓ normalize/read
Runtime enabled guard + epoch token
        ├─ lifecycle/scheduler analysis entry
        ├─ manual/programmatic analysis entry
        ├─ tracking/snapshot/projection side-effect boundaries
        └─ Projection Context coordinator
        ↓
UI top-bar toggle / Settings toggle → same Chat setting persistence
```

Do not place enabled checks in pure domain functions. Do not make UI state a
second source of truth.

## Runtime behavior

- Expose a small Runtime read/write operation for the current Chat setting,
  using `store.getChat()` / `store.saveChat()` and existing Chat token checks.
- Have the event-analysis coordinator read the normalized enabled state at the
  start of scheduler/lifecycle/manual entry and in `assertExecutionCurrent` or
  its equivalent before every external request and persistence side effect.
- Return a non-failure disabled result (`status: 'disabled'` or
  `status: 'skipped_disabled'`) and avoid terminal failure persistence.
- On disable, invalidate/abort active execution and clear Projection Context.
  The commit guard must reject any response that returns after the setting was
  disabled, even if the request could not be aborted.
- On enable, clear any disabled backlog marker/cursor used by the scheduler,
  refresh the current valid Projection Context once, and allow only future
  interval-eligible work. Do not scan or batch-run disabled Floors.
- Projection coordinator accepts an enabled resolver and fails closed by
  clearing the slot when disabled. All lifecycle refresh callers therefore
  remain safe even when directly invoked.

## UI behavior

- Add a compact native checkbox control to the existing `bioweave-app-header`
  and keep it inside the current event-delegated `ui/app.js` owner. Reuse the
  existing header control classes and `.bioweave-checkbox` appearance.
- Render the status from the current Runtime/Chat DTO on every render; use
  `data-bioweave-action`, checked state, visible `已开启`/`已暂停` text,
  tooltip and labels.
- Reuse `confirmWithPopup()` for the pause confirmation. The control must not
  call `window.confirm()` or create a custom modal.
- Disable the existing refresh action or show a pause Toast before calling the
  Runtime operation; also keep the Runtime guard authoritative.
- Do not render a duplicate Settings page control; the top header is the sole
  visible master-switch entry point.

## Persistence and lifecycle

Register `enabled` only as part of the existing Chat `settings` root; no new
lifecycle field or Character Card storage is introduced. Update lifecycle/spec
documentation to state that pausing preserves all historical Floor-derived
data and affects only future runtime work in the current Chat.

## Compatibility and risks

- Existing Chat metadata without `settings.enabled` must read as enabled.
- Existing `projection_enabled` and nested feature flags remain separate
  feature controls; they are not renamed or reused as the master switch.
- Existing uncommitted World Model/event work must not be overwritten.
- Host Popup and extension-prompt adapters may be unavailable in unit tests;
  preserve existing unavailable/clear result semantics.

## Rollback shape

Keep changes localized to the Chat setting normalization/store boundary,
Runtime coordinator/events, Projection Context coordinator, app/settings UI,
styles, focused tests, and specs/docs. If implementation exposes an unresolved
scope mismatch, revert only this task's files/patches and preserve prior
worktree changes.

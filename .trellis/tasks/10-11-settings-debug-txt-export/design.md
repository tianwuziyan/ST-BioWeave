# Technical design

## Boundaries

- `runtime/diagnostics.js` 和 `runtime/event-analysis.js` remain read-only data owners. The UI calls their existing public accessors and does not inspect Floor storage directly.
- `ui/settings.js` owns the settings markup: keep `renderAnalysisInputPreview()` and the inline diagnostic cards, remove only the settings-page Popup trigger, and add one export action in the same action area.
- `ui/app.js` owns action delegation and browser download orchestration. Replace the obsolete Popup action with an export action. Remove the settings-debug-only Popup renderer and orchestration after a repository-wide caller check; do not retain it merely for tests. Keep only Popup infrastructure/renderers proven to serve other product features.

## Export DTO and flow

At export click time, collect the freshest safe sources directly from the settings action; no Popup is created:

1. Existing export metadata describing the sampling boundary and safety policy.
2. `runtime.collectActiveBusinessData({includeDebug: true})` for the complete business Debug DTO, including Event objects and current Floor provenance.
3. `collectWorldModelLiveState()` for the existing fresh World Model LIVE STATE sample.
4. `runtime.getPersistenceTrace?.()` for the existing sanitized history trace.
5. Current Story Time debug state only when it is already available as safe structured diagnostic data, without causing a new AI call or persisting data.

Build one report object from these existing DTOs, serialize with `JSON.stringify(report, null, 2)`, create a UTF-8 `Blob`, create an Object URL, click a temporary anchor, and revoke the URL in `finally`. Any failure occurs before anchor creation/click and reports through the existing `notify()` path.

The report is an export envelope around existing DTOs, not a second normalized diagnostic schema. Nested arrays and objects are copied as returned; no display HTML or `<pre>` text is used as input. The raw analysis message preview is intentionally excluded from the export because it can contain chat/evidence正文; the existing settings dropdown and inline preview remain unchanged and continue to display it locally.

## Required complete Popup removal

- Remove `open-analysis-debug` markup from `renderAnalysisDebugSettings()`.
- Remove the action-delegation branch for `open-analysis-debug`.
- Remove `openAnalysisDebugPopup()`, `renderDebugPopupContent()`, `activeBusinessDebugPopupInvalidator`, Popup-only refresh/click handlers, and `renderAnalysisDebugPopupContent()` when repository-wide reference search confirms they serve only this removed settings Popup. Update/remove tests that only assert the deleted Popup renderer; preserve tests for shared preview/data contracts.
- Remove `copyPersistenceTrace()` and its document capture listener if no remaining caller exists; the direct TXT exporter replaces the old Popup-only copy action.
- Remove CSS selectors whose only purpose is the deleted Popup or deleted trigger. Do not remove shared `.bioweave-*` Popup styles used elsewhere.

## Failure and repeat behavior

The export handler is delegated through the existing stable root event listener, so repeated exports add no listeners. It must validate the serialized text/Blob path before triggering a link and must never download an empty report. URL cleanup is unconditional.

## Compatibility and rollback

The change is limited to settings markup, UI action handling, browser download helper logic, CSS selectors made orphaned by the removed button, and tests. Runtime diagnostic producers and safe field allowlists are untouched. Reverting the UI files restores the prior Popup behavior without data migration.

## Follow-up layout and Story Time export

- The complete Debug TXT action belongs in the `最近一次运行诊断` header; the old standalone action card is not a second export entry.
- `最近一次运行诊断`、当前生产业务状态、分析输入预览 and `Story Time 调试` use the shared `bioweave-debug-section-header` and `bioweave-debug-preview-scroll` styles. Each preview is 240px high with internal overflow handling and mobile-safe wrapping; refresh/type/mode controls remain outside the scroll bodies.
- Story Time keeps its existing Runtime DTO and copy/refresh actions. Its new TXT action serializes the current `storyTimeDebugState.info` through one shared safe helper, excluding the existing internal `trace` field just as the copy path does, and uses the shared Blob/Object URL download helper with a distinct filename prefix.
- All inline analysis-preview actions (`refresh-analysis-preview`, preview mode, and analysis type) must be handled by the main root event delegation after Popup removal; Popup-local listeners are not a valid owner for controls rendered in Settings.

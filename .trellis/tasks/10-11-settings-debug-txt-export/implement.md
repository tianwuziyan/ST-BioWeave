# Implementation plan

1. Re-check current worktree and locate all settings debug/Popup/export references; record the exact callers and baseline tests.
2. Load the frontend/domain Trellis development guidance and verify the UI framework contract before editing `ui/settings.js`, `ui/app.js`, `style.css`, or tests.
3. Add a small UI-owned export orchestration path that composes the existing safe DTO sources, formats JSON as UTF-8 TXT, downloads with a safe timestamped filename, revokes the Object URL, and reports failures without download.
4. Repository-wide reference check, then truly delete the settings debug Popup: trigger, Popup-specific DOM/rendering, `openAnalysisDebugPopup`, invalidator, refresh/click listeners, copy-only listener path, and orphaned CSS. Do not preserve the removed Popup renderer solely for tests; retain only general Popup infrastructure and independently used Popup components.
5. Add/update focused tests for selectors, action delegation, complete nested DTO preservation, Event edit timing fields, download success/failure, repeat exports, and mobile-safe markup/CSS.
6. Run `node --check` on changed JavaScript, focused settings/debug/Event tests, `npm test`, `npm run check`, `git diff --check`, and `git status`; separate the known lifecycle baseline failures from regressions.
7. Inspect the final diff for unrelated changes and perform the required Markdown impact check. Do not commit, push, reset, or clean.

## Review gates

- No runtime producer, sanitizer, persistence, Event, Tracking, Projection, or schema logic changes.
- No duplicate export entry, no settings Popup trigger/listener, and no settings-debug-only Popup DOM/rendering code or orphaned CSS remain.
- Export report contains the full existing safe DTOs and never uses rendered page text.
- Existing unrelated settings and Popup tests remain valid.

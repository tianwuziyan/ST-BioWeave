# UI Preference Isolation Refactor

## Goal

将 Theme 与 Floating Launcher 的 device-local persistence 收口到共享 preference port，保持现有 key、数据格式与 durable/transient 行为不变。

## Requirements

- `index.js` creates one device-local preference port and injects the same instance into App and Floating Launcher.
- `ui/app.js` and `floating-launcher.js` no longer import or call `resolveDeviceLocalStorage`, `getItem`, `setItem`, or preference JSON serialization.
- The preference port privately owns `bioweave_ui_theme`, `bioweave-floating-launcher-position`, serialization, storage failure handling, read-after-write verification, and existing diagnostic names.
- Preserve current Theme behavior, Launcher pointer behavior, durable/transient position semantics, keys, `{x,y}` data format, and best-effort failure behavior.
- Do not touch Floor, World, Story, Event, Prompt, archive, role normalization, Chat persistence, or SillyTavern settings migration.

## Acceptance Criteria

- [x] Focused baseline is recorded: 85/85 passing.
- [x] Existing full-suite baseline failure identities remain unchanged: 21 unrelated failures.
- [x] Preference port has focused tests for resolver precedence, Theme IO/verification/failures, Launcher IO/malformed data/failures.
- [x] App and Launcher tests use the stable preference port while retaining durable/transient regression coverage.
- [x] Production scan shows raw UI preference storage IO only inside the preference implementation.
- [x] Existing keys and data format remain backward compatible without migration.
- [x] `node --check`, focused tests, full suite, and `git diff --check` are run and recorded.
- [x] Real-host smoke status is reported; Desktop, Mobile, and iPad smoke tests pass. No production behavior redesign is introduced.

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.

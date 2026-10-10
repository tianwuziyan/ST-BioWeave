# Implementation Plan

1. Add failing UI tests proving Story Time is plain text, internal fields are not editable,
   structured type/status controls exist, and cancel/save failure behavior is visible.
2. Add failing Story Time/Runtime tests for display-only edits, Chinese/Arabic/era/traditional
   time cases, derived-field replacement, invalid input, future/equal/past/incomparable time,
   Event ID preservation, sibling/history/Floor/Swipe/stale invariants, and post-save refresh.
3. Implement the smallest formal-ingress fix: parse the new display through the existing
   `story/time.js` facade (with the current calendar resolver), construct a fresh Story Time,
   then run the unchanged Event and collection validators.
4. Replace JSON textareas in `ui/events.js` with the approved structured form. Preserve
   existing action names and mobile single-column layout; render read-only factual/derived
   sections rather than writable JSON.
5. Update `ui/app.js` form collection and error mapping so only approved controls are sent and
   malformed user input cannot fall back to the old Story Time object.
6. Verify complete Floor patch/readback, stale guards, history protection and business refresh;
   add only targeted fixes if a regression is demonstrated.
7. Check related Markdown (UI framework, UI docs, data model/lifecycle/development docs) and
   synchronize only documents made inaccurate by the final behavior.

## Validation commands

- `node --test tests/cn-date.test.js tests/story-time.test.js tests/calendar.test.js`
- targeted Event UI and Runtime tests under `tests/phase2a-ui.test.js`, `tests/phase2a-app.test.js`,
  and `tests/event-analysis-runtime.test.js`
- `node --check ui/events.js && node --check ui/app.js && node --check runtime/event-editing.js`
- `npm test` (record the three known Start New Chat baseline failures separately)
- `npm run check`
- `git diff --check`

## Review gates

- Before implementation: user reviews this plan and explicitly approves activation.
- Before reporting completion: inspect `git diff`, confirm no unrelated files or old JSON
  editor remain in the production Event form, and confirm no commit/push occurred.

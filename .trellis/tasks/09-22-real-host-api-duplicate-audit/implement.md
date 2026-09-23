# Real host activity and Floor persistence follow-up

## Scope

- [x] Make Runtime Activity execution-identity based. Repeated phase status
  events do not increment activity; one terminal status releases one execution.
- [x] Pass the target Floor Version through the Store-to-adapter write boundary.
- [x] Use the existing SillyTavern official Chat owner reader/writer for a
  latest-source exact Floor-slot merge and authoritative read-back when the host
  capability is available.
- [x] Reject stale message/Swipe/content ownership before attaching a result.
- [x] Preserve World and Character/Event fields through independent latest-source
  merges; do not create Chat metadata or memory-only fact sources.
- [x] Add regression coverage for activity balance and official Floor commit.
- [ ] Real SillyTavern refresh acceptance remains a host-environment handoff.

## Verification

Focused tests cover duplicate phase events, all terminal activity states, and
latest-source Floor-slot persistence/read-back. Full `npm test`, `npm run check`,
syntax checks, and diff checks are required before handoff.

## Real-host persistence trace follow-up

- [x] Keep persistence behavior unchanged while recording the automatic
  execution identity, lifecycle order, official/fallback save path, Floor
  Version checks, slot merge, host save and authoritative read-back stages.
- [x] Expose the most recent safe trace through the existing Advanced / Debug
  Popup so host acceptance does not depend on the browser Console.
- [x] Record `NO_PUBLIC_POST_SAVE_HOOK` when the host exposes no completion
  callback after `saveChatConditional()`; do not infer order with a timer and do
  not repair a missing Floor slot automatically.
- [x] Verify official and fallback traces, bounded safe fields, lifecycle
  ordering, duplicate CMR behavior, and Swipe 0 handling.
- [x] Keep the persistence trace copy action delegated through the host
  document and left-align its diagnostic output in the Display Popup.
- [x] Diagnose official JSONL owner lookup after `/api/chats/get`, preserve
  index fallback for host messages without `message_id`, and separate failure
  diagnostics from the analysis trigger in exported traces.
- [x] Accept a valid active Swipe 0 whose host text exists but whose
  `swipe_info[0]` metadata container is not initialized; keep per-Swipe
  ownership and fail closed for missing non-active Swipe slots.
- [x] Make World UI refresh requests idempotent for one in-flight read and one
  Floor Version, preventing repeated terminal lifecycle events from starting
  a refresh loop.

## Debug Popup UI organization

- [x] Give 高级 / 调试 its own settings disclosure and place Story Time 调试
  inside it without changing Story Time behavior.

## Automatic World post-accept lifecycle audit

- [x] Bind the automatic post-World save guard to the current Floor Version,
  preserving cancellation for real owner/version changes.
- [x] Record cancellation stage, reason, code, safe Floor Version comparisons,
  generation identity, and execution activity instead of reporting only the
  reroll trigger.
- [x] Keep unrelated generation lifecycle signals from cancelling an active
  execution when the bound Floor Version remains unchanged.
- [x] Verify the World persistence/view-model path is Runtime-owned and does
  not depend on a mounted panel, active tab, DOM, or UI subscriber.

## Current-baseline minimal repair

- [x] Establish the World refresh guard before the synchronous
  `WORLD_UI_REFRESH_REQUESTED` diagnostic notification.
- [x] Keep persistence diagnostics outside the business render path and add
  bounded cycle-level UI trace stages.
- [x] Add `floor` to the World UI refresh identity without changing the
  six-field Floor Version or Scheduler semantics.
- [x] Add the current real Event response as a regression fixture. It fails
  closed at the existing strict top-level pregnancy exposure evidence
  contract; the prompt explicitly states that nested mechanism evidence
  cannot substitute for top-level `source_evidence`.
- [x] Expose safe validator, instance-path, and schema-path diagnostics in
  Event failure status and traces without recording raw body or credentials.
- [ ] Real-host validation remains pending for UI speed, persisted World
  display, and successful Event persistence after the strict contract fix.

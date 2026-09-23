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

## Event empty-result audit（2026-09-23）

- [x] Confirmed that the attached `<think>...</think>` plus trailing JSON is
  not accepted by the strict Event parser as a whole; the parser accepts the
  JSON-only payload `{"schema_version":1,"events":[]}` and has no parse-error
  fallback to `events=[]`.
- [x] Added safe raw-shape, parse, validation, normalization, empty-result,
  canonical expectation/actual, and UI-ready diagnostics without recording
  raw narrative or reasoning text.
- [x] Made canonical Character readiness compare the expected normalized Event
  count/IDs with the persisted current Floor, so a non-empty result that reads
  back as empty fails the Event Stage and uses its retry budget.
- [x] Kept a valid empty Event result ready and made the Character page show an
  explicit successful empty state instead of looking unanalyzed.
- [x] Clarified the existing Event contract so current-floor physical symptoms
  remain eligible even when their cause is described in Recent Story; this does
  not turn every empty Event result into a retry.

## Host convergence and retry configuration（2026-09-23）

- [x] Confirmed from the current SillyTavern release source that
  `CHARACTER_MESSAGE_RENDERED` can precede the host's awaited
  `saveChatConditional()` boundary.
- [x] When the live host Floor Version still matches but the official owner is
  an older version, invoke the current host `saveChat()` boundary once and
  re-read the official owner before writing the BioWeave Floor slot. No delay,
  polling, forced overwrite, or stale-guard bypass is used.
- [x] Keep the already validated World result within the same Stage attempt
  after successful host convergence; a new World AI request is only used when
  the normal Stage retry policy is actually reached.
- [x] Resolve `retry_count` from the persisted global
  `api_request_settings` source for World, Event, and manual World runs;
  preserve `0` as a valid value and expose the resolved configuration in the
  safe persistence trace.
- [x] Distinguish execution, Stage/retry, and persistence invocation identity
  in diagnostics.
- [ ] Real SillyTavern acceptance remains pending for host convergence and
  post-generation persistence behavior.

## Automatic pre-World host convergence prerequisite（2026-09-23）

- [x] Automatic Character/Event analysis now verifies the authoritative Floor
  owner before any World AI request; an older official owner may converge once
  through the live host `saveChat()` boundary and official read-back.
- [x] Owner/version changes and host-save/read-back failures fail closed before
  World AI and do not consume the World/Event Stage retry budget.
- [x] Manual World entry points and existing persistence-layer convergence
  fallback remain unchanged; focused regression coverage is required for
  official-old, host-converged, owner-changed, save-failed, and successful
  automatic paths.

## Automatic generation settle barrier（2026-09-23）

- [x] Automatic reroll and new-Swipe intents require both the final Character
  Floor render and `GENERATION_ENDED`, regardless of event order.
- [x] Duplicate lifecycle events are consumed once; a newer intent supersedes
  the previous intent and existing-Swipe switches do not create a wait.
- [x] Added safe intent lifecycle traces for creation, final-Floor observation,
  end observation, waiting, settlement, and supersession.
- [x] Pre-settlement paths cannot enter the automatic prerequisite, World
  stage, AI, or terminal-attempt persistence path.
- [x] Official-owner all-null diagnostics during an explicitly unsettled
  generation are not classified as a true stale-owner change.
- [ ] Real-host acceptance remains required for both lifecycle orderings and
  host-specific event payloads.

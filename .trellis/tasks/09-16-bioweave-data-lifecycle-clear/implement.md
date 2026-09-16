# Implementation Plan

## Phase 1: audit and planning gate

1. Read the current Floor State Ownership Contract, UI framework contract,
   schema/store/runtime/UI/tests, and the pinned ST-SevenDaysCal reference.
2. Record the audited data map and the deliberate character-reset/world-model
   semantics in `design.md`.
3. Present the concise audit and implementation summary to the user. If the
   product semantics change during review, update all three planning artifacts
   before requesting the implementation gate again.

Completion gate: the user approved the revised destructive Start New Chat
semantics before implementation. The task manifests and product write sets are
now maintained against the actual checkout; no further product edit is
authorized from this planning phase alone.

## Phase 2: bounded implementation after approval

### Slice A — lifecycle registry and transactional storage

Write set:

- `storage/lifecycle.js`
- `storage/clear.js`
- `storage/schema.js`
- `storage/store.js`
- `runtime/events.js`

Work:

- Add the explicit domain/ownership registry and schema-field contract.
- Add a storage-layer owned Chat mutation with previous-value capture,
  confirmed/unknown persistence handling, owner assertions, and explicit
  rollback for known save failures.
- Expose full message/Swipe slot enumeration and all-domain removal through
  the storage abstraction.
- Add the adapter's awaited Chat save boundary without changing global profile
  APIs.
- Add a source-targeted Chat snapshot/save capability. It must carry the
  immutable source Chat ID plus the source character/group identity and must
  never delegate a source cleanup to `saveChat()` for the mutable current Chat.
  It must read the latest persisted source state and merge exact owned-field
  removals instead of saving the old boundary snapshot as a whole-chat
  replacement. Custom adapters may enforce a server revision CAS; the
  official ST adapter uses latest-read/field-merge/post-save verification
  because the audited release exposes no server revision/CAS endpoint.
- Make the Manual Clear All and source Start New Chat cleanup call the same
  registry-driven clear-all plan/engine; only the target-owner adapter differs.
- Keep all mutation scope limited to the current Chat's BioWeave namespace and
  exact message/Swipe BioWeave roots.

### Slice B — runtime lifecycle and invalidation

Write set:

- `runtime/chat.js` only if the existing epoch seam needs a minimal extension;
- `runtime/event-analysis.js`;
- `runtime/floor.js` only for a small shared provenance helper if required;
- `ai/worldbook.js` only to use its existing cache-clear helper.

Work:

- Add clear facade wiring and runtime invalidation callbacks.
- Abort/invalidate all event-analysis tasks on clear, Chat boundary, source
  mutation, and affected-floor invalidation.
- Maintain a source-owner snapshot and pre-boundary host Chat index while Chat A
  is active. Create a one-shot transition token only after the official host
  evidence proves a newly created B: target absent from the pre-boundary index,
  target/owner identity matches, the boundary token is current, and the
  official `CHAT_CREATED` confirmation is paired with that transition. If an
  adapter exposes freshness and reports `false`, reject the transition; the
  audited release uses the official creation event plus the pre-boundary index
  because it has no separate freshness API. `CHAT_CREATED` alone, or
  `CHAT_CHANGED` alone, must never create a destructive transition.
- On confirmed Start New Chat, call `clearSourceChatBioWeave(sourceChatA)`
  after the host has switched to B, using the source-targeted adapter to remove
  A's metadata/floor/all-Swipe BioWeave roots while preserving A's text and
  unrelated data. Assert A's identity before and after the await; never use B
  as the source mutation target.
- Use the latest-source read/owned-field merge and post-save verification so a
  stale source snapshot cannot overwrite Chat A's message, Swipe, other-plugin,
  or boundary-time updates. Treat the official content digest as evidence, not
  as a server CAS claim.
- Record a failed/unknown source cleanup with its source owner for an explicit
  owner-targeted retry/diagnostic path and surface the failure. The audited ST
  release has no cancellable pre-new-chat event, so a persistence failure
  cannot cancel the host transition retroactively; it must not be hidden or
  converted into a success state.
- Track pre/post Floor source identity to find earliest affected deletion.
- Preserve independent Swipe slots while invalidating active downstream state.
- Add dependency provenance for new analysis results and validate it before
  Swipe-branch reuse.
- Apply and honor the durable character reset marker.
- Keep `refreshTrackingRegistry` and current business reads derived from valid
  Floor facts, never from a stale Chat registry.

### Slice C — UI and synchronized UI documentation

Write set:

- `ui/app.js`
- `ui/settings.js`
- `style.css` only if existing tokens/classes do not cover the data panel;
- `docs/ui-framework.config.json`
- `docs/UI_FRAMEWORK.md`
- `docs/UI_FRAMEWORK_EXAMPLE.html`
- `docs/UI_FULL_REFERENCE.html`

Work:

- Place all three actions only in the BioWeave settings page's independent
  “数据管理” section; do not add a duplicate Start New Chat action.
- Reuse the existing Popup confirmation, Toast, loading/disabled conventions,
  and danger styling.
- Do not add a BioWeave confirmation or UI control for Start New Chat; the
  native SillyTavern action remains the only user trigger for that lifecycle.
- Abort UI-side World Model work on runtime clear/boundary and clear stale
  `worldbookCache`/business state.
- Update config → spec → example → full reference → production in the fixed
  order and keep all existing `data-bioweave-*` hooks.

### Slice D — tests and formal developer contract

Write set:

- `tests/storage-clear.test.js` (new, or the smallest existing storage suite
  if the current test layout makes that preferable);
- `tests/event-analysis-runtime.test.js`;
- `tests/runtime.test.js`;
- `tests/ui.test.js`;
- `tests/lifecycle-contract.test.js` (new if required);
- `docs/bioweave-data-lifecycle.md`;
- `docs/DATA-MODEL.md` and `.trellis/spec/domain/floor-state.md` for short
  pointers only;
- `README.md` for the user-facing Settings → 数据管理 and native Start New
  Chat behavior;
- `AGENTS.md` with a concise lifecycle gate, plus an existing agent-rule file
  only if repository inspection proves it is the correct additional location.

Tests must cover the user's A–J cases, including all message and Swipe slots,
global deep equality, Secret Store non-use, the source-destructive Start New
Chat sequence, ordinary existing-Chat switching, page refresh/character
switching, delete/edit/Swipe invalidation, late results, double clicks,
rollback, and unknown save state. Contract tests must fail when a current
persistent field is not classified or when a new clearable field is omitted
from the full-clear fixture. The Start New Chat cases must additionally prove
that Chat A metadata/floor/all-Swipe BioWeave roots are gone while A's text,
Swipe text, and unrelated plugin fields remain; B is clean; returning to A
does not resurrect data; an existing Chat switch does not clear its source;
and cleanup during a current-Chat change never writes to B. A missing or
ambiguous source owner must be an explicit failed/no-op result, not a
destructive guess. They must also prove Manual Clear All and Start New Chat
source cleanup have identical BioWeave-owned removal coverage, that a stale
snapshot cannot overwrite latest source data, and that duplicate/out-of-order
creation events consume at most one transition.

## Phase 3: verification and review

1. Read `trellis-before-dev/SKILL.md` and refresh package/layer specs before
   writing product code.
2. Run focused storage/runtime/UI/lifecycle tests, then `npm test`, then
   `npm run check`.
3. Run the repository formatter only on files modified by this task.
4. Use the Trellis quality check to review spec compliance, cross-layer data
   flow, test completeness, and synchronized UI docs.
5. Inspect `git diff` and `git status` for global API/Secret changes, missing
   `swipe_info[*]` traversal, late commits, dangling references, duplicate
   listeners, stale UI, and false-success save handling.
6. Fix findings and rerun the complete checks.
7. Report real-host SillyTavern Desktop/Tablet/Mobile acceptance separately;
   Node/fake-host tests cannot prove host event or persistence behavior.

## Explicit non-goals

- No DOM listener for “开始新聊天”, no button-text heuristic, and no
  `CHAT_CHANGED -> clearCurrentChat` implementation; no `CHAT_CREATED`-only
  trigger.
- No API profile, Secret Store, extension setting, message text, Swipe text,
  or other-plugin data deletion.
- No generic recursive deletion of arbitrary objects.
- No full-chat wipe for one local floor mutation.
- No deletion of every non-active Swipe analysis on a Swipe switch.
- No destructive cleanup for ordinary `CHAT_CHANGED`, page refresh, plugin
  initialization, character switching, or loading an existing Chat.
- No source cleanup using the mutable current Chat after the boundary; a source
  owner that cannot be verified must fail closed.
- No whole-source-snapshot overwrite when clearing Chat A, and no additional
  BioWeave Start New Chat button or confirmation dialog.
- No new historical Event ledger, full State reducer, or unrelated business
  feature.
- No commit, push, merge, reset, or destructive Git operation.

## Rollback boundary

If implementation must be reverted, modify only files introduced or changed by
this task. Preserve existing user-owned worktree changes and unrelated active
Trellis task artifacts.

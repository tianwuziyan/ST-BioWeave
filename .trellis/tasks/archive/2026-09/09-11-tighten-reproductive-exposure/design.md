# Technical design

## Boundary and data flow

```text
Prompt contract
  -> AI fixed Event DTO / typed physical_effect
  -> Runtime canonical event_id + Floor Version source
  -> core/events normalize + validate actual-exposure consistency
  -> unchanged core/tracking eligibility / Registry rebuild
  -> UI renders counterpart_ids projection only for character exposure cards
```

`ai/prompts.js` owns model instructions. `ai/analyzer.js` owns AI DTO shape checks only. `core/events.js` remains the single Domain Event boundary and owns the cross-field consistency checks. `runtime/event-analysis.js` continues to call that boundary before saving. `core/tracking.js` remains unchanged.

## Event semantics

For a pregnancy-related `sexual_activity`, participants are the directly relevant members of the actual reproductive exposure chain. `counterpart_ids` is a subset of participant IDs identifying actual exposure sources. A barrier/protection action is evidence, not the result; the final actual exposure outcome is what the Prompt must classify.

The Prompt uses mechanism-neutral language: `conception-relevant reproductive substance / mechanism`, `gestational subject`, `conception source`, and `actual reproductive exposure`. Reality-style tests may say an abstract reproductive substance entered the valid path, but Domain code does not inspect anatomy or gender.

## Structured evidence and validator rules

Use the existing `{kind, text}` evidence contract with a canonical kind `conception_relevant_exposure`. It is a typed marker, not a natural-language parser. `validateEvent()` will:

1. retain existing envelope, source, participant, enum, array and evidence-shape checks;
2. require `relevant=true`, nonempty `gestational_subject_ids` and `counterpart_ids`, participant membership, and the canonical exposure evidence marker whenever `possible_conception=true`;
3. require no participants, `relevant=false`, `possible_conception=false`, and empty subject/source arrays for a `sexual_activity` with no possible conception;
4. validate optional `physical_effect.gestational_substance_intake` as boolean/null and require the canonical exposure marker when it is true;
5. avoid interpreting evidence text or using capability, protection, ejaculation, event role, gender, or UI labels as an exposure calculation.

The validator does not force `gestational_substance_intake` to be the only universal conception mechanism. A future mechanism can use the same typed exposure evidence without a human-specific branch. World Model remains the source of mechanism capability and exception context.

## Prompt changes

- Replace “all actual participants” with direct actual-exposure-chain participants.
- State explicit inclusion/exclusion rules for valid barrier, barrier failure/removal, external ejaculation, insertion-only and contact-only cases.
- Require final outcome over protection history.
- Require `counterpart_ids` to contain only actual source IDs and require the exposure evidence marker when possible conception is true.
- Require physical effect consistency and direct-relevance participants for non-sexual biological events.

## UI projection

Remove the character-card-only participants summary and its event-role formatting. Keep time, location, Event type/status, debug identity and a single “相关对象” row. Resolve display names by `counterpart_ids` against the canonical Event participants; do not use the UI to derive or filter the IDs. The global Events page continues to display the canonical Event participants, which are now already narrowed by Domain/Prompt semantics.

## Compatibility and risks

- Existing positive fixtures and any persisted Event lacking the new typed exposure marker may fail strict validation and require re-analysis; no automatic historical rewrite is introduced.
- Existing Tracking eligibility remains unchanged, but invalid or no-exposure Events naturally produce no subjects through the existing validation/decision path.
- The Runtime error remains a generic Domain validation failure; no new business logic or error transport is added.
- The task does not touch StateReducer, Projection, Genealogy, World Model, StoryTime, Snapshot, Registry policy or storage layout.

## Rollback

If focused Event/Runtime tests expose unintended compatibility failures, first isolate the failing new validator rule and revert only the cross-field rule while preserving the Prompt/UI terminology corrections. Do not restore the old “all participants” semantics. No Git history rewrite or destructive rollback is allowed.

# Implementation plan

## Ordered checklist

1. Update `core/events.js` with the mechanism-neutral exposure evidence constant/helper, typed `physical_effect.gestational_substance_intake` validation, and cross-field rules. Keep `core/tracking.js` unchanged.
2. Update `ai/analyzer.js` only for AI DTO physical-effect field shape/diagnostic handling needed by the Domain contract; keep Runtime identity and source ownership unchanged.
3. Rewrite the protected sexual-activity and output-contract lines in `ai/prompts.js`; include final barrier outcome, direct participant scope, no-exposure behavior, physical-effect evidence, and direct-relevance rules for other Event types.
4. Update `ui/characters.js` so exposure cards render only the `counterpart_ids`-based “相关对象” field. Do not add new business computation or storage.
5. Update focused fixtures/tests:
   - `tests/events.test.js` for positive/negative Domain consistency and participant-reference/evidence failures;
   - `tests/event-analysis.test.js` for Prompt contract, typed physical effect, abstract barrier outcomes, 0/1/N sources and parser diagnostics;
   - `tests/event-analysis-runtime.test.js` for canonical event acceptance/rejection without changing Runtime orchestration;
   - `tests/tracking.test.js` only as needed to make existing fixtures satisfy the new Event contract, preserving all eligibility assertions;
   - `tests/phase2a-ui.test.js` for one character exposure card, counterpart-only display, and source-level UI prohibitions.
6. Update `docs/DATA-MODEL.md`, `docs/DEVELOPMENT.md`, `docs/UI.md`, and `.trellis/spec/domain/event-pipeline.md` to the same participants/counterpart/evidence semantics.
7. Review the diff for excluded modules and run the validation gates.

## Validation commands

- `node --check` on each changed JavaScript file.
- Focused Node tests for Event parser/domain/runtime/tracking/UI files.
- `npm run check`.
- `git diff --check`.
- `git status --short` and `git diff --stat` to confirm no commit/push and no scope drift.

## Risky files and ownership

- Domain writer: `core/events.js`; must not edit `core/tracking.js`.
- AI writer: `ai/prompts.js` and `ai/analyzer.js`; must not alter World Model or Projection prompts.
- UI writer: `ui/characters.js`; `ui/events.js` only if a focused regression proves the global projection needs wording clarification.
- Docs/tests writer: listed docs and focused tests only.
- `runtime/event-analysis.js` is read-only unless a new diagnostic code must be mapped; no orchestration or Registry changes.

## Pre-start checks

- Confirm task remains `planning` and no product files changed after audit.
- Confirm `prd.md`, `design.md`, `implement.md`, `implement.jsonl`, and `check.jsonl` are complete before `task.py start`.
- After implementation, independent quality review must inspect scope, cross-layer data flow, tests and excluded-module preservation.

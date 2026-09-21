# Implementation Plan

1. Inspect current `ai/prompts.js`, World Model analyzer test helpers, schema
   shape, and the real sample evidence; record only confirmed facts.
2. Replace the current core-instruction ordering with concise fact-discovery →
   archival → strict validation → unarchived-fact review language. Preserve
   existing detailed evidence rules and output contract.
3. Add compact A-F prompt regression fixtures in `tests/world-model.test.js`.
   Assert medical capture without population generalization, empty medical
   context for ordinary Human reproductive input, exception-vs-type handling,
   input-triggered unknowns, no schema-gap unknowns, and empty exceptions.
4. Run targeted World Model tests and inspect the diff for scope drift.
5. Run `npm run check`, `node --check` on changed JavaScript files, and
   `git diff --check`.
6. If all checks pass, report root cause, changed semantics, regression
   coverage, modified files, and any untested real-host acceptance.

## Review gates

- Do not copy the real attachment into fixtures.
- Do not require all top-level sections to be non-empty.
- Do not change Event Analyzer, Story Time, Calendar, StateReducer, Character
  Registry, Floor ownership, UI, or Phase 2C.
- Do not commit or push without separate authorization.

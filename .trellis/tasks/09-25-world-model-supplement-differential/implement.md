# Implementation Plan

1. Re-read current source context and relevant specs immediately before edits;
   confirm no unrelated worktree changes appeared.
2. Update `ai/prompts.js` with the Patch-only baseline reference formatter,
   revised Patch task/output contract, and final USER instruction.
3. Update `ai/analyzer.js` with a generic sparse-Patch evidence guard at the
   analyzer boundary; preserve validator, merge, omission, and remove/invalidate
   behavior.
4. Add focused tests in `tests/world-model.test.js` for Full/Patch message
   shapes, baseline content, differential contract, older evidence, evidence
   guard, sparse omission, unsupported removal, and canonical merge validation.
   Add runtime coverage only if the existing fixture is the smallest way to
   prove the resolved baseline crosses the runtime-to-request boundary.
5. Synchronize `.trellis/spec/domain/world-model.md`,
   `docs/CONTEXT-AND-PROMPT.md`, and only any directly conflicting World Model
   documentation. Do not alter unrelated UI behavior; inspect `ui/world.js`
   only for stale product wording and change it only if required by the new
   contract.
6. Run focused World Model tests, related runtime tests, full repository checks
   available in `package.json`, `git diff --check`, and a production-text scan
   for forbidden fixture/person/species/Floor literals.
7. Review the final diff and status. Do not commit or push.

Risk points:

- Patch evidence validation must not use Floor age/origin as eligibility.
- Full prompt must remain baseline-free even when its caller DTO has a stale
  `world_model` property.
- No patch path may become a complete replacement-model response.

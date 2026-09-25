# Implementation Plan

1. Re-read current source context and relevant specs immediately before edits;
   confirm no unrelated worktree changes appeared.
2. Update `ai/prompts.js` with the Patch-only baseline reference formatter,
   revised Patch task/output contract, and final USER instruction.
3. Update `ai/analyzer.js` with deterministic Patch safety validation at the
   analyzer boundary; preserve the existing World Fact Discovery, validator,
   merge, omission, and remove/invalidate behavior. Do not turn the guard into
   a narrative scope engine.
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

## Next implementation phase after v2 canonical clarification

The next implementation phase is limited to the missing World Knowledge Scope
and deterministic safety capabilities:

1. Preserve the existing AI World Fact Discovery and define Candidate scope /
   outlet classification for Individual, World, Exception, Unknown, Medical,
   and Special Rule knowledge.
2. Preserve Raw Patch presence where a sparse section requires it.
3. Resolve the Existing canonical target and compare canonical Existing versus
   Candidate values only as deterministic safety checks.
4. Classify `UNCHANGED`, `ADD`, `CHANGE`, and `REMOVE`, including knowledge
   weakening in complete candidates.
5. Validate changed world-level facts against permitted evidence, reject
   unsupported piggyback, and reject only clearly incompatible or explicitly
   individual-bound support available from reliable evidence structure. Do not
   build a second deterministic narrative scope parser; AI Candidate scope and
   classification remain authoritative.
6. Complete deterministic merge, shared complete-model consistency, and strict
   canonical finalization.
7. Add regression tests for scope, compatible consolidation, correction,
   exception/unknown/medical boundaries, presence, weakening, baseline/evidence
   isolation, and final canonical validation.

Required scenario matrix:

- A compatible world-level supplement merges with Existing knowledge;
- B individual-only fact does not overwrite a World rule;
- C explicit world-level correction may change the rule with current evidence;
- D explicit world-level exception preserves the general rule and adds an exception;
- E individual anomaly does not create a World exception;
- F explicit world-level unknown enters `unknowns`;
- G individual uncertainty does not enter `unknowns`;
- H individual medical need does not update `medical_context`, while group/world
  medical scope may update it;
- I older permitted evidence may supplement a missing Existing fact;
- J supported and unsupported Candidate deltas cannot piggyback;
- K unchanged Existing facts need no repeated evidence;
- L complete-candidate knowledge weakening is `REMOVE` and rejected;
- M sparse `medical_context` presence preserves raw-absent fields;
- N deterministic complete-model consistency consequences do not require Full
  evidence re-proof.

This phase does not rewrite Full Analysis, Fact Discovery, or the evidence collector, change
canonical null semantics, UI, schema, Runtime routing, Floor ownership,
Pregnancy Tracking, or Projection Rule identity.

The current implementation also fails closed for Existing reproductive
mechanism updates without a stable logical identity, supports safe new
mechanism additions only with a non-colliding explicit key, uses canonical
field equality for exception duplicate detection, and fails closed if sparse
medical Patch presence metadata is unavailable at merge time.

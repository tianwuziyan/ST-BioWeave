# World Model Supplement 协议重构实施计划

## Phase 1

1. Re-read current canonical World Model spec and implementation contracts.
2. Update `.trellis/spec/domain/world-model.md` to the hierarchical Candidate protocol and internal Patch v2 contract.
3. Add deterministic Existing canonical-to-hierarchical formatter.
4. Add strict hierarchical Candidate parser with stack-based ownership.
5. Add sparse Candidate validator preserving field presence.
6. Add deterministic Candidate → Patch v2 translator.
7. Add generic parser, ownership, recovery, omission, mapping and leak-prevention tests.

## Phase 2

8. Add the evidence-only Supplement Discovery Ledger logical phase with exact identity grammar inside the single response contract.
9. Parse the single Supplement response deterministically into isolated Discovery and Candidate sections; fail closed on invalid ownership.
10. Add structural Discovery Coverage Check before Candidate → internal Patch v2.
11. Replace only Supplement v2 output instructions with the documented tagged-text grammar.
12. Preserve Existing Supplement Target for Candidate Builder and all permitted evidence roles.
13. Change Analyzer Supplement parsing to one response: Discovery + Candidate → Candidate → internal Patch v2.
14. Preserve existing Evidence Guard/merge/consistency/canonical validation path.
15. Correct stale comments and stale AI-facing Patch v2 wording.

## Phase 3

16. Verify complete canonical model is the only persistence/UI payload.
17. Run focused World Model tests.
18. Run full suite.
19. Run `node --check` for changed JavaScript files.
20. Run `git diff --check`.
21. Run fixture leakage audit for production/test fixture names.
22. Run stale-comment audit for old AI-facing Patch v2 contract and forbidden operation wording.
23. Report changed files, spec sections, grammar, parser state machine, recovery boundaries, mapping, persistence/UI path, test counts and gaps.

## Rollback boundaries

- Phase 1 changes are limited to protocol/parser/translator/spec/tests.
- Phase 2 changes are limited to Supplement prompt/analyzer parsing and related tests.
- Phase 3 changes are limited to Supplement Runtime wiring and verification.
- Do not alter storage ownership, UI schema, Full/Event/Character paths or system boundaries.
- Stop and report if current code conflicts with an ownership safety invariant.

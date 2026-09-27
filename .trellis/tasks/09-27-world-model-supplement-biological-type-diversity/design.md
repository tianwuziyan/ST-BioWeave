# Technical Design

## Change boundary

The behavior gap is that Identity Review currently proves only exact-once review accounting. It does not require an explicit sibling/alternate-Type scan or reconcile the model-reported distinct count with host-observed identity facts. The current analyzer also computes coverage only from the pre-attempt Existing model, so an accepted newly discovered Type can incorrectly leave Supplement completeness true without semantic targets for that Type.

The primary owners are `ai/world-supplement-protocol.js` for review grammar, count validation, stable target generation, and completeness diagnostics; `ai/prompts.js` for the targeted single-request search/output contract; `ai/analyzer.js` for pre-Guard count observation and accepted identity metadata; and `runtime/world-analysis.js` for post-response coverage audit and recent execution diagnostics. Focused tests and this task's Trellis documents are the only expected additional changes.

The host will not infer Type values. It observes Existing and syntactically valid `Type_Identity` Facts, then compares the review's reported count. Facts still go through resolver and the unchanged Evidence Guard; rejected identities do not enter canonical counts or trigger semantic coverage expansion.

Dynamic coverage uses the existing `buildWorldModelSupplementCoverageTargets` field vocabulary against the transient merged candidate only after the response, to report whether same-response semantic coverage appears complete. It does not schedule a normal second semantic API request. Existing retry behavior remains available for malformed output and transport/stage recovery; no new retry framework or Floor writer is introduced.

Sibling search is represented by the existing Additional_Type_Search review field; no second search grammar is introduced. The host records `initial_type_count`, `initial_identity_search_performed`, `sibling_search_seeded`, `sibling_search_complete`, discovered/accepted/rejected sibling names/counts, and reported/host-observed/accepted canonical counts. These are diagnostics/accounting only: count equality never proves discovery, and only accepted Facts may expand coverage.

Explicitly out of scope: minimum biological-type cardinality, sex/gender vocabulary, Evidence Guard threshold/boundary changes, Coverage Disposition changes beyond carrying the expanded deterministic queue, Full mode, Floor Coordinator, UI adoption, renderer, debug sampling architecture, hardcoded Type mappings, and world-knowledge sibling inference.

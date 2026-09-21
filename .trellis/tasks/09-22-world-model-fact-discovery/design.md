# Technical Design

## Boundary

The behavior gap lives in `ai/prompts.js`: the current World Model core starts
with species/type discovery and only mentions medical context, exceptions, and
unknowns late as auxiliary output areas. The fix stays at the prompt contract
and prompt-focused tests. The parser/normalizer remains the existing schema
boundary unless a failing regression proves it rejects the desired shape.

## Prompt flow

Reshape `WORLD_MODEL_CORE_INSTRUCTIONS` into four explicit stages:

1. **Fact discovery** — scan the complete AnalysisInput and collect every
   evidence-backed biological, reproductive, pregnancy, childbirth,
   physiological-change, and reproductive-care/medical fact before deciding
   its field.
2. **Classification and archival** — route each fact to the most suitable
   existing schema field, including the horizontal fields
   `medical_context`, `exceptions`, `unknowns`, `special_rules`, and
   `projection_rules`; facts that do not fit a narrow type/capability field
   must not be discarded.
3. **Field-level validation** — retain existing species/type evidence gates,
   Human baseline restrictions, capability independence, null/“无” semantics,
   mechanism and projection contracts, and no-common-sense inference.
4. **Unarchived-fact review** — rescan discovered facts after the normal
   species/type/reproduction/lifecycle pass and check medical context,
   exceptions, unknowns, and special rules, while rejecting individual-to-
   population overgeneralization and null-to-unknown hallucinations.

## Semantics

- `medical_context` is a horizontal world-model context for explicitly
  evidenced pregnancy, childbirth, postpartum medical/care facts, difficulty,
  risks, or outcomes. A named individual case may establish that a situation
  exists, but not that it is a population-wide rule. Ordinary narrative
  medical events remain Event Analyzer facts.
- `exceptions` require an already established general biological rule or
  baseline plus explicit evidence of an individual, conditional, temporary,
  or reversible deviation. Stable species/type rules remain in
  `special_rules`; absent evidence means `[]`.
- `unknowns` require an input-triggered unresolved biological question whose
  mechanism, condition, boundary, scope, or conflict matters to the current
  model. The unknown answer itself is not asserted as fact, but the trigger
  must be evidenced. Empty/null schema fields never create unknowns.

## Test strategy

Use compact synthetic descriptions and mocked structured responses, following
the existing `tests/world-model.test.js` helper style. Assert prompt wording
for the four-stage contract and add minimal analyzer fixtures for A-F. Do not
embed `/Users/ll/Downloads/输入文件.txt`; keep the named real sample as a
manual acceptance reference only.

## Compatibility and rollback

No output keys, DTO signatures, storage ownership, or downstream layers change.
If prompt regressions expose a schema rejection, make the smallest schema
adjustment only after documenting the exact failure; otherwise keep the diff to
prompt and tests. Reverting the prompt/test diff restores the prior behavior.

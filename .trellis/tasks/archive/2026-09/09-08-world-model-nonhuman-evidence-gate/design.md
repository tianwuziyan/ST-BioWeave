# Technical Design: Non-human Evidence Gate

## Boundary and data flow

Keep the existing World Model path:

```text
AnalysisInput source text
  -> buildWorldModelMessages / fixed Prompt
  -> provider JSON response
  -> parseWorldModelResponse / structural normalization
  -> analysis-only evidence guard
  -> current Chat World Model persistence and UI
```

The change belongs at the Prompt plus the post-response analysis guard. The
structural schema remains open and nested. Manual World Model editing continues
to perform only structural normalization; it must not be rejected because the
AI evidence gate cannot see the original AnalysisInput.

## Prompt contract

Rewrite the non-human sections of `ai/prompts.js` as one coherent contract:

- species recognition and biological type recognition remain separate;
- a non-human type requires species-linked direct evidence or a unique,
  low-inference semantic deduction;
- the same evidence rule applies independently to capabilities,
  reproduction_rules, lifecycle, and explicitly described special rules;
- human baseline is available only after an established human type and does not
  authorize a non-human value;
- `常见`, `通常`, humanoid appearance, intercourse, anatomy, and model
  plausibility are not non-human evidence;
- unknowns may describe only an established type or established rule.

Include the exact semantic example `剑灵性别基本都为男性，极少女剑灵` and
state that it yields both `男性` and `女性` under `剑灵`.

## Analysis guard

Extend `ai/analyzer.js` without changing the World Model shape.

1. Build sentence-level evidence units from the same AnalysisInput text already
   used by `worldModelEvidenceText`. Keep Chinese comma-separated phrases in a
   single unit so a subject such as `剑灵` remains available to both halves of
   `剑灵性别基本都为男性，极少女剑灵`.
2. Resolve a narrow set of species-context variants (for example `妖/妖族/妖修`,
   `魔/魔族`, and `剑灵`) plus the exact normalized species name. Do not use
   global male/female evidence for a non-human species.
3. For familiar names, use species-local evidence:
   - `男性` and `女性` accept direct labels and deterministic forms such as
     `少女剑灵` only when the same evidence unit names the species;
   - `双性` continues to require fixed, non-temporary evidence in that species;
   - the existing exclusions for `性别模糊`, `妖修`, `半兽人`, `魔族`,
     `妖剑剑灵`, and `魔剑灵` remain active.
4. For open names, retain a non-human type only when its normalized name is
   directly present in a species-linked evidence unit. Do not introduce an enum.
5. For each retained non-human type, sanitize fields independently using a
   small field-to-evidence keyword map:
   - capabilities: sperm/ova/fertilization/carrying evidence;
   - reproduction rules: fertilization, pregnancy/carrying, cycle, ovulation,
     gestation, labor evidence;
   - lifecycle: maturation and aging/lifespan evidence.

For each field, an explicit positive or negative source statement can produce
`true`/`false` for a capability; without field evidence the capability becomes
`null`. For text rules, preserve the provider's normalized text only when the
corresponding source evidence exists; otherwise set `null`. This is a narrow
output safety boundary, not a natural-language theorem prover.

Human types bypass this non-human field scrub and retain the existing Prompt
baseline behavior. Explicit partial human-equivalence for a non-human type is
handled by the field's own evidence keyword, so only the named field survives.

## Compatibility

- No schema version or field changes.
- No AnalysisInput, API, Chat save, refresh, UI lifecycle, selector, or other
  module changes.
- Existing normalization still handles open names, canonical `双性`, and
  nested capabilities.
- Existing fixed dual, temporary dualization, individual ambiguity, alias,
  human baseline, and ABO regressions remain in the test suite.

## Risks and trade-offs

- Sentence-local evidence may reject a highly indirect cross-sentence
  implication. This is intentional: the current bug is over-inference, and
  later AnalysisInput can add the missing direct evidence.
- Keyword evidence is deliberately small and field-specific to keep analysis
  fast and predictable. It does not attempt to model every fantasy physiology.
- Provider text descriptions are not treated as evidence; only AnalysisInput
  is. This prevents an AI response from self-authorizing its own template
  values.

## Rollback

The change is isolated to Prompt, analyzer evidence helpers/guard, tests, and
World Model documentation/spec. Reverting the task commit restores the prior
behavior without a schema or persistence migration.

# Technical Design: World Model Final Reproduction Consistency

## Boundary and data flow

Keep the existing analysis-only path and add one final step:

```text
AnalysisInput
  -> API response JSON
  -> parseWorldModelResponse (structural normalization)
  -> applyWorldModelEvidenceGuard (existing evidence/classification behavior)
  -> applyWorldModelFinalConsistencyGuard
  -> Chat-local World Model
  -> World UI
```

The new guard is used only by `createAnalyzer().analyzeWorldModel()`. Structural
normalization, manual editor saves, schema shape, request construction, storage,
and UI remain unchanged.

## Final guard contract

Add a small pure mapper over the normalized model. For each
`species[].biological_types[]`, clone `reproduction_rules` and apply only these
deterministic mappings:

| Capability | Final rule effect |
| --- | --- |
| `can_produce_ova === false` | `ovulation = null` |
| `can_carry_pregnancy === false` | `pregnancy_or_carrying`, `gestation`, `labor` = `null` |
| `can_be_fertilized === false` | clear recipient-role `fertilization` text |
| `can_fertilize === false` | clear donor-role `fertilization` text |

The fertilization matcher distinguishes recipient wording such as “卵细胞可被
精子受精” from donor wording such as “通过精子使卵细胞受精”. A generic rule such
as “体内受精” has no role. When either fertilization capability is explicitly
false, that generic rule is not retained because it cannot be proven to describe
the allowed role. With `null` capabilities, the guard leaves the rule untouched.

## Human baseline handling

Keep human baseline handling local to the final guard and keyed by the concrete
human type, rather than defining one shared reproduction object:

- For a human male capability signature (`can_be_fertilized: false`,
  `can_fertilize: true`), convert a roleless generic fertilization baseline to a
  donor-role description and remove female baseline cycle wording such as
  menstruation/28-day cycle. Universal false-capability mappings remove
  ovulation, pregnancy, gestation, and labor.
- For a human female capability signature (`can_be_fertilized: true`,
  `can_fertilize: false`), convert a roleless generic fertilization baseline to a
  recipient-role description and preserve existing female baseline rule fields.
- Never fill a missing field with “无” or another negative placeholder. Never
  replace an explicit role-specific rule or a non-baseline rule merely because
  the type is human.

This gives the final output a type-specific baseline while preserving direct
evidence and the existing capability values.

## Compatibility and rollback

No schema or migration change is required. Existing stored World Models are not
rewritten; the new behavior applies to fresh analyzer results. Reverting the
implementation removes only the final guard, type-specific baseline cleanup,
regressions, and its minimal contract note.

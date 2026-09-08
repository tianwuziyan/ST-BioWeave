# Technical Design: World Model Final Evidence and Consistency Guards

## Boundary and data flow

Keep the current analysis path unchanged:

```text
AnalysisInput
  -> API response JSON
  -> parseWorldModelResponse (structural normalization)
  -> applyWorldModelEvidenceGuard (AI-only evidence filtering)
  -> final consistency guard
  -> Chat-local World Model
  -> World UI
```

This task changes only the two analysis-only guards and the Prompt contract. The
schema, parser shape, storage, API request, UI, and manual editor remain
unchanged. `parseWorldModelResponse` continues to accept open type names for
structural/manual use; semantic filtering stays on the `analyzeWorldModel`
path.

## Type-name guard

Extend the existing observed/non-biological type check with one small semantic
predicate:

- compact the species and type names;
- reject equality;
- reject a species alias followed only by a small generic suffix such as `族`、
  `修`、`修士`、`人` or `类`;
- retain the existing explicit checks for known source/attribute/subtype labels.

The predicate is not a gender enum and does not reject arbitrary open names. It
only catches the case where the child is still a species/identity label in the
parent context. It runs before capability sanitization, so an invalid type
cannot act as a container for species-wide evidence.

## Non-human field-local evidence

The current single-type fallback makes `fieldEvidenceUnits` return all
species-linked units. That is safe for neither a generic type nor multiple
individuals. For non-human types, use `typeEvidenceUnits` for every field,
including when the AI returned only one candidate type. Human types keep their
existing baseline path and do not enter this scrub.

This preserves the existing direct semantic case:
`剑灵性别基本都为男性，极少女剑灵` produces direct type units for both
`男性` and `女性`. It also means a species-level fact without a current type
binding cannot populate a type's capability, rule, lifecycle, or special rule.

## Final consistency guard

Add a pure, small post-processing function over normalized analysis output. For
each type, inspect only false capability values and the corresponding rule:

| Capability | Conflicting positive rule |
| --- | --- |
| `can_carry_pregnancy: false` | explicit actual pregnancy/carrying wording in `pregnancy_or_carrying` |
| `can_produce_ova: false` | explicit normal ovulation wording in `ovulation` |
| `can_be_fertilized: false` | explicit wording that the type is a recipient of fertilization in `fertilization` |

If the rule text is explicitly negative/unknown, it is not a conflict. If it
is positive and conflicts, set only that rule to `null`. Do not alter a `true`
or `null` capability, infer a capability from a rule, or rewrite unrelated
fields. The function runs after the evidence guard so its priority is
`field-local capability > contradictory reproduction rule`.

## Prompt and compatibility

Add concise instructions for child-type semantic scope, no cross-individual
aggregation, and final consistency precedence. Keep the existing human baseline
precedence and fixed-vs-temporary dual evidence wording. No migration or schema
version change is needed.

## Rollback

Reverting the task commit removes only the new type predicate, the non-human
single-type fallback change, the final rule guard, Prompt wording, tests, and
the matching spec note. Existing stored World Models are not migrated.

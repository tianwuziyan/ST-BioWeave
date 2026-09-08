# Technical Design: World UI Type Rendering and Capability Tri-state

## Boundaries and data flow

Keep the current path unchanged:

```text
AI response
  -> parse / normalize World Model
  -> analysis-only non-human evidence guard
  -> Chat-local world_model
  -> ui/app.js loads and normalizes the model
  -> ui/world.js renders the World page
```

The UI change belongs only at the final render boundary. The capability change
belongs in the existing non-human field scrub and its fixed Prompt contract.
No schema, storage, API, AnalysisInput, or app lifecycle boundary changes.

## UI rendering contract

- Introduce or use one small helper for rendering a biological type array.
- The helper accepts the actual `species.biological_types` array and maps every
  element with its index; it does not inspect or whitelist names.
- The existing `displayText` escaping remains the only user-visible string
  formatting boundary, so custom names remain safe and visible.
- Keep the existing empty-species message only for an actually empty array.

The regression will pass a human species with `男性`, `女性`, `双性` and an
open custom type to `worldPage`, then assert that each name occurs in the
rendered HTML. This checks the actual UI boundary rather than only normalizer
output.

## Capability evidence contract

Keep the existing `fieldEvidenceUnits` and species-local type evidence. Replace
the current binary interpretation of any negative-looking context with a
three-state evidence classification:

1. Explicit positive capability wording -> `true`.
2. Explicit inability / impossibility wording tied to the capability -> `false`.
3. Absence, non-observation, missing records, uncertainty, or a phenomenon that
   does not decide capability -> no capability evidence, therefore `null`.

Examples:

- `女性剑灵能够妊娠` -> `can_carry_pregnancy: true`.
- `女性剑灵不能怀孕` -> `can_carry_pregnancy: false`.
- `仅存在假孕现象，无实际妊娠记录` -> `can_carry_pregnancy: null`.

The classifier must not treat generic `没有`, `无`, `未记录`, or `未观察到`
as explicit inability. It may recognize a negative phrase when it explicitly
targets a capability, such as `不具备妊娠能力` or `无法怀孕`.

Human biological types continue to bypass this non-human scrub and therefore
retain the existing human baseline. Non-human type recognition itself remains
species-local and is not changed by this task.

## Prompt and documentation

Add one coherent Prompt rule stating that `false` requires explicit negative
field evidence, while absent/uncertain/only-observed facts remain `null`.
Update the frontend World Model contract so future changes preserve the same
tri-state boundary.

## Compatibility and rollback

- No schema version or field changes.
- Manual World Model editing remains structural-only and can still save explicit
  user values.
- Reverting the task changes restores the previous UI and capability guard
  without data migration.

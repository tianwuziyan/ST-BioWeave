# Technical Design

## Boundary and rollback

The previous implementation commit is `09b9b86`. Before editing product code,
apply its exact reverse change to the clean working tree. This restores the
pre-round implementation baseline while preserving the later archive and
journal commits. The corrected implementation is then made from that baseline;
it is not layered on top of the previous evidence policy.

The final task changes are limited to World Model prompt/analyzer/tests and
closely related executable documentation/spec text. `storage/schema.js` and
`ui/world.js` remain unchanged unless a test demonstrates that the unchanged
v1 contract cannot support the requested behavior.

## Data flow

```text
AnalysisInput
  -> buildWorldModelMessages (generic task + actual source text)
  -> model JSON response
  -> parse/normalize fixed World Model v1
  -> analysis-only evidence guard
  -> final deterministic consistency guard
  -> Chat world_model
  -> worldPage/renderWorldModelView (same renderer for every species)
```

Event, State, Projection and Context do not currently consume the individual
World Model capability fields. They remain outside this change.

## Canonical schema decision

Keep the existing five capability keys. The repository has no downstream read
path for lactation, regeneration or shapeshifting, so adding fields now would
create an incomplete cross-layer contract and invite LLM-created keys. The
normalizer remains a whitelist: unknown keys are dropped at the type boundary.
If a future consumer needs one of those capabilities, schema, analyzer,
Prompt, UI, and tests must be changed together.

## Prompt responsibilities

The fixed prompt will be short and generic:

1. Extract the biological world model from the current AnalysisInput.
2. Keep species and biological types separate; type names are open strings and
   describe sex/reproductive classifications or directly reproductive classes.
3. Analyze each capability/rule/lifecycle/special rule independently and use
   null when the current material does not support a field.
4. Apply ordinary Human Male/Female baseline only after those Human types are
   supported; do not create missing types or use that baseline for non-Humans.
5. Keep evidence local to the current species and biological type.
6. Use fertilization only for real gamete/fertilization mechanisms.
7. Emit only the fixed v1 object.

No named fantasy species, type, alias or world-specific example appears in the
production prompt.

## Analyzer responsibilities

### Structural normalization

- Parse JSON candidates and require schema version 1.
- Normalize nullable strings/booleans/lists and localize only standard Human
  labels already supported by the product.
- Copy only the fixed schema keys, so unknown capability keys never persist.
- Keep the generic parent species/type duplicate predicate; it compares the
  current names and generic suffixes, not a dictionary of species.

### Evidence guard

- Identify evidence units from the same text that is sent in the World Model
  request.
- Use exact current species name matching; never resolve aliases for a known
  fantasy species.
- Keep standard male/female, dual, sperm/ova, fertilization, pregnancy,
  lifecycle and explicit-negative evidence patterns because they enforce
  deterministic field boundaries.
- For non-Human types, every field uses evidence units containing the current
  species and current biological type. There is no `typeCount === 1` fallback.
- A type or species not evidenced by the current input is removed from the AI
  result; manual edits continue to use structural normalization only.
- A temporary state, individual exception, species name, or generic subtype
  label cannot become a biological type.

### Human baseline

Human is the only built-in biological knowledge exception. The guard first
requires ordinary-human evidence and evidence for the requested Human type.
For an established Human Male/Female type, explicit local evidence wins;
missing applicable fields fall back to the matching ordinary-human baseline.
Human custom types remain evidence-based and do not receive this fallback.
No baseline creates a missing species or type.

### Final consistency

Retain the final guard after evidence filtering:

- `can_produce_ova === false` clears `ovulation`.
- `can_carry_pregnancy === false` clears pregnancy/carrying, gestation and
  labor rules.
- A fertilization description conflicting with a known false recipient/donor
  capability is cleared.
- Unknown (`null`) capability never clears an evidence-backed rule.
- Non-mechanism interaction text is not a fertilization rule.

## UI regression

`ui/world.js` already maps all species and all biological types through
`renderSpeciesSelector` and `renderSelectedTypeDetail`. Add a test containing
Human Male/Female and an original species with one type; assert all three
buttons/cards are present. No Human renderer or special branch is introduced.

## Documentation/spec synchronization

Update only the World Model passages that currently describe named fixture
species as product behavior. Keep documentation phrased in terms of arbitrary
species and shared structure. Do not rewrite static reference prototypes that
are not imported by runtime code.

## Risks and mitigations

- Over-filtering Human: tests cover Human Male-only, Female-only, custom type,
  both types, and explicit male pregnancy override.
- Non-Human leakage: tests use original names and only local evidence; no test
  relies on a known fantasy name.
- Schema drift: tests assert unknown capability keys are removed and the same
  five keys exist for Human and Nonhuman types.
- Accidental scope expansion: final diff and consumer search must show no
  Event/State/Projection/UI architecture changes.

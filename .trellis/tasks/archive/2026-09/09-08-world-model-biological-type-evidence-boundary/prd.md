# World Model biological type evidence boundary correction

## Goal

Make World Model classification evidence-bound and two-step:

```text
species -> biological_types -> capabilities
```

The result must record only species and sex/reproductive classifications that
the current `AnalysisInput` actually supports, while keeping the existing
AnalysisInput, request, Chat-local persistence, refresh, and UI lifecycle
working unchanged. Human biological baseline may fill physiology only after a
human type has been established; fantasy species remain unknown unless their
own evidence or an explicit human-equivalence rule supports a value.

## Background and confirmed evidence

- The repository already has the required nested payload in
  `storage/schema.js`, `ai/analyzer.js`, and `ui/world.js`. The old flat
  top-level `biological_types` contract must stay rejected.
- The current core prompt in `ai/prompts.js:13-19` describes the two-step
  relationship, but still uses `双性/间性`, has conflicting capability/baseline
  wording, and does not distinguish a fixed type from temporary body
  modification, individual ambiguity, identity, or subtype.
- The current analyzer in `ai/analyzer.js:23,150-171` treats any occurrence of
  `双性` or `间性` as fixed-type evidence. The attached input contains a
  temporary Jin Dan `双性化` rule, so the current guard can preserve the bad
  AI type. The attached output also demonstrates the observed misclassifications:
  `性别模糊`, `妖修`, `半兽人`, `魔族`, `男性剑灵`, `女性剑灵`, `妖剑剑灵`,
  and `魔剑灵`, plus an unknown about `双性/间性个体`.
- The attached input explicitly says `剑灵性别：基本都为男性，极少女剑灵`
  and separately describes `妖剑`/`魔剑` attributes. It also says Jin Dan
  `双性化` is temporary for 1–3 days. These are evidence examples, not
  development instructions.
- The World page currently renders the type heading as
  `生物学 / 生殖类型` (`ui/world.js:107-137,202-227`); user-visible wording
  must become `性别 / 生殖类型`, with `双性` as the canonical name and
  `未知` for null-like values.

## Requirements

### R1. Preserve the nested, lightweight contract

- Keep `species[] -> biological_types[] -> capabilities`.
- Keep type names as open strings. Do not add an enum, a gender matrix, ABO
  combinations, or a new ontology.
- Keep capabilities only under the individual biological type. Never create a
  species-level aggregate capability object.
- Keep the existing AnalysisInput construction, API message roles, Chat save,
  World Model refresh/failure behavior, and unrelated modules untouched.

### R2. Make species and biological type recognition independent

- `species` means a species, race, kind, or special life category. It may
  contain `人类`, `妖`, `魔`, `剑灵`, `精灵`, `兽人`, or a source-defined
  equivalent.
- `男性`, `女性`, `双性`, `Alpha`, `Beta`, `Omega`, `无性`, and other
  sex/reproductive classifications are never species merely because they are
  recognized first.
- Default human fallback remains allowed when ordinary human sex/body/
  reproductive/social evidence exists and no explicit non-human evidence is
  present. Recognizing `人类` never creates a type by itself.
- A type is created only when this `AnalysisInput` contains the type or an
  explicit species/world rule establishes that the classification exists.
  Therefore one male evidence produces `人类 -> 男性`; male plus female
  evidence produces both; absent types are not filled for completeness.
- A species with no supported type has `biological_types: []`.

### R3. Restrict the meaning of `biological_types`

`biological_types` is specifically the sex, reproductive sex, or directly
reproductive classification layer for its parent species. Do not classify
species, subspecies, bloodline, occupation, cultivation identity, sect,
faction, origin, attribute, body form, temporary body state, body
modification, personality, sexual preference, or an individual-only trait as a
type.

The following attached-regression examples must not be types:

- `性别模糊` from one named person;
- `妖修` and `半兽人` under `妖`;
- `魔族` under `魔` when it repeats the species identity;
- `妖剑剑灵` and `魔剑灵` under `剑灵` when they describe source/attribute/
  subtype.

For `剑灵性别基本都为男性，极少女剑灵`, use `剑灵 -> 男性、女性`.
Prefer `男性`/`女性` over redundant `男性剑灵`/`女性剑灵` unless the source
explicitly defines the longer phrase as a formal classification.

### R4. Separate fixed `双性` from temporary modification and canonicalize its name

- BioWeave's default visible name is `双性`; never generate or display
  `双性/间性` as a composite alias.
- `可以双性化`, a temporary body modification, a transformation ability, or
  a single ambiguous body state is not evidence that a fixed `双性` type
  exists.
- Create `双性` only when the input explicitly supports a fixed individual,
  species classification, or world rule. If the source distinguishes another
  independent category, preserve that source-defined meaning rather than
  inventing a synonym.
- Temporary modification rules remain in an existing rule/`special_rules` or
  species description location selected by the prompt. They must not be
  reintroduced through `unknowns`.

### R5. Apply human baseline only after human type recognition

- For an established `人类` type, ordinary human reproductive capabilities and
  baseline rules may be used when the current world/story does not override
  them. This can include normal sperm/ova relationships, fertilization,
  cycle/ovulation, approximately 40-week gestation, labor, and ordinary
  lifecycle rules.
- Precedence is: explicit story fact > explicit world/worldbook rule >
  explicit individual exception > ordinary human baseline. A world rule such
  as three-month human gestation overrides 40 weeks; one person's deviation is
  an exception, not a species-wide rewrite.
- Baseline is not a reason to create a missing type. It applies only to types
  actually established by evidence.
- For `妖`, `魔`, `剑灵`, `精灵`, `兽人`, and other fantasy/non-human species,
  do not infer human capabilities, cycle, gestation, or fertilization from a
  humanoid appearance, a male/female label, sex, intercourse, or pregnancy.
  Missing evidence remains `null`/`未知`.
- A non-human type may inherit only the specific human baseline portions that
  the input explicitly says are the same.

### R6. Keep capability decisions local and evidence-based

- Evaluate each capability independently as `true`, `false`, or `null`.
- Human baseline may support ordinary human capability values after R5.
- Non-human capabilities require explicit source/story evidence or an explicit
  supported human-equivalence statement. Never infer them from a type name.
- Do not merge different types' capabilities onto their species.

### R7. Keep unknowns semantically closed

- `unknowns` may describe an established species/type or a known rule whose
  mechanism is not yet known.
- `unknowns` must not introduce a type that was rejected or never established.
  For example, if only temporary `双性化` exists, do not emit an unknown about
  `双性/间性个体` capability.

### R8. Prompt, validator, UI, documentation, and tests

- Rewrite the World Model core/output prompt coherently; remove conflicting
  old wording instead of appending a second rule set.
- Keep schema shape/open names and structural validation. Add only a small
  analysis-result semantic guard for evidence boundary, canonical naming,
  redundant species-context names, and the directly observed regression
  aliases; do not turn the validator into an exhaustive ontology.
- Update World page labels and empty states to `性别 / 生殖类型`; keep Chinese,
  day/night/Tavern theme behavior and responsive layout.
- Update World Model docs and the project World Model contract spec.
- Add focused tests for all fourteen user-required scenarios, including the
  attached regression, and preserve existing request/persistence/UI tests.

## Acceptance Criteria

- [x] The normalized/AI-analyzed model has no top-level `biological_types` and
  no species-level aggregate `capabilities`; every type capability stays
  nested under its parent species.
- [x] Only male evidence yields exactly `人类 -> 男性`; human recognition does
  not add `女性` or `双性`.
- [x] Male plus female evidence yields exactly `人类 -> 男性、女性`.
- [x] Temporary `双性化` alone yields no `双性` type, while the temporary rule
  remains representable as a special/body-modification rule; fixed explicit
  `双性` evidence can yield `双性`.
- [x] `双性/间性` is not emitted as BioWeave's standard name, and UI/model
  display uses `双性`.
- [x] A single person's `性别模糊` does not create a world type.
- [x] `妖修`, `半兽人`, `魔族`, `妖剑剑灵`, and `魔剑灵` do not become
  biological types; the parent species may remain with an empty type array.
- [x] `剑灵性别基本都为男性，极少女剑灵` yields `剑灵 -> 男性、女性`, not
  redundant or attribute types.
- [x] Ordinary human evidence allows human baseline values, but an explicit
  human world rule overrides them and an individual exception does not rewrite
  the species baseline.
- [x] Non-human types without reproductive-mechanism evidence keep capability,
  cycle, and gestation values unknown; explicit “physiology is the same as
  humans” can fill only the supported portions.
- [x] An ABO-style source preserves open `Alpha`/`Beta`/`Omega` types without
  generating sex/type combinations.
- [x] Unknowns do not mention an unestablished/rejected biological type.
- [x] World UI shows `物种`, `性别 / 生殖类型`, `生殖能力`, and `未知` for
  null-like values without changing theme/responsive behavior.
- [x] Existing World Model tests plus the full repository checks pass, and no
  AnalysisInput/API/Chat save/refresh or unrelated module is changed.

## Out of scope

- AnalysisInput construction, Character Card/Worldbook selectors, Recent
  Story, external memory, API profiles, secrets, Chat-local storage, Floor
  Version, UI Host, events, states, Projection, Genealogy, or other BioWeave
  modules.
- A comprehensive sex/gender ontology, multidimensional ABO model, character
  state system, event inference, or future-world projection changes.

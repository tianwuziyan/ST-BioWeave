# Technical design

## Boundary and data flow

Keep the existing World Model path and change only the semantic contract at
the prompt and AI-result boundary:

```text
AnalysisInput
  -> buildWorldModelMessages()
  -> provider response
  -> parseWorldModelResponse() / structural normalizer
  -> analysis-only evidence guard
  -> existing Chat-local World Model save
  -> worldPage()
```

Manual editor loads/saves continue to use `normalizeWorldModel()` for shape
normalization. The evidence guard runs only for an AI analysis result, where
the current `AnalysisInput` is available. This preserves intentional manual
edits and avoids pretending that a schema validator can understand arbitrary
fictional terminology without source evidence.

## Prompt contract

Rewrite `WORLD_MODEL_CORE_INSTRUCTIONS` and the output contract as one coherent
set of rules, in this order:

1. Identify `species` independently from its child `biological_types`.
2. Apply the default-human fallback only to species recognition.
3. Define biological types as sex/reproductive classifications with open names.
4. Exclude identity, race/subrace, source/attribute, body shape, temporary
   modification, and individual-only descriptions.
5. Require fixed evidence for `双性`; explicitly distinguish it from
   `双性化`/temporary modification and use only `双性` as BioWeave's default
   name.
6. Evaluate each nested capability separately.
7. Apply human baseline only after an established human type, with explicit
   story/world/individual overrides taking precedence.
8. Keep non-human physiology unknown unless directly evidenced or explicitly
   stated to match a specific human baseline portion.
9. Keep `unknowns` closed over already-established types and rules.
10. Emit the unchanged nested JSON shape.

The prompt will use the attached cases as compact positive/negative examples:
male-only, male+female, temporary dualization, fixed dual type, ambiguous
individual, `妖修`/`半兽人`, species-only `魔`, the sword-spirit sex rule, and
`妖剑`/`魔剑` subtypes. It will not add an ontology or a type enum.

## Structural schema and normalizer

`storage/schema.js` keeps the same template and keys. `ai/analyzer.js` keeps
the existing strict checks for:

- schema version and required arrays;
- rejection of top-level `biological_types`;
- rejection/removal of species-level aggregate capabilities;
- nullable capability/rule values and open string type names.

The normalizer will add only canonical text handling for the exact composite
alias `双性` (including spacing/slash variants), so saved/displayed
BioWeave content uses `双性`. Plain source-defined `间性` is not globally
rewritten when the source clearly treats it as an independent category.

## Analysis-only evidence guard

Add one small, centralized guard after response parsing and before the result
is returned from `analyzeWorldModel()`. It will reuse the existing
`worldModelEvidenceText()` source boundary, so persona/private UI data cannot
become World Model evidence.

The guard has four deliberately narrow responsibilities:

### 1. Fixed-type evidence, not substring matching

Replace the current broad `双性`/`间性` substring test with two checks:

- fixed evidence: explicit individual/species/world wording such as
  `双性个体`, `存在双性`, `角色本身是双性`, or an explicit type/classification
  statement;
- temporary evidence: `临时双性化`, `可以双性化`, body modification, or a
  stated duration/disappearance.

If fixed evidence is absent, remove an AI-returned `双性` type and remove an
`unknowns` entry that claims the capabilities of a non-existent fixed
`双性`/`双性个体` type. A known temporary rule remains when the model places it
under an existing species/type `special_rules` or description as instructed by
the prompt.

### 2. Ground the familiar human labels

For the analysis result only, standard `男性`/`女性`/`双性` candidates are
kept only when their corresponding fixed evidence exists. The evidence helper
recognizes the existing Chinese ordinary-human wording (`男人`/`女性`/`男孩`,
etc.) needed by the default-human rule. This prevents an AI response from
turning a male-only input into a complete male/female/dual list while still
allowing the sword-spirit rule to keep both `男性` and `女性`.

Open names remain accepted by the structural validator. The analysis guard
does not enumerate all possible world types; it only grounds the familiar
labels and the observed regression aliases. Prompt evidence remains the main
semantic mechanism for arbitrary open-world names such as `Alpha`/`Omega`.

### 3. Remove redundant or directly observed non-biological aliases

Normalize a sex label redundantly suffixed with its parent species (for
example, `男性剑灵` -> `男性` under `剑灵`). Drop only the small set of direct
regressions demonstrated by the supplied output (`性别模糊`, `妖修`, `半兽人`,
`魔族` when it repeats `魔`, `妖剑剑灵`, and `魔剑灵`). Also drop a type that
is exactly the parent species label. This is a safety net for the observed
failure, not a closed list of valid biological types.

The guard does not try to infer where arbitrary discarded prose belongs. The
prompt tells the model to retain source/attribute and temporary rules in
species descriptions or existing `special_rules`; the guard only prevents
those values from occupying the biological-type slot.

### 4. Keep capabilities local

The guard never fills capability or rule values from a type name. It only
preserves the normalized `true`/`false`/`null` values returned by the model.
Human baseline permission and non-human uncertainty are expressed in the
prompt; explicit response evidence remains authoritative.

## Human baseline versus fantasy unknowns

The prompt will encode the precedence explicitly:

```text
story fact > world/worldbook rule > individual exception > human baseline
```

The baseline is available only for a recognized human type. A non-human type
with a Chinese `女性` name still has `null` capabilities/cycle/gestation until
the input describes those mechanisms. A statement such as “生理结构与人类
基本一致” enables only the explicitly supported baseline fields. Tests will
assert both the no-inheritance and partial-inheritance cases.

## UI and documentation

- Change only World page labels/empty states from `生物学 / 生殖类型` to
  `性别 / 生殖类型`; keep nested rendering, editor actions, Chinese labels,
  null-to-`未知`, theme tokens, and responsive classes unchanged.
- Update `docs/UI.md`, `docs/DATA-MODEL.md`, and the existing World Model
  section in `.trellis/spec/frontend/state-management.md` to describe the
  evidence boundary, human baseline precedence, non-human unknowns, and the
  canonical `双性` wording.

## Compatibility and rollback

- No schema version or persisted key changes are required.
- Existing nested saved models remain readable; canonical text normalization
  affects only the obsolete composite visible label.
- If the semantic guard is too aggressive in a real-world test, it can be
  reverted independently from the prompt because it is a single analysis
  boundary function; structural normalization and Chat/UI paths remain
  unchanged.
- Manual edits remain recoverable because they continue through the existing
  normalized draft/save path and are not subjected to source-evidence cleanup.

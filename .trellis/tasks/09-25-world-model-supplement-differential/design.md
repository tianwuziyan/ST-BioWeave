# Technical Design

## Boundary and data flow

Keep the existing runtime boundary:

```text
permitted World Analysis evidence set
  + Full: buildWorldModelMessages -> complete model
  + Patch: formatWorldModelPatchReferences(existing baseline + same evidence)
          -> World Fact Discovery / scope / classification
          -> baseline-aware consolidation / Candidate Patch
          -> deterministic safety validation
          -> mergeWorldModelPatch(existing, patch)
          -> complete-model consistency / strict canonical validation
          -> Floor persistence
```

`runtime/world-analysis.js` remains responsible for resolving the validated
Existing World Model and passing it only to the Patch analyzer input. Full
analysis continues to pass the original evidence input without a World Model
reference.

## Prompt boundary

Add a Patch-only formatter that prepends the validated `input.world_model`
baseline to the existing World Analysis references. Do not add the baseline to
`formatWorldModelReferences()` or the Full builder. The Patch rules, output
contract, and final user instruction will describe World Fact Discovery,
Individual versus World scope, knowledge outlets, compatible consolidation,
explicit world-level correction, previously missed evidence, newly available
evidence, unchanged omission, and unsupported removal.

## Patch evidence boundary

The current Patch path now performs canonical Existing/Candidate comparison
and changed-fact evidence validation. `validateWorldModelPatch()` preserves
the Raw medical field presence boundary, and `mergeWorldModelPatch()` applies
the shared complete-model consistency finalization before strict canonical
validation. AI remains responsible for semantic discovery, scope and outlet
classification, compatible consolidation, and correction proposals;
deterministic implementation compares canonical Existing versus Candidate only
for safety, classifies `UNCHANGED` / `ADD` / `CHANGE` / `REMOVE`, validates each
changed world-level fact against permitted evidence, and rejects knowledge
weakening and unsupported sibling piggyback. It may reject clearly incompatible
or explicitly individual-bound support where the existing evidence structure is
reliable, but it does not claim complete narrative scope inference or become a
second natural-language parser. It must not call the Full model guard on the
sparse DTO.

`update.species` is a complete updated canonical Candidate, while
`update.medical_context` is a sparse field update whose absent Raw fields mean
UNCHANGED. Complete-model defaults must not erase this presence distinction.

The guard will reject unsupported proposed canonical entries with the existing
Patch invalid error family, while allowing an empty Patch and evidence that is
older than the current Floor. Deterministic merge remains the authority for
update target identity and complete-model validation remains the authority for
the final canonical shape.

Projection Rule update identity remains a separate contract gap because the
current generated identity depends on mutable rule content. This task does not
redesign that identity.

Semantic Delta is a safety layer, not a replacement for World Fact Discovery,
scope interpretation, outlet classification, compatibility reasoning, or
world-level correction judgment. The deterministic layer validates the
Candidate proposed by AI; it does not infer whether an NPC represents a whole
population.

`CHANGE` requires current permitted evidence that directly establishes the
Candidate world-level fact at a scope compatible with the Existing rule and
semantically conflicts with or replaces that Existing value. No special
correction wording is required. Individual-only evidence, ambiguous scope,
mere mention of the new value, or Existing baseline text alone cannot support
the change; no correction keyword list may be introduced.

The required regression scenarios A-N are recorded in `implement.md` and cover
scope, compatible consolidation, correction, exception/unknown/medical
boundaries, older evidence, unsupported piggyback, unchanged knowledge,
knowledge weakening, sparse presence, and final consistency consequences.

## Compatibility and rollback

No schema or storage ownership changes. Existing Full message order remains
unchanged. Existing Patch merge/remove behavior remains unchanged. If the new
guard proves too restrictive for a legitimate current contract, revert only
the guard and its tests while retaining the isolated Patch reference formatter
and prompt contract corrections.

# Technical Design

## Boundary and data flow

Keep the existing runtime boundary:

```text
permitted World Analysis evidence set
  + Full: buildWorldModelMessages -> complete model
  + Patch: formatWorldModelPatchReferences(existing baseline + same evidence)
          -> sparse patch validator/evidence guard
          -> mergeWorldModelPatch(existing, patch)
          -> complete canonical validation
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
contract, and final user instruction will describe differential comparison,
previously missed evidence, newly available evidence, explicit correction,
unchanged omission, and unsupported removal.

## Patch evidence boundary

The current Patch path has no evidence guard: `validateWorldModelPatch()` only
normalizes sparse structure and `mergeWorldModelPatch()` only validates the
merged canonical shape. Add a generic Patch-specific evidence guard after JSON
parsing/structural validation and before returning the Patch. It will evaluate
only proposed add/update entries against the same `evidenceUnits()` derived
from the permitted World Analysis input, while preserving sparse semantics and
not treating omitted fields as negative evidence. It must not call the Full
model guard on the sparse DTO.

The guard will reject unsupported proposed canonical entries with the existing
Patch invalid error family, while allowing an empty Patch and evidence that is
older than the current Floor. Deterministic merge remains the authority for
update target identity and complete-model validation remains the authority for
the final canonical shape.

## Compatibility and rollback

No schema or storage ownership changes. Existing Full message order remains
unchanged. Existing Patch merge/remove behavior remains unchanged. If the new
guard proves too restrictive for a legitimate current contract, revert only
the guard and its tests while retaining the isolated Patch reference formatter
and prompt contract corrections.

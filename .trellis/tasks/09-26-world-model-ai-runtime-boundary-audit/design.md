# World Model Supplement 协议重构设计

## 最终数据流

```text
permitted evidence + Existing canonical World Model
  → deterministic Existing World Model Reference Text
  → Supplement AI
  → Sparse Hierarchical Candidate Text
  → deterministic hierarchical parser
  → Sparse Candidate Object
  → Existing canonical World Model
  → deterministic comparison
  → internal Patch v2
  → existing validation / classification / Evidence Guard
  → existing merge
  → final consistency
  → strict canonical World Model JSON
  → Floor persistence
  → existing resolver / view-model / UI
```

## Protocol design

- Opening and closing tags are the only ownership signals.
- Parser state is a stack of `WorldModel`, `Species`, `BiologicalType`, detail section and collection item frames.
- Indentation and whitespace are presentation only.
- Unknown tags are rejected at the smallest affected section; no fuzzy alias correction.
- Missing identity or parent ownership rejects the affected Species/Type subtree.
- Missing closing tag before a new Species is a structural conflict; do not implicitly close or re-parent.
- Duplicate scalar semantic identity fails closed; never last-write-wins.
- Leaf invalid values can be rejected while retaining other fields whose parent chain is unambiguous.

## Candidate semantics

Candidate is sparse and presence-sensitive:

- absent field = no claim;
- boolean fields accept only explicit `true`/`false`;
- no evidence = omission, not null and not false;
- empty collection does not clear Existing and is not a removal instruction;
- `[Unknown]` is only for a world-level unresolved proposition;
- Candidate is never persisted or sent to UI.

## Boundary preservation

- Existing remains in the Supplement user Target and formatter output, but is excluded from evidence units.
- Patch v2 remains internal and is generated only after Candidate/Existing comparison.
- Existing patch validator, classification, Evidence Guard, merge, projection identity, consistency guard and canonical validation remain the final mutation boundary.
- Floor persistence continues to write only complete `world_model` / `world_model_meta` through the existing coordinator.
- UI continues to read only `resolveWorldModelAtOrBefore()` and `buildWorldModelViewModel()`.

## Known non-goals

Full, Event, Character, Pregnancy Tracking, Human baseline, storage/UI schema and system_top/system_bottom are not redesigned.

# Technical Design

## Ownership and data flow

```text
active Health observations
  -> core/health-aggregation.js
  -> character.severity_summary (presentation-only read-model field)
  -> ui/characters.js healthViewModel()
  -> existing Character Health "总体状态" badge
```

`core/health-aggregation.js` remains the owner because it already owns
presentation-only grouping of active observations. Add one small pure function
for the fixed severity ranking and include its result while building each
character's derived read model. Do not add severity to `grouped_issues`; the UI
does not need per-issue severity and the existing grouped contract should stay
narrow.

## Contract

- Core output: `severity_summary: "normal" | "unknown" | "mild" | "moderate" | "severe"`.
- `normal` means the character has no active Health observation in the derived
  read model; it is not a persisted healthy fact.
- `unknown` means at least one active Health observation exists but none has a
  known mild/moderate/severe severity.
- Ranking ignores inactive observations because they are absent before
  aggregation.
- Invalid/missing observation severity is treated as `unknown` at this
  presentation boundary; no source Assessment is rewritten.

`ui/characters.js` only maps the core value to Chinese display text. For
backward-compatible read models without `severity_summary`, a character with
valid issues falls back to “有健康问题”; a ready state without a character
entry remains “正常”. Unavailable read-model state continues to win over all
summary values.

## Compatibility and boundaries

- No persistence schema, Event payload, Assessment schema, fingerprint, request
  key, lifecycle, Snapshot, Projection or runtime API change.
- No new AI request or runtime orchestration hook.
- No UI CSS/framework change is needed; the existing overview badge is reused.
- Existing `current_health_summary` remains untouched and is not renamed or
  repurposed.

## Verification and rollback

Test pure aggregation and evolution output first, then UI mapping against both
new and legacy read-model shapes. If the UI contract or existing fixtures reveal
that adding the field changes an unrelated read-model equality expectation,
adjust only the new presentation field assertions/fixtures; do not broaden the
change into generic state or persistence code.

# Technical audit design

## Comparison anchors

- Baseline: `a8030e285936f7101f879aa7129369c2595b2dbf`
- Current: checked-out `fix/world-model-prompt-baseline`
- Evidence: actual source, commit history, targeted diffs, tests/diagnostics, and the supplied real-host Trace facts.

## Audit paths

1. Prompt semantics: compare named Event prompt constants/builders and classify changes by discovery, identity, registry, biological context, symptoms, and pregnancy evidence.
2. Event pipeline: raw AI response -> parse -> validation -> identity resolution -> canonical Event -> registry/analysis persistence -> authoritative readback.
3. Character pipeline: authoritative readback -> active business data/current Floor states -> business data -> canonical Character state -> UI model/readiness.
4. Regression attribution: inspect commits touching the named diagnostics and builders, then use common-base behavior rather than version labels.

## Invariants

- Registry identity references do not automatically constitute active Character UI entries; current valid Floor-derived facts and the established tracking/business-state contract determine UI eligibility.
- `snapshot` and `projection_timeline` are derived/projection inputs only when their owner and Floor validity rules allow them.
- Persistence code remains read-only audit scope unless direct evidence proves it is the cause, which the user has expressly asked not to assume.

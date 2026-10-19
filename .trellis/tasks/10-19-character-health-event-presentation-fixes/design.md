# Technical Design

## Boundary and data flow

The change stays at the existing owners:

```text
Event prompt → AI Event parser → canonical Event runtime
                         ↓
              Health Assessment eligibility → Health Evolution/Aggregation → Character UI
```

The popup change is presentation-only and keeps the current Character page
rendering and delegated actions.

## Design decisions

### 1. Health popup menu

Keep the existing `details`, `data-bioweave-action`, `aria-controls`, and
outside/Escape handlers. The health popover remains the high-level stacking
context above ordinary Event content. The multiple-source menu becomes a
normal in-flow child of the scrollable health popover instead of an absolutely
positioned child that can extend beyond and be clipped by the popover. Give the
health popover/source menu the documented presentation z-index while preserving
the existing Desktop/iPad and Mobile placement rules.

This solves the actual failure mode (ancestor overflow clipping) without a
second modal or a JS-positioned portal.

### 2. Non-health Event boundary

Add one Event-domain helper in `core/events.js` for the AI/parser and Health
eligibility boundary. `other_biological` is accepted for the AI path only when
its factual `kind` is in the explicit health-fact vocabulary and its
`health_role` is a valid health role. Other Event types keep their existing
contracts.

`parseEventAnalysisResponse()` still validates the full shape, then drops
non-health `other_biological` records from the normalized `events` array. This
allows a response containing only `sword_resonance` to become `events: []`,
while a response containing a valid fracture observation remains valid. The
same helper is used by `healthAssessmentEligibility()` so an already stored
invalid catch-all fact cannot create a new Assessment or Current Health item.

The prompt explicitly forbids spiritual/energy resonance, sword or artifact
effects, ability awakening, relationship changes, ordinary delivery and other
non-physiological narrative from becoming Events. No Floor data owner or
historical Event migration is added.

### 3. API/UI body-site presentation

`core/health-recovery-guidance.js` remains the single formatter for the API
recovery prompt. It will add a laterality label only when the factual
`body_site` does not already contain the same side label. The factual field and
structured `laterality` remain unchanged.

`ui/characters.js` will treat a derived `display_site: general` with no factual
`body_site` as the presentation label `全身`. If both fields are absent it
keeps the conservative unknown label. This aligns UI with the existing API
formatter without inferring or writing a body site into the Event.

## Compatibility and rollback

- Existing Event IDs, source envelopes, Floor ownership, Assessment storage,
  aggregation keys, and source navigation remain unchanged.
- Existing legitimate `physical_symptom`, `medical_event`, and explicit
  fracture-style `other_biological` facts remain accepted.
- Previously saved non-health Events are not silently rewritten. Re-analysis
  through the corrected parser replaces the current Floor result; a separate
  lifecycle/migration task is required for bulk cleanup.
- Rollback is limited to the changed parser/eligibility helper, formatter,
  UI mapping, CSS, tests, and synchronized docs; no data migration is needed.

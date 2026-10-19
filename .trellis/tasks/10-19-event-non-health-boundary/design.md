# Technical Design

`core/events.js` remains the owner of Event payload semantics. Add a small
explicit health-fact vocabulary and helper there; do not add a new module or a
new persistence field. The AI parser in `ai/analyzer.js` normalizes each raw
Event, then removes only `other_biological` facts that fail the helper. A
response may therefore validly normalize to an empty `events` array.

`healthAssessmentEligibility()` calls the same helper for
`other_biological`, so a legacy invalid fact fails closed for Assessment and
Current Health reads. `physical_symptom`, `medical_event`, reproductive facts,
and existing valid fracture-style `other_biological` records retain their
current paths.

`ai/prompts.js` receives an explicit semantic boundary and examples of
non-health narratives that must not become Events. This is defense in depth;
the parser remains authoritative for the verifiable contract.

No historical Floor migration is performed. Re-analysis produces the corrected
current Event collection under the existing owner/version path.

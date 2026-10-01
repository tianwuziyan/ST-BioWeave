# Human Pre-confirmation Projection Timing Baseline — Research Note

Status: research record plus approved product-policy boundary. The evidence
below does not establish a medical production default or authorize medical
claims. The separately approved BioWeave v1 Human narrative preset is recorded
at the end of this note.

## Scope

The product question is not when pregnancy is factually confirmed. It is when,
after a pregnancy-relevant exposure, a non-factual possible-development
Projection may become worth considering. The medical literature uses different
anchors, such as ovulation, fertilization, implantation, expected menses, and
gestational age. Therefore those sources cannot be copied directly into a
BioWeave exposure-anchored Story Time default.

## Evidence

- A prospective human study found first detectable chorionic gonadotropin in
  ongoing pregnancies 6–12 days after ovulation; 84% implanted on days 8–10.
  This is evidence about implantation/hCG timing relative to ovulation, not a
  universal interval from an arbitrary exposure. [Wilcox et al., NEJM/PubMed](https://pubmed.ncbi.nlm.nih.gov/10362823/)
- NHS states that early pregnancy signs commonly begin around 4–6 weeks of
  pregnancy, and that symptoms vary between pregnancies. This supports using
  symptoms as a later, non-universal narrative possibility rather than a fixed
  early trigger. [NHS: signs and symptoms](https://www.nhs.uk/pregnancy/trying-for-a-baby/signs-and-symptoms-that-might-mean-youre-pregnant/)
- Mayo Clinic states that home pregnancy tests are more likely to be accurate
  after the first day of a missed period. It also explains that implantation
  timing and ovulation timing affect when hCG becomes detectable. [Mayo Clinic:
  home pregnancy tests](https://www.mayoclinic.org/healthy-lifestyle/getting-pregnant/in-depth/home-pregnancy-tests/art-20047940)
- Cleveland Clinic describes implantation bleeding as variable and usually
  occurring about 10–14 days after ovulation, while noting that not everyone
  experiences it and that it is not equivalent to a confirmation contract.
  [Cleveland Clinic: implantation bleeding](https://my.clevelandclinic.org/health/diseases/24536-implantation-bleeding)

## Design implications

1. The evidence supports a broad biological sequence: exposure may precede
   conception; implantation and hCG production are later; missed-period testing
   is later still; symptoms are variable and often later. It does not support
   one exact exposure-to-Projection interval for every Human case.
2. A BioWeave baseline must explicitly document its anchor assumptions. If the
   factual basis only says “pregnancy-relevant exposure” and does not establish
   ovulation or conception timing, an exposure-to-Story-day mapping is a
   product abstraction, not a directly medical-derived measurement.
3. `variance_ratio`, `variance_cap_story_days`, and
   `total_adjustment_cap_story_days` are product controls for non-mechanical
   narrative timing. They are not medical variance estimates.
4. A default observation window should not create menstrual-cycle simulation,
   ovulation facts, implantation facts, hCG facts, symptoms, conception, or
   pregnancy confirmation. Those remain World/Event/State contracts.

## Research value status

The medical research does not propose production values:

- `base_min_story_days`: NOT_ENOUGH_EVIDENCE for a universal exposure-anchored
  Human value.
- `base_max_story_days`: NOT_ENOUGH_EVIDENCE for a universal exposure-anchored
  Human value.
- `variance_ratio`: PRODUCT_POLICY, not MEDICAL_SOURCE_DERIVED.
- `variance_cap_story_days`: PRODUCT_POLICY, not MEDICAL_SOURCE_DERIVED.
- `total_adjustment_cap_story_days`: PRODUCT_POLICY safety bound; not a medical
  measurement.

Before implementation, product and medical review must choose whether the Human
preset is a deliberately conservative narrative abstraction, or whether the
World Model must first establish a more specific biological anchor. That choice
must not be hidden in Runtime fallback.

## Approved BioWeave v1 product decision

BioWeave v1 uses the following conservative narrative preset for an ordinary
Human character when the authoritative World/character context establishes
Human applicability:

```text
base_min_story_days              = 14
base_max_story_days              = 42
variance_ratio                   = 0.10
variance_cap_story_days          = 3
total_adjustment_cap_story_days  = 3
```

These values are `PRODUCT_POLICY`, `CONSERVATIVE_NARRATIVE_PRESET`, and
`NOT_MEDICAL_SOURCE_DERIVED`. They are not a medical standard, a pregnancy
confirmation interval, an implantation interval, a conception interval, a
symptom guarantee, or a universal exposure-anchored medical mapping. The
variance fields are narrative controls and the total cap is a product safety
bound. The preset is a future-cycle Character Timing Config baseline, does not
create a World Projection Rule, and does not alter an existing frozen Timing
Instance.

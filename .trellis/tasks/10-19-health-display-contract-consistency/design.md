# Technical Design

Keep raw Event facts and structured aggregation unchanged. In
`core/health-recovery-guidance.js`, make the presentation formatter detect a
laterality prefix already present in the factual `body_site` before adding a
localized side label. This fixes API prompt text while preserving the
structured `laterality` field and grouping behavior.

In `ui/characters.js`, use the existing derived `display_site` contract:
`body_site === null` plus `display_site === 'general'` renders `全身`; only a
truly missing display value remains `未标明部位`. No UI-side body-site
inference or Event writeback is added.

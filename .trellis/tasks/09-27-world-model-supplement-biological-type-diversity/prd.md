# World Model Supplement Biological Type Diversity Discovery

## Goal

增强 World Model Supplement 的单次 API Biological Type sibling discovery、完整 coverage accounting 与 review grammar 对齐。

## Requirements

- Treat Identity Discovery Review as an explicit Biological Type sibling scan, not merely a `REVIEWED` acknowledgement; after the first stable Type, continue searching for alternate Types until the permitted evidence is exhausted.
- Keep `Biological_Type` an open string; do not require a minimum canonical type count or introduce sex/gender enums.
- Add deterministic review fields for reported distinct type count and exhaustive additional-type search, while keeping the review metadata transient and non-evidence.
- Cross-check reported identity counts against Existing plus syntactically valid response `Type_Identity` Facts before Evidence Guard; count mismatch fails closed and reuses the existing retry budget.
- Preserve the existing Evidence Guard boundary. Discovery pressure must never create, accept, or authorize unsupported identities.
- When a new Type_Identity Fact is accepted, complete its semantic-surface scan in the same response; recompute coverage targets only for diagnostics/completeness audit, not as a normal second semantic API request.
- Keep completeness, review-time observed identities, and accepted canonical identities as separate diagnostics.
- Expose initial type/search state and discovered, accepted, and rejected sibling diagnostics; count equality is serialization consistency only and never discovery proof.
- Preserve Floor persistence, UI adoption, renderer, debug freshness/read-only architecture, and Full mode.

## Acceptance Criteria

- [ ] Identity Review grammar requires `Distinct_Type_Count` and `Additional_Type_Search: EXHAUSTED` with exact subject accounting and explicit sibling-search diagnostics.
- [ ] Reported/observed/accepted type counts are distinct; count mismatch produces a structured incomplete diagnostic.
- [ ] A one-type evidence set remains valid after exhaustive search; no canonical minimum is introduced.
- [ ] New accepted identities are covered in the same semantic API response; post-response target recomputation is diagnostic only.
- [ ] Existing retries remain limited to malformed/transport or established recovery behavior, not normal semantic expansion.
- [ ] Recent diagnostics include per-subject diversity state and coverage expansion state.
- [ ] Diagnostics distinguish initial canonical Types, search seeded/completed state, discovered/accepted/rejected siblings, and reported/host-observed/accepted canonical counts.
- [ ] Existing multiline, Evidence Guard, completeness, retry, debug, Floor-boundary, and World UI tests remain green.
- [ ] `node --check`, `npm run check`, and `git diff --check` pass; no commit or push is made.

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.

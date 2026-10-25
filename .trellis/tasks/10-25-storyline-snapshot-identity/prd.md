# 简化剧情支线快照人物键与过期校验

## Goal

以人物 subject_id 作为剧情支线快照归属键，移除 snapshot_id 对楼层版本的业务依赖，保留当前 Floor 来源校验并补充旧楼层读取后当前楼层完整写入的回归验证。

## Requirements

- `subject_id`/canonical `character_id` remains the only storyline snapshot
  ownership key within a Chat; `chat_id` remains the Chat scope and is not a
  character identifier.
- Product reads use the nearest valid complete storyline collection at or
  before the endpoint. A previously stored snapshot is a logical state
  baseline, not an immutable write target.
- Any changed collection is written as a complete snapshot to the current
  valid Character Floor and active Swipe. Older Floors are never mutated.
- `created_at_floor_version` remains provenance and stale-write ownership
  metadata, but a persisted storyline snapshot must not require a
  content/revision ID whose value changes merely because the collection is
  rebased to a new Floor.
- Remove `snapshot_id` from business readback and judge-stale comparisons. Use
  the current six-field Floor Version together with the existing subject and
  attempt/request guards for stale protection.
- Preserve branch IDs, delivery receipt IDs, and attempt IDs where they are
  actual domain identities; this task does not replace those identifiers.
- Preserve the existing complete-snapshot, sibling-preservation, rollback,
  explicit-empty/terminated, API route, and message contracts.
- Storyline work for independent subjects may issue API requests in parallel,
  but result consolidation must validate each subject independently. An
  invalid, incomplete, stale, cancelled, or otherwise unqualified result must
  be skipped without preventing other qualified subject results from being
  written; a subject is qualified only when its complete required snapshot
  fields are present.
- Partial consolidation must preserve every already-qualified sibling and
  write only the qualified complete collection to the current valid Floor;
  failures remain diagnosable and must not become persisted storyline state.

## Constraints

- Do not add a Chat-level or Runtime-level storyline state source.
- Do not change the Floor ownership or lifecycle root.
- Do not expose internal IDs to storyline prompt text.
- Do not rewrite historical Floor records or migrate unrelated Projection IDs.
- Keep the patch limited to the storyline core/runtime/storage contract and
  focused tests/docs required by the changed contract.

## Acceptance Criteria

- [ ] A snapshot is keyed and read by `subject_id`; `chat_id` only scopes the
  owning Chat.
- [ ] A snapshot read from Floor N, changed on Floor M, is persisted as the
  complete current-Floor collection on M while N remains unchanged.
- [ ] The old-Floor-to-current-Floor write/readback path no longer raises
  `STORYLINE_READBACK_MISMATCH` solely because the Floor provenance changed.
- [ ] A late judge response cannot overwrite a newer current-Floor state; the
  replacement guard uses current Floor/attempt evidence rather than the
  removed snapshot ID.
- [ ] Existing branch, delivery, rollback, sibling, explicit-empty, and
  terminated behavior remains covered by focused tests.
- [ ] Parallel subject requests do not allow one invalid result to block a
  qualified sibling result, and the resulting current-Floor collection keeps
  all qualified subjects.
- [ ] Relevant architecture/Floor/storyline documentation describes the
  logical-state read plus current-Floor rebase model and no longer presents
  `snapshot_id` as a required business identity.

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.

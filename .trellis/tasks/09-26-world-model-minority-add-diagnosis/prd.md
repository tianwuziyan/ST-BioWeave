# World Model Supplement Patch v2 DTO 设计冻结

## Goal

将已经 review 通过的 Supplement message architecture 与 delta-only Patch
v2 DTO 写成可直接实施的 canonical contract。当前阶段只冻结设计，不
修改 production code、测试或 Runtime。

## Scope

- canonical `.trellis/spec/domain/world-model.md` 冻结 Supplement message role 顺序。
- 冻结 `schema_version: 2` + `operations[]` 显式 delta-only DTO。
- 冻结 canonical identity、SET_FIELD whitelist、ADD/CHANGE semantics、
  collection operation、evidence isolation 与 sparse merge contract。
- 冻结 `ADD_PROJECTION_RULE` 的 raw AI payload，不允许 AI 输出
  `projection_rule_id`。
- 冻结 collection duplicate 的唯一语义：same identity + same canonical
  content = deterministic `NO-OP`；same identity + different content =
  `REJECT`；different identity = `ADD`。
- 冻结 `NO-OP` 为 deterministic validation result，而不是 AI operation。
- 冻结 v1 temporary compatibility 与 staged migration，不静默改变 v1。
- 使用 generic `Species-A` / `Species-B` / `Type-A` / `Type-B` 示例。
- 保持 arbitrary REMOVE、Structural Reclassification、Projection mutable
  identity、Runtime、storage、UI 和架构边界不变。

## Out of scope

- 本阶段修改 production code、validator、merge、Runtime、storage、UI 或 tests。
- 实现 v2 parser/guard/merge、删除 v1 path、修改 Full/Event/Character。
- 真实 fixture hard-code、large deterministic regex semantic classifier、
  arbitrary REMOVE、Structural Reclassification 或 Projection identity 修复。

## Acceptance Criteria

- [ ] canonical spec 包含固定 Supplement role 顺序，Existing 只在 user Target。
- [ ] canonical spec 包含 v2 顶层 DTO、完整 operation set 与 SET_FIELD whitelist。
- [ ] canonical spec 明确 identity、ADD/CHANGE/no-op/REMOVE rejection。
- [ ] canonical spec 明确每个 collection operation 的 dedupe、evidence、merge。
- [ ] canonical spec 明确 projection add 使用 raw AI fields，generated
  `projection_rule_id` 由既有 deterministic path 生成，projection update
  继续 blocked。
- [ ] canonical spec 明确 collection duplicate 的 `NO-OP` / `REJECT` /
  `ADD` 唯一语义，且没有可选实现分支。
- [ ] canonical spec 明确 `NO-OP` 不是 AI operation，整 Patch 全为 no-op
  时不产生 semantic delta。
- [ ] canonical spec 明确 v1 temporary compatibility 与 migration sequence。
- [ ] canonical spec 包含 generic valid/invalid DTO examples。
- [ ] canonical spec 与 task design 列出 implementation regression coverage。
- [ ] 本阶段未修改 production code、tests、Runtime；无 commit/push。

本项目惯例将 `[ ]` 作为 task 最终实施/验收状态；本轮只完成设计冻结，
因此不提前勾选上述 Acceptance Criteria。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.

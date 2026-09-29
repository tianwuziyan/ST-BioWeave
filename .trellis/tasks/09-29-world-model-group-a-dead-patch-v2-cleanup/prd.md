# Phase 5 清理 Group A Dead Patch V2 Compatibility Surface

## Goal

审计并在全部 gate 通过时清理 mergeWorldModelPatchV2 与 applyWorldModelPatchV2EvidenceGuard；保持 current Fact Delta/ Patch V2/ persistence architecture 不变。

## Requirements

- TBD

## Acceptance Criteria

- [ ] TBD

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
# Phase 5：清理 Group A Dead Patch V2 Compatibility Surface

## 目标

重新审计并在 DELETE gate 全部通过时移除 `mergeWorldModelPatchV2` 与
`applyWorldModelPatchV2EvidenceGuard`。本 task 不重新打开 Debug Schema v3，且不改变 current Fact Delta、Patch V2、Snapshot、persistence 或 UI 行为。

## Gate

只有同时证明以下条件才允许删除：

- Full、Supplement、runtime、UI production caller 均为 0；
- 没有 repo evidence 表明它们是 stable public/plugin API；
- 两个函数语义属于旧 raw Patch V2 / second NLP semantic guard；
- current replacement path 已明确；
- 剩余引用只属于 dead-island tests/docs。

任一条件不满足则只返回审计报告，不删除。

## 必须保留

`validateWorldModelPatchV2`、`classifyWorldModelPatchV2`、
`mergeWorldModelPatchV2Classified`、`mergeWorldModelSupplementPatch`、
`applyWorldModelFactDeltaEvidenceGuard`、`applyWorldModelEvidenceGuard`，以及
current JSON Fact Delta production chain。

## 验收

- 完整 repo-wide call/export/public-surface audit 有证据链。
- current production replacement chain 与 prompt contract 不变。
- 若删除，legacy symbols 在 current production/test/spec source 为 0，历史归档可单独报告。
- 删除测试仅限验证 dead API 的测试；不得机械替换为 lower-level merge 测试。
- syntax、focused tests、`npm test`、`git diff --check` 通过或准确报告既有失败身份。

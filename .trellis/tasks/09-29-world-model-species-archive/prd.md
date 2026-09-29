# 实现 World Model Species Archive 生命周期

## Goal

为 World Model 增加 Species 归档、用户排除、还原事务及 Full/Supplement 分析生命周期

## Requirements

- TBD

## Acceptance Criteria

- [ ] TBD

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
# World Model Species Archive / User Exclusion Lifecycle

## Goal

将 World Model 的手动 Species 删除改为可恢复的 Floor-owned Archive 生命周期：删除只移出 active `world_model.species[]`，完整 canonical Species subtree 进入同一 Floor 的 `world_model_meta.archived_species[]`；归档身份同时成为 Full/Supplement World Analysis 的用户排除集合，显式 Restore 后才重新允许分析。

## Confirmed repository facts

- `ui/world.js:106-121` 的 `remove-species` 当前只从 active array 删除，未处理 metadata。
- `ui/app.js:2648-2754` 的集合编辑最终调用 `runtime.saveWorldModel({model, meta})`；这是现有 World save 入口。
- `runtime/world-analysis.js:346-389` 已将 `world_model` 与 `world_model_meta` 作为同一 owner patch 提交给 Floor Persistence Coordinator，不能新增 UI/Floor writer。
- Supplement 输入在 `runtime/world-analysis.js:863-877` 构造，生产 prompt builder 为 `buildWorldModelPatchMessagesV2()`；Full 输入在 `:819-823` 删除 `world_model` 后调用 `analyzeWorldModel()`。
- Fact Delta Host safety boundary 位于 `ai/analyzer.js:4245-4319` 的 `applyWorldModelFactDeltaEvidenceGuard()`；本任务要增加 deterministic archived-identity gate，不恢复旧 semantic Evidence Guard。
- Floor ownership、lifecycle registry、World Model schema 和 UI framework 文档均要求新增持久字段先完成 owner/lifecycle/test/docs 同步。
- 修改前 `npm test` 失败 35 项；baseline identities 已记录在任务日志，失败集中于既有 Prompt 契约、UI 标签与 fixture-specific species 静态检查。

## Requirements

1. 新建独立纯模块 `core/world-species-archive.js`，集中 archive/restore/list/identity/reference/filter/gate domain logic；不读写 Floor。
2. Archive transaction 必须一次性从 active 删除并写入完整 snapshot + `archived_at` + `archived_by: "manual"`；重复 identity deterministic no-op/fail-closed。
3. Restore transaction 必须 collision fail-closed；成功时完整恢复原 subtree，并从 archive 移除。
4. Species UI 增加“归档名单”入口、可关闭的归档视图和每项“还原”；active selector 不显示 archive；手动 Add 遇 archive identity 时明确提示从归档名单还原。
5. Full 与 Supplement 均把 `world_model_meta.archived_species` 转为最小 identity reference；prompt 明确 archive 是 user-owned exclusion，不是 Existing 或 evidence；禁止模型重建/恢复 archive。
6. Supplement Host 在 canonical address resolution / current Fact Delta safety boundary 处拒绝 archived Species 的整个 subtree，诊断码稳定为 `ARCHIVED_SPECIES_EXCLUDED`（或同等当前风格名称）。
7. Full 在 persistence 前 deterministic filter archived identities，不能让违反 Prompt 的模型结果重新写入 active model。
8. Restore 后 exclusion 动态消失；不得新增永久 blacklist 或修改 canonical `world_model` schema、Fact Delta wire schema、Patch v2 vocabulary、Snapshot/Floor Coordinator/Projection/Event 架构。
9. 更新 lifecycle registry、World Model/domain 文档和必要 UI 规范，使 `archived_species` 的 owner、clear、Swipe/Floor、async/failure semantics 可追溯。

## Acceptance criteria

- Archive module tests cover complete subtree preservation, immutability, duplicate archive, exact restore, restore collision, deterministic normalization, and minimal reference.
- UI/integration tests cover archive delete, archive list, restore, add collision UX, active selector isolation, and one `runtime.saveWorldModel({model, meta})` call per transaction.
- Supplement tests prove production `buildWorldModelPatchMessagesV2()` contains archive reference and exclusion semantics; archived identity/type/detail/capability/rule/mechanism Facts are rejected while non-archived facts remain valid.
- Full tests prove archive reference reaches production Full input/prompt and archived species cannot persist, while non-archived species remain unaffected.
- Lifecycle test proves Archive → analysis cannot recreate and Restore → analysis can process again.
- Production prompt proof prints final Supplement and Full messages, showing separate Existing, Permitted Evidence, and Archived exclusion sections.
- Required syntax checks, relevant tests, full `npm test`, and `git diff --check` are run; post-change failures are compared by test identity to the recorded baseline.

## Out of scope

- Permanent deletion of archive entries.
- Changes to canonical World Model schema or JSON Fact Delta/Patch v2 output contracts.
- Changes to Floor Persistence Coordinator, owner whitelist, transaction identity, authoritative readback, Snapshot, Projection, Event, retry, or continuation semantics.
- Reintroduction of semantic/NLP Evidence Guard behavior.

## Open questions

None blocking. Use existing normalized Species identity semantics where available; otherwise the archive module defines the smallest deterministic trim/case-preserving comparison required by current World Model naming behavior.

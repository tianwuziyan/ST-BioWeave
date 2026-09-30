# World Model 归档 Species 永久删除

## Goal

在 World Model →「归档资料」中永久删除一条归档 Species snapshot。此操作只从 `world_model_meta.archived_species[]` 移除目标，不改变 active `world_model.species[]`；合法证据在后续 Full/Supplement 分析中仍可重新发现该 Species。

## Background

- 2026-09-30 审计时 worktree clean，`git diff --stat` 为空，没有旧版 Permanent Delete 未提交修改或无关本地修改。当前 HEAD 已包含 Archive/Restore、canonical Species identity 与归档排除机制。
- `core/world-species-archive.js` 已拥有归档纯变换、meta 归一化、引用构建和排除 gate；`core/world-species-identity.js` 拥有 canonical identity。`ui/app.js` 的现有 World 保存入口是 `runtime.saveWorldModel({model, meta})`。
- `runtime/world-analysis.js` 的 Full/Supplement 在分析启动时读取当前 World metadata，动态构建 archive references；tracking registry 没有缓存 `archived_species`。
- 修改前完整 `npm test`：1090 tests，1055 pass，35 fail；相关 `tests/world-model.test.js` + `tests/ui.test.js`：32 个既存失败。失败名称已记录在 `research/baseline-failures.md`。

## Requirements

1. Domain 仅增加纯函数，按 archive index 或现有 canonical identity 查找并移除目标 entry；不 mutate 输入，保留 active model 与其他完整 snapshot；不存在时返回 `changed: false` 和 `ARCHIVED_SPECIES_NOT_FOUND`。
2. 归档视图的每项在「还原」旁显示「永久删除」，沿用现有 danger 样式、busy disabled 和 `data-bioweave-world-archive-index`；不增加选择状态或新弹窗框架。
3. 删除 handler 保护未保存 section draft，先用现有 `confirmWithPopup` 告知不可从归档还原但后续分析可重新发现。取消不变更状态、不持久化、不刷新 tracking。
4. 确认后恰好调用一次 `runtime.saveWorldModel({model, meta})`；payload 的 active model 与操作前相同，meta 仅少目标归档 entry；保存成功后更新本地状态并保持归档视图打开。失败不得报告成功。
5. 不创建 tombstone、blacklist、`deleted_species` 或 `permanent_deleted_species`；不增加第二 writer；不改 Floor persistence/coordinator、runtime save contract、Analyzer/Prompt、Full/Supplement 排除 pipeline。
6. 同步更新 UI framework 配置、规范、HTML 示例及 World lifecycle/domain 文档，记录归档 snapshot 永久删除语义。

## Acceptance Criteria

- [ ] Domain 测试覆盖输入不可变、其他 snapshot 完整保留、不存在项 no-op、大小写敏感 Species identity 和 Human alias；Archive→Restore 现有测试仍通过。
- [ ] UI render 测试覆盖两按钮、action/index、busy disabled。
- [ ] app 测试覆盖 Cancel 零保存、Confirm 恰好一次保存及 payload、active model 不变、归档项消失且浮层保持打开、无 tracking refresh、保存失败不误报成功。
- [ ] Exclusion lifecycle 测试证明删除前 gate/filter 生效，删除后 reference/gate/filter 不再按归档排除目标；不要求 AI 实际创建 Species。
- [ ] 运行相关 domain/UI/World tests、完整 `npm test`、`git diff --check`，并对全部修改的 JS 文件执行 `node --check`；逐项比较 baseline/current failure identities。
- [ ] 若环境可操作真实 SillyTavern，执行用户指定最小 smoke；否则报告 `Real SillyTavern smoke: NOT RUN`。
- [ ] 最终 diff 不触及 runtime analysis、persistence coordinator、Analyzer/Prompt、Patch V2、Snapshot/Event 基础设施；不 commit、不 push、不 reset/clean。

## Out of Scope

- Floor persistence/readback/coordinator 性能或语义调整，以及 `/api/chats/get` 优化。
- 任何永久禁止 Species 再发现的机制。
- Archive UI 重设计、额外 modal 或归档选择状态。

# 修复 World Model UI adoption 与 Floor persistence 顺序

## Goal

修复 World Model 分析 candidate、UI application state 与 Floor authoritative
reload 之间的职责混淆，使每个成功的 validated candidate 必须先被当前 Chat
的 UI application state 采用并返回 exact candidate acknowledgement，Runtime 才
能调用现有 `saveWorldModel()` / `commitFloorPatch(owner="world")` 流程。

用户可观察结果是：手动 Full/Patch 和自动分析在 World route 未打开时也能更新
application state；旧 Floor reload 不能覆盖较新的 candidate；UI adoption、
revision 校验或 Chat 生命周期失败时不会产生 World Floor 写入。

## Confirmed current behavior

- 当前分支是 `fix/world-model-prompt-baseline`，已有未提交修改仅为
  `ai/prompts.js`，本任务不得覆盖或纳入它。
- `runtime/world-analysis.js:199-256` 的 `saveWorldModel()` 通过
  `commitFloorPatch(..., "world", ...)` 持久化；这是现有 Runtime-owned
  persistence boundary。
- `runtime/world-analysis.js:258-287` 的 `resolveWorldModelUiReady()` 读取
  persisted Floor 并构建 view-model，不能证明某个 analysis candidate 已被 UI
  application state 采用。
- `runtime/world-analysis.js:561-623` 当前 analysis 成功路径先做 canonical
  no-op 判断或 `saveWorldModel()`，再调用 `resolveWorldModelUiReady()`；因此
  persistence 先于 candidate UI adoption。
- `ui/app.js:2439-2558` 的手动 Full/Patch 直接把 `result.model` 写入
  `worldModelState`，但没有 candidate revision、exact ACK 或 Runtime completion
  boundary。
- `ui/app.js:1821-2005` 的 authoritative reload 由
  `worldModelRefreshInFlight`、`worldModelState.loading`、
  `worldModelLastRefreshKey`、`worldModelLoadGeneration` 保护。
- `ui/app.js:4302-4324` 的 `WORLD_ANALYSIS_STATUS_CHANGED(success)` 在 World
  route 上再次触发 `reloadWorldModelFromRuntime()`，形成第二个 UI writer。
- `utils/world-model-debug.js:9-24` 已提供 deterministic
  `stableWorldModelStringify()` / `fingerprintWorldModel()`，本任务复用它。
- `storage/floor-persistence-coordinator.js` 已承担 owner whitelist、版本/Swipe
  protection、sibling preservation、authoritative readback 与
  `FLOOR_TX_CONFIRMED`；本任务不修改该文件。

## Requirements

1. 在 Runtime World analysis ownership boundary 建立 transient candidate revision，
   至少绑定 `execution_id`、candidate fingerprint、Chat identity 与目标 Floor
   version；不得把它写入 Floor transaction key。
2. Analysis 成功后先发布 candidate notification/facade；candidate must not call
   `saveWorldModel()` until UI returns an acknowledgement matching execution and
   fingerprint。
3. `ui/app.js` 增加窄 candidate adoption path：校验 Chat token/execution，normalize
   candidate，构建 view-model，将 exact candidate 与 revision 写入
   `worldModelState`，清理 analysis busy state，记录 trace 并返回明确 ACK。它
   不得读 Floor 或直接调用任何 Floor writer。
4. Candidate adoption 独立于 authoritative reload 的 loading gate；普通 Floor
   reload 仍服务于 route open、Chat/lifecycle、explicit refresh 和 persistence
   reconciliation。
5. Reload 返回时必须检查 Chat token/load generation/较新 candidate revision，旧
   Floor 结果不能覆盖 newer pending/adopted candidate，并记录 suppressed reason。
6. Runtime 收到 exact ACK 后才执行现有 `saveWorldModel()`，保持 canonical no-op
   优化；持久化完成后读取 authoritative Floor，并对比 candidate fingerprint，
   mismatch 必须记录明确 diagnostics。
7. `WORLD_ANALYSIS_STATUS_CHANGED` 收敛为 status/diagnostics/terminal notification
   与必要 reconciliation，不再成为同一 analysis candidate 的第二个 delivery
   writer。
8. 自动分析必须通过相同 candidate notification/ACK 路径，即使 route 不是
   `world` 也能更新 application state。
9. 扩展现有 diagnostics / `recordPersistenceTrace()`，区分 candidate created、
   UI adoption begin/confirmed/rejected、persistence requested/confirmed、
   reconciliation、reload suppression 等阶段；不得把普通 DOM render 当作
   exact candidate adoption。
10. 不修改 Supplement completeness、Evidence Guard、Biological_Type open-string
    语义，不新建第二套 persistence architecture，不修改 coordinator。

## Acceptance criteria

- [ ] T1/T2：candidate adoption 成功后 persistence 才开始；adoption 失败时
      `saveWorldModel` 与 `commitFloorPatch` 均未调用。
- [ ] T3/T4/T5：wrong revision ACK 被拒绝；相同 execution+fingerprint 的重复
      ACK 至多产生一次写入；superseded candidate 的 late ACK 不写入。
- [ ] T6/T7：旧 reload 不能覆盖新 candidate；candidate adoption 不因
      `world_state_loading` 被 skip，并留下 suppression diagnostics。
- [ ] T8/T9/T10：写入仍经 `saveWorldModel` 和既有 coordinator；readback fingerprint
      相同报告 reconciliation confirmed，不同则报告 mismatch。
- [ ] T11/T12/T13：非 World route 的自动 candidate、手动 Patch、手动 Full 都能
      直接 adoption，不依赖 Floor reload 才显示。
- [ ] T14/T15：canonical no-op 不产生不必要 Floor write；Chat 切换期间的
      candidate 不写入 Chat-B 或错误的 Chat-A Floor。
- [ ] 运行并报告 `npm run check`、相关 `node --check`、World/UI/runtime tests、
      `git diff --check`；最终保持 uncommitted/unpushed。

## Out of scope

- 不改变 `storage/floor-persistence-coordinator.js`。
- 不新增 Floor writer、UI Floor write、Chat-level historical World source 或
  第二套 debug system。
- 不修改 Fact Delta parser、Coverage/Identity/Type Discovery、Evidence Guard、
  Missing Coverage Targets、Dynamic Coverage Expansion 或 Biological_Type 语义。

## Open questions

无。用户已明确 persistence ownership、ACK 绑定、race 保护、测试矩阵和禁止范围；
其余技术选择以当前实现中最窄的 Runtime facade / event bridge 为准。

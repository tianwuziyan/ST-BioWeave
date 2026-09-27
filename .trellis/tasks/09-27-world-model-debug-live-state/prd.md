# 增强 World Model Debug LIVE STATE 快照与跨层一致性诊断

## Goal

为设置页 Debug 输出增加导出时实时采集的 World Model LIVE STATE，提供 Runtime、Authoritative Floor、UI ViewModel 与最后渲染状态的 deterministic fingerprint、动态 address diff、目标身份与 trace buffer 元数据，并以只读回归测试证明 API 到 UI 的状态链可比较且不改变业务或 Floor 写入架构。

## Confirmed current behavior

- Settings 的高级调试 Popup 由 `ui/app.js` 的 `openAnalysisDebugPopup()` 打开；内容通过 `renderAnalysisDebugPopupContent()` 组合 `analysisPreviewState` 与 `runtime.getPersistenceTrace()`。
- 当前“复制最近一次分析诊断”在 `copyPersistenceTrace()` 中直接序列化既有 persistence trace；点击复制不会重新读取 Runtime、Floor 或 UI state，因此可能 stale。
- Runtime 的历史诊断由 `runtime/diagnostics.js` 保存：每次 execution 的 sequence 最多保留最近 64 条，`getPersistenceTrace()` 返回历史 trace；它不是当前 Runtime/UI state 的替代物。
- World UI state 由 `ui/app.js` 闭包中的 `worldModelState` 持有；World 页面通过该 state 构建 ViewModel。当前 `WORLD_UI_RENDERED` 只写入“渲染发生/是否存在”的 trace，没有保存 render 实际消费的 fingerprint。
- Authoritative World Model 读取已有 `runtime.resolveWorldModelAtOrBefore()` / Floor storage read path；本轮只复用只读 resolver/read API，不新增 writer。
- Supplement 已有 `WORLD_FACT_DELTA_PARSED` 与 `WORLD_FACT_DELTA_RESOLVED` 诊断摘要，包含 fact/accepted/rejected/operation 统计；candidate model 本身目前不作为持久化事实写入 Debug trace。

## Requirements

- 在 Settings Debug 的查看、刷新、复制、导出路径中调用新的 live collector；不得复用几分钟前生成的 snapshot。
- 输出独立 `WORLD MODEL LIVE STATE` 区块，至少包含 snapshot 时间、snapshot id、目标身份、active world execution id、latest fact-delta execution id、Runtime/Floor/UI/last-render 四层状态、fingerprint、计数、动态 address inventory、cross-layer comparison、address diff、HISTORY TRACE 来源与 buffer metadata。
- fingerprint 必须 deterministic、key-order independent、不修改输入；数组顺序保留；`null`/缺失有明确机器可读语义；优先复用现有 stable canonical/hash utility，不引入第二套复杂 canonical schema。
- Runtime、Floor、UI 和 renderer 必须分别取实际当前状态；不得把最后一个历史 trace event 当作当前 UI state 或 render state。
- Floor read 失败时 snapshot 仍尽量成功，并输出 `floor_read_status: failed` 与稳定错误码；不得影响正常业务。
- async collection 必须记录 started/completed 时间和 active target identity；target 在采样期间改变时，snapshot 标记不一致并说明原因，不得混合两个 target，最多进行一次受控重采样。
- collector 只能 observe/compare/report，不调用分析、`saveWorldModel()`、`commitFloorPatch()`、`store.saveFloor()`，不自动 repair。
- 增加抽象 fixture 的 focused regression tests：freshness、Floor newer than UI、UI newer than render、全同步、false capability、generic identities、read-only、async target change，以及现有 direct-writer/static gate 不回归。
- 本轮不得修改 Evidence Guard、prompt/parser/resolver/canonical merge/schema/UI business field definition、Floor persistence coordinator 及其 owner/version/sibling 语义。

## Required diagnostic semantics

- Runtime fingerprint 表示 Runtime diagnostic state 中已经接受/认为当前有效的 World Model；若当前运行时没有保留 model，必须明确 `unavailable`，不得从历史 trace 猜测。
- Supplement candidate fingerprint 只从已经存在的 transient diagnostic state 读取；不得为 Debug 重新执行分析或新增持久化。
- UI canonical fingerprint 与 ViewModel fingerprint 必须分开表达，只有确实对应 canonical model DTO 时才填 `ui_world_fingerprint`。
- 动态 address 使用 `Species` 与 `Species / Biological_Type` 的开放字符串组合；不得为任何具体物种/类型写分支。
- `false`、`null`、missing 分别保留，field summary 不能把 false 当作 missing。

## Acceptance Criteria

- [ ] Settings Debug 在每次查看/复制/导出时重新采样，第二次采样能看到 Runtime R2 而不是复用 R1。
- [ ] LIVE STATE 包含完整目标身份与时间/ID 字段，且输出明确区分 `sampled_at_export_time` 与 `event_buffer`。
- [ ] Runtime/Floor/UI/render 的 fingerprint、counts、addresses、comparison 和 address diff 可重现并覆盖 Test B/C/D 的期望结果。
- [ ] 最新 Supplement 统计和 execution IDs 来自当前 diagnostic state；candidate 不可得时输出 `candidate_not_retained`。
- [ ] Floor async target 变化不会产生伪 MATCH；snapshot 标记 `snapshot_consistent: false` 并报告 invalidation reason。
- [ ] collector 前后 Runtime、Floor、UI 内容不变，且测试断言三个 writer/协调器入口均未调用。
- [ ] `node --check`、Debug/settings/UI focused tests、World runtime tests、Floor Persistence Coordinator tests、direct-writer/static gate、`npm run check`、`git diff --check` 全部通过。
- [ ] 最终报告列出实际旧/新数据流、修改文件、测试结果及任何仅观测到但未修复的 World/UI finding；不 commit、不 push。

## Out of scope

- 不修复任何 World Model 业务判断、Evidence Guard、Supplement prompt/parser/resolver/merge、schema 或 UI 展示字段。
- 不改变 Floor ownership/persistence architecture，不新增 Debug/Floor writer，不把 candidate 或 snapshot 变成持久化事实。
- 不做 DOM scraping，不保存完整 DOM，不把 browser paint 作为成功条件，不增加与现有 UI 风格无关的按钮/页面。
- 不 commit、不 push。

## Open questions

无阻塞性问题；待实现前通过实际代码审计确定最小接线点与现有 runtime diagnostic retention 能力。

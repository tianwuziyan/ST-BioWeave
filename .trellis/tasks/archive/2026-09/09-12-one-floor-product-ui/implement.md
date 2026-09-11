# 实施计划

本计划需要在本次计划获得用户明确批准后执行；当前阶段只完成审计与规划。

## 1. Contract / parser

1. 先补 `tests/event-analysis.test.js` 的 Prompt 与 parser 回归：空数组/单个
   consolidated Event 保持成功，两个合法 Event 必须产生稳定 diagnostic；同一
   Event 内多个 exposure source 的数组语义继续通过。
2. 修改 `ai/prompts.js` 的 Core/Task/Output Contract，写明 0/1、primary type、
   同过程合并、独立症状/明确医疗事件和静态背景过滤规则；不改 participant/exposure
   约束。
3. 修改 `ai/analyzer.js` 在 Event map 前拒绝 `events.length > 1`，使用
   `multiple_events_not_allowed` / `$.events`。

## 2. Runtime regression

1. 保持 `runtime/event-analysis.js` 的 identity/source/ordinal、保存、失败、取消、
   stale 和 Registry 流程不变，不添加 semantic merge。
2. 调整 runtime fixture，使 production `createAnalyzer()` 可以在一次成功后返回
   多 Event response；验证 force refresh 失败时旧成功 Event、`last_success` 和
   Tracking Registry 仍保持，且没有新 Floor save。
3. 更新原本把三个 Event 当作成功基线的测试，改为验证 contract rejection；保留
   单个 consolidated Event 的 Runtime enrichment/source ownership 覆盖。

## 3. Product UI cleanup

1. `ui/characters.js`：删除 `renderExposureDebug()` 及人物摘要 ID debug；曝光卡不回显
   event/source IDs，保留 `counterpart_ids` 投影的相关对象、业务时间/地点/状态；
   invalid detail 不回显请求 ID；不改变 Tracking Subject 入口条件或单页 section。
2. `ui/events.js`：普通 card 删除 participant/role 列表、结构化 ID、raw Story Time、
   Source/debug details 和 raw evidence kind；保留用户可读妊娠对象/相关对象、事件
   证据 text、编辑/删除操作；编辑表单继续保留必要结构化字段和只读 Event ID。
3. `ui/overview.js`：删除 Floor Version/hash、Event ID、Registry Summary、raw
   Event JSON 和执行诊断 renderer；保留统计、用户可读分析状态与操作按钮。
4. `ui/app.js` 只做只读确认：不删除 Settings/World Model 的显式 Analysis Debug
   Popup，也不删除 Event edit/delete 所需的内部 DTO 操作路径。
5. 删除 `.bioweave-analysis-detail` dead CSS；保留 Settings Debug Popup CSS。

## 4. Tests / docs / specs

1. 更新 `tests/phase2a-ui.test.js`、`tests/phase2a-app.test.js`：区分普通 card 与
   edit form，锁定普通 Characters/Events/Overview 不含内部字段；保留 DOM 操作属性
   与底层 source/ID 持久化断言。
2. 必要时补 `tests/ui.test.js` 的 route/Debug Popup separation 断言，但不删除现有
   Settings Popup 测试。
3. 更新用户指定的四份 docs，并同步 `.trellis/spec/domain/event-pipeline.md`
   与相关前端边界说明，使 one-floor contract 和 Product UI/Debug separation
   不再互相矛盾。

## 5. Verification

按顺序执行：

1. `node --check` 覆盖每个修改后的 JS；
2. focused tests，再执行完整 `npm test`；
3. `npm run check`；
4. `git diff --check`；
5. 检查 `git status`，确认没有 commit/push，也没有超出本任务的 participant/exposure
   或 Phase 2B 修改。

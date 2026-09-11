# 技术设计：One Floor Version 与 Product UI 边界

## 设计原则

本任务只在两个边界收紧：Event Analyzer 的 AI DTO 合同，以及 Product UI
的可见字段。Runtime 继续只接受已通过 Analyzer parser 的 DTO；不增加
semantic merge 层，不改变 Floor identity/source ownership，也不改变上一轮的
actual reproductive exposure participant 语义。

## 数据流

```text
Target Floor Version
  → Prompt: 选择一个 primary BiologicalEvent 并合并同过程事实
  → AI response: {schema_version: 1, events: []}，events.length ∈ {0, 1}
  → ai/analyzer.js strict parser
  → Runtime deterministic event_id + authoritative source
  → core normalize/validate
  → Floor storage / Tracking Registry
  → Product UI 只显示业务投影
```

当 parser 发现 `events.length > 1` 时，在 Runtime identity enrichment 之前抛出
`multiple_events_not_allowed`。Runtime 的现有 catch/persist-terminal-attempt
路径记录失败并保留旧成功结果；不新增 merge 或 first-event fallback。

## Prompt Contract 设计

在 `EVENT_ANALYZER_CORE_CONTRACT` 增加 one-floor/consolidation 规则，在
`EVENT_ANALYZER_TASK_CONTRACT` 明确 `events[]` 只是 schema 兼容容器且长度只能
为 0/1，在 `EVENT_ANALYZER_OUTPUT_CONTRACT` 明确：

- primary type 只能是现有单值 Event type；不得 type 数组或拼接 type；
- pregnancy-relevant sexual exposure 优先承载在唯一 `sexual_activity`；
- 同一连续行为的即时症状、physical effect、直接观察和证据并入该 Event；
- 独立 physical symptom 才能成为唯一 `physical_symptom`；
- 明确医疗行为才允许唯一 `medical_event`；普通照顾/补品/送餐忽略为独立
  Event；
- 外貌、体质和长期背景没有本楼新变化时不产生 Event。

不改 prompt 中上一轮已经收紧的 exposure-chain participant、barrier outcome、
`counterpart_ids`、evidence marker 和 capability 规则。

## Parser 设计

在 `parseEventAnalysisResponse()` 通过顶层 envelope 检查后、`payload.events.map`
前检查数组长度。使用现有 `eventDiagnostic()` 生成：

- `diagnostic_code`: `multiple_events_not_allowed`
- `diagnostic_path`: `$.events`
- `error_code`: 同 diagnostic code（由现有 helper 设置）
- `analysis_stage`: `schema_validation`

不修改 `normalizeEventRecord()`、`core/events.js` 或 Runtime 事件 ID ordinal 逻辑。

## Runtime / refresh 设计

`runtime/event-analysis.js` 保持现状：只处理成功 parser DTO 的 identity/source
enrichment 和现有 Domain validation。多 Event 的生产路径由 `createAnalyzer()`
中的 parser 拒绝；不能在 Runtime 选择主事件或合并症状/医疗事件。

回归测试用真实 `createAnalyzer()` + 抽象 ChatCompletion response 覆盖：

1. 既有成功单 Event；
2. force refresh 返回两个 Event；
3. parser 失败，旧 Event、旧 Tracking Registry 和上一份成功状态仍保留；
4. 不存在任何 Runtime/UI 自动拼接行为。

## Product UI 设计

### Characters

- 删除人物摘要和 exposure card 的 debug renderer；
- 保留 Summary、Capabilities、Current State、Related Events、Projection、
  Relations、Notes 单页结构；
- exposure card 只显示类型、状态、时间、地点和 `counterpart_ids[]` 的“相关对象”；
- 缺少名称时使用用户可读 fallback，不把内部 ID 当名称输出；
- invalid detail 页面不回显请求中的 `character_id`。

### Events

- 普通 card 删除 `renderParticipants()`、结构化 ID details、raw Story Time、
  Source/debug details；
- 妊娠相关信息保留用户可读的“妊娠追踪对象 / 相关对象 / 存在受孕可能”等字段，
  相关对象只从 `counterpart_ids[]` 映射 canonical participant display name；
- 证据只显示用户可读 text，不显示 raw `kind` enum；
- 编辑表单与普通 card 保持独立：继续保留必要的 canonical edit fields 和只读
  Event ID，绝不加入 content hash/message version/API authorization 等无关字段；
- event DOM data attributes 如仍为页面操作所需，只作为内部交互绑定，不渲染成可见
  业务字段。

### Overview

- 保留分析操作、用户可读状态、人物/事件数量、最近事件和其它业务空状态；
- 最近事件使用用户可读 type/status/time/location，不显示 Event ID/Floor；
- 删除当前 Overview 的 Floor Version 拼接、执行诊断详情、raw Event JSON 和
  Registry Summary；
- Settings 的 Analysis Debug Popup 不在普通 Overview 中消费，继续作为高级工具。

## CSS 与文档

删除只服务于 Overview 旧 debug detail 的 `.bioweave-analysis-detail` 样式；对
Settings 使用的 `.bioweave-analysis-debug-popup-*` 保持不动。没有专用
`.bioweave-event-debug` / `.bioweave-inline-debug` 样式需要迁移时，不新增替代
样式。

同步四份用户指定文档，并让 Trellis/domain 规格中的 one-floor 和 Product UI
边界与实现一致；不记录为已完成真实 SillyTavern 手工验收。

## 失败与兼容性

- 已持久化的旧 Floor Event 不做批量迁移或自动合并；本轮只保证新 AI response
  边界和失败 refresh 行为。
- edit/delete 仍通过现有 Runtime API；普通卡片隐藏内部字段不删除 DTO。
- Settings Debug Popup 保持可用，Debug 与 Product UI 的入口边界通过路由/页面消费
  分离，而不是在普通页面使用 `<details>` 折叠伪装。

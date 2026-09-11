# 修复 One Floor Version 与 Product UI 内部字段

## Goal

将 Event Analysis V1 收紧为每个 Target Floor Version 输出 0/1 个
consolidated `BiologicalEvent`，并从普通 Product UI 移除调试、来源和
provenance 字段。保持上一轮已经完成的 participant / actual exposure /
`counterpart_ids` 语义不变。

## Current Audit Findings

- `ai/prompts.js` 的 Event Core、Task、Output Contract 仍允许模型返回多个
  Event，只要求顶层存在 `events[]`。
- `ai/analyzer.js:parseEventAnalysisResponse()` 校验顶层数组和每个 Event，
  但尚未拒绝 `events.length > 1`。
- `runtime/event-analysis.js` 只负责对已经解析的 DTO 做 identity/source
  enrichment、Domain validation 和 Floor save；本轮不让 Runtime 选择 primary
  Event 或语义合并多个 Event。
- `ui/characters.js` 仍渲染人物/曝光 `调试信息` 和 `character_id`。
- `ui/events.js` 仍渲染参与者、结构化 ID、来源与调试信息；普通卡片和编辑表单
  尚未完全分离。
- `ui/overview.js` 仍渲染 Floor Version、原始 Event JSON、Registry Summary 和
  执行诊断详情。
- `style.css` 中 `.bioweave-analysis-detail` 只服务于 Overview 的旧调试详情；
  Settings 的 Analysis Debug Popup 是独立的高级调试入口，应保留。

## Requirements

### R1. One Floor Version → 0/1 Event contract

对一个 Target Floor Version，AI Event Analysis V1 的 `events[]` 只能为空或只含
一个 consolidated `BiologicalEvent`。同一连续过程的 sexual activity、实际
生殖暴露、即时 physical effects、直接身体反应和相关证据必须并入一个 primary
Event；不能通过新增 type 数组或拼接字符串表达多个 type。

### R2. Primary type and false-positive rules

- 有实际 pregnancy-relevant sexual exposure 时，primary type 优先为
  `sexual_activity`，即时症状/physical effect 进入已有 Event 的 effect/evidence
  字段。
- 独立的新症状且本楼没有更高层级 BiologicalEvent 时才允许唯一的
  `physical_symptom`。
- 只有明确医疗检查、诊断、治疗、给药、干预或医学监测才允许唯一的
  `medical_event`；普通送汤、食物、补品、饮料、照顾和休息建议不单独成 Event。
- 外貌、体质、长期设定和静态人物描写不自动成为 `physical_symptom`。

### R3. Strict parser boundary

`parseEventAnalysisResponse()` 在 per-event normalization 前拒绝
`payload.events.length > 1`，使用稳定 diagnostic code
`multiple_events_not_allowed`（或等价稳定命名）和 `$.events` 路径。不能选择
第一条、丢弃其它条目、在 Runtime 合并或让 UI 合并。

### R4. Failure preservation

多 Event response 属于 schema/contract failure：不保存新的 Floor Event，不重建
错误 Registry，不覆盖同一 Floor Version 上一次成功结果。现有 Runtime 的 identity、
source ownership、refresh replacement、abort preservation 和 Tracking eligibility
保持不变。

### R5. Product Characters UI

普通人物列表和人物详情只显示用户可读业务信息。移除人物摘要、曝光卡中的调试
信息、`character_id`、`event_id`、Floor/Swipe/hash/message version 等可见字段；
人物详情仍只由 `tracking_subjects` 中的 `character_id` 打开，不能因
`character_profiles` 单独存在而出现入口。人物详情保留上一轮的单页纵向 sections。

### R6. Product Events UI

普通历史 Event card 只显示事件类型、状态、发生时间、地点、妊娠追踪对象、相关
对象、受孕可能和适合用户阅读的证据。妊娠相关 `sexual_activity` 不再单独显示
完整参与者列表或角色 enum；相关对象只映射
`pregnancy_relevance.counterpart_ids[]`。移除结构化标识、来源与调试信息、raw
Story Time、内部 ID 和 provenance。必要的 Event 编辑字段/只读 Event ID 可以
继续存在于明确的编辑模式，不删除 Core/Runtime DTO 或 CRUD 能力。

### R7. Product Overview UI

普通总览移除 raw Floor Version、chat/message/swipe/hash/version、raw Event JSON、
Registry Summary 和执行诊断详情入口；保留用户可理解的分析状态、统计和操作入口。
Settings 中现有高级 Analysis Debug Popup 不属于本轮普通页面清理对象。

### R8. Documentation, CSS, and regression coverage

更新 `docs/DATA-MODEL.md`、`docs/DEVELOPMENT.md`、`docs/UI.md`、
`docs/CONTEXT-AND-PROMPT.md`，同步 one-floor contract、primary Event consolidation
和 Product UI / Debug boundary。移除不再消费的旧 Overview debug CSS；保留 Settings
Debug Popup CSS。补充 Prompt/parser/Runtime failure/UI regression tests。

## Protected Scope / Out of Scope

- 不修改已完成的 participant / actual exposure / barrier outcome /
  `counterpart_ids` 业务语义。
- 不修改 `core/tracking.js` 的 eligibility；不修改 `core/events.js` 的实际暴露
  语义，除非严格的本轮 contract 测试发现必要的边界调整。
- 不在 Runtime、UI 或 Storage 实现语义 Event merge。
- 不进入 StateReducer、Snapshot、Projection、Genealogy、StoryTime canonical
  index、null capability 历史重评估、Universal World Model cleanup 或
  HistoryRecord 重构。
- 不删除 Core/Runtime/storage 中的 `event_id`、`source`、`character_id` 或其它
  provenance；仅移除普通 Product UI 的展示。
- 不 commit，不 push。

## Acceptance Criteria

- [x] Prompt Core/Task/Output Contract 明确一个 Target Floor Version 最多一个
      consolidated BiologicalEvent，且说明 primary type、即时症状合并、普通补品
      与静态描写过滤规则。
- [x] Parser 对 `events.length > 1` 抛出稳定 contract diagnostic；不落盘、不由
      Runtime/UI 合并。
- [x] 真实 API 多 Event response 的失败刷新保留旧成功 Event 和 Registry。
- [x] Characters、Events、Overview 普通页面没有调试信息、标识信息、结构化标识、
      来源与调试信息、raw Event JSON、Registry Summary 或内部 provenance 文本。
- [x] Character Detail 仍为同页纵向 Summary、Capabilities、Current State、Related
      Events、Projection、Relations、Notes，且入口仍只来自 Tracking Subject。
- [x] Event ordinary card 只显示 `counterpart_ids[]` 投影出的相关对象，不显示完整
      participant list；编辑能力仍可用。
- [x] Core/Runtime DTO 仍保留 Event ID、Source 和 character IDs。
- [x] 相关 tests、`npm run check`、`git diff --check`、所有修改 JS 的 `node --check`
      通过。

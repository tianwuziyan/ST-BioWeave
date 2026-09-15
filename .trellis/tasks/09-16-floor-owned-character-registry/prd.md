# 修复 Floor-owned canonical character registry provenance

## Goal

将 BioWeave 的历史 canonical character identity 改为随有效 Floor/Swipe 保存的
累计 snapshot，使 Analyzer 的 Runtime Canonical Character Registry 只来自当前
Chat 中仍存在、active Swipe 有效且 Floor Version 有效的 Floor。删除、编辑、
切换 Swipe、reload 或没有 previous Floor 时，不得从 Chat Metadata 恢复孤立的
历史人物身份。

用户价值：新聊天或历史被截断后，Analyzer 只看到当前角色卡、Persona、World
Model、Recent Story 等当前配置/上下文，以及有合法 provenance 的 Floor history，
不会把上一段剧情遗留的人物重新注入 Prompt。

## 已确认的现状与 baseline 证据

上一轮已完成的 Floor/Swipe storage、previous analysis、current-valid Events、
Tracking rebuild、Swipe deletion guard、in-flight invalidation 和
`last_processed_floor` hint 规则是本任务的不可退化基线。本任务只处理剩余的
canonical identity ownership 缺口。

当前代码确实存在污染路径：

- `runtime/event-analysis.js:626-643` 在 `collectCurrentDerivedState()` 中把
  `currentChat.character_registry` 作为 `bootstrapCharacterRegistryFromLegacy()`
  的 base；即使 `activeEvents` 为空，Chat registry 的全部实体仍会被保留。
- `runtime/event-analysis.js:1105-1149,1177-1196` 将该派生 registry 交给
  `characterContextResolver()` 和 `buildEventAnalysisInput()`。
- `ai/input-builder.js:944-977` 规范化显式 `character_registry`，
  `ai/prompts.js:414-455,611-620` 构造 `Runtime Canonical Character Registry`
  block，`ai/analyzer.js:2547-2563` 将 Prompt 送入 API transport。
- `runtime/event-analysis.js:1284-1295` 又把本次 identity result 写回
  `chatMetadata.bioweave.character_registry`，但没有同时写入目标 Floor。
- `runtime/event-analysis.js:1528-1545` 的 Event 编辑 identity 校验和
  `:1608-1628` 的 registry read 仍可直接以 Chat registry 为输入/回退。

只读 inline reproduction 已确认 baseline：Chat Metadata 中仅存在
`shen_qi_yuan`/沈祁鸢、`jue_xin`/觉心、`liu_ru_yan`/柳如烟，当前 Chat 没有任何
合法 analyzed Floor，`existing_bioweave` 为 `{ analysis: null, events: [] }`；
但 `getCurrentFloorAnalysisInput().character_registry` 和最终 Prompt 仍包含
全部三个实体。该结果证明问题发生在 previous 搜索之外的独立 registry 输入链。

## Requirements

### R1. Floor-owned cumulative identity history

- 每个成功分析的 Floor 必须在其现有 `message.extra.bioweave` 或
  `message.swipe_info[swipe_id].extra.bioweave` owner slot 中保存完整的
  cumulative `character_registry` snapshot。
- Snapshot 的有效性依赖 enclosing analysis 的成功状态、当前 active Swipe 和
  完整六字段 Floor Version；不另建 Chat-level history database 或永久 Floor ID。
- 同一消息的不同 Swipe 必须各自拥有独立 snapshot，不能互相继承。

### R2. One previous resolver supplies all historical state

- 复用现有 `findPreviousSuccessfulBioWeave(target)` 的单一向前搜索，不建立
  第二套 identity previous 搜索。
- 合法 previous 必须同时返回 `analysis`、`events` 和 candidate Floor 自己的
  `character_registry` snapshot。
- 目标 Floor 自己的旧 analysis/events/registry 仍然结构性排除；stale、删除、
  非 active Swipe 或跨 Chat candidate 不得提供任何 previous identity。
- 没有合法 previous 时，identity snapshot 必须为空 registry，且不得从 Chat
  Metadata、Tracking、profiles、cache 或 `last_processed_floor` 回填。

### R3. Analyze and persist atomically at the target owner

- Analyzer 输入中的 canonical identity candidates 只能来自 previous Floor
  snapshot；当前角色卡、Persona、World Model 和 narrative 仍按现有配置/上下文
  语义提供信息，但不能把 Chat historical registry 当 identity history。
- Runtime 完成 identity resolution 后，以 previous snapshot 为 base，生成新的
  cumulative registry；新人物和 existing/unresolved 的既有 identity contract
  不变。
- analysis、Events 和最终 identity snapshot 必须在同一次目标 Floor owner save
  中写入；Chat projection 的保存不能先于 Floor authoritative save。

### R4. Chat Metadata is projection/configuration only

- `chat_metadata.bioweave.character_registry` 如继续保留，只能是当前有效 Floor
  snapshot 的 materialized projection、UI/compatibility view 或一次性 migration
  输入，不能成为普通 Analyzer request 的 historical source。
- 没有合法 Floor snapshot 时，正常 API request 必须使用空 registry；任何普通
  request、reload 或 refresh 都不得持续调用 legacy bootstrap 来恢复 Chat entities。
- 合法的 Character Card、Persona、World Model、Recent Story、API profile 和
  其它独立配置继续保留，不将其错误移动到 Floor。

### R5. Explicit legacy boundary

- 现有 legacy bootstrap utility 若保留，必须只由明确的一次性 migration/legacy
  adapter 调用，并且只把当前仍存在且版本有效的 Event 能证明的 exact IDs 写入
  Floor snapshot；不能把未被当前 Floor 证明的 Chat entity 全量复制。
- 普通 analysis、previous search、registry read、Event edit 和 API input 路径
  不得调用该 migration bootstrap。
- 若本轮不提供真实 migration UI/命令，也必须明确记录旧 Chat registry 被视为
  inert projection，不能为兼容而继续作为 API fallback。

### R6. Preserve prior ownership behavior

- 不改变 Event/World Model/API profile schema、妊娠 Event 粒度、Tracking 的
  current-facts-only 决策、Floor Version 算法、per-Swipe storage、in-flight
  invalidation 或 `last_processed_floor` hint 语义。
- 删除 Floor/Swipe、历史截断、编辑导致版本变化、reload/plugin reload 后，
  identity history 与其它 Floor facts 一样只由当前有效 owner 恢复。

## Acceptance Criteria

- [ ] **Case J — first analysis does not inherit orphan Chat registry**：Chat
      Metadata 有 `[A,B,C]`，当前没有合法 analyzed Floor，角色卡/Persona/current
      narrative 不提供它们；新 Floor 的 previous 为
      `{analysis:null,events:[]}`，输入和 API Prompt 的 Runtime registry 为空。
- [ ] **Case K — cumulative Floor snapshot**：2F 分析后 2F snapshot 为 `[A]`；
      5F 的 API registry 来自 2F `[A]`，5F 成功后 snapshot 为 `[A,B]`。
- [ ] **Case L — target self exclusion**：2F `[A]`、5F `[A,B]`、9F `[A,B,C]`；
      重分析 9F 的 API registry 必须是 5F `[A,B]`，不得包含旧 9F 的 `C`。
- [ ] **Case M — deletion rollback**：删除 9F 后下一次分析继承 5F `[A,B]`；
      再删除 5F 后下一次分析只继承 2F `[A]`。
- [ ] **Case N — delete all + reload**：删除所有 analyzed Floors 后 reload，
      新分析的 registry 为空；不得从 Chat Metadata 恢复 `[A,B,C]`。
- [ ] **Case O — Swipe isolation**：同一消息 Swipe 0 snapshot `[A]`、Swipe 1
      snapshot `[B]`；切换读取严格分别得到 `[A]`/`[B]`，删除 Swipe 1 后 `B`
      不得通过 Chat projection 或 fallback 恢复。
- [ ] **Case P — Floor Version invalidation**：旧 Floor snapshot `[A,B]` 在正文
      编辑后六字段 Version 不匹配；后续 previous identity 不得继承该 snapshot。
- [ ] Chat projection、Tracking DTO、Event edit validation 和 API request 在
      删除/失效/切换场景都只消费当前有效 Floor snapshot；上一轮 invariants 全部
      保持通过。
- [ ] 先有 baseline red regression（至少 Case J），再有 green regression；
      request body 不包含 orphan identity IDs/display names。
- [ ] 规划文档在实现前完成，且后续只有用户明确批准最新 planning summary 后
      才允许执行 `task.py start`。

## Out of scope

- 不重新设计或重写上一轮 Floor State Ownership、previous analysis、Tracking
  pipeline、Event schema、World Model schema 或 API profile。
- 不把 Character Card、Persona、World Model、Recent Story、用户配置或其它当前
  context 当作 Floor history；不因本任务删除合法配置。
- 不在普通 request 中保留 Chat registry fallback；不建立第二个 historical store、
  permanent Floor ID 或按数组下标持久化的数据库。
- 本阶段不执行 `task.py start`，不修改业务代码、测试代码或项目 domain spec，
  不 commit、push、merge；这些属于后续明确实施批准后的阶段。

## Blocking open questions

无。用户已明确规定 Floor snapshot 结构、previous 语义、删除/Swipe/reload 行为、
legacy 边界和 Case J-P 验收条件；技术选择将在 `design.md` 中按当前代码证据收敛。

# 修复 Floor 权威分析事实污染路径

## Goal

在不重新设计既有 Floor State Ownership 模型的前提下，审计并修复
deleted/stale/orphan Floor analysis facts 对 Tracking 派生状态和 API input
的污染，使分析事实只由当前 Chat 中仍存在、active Swipe 且版本有效的
Floor/Swipe 槽位提供。

## Audit findings

本任务的 source-level audit 已确认当前代码确实存在污染路径：

- `core/tracking.js:149-196,518-569` 从 Chat 中的旧
  `character_profiles`/`tracking_candidates` 参与新的 identity、capability
  和 eligibility 判定；`runtime/event-analysis.js:125-130,1033-1083`
  再把旧 profile 的生物字段/evidence 送入 `character_context`，经
  `ai/input-builder.js`、`ai/prompts.js`、`ai/analyzer.js` 到 API。
- `runtime/event-analysis.js:797-876,1477-1486` 的业务 DTO/registry read
  直接返回 Chat-level derived view；删除、历史截断、reload 或异步 refresh
  窗口中可读到 stale subjects/candidates/profiles。
- `core/tracking.js:111-126` 的 nested legacy root fallback 会重新注入
  derived data；`runtime/events.js:191-205` 与
  `runtime/event-analysis.js:1064-1102` 还存在 lifecycle invalidate 后
  in-flight API request/retry 持有旧 input 的风险。
- `storage/store.js:595-613`、`runtime/event-analysis.js:67-78` 和
  `runtime/events.js:82-97` 对已不存在的 active Swipe 缺少 fail-closed
  边界，条件性地允许重新创建已删除 slot。

下列实现已符合当前 `floor-state.md`，规划上明确不重写：精确 per-Swipe
Floor 读取、完整六字段 Version/Event source 过滤、
`findPreviousSuccessfulBioWeave()` 的目标自排除与最近合法 Floor 算法、
Runtime 对 Event ID/source 的重新绑定、`input-builder` 的纯规范化边界、
以及 canonical `character_registry`、World Model、settings、recent story
和 API profile 的配置所有权。完整 source → propagation → sink 证据及最小
修复点见 `design.md`。

## Requirements

### R1. Floor / Swipe ownership

- 每次成功分析的 `analysis`、`events` 及本次分析最终结果只写入目标
  Floor 的既有 storage abstraction；结构化消息必须绑定到当前
  `swipe_info[swipe_id].extra.bioweave`。
- 读取不得从其他 Swipe、active-message mirror、Chat Metadata、registry
  或 runtime cache fallback；删除消息/Floor 或 Swipe 后，原槽位不再贡献
  有效事实。
- 有效性必须由完整六字段 Floor Version
  （`chat_id`、`message_id`、`floor`、`swipe_id`、`content_hash`、
  `message_version`）和 Event `source` 一致性决定。

### R2. Previous BioWeave

- 目标 Floor N 的 previous 只能从当前 Chat 的目标消息之前向前扫描，取
  最近一个仍存在、active Swipe 匹配、Floor Version 完全匹配、floor 小于
  N、`analysis.status === "success"` 且 Events 当前有效的 Floor。
- 目标 Floor 自己的旧结果必须结构性排除；无合法候选时必须传递
  `{ analysis: null, events: [] }`。
- previous/API historical context 不得来自 Chat Metadata、Tracking
  subjects/candidates、character registry/profile、`last_processed_floor`、
  runtime/last-success cache 或已删除/过期 Floor。

### R3. Derived state

- `tracking_subjects`、`tracking_candidates`、Event-derived profiles/registry、
  index、summary、UI model 和 cache 只能由当前有效 Floor facts 与合法
  Chat configuration 确定性重建。
- 任何 Chat Metadata 中的 event-derived 字段都只能是 materialized view，
  不得通过旧 derived state merge 恢复 orphan facts；合法用户/角色/插件/
  identity/World Model configuration 必须保留。
- `index.last_processed_floor` 如保留，只能作为调度/性能 hint，不得参与
  previous、事实恢复或有效性判断。

### R4. Lifecycle and reload

实现与测试必须覆盖删除 Floor、多层历史截断、编辑旧 Floor、regenerate、
Swipe 切换、Swipe 删除、内容版本变化、聊天 reload 和插件 reload；正确性
不能依赖单个生命周期回调清理 cache。

### R5. Regression coverage

补充先复现污染、再证明修复的自动化测试，至少覆盖原始要求 Case A-I：
目标自排除和最近 previous、删除后回退到 6F/空 previous、per-Swipe
隔离与删除、stale version、derived registry orphan 清理、以及全量删除
后 reload/新分析/API 无历史残留。

### R6. Compatibility boundaries

保持现有 API profile、World Model、recent story、character identity、prompt
配置、Event schema 和模块边界；仅修改有证据违反 ownership/provenance 的
业务路径及其必要测试。不得引入第二套 Floor 历史数据库或永久 Floor ID。

## Acceptance Criteria

- [x] 审计报告在任务设计中列出每条实际存在的污染路径，精确到
      `source -> propagation -> API sink` 和 `file:line`，并区分已符合规范
      的实现与最小修复点。
- [x] 重分析目标 Floor 时，API previous 永远来自最近的合法更早 Floor，
      绝不读取目标 Floor 旧结果。
- [x] 删除/截断 Floor、删除或切换 Swipe、编辑导致版本变化后，原事实不再
      出现在 active events、Tracking projection 或 API input；若无候选，
      previous 精确为空形状。
- [x] Tracking/registry/profile/index 的 event-derived 部分能从当前有效
      Floor 集合重建，删除 owner 后不保留 orphan subject/candidate/reference；
      合法 Chat configuration 不受破坏。
- [x] `last_processed_floor` 不再作为事实来源、previous 来源或 API 恢复
      依据；其存在与否、高于当前最高 Floor 与否都不改变事实有效性。
- [x] 新增/修改的回归测试覆盖 Case A-I，并先在修复前暴露至少一条真实
      失败，再在修复后通过；测试断言 API request body 不含删除/失效 Floor
      的分析结果。
- [x] 聊天/插件 reload 仅从当前消息及有效 per-Swipe Floor slots 重建，
      与 reload 前业务状态一致；全部分析 Floor 删除后 active events、
      previous、derived tracking state 均为空且 API 不收到旧数据。
- [x] 规划阶段先完成 `prd.md`、`design.md`、`implement.md` 和 context
      配置；用户明确批准后才执行 `task.py start` 并修改业务代码。

## Out of scope

- 不改变 Event/World Model 的业务 schema、妊娠事件粒度或 UI 产品展示契约。
- 不把合法 Chat configuration 迁移到 Floor，也不粗暴删除混合
  `character_profiles` 中的配置字段。
- 不以单独的 `MESSAGE_DELETED`/cache clear 回调作为正确性的唯一机制。
- 不执行 commit、push、PR 或其他 GitHub 发布操作。

# Phase B Event Editing Extraction

## Goal

基于当前工作树真实代码，完成人工编辑/删除已存在 Biological Event 的纯代码归位，不改变现有行为。

## Background and confirmed facts

- 当前工作树包含尚未提交的 Phase A Diagnostics Extraction；本审计以工作树实际代码为准。
- Runtime public facade 仍由 `runtime/events.js` 暴露 `updateEvent` / `deleteEvent`；UI 不直接知道 coordinator 内部位置。
- 当前实现位于 `runtime/event-analysis.js`：`findActiveEvent`、`updateEvent`、`deleteEvent` 与 Floor resolution、mutation invalidation、Floor persistence、Tracking rebuild 共享同一个 coordinator 闭包。
- Event 编辑/删除写入的是当前 Event 所属 Character Floor 的 `events` owner-scoped patch；调用现有 `FloorPersistenceCoordinator.commitFloorPatch`。
- Event 编辑不调用 AI、Prompt/Input 或 identity resolver；只用 canonical `character_registry` 检查 participant ID 是否存在，并使用 `core/events.js` 的 normalization/collection validation。
- Event 删除不直接改写 `character_registry`、snapshot 或 projection timeline；`refreshTrackingRegistry` 从当前有效 Floor Events 重新构建 Tracking projection。
- 编辑/删除前的 `invalidateMutation` 会取消受影响的 in-flight analysis、清除后续 Floor roots，并保留目标 Floor；这是 Runtime/Analysis 生命周期边界，不能整体搬入 Event Editing。

## Requirements

- 完整记录 UI/caller → Runtime facade → active Event lookup → validation → mutation invalidation → persistence → canonical readback → derived refresh → UI refresh 的真实链路。
- 分别审计 `updateEvent` 与 `deleteEvent` 的 Floor、Swipe、Event ID、validation、identity、registry、Tracking、snapshot、projection、analysis 与 persistence 行为。
- 明确区分 `EVENT_EDITING`、`CHARACTER_EVENT_ANALYSIS`、`SHARED_EVENT_DOMAIN`、`TRACKING_RUNTIME`、`PERSISTENCE`。
- 不将 AI invocation、Prompt/Input、Event retry、automatic analysis、World analysis 或 generation lifecycle 放入 Event Editing。
- 不移动或修改 `storage/floor-persistence-coordinator.js`、owner acquisition、bootstrap、readback、sibling preservation、transaction serialization、stale guard 或 Swipe ownership。
- 识别 Event Editing 依赖的 private helper，并为每个 helper 判断保留、shared domain、callback seam 或暂不移动。
- 目标模块如采用 `runtime/event-editing.js`，必须不反向 import `runtime/event-analysis.js`，不引入 service framework，并保持 Runtime public API 不变。
- 规划必须显式记录 stale Floor、active Swipe、analysis 并发、Event ID、registry、Tracking、snapshot、projection、persistence 与 UI refresh 风险。

## Out of scope

- 任何 production code、tests、project docs 或 Diagnostics 修改。
- Character/Event Analysis、World Analysis、Prompt/Input、Tracking semantics、Persistence behavior、Generation lifecycle 或 Settings 修改。
- 真实 extraction、重命名 public API、改变 Event 编辑字段契约、改变删除后的 derived-state 语义。

## Acceptance Criteria

- [x] 完成 Current Event Editing call graph 与 extraction seam。
- [x] 完成 `updateEvent` 与 `deleteEvent` 的行为保持性抽取。
- [x] 保留 shared Runtime/Analysis capabilities 在原 owner。
- [x] 保留 events、character_registry、Tracking、snapshot、projection、analysis 的既有语义。
- [x] 保持 Persistence interaction、owner patch、operation type 与 token guard 不变。
- [x] 完成 circular dependency、regression tests、implementation risk 检查。
- [x] Runtime public API 保持兼容，Diagnostics 未修改。
- [x] 未进入 Phase C。

## Open questions

无 repository-answerable blocking question；若 implementation 需要改变当前 snapshot/projection 语义，应另立行为任务，不在本 Phase 解决。

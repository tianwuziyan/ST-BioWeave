# 移除正文哈希业务身份绑定

## Goal

移除正文内容哈希对 BioWeave Floor 事实、分析、推演、读取、去重、持久化与
UI 刷新的业务身份绑定。正文被手动编辑后，同一 Chat、Message、Floor、active
Swipe 仍是同一逻辑 Floor；已有合法资料必须继续可读，重新分析只把完整结果写入
当前 Floor，不修改历史 Floor。

## Background

当前 `runtime/floor.js` 把 `content_hash` 和由它派生的 `message_version` 与
`chat_id + message_id + floor + swipe_id` 合并成六字段 Floor Version。大量 Core、
Runtime、Storage 和 UI 代码复用六字段全等比较，导致用户仅编辑正文格式或内容时，
同一逻辑 Floor 被误判为新版本、旧资料失活、事件 ID 改变、支线判断失败或异步结果
被错误拒绝。

旧审计把正文哈希保留为异步安全边界，这与当前需求不符。异步 stale 防护必须改用
明确的 request/run/generation/operation identity、Chat epoch 以及当前 logical owner，
而不是正文内容。

## Requirements

- 统一定义逻辑 Floor owner：`chat_id + message_id + floor + swipe_id`。
- `content_hash` 与正文派生的 `message_version` 不得再参与：
  - Floor/Event/Projection/Health/World/Storyline/Snapshot 的业务身份；
  - 当前资料可见性、最近合法记录读取、去重、继承、重写和 readback；
  - scheduler/in-flight/activity/UI refresh key；
  - Event、Projection、Snapshot、delivery、assessment 等确定性 ID。
- 新写入的 authoritative Floor/domain schema 不再产生或要求这两个正文版本字段；
  旧持久化数据中存在的额外字段允许兼容读取，但必须忽略，且不得回写为权威身份。
- 异步结果提交必须继续 fail closed，并使用现有或补充的显式身份：
  `request_id`、`analysis_execution_id`、`pipeline_run_id`、`intent_id`、
  `generation_id`、`operation_id`、transaction owner/epoch、subject/attempt ID。
- 正文编辑后：
  - 同一逻辑 Floor 的旧合法资料仍可读取；
  - 若重新分析，读取最近一次合法完整记录并把更新后的完整集合写入当前 Floor；
  - 同一 Floor 反复分析替换当前 Floor 数据，历史 Floor 不变；
  - 删除 Floor、切换/删除 Swipe 后，原 owner 的资料仍按既有生命周期退出有效读取。
- `hashText()` 及 observation/prompt/source revision 等非正文哈希不得机械删除；它们只能
  用于内容指纹、语义去重或诊断，不能重新成为 Floor 业务身份。
- 更新受影响的 Debug 字段、测试、架构/数据模型/Floor/lifecycle/scheduler 文档，清除
  “六字段 Floor Version 决定事实有效性”的旧语义。
- 不新增 Chat-level 第二事实源，不绕过现有 Floor storage abstraction。

## Acceptance Criteria

- [ ] 全仓生产代码不存在以正文 `content_hash` 或正文派生 `message_version` 决定
      Floor/domain 资料身份、可见性、读取、写入、去重或 stale 的路径。
- [ ] authoritative 新写入的 Floor、Event、Projection、Health、World、Storyline、
      Snapshot/Checkpoint DTO 不要求也不写入正文哈希字段；legacy extras 可读但被忽略。
- [ ] 编辑当前正文后，当前 active Swipe 上既有合法 Event、World、Health、Projection、
      Storyline 和相关完整快照仍可读取；重新分析能覆盖当前 Floor。
- [ ] Floor 20 `[A,B]`、Floor 26 更新为 `[A′,B]`、Floor 30 删除 B 后为 `[A′]`；
      回退到 Floor 23 仍读取 Floor 20 `[A,B]`。
- [ ] API 迟到结果、Chat/Swipe 切换、Floor 删除、generation 替换仍被显式 run/request/
      owner guard 拦截，不能覆盖当前资料。
- [ ] 同一逻辑 Floor 的确定性 ID 不因正文编辑而变化；真正不同的 Event/subject/branch/
      node/attempt 仍保持独立。
- [ ] Debug 能区分 Event 分析、World 分析、支线设计/识别及持久化顺序，但不再展示或
      使用正文哈希作为业务版本。
- [ ] 所有受影响聚焦测试、完整 `npm run check`、`git diff --check` 与 Trellis task
      validation 通过。
- [ ] 相关 Markdown 与最终实现同步，不残留六字段权威身份旧语义。

## Out of Scope

- 不删除非正文语义指纹、World candidate hash、observation fingerprint、prompt digest
  或宿主 source revision；只审查它们是否被误接入 Floor 业务身份。
- 不改变用户已确认的“最近合法 Floor 读取、当前 Floor 完整写入、历史 Floor 不改”规则。
- 不借本任务重构无关 AI prompt、UI 布局或事件领域规则。

## Notes

- 旧任务 `10-25-storyline-snapshot-identity` 只覆盖 Storyline 快照身份；本任务是跨层
  根因迁移。实施时应合并其仍有效的 subject/branch/attempt 规则，清理与新合同冲突的
  “保留六字段 stale guard”描述。

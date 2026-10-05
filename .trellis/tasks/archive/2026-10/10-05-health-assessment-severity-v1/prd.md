# Health Assessment severity v1

## Goal

在现有 Health Assessment 第二次 AI pass 中加入 observation-level
`severity`，并保持 BiologicalEvent、legacy、replay、authority 与模块边界不变。

## Requirements

- Assessment schema 从 v1 升为 v2，新增 `severity`：`unknown | mild | moderate | severe`。
- severity 只描述单个 Health observation / condition 本身的严重程度；不表示
  persistence、recovery duration、permanent、current functional impact 或
  overall health。
- prompt 只能依据已验证并保存的 source BiologicalEvent / factual observation；
  证据不足为 `unknown`，禁止诊断、分诊、创建事实、用恢复时间或 permanent
  反推 severity，也禁止夸大叙事语气。
- 非法 severity 在其余 Assessment 合法时仅降级为 `unknown`，不能丢弃合法的
  persistence / recovery 字段，也不能影响 factual Event。
- v1 / legacy Assessment 缺 severity 时运行时按 `unknown` 消费；不得回写、自动
  backfill、修改旧 Floor 或将其视为未评估而触发新的 AI 请求。
- Health Evolution 只透传 severity；不得根据 description、body_site、recovery
  stage、Story Time 或 persistence 推断/降低 severity。
- 不实现 functional impact、overall health、severity aggregation、severity UI、
  Recovery Guidance severity coupling、confidence/rationale 或新 Health module。
- 不修改 BiologicalEvent payload、Snapshot/Projection authority、Event
  fingerprint、source binding identity、Assessment request key、active/inactive
  lifecycle 或 source Event navigation。

## Acceptance criteria

- [x] v2 Assessment 可持久化并读取四个合法 severity 值。
- [x] 非法 severity 降为 `unknown`，其它合法字段保留；整体非法 Assessment
      仍遵循原有 invalid 行为。
- [x] v1 缺 severity 正常加载，运行时为 `unknown`，且不重跑、不回写；持久化层
      仍能区分 legacy 缺字段和 v2 明确 unknown。
- [x] 标准 eligible Event 流程只使用现有 Health Assessment AI pass，不新增调用。
- [x] Evolution 透传 severity；legacy 使用 unknown；恢复、Story Time 和 lifecycle
      行为不变。
- [x] edit/delete/swipe/rollback 仍按原有 source binding 使 Assessment 失效。
- [x] Event、fingerprint、request key、Snapshot、Projection、UI、Aggregation、
      Recovery Guidance 均无 severity authority 变化。
- [x] focused/broader tests、`node --check`、`git diff --check` 通过。
- [x] 受影响 Markdown/spec 只描述已实现 severity v1，并明确其它 Deferred 范围。

## Out of scope

functional impact；overall health / health summary producer；severity aggregation；
critical、confidence、rationale、medical risk、triage、emergency level；UI badge；
severity-aware Recovery Guidance；自动 legacy backfill；第三次 AI 调用；trajectory、
Condition identity、reference graph、freshness、Projection authority。

## Open questions

无。用户已批准实现边界与规划摘要。

## Closure

- implementation complete
- regression attribution PASS
- Health Assessment Severity v1 CLOSED
- 后续 severity UI、functional impact、overall health、severity aggregation 与
  Recovery Guidance 联动均属于独立未来任务
- Full suite 未获得 clean pass；已观察失败按 HEAD baseline / 长驻运行问题归因，未发现
  severity v1 regression

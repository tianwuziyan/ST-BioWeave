# 实现 Character Health Severity 最小 UI 展示

## Goal

在现有 Character Health 详情浮层的“总体状态”位置，展示当前 active Health observations 的
presentation-only severity summary。该摘要是 UI read model 的派生展示，不是新的
`overall_health`、医学判断或事实权威。

## Confirmed requirements

- Health-owned aggregation 负责从当前 active observations 产生明确的
  `severity_summary` 字段；UI 不遍历 severity、不维护 ranking，也不从 description 推断。
- Ranking 严格为 `severe > moderate > mild > unknown`。
- 无 active observations 时 summary 为 `normal`，UI 显示“正常”。
- 有 active observations 时：最高为 severe/moderate/mild 分别显示“严重”/“中度”/“轻微”；
  全部 unknown 显示“有健康问题”，而不是“未知”。
- Health read model unavailable/not ready/error 仍显示“暂不可用”；不能因缺少 severity
  就显示正常。
- ready 且没有该人物 Health entry 仍按既有语义显示“正常”。
- 只修改现有“总体状态”展示；问题列表、source Event navigation、Character Health button
  和 popover 生命周期保持不变。
- 不修改 BiologicalEvent、Health Assessment contract/persistence/identity、Health Evolution
  lifecycle、Recovery Guidance、Projection、Snapshot、Scheduler、VERSION_CHAIN 或 AI 调用。

## Out of scope

- `functional_impact`、完整 `overall_health`、health summary producer 或 severity aggregation
  policy beyond the presentation ranking above。
- 每条 issue 的 severity、severity section/badge、英文值、医疗解释、recovery/triage/critical
  语义或新的 Health module。

## Acceptance criteria

- [ ] Core aggregation exposes `severity_summary` without mutating observations or Assessment。
- [ ] Empty active observations produce `normal`；unknown-only produces `unknown`；mixed values
      follow the strict ranking。
- [ ] Inactive severe observations do not affect an active mild summary。
- [ ] Character UI maps ready summaries to “正常”/“有健康问题”/“轻微”/“中度”/“严重”，并
      maps unavailable read model to “暂不可用”。
- [ ] ready + no character entry remains “正常”；unavailable remains distinct。
- [ ] Existing source navigation and issue rendering remain unchanged; no severity English tokens
      or per-issue severity UI are rendered。
- [ ] Focused core/evolution/UI tests cover aggregation, lifecycle filtering, UI mapping, authority
      boundaries, and no extra AI call; broader tests, `node --check`, and `git diff --check` pass。
- [ ] Required Health architecture/UI/state documentation is synchronized and explicitly calls this
      presentation-only summary, not full overall health。

## Evidence anchors

- `core/health-aggregation.js`: existing presentation-only active observation grouping owner。
- `core/health-evolution.js`: active observation lifecycle and severity forwarding；characters are
  created from surviving active observations。
- `ui/characters.js`: existing `healthViewModel()` and “总体状态” rendering boundary。
- `tests/health-evolution.test.js`, `tests/phase2a-ui.test.js`: existing lifecycle, read-model and
  Character Health presentation coverage。

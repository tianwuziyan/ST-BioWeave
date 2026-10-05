# 修复 Character Health 部位 laterality 重复显示

## Goal

修复 Character Health issue 部位标签的 presentation bug：factual `body_site` 已包含方向
信息时，不再由 UI 再次拼接结构化 `laterality`，避免“右右臂外侧”等重复展示。

## Confirmed evidence

- `core/health-aggregation.js` 当前将 Event factual `body_site` 原样放入 observation 的
  `body_site` 与 grouped issue 的 `display_site`，并保留独立 `laterality`；该层没有拼接中文方向。
- `ui/characters.js` 的 `healthDisplaySite()` 当前先读取 `display_site/body_site`，但随后把
  `laterality` 映射为“左/右/双侧/中线”并前置到 site label；这正是重复方向的根因。
- `body_site` 是 factual original-language string，不应在展示层被 localization、ontology 或
  字符串去重规则改写。

## Requirements

- `healthDisplaySite()` 必须优先原样展示非空 factual `display_site/body_site`。
- 不得把 laterality 自动拼接到 factual body-site label；laterality 仍保留在 DTO 中供 grouping/
  metadata 使用。
- `body_site` 缺失时继续显示“未标明部位”；明确 factual 全身性字符串继续原样显示。
- 不修改 Event Analysis prompt/extraction、BiologicalEvent、Health Assessment、severity、
  severity_summary、Health Evolution lifecycle、source navigation、Recovery Guidance、
  Projection、Snapshot、Scheduler、VERSION_CHAIN 或 AI 请求数量。

## Acceptance Criteria

- [ ] `body_site="右臂外侧"`, `laterality="right"` 显示“右臂外侧”，不显示“右右臂外侧”。
- [ ] `body_site="左膝"`, `laterality="left"` 显示“左膝”。
- [ ] `body_site="上臂外侧"`, `laterality="right"` 显示“上臂外侧”，不自动补“右”。
- [ ] 缺失 body_site 仍显示“未标明部位”；明确全身性 factual string 原样显示。
- [ ] grouping key/DTO laterality、severity_summary、source observation IDs 和 source Event
      navigation 行为不变。
- [ ] Regression tests 覆盖上述展示边界，并证明没有字符串 startsWith/replace 去重逻辑。
- [ ] Focused tests、`node --check` 和 `git diff --check` 通过；不得扩大到无关 full-suite 修复。

## Root-cause anchor

- `ui/characters.js:healthDisplaySite()`：重复 laterality 前缀的唯一展示拼接点。
- `core/health-aggregation.js:aggregateActiveHealthObservations()`：只保存 factual site 和
  structured laterality，不需要业务逻辑修改。

## Notes

- This is a narrow presentation bug fix; keep the task PRD-only unless implementation reveals a
  cross-layer contract change.

# 修复 Event DTO location contract

## Goal

阻止模型把 Event `location` 生成为 object，避免单个字段形状错误导致整批多人 Event 分析失败，同时明确说明失败时 Runtime 保留上一份成功结果的既有语义。最终 canonical Event location 仍为 `string | null`。

## Background and confirmed facts

- `core/events.js` 的 Domain canonical location 已通过 `nullableText()` 归一化为 `string | null`，本任务不改变 Domain schema。
- `ai/analyzer.js` 的 raw Event boundary 当前只接受 `location` 为 `string`、`number` 或 `null`；其它形状会抛出 `EVENT_ANALYSIS_LOCATION_INVALID`。本项目的 Event parser 对 JSON envelope 和字段形状采用严格策略，不需要新增 `{display: ...}` compatibility normalization。
- Runtime 先完成 Analyzer parse、Runtime Event identity/source enrichment 和完整 `validateEventCollection()`，成功后才保存 Floor Event 并重建 Registry。分析/响应 schema 失败时，现有失败路径记录 terminal attempt，但保留已有成功 Events 和 Tracking Registry。
- 当前 worktree 已有其它未提交改动，尤其涉及 `ai/prompts.js`、`core/tracking.js`、`runtime/event-analysis.js` 和大量测试；本任务只在目标位置做增量修改，不覆盖或回滚既有用户改动。

## Requirements

### R1. 明确 Prompt location contract

在 `EVENT_ANALYZER_OUTPUT_CONTRACT` 中明确模型输出的 `location` 固定为 `string | null`：已知地点使用抽象字符串示例 `"location": "location_alpha"`，不知道时使用 `"location": null`；禁止 `{"display": "location_alpha"}` 以及其它 object/array 形状。

### R2. 保持 boundary 与 Domain 边界

- 保留 Analyzer 当前 `string | number | null` 的严格 raw scalar 检查，不把 object 传入 Core。
- 不增加 compatibility normalization，不扩大 Domain schema，不修改 `core/events.js`、`core/tracking.js` 或任何生产 UI 文件。
- 如果 Event 输出示例或新增测试 fixture 出现地点值，使用抽象值；Prompt 示例使用 `location_alpha`。

### R3. 增加回归测试

覆盖以下可观察行为：

1. 两个不同 gestational subject 的 pregnancy-related `sexual_activity` Events、字符串 location 能成功分析，`events.length === 2`，Tracking Registry 包含两个 subject。
2. `location: null` 合法。
3. 严格策略下 `location: {display: "location_alpha"}` 被拒绝为 `EVENT_ANALYSIS_LOCATION_INVALID`，且不产生 object location。
4. 给 `charactersPage` 传入两个 `tracking_subjects` 时，人物 UI 输入显示两个人；该回归只修改测试，不修改 UI 实现。
5. 旧成功结果只有 `subject_a` 时，新 raw response 虽包含 `subject_a + subject_b`，但因 location object schema invalid 而失败；旧 Events 和 Registry 保留，Registry 仍只有 `subject_a`，不提交新批次的 `subject_b`。

## Acceptance Criteria

- [ ] `EVENT_ANALYZER_OUTPUT_CONTRACT` 明确写出 `string | null`、字符串示例、`null` 示例和禁止 object/array 形状；仓库中没有本轮新增的 object-location Event 输出示例。
- [ ] `parseEventAnalysisResponse()` 接受两个字符串 location 的 subject-local Events，并接受 `location: null`。
- [ ] `parseEventAnalysisResponse()` 对 `{display: "location_alpha"}` 抛出 `EVENT_ANALYSIS_LOCATION_INVALID`；没有 compatibility normalization，canonical Event 不含 object location。
- [ ] Runtime 多人成功回归同时证明两个 Events、两个 `tracking_subjects` 和两个 `character_profiles` 可用；现有 Tracking eligibility 逻辑不变。
- [ ] UI 回归证明 `charactersPage` 仅消费传入的两个 `trackingSubjects` 并显示两个人；无生产 UI 文件变更。
- [ ] Runtime invalid-response 回归证明本次 analysis 为 failed，上一份成功 Events/Registry 保留，且新 `subject_b` 不进入 Registry。
- [ ] `core/events.js`、`core/tracking.js`、`ui/characters.js`、`ui/app.js` 等受保护生产实现未因本任务新增修改。
- [ ] 运行 `npm run check`、`git diff --check` 及所有本轮修改 JS 的 `node --check`；不 commit、不 push。

## Out of scope

- 不修改 UI 设计、页面实现、事件编辑控件或 `charactersPage` 的生产逻辑。
- 不修改 `core/events.js` 的 canonical location、`core/tracking.js` 的 eligibility、多人物 subject-local Event 模型、Runtime 失败保留机制或存储结构。
- 不兼容任意 object/array location，不添加通用旧 DTO migration，不进行与本问题无关的重构。

## Open questions

无。兼容策略已按现有严格 Event parser 风格确定为 strict rejection。

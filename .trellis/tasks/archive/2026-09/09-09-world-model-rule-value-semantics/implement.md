# World Model 三态语义与 Human baseline 实施计划

当前阶段：implementation complete。以下清单记录本轮实际实施与验证结果。

## Phase 0 — 实施前复核

- [x] 重新检查当前分支 dirty work，确认只处理本任务自己的 diff。
- [x] 对照 prd.md / design.md 和最新 ai/analyzer.js，确认没有新的 schema、UI 或 Runtime 变化。
- [x] 保留现有 fertilization、maturation、biological_type 与 Nonhuman Evidence Gate 回归作为基线。

## Phase 1 — 先写回归测试

在 tests/world-model.test.js 使用全新的原创 fixture，补充：

1. 普通 Human Male 的 cycle、ovulation、gestation、labor（以及 pregnancy/carrying）为 "无"。
2. 普通 Human Female 的四个基础规则为非空简洁 baseline。
3. Human 自定义 type 和非 Human Male/Female 不套 Human baseline，未知规则仍为 null。
4. 明确不存在的原创 Nonhuman 机制为 "无"，未提及机制仍为 null。
5. normalize、final guard、手动 section save 的值不会把 null 与 "无" 混淆。
6. capability false 只在确定关联关系上产生 "无"，未知 capability 不清除规则。
7. Human world override 可以覆盖 baseline 的 "无"，未覆盖字段保留 baseline。
8. fertilization: "无" 保留；普通性交/能量交换等非受精描述仍为 null。
9. 人类、Human、人类 (Human) 归一为一个 人类 entry，并合并不冲突的已建立类型。
10. 非 Human 名称即使相似或带别名形式也不进入 Human canonicalization；已有 unknown-world/biological_type/lifecycle 回归继续通过。

## Phase 2 — Prompt Contract

- [x] 在 ai/prompts.js 合并并精简规则值语义，删除与“未知标量一律 null”冲突的宽泛表述。
- [x] 明确 Human Male/Female baseline 的 absence/present 输出语义、Nonhuman null 边界与 Baseline + Delta 优先级。
- [x] 不加入具体 species、世界体系、fixture 名称或新的关键词示例。

## Phase 3 — Analyzer 最小修正

- [x] 在固定 rule/lifecycle 字段边界增加通用 absence canonicalization，严格保留未知为 null。
- [x] 更新 Human Male baseline 的已知 absence，确认 Female baseline 的非空值不会因 alias 或 guard 丢失。
- [x] 调整 final consistency guard：合法 "无" 不被清回 null，确定的 false-role consistency 使用 "无"，不扩大到未确定字段。
- [x] 增加 Human-only species canonical display 与 canonical duplicate merge；不创建其它 species alias registry。
- [x] 确保 evidence matching 在 Human alias canonicalization 后仍然能找到局部证据，Nonhuman Evidence Gate 不放宽。
- [x] 复查新增/修改代码没有世界观关键词表、fixture-specific if/regex 或新 schema key。

## Phase 4 — 文档

- [x] 在 docs/DATA-MODEL.md 记录规则字段三态、Human Male/Female baseline、Human canonical display 和未知/absence 边界。
- [x] 明确 schema 未变，"无" 是现有 string 字段的 canonical value。

## Phase 5 — 验证与 review gate

- [x] node --test tests/world-model.test.js（111/111）
- [x] npm test（211/211，含新增回归）
- [x] npm run check（通过）
- [x] node --check ai/analyzer.js && node --check ai/prompts.js（通过）
- [x] node --check tests/world-model.test.js（通过）
- [x] git diff --check（通过）
- [x] git diff --name-only 与 git diff --stat 确认没有越过本任务范围；特别确认 storage/schema.js、ui/world.js、Event/State/Projection 未被无必要修改。
- [x] 检查 production Prompt/Analyzer 不含具体世界观专用分类知识。
- [ ] 中文 commit（实现提交阶段执行）。

## 回滚点

实现过程中若 contract 或 merge 行为不稳定，先停止并保留测试证据，只回退本任务新增的产品 diff；不 reset、checkout 或 clean 当前分支上已有修改。schema/UI/Runtime 未改动是本任务的安全边界。

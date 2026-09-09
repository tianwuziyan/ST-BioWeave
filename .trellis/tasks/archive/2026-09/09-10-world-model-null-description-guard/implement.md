# World Model 三态描述规则实施计划

## 1. 实施前检查

1. 保持当前 working tree 的 `.trellis/tasks/09-07-world-model-v1/task.json`、`style.css`、`ui/world.js` 和其它 dirty work 不动。
2. 在 `tests/world-model.test.js` 先补充失败回归，使用新的抽象 species/type 名称，不复刻真实黑盒名称。
3. 用 analyzer trace 或直接 normalized/canonical 断点确认非空 rule 的变化只发生在 final guard。

## 2. Analyzer 最小修改

1. 收窄 `applyWorldModelFinalConsistencyGuard()` 的 fertilization `roleConflict`，删除无 role 证据时对任一 `false` 的兜底清除。
2. 将 `sanitizeHumanType()` 的 capabilities/reproduction rule 合并改为字段级 `current === null ? baseline : current`；不让本地 evidence regex 覆盖已经规范化的 `false`、`"无"` 或非空描述，并移除 Final Consistency Guard 中会覆盖非空 Human fertilization/cycle 的旧 baseline 重写。
3. 不改 `normalizeRuleText()`、`mergeKnownValue()`、`hasTypeSubtreeEvidence()`、`sanitizeNonHumanType()`、Human baseline 的取值、Human/Nonhuman species/type Evidence Gate。
4. 复核所有 reproduction/lifecycle fields：capability `null` 不触发清除；capability `false` 的直接结构 absence 仍写入 canonical `"无"`。
5. 不新增 Human-origin registry、转化关键词、source/origin 字段或跨 species baseline fallback；Human-origin continuity 只通过 AI 当前结果表达。

## 3. 回归测试

1. 增加 `null/null`、`null/false`、`false/null` 的非空 fertilization 测试。
2. 增加 recipient/donor 直接 role 冲突仍被清除的测试。
3. 增加 `pregnancy_or_carrying`、`gestation`、`ovulation`、`lifecycle.maturation`、`lifecycle.aging` 在 capability null 时保留的测试。
4. 增加 Human Male/Female Baseline + Delta 优先级测试：当前 `false`、`"无"`、非空描述保留，当前 `null` 才补 baseline。
5. 增加 Human-origin transformed species 的边界测试：当前明确字段可保留，未明确字段不自动继承 Human；不复制 Human biological_type 轴；无 Human-origin evidence 的 Nonhuman 保持 null。
6. 保留明确 false → `"无"`、rule `null`、`"无"`、普通非空字符串、Human baseline、Nonhuman Evidence Gate、biological_type Evidence Gate、special_rules 与 Trace 测试。
7. 把旧 interaction-only 测试改成符合 Prompt Contract 的 Raw `fertilization: null`，避免测试继续要求 Analyzer 做自然语言语义判断。

## 4. 文档同步

- 在 `docs/DATA-MODEL.md` 三态语义段补充：final consistency 只有在 capability 明确为 `false` 且存在直接结构冲突时才介入，`null` 不等于 `false`。
- 在 `docs/DATA-MODEL.md` Human baseline 段补充：baseline 只填当前 `null`，不覆盖 `false`、`"无"` 或非空描述；Human-origin continuity 不继承 biological_type 轴。
- 不修改 `ai/prompts.js`、`storage/schema.js`、`ui/world.js`、Trace UI 或下游模块。

## 5. 验证与提交前检查

1. `node --test tests/world-model.test.js`
2. `npm test`
3. `npm run check`
4. `node --check ai/analyzer.js`
5. `node --check tests/world-model.test.js`
6. `git diff --check`
7. 人工检查 final diff：无新物种知识、无新关键词表、无 `null`→`false` 合并、无 Evidence Gate 放宽、无 UI semantic reasoning、无 unrelated dirty work。
8. 以真实黑盒 Trace 复核 Raw fertilization 非空时 normalized/canonical/UI 均保留完整字符串；若仍为 null，继续在 Analyzer 路径定位而不修改 UI。
9. 额外检查 baseline 回归输出：Human Male/Female 的 explicit current values 没有被覆盖；Nonhuman 无 Human-origin evidence 未获得 baseline；schema/UI/Event/State/Projection 无变化。

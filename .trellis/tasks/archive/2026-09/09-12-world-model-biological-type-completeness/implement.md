# biological_type 完整性与 Prompt 证据召回实施计划

本文件只记录后续实施顺序；当前阶段不执行这些步骤。

## 1. 实施前检查

1. 重新确认工作区和当前 task 状态，保护已有 dirty work。
2. 阅读最新 `ai/prompts.js`、`ai/analyzer.js`、`tests/world-model.test.js` 和
   本 task 的 research/design。
3. 先建立 Raw → normalize → Evidence Guard → canonical 的受控诊断 fixture，
   不修改 analyzer。

## 2. Prompt 最小修改

1. 在 biological_type Contract 中合并“直接或确定性低推理 evidence”的定义。
2. 明确少数、稀有、例外和非主要 type 不能因数量被遗漏。
3. 将“空数组优于错误分类”改为“空数组优于无证据猜测，但遗漏已被输入明确
   证明的稳定 type 也是错误”。
4. 增加每个 species 输出前的 completeness check；强调每个候选独立证据、禁止
   A/B 成对补全。
5. 保留原有 type A–E 成立条件、字段独立 evidence、Human/Nonhuman、fertilization
   和 lifecycle Contract；不添加具体示例世界观。

## 3. 回归测试

1. Prompt 测试断言新 Contract 和 completeness check 存在，且无具体世界观示例。
2. 添加原创“多数 + 极少”与“通常 + 少量例外”场景。
3. 添加只有一个已证据 type 时，Raw 虚构 sibling type 会被拒绝的场景。
4. 添加 Raw 已含有稳定分类但名称需规范化时的保留/删除诊断场景。
5. 确认 type 保留不自动填充 capabilities、rules 或 lifecycle。
6. 运行现有 biological_type、Human baseline、Nonhuman Evidence Gate 和 UI/Trace
   相关回归，防止 Prompt Contract 修改改变其它边界测试。

## 4. Analyzer 条件性决策点

- 如果 Raw 已有候选且 AnalysisInput 有独立稳定分类证据，但 canonical 被
  `hasTypeSubtreeEvidence()` 删除：提出并实现最小通用证据绑定修正。
- 如果 Raw 已经缺少候选：不改 Analyzer，只保留 Prompt 修正和测试/黑盒验证。
- 任何情况下不新增 species/type registry、关键词表、alias、blacklist 或
  fixture-specific 分支。

## 5. 验证命令

```text
node --test tests/world-model.test.js
npm test
npm run check
node --check ai/prompts.js
node --check tests/world-model.test.js
git diff --check
```

## 6. 提交前检查

- 生产 Prompt 无具体世界观、物种、角色卡名称或性别特判；
- Analyzer 若未被证明误删则保持不变；
- 无 schema/UI/Event/State/Projection/Runtime 改动；
- 当前 dirty work 未被回滚或纳入；
- 最终 planning summary 获用户明确批准后，才进入 `task.py start` 和实现。

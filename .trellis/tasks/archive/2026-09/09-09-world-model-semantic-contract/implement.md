# World Model 通用字段语义 Contract 实施计划

## 1. 实施前检查

- [x] 完成当前 Prompt、Analyzer、schema、UI、下游字段引用和 World Model tests 审计。
- [x] 确认不扩展五 capability schema；`lactation`、`regeneration`、`shapeshifting` 当前不需要结构化字段。
- [x] 确认生产源码没有具体幻想 species/type 特判或 registry。
- [x] 在用户批准本规划摘要后运行 `task.py start`，进入实现阶段。

## 2. 实施顺序

1. 只修改 `ai/prompts.js`：合并重复语义，强化稳定 type、空数组、逐字段三态证据、fertilization、lifecycle、temporary state、Human/Nonhuman baseline 和内部自检 Contract。
2. 只在 `tests/world-model.test.js` 增加原创 species/type 回归与 Prompt Contract 断言；保留现有测试，不复刻真实角色卡名称。
3. 若测试证明已有 guard 无法处理某个结构上确定的通用边界，再对 `ai/analyzer.js` 做最小修改；禁止新增世界观关键词、alias、blacklist 或物种知识。
4. 如语义 Contract 需要持久化到已有规范，更新 `.trellis/spec/frontend/state-management.md` 的对应 World Model 条款；不改 schema/UI/下游文档以外的内容。
5. 复读 diff，确认没有引入 schema 外 capability、fixture-specific 词汇或重复 Prompt 教学。

## 3. 验证命令

按风险从局部到全局执行：

```bash
node --test tests/world-model.test.js
npm test
npm run check
node --check ai/prompts.js
node --check ai/analyzer.js
git diff --check
git diff --stat
git diff -- ai/prompts.js ai/analyzer.js tests/world-model.test.js
```

实现完成后还要检查：

- World Model tests 的总数和通过数；
- 全项目 tests 的总数和通过数；
- `npm run check` 是否包含并通过全项目测试；
- git diff 是否只涉及本轮范围；
- 最终 commit message 使用简体中文并基于实际 diff。

## 4. 风险与回滚点

- Prompt 语句虽然不改变 schema，但可能改变模型分类；回归重点是“宁可空数组/`null`，不要猜测”。
- Analyzer 若被迫修改，必须先证明是通用结构 guard，且新增测试不能包含生产逻辑中的原创名称。
- 如发现需要修改 UI、Event、State、Projection 或 AnalysisInput，停止扩展本轮范围并报告，不顺手实现。

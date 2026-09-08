# World Model species biological types hierarchy correction 实现计划

## 顺序清单

1. [x] 先更新 World Model fixture、schema 断言和 Prompt 回归断言，覆盖新嵌套合同、开放类型、species/type 分开识别、默认人类不补齐、明确非人类和名称不触发 capability；确认测试先失败。
2. [x] 更新 `storage/schema.js` 和 `ai/prompts.js`，建立 `species[].biological_types[]` 的单一合同与固定分析指令。
3. [x] 更新 `ai/analyzer.js` 的嵌套规范化、严格校验和安全过滤；确认旧 flat 输入不会被猜测性迁移。
4. [x] 更新 `ui/world.js` 的查看/编辑层级和 `ui/app.js` 的表单解码、draft 增删动作；继续使用现有 normalize/save 边界。
5. [x] 同步 `docs/UI.md`、`docs/DATA-MODEL.md` 中的层级说明，不扩展 World Model 范围。
6. [x] 运行定向 World Model 测试，修复回归；再运行所有 `npm test`、`npm run check` 和每个修改过 JS 的 `node --check`。
7. [x] 做一次全局搜索确认不存在继续读取/渲染/编辑顶层 `biological_types` 或 species 级 capability 的 World Model 代码；复核 diff 只覆盖本任务范围。
8. [x] 最终用固定回归样例确认：只出现男性→人类/男性；男性+女性→人类/男性、女性；明确剑灵基本男性且极少女剑灵→剑灵/男性、女性；仅识别 species 不会生成 biological type，类型名称不会自动生成 capability。

## 验收命令

```bash
node --test tests/world-model.test.js
npm test
npm run check
node --check ai/analyzer.js
node --check ai/prompts.js
node --check storage/schema.js
node --check ui/world.js
node --check ui/app.js
```

## 风险与回滚点

- schema 形状变化是主要风险：若任何旧调用仍构造 flat model，定向测试会暴露；统一改为 `species: []` 或嵌套对象，不增加兼容分支猜测归属。
- UI 增删动作是第二个风险：读表单和 draft 更新必须都按 species 索引定位，避免跨 species 添加 type；保留原有 Chat token/save 流程。
- 如果 Prompt 测试和现有真实请求契约发生冲突，只调整 World Model 固定文本与 JSON 字段，不改消息角色或输入收集。
- 回滚只需撤销本任务涉及的 schema、analyzer、prompt、UI、文档和测试修改；不删除用户已有 Chat 数据。

## 开始前检查

- [x] `prd.md`、`design.md`、`implement.md` 已通过最终规划审阅。
- [x] `implement.jsonl` / `check.jsonl` 已提供相关 frontend 规范上下文。
- [x] 用户已批准本规划，任务已通过 `task.py start` 进入实现阶段。

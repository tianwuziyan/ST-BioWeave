# 实施计划

## 执行顺序

1. 进入任务并再次记录基线：当前分支、工作区、已有 diff、World Model 相关文件与测试失败原因。
2. 只修改 `ai/prompts.js` 的核心 World Model 指令：合并重复内容，加入五项成立条件、明确排除轴、单候选复核和 A–E 内部检查；不加入具体例子。
3. 在 `tests/world-model.test.js` 中补充/调整全新的原创 fixture 回归；仅在必要时修复已有未闭合正则，不重写用户现有 UI/Analyzer 测试。
4. 若测试证明确有不可由 Prompt 解决的确定结构错误，再对 `ai/analyzer.js` 做最小通用 guard；默认不改 Analyzer。
5. 逐项运行验证并检查结果：
   - `node --test tests/world-model.test.js`
   - `npm test`
   - `npm run check`
   - `node --check ai/prompts.js`
   - `node --check ai/analyzer.js`（若本轮未改也作为当前工作区语法验证）
   - `git diff --check`
6. 查看完整 `git diff`、`git status` 和变更文件列表，确认没有重置或夹带已有 UI/Analyzer/Trellis 改动；按实际 diff 生成中文 commit message，提交本轮改动并记录 hash。

## 最小修改边界

预计本轮主动修改：

- `ai/prompts.js`：唯一生产行为修改，收紧通用分类 Contract。
- `tests/world-model.test.js`：新增 Prompt/原创分类回归，以及必要的单行语法修复。

默认不修改：

- `storage/schema.js`
- `ai/analyzer.js`
- `ai/input-builder.js`
- `ui/world.js`、`style.css`
- Event、State、Projection、Runtime、宿主入口和 API/Chat storage
- 无必要的产品文档或新增 abstraction/dependency

## 完成判据

实现必须证明：陌生 species 的普通子类、身份、等级、阶段和临时状态不会因名称或“只有一个候选”自动进入 `biological_types`；真正由当前资料明确建立的稳定生理分类仍可进入同一 v1 结构；Nonhuman capability 仍按局部 evidence 保持 `null`；生产 Prompt/Analyzer 没有具体世界观知识。

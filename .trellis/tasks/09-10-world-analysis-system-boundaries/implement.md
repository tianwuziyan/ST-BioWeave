# 实施计划

1. 扩展配置契约
   - 在 `storage/schema.js` 的提示词默认值、normalize 返回对象及扩展默认配置中加入两个空字符串字段。
   - 在 `storage/store.js` 的保存入口合并已存设置与显式 patch，再统一 normalize，避免部分保存覆盖旧自定义字段。
   - 验证旧对象逐字段保留、非字符串回落、20,000 字符截断。

2. 扩展设置页编辑与保存链路
   - 在 `ui/settings.js` 复用现有 textarea helper 添加“顶部 SYSTEM”和“尾部 SYSTEM”及指定说明。
   - 在 `ui/app.js#readWorldAnalysisPromptForm()` 采集两个字段；保持 labels 兼容逻辑和现有草稿/保存状态机。
   - 验证保存成功 round-trip 与失败草稿渲染。

3. 扩展消息构建
   - 在 `ai/prompts.js#buildWorldModelMessages()` 使用现有名称解析和变量展开函数生成可选首尾独立 SYSTEM。
   - 保持四条既有消息构造及相对顺序原样；空值不插入。
   - 不修改 Analyzer、schema、AnalysisInput 或 API 调用层。

4. 添加聚焦回归测试
   - `tests/world-model.test.js`：首尾绝对位置、中间顺序、空值兼容、normalize 长度限制、变量展开。
   - `tests/api-profile.test.js`：两个 textarea 与精确说明、保存读取、旧字段保留、预览首尾顺序。
   - 如现有测试结构已有更窄的归属，优先扩展对应测试而非新建测试文件。

5. 同步直接相关文档
   - 最小更新 `docs/UI.md`、`docs/DATA-MODEL.md` 与 `README.md` 的字段/消息分层说明。

6. 验证与独立复核
   - 运行受影响测试文件。
   - 运行 `npm test`。
   - 运行 `npm run check`。
   - 对变更 JavaScript 运行 `node --check`。
   - 运行 `git diff --check` 并审查实际 diff，确认不可变边界未被触碰。
   - 由独立检查代理复核需求 A–E、UI/预览一致性和配置兼容性。

## 风险文件与停止点

- `storage/schema.js`：若新增字段导致旧字段回落变化，停止并修正 normalize，不写迁移。
- `storage/store.js`：合并仅用于保存入口的缺失字段保留，不改变其它全局设置或 API Profile 保存语义。
- `ai/prompts.js`：若四条既有消息内容或相对顺序发生变化，停止并缩小 diff。
- `ui/app.js`：若需要新建状态层或改变 API Profile 路径，视为越界并停止。
- 测试若暴露当前工作区与任务基线不一致，先报告差异，不用重构掩盖。

## 实现前检查

- [x] PRD、设计和实施计划已通过用户最终审阅。
- [x] `implement.jsonl` 与 `check.jsonl` 各包含至少一条真实 spec/research 上下文。
- [x] 任务已通过 `task.py start` 进入 `in_progress`。
- [x] 实现代理收到精确文件所有权、不可变边界和验收命令。

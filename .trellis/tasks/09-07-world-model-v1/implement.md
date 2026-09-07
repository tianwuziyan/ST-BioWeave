# World Model v1 实现计划

1. 在 `ai/prompts.js` 与 `ai/analyzer.js` 定义固定 schema、中文核心约束、`system + system + assistant + user` 消息、可编辑提示块和响应 JSON 提取/校验。
2. 在 Chat schema 中增加 World Model 元数据的空结构，不改变既有来源/Secret 数据。
3. 在 `ui/app.js` 复用 AnalysisInput 收集流程，接入 World Analysis 任务分配、Chat token、成功替换/失败保留和临时输入预览。
4. 在 `ui/world.js` 实现中文查看/编辑/重新分析/保存界面；不新增复杂后台或可视化。
5. 增加 World Model 回归测试，覆盖 capability null、AI JSON 校验、失败保留、Chat-local 保存和中文空值显示。
6. 运行定向测试、`npm test`、`npm run check` 与修改 JS 的 `node --check`；确认请求使用四段消息分层、不发送格式围栏或完整 schema 代码块，且世界书正文不带内部元字段。

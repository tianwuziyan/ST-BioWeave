# 分析输入收集器与预览实现计划

## 执行顺序

1. 记录 Anima 预览研究结论，确认只借鉴临时构建、分块折叠、实际结果展示。
2. 新增 `ai/input-builder.js`，先补纯函数测试，再实现角色卡、世界书、最近剧情、外部来源和 token estimate。
3. 扩展 `story/seven-days-cal.js` 的公开外部预览 DTO，确保空内容和读取失败不伪造正文。
4. 在 `ui/settings.js` 添加默认收起的调试预览区域和两种模式的安全 HTML 渲染。
5. 在 `ui/app.js` 增加预览临时 state、打开/刷新操作、外部来源读取、模式切换和 Chat 边界检查。
6. 在 `style.css` 添加紧凑、可折叠、移动端不溢出的预览样式。
7. 运行定向测试、`npm test`、`npm run check`，检查字符串输出中没有 API Key/secret/profile 字段。

## 验证重点

- 未选择的字段、entry、最近剧情和外部来源不出现在 AnalysisInput。
- 世界书 entry 按 `source_id` / `entry_id` 保持分组，角色卡 greeting 按 `field_key` 保持顺序。
- 最近剧情 Floor 范围正确，空 Chat 有明确空态。
- 外部来源的插件存在与当前内容为空分离；数据库记忆不伪造内容。
- 预览不触发 `apiClient`，不调用 `context/builder.js`，不写 Chat。
- `raw` 模式只显示白名单 DTO，Secret/API Key 不出现在 JSON 或 HTML。
- 刷新和 Chat 切换不会把旧预览留在新 Chat。

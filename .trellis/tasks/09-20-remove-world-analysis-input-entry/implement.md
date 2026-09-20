# Implementation Plan

1. 从 `ui/world.js` 移除 World 页面入口按钮。
2. 从 `ui/app.js` 移除仅处理 `world-model-view-input` 的 action 分支；保留
   `open-analysis-debug` 及预览相关处理。
3. 更新 `tests/world-model.test.js` 的 World 页面断言，更新
   `tests/ui.test.js` 的高级 / 调试测试，使其不再通过已删除的 World 页面入口，
   但继续验证设置页调试预览。
4. 全项目搜索入口文本、action 和预览基础设施引用，确认没有错误删除或死代码。
5. 运行相关 UI 测试、`npm run check`、完整测试集和 `git diff --check`。

## Expected files

- `ui/world.js`
- `ui/app.js`
- `tests/world-model.test.js`
- `tests/ui.test.js`

不修改 AI、Prompt、输入收集和数据来源文件。

# 执行计划

## 前置审计

1. 核对现有 `ui/settings.js`、`ui/app.js`、`style.css` 和 UI 测试中的自定义 debug overlay/state/event/CSS 全部引用。
2. 核对所有 `confirm` 调用和 `notify` 调用，建立迁移清单；确认没有需要保留的业务层原生 confirm。
3. 保持上一轮未提交变更作为基线，不触碰 schema、storage、prompt、Analyzer 和真实 message builder。

## 实现顺序

1. 在 `ui/settings.js` 导出 Popup 内容渲染 helper，复用 `renderAnalysisInputPreview` 并支持 DOM Element/HTML fallback。
2. 在 `ui/app.js` 获取 SillyTavern context，使用 `new Popup(..., POPUP_TYPE.DISPLAY, ..., {wide: true, allowVerticalScrolling: true})` 打开调试内容；为 Popup 内 Preview 动作增加局部事件更新。
3. 删除 `analysisDebugOpen`、自定义 overlay/dialog、backdrop 判断、debug Esc 优先级及无用 modal CSS；保留主 BioWeave Escape、More 和 Toast 行为。
4. 增加 Popup confirm helper，迁移 API Profile 删除和 World Model 草稿放弃确认，移除所有 native `confirm` 调用并为宿主 API 缺失提供 error Toast。
5. 保持现有 `notify()` 和 checkbox 保存链，补充/调整 Popup、confirm、Preview action、Toast 和连续 checkbox 测试。
6. 检查 diff 边界，确认没有 schema、prompt、Analyzer、storage 或 World Model builder 改动。

## 测试计划

### 聚焦测试

```bash
node --test tests/ui.test.js tests/worldbook.test.js tests/world-model.test.js tests/api-profile.test.js
node --check ui/app.js
node --check ui/settings.js
```

需要覆盖：

- Popup 构造参数、`POPUP_TYPE.DISPLAY`、`wide`、`allowVerticalScrolling`；
- Popup 内容包含 Preview/message markers，且刷新与结构/原始模式动作仍能更新内容；
- API 删除和 World Model 草稿放弃使用 `Popup.show.confirm`；negative/cancel 不删除或丢弃；
- 代码不再出现 `globalThis.confirm`/`document.defaultView.confirm`/`window.confirm`；
- 世界书 checkbox 连续切换只保存并调用 Toast，不构造 Popup；
- 现有 `notify` 类型分派和持续组件状态保持不变。

### 完整验证

```bash
npm run check
git diff --check
```

### 范围搜索

```bash
rg -n "analysisDebugOpen|bioweave-analysis-debug-(overlay|dialog|header|close|body)|resolveEscapeAction|isAnalysisDebugBackdropClick|globalThis\.confirm|defaultView\.confirm|window\.confirm" ui style.css tests
rg -n "new Popup|Popup\.show\.confirm|POPUP_TYPE\.DISPLAY|POPUP_RESULT\.AFFIRMATIVE|notify\(" ui tests
git diff --name-only
git diff -- storage/schema.js storage/store.js ai/prompts.js ai/analyzer.js ai/input-builder.js
```

## 风险与检查点

- Popup 内容脱离 BioWeave root 是最高风险：必须通过 Popup content 自己的事件委托验证刷新/模式切换，而不是只验证静态 HTML。
- Popup 构造的 Element 兼容性依赖真实 host；Node 测试只验证传入对象和回退字符串，最终需要 SillyTavern Desktop/Tablet/Mobile smoke。
- 将 `canDiscardWorldModelSectionDraft` 改为异步可能影响多个 world action；所有调用点必须 await，确认取消时不能继续切换、分析或删除。
- 若发现任何越界业务文件被修改，停止并恢复本次越界改动后再继续。

## 完成门槛

- 完成 Popup/toastr 分工调整和旧 modal 清理。
- 聚焦测试、完整 `npm run check`、两个 `node --check` 和 `git diff --check` 全部通过。
- 报告 Popup 使用点、Toast 使用点、删除的自定义 modal 代码、修改文件和真实宿主验收项。

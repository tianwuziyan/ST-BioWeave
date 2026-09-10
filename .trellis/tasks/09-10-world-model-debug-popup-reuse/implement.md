# 实施计划

1. 读取并确认现有 Popup 实现
   - 核对 `openAnalysisDebug()`、`renderDebugPopupContent()`、`renderAnalysisDebugPopupContent()`、Popup content listener 和 `refreshAnalysisPreview()` 的现有契约。
   - 确认当前工作区中前一项 SYSTEM 配置改动及其它并行任务提交不被回退。

2. 统一 helper 与 prompt 来源
   - 移除 helper 的 settings route 限制并改为显式 draft 选项。
   - 设置入口使用草稿；World Model 入口使用已保存 prompt；两者均复用同一 Popup content/事件委托。

3. 清理 World Model 旧内嵌状态
   - 删除 `showAnalysisInput`、`toggleWorldModelInputPreview()`、World route 对该状态的传递、worldPage 旧 preview 参数/渲染/import。
   - 固定按钮文字，保留 action。

4. 增加回归测试
   - 更新 `tests/ui.test.js` 双入口 Popup 构造、内容一致性、Popup 内刷新/模式事件及 prompt draft/保存值来源。
   - 更新 `tests/world-model.test.js` 页面无内嵌 preview、按钮固定文字和旧参数不再产生 debug card。
   - 搜索确认 `showAnalysisInput`、`toggleWorldModelInputPreview`、World Model 内 `renderAnalysisInputPreview` 无生产代码残留。

5. 验证与独立复核
   - 运行聚焦 UI/World Model 测试与 `npm test`/`npm run check`。
   - 对所有变更 JavaScript 执行 `node --check`，运行 `git diff --check`。
   - 由独立检查代理复核单一 helper、草稿边界、Popup DOM 事件委托、不可变业务边界和真实宿主限制。

## 风险停止点

- 若 World Model route 无法获得已保存 prompt，停止并修正读取 fallback，不把设置页 draft 作为隐式全局值。
- 若删除 `showAnalysisInput` 影响 Trace 或设置 Popup，恢复仅必要的 `analysisPreviewState` 路径，不重新引入 World Model 内嵌状态。
- 若测试需要复制 renderer 或 Popup 事件逻辑，停止并回到统一 helper 设计。

## 完成记录

- [x] 现有 Popup helper、World Model 旧链路和 prompt 来源已审计。
- [x] helper 已统一为 `openAnalysisDebugPopup()`，并区分 settings draft 与 World Model saved prompt。
- [x] World Model 旧内嵌状态、渲染和 renderer import 已删除，按钮文案固定。
- [x] 双入口、Popup content 事件、prompt 来源和无内嵌 preview 测试已补充/更新。
- [x] 聚焦测试、`npm test`、`npm run check`、`node --check`、`git diff --check` 已通过。

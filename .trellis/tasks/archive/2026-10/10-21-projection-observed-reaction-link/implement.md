# 实施计划：正文生理反应与推演卡片关联

## 1. Core 精确匹配

- [x] 在 `core/projection-eligibility.js` 增加内置卡片与结构化症状的精确匹配函数。
- [x] 复用 `healthAssessmentEligibility()`、`builtInPreConfirmationBranchForConcern()` 和 `differenceStoryTime()`。
- [x] 只实现 `nausea -> pre_confirmation_observation:nausea`，其他 kind 失败关闭。
- [x] 覆盖人物隔离、状态/角色限制、时间段限制、Story Time 不可比较、描述不参与匹配的纯函数测试。

验证：运行相关 Core 测试，确认输入对象未被修改。

## 2. Runtime DTO 关联

- [x] 让 `projectionRuntime.getBusinessData()` 接收已有 Event business snapshot，不重复执行完整业务读取。
- [x] 校验 Event snapshot 与 Projection endpoint 的 Chat/Floor/Swipe/六字段版本一致性；不一致时不输出命中结果。
- [x] 在内置 Projection 产品 DTO 增加 `observed_reaction.matched`。
- [x] 保持 Projection `status`、lifecycle、context visibility 和持久化完全不变。
- [x] 在现有 Debug DTO 中输出有界匹配诊断，不输出正文和敏感内容。
- [x] 补充 Runtime 测试：同人物命中、不同人物不命中、阶段不符、Event 删除/编辑、Floor/Swipe 失效、阶段替换、无额外读写。

验证：Projection Runtime 测试确认一次业务快照、只读计算、无 lifecycle/persistence 调用。

## 3. UI 标注

- [x] 更新 `ui/projection.js`，使用 `.bioweave-projection-signal-head` 包裹标题和可选 badge。
- [x] 仅在 `observed_reaction.matched === true` 时显示 `已触发`。
- [x] 保留“当前可能出现/始终可能”、删除按钮与现有 `data-bioweave-*` hook。
- [x] 更新 `style.css`，让 header 跨两列、标题可收缩、badge 不换行，不改现有响应式列数。
- [x] 增加 UI 回归测试，确认未命中时无 badge、命中时只标对应卡片、普通 HTML 不泄漏 Event ID。

验证：检查 Desktop 1200×800、Tablet 1024×800、Mobile 390×844，无遮挡和横向溢出。

## 4. 文档与示例同步

- [x] 更新 `docs/ui-framework.config.json` 的 Projection candidate card contract。
- [x] 更新 `docs/UI_FRAMEWORK.md` 的 badge、数据来源和禁止 UI 推断规则。
- [x] 更新 `docs/UI_FRAMEWORK_EXAMPLE.html` 的对应 HTML/CSS 示例。
- [x] 检查并按可见布局影响同步 `docs/UI_FULL_REFERENCE.html`。
- [x] 更新 `docs/UI.md`，说明“已触发”是 Runtime 只读关联，不代表怀孕确认。
- [x] 检查 `docs/bioweave-data-lifecycle.md`；最终实现未改变其现有描述，无需修改。

## 5. 完整验证

- [x] `node --check` 检查所有变更 JavaScript。
- [x] 运行新增的 focused tests。
- [x] `npm test`。
- [x] `npm run check`。
- [x] 检查 `git diff`，确保没有 Projection schema、lifecycle 或持久化根变化。
- [x] 检查旧实现：本任务是独立读模型增强，不替代旧实现；不得删除既有 factual evolution、阶段替换或 Health Assessment 路径。
- [x] 记录真实 SillyTavern Desktop/Tablet/Mobile 验收仍需刷新已安装插件后执行。

## 风险文件与回滚点

- `core/projection-eligibility.js`：只允许增加纯匹配逻辑，不改变既有 eligibility/evolution。
- `runtime/projection-runtime.js`、`runtime/events.js`：避免重复 business read，避免竞态混合不同 Floor。
- `ui/projection.js`、`style.css`：保留原删除 hook 和状态行。
- UI 规范与示例必须和生产结构同步；若生产实现回退，文档示例一并回退。

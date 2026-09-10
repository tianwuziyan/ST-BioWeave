# 设置页操作反馈 Toast 化

## Goal

将设置页用于瞬时操作反馈的页面内 notice 统一迁移到 SillyTavern 顶部 Toast，消除世界书来源 checkbox 连续操作时的页面高度变化，同时保留 API 测试、AnalysisInput preview、Trace 和其他持续可读状态。

## Requirements

- 在 `ui/app.js` 增加一个薄 `notify(message, type)`，优先调用宿主 `toastr.success/info/warning/error`；无宿主时安全回退到对应 console 方法，不引入第三方库。
- 保存/删除/切换/来源更新/任务分配/默认 API/API 配置/提示词等成功反馈使用 `success`；刷新完成使用 `info`；数量上限和可继续手填的空模型列表使用 `warning`；保存、API、Secret Store 和配置失败使用 `error`。
- `settingsState.notice`、`analysisSourcesState.notice` 不再渲染设置页顶部和世界书来源卡片的瞬时 notice；对应保存生产者改为 Toast。可以保留状态字段用于非 UI 内部过渡，但不得让常规操作创建 `.bioweave-settings-notice`。
- `renderAnalysisInputPreview()` 内部的 preview error、API `testResult`、World Model page notice/Trace/原始返回/normalize 结果和 loading/empty/result 状态不因本任务被删除或强制 Toast 化。
- 世界书 checkbox 必须保留立即更新、保存函数、串行保存和 Chat token 保护；成功/失败改用 Toast，可减少保存完成后的无必要 render。
- 提示词保存的数据和 draft 行为不变，只将成功/失败/宿主不支持反馈改为 Toast。

## Acceptance Criteria

- [ ] Toast helper 的 success/info/warning/error 分派和 console fallback 有单测。
- [ ] API 配置保存/删除、来源切换、任务分配、默认 API、提示词保存和失败路径使用正确 Toast 类型。
- [ ] 世界书来源选择保存成功/失败使用 Toast；连续 checkbox 切换后选择和保存仍正确，设置页没有新增 `.bioweave-settings-notice`，滚动位置不因 notice 变化而跳动。
- [ ] 规则 50 条上限为 warning，模型为空但可手填为 warning；刷新完成为 info。
- [ ] API test result、AnalysisInput error、Trace 和持续页面状态仍在原组件内可读。
- [ ] 不修改 schema、Chat 数据、World Model/AnalysisInput/Analyzer 核心行为或引入通知库。

## Out of scope

- Debug modal shell、Toast UI 自绘、第三方依赖、数据迁移和主 overlay 生命周期重构。

## Dependencies

- 与 `09-10-analysis-debug-dialog` 共用 `ui/app.js`、`ui/settings.js` 和测试文件；父任务协调顺序，禁止并行写入重叠文件。
- 待父任务最终规划摘要获批后才能 `task.py start`。

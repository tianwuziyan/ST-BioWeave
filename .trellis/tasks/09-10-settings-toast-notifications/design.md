# 技术设计

## 通知边界

- `notify(message, type)` 是唯一设置操作 Toast 入口：清理空文本，优先取 `documentRef.defaultView.toastr`，再取 `globalThis.toastr`，缺失时按类型调用 console fallback。
- 成功/刷新/警告/错误的类型由操作语义决定，不从字符串猜测类型。
- `settingsState.notice` 与 `analysisSourcesState.notice` 的瞬时写入迁移到 notify；`analysisPreviewState.error`、`settingsState.testResult`、`worldModelState.notice` 和 trace 数据继续由组件渲染。

## 保存链

- 保留 `persistAnalysisSettings` 的 Chat token、request sequence 和串行 save；完成时 notify success/error。
- 来源 checkbox 仍立即同步状态并 render，保存完成后使用 `renderAfterSave: false`，避免仅为 Toast 再重建设置页；失败不改变当前选择，使用 error Toast。
- 其他设置保存若需要重建表单以显示 normalized 数据，继续 render，但不插入页面 notice。

## 覆盖范围

- API request settings/profile 保存、删除、API source/default profile、assignment、world prompt、recent story/global regex、source refresh/selection、model refresh 等瞬时反馈均按 acceptance 映射。
- API test result 和 preview error 不改成 Toast-only；若基础设施错误原来只写 notice，需确保用户仍能看到安全错误（组件结果或 error Toast，不能静默）。

## 测试和风险

- 直接单测 notify 的宿主 window/globalThis 分派和 fallback；操作测试检查关键保存路径调用 Toast。
- 搜索全部 `settingsState.notice`、`analysisSourcesState.notice` 和 `.bioweave-settings-notice` 输出，防止遗漏造成布局跳动。
- 不变更 schema、Chat 内容、World Model request、Analyzer guard 或第三方依赖。

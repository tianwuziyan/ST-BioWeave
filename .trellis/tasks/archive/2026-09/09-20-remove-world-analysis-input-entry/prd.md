# 删除世界分析页面的分析输入入口

## Goal

仅从 World Analysis 正常页面删除“查看本次分析输入”入口，保留高级 / 调试
弹窗及其 Analysis Input Preview、message preview、structure preview、raw
preview 能力。

## Confirmed scope

- World 页面入口由 `ui/world.js` 渲染 `data-bioweave-action="world-model-view-input"`。
- `ui/app.js` 中同名 action 分支仅服务该入口，可随入口删除。
- `openAnalysisDebugPopup()` 仍由设置页 `data-bioweave-action="open-analysis-debug"`
  调用；`renderAnalysisInputPreview()`、`renderAnalysisDebugPopupContent()`、
  `refreshAnalysisPreview()`、`analysisPreviewState` 及相关预览 action 仍被调试功能使用。

## Requirements

1. 删除 World Analysis 页面上的“查看本次分析输入”按钮及其专属 action 分支。
2. 保留设置页高级 / 调试弹窗和全部仍有调用的预览基础设施。
3. 不修改 World Model 分析、Prompt、AnalysisInput 收集、来源选择、世界书、
   角色卡、开场白或 API 调用逻辑。
4. 更新相关 UI 测试，验证入口消失且高级 / 调试预览仍可打开、刷新并切换模式。
5. 通过全项目搜索确认没有遗留仅服务于该入口的死代码或 action 字符串。

## Acceptance Criteria

- `worldPage()` 输出不包含“查看本次分析输入”及
  `world-model-view-input`。
- `ui/app.js` 不再处理 `world-model-view-input`，但仍处理
  `open-analysis-debug`、`refresh-analysis-preview`、`analysis-preview-mode`、
  `analysis-preview-type`。
- 设置页高级 / 调试预览测试继续通过，且保留 message preview、structure/raw preview。
- World Model API 调用和正常分析按钮行为不变。
- 相关 UI 测试、`npm run check`、完整测试集和 `git diff --check` 通过。

## Out of scope

- 不删除或重构 Analysis Preview 基础设施。
- 不修改 `ai/`、Prompt、AnalysisInput、Worldbook、角色卡、开场白或 API 层。
- 不提交、不推送。

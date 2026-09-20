# Technical Design

## Change boundary

入口渲染在 `ui/world.js`，入口事件 glue 在 `ui/app.js`；高级 / 调试预览由
设置页的 `open-analysis-debug` action 进入同一个 `openAnalysisDebugPopup()`，
因此只移除 World 页面按钮和同名 action 分支。

## Data flow preserved

```text
Settings page open-analysis-debug
  -> openAnalysisDebugPopup
  -> renderAnalysisDebugPopupContent
  -> renderAnalysisInputPreview
  -> refresh-analysis-preview / analysis-preview-mode / analysis-preview-type
```

World 页面不再提供入口，但 World Model 的 `world-model-reanalyze` action
仍调用原有 `analyzeWorldModel()`，其 `collectCurrentAnalysisInput()` 调用不变。

## Risk and compatibility

- 删除 action 分支不会影响调试弹窗，因为两者使用不同 action 名称。
- 预览状态和 renderer 保留，避免设置页调试能力回归。
- 测试从“World 页面拥有入口”改为“World 页面没有入口”，并保留设置页弹窗
  刷新、消息预览和 raw/structure 模式断言。

# BioWeave Floating Launcher Pre-Audit

本记录只包含审计与实施规划；本轮未修改产品代码、测试或现有文档。

## SevenDaysCal 源码事实

- `injectFab()` 创建固定定位的 `#sp-fab`，使用 Pointer Events、pointer capture、约 5px 拖动阈值、viewport clamp，并把桌面端位置保存到 `localStorage` 的 `sp-fab-pos`。
- click 只有在本次 pointer 操作未被识别为 drag 时才调用现有 `openSchedule()`；因此没有第二套面板实例。
- `injectExtButton()` 通过 `#extensionsMenu`/`#sp_wand_container` 挂载魔法棒入口，并用 MutationObserver 等待宿主菜单出现。
- 初始化阶段同时调用入口注入、弹窗注入和浮标注入；Chat 切换只重置业务任务/视图，不重置浮标位置。
- 现有实现有 viewport clamp，但没有边缘吸附；FAB 的 resize listener、DOM 和部分 observer 生命周期不是完整 destroy contract，extension reload 可能遗留重复 DOM/listener。
- 设置使用全局 `extension_settings[PLUGIN_ID]`，而几何位置使用 localStorage。参考：
  - https://github.com/atonal519/ST-SevenDaysCal/blob/master/index.js
  - https://github.com/atonal519/ST-SevenDaysCal/blob/master/runtime/settings.js
  - https://github.com/atonal519/ST-SevenDaysCal/blob/master/style.css

## BioWeave 当前事实

- `index.js` 已先创建 Runtime 和 App、挂载 UI、注册独立 Host Entry，再 await `runtime.init()`；Runtime 返回 false 或抛异常时菜单仍保留。
- 菜单入口由 `host-entry.js` 独立维护：单文档 WeakMap 去重、`#extensionsMenu` 重建 MutationObserver、click/Enter/Space、unregister 时移除 entry/listener/observer。
- 当前统一 UI 打开入口是 `app.openBioWeave()`，由 `ui/app.js` 的同一 lifecycle/root 管理；不存在名为 `openBioWeaveUI()` 的第二 API。
- Runtime 有 Event Analysis 的可靠状态：`not_analyzed`、`running`、`success`、`failed`、`cancelled`，并提供 `getCurrentFloorAnalysisStatus()`/事件通知。
- World Model 的 `busy` 目前是 `ui/app.js` 内部状态；没有独立、统一的 Runtime launcher status。Projection 当前是视图/数据读取，不代表生成任务正在运行；Active Projection 不能当作 running。
- 当前没有统一的全局 plugin-disabled 状态。`storage/schema.js` 的 `enabled` 是 Chat-local 设置，不能直接作为浮标可见性开关。
- 全局设置由 `extensionSettings.bioweave` 和 storage lifecycle/schema 约束；当前没有 floating launcher 设置字段。位置不应写入 Floor、Snapshot、State、Event、Projection 或 World Model。

## 推荐架构

新增独立 Host Entry 模块（建议与现有 `host-entry.js` 同层的 `floating-launcher.js`），只接受 `openBioWeave`、只读状态适配器、文档/窗口/存储依赖和设置读取器。它不得 import Runtime、Storage、Projection、World Model 或 Event Analysis。

调用链：

```text
activate/enable
  -> createRuntime
  -> createApp
  -> app.mountBioWeave
  -> registerHostEntry(() => app.openBioWeave())
  -> registerFloatingLauncher(() => app.openBioWeave(), readOnlyStatusAdapter)
  -> await runtime.init()
```

Floating Launcher 与魔法棒入口必须共享同一个 `app.openBioWeave` callback，不得创建第二个 App、Panel 或 Runtime。disable 时按 unregister launcher、注销菜单、destroy UI、destroy Runtime 的现有生命周期清理全部 listener、observer 和 DOM。

## 状态与持久化建议

- `idle`：没有权威任务处于 active；Event Analysis settled/not-analyzed 可归入此状态。
- `running`：仅由权威任务的 active 状态触发。Event Analysis 可直接使用现有状态；World Model 需要未来暴露只读状态 seam；目前不能由 launcher 读取内部状态。
- `success`：由 terminal success/commit 事件派生，仅作为短暂视觉反馈，不持久化。
- `error`：由权威任务失败或显式 UI/Runtime 错误派生；不能把缺少 Chat/Floor/Projection 当错误。
- `disabled`：需要明确语义。建议由新的全局 `show_floating_launcher` 控制可见性，不能复用 Chat-local `enabled`。
- `show_floating_launcher` 与 `floating_launcher_snap_to_edge` 应属于全局 UI preference。几何位置建议先采用命名空间化 localStorage，跨 Chat、Swipe 和 extension reload 保留；若要求跨设备同步，再增加 global `ui_preferences` 字段并同步 lifecycle/schema/tests/docs。

## 实施前真实决策点

技术上已有足够的 UI lifecycle 和 Host Entry seam，可以进入小范围实现。但开始写代码前必须确定两点：

1. World Model 及未来任务的只读聚合 launcher status seam；不能让 launcher 直接依赖 `ui/app.js` 私有状态。
2. `disabled` 的产品语义，以及几何位置采用 device-local localStorage 还是 global settings 同步。

其余风险可通过独立模块、稳定 DOM id、幂等 mount、Pointer Events、clamp、destroy contract 和宿主 DOM 重建测试控制。

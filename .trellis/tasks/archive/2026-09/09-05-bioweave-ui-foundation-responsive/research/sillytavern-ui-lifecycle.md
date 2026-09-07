# SillyTavern UI lifecycle research

## 实测环境

- 通过已连接的真实 SillyTavern 页面检查桌面、1024×800 Tablet viewport 和 390×844 Mobile viewport。
- 当前工作区代码与页面已安装扩展版本不完全一致：页面 footer 显示旧的 `v0.2.1-dev`，页面中的旧 UI class 为 `.bw-*`；workspace 本轮只允许使用 `bioweave-*`，不能把旧安装版本当作工作区实现。

## 观察结果

1. `#extensionsMenu` 是 `document.body` 下的宿主下拉节点，默认 `display: none`，使用 `position: absolute`、滚动 overflow 和约 `z-index: 29999`；魔法棒按钮为输入区附近的 `#extensionsMenuButton`。
2. BioWeave 旧安装版本的 panel 已经可以作为 body 直接子节点存在；点击入口后 `#extensionsMenu` 隐藏，panel 仍 connected。这证明主 UI 不应放入 menu，并且 overlay z-index 需要高于宿主 menu。
3. SillyTavern 的菜单按钮使用 jQuery fade 和内部 `isDropdownVisible` 状态切换。入口处理器不应额外调用 `document.body.click()` 去模拟宿主收尾，否则可能与宿主内部状态/动画产生竞态。
4. 在 390×844 实测中，按钮 DOM rect 可见但 `elementFromPoint()` 命中了 `#right-nav-panel` 或 `#left-nav-panel`；当前页面的酒馆左右抽屉处于 pinned/open 状态，真实指针事件落在抽屉，而不是魔法棒。关闭/取消 pinned 抽屉后才能把“入口不触发”和“点击被宿主抽屉遮挡”区分开。
5. Tablet viewport 下，当宿主抽屉不覆盖入口时，菜单入口可以打开 panel；这条旧观察只用于区分指针命中与窗口显示问题。后续真实设备要求明确不接受“先手动关闭 drawer”作为解决方案，因此主窗口必须使用独立高层级宿主。

## 采用的实现结论

- 入口项只存在于 `#extensionsMenu`；主 UI 使用 `document.documentElement` 下的 `#bioweave-overlay` / `#bioweave-panel`。
- 使用 canonical `click` 同步 open，并保留键盘入口；不取消 click、不叠加 pointer/touch listener、不人工触发 body click，让同一 click 继续冒泡给宿主收起菜单。
- observer 需要可销毁，并能应对宿主重建 `#extensionsMenu`；重复注册必须先退休旧 observer，root 的存活判断必须依赖 `isConnected`/document containment，而不是缓存变量是否为 null。
- 真实设备验收时仍可用 `elementFromPoint()` 诊断入口命中，但不得要求用户先处理 pinned/open drawer；不新增 BioWeave 顶部替代入口。

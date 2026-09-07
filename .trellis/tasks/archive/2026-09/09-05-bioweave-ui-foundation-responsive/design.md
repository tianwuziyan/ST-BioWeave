# BioWeave UI Foundation / Responsive 技术设计

## 1. 变更边界

当前差距位于宿主入口到 UI overlay 的边界，而不是 AI 或业务数据层。真实设备复测表明 `document.body + inset: 0 + z-index: 30000` 与延迟 open 的组合只在 Desktop 可见。构画当前源码采用同步菜单 click、挂在 `document.documentElement` 的独立 fixed 主窗口宿主，以及 `2000001` 的独立高层级；手机样式还明确避开 `inset: 0`。本轮仅收敛这条接入差异。

本轮只修改以下现有模块：

- `index.js`：菜单项注册、宿主菜单时序、幂等 observer 和入口生命周期。
- `ui/app.js`：稳定 overlay/panel、mount/open/close/destroy、路由壳、主题和 focus 状态。
- 现有 `ui/*.js`：只补齐占位页面和人物详情壳需要的渲染输入，不建立业务存储。
- `style.css`：overlay/panel 容器、三个响应式断点、安全区、主题 token。
- `tests/`：在现有测试体系中增加少量 DOM/lifecycle 回归覆盖。

不新增生产架构文件，不修改 `runtime/`、`storage/`、`ai/`、`story/`、`context/` 的业务契约。

## 2. 宿主入口与生命周期契约

### Menu boundary

`#extensionsMenu` 是宿主临时菜单，只承载 `#bioweave-extensions-menu-entry`。注册器使用稳定 ID 和自有标记清理重复项；每个 document 只能有一个 active registration，重新初始化时先调用旧 unregister，连同旧 handler 和 `MutationObserver` 一起退休，再安装新引用。`MutationObserver` 观察稳定的 `document.body` 子树，以便宿主重建菜单后重新挂载入口，并在 `destroyBioWeave()` 时断开。

菜单项使用宿主已经触发的 canonical `click` 事件，同时提供键盘 Enter/Space。与构画一致，click 处理器同步调用 `openBioWeave()`，不调用 `preventDefault()`、不等待 timer、不主动调用 `document.body.click()`，也不叠加 touchstart/pointerdown。主窗口在初始化阶段已 mount，因此同步 open 只切换自有宿主显示状态。菜单重建仍由现有幂等 observer 恢复单一入口。

### Stable UI boundary

生产结构为：

```text
document.documentElement
└── #bioweave-overlay.bioweave-overlay
    └── #bioweave-panel.bioweave-root.bioweave-panel
```

overlay 是唯一的稳定 light-DOM 宿主，不能追加到 `#extensionsMenu` 或 `body` 的临时抽屉/菜单子树。`mountBioWeave()` 先查找并复用仍在 document 中的 overlay/panel；缓存引用如果 `isConnected` 为 false，必须丢弃并重新查找/创建。`openBioWeave()` 每次确保 mount 后显示，`closeBioWeave()` 只隐藏，`destroyBioWeave()` 解绑自有监听、断开订阅并移除自有 DOM。所有操作都可重复调用。

### Host stacking and viewport

overlay 使用构画同量级的 `z-index: 2000001`，高于宿主 `#extensionsMenu` 与移动 drawer，并以 `position: fixed`、显式 `top/left/width/height`、`box-sizing: border-box` 和安全区 padding 覆盖可视区域。避免依赖在目标移动浏览器上不稳定的 `inset: 0`。尺寸先提供 `100vw/100vh` fallback，再使用 `100dvw/100dvh`；panel 内部滚动而不是让 body 横向滚动。移动底部导航将 `env(safe-area-inset-bottom)` 纳入尺寸/内边距。overlay 默认 `pointer-events: none`，只有 panel 恢复交互，因此无需先关闭酒馆 drawer。

## 3. UI 壳与路由

app 保持轻量的单文件路由状态：`activePage`、`focusedCharacterId`、`moreMenuOpen` 和 presentation-only theme。页面 key 为 `overview`、`characters`、`events`、`projection`、`genealogy`、`world`、`settings`、`state`；人物列表进入 `characters` 的详情分支后渲染状态、事件、推演、关系、备注五个子页签壳。focus 只改变当前 UI 视图，不创建或切换 Chat scope。

导航使用同一组 route/action data attributes：

- Desktop：完整左侧导航。
- Tablet：顶部紧凑导航和内容区。
- Mobile：单列内容区和底部四个常用项；“更多”打开真实 menu，再由菜单按钮导航到 genealogy/world/settings/state。

`moreMenuOpen` 是 DOM 渲染状态，菜单项本身带真实 route action；点击 route 后关闭菜单并更新页面，不依赖只切 CSS class 的隐式行为。占位页面通过现有 page module 或同等小粒度函数返回静态/empty state DTO，后续可直接替换 selector。

## 4. Theme contract

theme 值域固定为 `tavern`、`light`、`dark`，使用现有 `bioweave_ui_theme` localStorage key。`tavern` token 优先引用 SillyTavern `--SmartTheme*` 变量；`light`/`dark` 只覆盖 BioWeave 自己的 token。主题按钮在 panel header 中保持可访问，三个断点都可操作；应用主题只更新 BioWeave root 的 `data-theme`，不写 body class、不刷新页面。

## 5. 防回归策略

- lifecycle 测试使用轻量 fake DOM 验证：创建一次、重复 open 不复制、close 后 open、detached root 会重新创建、destroy 后不保留 DOM/监听。
- 菜单注册测试验证 canonical click 同步打开且不被取消，同一 menu 只有一个稳定 ID，宿主 menu 重建后能恢复入口，重复注册会永久断开旧 observer，且销毁后不复活。
- 静态检查确认 workspace 生产代码不引入 `bw-*`、`bio-*`、`BioState`，不再使用全局 body click 关闭宿主菜单。
- 真实手工测试按 Desktop → Tablet → Mobile 顺序进行；每个尺寸都验证入口、关闭重开、路由、主题、横向溢出和安全区。

## 6. 回滚形态

若真实宿主验证发现新 overlay 仍受宿主布局影响，可只回滚 `index.js` / `ui/app.js` / `style.css` 的本轮 diff；不删除 Chat 数据，不变更 runtime/storage。菜单入口仍只使用宿主 `#extensionsMenu`，不增加顶部常驻按钮或要求用户先关闭 drawer 作为替代路径。

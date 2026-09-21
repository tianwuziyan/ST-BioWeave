# Design

## Boundary

本次只调整 Floating Launcher 的视觉渲染与全局 UI preference 接线。Host Entry
和 Runtime Activity 的行为保持不变；不触及业务 Runtime、分析任务、Projection、
Floor、Snapshot 或 Storage schema 的业务字段。

## Shape

- `floating-launcher-theme.js`：仅保存三种主题 ID、默认值和纯归一化函数，供设置契约与 Host UI 共用。
- `floating-launcher.js`：继续通过 callback 接收 preferences；挂载一份固定 SVG，使用 `data-theme` 切换 CSS 变量。
- `storage/schema.js` / `storage/store.js` / `storage/lifecycle.js`：把主题作为现有全局 UI preference 纳入默认值、归一化、读写和生命周期登记。
- `ui/settings.js` / `ui/app.js`：在现有 Floating Launcher 设置组加入可键盘操作的 select，并沿用现有 preference callback 立即刷新 Launcher。
- `style.css`：只替换 Floating Launcher 视觉块，保留固定定位、z-index、命中区域、safe area、状态与 reduced-motion 约束。

## Compatibility

旧设置没有主题字段时使用 `midnight-indigo`。非法值也回退默认。位置仍使用已有
device-local key；主题不写入 Chat 或任何业务数据。

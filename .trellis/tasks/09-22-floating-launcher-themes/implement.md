# Implementation Plan

1. 核对当前未提交 diff 与 Floating Launcher / Settings / lifecycle 链路。
2. 增加共享主题常量与安全归一化，接入全局设置默认值、schema、store、lifecycle。
3. 将现有 Font Awesome 状态图标替换为固定内联 SVG，并以主题属性驱动 CSS 颜色。
4. 在现有 Settings 设置组增加主题选择，接通立即预览与持久化。
5. 同步 README、UI framework 配置/指南、生命周期文档及必要示例。
6. 扩展 Floating Launcher 定向测试，覆盖默认、合法/非法主题、持久化和即时切换。
7. 执行语法检查、定向测试、完整检查与 diff 检查；只报告，不 commit/push。

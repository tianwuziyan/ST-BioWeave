# BioWeave UI Foundation and Responsive opening fix

## Goal

Locate and fix Tablet/Mobile BioWeave opening failures, stabilize menu-to-overlay lifecycle, and complete the responsive UI shell without entering API Profile, Worldbook, or World Model development.

## Requirements

- 以真实 SillyTavern 的 `#extensionsMenu` 行为为准：BioWeave 只在其中注册一个入口项，主 UI 使用与构画一致的稳定 `document.documentElement` 宿主，不能成为菜单的子节点。
- 明确实现 `mountBioWeave()`、`openBioWeave()`、`closeBioWeave()`、`destroyBioWeave()` 生命周期。首次打开、关闭后再次打开、Chat 切换后再次打开、插件重复初始化都必须安全且幂等。
- 修正移动端触摸/点击与酒馆临时菜单关闭之间的时序问题：沿用构画已验证的 canonical `click` 同步打开，不取消事件默认行为，不增加 touch/pointer 双重触发，也不使用全局 `document.body.click()` 伪关闭方案。
- 主 UI 壳严格覆盖 UI v2.0 的三个断点：桌面左侧导航，Tablet 顶部/紧凑导航，Mobile 单列与底部导航。
- Mobile 底部导航必须包含“总览、人物、事件、推演、更多”；“更多”必须是真实可打开的菜单，提供家系图谱、世界模型、设置、分析状态入口。
- 使用占位/empty state DTO 完成总览、人物列表、历史事件、推演预测、家系图谱、世界模型、设置，以及人物详情的状态/事件/推演/关系/备注路由壳；不创建新的业务数据库。
- 主 UI 直接提供“跟随酒馆、日、夜”主题按钮；切换立即生效、使用 CSS variables、持久化选择且不修改 SillyTavern 自身主题。
- 移动端不得出现普通页面横向溢出；overlay/panel、滚动区域、底部安全区使用可靠的宽高、`dvh` fallback、`env(safe-area-inset-*)` 和 z-index 约束。
- 增加少量 DOM/lifecycle 回归测试，并保留明确的 Desktop → Tablet → Mobile 真实 SillyTavern 手工验收步骤。

## Scope Boundary

- 本任务只处理入口、UI 挂载/打开生命周期、响应式壳、占位路由、主题和相关测试。
- 本任务不实现 API Profile、Worldbook selector、World Model schema/analysis、Biological Event CRUD、AI 生理分析或新的业务存储。
- 不新增 Factory、Registry、Repository、Service 等架构层；优先修改现有 `index.js`、`ui/app.js`、既有 `ui/*.js`、`style.css` 与现有测试。

## Acceptance Criteria

- [x] Desktop、Tablet、Mobile 均可通过魔法棒 → `#extensionsMenu` → BioWeave 打开主 UI。
- [x] BioWeave 主 UI 不挂载在 `#extensionsMenu` 内；酒馆菜单关闭后 overlay/panel 仍在且可见。
- [x] 已打开的 BioWeave UI 层级高于移动端宿主 drawer；验收不要求用户先手动关闭 drawer。
- [x] 关闭后可再次打开；任意时刻只有一个 BioWeave root、一个菜单项和一组事件监听器。
- [x] Desktop 左侧导航、Tablet 紧凑导航、Mobile 底部导航均可用；Mobile “更多”可打开并导航到四个附加页面。
- [x] 总览、人物、事件、推演、家系、世界模型、设置和人物详情五个子页均可导航到。
- [x] 三主题在三个尺寸下可访问、立即切换，并在刷新/重新打开后保持选择；不改变酒馆主题。
- [x] 手机无普通页面横向溢出，iPad/WebView 下 panel、滚动区和安全区布局不破坏。
- [x] 现有测试通过，新增 DOM/lifecycle 回归测试覆盖脱离 document 的旧 root、重复打开和销毁后的重新注册边界。
- [x] 完成手工验收前不进入 API Profile、Worldbook 或 World Model 开发。

## Notes

- 实测页面使用 SillyTavern 1.18.0 的 `#extensionsMenu` 下拉结构；构画当前实现使用同步菜单 click、`document.documentElement` 主窗口宿主及 `2000001` 层级，本轮按该宿主边界修正。
- `prd.md` 只记录需求；技术边界和执行顺序分别记录在 `design.md`、`implement.md`。

## 实际验收记录

2026-09-06：用户在真实 SillyTavern Desktop、iPad/Tablet、手机端完成验收。三端均可通过魔法棒 → `#extensionsMenu` → BioWeave 打开主 UI，移动端不要求预先关闭 SillyTavern drawer；响应式导航、更多菜单、关闭重开和主题持久化均通过验收。

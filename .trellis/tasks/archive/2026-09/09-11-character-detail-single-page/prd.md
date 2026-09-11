# 人物详情改为单页人物卡

## Goal

将 Tracking Subject 的人物详情从互斥 Tab 改为一个可纵向滚动的完整人物卡，让摘要、能力、当前状态、受孕相关记录、推演、关系和备注在同一页面同时可见。人物详情仍只展示 Runtime/Core 已提供的 DTO 或明确空状态，不新增业务计算。

## Background and confirmed facts

- `ui/characters.js:9-15` 定义 `characterDetailTabs`；`ui/characters.js:236-253` 通过 `renderTabContent()` 按 Tab 选择一次渲染一个区块。
- `ui/characters.js:271-275` 同时保留旧 events Tab 内容和页面底部的固定“受孕相关记录”，因此同一 exposure Event 可能重复展示。
- `ui/app.js:392-392`、`2040-2043`、`2093-2120`、`2745-2748`、`2842-2842`、`3059-3073`、`3342-3344` 持有、传递、更新或绑定 `characterDetailTab`。
- `style.css:968-990` 的 `.bioweave-character-tabs` 及 active 状态样式只被旧人物详情 Tab 使用。
- 当前人物列表由 `trackingSubjects` 驱动；`characterProfiles` 单独存在不能构成人物详情入口。详情页已经展示人物摘要、能力、exposure Event 和“等待状态引擎计算”。
- 当前没有接入人物详情的 StateReducer、Projection、Genealogy 结果或正式 notes DTO；这些区域应保持只读空状态。

## Requirements

### R1. 单页人物详情结构

`detailPage()` 只返回一个人物详情页面，固定按以下顺序纵向渲染：

1. 人物摘要：显示名、妊娠追踪 badge、物种、生理类型、折叠的 `character_id` 调试信息。
2. 生殖能力：显示已有 profile DTO 的 capability 三态值。
3. 当前状态：显示“等待状态引擎计算”，不生成 StateReducer 结果。
4. 受孕相关记录：显示 Tracking Subject 的 exposure Event 引用对应的完整用户可读事实。
5. 推演：没有 Projection DTO 时显示“当前没有可显示的生理推演。推演并非已发生事实。”
6. 关系：没有关系结果时显示“尚未建立已确认的亲子或其他关系。”
7. 备注：没有 notes DTO 时显示“当前没有可显示的人物备注。”

普通业务信息默认可见；只有人物调试信息保持折叠。页面继续复用现有 `bioweave-card` / `bioweave-detail-section` 风格，不引入 dashboard 网格、carousel、nested tabs 或主信息 accordion。

### R2. 移除人物详情 Tab

删除人物详情内部的 `characterDetailTabs`、`characterDetailTab` 展示状态、`renderTabContent()`、Tab 按钮及 `data-character-tab`、`role="tab"`、`role="tablist"`、`aria-selected`。`ui/app.js` 不再维护或绑定这套状态与点击事件；顶级导航路由保持不变。

### R3. 保持 UI / Business 边界

- 人物详情只有在 `tracking_subjects` 存在对应 `character_id` 时才可打开；单独存在的 `character_profiles` 不产生详情入口。
- UI 只显示现有 Runtime/Core DTO，不根据 `sexual_activity`、`pregnancy_relevance`、`symptoms`、Story Time、exposure 数量或 capability 计算资格、当前生物状态、妊娠概率、孕周或妊娠天数。
- 本轮不实现 StateReducer、Projection、Genealogy、Snapshot、StoryTime elapsed calculation、Tracking eligibility、Event participant filtering、Runtime Registry、Event AI DTO、Prompt、World Model 或 Phase 2B StateReducer。
- 受孕相关 Event 继续显示完整参与者和 `counterpart`；UI 不依据事件角色文案做业务判断。

### R4. Event 去重

单页人物详情只保留一个“受孕相关记录” section，并只调用一次 `renderExposures(subject, activeEvents)`；同一 exposure Event 不得因为旧 events Tab 和固定 section 同时存在而渲染两次。

### R5. 轻量 section renderer

按现有 plain DOM 轻量架构拆分纯展示函数，例如 summary、capabilities、current state、exposures、projection、relations、notes renderer。函数只接收数据并返回 HTML，不修改 storage、不调用 AI、不修改 Registry，也不做业务推导。

### R6. 文档与样式

- 更新 `docs/UI.md`，说明 Character Detail 是单页人物卡，固定内容为 Summary、Reproductive Capabilities、Current State、Related Events、Projection、Relations、Notes，且不是互斥 Tab；同时说明 UI sections 只展示已有 Business DTO，State / Projection / Relations 不在 UI 层推导。
- 删除仅服务于旧人物详情 Tab 的 `.bioweave-character-tabs` 及对应按钮/active CSS；不影响顶级导航或其它页面。

## Acceptance Criteria

- [ ] 详情 HTML 不包含 `role="tablist"`、`role="tab"`、`data-character-tab` 或 `aria-selected`。
- [ ] `ui/characters.js` 和 `ui/app.js` 不再依赖 `characterDetailTab`，也不保留无消费者的 Tab handler/state。
- [ ] 同一次人物详情 HTML 同时包含“当前状态”“受孕相关记录”“推演”“关系”“备注”五个 section。
- [ ] 无 State、Projection、Relations、Notes DTO 时分别显示四条约定的空状态文案。
- [ ] 一个 exposure Event 在人物详情中只生成一张 Event card；参与者与 counterpart 仍可见。
- [ ] tracking subject 存在时，即使 profile 能力为 `false` / `null`，详情仍显示所有固定 section；UI 不以 capability 或 pregnancy relevance 决定人物是否存在。
- [ ] 只有 `tracking_subjects` 中存在的 `character_id` 能打开详情；仅有 `character_profiles` 的角色返回不可用详情状态。
- [ ] 顶级导航路由仍保留总览、人物列表、历史事件、推演预测、家系图谱、世界模型、设置。
- [ ] 新增或更新 UI regression tests 覆盖上述结构、去重、DTO 边界和 source-level 无 Tab 状态约束；原有 Tracking / Event / Runtime 测试不受影响。
- [ ] `npm run check` 通过。
- [ ] `git diff --check` 通过。
- [ ] 不创建 commit，不执行 push。

## Out of scope

- StateReducer、biological current state、gestational age、pregnancy probability、StoryTime elapsed calculation、Snapshot。
- Projection generation、Genealogy relation calculation、notes persistence。
- Event AI DTO、Tracking eligibility、Core tracking calculation、Runtime Registry、Event participant filtering、Prompt、World Model、Phase 2B StateReducer、Projection engine、Genealogy engine。
- 顶级导航改造或真实 SillyTavern 页面人工验收；本轮只完成代码、自动化回归和文档验证。

## Risks and deferred items

- 未来接入 State / Projection / Relations / Notes DTO 时，需要在 section renderer 的数据入口处扩展，而不是恢复 Tab 或在 UI 推导业务事实。
- 当前 `ui/characters.js` 使用字符串 HTML builder；本轮只做局部 renderer 拆分，保持轻量模块化结构，不引入组件框架或额外 service/registry 层。

## Open questions

无。产品顺序、空状态文案、边界和验证标准已由本轮需求明确。

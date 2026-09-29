# 世界模型页最小 UI 对齐设计

## Ownership and data flow

`ui/app.js` 继续从 Runtime 接收 `worldModelState.model/meta`，经 `worldPage()` 传给 `ui/world.js`。`ui/world.js` 只负责 HTML 投影与已有编辑表单；归档浮层只读取 `worldModelMeta.archived_species`，机制只读取当前类型的 `reproductive_mechanisms`，投影规则只读取 `worldModel.projection_rules`。不新增持久字段、缓存、业务重组或旁路事实源。所有动态文本继续转义。

## UI structure

- 将 `renderSpeciesArchive()` 的入口／浮层嵌入种族标题操作区，入口在新增按钮之前。保持导出函数和现有 `world-model-toggle-archive`、`world-model-restore-species`、归档索引钩子；不再在 `worldPage()` 顶层放独立归档卡。无 World Model 时也保留现有新增种族与归档可达性。
- 浮层使用现有 `archiveOpen` 状态，入口提供 `aria-expanded`、`aria-controls`、可辨识名称；还原按钮保持已有 action。隐藏归档时间只是展示决策，meta 中原有字段与还原原样保持。
- 类型详情中四个可编辑模块仍由 `TYPE_SECTION_KEYS` 渲染。把只读机制模块作为条件项插在生殖规则后；保持 `data-canonical-field="reproductive_mechanisms"`，不加入 `WORLD_MODEL_SECTION_KEYS`、`data-bioweave-world-section` 或编辑器。世界级投影规则同样只读，保留现有 canonical 标记。
- 世界规则的三个滚动区仅限制只读正文；编辑表单不被 180px 容器截断。局部样式限定在 `.bioweave-world-model-page`。

## Event and Escape order

- `ui/app.js` 保留现有委托。点击入口翻转 `archiveOpen` 并重渲染；还原继续调用现有 Runtime 流程。
- 对世界页归档浮层开启状态，点击浮层之外且在面板内部时先令 `archiveOpen=false`，同时允许原点击动作继续执行。点击遮罩仍由现有遮罩关闭面板处理。
- 根节点收到 Escape：若当前世界页归档浮层开启，阻止默认并关闭浮层后返回；否则走现有面板关闭逻辑。因此连续两次 Escape 的顺序为“浮层 → 面板”。绑定与解绑对称，避免重复监听器。若用户正在其它宿主模态交互，沿用现有事件边界，不扩大全局键盘监听。

## Compatibility and visual constraints

保留所有现有 `data-bioweave-*` action、section、form、field、row、索引属性，既有 selection 名称快照、保存失败回退、分析按钮与 Busy 规则均不变。沿用现有 1200/768px 断点与主题变量；不引入效果稿 `body`、demo DTO 或全局 CSS。`docs/UI_FULL_REFERENCE.html` 的旧世界片段按本次局部合同校正，不借此重做其它页面。

## Risks and verification

- 当前 Escape 会直接关闭面板；新增分支须验证浮层优先级及第二次 Escape 的回归。
- 世界页已有多层 CSS 覆盖；新规则按现有最终优先级局部落位，实际三端检查确认布局，没有页面级横向溢出。
- 可编辑模块的长内容不能被只读滚动样式误伤；验证编辑、保存、取消与有／无机制切换。
- Node 检查无法替代真实 SillyTavern 宿主视觉验收；报告中分别列自动检查与实机结果。

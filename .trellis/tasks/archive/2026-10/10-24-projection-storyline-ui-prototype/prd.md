# 推演页候选剧情支线 UI 原型与生产接入

## Goal

先制作一个独立、可直接打开的 HTML 原型，验证“推演 API 返回的非生理剧情支线如何在 UI 中被理解和继续推进”；原型确认后，将同一视觉结构接入生产推演页。生产接入只读当前有效 Floor 解析出的安全 `storyline_snapshots` DTO，不改变 Storyline 生成、判定、持久化和周期生命周期。

## Background / confirmed facts

- 当前生产入口是 `ui/projection.js` 的人物优先页面：左侧人物列表，右侧人物详情，遵循 `250px minmax(0, 1fr)` 的桌面两栏布局。
- 当前页面已经展示观察阶段、已触发生理信号、之后可能出现和结束方式，但尚未展示 `storyline_snapshots` 中 API 返回的候选剧情支线。
- Storyline 领域数据已有 `candidates`、`selected`、`terminated` 等状态；候选阶段固定有 3 条支线，单条支线包含多个有序节点和结论目标。
- API 返回的内容不是已发生事实。UI 必须区分“候选支线”“已选支线”“当前推进节点”和“最终结果”。
- 视觉必须遵循 `docs/ui-framework.config.json`、`docs/UI_FRAMEWORK.md` 和 `docs/UI_FRAMEWORK_EXAMPLE.html` 的 BioWeave 深蓝灰主题、低装饰、响应式和可访问性规则。

## Requirements

### R1. 展示候选支线

原型在当前人物详情中增加“候选剧情支线”主区块，展示 API 返回的 3 条路线。每条路线至少包含标题、前提、节点数量和检查/结论目标，并明确标识“候选，不是已发生事实”。

### R2. 展示支线推进状态

原型需要提供可切换的示例状态：

- `candidates`：三条候选路线；
- `selected`：只显示已选路线、节点进度和下一步目标；
- `running`：显示“正在生成候选路线…”和停止按钮样式；
- `terminated` / 空状态：显示本轮支线已结束或尚无结果。

切换仅改变原型内存状态，不调用 API、不写入 Floor。

### R3. 符合当前页面层级

原型保留人物优先结构，并把支线信息放在人物详情内部，不另造全局长列表。候选路线、当前生理信号、正文已触发记录和观察结论要有清晰的视觉层级，不能混成同一类卡片。

### R4. 响应式与可访问性

- Desktop / iPad：人物列表与详情双栏；支线卡片在详情内使用可读的两到三列布局。
- Mobile：人物卡两列、详情单列，支线节点与结束方式堆叠，不出现页面横向滚动。
- 操作控件使用按钮语义、可见焦点、至少 44px 触控命中区，并提供必要的 `aria-label`。

### R5. 原型边界

- 文件必须明确标注为 `PROTOTYPE — 用完即删`，只使用内存中的示例数据。
- 不接入 `ui/app.js`、Runtime、Floor、Storage 或真实 API。
- 不将内部 `character_id`、`branch_id`、Floor Version 或 provenance 显示给用户；示例资料只使用人物显示名称和可读文案。

### R6. 生产接入

- `runtime/projection-runtime.js` 将当前有效 Projection Views 中的 `storyline_snapshots` 投影为安全业务 DTO；只保留人物标识、显示名称、状态、可读支线字段和节点游标，不转发 snapshot/node/Floor provenance 等内部字段。
- `ui/app.js` 将该 DTO 作为业务状态传入 `ui/projection.js`；Chat、Floor、Swipe 边界和清理时同步清空 UI 读模型。
- `ui/projection.js` 在人物详情中增量显示 `candidates`、`selected`、`terminated`；既有生理观察区块保持不变，`selected` 只显示一条支线。
- `style.css` 使用生产 `bioweave-*` 命名空间和现有主题变量，桌面/平板/移动端不产生横向溢出。
- 不把 `storyline_snapshots` 写回 Chat 或 Floor；生产 UI 只消费 Runtime 已解析的当前 endpoint。

## Acceptance Criteria

- [ ] 可直接打开 HTML 文件看到完整推演页，不需要启动 API 或构建步骤。
- [ ] 默认视图能清楚展示 3 条 API 候选支线，并能看出它们不是已经发生的事实。
- [ ] 能在原型内切换候选、已选、生成中和结束/空状态，且每种状态文案和层级正确。
- [ ] 已选状态只突出一条支线，并以节点时间线展示当前目标；不会同时推进其他候选。
- [ ] 视觉使用现有 BioWeave token、组件节奏和响应式规则；桌面与移动宽度均无横向滚动。
- [ ] 原型没有修改生产文件、API 调用、Floor 数据或持久化行为。

## Out of scope

- Storyline API 调用、候选生成、选线判定、正文推进、怀孕/未怀孕事实判定和 Floor 写入。
- 修改 Projection Runtime 的生命周期、Storyline 持久化、周期清理或 Context 注入规则。
- 本原型之外的世界书、人物资料、推演规则或提示词调整。

## Deferred risks

- 生产 UI 最终需要一个明确的 Runtime → UI DTO 入口；本原型只验证视觉结构，不决定该入口的字段命名。
- 实际 API 返回可能存在内容包装或空响应；本原型使用已验证的结构化示例数据，不替代解析器测试。

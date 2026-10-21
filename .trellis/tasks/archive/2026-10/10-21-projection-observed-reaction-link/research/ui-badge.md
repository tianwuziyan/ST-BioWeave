# Research: projection observed-reaction badge

- Query: 审计当前 Projection 页面 renderer、样式选择器、UI framework 文档/示例和响应式行为，设计在匹配候选卡右上角显示“已触发”徽标的最小 UI 变更，同时保留现有状态/删除行。
- Scope: internal
- Date: 2026-10-21

## Findings

### Current renderer and business match

- `ui/projection.js:224-243` 的 `signalCard(item)` 是候选卡唯一 renderer，当前结构为：`<article class="bioweave-projection-signal">` → 直接的标题 `<strong>` → 正文 `<p>` → 状态/说明 `<em>` → `.bioweave-projection-signal-foot`。删除按钮只在 `item.id` 存在时渲染，并使用既有 `data-bioweave-action="delete-projection"` 与 `data-projection-id`（`ui/projection.js:237-243`）。
- `ui/projection.js:22-25` 将 active 候选显示为“当前可能出现”或“始终可能”，其它状态交给 `projectionStatusLabel()`；因此现有 `<em>` 是候选状态语义，不应被徽标替换或挪作删除操作区。
- Runtime DTO 将 Projection 视图的 `factual_status` 映射为 `status`：`runtime/projection-runtime.js:75-78`；`runtime/projection-runtime.js:96-145` 的 `toProjectionDTO()` 输出 `status: viewStatus(view)` 以及用于追溯的 `lifecycle.factual_status`。因此 UI 的“匹配卡”应定义为 `item.status === 'realized'`，而不是检查 `generated_statement`、标题、正文文本或 raw concern key。
- `core/projection-eligibility.js:328-337` 显示 realization 是 Runtime 通过规范化 rule 的 `realization` criteria 匹配 confirmed factual Events 后决定的 `realized` 生命周期状态；这确认了徽标只消费 DTO 状态，不重新执行匹配。
- `docs/UI.md:98-100` 与 `docs/UI_FRAMEWORK.md:212-220` 都要求候选路线保持非事实语义，直到正文提供 matching evidence；“已触发”只能是 Runtime 已确认的 presentation label，不应把普通 active 候选改成已发生事实。

### Smallest proposed HTML/CSS shape

- 最小 HTML 变化只涉及 `signalCard()`：在 `article` 开头增加一个仅当 `item.status === 'realized'` 时出现的 presentation-only `<span class="bioweave-badge good bioweave-projection-signal-observed">已触发</span>`，然后保留现有标题、正文、`<em>` 状态说明和 `.bioweave-projection-signal-foot` 原位置。不要给徽标添加 action/data hook，也不要改变删除按钮的 selector 或 DOM 行。
- 为避免徽标与标题争夺同一行，建议只新增卡片顶部 wrapper，例如 `<div class="bioweave-projection-signal-head"><strong>...</strong><span ...>已触发</span></div>`；该类名已有共享 flex 规则登记在 `style.css:8309-8319`，但当前 `.bioweave-projection-signal-head` 尚未被 `signalCard()` 使用。若采用 wrapper，标题应从现有直接子节点移入 wrapper，正文 `<p>`、状态 `<em>` 和 footer 保持层级/顺序不变。
- 当前卡片 CSS 是两列 grid：`style.css:8474-8488` 设置 `.bioweave-projection-signal` 为 `grid-template-columns: minmax(0, 1fr) auto`，并只把直接子级 `strong,p` 跨两列；`style.css:8490-8500` 已为 `.bioweave-projection-signal-head` 预留 `display:flex; justify-content:space-between; gap:8px` 的标题头形状。最小 CSS 只需确保 wrapper 跨两列（例如 `.bioweave-projection-signal-head { grid-column: 1 / -1; align-items: flex-start; }` 的页面局部规则）和徽标不压缩/不换行；不应重做卡片 grid。
- 复用 `bioweave-badge good`，因为通用徽标契约是 22px 高、`2px 7px`、999px 圆角（`docs/ui-framework.config.json:761-770`；`docs/UI_FRAMEWORK.md:340`），且 Projection 页面已有局部 good tone（`style.css:8161-8171`）。不需要新增颜色 token 或新组件系统。
- 现有 `.bioweave-projection-signal-foot` 仍负责底部状态/删除布局（`style.css:8531-8546`），所以徽标必须放在顶部 wrapper；不得把徽标塞入 footer，也不得用 `:has()` 依赖正文内容。

### Responsive concerns

- Desktop/iPad 共用 `250px minmax(0, 1fr)` 的人物列表 + 详情两栏（`style.css:8247-8253`；`docs/UI_FRAMEWORK.md:220`）。候选 signal 在详情内为三列（`style.css:8468-8472`），顶部徽标应保持卡片内部右上角，不改变候选列数或详情宽度。
- Mobile `<768px` 时 workspace 改为单列、人物列表改为两列、signal/outcome cards 改为单列（`style.css:8591-8623`；`docs/ui-framework.config.json:466-469`）。新增 wrapper 必须 `min-width:0`，徽标应 `flex:0 0 auto` / `white-space:nowrap`，标题允许 ellipsis 或自然收缩；不得引入固定宽度、绝对定位或负 margin，避免窄屏横向溢出。
- 现有 signal 卡自身 `min-width:0`、padding `9px`、border/radius/background（`style.css:8474-8482`），足以容纳 22px 徽标。由于 Mobile 已将 signal 变成单列，不需要新增 mobile 专属排列；只需在 Desktop、Tablet（当前规则与 Desktop 相同）和 390px 级 Mobile 视口检查长标题/徽标组合及页面 `scrollWidth`。
- UI framework 的通用响应式断点固定为 `>=1200`、`768-1199`、`<768`（`.trellis/spec/frontend/component-guidelines.md:45-61`），页面专项规则明确要求 Mobile 不产生页面横向滚动（`docs/UI_FRAMEWORK.md:220`）。

### Documentation/example synchronization

- 若实际实现该徽标，最小同步链应遵循 `docs/ui-framework.config.json:928-945` 的顺序：
  1. `docs/ui-framework.config.json:454-469`：在 Projection `candidateCard`/`candidateStatusLabels` 或相邻 presentation contract 中注明 `realized` 候选显示 `已触发`，并保留 `deleteHook`/`candidateFooter`；若新增专用 class，登记其结构用途。
  2. `docs/UI_FRAMEWORK.md:212-220`：补充“仅 Runtime DTO status=realized 时在候选卡右上角显示已触发徽标；状态/删除 footer 不变”的 HTML/CSS 形状与不从正文文本推断的限制。
  3. `docs/UI_FRAMEWORK_EXAMPLE.html:2114-2175,2342-2367`：同步 `.bw-*` 示例 CSS 与至少一张 realized 候选卡的 top-right badge；示例仍使用 `bw-*` 命名空间，不能把示例类复制回生产代码。
  4. `docs/UI_FULL_REFERENCE.html`：虽然不改变页面骨架，但候选卡的可见布局发生变化，按同步规则中的“full visual reference when layout changes”检查并同步对应 Projection 卡示例（`docs/ui-framework.config.json:941-944`）。
- 业务契约文档 `docs/UI.md:98-100` 也应检查同步：当前文字已经表达“matching evidence 后才可视为已观察”，实现徽标后应明确该徽标只是 Runtime 已确认 `realized` 的用户可读标记，不代表 UI 自行判定或改变 Projection 事实边界。若最终文字仍准确，可只做一致性审阅，不必制造无意义 diff。
- `style.css` 和 `ui/projection.js` 是生产实现目标，但本次研究任务明确禁止修改产品代码；上述仅为后续实现边界，不是本次文件变更。

## Related specs

- `.trellis/spec/frontend/component-guidelines.md:107-116`：页面模块保持现有 `ui/*.js` 职责，返回可访问 HTML，继续使用事件委托，不引入新 UI framework/layer。
- `.trellis/spec/frontend/quality-guidelines.md:56-65`：UI 变化需要 Node 检查之外的 Desktop/Tablet/Mobile host smoke，确认无普通移动端横向溢出。
- `docs/UI_FRAMEWORK.md:7-17`：业务契约优先于 UI framework；生产页面必须消费 Runtime DTO，并保留现有 `data-bioweave-*` hooks。
- `docs/UI_FRAMEWORK.md:340`：徽标胶囊样式及 good/warn/danger 语义约定。
- `docs/ui-framework.config.json:428-469`：Projection 页面结构、候选卡、删除 hook、非事实 copy rule 与响应式布局。
- `docs/ui-framework.config.json:928-949`：配置 → 规范 → HTML 示例 → 完整参考 → 生产 UI 的同步顺序及新控件要求。

## External references

- None. This is an internal source audit; the authoritative references are the repository Runtime/Core code, UI docs, example, and Trellis frontend specs cited above.

## Caveats / Not Found

- 当前 `Projection DTO` 没有名为 `observed`、`matched` 或 `已触发` 的独立字段；可确认的匹配状态是 `status: 'realized'`，其来源是 `factual_status`。如果产品要求“正文出现但仍保留 active candidate”的中间态，必须先扩展/确认 Runtime DTO contract；仅靠本 UI 研究不能安全推断该状态。
- `docs/UI_FRAMEWORK_EXAMPLE.html` 的 Projection 示例当前全部展示 active/候选语义（`docs/UI_FRAMEWORK_EXAMPLE.html:2363`），没有 realized 示例；同步时应加入一张明确标记的卡，避免示例继续暗示所有卡都只有“当前可能出现”。
- `docs/UI_FRAMEWORK.md:217` 当前写的是“已出现、已否定、已过期、已删除等历史状态保留原状态语义”，但没有规定具体 `已触发` 徽标位置；后续实现应补充该位置契约，否则 CSS/HTML 容易出现多个等价摆放方案。
- 本次未修改 `ui/projection.js`、`style.css`、任何 docs 或 spec；仅应写入本研究文件。

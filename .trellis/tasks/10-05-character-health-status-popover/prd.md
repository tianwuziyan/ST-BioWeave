# 人物健康状态紧凑浮层 UI

## Goal

将人物页现有健康状态从正文独立区块收敛为身份标题栏中的只读状态按钮，并按附件 A 方案提供 Desktop/iPad 紧凑浮层与 Mobile 底部浮层，让用户能在不打断人物详情阅读的情况下查看当前健康问题及 canonical 来源事件。

## Confirmed facts

- 当前 Runtime 已通过 `current_health_state` 提供人物级 Health State read model；人物条目包含 `current_health_summary`、`grouped_issues` 和 `source_observation_ids`。
- 当前 `ui/characters.js` 已消费该 read model，并通过 `data-bioweave-action="view-health-source-event"` 与 canonical Event ID 跳转来源事件；当前问题是把它渲染成正文区块。
- `ui/app.js` 已拥有统一的 `data-bioweave-action` 委托、人物切换、路由切换、主面板关闭和 Escape 生命周期；不需要新增 Runtime、存储或独立事件系统。
- 适用 UI Framework 要求人物详情保持列表+详情结构、身份标题栏合并人物信息和操作、Mobile 不产生横向溢出；紧凑辅助窗口使用 `bioweave-compact-popup` 基础。

## Requirements

- 在身份标题栏操作区按“健康状态、推演周期、编辑昵称”顺序渲染按钮；编辑昵称继续最右侧。移除人物详情正文中的健康状态区块。
- 根据当前人物的 Runtime Health State 只读字段显示：有效 `grouped_issues` 为黄色“健康 · 有异常”；明确无问题记录为绿色“健康 · 正常”；Health State 尚未建立、人物项缺失或无法读取为中性状态，不伪装成正常。
- 按钮文案固定短文案，不把 Runtime 摘要直接塞入标题栏；完整摘要在浮层中展示。
- 点击按钮在按钮下方打开 A 方案紧凑浮层；再次点击、点击外侧或按 Escape 关闭。Escape 第一次只关闭健康浮层，不关闭 BioWeave 面板。
- 浮层保持正确的 `aria-expanded`、`aria-controls`、`role`、标题关联和关闭按钮 `aria-label`；人物切换、路由切换、主面板关闭和重新渲染不得遗留旧人物浮层。
- 浮层标题为“健康状态”，显示当前身体问题数量和总体状态徽标；无问题时仅渲染简洁空状态。
- 有问题时每条记录同一行三列展示“部位｜内容｜来源”；部位固定紧凑宽度，内容占剩余空间，来源固定靠右。缺少部位显示“未标明部位”。
- 单来源显示“查看来源”；多来源显示“N 条来源”，展开右侧来源事件列表；继续复用现有 canonical Event ID 和 `data-bioweave-action` 跳转逻辑，不增加匹配或推断。
- Desktop/iPad 使用按钮下方浮层；Mobile 使用底部浮层，缩短部位列与间距并保证页面无横向溢出。
- 不修改 Runtime DTO、Health State、Event、Assessment、Floor persistence、Projection、分析流程，也不新增健康编辑/保存/删除/持久化入口；不展示调试字段。
- 不将附件中的原型切换器、静态人物、演示健康数据或 URL variant 参数写入生产代码。

## Acceptance Criteria

- [ ] 有问题、无问题、缺少 Health State 三种按钮状态分别呈现黄色、绿色、中性短文案。
- [ ] 健康按钮位于“推演周期”左侧，“编辑昵称”仍在最右侧；正文不再有重复健康区块。
- [ ] A 方案浮层在 Desktop/iPad 按钮下方，Mobile 为底部浮层；颜色、边框、阴影、圆角、间距和三列结构符合附件参考及现有 UI token。
- [ ] 单来源、多来源、缺少部位、无问题空状态均正确渲染并保留 canonical 来源跳转。
- [ ] 外侧点击、再次点击和 Escape 可关闭；第一次 Escape 不关闭主面板；人物/路由/主面板生命周期清理浮层状态。
- [ ] 相关语法检查、聚焦测试、`npm run check`、`git diff --check` 运行并报告基线失败与新增失败。
- [ ] 真实 SillyTavern Desktop、iPad、Mobile 验收项明确记录；自动化测试通过不替代真实宿主验收。

## Out of scope

- B 方案右侧详情层、C 方案居中弹窗及原型切换器。
- Runtime/Domain/Storage/Projection/Analysis 契约或字段变更。
- 健康状态计算、严重程度推断、Health State 编辑、持久化入口和调试信息展示。

## Blocking open questions

无。用户已明确选择 A 方案和全部交互边界；剩余技术细节由现有 UI Framework、附件和代码审计决定。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.

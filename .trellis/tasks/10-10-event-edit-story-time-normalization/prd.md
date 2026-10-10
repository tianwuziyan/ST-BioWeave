# ST-BioWeave Event 编辑界面重构与 Story Time 标准化修复

## Goal

将 Event JSON 编辑改为结构化表单，并复用正式 Story Time 标准化、Floor 完整状态写入与生产刷新链。

## Requirements

- 将 Event JSON 编辑替换为沿用现有展示结构的结构化表单。
- 发生时间只编辑 `story_time.display`，保存时复用正式 Story Time 解析、标准化、
  Event 校验和 Floor 完整集合写入入口。
- 禁止普通表单编辑 Event ID、来源绑定、Floor Version、Story Time 派生字段及
  未经既有业务选择器授权的参与者/证据结构。
- 保留不可比较时间的诊断式保存契约、stale guard、历史 Floor 保护和生产刷新链。
- 不改动 Tracking Window 周期算法、World Model、Scheduler 或无关模块。

## Acceptance Criteria

- [ ] 编辑表单不再要求用户输入 JSON。
- [ ] 修改中文发生时间后，正式解析结果与 display 一致，旧派生字段不残留。
- [ ] 非法/未来时间拒绝且原状态不变；不可比较时间保留现有诊断契约。
- [ ] Event 身份、来源、完整 Floor 集合、历史 Floor、active Swipe 和 stale guard 正确。
- [ ] 保存后 Tracking 及相关业务读取视图消费新 Event。
- [ ] 相关测试、完整 `npm test`、语法检查和 `git diff --check` 已执行并报告基线失败。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
# ST-BioWeave Event 编辑界面重构与 Story Time 标准化修复

## Goal

让用户编辑已有 BiologicalEvent 时只修改可理解的业务事实，尤其是
`story_time.display` 文本；保存由 Runtime 重新解析、标准化、校验并通过当前
Floor 的完整 Event 集合写回。用户不需要维护 JSON、Event ID、来源或 Story Time
派生字段。

## Background and confirmed repository facts

- **CONFIRMED**：`ui/events.js:203-240` 的 `renderEditForm()` 当前把
  `story_time`、`participants`、`pregnancy_relevance`、`source_evidence` 渲染为
  JSON textarea；`ui/app.js:4056-4076` 再逐项 `JSON.parse()` 后调用
  `runtime.updateEvent()`。
- **CONFIRMED**：`runtime/event-editing.js:30-102` 读取当前完整 Event 状态，保留
  Event ID/source，组装完整集合，执行 Story Time 上限校验、完整集合校验、
  mutation token、`commitFloorPatch()` 和 Tracking refresh。
- **CONFIRMED**：`core/events.js:342-359` 的 `normalizeEvent()` 直接对
  `source.story_time` 调用 `normalizeStoryTime(..., {formatDisplay:true})`；
  `story/time.js:300-355` 在输入对象已有 `normalized`/`day_index` 等结构化字段时
  不会以新的 `display` 重新解析，因此旧派生字段可残留。
- **CONFIRMED**：正式 Story Time facade 位于 `story/time.js`；
  `parseStoryTimeCandidate()` 复用 `parseCnDate()` 和 `parseTraditionalTime()`，
  `createStoryTime().normalize()` 复用历法 resolver。底层规则位于
  `utils/cn-date.js`，包括中文数字、月份/节日别名、年号、传统时辰与刻数。
- **CONFIRMED**：`story/calendar.js` 将带 `eraLabel` 的时间放入同一
  `era-standard` 计算域；不同 era 的 `resolvePair()` 返回 `ERA_MISMATCH`。
  `story/time.js:492-500` 的 `compareStoryTime()` 在缺少 `day_index` 或域不一致时
  返回 `null`。
- **CONFIRMED**：`core/events.js:1148-1169` 对不可比较时间只记录诊断，不把它当作
  未来；`runtime/event-editing.js:61-74` 因此会发出
  `EVENT_STORY_TIME_INCOMPARABLE`，但仍可继续合法保存。
- **CONFIRMED**：`docs/bioweave-data-lifecycle.md:1032` 要求 direct Event edit
  保留 ID/source、原子校验完整集合、经 Floor abstraction 保存并重建 Tracking。
- **CONFIRMED**：现有基线 `npm test` 共 1356 项，1353 PASS、3 FAIL；失败集中在
  `tests/start-new-chat-lifecycle.test.js` 的 Start New Chat 清理行为，未涉及本任务
  Event 编辑路径，实施后必须区分基线失败与新增失败。

## Requirements

1. 编辑页沿用现有 Event 展示结构、DOM action hooks 和 `bioweave-*` 样式。
2. 普通编辑表单不得提供可写的 JSON textarea，不得允许修改 Event ID、Floor
   Version、source/provenance、`normalized`、`day_index`、`calendar_id`、precision
   或 Story Time 解析 confidence。
3. 只开放经 schema/业务契约确认安全的字段：事件类型使用既有枚举选项，状态使用
   既有状态选项，地点使用文本输入，发生时间使用单一文本输入。判断置信度、妊娠
   相关性、参与者身份绑定和事件证据在没有安全的既有选择器/授权契约时保持只读。
4. 保存发生时间时以新 display 为唯一事实输入，通过正式 Story Time 入口构造完整
   Story Time；不得浅合并旧对象或沿用旧派生值。失败必须拒绝保存并显示明确错误。
5. 保存必须复用既有 `updateEvent()`、完整 Event 集合校验、Floor Version/stale
   guard、active Swipe 和完整 Floor patch；不能写入旧 Floor 或 UI 自己直接操作 Store。
6. 成功后复用既有 refresh business chain，使 Event、Tracking Window、Registry、
   Health/Projection 读取视图和 Settings Debug DTO 消费新 Event。
7. 取消不写入；保存失败不显示成功，原 Event/集合保持不变。
8. 覆盖中文日期/传统时辰/年号/自定义历法已有正式语义，不新增第二套日期算法。

## Acceptance criteria

- A1：编辑现有 Event 时看到结构化控件，直接把“羲和1年3月15日 酉时末”改成
  “羲和1年3月18日 酉时末”即可保存；页面无内部 JSON 编辑要求。
- A2：保存后 `display`、`normalized`、`day_index`、`calendar_id`、precision 和
  Story Time confidence 遵守正式 parser/schema 结果，不出现新旧日期混合。
- A3：非法/无法解析时间、未来时间和完整集合不合法时保存被拒绝，错误可见，原状态
  不变；不可比较时间遵守现有诊断契约。
- A4：Event ID/source/六字段 Floor Version/active Swipe 保持正确；同 Floor 其它
  Event 不变，旧 Floor 不变，显式 `[]` 语义不变。
- A5：保存成功后生产刷新链和 Debug DTO 读取新时间；Tracking Window 使用新 Event
  时间，不在 UI 重新计算。
- A6：UI、Runtime、Story Time、Floor 历史/Swipe/stale、Tracking Window 回归测试
  通过；手机布局沿用单列控件规则。

## Out of scope

- 重写日期算法、World Model、Character Registry 身份模型、Tracking Window 周期算法、
  Projection 算法或 Floor Persistence Coordinator。
- 引入新的 UI framework、第二套 Store/Resolver、Chat-level Event cache。
- 让普通用户修改来源证据、canonical participant IDs、事件判断置信度或内部诊断。
- 自动提交、推送或真实 SillyTavern Host 验收（后者仅报告未测状态）。

## Open questions

无阻塞产品问题。参与者/妊娠相关性/证据是否可编辑由代码审查确认；若不存在安全的
既有角色选择/证据授权入口，则按只读处理并在最终报告说明。

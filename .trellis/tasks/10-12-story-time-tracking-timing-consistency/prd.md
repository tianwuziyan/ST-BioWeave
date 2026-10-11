# 修复 Story Time 比较与 Tracking Window 首次 Exposure 锚点

## Goal

在不覆盖当前分支未提交工作的前提下，统一 Story Time 的比较与差值语义，修复
Tracking Window 首次 Exposure 锚点和历史 Floor/Swipe 隔离，并核查
Projection Timing Instance 的真实创建入口、`projection_rules=[]` 行为及现有
Settings Debug 可观测性。

## Background and confirmed repository facts

- `utils/cn-date.js:503` 已提供 `parseCnDate()`，`story/time.js:10-11` 复用为
  `parseStoryTimeDate`，`parseStoryTimeCandidate()` 与 `normalizeStoryTime()` 也在同一
  Story Time 模块内工作；不得新增第二套中文日期解析器。
- `story/calendar.js:createCalendarResolver()` 将带纪年日期解析为
  `era-standard` descriptor，但返回 `calendar_id: null`；`business/calendar/date.js`
  已提供 era-standard 的 Gregorian 月份/闰年日历运算。
- `story/time.js:492` 的 `compareStoryTime()` 目前只接受两个非空 `day_index`，而
  `differenceStoryTime():525` 另行调用 `customCalendarDifference()`，所以同一对
  era-standard 日期可能差值可算而比较返回 `null`。
- `core/tracking-window.js:62-66` 的 `eventSort()` 在比较返回 `null` 时按
  `event_id` 排序；`deriveTrackingWindows():311-321` 依赖该顺序处理事件，因此可能让
  Event ID 决定 Window 首次 Exposure。当前 Window 的 `opened_story_time` 与
  `opened_at_floor_version` 在 `createWindow():248-278` 取创建事件，且 Window 是派生数据。
- `runtime/events.js:2174-2260` 是当前 Timing/aggregation 生产入口：读取 Floor-owned
  timeline，遍历 `worldModel.projection_rules`，复用已有 Timing 或创建独立 Timing，随后
  按 `resolveParticipantAggregationTrigger()` 判断聚合；它不会凭空生成 Projection Rule。
- `core/projection-timing.js:95-132` 已完成一次性采样并冻结 effective min/max；
  `core/participant-aggregation.js:126-136` 已支持 effective min 前不聚合、达到 min
  聚合、一次跳过 max 时 overdue 补偿聚合。
- `runtime/events.js:3060-3097` 已有 `getProjectionTimingDebug()`，可读取当前有效 Floor
  的 Timing timeline、derived timing、Projection rule IDs、eligibility 与 aggregation
  计数；需要核查并在同一结构中补齐缺失的 lifecycle/未执行原因信息。
- 当前工作树有 44 个未提交改动，涉及 Projection/Tracking/Runtime/文档；本任务不得
  reset、restore、覆盖或清理这些既有改动。

## Requirements

### Story Time

1. 对同一明确纪年、同一 era-standard 日期域，`compareStoryTime()` 与
   `differenceStoryTime()` 必须给出一致的先后语义。
2. 保留 `day_index`、普通 Gregorian、闰年、同日时分精度和已有自定义历法支持。
3. 不同纪年、不同未映射日历、不可解析日期或缺少可靠域身份时必须 fail-closed；
   不得把所有 `calendar_id=null` 视为同一历法，也不得对 normalized 字符串做通用字典序
   比较。
4. 中文日期解析、era-standard 纪年和 Tracking Window 计算必须复用现有模块。

### Tracking Window

1. 可比较事件按 Story Time 排序；同一时间使用明确、稳定且不伪装成时间语义的次级
   顺序。
2. 真正不可比较的事件不得通过 Event ID 推断首次 Exposure；无法确定时保留
   unresolved/fail-closed 结果，不凭空选择锚点。
3. 祁鸢 `char_000001` 的 Floor 58/60/66 Exposure A/B/C 必须保持首次锚点为三月四日、
   `opened_at_floor_version` 为 Floor 58，source IDs 包含 A/B/C，当前经过 16 Story Days。
4. 柳如烟 `char_000003` 必须保持独立 cycle；后续 Exposure 只能追加有效证据，不得
   重置首次锚点或修改历史 Event snapshot。
5. Chat、active Swipe、Floor Version 和历史分支隔离必须保持。

### Timing Instance and Debug

1. 对照当前规范、任务和测试确认“首次有效 Exposure 是否独立创建 Timing Instance”
   与 `Projection Rule` 的边界；如发现设计冲突，停止该部分扩展并报告，不自行重构。
2. 不生成 Projection Rule、不伪造 AI 结果、不硬编码第 16 天、不重新随机采样已冻结
   Timing 参数，不破坏 C001/C002 周期释放规则。
3. 若既有契约明确要求 Exposure 独立启动 Timing，只实施最小 Runtime 入口修复；否则
   保持 `projection_rules=[]` 的既有 fail-closed 产品行为。
4. 复用 `getProjectionTimingDebug()` 及现有 Settings Debug/lifecycle runtime 导出，
   让 subject、cycle、timing instance、首次 Exposure 锚点、Floor Version、冻结
   effective min/max、elapsed、due、aggregation 成功与具体未执行原因可观察。

## Acceptance Criteria

- [ ] 中文纪年“羲和元年三月四日 < 三月十五日 < 三月二十日”排序正确，四日至二十日
      差值为 16 day。
- [ ] 覆盖同日不同时间、跨月、跨年、闰年、不同纪年、不可解析日期、自定义历法和
      Gregorian 回归；比较与差值域语义一致。
- [ ] Tracking Window 不再以 Event ID 字典序决定首次 Exposure；不可比较事件保持
      unresolved/fail-closed。
- [ ] 祁鸢 A/B/C 与柳如烟独立周期回归通过，首次锚点、Floor 58 provenance、source IDs
      和 16 Story Days 正确，后续 Exposure 不重置锚点。
- [ ] Timing Instance 的创建入口与 `projection_rules=[]` 行为符合已确认既有契约；
      未改变冻结参数、Projection Rule、Projection AI 或周期释放语义。
- [ ] effective_min 前不聚合，到达 effective_min 聚合，一次跳过 effective_max 时先
      完成 overdue aggregation/Projection 处理而非立即超时释放。
- [ ] Swipe/Reroll/历史回退不污染其他分支，历史 Floor/Event snapshot 不被改写。
- [ ] Settings Debug 能看到冻结参数、锚点、elapsed、due、aggregation 状态和具体原因，
      且复用现有 Debug 导出结构。
- [ ] `npm run check`、相关定向测试和 `git diff --check` 通过；不得 commit 或 push。

## Out of scope

- 不修改 ST 安装目录、真实剧情、真实 Chat 数据或 production NSFW gate。
- 不新增中文日期解析器、专用“羲和”补丁、Projection Rule、Timing schema、第二套
  Debug 系统或新的持久化事实源。
- 不修改历史 Event snapshot，不进行无证据的架构重构、分支切换、commit 或 push。

## Blocking open questions

无需要用户决定的产品问题。若代码、测试、Trellis task 与规范之间出现 Timing 创建
语义冲突，按要求停止该冲突范围并在最终报告中列出决策项。

# 修复楼层重新分析的 BioWeave baseline 选择与原子替换

## Goal

修复 ST-BioWeave 任意目标楼层 N 的首次分析与手动重新分析输入语义：`existingBioWeave` 只能表示 N 之前最近一个仍与当前 Floor Version 一致、且 `analysis.status === 'success'` 的楼层状态。目标楼层自身旧结果必须被忽略，分析成功后才覆盖 N 楼结果，失败时保留原有成功结果。

## Background and confirmed facts

- `runtime/event-analysis.js:697-778` 当前在 `buildFloorAnalysisInput()` 中读取 `target.floorData.analysis/events`，因此会把目标楼层旧结果再次送入分析输入。
- `runtime/event-analysis.js:384-413` 的 `resolveFloor()` 已能根据 active Swipe 和当前消息重新生成权威 Floor Version。
- `runtime/floor.js:162-191` 的 `sameFloorVersion()` / `floorVersionFromData()` / `getActiveFloorEvents()` 已实现六字段版本比较与事件过滤，必须复用，不新增弱化判断。
- `runtime/event-analysis.js:817-827` 成功路径通过 `saveFloor(target.index, target.swipeId, {...target.floorData, analysis, events})` 写回同一个楼层；`storage/store.js:523-579` 通过同一消息/Swipe 的 `bioweave` 槽位覆盖保存，不是 append。
- `runtime/event-analysis.js:650-683` 的失败/取消持久化逻辑会保留现有成功分析及事件；本次不应提前删除目标楼层数据。

## Requirements

### R1. 统一 previous baseline 选择

在 `createEventAnalysisCoordinator` 内增加一个异步 helper，接收已经解析的目标楼层，按数组索引从 `target.index - 1` 向前搜索：

1. 读取候选索引的 active Swipe、Floor 数据和候选 `analysis`。
2. 仅考虑 `analysis.status === 'success'`。
3. 对候选调用现有 `resolveFloor({__messageIndex: true, index})`，重新计算当前权威六字段 Floor Version。
4. 候选的当前 `version.floor` 必须严格小于目标 `target.version.floor`。
5. `sameFloorVersion(floorVersionFromData(floorData), candidate.version)` 必须为 true；内容编辑、message version 变化、Swipe 切换、Chat 变化或其他六字段变化都使旧分析失效。
6. 返回候选 `analysis` 与 `store.getActiveFloorEvents(index, candidate.version)`；事件必须按当前候选版本过滤。
7. 找不到有效候选时严格返回 `{analysis: null, events: []}`。

目标楼层 N 不得出现在搜索范围内，也不得使用 N 的旧 success、旧 failed 或旧 events 作为 baseline。

### R2. 构造分析输入时使用 previous baseline

`buildFloorAnalysisInput(target, token)` 在完成 baseline helper 后执行 `chat.assert(token)`，并把 helper 返回值传给 `buildEventAnalysisInput({existingBioWeave})`。当前楼层剧情、消息、recent story、World Model、character context 等现有输入构造保持不变。

### R3. 成功替换、失败保留

- 不得在 API 请求前删除目标楼层的 `analysis/events`。
- 成功并通过现有 JSON/domain 校验后，使用现有同槽位 `saveFloor` 覆盖 N 楼的 `analysis/events`，最终只保留本次结果。
- API 错误、超时、取消、响应/JSON 校验失败、domain 校验失败或保存前失败时，继续保留旧 N 楼成功事件作为回滚/active 数据，并记录现有失败或取消状态。
- 不改变已经存在的下游楼层自动失效、删除或重分析策略。

### R4. 回归测试

在 `tests/event-analysis-runtime.test.js` 增加覆盖：

- 多个已成功前置楼层时，输入 baseline 取最近有效楼层。
- 手动 force/re-analysis 目标楼层时，输入不包含目标楼层旧 `analysis/events`，而取前置有效楼层。
- 同一楼层连续重新分析时，最终存储只保留最后一次成功结果，不累积事件。
- 目标楼层之前没有有效成功分析时，输入严格为 `{analysis: null, events: []}`。
- 前置楼层旧 success 因内容 hash 或 message version 失效时跳过，并继续向前找到有效楼层。
- 即使目标楼层自身有旧 success/stale 结果，也永远不能被选作自己的 baseline。
- 既有失败刷新保留旧成功事件的行为继续通过。

## Acceptance Criteria

- [x] 所有 runtime 分析路径（首次、自动、手动 force、指定任意楼层）都遵循同一 previous-baseline 规则。
- [x] analyzer 收到的 normalized `analysisInput.existing_bioweave` 在上述场景中分别等于最近有效前置楼层或严格空 baseline；测试直接断言 analyzer 输入。
- [x] baseline 候选使用当前权威六字段 Floor Version 校验，stale analysis/events 不会进入 prompt。
- [x] 成功重新分析覆盖目标楼层原有结果；连续重新分析不会产生事件数组累积或多个目标楼层结果。
- [x] 失败、超时、取消、JSON/domain 校验失败不会提前删除目标楼层旧成功结果。
- [x] 不实现下游楼层自动失效/重分析，不修改无关 UI、存储结构或 API 合同。
- [x] 相关 runtime 测试通过，完整 `npm test` / `npm run check` 尽量执行并报告结果。

## Out of scope

- 重新分析历史楼层后自动删除、标记 stale 或重分析其后的楼层。
- 新增存储层、版本判断机制、Event schema 或 UI 调整。
- 重构现有 `saveFloor` 覆盖语义。

## Open questions

无。用户已明确 baseline、六字段版本有效性、成功替换、失败保留、测试范围及下游失效边界；代码审计也已确认现有 helper 和 storage API 足够支持该实现。

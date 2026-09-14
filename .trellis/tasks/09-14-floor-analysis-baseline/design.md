# 技术设计

## 边界与数据流

```text
目标楼层 selector
  -> resolveFloor(target) 得到 target.index / target.version
  -> findPreviousSuccessfulBioWeave(target)
       -> 从 index - 1 向前读取 active Swipe 的 Floor 数据
       -> resolveFloor(candidate) 重新计算当前权威六字段版本
       -> sameFloorVersion + candidate.version.floor 严格早于目标楼层
       -> getActiveFloorEvents(candidate, candidate.version)
  -> buildEventAnalysisInput(existingBioWeave = previous baseline)
  -> analyzer.analyzeFloor
  -> 现有解析/归一化/collection validation
  -> 成功时 saveFloor(目标同一 message + Swipe, analysis, events) 覆盖
  -> 失败/取消时现有 persistTerminalAttempt 保留目标楼层旧成功 Events
```

## 实现位置

- 在 `createEventAnalysisCoordinator` 内、`resolveFloor` 附近增加 `findPreviousSuccessfulBioWeave(target)`，只复用已有 `resolveFloor`、`floorVersionFromData`、`sameFloorVersion` 和 Store API。
- `buildFloorAnalysisInput` 在收集共享上下文并准备目标楼层输入时获取 baseline；`await` 后用 `chat.assert(token)` 防止 Chat scope 改变后继续构造 prompt。
- 删除当前 `target.floorData.analysis/events` 作为 `existingBioWeave` 的读取方式，改为 helper 返回值。
- 不修改 `runtime/floor.js`、`storage/store.js` 的版本或覆盖实现；不新增版本字段、不复制版本比较逻辑。

## 版本与事件合同

候选必须同时满足：

1. 存储中的 `analysis.status === 'success'`；
2. `resolveFloor({__messageIndex: true, index})` 计算出的 `candidate.version.floor < target.version.floor`；
3. `sameFloorVersion(floorVersionFromData(floorData), candidate.version)` 为 true；
4. 事件由 `store.getActiveFloorEvents(index, candidate.version)` 返回。

因此旧内容 hash、Swipe、message version、message id、Chat id 或 floor 任一字段变化都会使该候选失效。目标楼层永远不会进入循环。

## 持久化与失败语义

`saveFloor` 已按目标消息和 Swipe 覆盖 `bioweave` 槽位，成功路径继续写入新的 `analysis/events`。请求前不清空旧值；现有失败/取消路径继续通过 `commitAnalysis` 和 `persistTerminalAttempt` 保存失败状态并保留成功事件。该修复只改变 prompt baseline，不引入下游楼层 invalidation。

## 测试设计

在现有 `createFixture` 上用指定 message index 先成功分析前置楼层，再捕获自定义 analyzer 的 `request.analysisInput.existing_bioweave`：

- 多个前置 success：断言使用最近有效楼层的 analysis Floor Version 与事件 source。
- 目标楼层 force：先分析目标并写入带标记的旧事件，再 force 分析，断言输入仍来自前置楼层。
- 无前置 success：断言精确为空 baseline。
- 前置楼层内容或 message version 改变：断言跳过 stale 候选并继续向前。
- 连续 force：让每次 analyzer 返回不同数量/标记事件，断言最后同一 Floor 槽位只有最后结果。

# 技术设计：真实宿主自动分析触发回归定位

## 边界

本任务只审计并修复 Character Floor 自动触发链。既有 Floor storage owner、analysis
pipeline、generation lifecycle 和 scheduler 作为边界，不新增模块、不改变计数规则。

## OLD/CURRENT 对比点

| 阶段 | OLD (`132f915`) | CURRENT | 证据 |
| --- | --- | --- | --- |
| Host role | `runtime/event-analysis.js` 本地 role helper；`storage/store.js` 本地 owner 判定 | 共享 `core/message-role.js` | commit diff + host shape |
| Floor recognition | `store.isCharacterMessage` | `isCharacterMessageRole` | `storage/store.js` |
| Lifecycle target | generation lifecycle settle 后调用 `scheduleRenderedCharacter` | 同一路径 | `runtime/generation-lifecycle.js`, `runtime/event-analysis.js` |
| Counter/due | interval/counter/ retry guards | 未在两提交中改变 | `scheduleRenderedCharacter` |
| Analysis | `runScheduledAnalysis` → `analyzeFloor` | 同一路径 | `runtime/event-analysis.js` |

## 诊断方法

1. 用 `git show` 固定 OLD 与 CURRENT 的 role/owner 实现和相关测试。
2. 使用真实 host message shape 或同等 fixture，逐点记录：归一化 role、`isCharacterMessage`、`resolveFloorAtIndex`、`onCharacterMessageRendered`、scheduler state、trace stages。
3. 对当前候选差异重点检查 `extra.type`：它是目前唯一使 OLD 默认接受而 CURRENT 返回 `other` 的已知输入类别；不能在没有真实 host 证据时放宽它。
4. 将首次差异分为两类：Floor 前置差异（`NO_CHARACTER_FLOOR` / `resolveFloorAtIndex` 未进入 scheduler）或 Floor 后置差异（counter、due、retry pause、generation settle 或 analysis stage guard）。
5. 若差异只出现在 narrative input，不得把它报告为“没有自动触发”；必须分别证明 scheduler invocation 与 analyzer invocation。

## 兼容性与保护

- `is_system` 仍是隐藏/rendering flag，不能单独把 hidden Character 降为 System。
- `narrator`、`comment` 和明确的 unknown extension/system message 不能进入 Character Floor 或 Recent Story narrative。
- manual supplement 的当前 Floor A+B preservation 逻辑不触碰。
- 真实 host retest 是最终验收；Node fixture 只证明代码路径，不证明安装中的 SillyTavern listener/对象 shape。

## 最小修复原则

只有当真实 host 证据证明 Character reply 带有被当前归一化器误认为 `other` 的 type，才为该明确 type 增加窄白名单/语义判断，并同步补正向与负向测试。不得把所有非 narrator/comment type 一律视为 Character，也不得修改 scheduler。

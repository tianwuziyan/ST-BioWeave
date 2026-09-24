# Phase A Diagnostics Extraction

## Goal

将当前 `runtime/events.js` 与 `runtime/event-analysis.js` 中已经确认属于 Diagnostics 的纯格式化、脱敏、缓冲和 debug DTO 代码归位到 `runtime/diagnostics.js`，不改变任何业务行为。

## Requirements

- 以 HEAD `b4df8930af9d6b1c04cf29152312b63de30f3e9c` 为基准重新核对代码和测试。
- 新模块只接收 plain data、resolver callback 或受控的 diagnostic sink，不反向 import Runtime、Analysis、World、Character/Event 或 Persistence coordinator。
- 保持 trace stage、payload 字段、脱敏规则、buffer 顺序、sequence 语义和 UI debug DTO 结构完全兼容。
- `notify` 的 Runtime subscriber broadcast 与 activity forwarding 留在 Runtime；只把其中纯 Diagnostics 聚合逻辑接入新模块。
- `getStoryTimeDebugInfo` 仍由 Runtime 执行 Story Time / business data 读取；只可抽出纯 DTO builder。
- `recordReloadFloorSlotAudit` 仍由 Runtime 读取 active Floor/store；Diagnostics 只接收 plain data 构造或记录 audit。
- 不移动或重写任何 Persistence、Generation、World/Event Analysis、Tracking、Clear、Settings、UI 或 public Runtime API 行为。
- 不修改 `tests/floor-persistence-static-gate.test.js`，除非出现与行为契约无关的路径误报；当前计划不应触发该情况。

## Confirmed Function Map

### Safe extraction candidates

- `runtime/events.js:1728-1818`: `sanitizePersistenceTracePayload`, `cloneSafeTraceValue`, lifecycle/persistence trace buffer helpers。
- `runtime/events.js:1820-1854`: 仅抽出 reload audit DTO construction；active Floor resolution 和 store read 保留 Runtime。
- `runtime/events.js:2592-2679`: 仅抽出 Story Time debug DTO construction；Story Time/Business data reads 保留 Runtime。
- `runtime/event-analysis.js:277-308`: `floorVersionComparison`, `versionMismatchFields`。
- `runtime/event-analysis.js:375-466`: `diagnosticCode`, `safeDiagnosticSummary`。
- `runtime/event-analysis.js:548-602`: `executionError`。
- `runtime/event-analysis.js:700-724`: `safeFloorPreflightStatus`，仅作为 diagnostic/status DTO builder 迁移。

### Mixed responsibility; do not move wholesale

- `runtime/events.js:1662-1726` `notify`: 保留 Runtime broadcast/activity forwarding；仅调用 Diagnostics aggregation。
- `runtime/events.js:1856-1871`: lifecycle settled notification 和 sink wiring 保留 Runtime composition。
- `runtime/events.js:2592-2745` `getStoryTimeDebugInfo` / status reads：保留业务读取，只调用纯 builder。
- `runtime/event-analysis.js:837-847` `emitPersistenceTrace`: 保留 Analysis execution/target/domain context construction，只调用 Diagnostics emitter。
- `runtime/event-analysis.js:1210-1220` `generationTrace`: 保留 Generation lifecycle semantics，只调用 Diagnostics emitter。
- `runtime/event-analysis.js:3066-3117` `finalizeExecution`: 保留 terminal state、notify、ordering，只使用 Diagnostics error formatter。
- `runtime/event-analysis.js:2555-2745` `statusForCurrentFloor`: 保留 Floor/analysis state resolution，只可复用诊断 formatter。

## Out of Scope

- `inspectOfficialFloorOwner`, `acquireAuthoritativeFloorOwner`, `bootstrapOfficialFloorOwner`, `saveOfficialFloorSlot`, `syncHostMemoryFloorSlot`。
- owner acquisition、Floor Version validation、readback、sibling audit、transaction serialization、Host-ahead bootstrap。
- Generation settle barrier、pending intent、scheduler、retry、cancel/supersede。
- World/Event stage、input/prompt、Tracking rebuild、Event editing、Clear lifecycle。
- Settings schema/default、UI rendering、public Runtime API shape。
- Persistence behavior and `/api/chats/save` behavior。

## Acceptance Criteria

- [ ] `runtime/diagnostics.js` exists only if the confirmed extraction boundary remains valid。
- [ ] Runtime and Analysis call sites preserve all existing public names and event ordering。
- [ ] `getPersistenceTrace`, `recordPersistenceTrace`, `getStoryTimeDebugInfo` remain available through the same Runtime object。
- [ ] No Persistence production logic is moved or behaviorally changed。
- [ ] No Generation/Analysis/Tracking behavior is moved or behaviorally changed。
- [ ] No circular dependency is introduced。
- [ ] `npm test -- --test-force-exit` passes。
- [ ] `npm run check` passes。
- [ ] `git diff --check` passes。
- [ ] All changed JS files pass `node --check`。
- [ ] Relevant Runtime, Event Analysis Runtime, persistence trace, lifecycle trace, UI debug popup and static gate tests pass。
- [ ] Documentation drift is checked and explicitly reported; no unrelated docs are changed。

# Phase F Runtime Composition Cleanup — Future Implementation Plan

本文件是后续实施计划；本次 Phase F planning 不执行下列步骤。

## Step 0 — preflight and baseline

- 重新读取 `AGENTS.md`、Floor State Ownership Contract、Data Lifecycle Contract。
- 确认工作树包含 Phase A–E 既有 changes，禁止 reset/stash/clean/restore。
- 记录 facade keys、construction count、listener count、destroy order、static
  gate 约束。
- 先运行 baseline focused tests；若 baseline 与当前 task packet 不一致，停止并
  报告，不猜测。

## Step 1 — freeze the boundary

- 给 `runtime/runtime.js` 设计最小内部 factory（候选名
  `createRuntimeComposition`），不增加通用 DI/container API。
- 保持 `runtime/events.js` 的 `createRuntime` 与
  `createSillyTavernAdapter` 作为兼容导出。
- 明确 capability 只能是 narrow function/object：enabled/settings resolver、
  existing Floor/persistence/notify/diagnostic/tracking/snapshot callbacks；不
  传整个 coordinator，不传 mutable state bag。

## Step 2 — move only proven assembly

- 由新 root 组装可独立验证的 host/runtime infrastructure：Chat、Store、outer
  Diagnostics、Activity、Analyzer、Story Time、现有 Floor persistence
  capability、Projection coordinators。
- 保持 ST adapter、official transport、Clear Service、lifecycle binding 的
  当前 owner 和调用顺序；不要把其业务实现搬到 root。
- `event-analysis.js` 继续创建/拥有 execution、scheduler、retry、Floor/general
  derived state；只有在窄 seam 已证实时，才改变 feature factory construction
  site。

## Step 3 — feature construction seam

- 若能提供不反向 import 的 capability factory，再逐个把 World、Character/Event、
  Event Editing、Tracking 的 construction wiring 交给 composition root。
- 每次只处理一个 cohesive construction boundary，先确认 feature instance
  数量、闭包能力、方法 identity 和 facade method behavior。
- 如果需要 `callback.performEverything`、整个 `eventAnalysisCoordinator` 或
  root↔feature 反向 import，立即停止，结论改为
  `NOT SAFE TO EXTRACT UNDER CURRENT SEAM`。

## Step 4 — facade and teardown verification

- 让 root 组装与当前完全相同的 facade keys；`events.js` 保留 host/lifecycle
  compatibility layer。
- 保留当前 destroy 顺序：projection context → Story Time → analysis/features →
  host unbind/subscriptions/activity → Chat boundary，除非测试证明实际顺序
  可等价改变；默认不改变。
- 保留 Clear 的 invalidate barrier、Tracking refresh barrier、source-clear
  recovery 和 projection refresh 时机。

## Step 5 — validation

- 运行 Runtime、event-analysis-runtime、World/Event、Event Editing、Tracking、
  lifecycle、clear/start-new-chat、UI、projection/state、persistence coordinator
  与 static gate tests。
- 运行 `npm test -- --test-force-exit`、`npm run check`、`git diff --check`，对
  所有修改 JS 执行 `node --check`。
- 任何 persistence transport/owner/Floor Version/readback、Generation ordering、
  Snapshot/Tracking timing 改变都必须停止；不以改测试期望掩盖。

## Stop conditions

立即停止并报告 `NOT SAFE TO EXTRACT UNDER CURRENT SEAM`：

- 需要移动/复制 generic retry、Generation lifecycle、Snapshot machinery、Floor
  traversal、Persistence coordinator 或 ST transport；
- 需要修改 owner/patch/operation type、Floor Version/Swipe/stale policy、terminal
  supersede 或 lifecycle ordering；
- 需要把整个 event-analysis coordinator 注入 feature，或出现 root→feature→root
  circular dependency；
- 出现 duplicate Diagnostics buffer、persistence instance、Tracking queue、
  lifecycle listener 或 generation consumer；
- 无法在不改变 Runtime public API 的情况下组装 facade。

## Expected implementation evidence

未来实施报告必须逐项给出：修改文件、root/facade map、capability ownership、
feature instance count、destroy/clear order、import-cycle 结果、production line
delta、focused/full tests、`npm run check`、`node --check`、`git diff --check`，
以及明确确认 Persistence、Generation、World/Event/Tracking/Snapshot semantics
是否 zero behavior change。

规划阶段完成后，须等待批准再进入实施；Phase F 实施完成后不进入 Phase G。

## Phase F implementation result

已按批准范围完成 implementation：

- 新增 `runtime/runtime.js`，唯一 export 为 `createRuntime(...)`。
- composition root 只创建并返回 Diagnostics、Tracking Runtime、World Analysis、
  Character/Event Analysis、Event Editing 五个 feature 实例。
- `runtime/event-analysis.js` 继续拥有 execution、retry、Floor resolver/version
  policy、Generation lifecycle、terminal、general derived state、Snapshot bridge、
  clear/lifecycle coordination 与 `registryRefreshChain`。
- feature factory invocation 与 dependency wiring 已移入 `runtime/runtime.js`；
  capability 仍以窄函数对象传入，没有注入整个 coordinator。
- `runtime/events.js`、Persistence coordinator、SillyTavern adapter、UI facade、
  tests 均未修改。

验证结果：

- focused Runtime/Event Analysis/static gate：202/202 通过；
- `npm test -- --test-force-exit`：931/931 通过；
- `npm run check`：931/931 通过；
- `node --check`：全部本轮涉及 JS 通过；
- `git diff --check`：通过。

一次全量测试初次运行出现单个 stale World completion 时序测试失败；单独复跑
该测试及随后全量 `npm run check` 均通过，未改变 execution/cancellation 逻辑。

本 Phase 未运行 REAL ST + F5（Persistence、ST adapter、Generation lifecycle、
Floor ownership/version semantics 均未修改）。完成后停止，不进入 Phase G。

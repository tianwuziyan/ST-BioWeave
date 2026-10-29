# Research: SillyTavern 页面卡顿与 BioWeave 生命周期阻塞

- Query: 调查 BioWeave 运行时是否会阻塞 SillyTavern 原生页面/生成流程，以及最小回归测试切口。
- Scope: internal
- Date: 2026-10-29

## Findings

### 1. 根因：GENERATION_STARTED 的内部异步链曾被暴露到宿主边界

`runtime/events.js:5610-5774` 建立生命周期队列；`GENERATION_STARTED` 会先取消现有 Storyline 工作，再排队等待 `lifecycleTail`。Runtime/legacy seam 仍返回 `settledWork`，用于保持注入式测试和旧适配器的可等待顺序；但生产 `runtime/sillytavern-adapter.js` 的 `subscribeLifecycle()` 已在宿主边界包成 fire-and-forget，立即返回 `undefined`，不把这个 Promise 交给 SillyTavern。这样既保留 Runtime 内部顺序，又不让宿主生成流程等待 BioWeave。

该 promise 包含：

- `runtime/events.js:5664-5690` 的 `projectionRuntime.cancelStoryline()`；
- `runtime/events.js:5780` 等待取消完成；
- `runtime/events.js:5894-5951` 转发到 Event Analysis；
- `runtime/events.js:5961-6000` 释放 generation gate、重放延迟事件、handoff settled Character Floor；
- `runtime/events.js:6017-6037` 生命周期 Projection tick、owner 刷新和可能的恢复；
- `runtime/events.js:6039` 最后的 Projection Context 刷新。

这不是浏览器同步死循环，而是“宿主事件回调未结束”导致的前端原生流程等待，表现上会像 ST 页面卡住。

### 2. Runtime 内部仍等待只读上下文刷新，宿主不再等待

`runtime/events.js:5726-5755` 在 `GENERATION_STARTED` 上调用 `projectionContext.refreshProjectionContext()`。该函数走 `runtime/projection-context.js:292-520`：读取当前 Floor 与 Projection Views，必要时收集完整业务数据，执行健康指导/妊娠知识/聚合解析，构建正文并调用 `setExtensionPrompt`。即使 `readOnly: true`，仍可能产生很多存储读取和派生计算；这些工作现在只由 Runtime 内部 `lifecycleTail` 等待，生产宿主回调立即结束。Debug 中的 settled/ready 字段描述的是内部 ready boundary，不代表 ST 已等待该 Promise。

现有 Runtime seam 测试仍把这种内部等待当成契约：`tests/event-analysis-runtime.test.js:351-386` 要求注入式 `GENERATION_STARTED` listener 返回 Promise，且 `prompt-read` 必须在 Projection refresh 后发生。生产适配器另有回归测试 `tests/runtime.test.js`，确认宿主可见 listener 立即返回，同时后台 Promise 仍可完成；不能把两个边界混为一谈。

### 3. 高优先级：运行时初始化会同步等待完整生命周期恢复，且恢复默认允许外部 API

`runtime/events.js:6133-6137` 初始化时先刷新 Projection Context，`runtime/events.js:6140-6148` 刷新 Tracking Registry，随后 `runtime/events.js:6150-6153` `await runLifecycleRecovery(...)`。

`runLifecycleRecovery` 在 `runtime/events.js:5001-5290` 会解析当前 Floor、读取活动 Events、检查候选，然后调用 `projectionRuntime.process`。`runtime/projection-runtime.js:2039-2047` 的 `process` 默认 `allowExternalApi = true`；因此打开插件/页面时，如果当前状态满足条件，初始化路径可能进入 Projection 处理和 API 请求，而不是只做轻量 UI 初始化。若 UI mount 等待 runtime.init，这会直接造成打开插件时的长时间等待。

### 4. 中高优先级：生成开始时等待旧 Projection/Storyline 请求完全退出

`runtime/projection-runtime.js:2258-2271` 的 `cancelProjectionRuns()` 会 abort controllers，然后 `await Promise.allSettled([...inFlight.values()])`，等待所有旧执行从 single-flight map 离开。该函数由 `runtime/events.js:5664-5666` 在生成开始时调用，并在生命周期队列中被等待。API 的 abort 若不能立即结束、底层保存或读回仍在等待，下一次 ST 生成会被前置阻塞。

### 5. 中优先级：Projection 处理存在多层串行循环；这主要造成延迟，不等同于 JS 同步死锁

`runtime/projection-runtime.js:1421-1515` 按候选逐条 `await generateProjectionCandidate`；后续 `runtime/projection-storyline-runtime.js:470-818` 按人物逐条进行设计、判定和推进请求，并多次保存、读回和刷新上下文。这些 `await` 会让出事件循环，所以不能单凭代码认定浏览器主线程完全冻结；但当它们位于 `GENERATION_STARTED` 返回 promise 或插件初始化链路中时，会放大“页面卡住”的宿主等待感。

### 6. 目前没有发现 BioWeave 自己创建全屏阻塞遮罩作为主因

`ui/app.js:6877-6893` 的 overlay 是插件面板容器，初始化时根据 `wasOpen` 设置 `hidden`；`ui/projection.js:475` 的“生成中”只是推演页区块和停止按钮。当前代码搜索没有发现运行中设置全屏 `inert`、全局 `pointer-events: none` 或 modal blocker 的证据。因此，优先排查生命周期返回 promise 和初始化恢复，而不是先改 UI 遮罩。

## Existing Tests / Regression Seam

现有可复用测试：

- `tests/event-analysis-runtime.test.js:351-386`：验证 Runtime/legacy seam 会等待 Projection Context refresh，保证内部上下文顺序。
- `tests/runtime.test.js`：验证生产 SillyTavern lifecycle listener 不把插件 Promise 返回给宿主。
- `tests/event-analysis-runtime.test.js:1117-1124`：验证非 `GENERATION_STARTED` 生命周期保持后台编排。
- `tests/event-analysis-runtime.test.js:471-510`、`514-570`：验证 generation gate、重复 start 与 lease 行为。

“宿主回调等待边界”测试已经落地：`tests/runtime.test.js` 注入一个未完成的异步 handler，确认生产适配器 listener 立即返回 `undefined`，随后后台 Promise 仍可完成并能正常取消订阅；`tests/event-analysis-runtime.test.js` 则继续验证 Runtime/legacy seam 的内部顺序。这样没有删除 generation gate、取消旧请求或上下文 ready boundary，只把宿主等待边界移到了适配器之外。

`runtime.init()` 的延迟恢复仍未做真实宿主集成测试。若刷新后仍出现初次打开卡顿，应单独追踪初始化阶段的官方 I/O、Tracking Registry 刷新和 `runLifecycleRecovery()`，不要重新把宿主 listener 改回可等待。

## Related Specs

- `.trellis/spec/domain/automatic-analysis.md`：Host Bridge、Generation Lifecycle Barrier、Automatic Analysis Port；并强调 Host Bridge 不应拥有业务分析和 Floor 写入。
- `.trellis/spec/domain/floor-state.md`：Projection 上下文必须以当前合法 Character Floor 为上界，且不可从 User Floor 作为事实源。
- `docs/ARCHITECTURE.md`：需要继续检查 lifecycle / projection 的异步边界与宿主适配职责。

## Caveats / Not Found

- 没有本次用户现场的 Performance trace 或 Debug 导出，无法判断具体卡顿发生在初始化、GENERATION_STARTED、API 等待、Floor 保存，还是浏览器同步计算。
- 现有证据足以确认存在“宿主监听器等待 BioWeave 异步链路”的风险，但不能仅凭静态代码断定所有卡顿都来自同一处。
- 当前仍没有真实 SillyTavern 页面上的 Performance trace 或 adapter 集成测试；单元测试已覆盖生产适配器的立即返回语义。若刷新后仍出现初次打开卡顿，应单独追踪 `runtime.init()` 的官方 I/O、Tracking Registry 刷新和 `runLifecycleRecovery()`，不要重新把宿主 listener 改回可等待。

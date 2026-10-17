# Context-first Floor 持久化流程简化报告

## 结论

本轮已在现有 `Floor Persistence Coordinator` 内完成 Context-first 普通写入路径的最小改造，没有新增第二套生产 Writer，也没有修改 Floor Snapshot Schema 或业务计算规则。

- changed 事务现在从当前宿主 Context 的 Floor view 合并，调用原生 `saveChat()`，由一次官方 `/api/chats/get` readback 确认；测试中为 `1 GET + 1 native save`，直接 `/api/chats/save` 为 `0`。
- Context local no-op 不修改 Context、不调用保存、不发起官方 GET，返回 `status: "noop"`、`commitState: "local-noop"`，不能被调用方当作 `confirmed`。
- Timing 与 Aggregation 仍是两笔独立逻辑事务；本轮没有合并事务，也没有改变 Timing 成功而 Aggregation 失败时的部分成功语义。
- 同一插件/同一 Floor 的 Coordinator 队列仍串行；其他标签页、设备或直接 API 的整 Chat 并发仍可能 last-write-wins，当前宿主没有被改造成 CAS。这是已知限制，不属于本轮已解决的安全保证。

结论标签：`IMPLEMENTED_IN_PRODUCTION_COORDINATOR`、`TESTED_IN_ISOLATION`、`HOST_READBACK_REQUIRED`、`EXTERNAL_CAS_UNSUPPORTED`。

## 实际改动范围

本轮持久化改动集中在以下现有 seam：

- `storage/floor-persistence-coordinator.js`
  - 使用 `resolveCurrentContext()` / `store.getFloor()` 提供的当前 Context Floor view 作为合并输入。
  - 移除普通 Coordinator transaction 对 owner acquisition 与 latest-slot official GET 的依赖。
  - 保留 owner allow-list、Character owner、Chat/Floor/Swipe、六字段 Floor Version、执行 epoch/current guard、队列、兄弟 root 审计和 readback 失败语义。
  - 增加保存前 `COORDINATOR_PRE_SAVE_GUARD`，避免 Snapshot merge 后到 SAVE 前的 epoch/执行失效仍写入。
  - merge 后完全相等时返回 local no-op，不调用 `store.saveFloor()` 或 readback。
- `runtime/events.js`
  - Coordinator transaction 从当前宿主消息集合和 active Swipe 读取。
  - `FLOOR_TX_CONTEXT_SOURCE_READ` 进入版本链诊断，来源明确为 `host_context`。
  - Coordinator 路径调用宿主原生 `saveChat()`；保存后的官方 GET 在适配器内完成一次。
  - readback 检查 Character owner、Message ID、active Swipe、六字段 Floor Version、目标 Swipe Snapshot 和 `message.extra.bioweave` 镜像。
  - 非 Coordinator 兼容路径仍保留原有官方源读取/保存/最终审计，不把它伪装成 Context-first 计数。
- `runtime/sillytavern-adapter.js`
  - 当前 active Swipe 写入 `swipe_info[swipe_id].extra.bioweave`，并同步 `message.extra.bioweave` 镜像。
  - 非 active Swipe 写入不篡改当前消息镜像；其他 `extra` 字段和消息对象其他字段保持原样。
  - `saveChat()` 返回 `undefined` 时仍由官方 readback 决定是否能报告 confirmed。
- `docs/ARCHITECTURE.md`、`docs/bioweave-data-lifecycle.md`
  - 同步 ordinary Floor persistence 的 Context-first source、native save、单次官方 readback 和外部 CAS 限制；没有改动无关的业务规则文档。
- 测试与报告：
  - `tests/floor-persistence-coordinator.test.js`
  - `tests/runtime.test.js`
  - `tests/event-analysis-runtime.test.js`
  - `tests/floor-persistence-static-gate.test.js`
  - `tests/timing-noop-concurrency-audit.test.js`
  - 本报告及本任务的 `prd.md`、`design.md`、`implement.md`。

工作区中其他既有修改和 Trellis 目录未被清理、重置或覆盖；本轮没有写入真实 Chat/Floor。

## 新旧调用链

### 旧普通 Coordinator 路径（基线）

```text
owner patch
  -> OWNER_ACQUISITION official GET
  -> LATEST_SLOT_READ official GET
  -> Snapshot merge
  -> SAVE_PREWRITE_READ official GET
  -> /api/chats/save
  -> SAVE_AUTHORITATIVE_READBACK official GET
  -> SAVE_FINAL_SLOT_AUDIT official GET
  -> COORDINATOR_READBACK official GET
```

### 新普通 Coordinator 路径

```text
owner patch
  -> Coordinator queue
  -> current Context identity / owner / Swipe / Floor Version guards
  -> current Context Floor view
  -> owner-scoped Snapshot merge
  -> current Swipe extra.bioweave + message.extra.bioweave mirror
  -> await host saveChat()
  -> one official /api/chats/get readback
  -> owner / version / target Snapshot / sibling audit
  -> confirmed or explicit failure
```

关键实现位置：

- Coordinator dispatch/Context source/merge/no-op/save/readback：`storage/floor-persistence-coordinator.js` 的 `resolveLive()`、`dispatch()`、`commitFloorPatch()`。
- Coordinator 组装与 owner resolver：`runtime/events.js` 的 `createSillyTavernAdapter()` 中 `createFloorPersistenceCoordinator({...})`。
- Context-first host 写入与 native save/readback：`runtime/events.js` 的 `saveOfficialFloorSlot()`、`syncHostMemoryFloorSlot()`、`writeFloorSlot()`。
- Host 消息/Swipe 写入和 `saveChat()`：`runtime/sillytavern-adapter.js` 的 `writeHostFloorSlot()`、`saveChat()`。
- Storage 统一入口：`storage/store.js` 的 `saveFloor()`、`readAuthoritativeFloor()`。

## 请求计数证据

### 本轮隔离测试实测

| 场景 | Context read | 官方 `/api/chats/get` | native `saveChat()` | 直接 `/api/chats/save` | 结果 |
|---|---:|---:|---:|---:|---|
| 单笔 changed | 1 | 1 | 1 | 0 | `confirmed` |
| 单笔 Context local no-op | 1 | 0 | 0 | 0 | `local-noop`，未确认 |
| 同 Floor 两个内部 owner 连续写入 | 2 | 2 | 2 | 0 | 两笔均 `confirmed` |
| 保存失败 | 1 | 0 | 1 次尝试 | 0 | 抛出失败，不确认 |
| readback 不一致 | 1 | 1 | 1 | 0 | `FLOOR_TX_READBACK_FAILED` |

来源：`tests/timing-noop-concurrency-audit.test.js`、`tests/floor-persistence-coordinator.test.js`、`tests/runtime.test.js`。这里的 `native saveChat()` 是隔离 Host Adapter 的保存调用计数；官方 GET 计数只统计测试模型/Mock Adapter 实际标记为 authoritative readback 的调用。

### Timing + Aggregation

本轮未新增一个跨 Runtime 全链路的网络计数 fixture，因此不把 `Timing + Aggregation` 的合计数字写成本轮新实测结果。已有真实宿主验证和既有原型报告的基线是：两笔独立逻辑事务各自保存并确认，目标路径为 `2 GET + 2 SAVE`；本轮生产改造保持该事务边界，不合并也不扩大其语义。

### 旧兼容路径

非 Coordinator 调用仍可走 `saveOfficialFloorSlot()` 的兼容分支。它保留保存前官方读取、官方 `/api/chats/save` 和最终审计，不能把该分支的请求数与 Context-first Coordinator 路径混算。

## No-op 语义

三种状态必须区分：

1. UI 表单没有变化：本轮没有把 UI dirty 判断升级为持久化判断。
2. Context local no-op：Coordinator 将当前 Context Slot 与合并结果做稳定值比较，完全相等时返回 `local-noop`；这只说明当前 Context view 没有待写入差异。
3. 权威 confirmed：changed 路径完成 native save，并且官方 GET readback 通过身份、版本、Snapshot 和 sibling 检查后才返回 `confirmed`。

因此，no-op 不会自动宣称服务器存档已经确认。如果调用方必须获得权威确认，应走明确的 readback/确认流程；本轮没有把该需求隐藏到 local no-op 分支。

## 身份、版本和失败边界

- Coordinator 在保存前检查 Chat scope、Character owner、active Swipe、`assertCurrent()` 和 execution current。
- `resolveCurrentFloorVersion()` 返回完整版本且与 expected 不同时，返回 `FLOOR_TX_STALE_VERSION`，不会 SAVE。
- merge 完成后再次执行 `COORDINATOR_PRE_SAVE_GUARD`，覆盖 merge 与 SAVE 之间的 Chat epoch/执行失效窗口。
- Host Adapter 在内存写入前和 readback 时检查 Chat、Message、Floor、Swipe 和正文计算出的 Floor Version；readback 还检查当前消息镜像与 active Swipe slot 一致。
- 历史 Floor 仍由现有 owner/selector 与 Floor Version 约束限制；本轮没有把历史 Slot 改为可写。
- 保存失败不返回 confirmed；save Promise 结果不明时不会靠其返回值确认。
- 官方 readback 缺失、消息身份不匹配、active Swipe 不匹配、六字段版本不匹配、目标 Snapshot 不匹配或镜像不匹配时，返回/抛出明确失败，不自动重放旧 Snapshot。

## Snapshot 与字段所有权

Coordinator 仍通过 `FLOOR_OWNER_FIELDS` 限制 owner patch，只合并当前 owner 管理的字段；未被当前 patch 提供的 sibling root 继承保留，明确提供的空集合仍表示显式清空。

本轮没有更换 Schema root，尤其保留：

- `projection_timing_snapshot`
- `participant_aggregation_snapshot`

Host 写入只更新 `extra.bioweave` 的 BioWeave slot 及 active Swipe 镜像，不替换整个 `message.extra`，因此测试覆盖了其他扩展字段、消息正文、其他 Swipe 和 sibling root 保留。

## 并发结果

### 插件内部并发

同一 `transaction_key` 继续使用 Coordinator queue 串行化。确定性 barrier 测试证明两个内部 owner 的连续写入分别 SAVE/readback，并保留前一个 owner 的 root。

### 外部并发

确定性测试在 Context read/merge 后、native save 前注入同 Floor 外部 sibling 修改，结果显示 Context-first 写入可能覆盖该外部修改，同时 readback 仍确认自己的最终内容。这是当前宿主无 CAS/条件 Chat save 时的 last-write-wins 限制；不能把“readback 匹配自己的写入”解释为“没有发生外部覆盖”。

因此：

- 单标签页、插件内部队列：在本轮测试模型中可用。
- 其他插件在同一 Context 更新不同 `extra` 字段：只要仍通过字段级写入，不替换整个 `extra`，本轮路径可保留；跨异步窗口的整对象替换仍不受插件队列保护。
- 其他标签页、设备、直接 API：未获得宿主 CAS 保证，仍是未解决风险。

## Timing + Aggregation 语义

`projection-timing.js` 和 `participant-aggregation.js` 仍通过同一个 Coordinator 工厂提交各自 owner patch，但每个操作各自拥有独立 transaction key/保存/readback。没有把 Timing 和 Aggregation 合为一笔不可分割事务，也没有复用 Timing 的权威结果作为 Aggregation 的权威输入。

如果 Timing 保存确认失败，调用链不能把 Aggregation 继续包装成已完成；如果 Timing 已确认而 Aggregation 失败，仍保留部分成功状态。这些语义由现有 Runtime 测试与本轮并发模型测试覆盖，未改动业务规则。

## 测试结果

本轮最终执行：

- `node --test tests/timing-noop-concurrency-audit.test.js`：18/18 通过。
- `node --test --test-name-pattern='manual Timing Instance edit writes|automatic analysis trace exposes|SillyTavern official Floor readback' tests/event-analysis-runtime.test.js`：3/3 通过。
- `npm run check`：退出码 0；共 1682 个测试，1666 通过，16 个既有 skip，0 失败，0 cancelled。
- `git diff --check`：通过。
- 关键生产文件 `storage/floor-persistence-coordinator.js`、`runtime/events.js`、`runtime/sillytavern-adapter.js`：`node --check` 通过（`npm run check` 也完成入口语法检查）。

新增/迁移的并发测试使用 Promise Deferred/barrier，不使用固定 sleep。测试明确保留了候选 A/B 的读取复用反例、候选 C 的 Timing→Aggregation 跨事务输入变化反例、内部队列成功边界、外部 last-writer-wins 限制及部分成功模型。

## 未解决限制与正式使用条件

正式 Chat 使用前仍必须接受以下边界：

1. 当前宿主原生 `saveChat()` 的 Promise/void 返回不能单独证明文件持久化；必须保留官方 readback。
2. 本地 Context/插件队列不能防止其他标签页、设备或直接 API 的整 Chat 覆盖；宿主未提供 CAS 时不能声称跨客户端并发安全。
3. `local-noop` 不是服务器确认；需要确认的调用方必须显式选择 readback 语义。
4. 兼容非 Coordinator 路径仍有旧的官方读取/保存开销；本轮没有把它误改成新的计数，也没有移除其保护。
5. 本轮未执行真实正式 Chat 写入；现有 SillyTavern 1.19.0 临时 Chat 验证只作为此前 Host Context/save/readback 能力证据，不等于跨客户端并发保证。

在不削弱 Floor Version、Swipe、epoch、owner、readback 和部分成功语义的前提下，Context-first Coordinator 路径已具备进入受控验证/小范围使用的基础；跨标签页/设备 CAS 仍是明确的宿主限制，而不是本轮可以通过减少 GET 解决的问题。

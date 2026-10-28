# Research: 第一阶段候选支线与第二阶段 progression 持久化对比

- Query: 对比推演页第一阶段候选支线与第二阶段 progression_event 的同楼反复读取、覆盖、Floor 写回/读回及上下文提交流程。
- Scope: internal
- Date: 2026-10-28

## Findings

### 1. 第一阶段的“当前楼反复分析”边界

- `runtime/projection-storyline-runtime.js:424-443` 同时读取当前 endpoint 与 previous endpoint；previous snapshot 只用于“是否已经存在设计结果”的抑制判断，当前 endpoint 会覆盖 working map，供事实闭环、响应计数和后续 judge 使用。
- `runtime/projection-storyline-runtime.js:503-511` 的 design gate 以 `previousSnapshots.has(subjectId)` 为主要去重依据；因此同一 Floor 的旧设计数据不会抑制再次设计。`forceStorylineReanalysis` 只对 selected snapshot 放行替换。
- `runtime/projection-storyline-runtime.js:578-607` 先并发 API，之后在单一有序 consolidation pass 中逐个 `saveVerified()`；失败的 subject 只保留诊断，不抹掉已成功的 sibling。
- `runtime/projection-storyline-runtime.js:221-294` 的 `saveVerified()` 把所有写入 snapshot 的 `created_at_floor_version` 重基到当前 Floor，使用完整 collection replacement，并在保存后进行 authoritative timeline 或 projection view readback；任何 subject/字段不匹配都失败，不报告成功。
- `storage/projection.js:242-275` 的第一阶段 triggered snapshot 写法和 `:278-295` 的 storyline snapshot 写法都保留历史 sibling，只替换当前 Floor collection 中目标人物；storyline 使用 `rebaseAtCommit: true`，在提交前以 coordinator 最新 Floor 重算 patch，避免并发 subject 写入互相覆盖。
- 关键结论：第一阶段避免旧数据抑制靠“存在性判断读 previous endpoint、结果状态读 current endpoint、写入是当前 Floor 完整集合 replacement”，而不是删除历史 Floor 或跳过权威 readback。

### 2. 第二阶段 API 返回后的实际顺序

- `runtime/projection-storyline-runtime.js:296-389` 的 `generateProgressionEvent()` 在 API 返回后会依次：重新解析 current Floor (`:349`)、读取 current projection views (`:351`)、确认当前 snapshot 仍是合法入口/可重分析状态 (`:353-360`)、parse/apply (`:375-386`)，然后调用一次 `saveVerified(... reason: 'progression-generation')` (`:387`)。
- `saveVerified()` 内部调用 `storage/projection.js:278-295` 的完整 storyline snapshot save；其 `mutateFloor()` (`storage/projection.js:78-145`) 先做 owner/version/历史 ID 校验，再走 `floorPersistence.commitFloorPatch()`。这本身包含 Floor transaction、保存和 authoritative readback；因此 progression API 返回后第一次慢点是“快照写回 + 权威回读”，并非 JSON parse。
- 外层随后无条件回读并刷新上下文：`runtime/projection-runtime.js:1811-1823` 在 `storylineRuntime.settled()` 完成后再次 `getProjectionViews()`，再调用 `refreshProjectionContext()`。
- `runtime/projection-context.js:486-518` 在非 readOnly 且 prompt 包含 storyline 时，会为每个未终止 storyline 调用 `recordStorylineSubmission()`，随后还会调用 `recordProjectionSubmission()`。前者由 `runtime/projection-storyline-runtime.js:207-219` 进入 `saveProjectionStorylineDelivery()`，后者进入一般 projection delivery 保存。这两类 receipt 都是独立 Floor patch，因此可触发第二轮（甚至按人物数多轮）Floor 保存/权威回读。
- 新 Debug 的 trace 顺序可见：`PROGRESSION_PARSE` → `SNAPSHOT_WRITE`/`floor-tx-1` → 失败后 `PROJECTION_CONTEXT_REFRESH_STARTED` → `CONTEXT_SUBMISSION_RECEIPT`/`floor-tx-2`。这证明第二轮不是 API 重试，而是 progression 快照失败后仍进入了上下文刷新/提交 receipt 路径。

### 3. 为什么当前 Debug 会显得“API 返回后仍很慢”

- `ST-BioWeave-Debug-20261028-012512.txt` 中 progression API 已经返回后，随后经历 `floor-tx-1` 的多次 `BIOWEAVE_FULL_CHAT_SAVE_READBACK`，最终 `ANALYSIS_SLOT_AFTER_READBACK.present=false`、`FLOOR_PERSISTENCE_READBACK_FAILED`；随后仍启动 context refresh，并因 storyline submission 产生 `floor-tx-2`，再次重复保存/回读并失败。
- 因而需要区分两种耗时：
  1. progression 快照本身的权威持久化与 readback；
  2. 即使快照写回失败，外层仍继续的 context rebuild + storyline submission receipt + projection submission receipt。
- 第二阶段比第一阶段更容易暴露这个问题，是因为它在一个 settle 中“先计数/receipt/judge，再生成 progression，再最终 context refresh”；progression 返回后又通过 context coordinator 记录 submission receipt，造成额外 Floor patch。历史 Floor 不受影响，但当前 Floor 上的多次 patch 会串行排队。

## Minimal reusable solution

1. 保留第一阶段已经证明安全的三条边界：previous endpoint 只负责“是否已有结果”的抑制；current endpoint 负责当前状态；`saveVerified()` 继续使用完整 collection replacement + authoritative readback。
2. 在 `runtime/projection-runtime.js:1811-1823` 增加“storyline settled 结果/快照写回是否确认”的门槛：如果 progression/settled 返回明确的 persistence failure，则本轮不要继续调用会写 Floor 的 context submission receipt；可以只做只读 UI/context refresh，或直接返回失败状态让下一次 settled 重试。不要把失败当成功，也不要跳过快照的权威 readback。
3. 更小的重复写入优化是在 `runtime/projection-context.js:486-518` 将 storyline submission 与一般 projection submission 合并成同一次当前 Floor patch（由现有 projection persistence 增加批量 receipt 入口），但这会扩大接口改动；优先采用“失败短路”方案，先消除当前 Debug 中明确的 `floor-tx-2`。
4. 成功路径仍可能包含“快照确认 + submission receipt + projection receipt”两类写入。若要进一步减少成功路径延迟，应提供一个同一 `mutateFloor` 事务中的组合提交，并在一次 authoritative readback 后返回；不能把 context coordinator 的保存改成非等待或只读缓存，否则会破坏刷新后可见性和 Floor owner contract。

## Caveats / Not Found

- `PROJECTION_CONTEXT_REFRESH_STARTED` 在当前 Debug 的 `floor-tx-1` 过程中出现，说明 host/runtime 还有一条事件驱动的 context refresh 入口；在本次目标文件中没有找到由 `storage/floor-persistence-coordinator.js` 直接调用 projection context 的代码。需要在主任务中继续沿 `setExtensionPrompt`/Host save 事件绑定确认该刷新触发源。
- 不能仅以 `PROJECTION_CONTEXT_REFRESH` 的总耗时判断 UI 渲染慢；当前 trace 表明 UI 等待的是整个 `process()`，其中包括 Floor transaction、retry/readback 和 delivery receipt。
- 本研究没有修改生产代码，也没有验证真实 SillyTavern host 下的保存竞态；建议先补一个测试：progression snapshot persistence rejected 时，不应调用 `recordStorylineSubmission`/`recordProjectionSubmission` 的写入路径。

## Related specs

- `.trellis/spec/domain/floor-state.md`：Floor owner、current/previous endpoint、完整快照 replacement 与 authoritative readback。
- `docs/bioweave-data-lifecycle.md`：Projection/Floor 持久化与派生上下文生命周期。
- `.trellis/tasks/10-27-storyline-node-progression-update/design.md`：progression_event 的状态和失败重试边界。

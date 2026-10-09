# ST-BioWeave World Model 长聊天性能审计报告

审计性质：只读。审计期间未修改生产代码、测试、fixture、真实聊天数据、Floor persistence contract 或 Git 历史；仅新增当前 Trellis 任务 artifacts。

证据等级：

- `CONFIRMED`：代码控制流或可重复 benchmark 直接证明。
- `LIKELY`：代码路径明确显示风险，但缺少真实宿主/DOM 分层测量。
- `UNVERIFIED`：当前环境不能安全验证，不能当作根因。

## 1. 当前 HEAD / worktree 状态

- Branch：`fix/world-model-prompt-baseline`
- HEAD：`fdcea3c9af6b7736e5a7c4f5d4f6c88c0ede3223`
- 审计开始前 worktree：clean
- 当前 worktree：仅新增 `.trellis/tasks/10-09-world-model-long-chat-performance-audit/`
- 未执行：Full、Supplement、migration、commit、push、reset、clean

规范依据：`.trellis/spec/domain/floor-state.md`、`.trellis/spec/domain/world-model.md`、`docs/bioweave-data-lifecycle.md`、`docs/ARCHITECTURE.md`。

## 2. World Model 完整读取调用链

### BioWeave UI 初次打开 / Overview

```text
openBioWeave()
  -> lifecycle.open()
  -> initializeRoot()
  -> render()                         ui/app.js:5776-5826
  -> refreshBusinessState("ui-read")  ui/app.js:4142-4149
  -> runtime.collectActiveBusinessData()
  -> statusForCurrentFloor()
  -> collectCurrentDerivedState()
  -> collectTrackingInputs()
  -> collectCurrentFloorStates()      event-analysis.js:1528-1561
  -> resolveWorldModelAtOrBefore()    event-analysis.js:1563-1595
  -> resolveCurrentFloor()
  -> resolveFloorAtIndex()
  -> store.getFloor() / active Swipe
  -> Floor Version recomputation
  -> cloneWorldValue(world_model)
```

`collectActiveBusinessData()` 不直接构建 World UI，但其 derived-state 路径会读取 World Model，并把它传给 Tracking/derived state。

### World 页面打开

```text
go("world") / render()
  -> loadWorldModelState()             ui/app.js:4040-4048, 2371-2385
  -> reloadWorldModelFromRuntime()
  -> runtime.resolveWorldModelAtOrBefore()
  -> normalizeStoredWorldModel()
  -> applyWorldModelUiIngress()
  -> buildWorldModelViewModel()        ui/app.js:1909-1913
  -> fingerprintWorldModel() x2
  -> render()
  -> worldPage()
  -> renderWorldModelView()
  -> buildWorldModelViewModel()        ui/world.js:907-924
  -> main.innerHTML = pageMarkup       ui/app.js:4049-4105
  -> stableWorldModelStringify() x2     ui/app.js:4108-4110
```

### World persistence / authoritative readback

```text
Full/Supplement or manual UI save
  -> saveWorldModel()                  runtime/world-analysis.js:351-408
  -> commitFloorPatch(owner="world")
  -> FloorPersistenceCoordinator
  -> store.saveFloor()
  -> authoritative readback
  -> resolveWorldModelUiReady()
  -> buildWorldModelViewModel()
  -> WORLD_PERSISTENCE_CONFIRMED       runtime/world-analysis.js:710-785
  -> UI projectCommittedWorldModel()
  -> applyWorldModelUiIngress()
```

## 3. 每个阶段的时间复杂度

### Floor 数量 / 消息数量 A

`resolveWorldModelAtOrBefore()` 从 `target.index` 向 0 逐条回溯；每个 Character candidate 会执行 `resolveFloorAtIndex()`、Floor Version 校验和 `getFloor()`。代码位置：`runtime/world-analysis.js:323-347`。

结论：`CONFIRMED O(K)`，其中 K 是从目标 Floor 到最近有效 World Model snapshot 的回溯距离；最坏为 O(N)。循环内部还重复调用 `getMessages()`，但当前 `getMessages()` 是同步 Host collection read，不是一次性快照。

`collectCurrentFloorStates()` 从 0 扫到末尾，并为每个 Character Floor 重新计算 Floor Version：`runtime/event-analysis.js:1528-1561`。结论：`CONFIRMED O(N)`。

`collectActiveBusinessData()` 的 UI-read 路径至少组合一次全量 `collectCurrentFloorStates()` 和一次 World resolver：`runtime/event-analysis.js:2192-2242`、`1767-1830`、`1563-1595`。结论：`CONFIRMED 至少 O(N + K)`，不是单纯 World resolver 成本。

### World Model 数据体积 B

`normalizeStoredWorldModel()`、`buildWorldModelViewModel()`、`structuredClone()`、`JSON.stringify()` 都按模型结构体积增长。代码位置：

- `ui/app.js:1909-1917`
- `ui/app.js:2059-2265`
- `ui/world.js:907-924`
- `ui/app.js:4106-4121`

结论：`CONFIRMED O(S)`，S 为 World Model payload 规模；实际常数取决于 species/type/rules/archive 列表长度和字符串长度。

### 历史 World Model 快照数量 C

历史快照没有独立 Chat-level array；每个快照位于对应 Character Floor/active Swipe 的 Floor slot。Resolver 找到最近有效 snapshot 后立即停止：`runtime/world-analysis.js:325-347`。

结论：`CONFIRMED`：若最近有效 snapshot 距离固定，新增更早快照不增加该次 resolver 的扫描；若当前没有较近有效 snapshot，历史 snapshot 距离会转化为 K，成本为 O(K)。历史快照数量不能单独等同于成本。

### UI 初始化 / 渲染 D

`openBioWeave()` 首次调用会经 `initializeRoot()` 执行一次 `render()`，随后 `openBioWeave()` 自身再次执行 `render()`：`ui/app.js:5776-5826`、`5853-5860`。

结论：`CONFIRMED`：首次打开存在两次同步 render。第一次 render 在 `ui/app.js:4142-4145` 启动 business refresh；第二次 render 若 refresh 仍 in-flight，会排队一次后续 refresh：`ui/app.js:3530-3657`。这是 UI lifecycle amplification，不等于 World resolver 已经执行两次，但会让全量 derived-state refresh 可能执行两轮。

## 4. 实际性能测量结果

测量方式：Node isolated synthetic data；未读取真实 Chat，未调用 AI，未写 Floor。每组 7 次，报告中位数或均值；CPU 计时使用 `performance.now()`。

### 4.1 World 数据体积控制

模型为 synthetic species/type/reproductive-mechanism 数据，分别测 normalize、View Model、HTML View render、structuredClone、JSON.stringify：

| 数据规模 | JSON 大小 | normalize | View Model | renderWorldModelView | structuredClone | JSON.stringify |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 2 species / 4 types | 4.1 KB | 0.062 ms | 0.039 ms | 0.100 ms | 0.021 ms | 0.005 ms |
| 20 species / 100 types | 109.7 KB | 0.573 ms | 0.623 ms | 0.773 ms | 0.442 ms | 0.110 ms |
| 80 species / 800 types | 1.14 MB | 5.297 ms | 5.302 ms | 6.435 ms | 4.664 ms | 1.339 ms |

这些是 Node CPU/字符串构建时间，不是浏览器 DOM layout/paint 时间。结果支持 `CONFIRMED O(S)`，但不能单独证明用户卡顿达到可见阈值。

### 4.2 Floor/历史回溯控制

使用实际 `createWorldAnalysis().resolveWorldModelAtOrBefore()`，synthetic Floor slot 和真实 resolver 控制流；World snapshot 放在不同历史位置：

| 消息数 | snapshot 位置 | 回溯距离 | resolver CPU 中位数 | resolver calls / run | Floor reads / run |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 5,000 | 4,999 | 0 | 0.036 ms | 1 | 1 |
| 5,000 | 4,500 | 499 | 0.673 ms | 500 | 500 |
| 5,000 | 2,500 | 2,499 | 2.219 ms | 2,500 | 2,500 |
| 5,000 | 0 | 4,999 | 3.938 ms | 5,000 | 5,000 |

另一组固定 snapshot 在最老 Floor：

| 消息数 | model 大小 | resolver CPU 中位数 | resolver calls / run | Floor reads / run |
| ---: | ---: | ---: | ---: | ---: |
| 1,000 | 1.2 KB | 0.915 ms | 1,000 | 1,000 |
| 1,000 | 44.4 KB | 0.867 ms | 1,000 | 1,000 |
| 5,000 | 1.2 KB | 3.803 ms | 5,000 | 5,000 |
| 5,000 | 44.4 KB | 3.615 ms | 5,000 | 5,000 |

结论：在该 synthetic 范围内，回溯扫描成本明显由 Floor 距离主导；World clone 成本需要模型更大时才会成为主要部分。Storage/Network 等待为 0，因为测试使用同步内存 slot；真实 Host I/O 标记为 `UNVERIFIED`。

### 4.3 UI render / refresh 测量边界

- 生产 UI 的真实 DOM layout/paint 未在本轮真实 SillyTavern 浏览器中执行：`UNVERIFIED`。
- `renderWorldModelView()` 的 CPU/HTML 构建已在 4.1 测量。
- UI 代码级 refresh 次数可由调用链确认：首次打开至少两次 `render()`；World ingress route 下每次 ingress 还可能调用一次 `render()`；真实浏览器 paint 次数未测量。

## 5. 随楼层数量增长的热点

### `CONFIRMED`

1. 打开 Overview 会触发 `refreshBusinessState()`，其 derived-state collector 扫描所有当前 Character Floor 并重新计算 Floor Version。
2. 同一条路径随后调用 World resolver；当最近有效 World snapshot 较旧时，resolver 逐 Floor 回溯。
3. `resolveFloorAtIndex()` 对每个候选重新读取 Floor 并重新计算六字段 Floor Version；resolver 本身没有跨调用缓存。
4. resolver 循环内每次迭代调用 `getMessages()`，虽然当前是内存读取，但代码没有先固定 `all` 快照。

### `LIKELY`

长 Chat 中，`collectCurrentFloorStates()` 的全量扫描和 World resolver 的回溯可能叠加，使“打开 BioWeave UI”随着消息/Floor 数量增长变慢；需要真实宿主或完整 runtime benchmark 分离 SHA-256、Host slot read 和 derived-state build 的占比。

### `UNVERIFIED`

真实 SillyTavern 的 Host message access、官方存储 readback、浏览器 DOM layout/paint、扩展其它 listener 造成的等待，本轮未测量。

## 6. 重复读取 / 重复计算证据

### `CONFIRMED`

- `resolveWorldModelAtOrBefore()`：每次调用对候选调用 `resolveFloorAtIndex()`，随后又调用一次 `getFloor()`；而 `resolveFloorAtIndex()` 自身已经取得 `floorData`。因此同一候选的 Floor data 在 resolver 路径中存在重复读取机会：`runtime/event-analysis.js:1411-1421` 与 `runtime/world-analysis.js:332-340`。
- `applyWorldModelUiIngress()` 构建一次 View Model：`ui/app.js:1909-1913`；`renderWorldModelView()` 又构建一次：`ui/world.js:922`。
- World UI render diagnostic 对当前 model 执行两次 `stableWorldModelStringify()`：`ui/app.js:4108-4110`。
- UI ingress 默认还计算 canonical 与 view fingerprint；commit-before-fingerprint 分支会把 fingerprint 延后，但仍计算两份：`ui/app.js:1914-1927`、`2200-2240`。

### `LIKELY`

重复 View Model 和 fingerprint 对大型 World Model 可能构成 UI 打开/刷新成本；4.1 的 synthetic benchmark 显示 1.14 MB 模型单次 View Model 约 5.3 ms、HTML render 约 6.4 ms，但尚未证明真实浏览器卡顿由此主导。

### `UNVERIFIED`

本轮没有在真实 Host 中对同一 Floor read 做 adapter/network timing，因此不能把 Storage 重复读取的同步 CPU 或异步等待量外推为用户端总耗时。

## 7. UI refresh / event amplification 证据

### `CONFIRMED`

- 初次打开双 render + queued business refresh：`ui/app.js:477-482`、`5776-5826`、`5853-5860`、`3530-3657`。
- Runtime event handler 对所有非 `BIOWEAVE_PERSISTENCE_TRACE` 事件，在 panel open 时最终执行 `render()`：`ui/app.js:5121-5122`。
- World Model owner mutation 先执行 `invalidateWorldModelView()`；World route 下该函数自身 render，然后同一 runtime event 继续走最终 render：`ui/app.js:1860-1872`、`4990-4996`、`5121-5122`。
- `WORLD_ANALYSIS_STATUS_CHANGED` 在 World route 下直接 render，随后同一事件也会走最终 render：`ui/app.js:5039-5060`、`5121-5122`。
- `WORLD_PERSISTENCE_CONFIRMED` 异步进入 `projectCommittedWorldModel()`；ingress route 会 render，事件处理函数本身没有等待该 Promise，随后仍有一次最终 render：`ui/app.js:5029-5037`、`5121-5122`。
- World route 的 `BIOWEAVE_LIFECYCLE_SETTLED` 会调用 `reloadWorldModelFromRuntime()`；reload ingress 又会 render：`ui/app.js:4990-4996`、`2059-2265`。

### `LIKELY`

同一业务事件可能产生“状态 invalidation render + 通用 runtime render + authoritative reload render”三类 render；对大 World Model，这种 amplification 比单次 resolver 循环更可能解释“数据不断积累后打开 UI 变慢”。需要浏览器 Performance/trace 实测确认每个事件的实际 paint 和 DOM cost。

### `UNVERIFIED`

不同 SillyTavern 版本是否重复发送同一 host event、多个 runtime subscriber 是否并存、浏览器是否合并相邻 `innerHTML` 更新，本轮未在真实宿主验证。

## 8. UI 打开性能结论

1. `CONFIRMED`：打开 BioWeave panel 初次初始化会 render 两次，并可能排队两轮 business refresh。
2. `CONFIRMED`：Overview 的 business refresh 不是 World UI 专属，但会扫描有效 Floor 并读取 World Model。
3. `CONFIRMED`：进入 World 页面会自动读取 World Model；`loadWorldModelState()` 在 `render()` 中触发，且只在 `loaded/loading` 条件下跳过。
4. `CONFIRMED`：World 页面至少有一次 ingress View Model build 和一次 page render View Model build。
5. `UNVERIFIED`：真实浏览器 DOM render、paint、Host I/O 是否超过用户可感知阈值。

## 9. World Model 数据体积与历史快照成本

- `CONFIRMED`：当前 World Model payload 体积影响 normalize、clone、View Model、HTML string 和 diagnostic stringify。
- `CONFIRMED`：历史快照数量只有在最近有效 snapshot 距离变大、或中间 Floor 无效需要继续回退时才增加 resolver 工作；不是无条件扫描全部历史快照。
- `CONFIRMED`：World Model 历史状态存储在 Floor/Swipe slot，不是 Chat-level latest state。
- `UNVERIFIED`：真实用户 World Model 体积、快照分布和浏览器内存压力。

## 10. Floor 历史版本正确性

### 已确认的当前语义

- `resolveWorldModelAtOrBefore()` 从目标 index 向旧 index 查找，要求 active Swipe、Floor Version 一致、未 invalidated，并在找到带 `world_model` 的 Floor 后立即返回：`runtime/world-analysis.js:323-347`。
- `saveWorldModel()` 先解析当前 Floor，再将 World-owned patch 交给 `commitFloorPatch()`；Coordinator 以当前 slot 为基础 merge，只替换 World-owned fields 并保存到目标 Floor/Swipe：`runtime/world-analysis.js:351-408`、`storage/floor-persistence-coordinator.js:249-345`。
- 当前 UI Archive/Restore/Permanent Delete 都从当前 UI model/meta 构造新 model/meta，再调用 `runtime.saveWorldModel()`，不会直接修改旧 Floor：`ui/app.js:2696-2824`、`2825-2876`、`2878-2940`。
- Store 读取严格从 Character message 的当前 active Swipe slot 读取，并检查 Chat scope：`storage/store.js:820-847`。

### 预期场景判断

| 场景 | 当前代码判断 | 等级 |
| --- | --- | --- |
| Floor 10 保存 A | 写入 Floor 10 owner slot | `CONFIRMED` |
| Floor 20 Archive 后保存 B | UI archive 变更当前 model/meta，`saveWorldModel()` 写 Floor 20 | `CONFIRMED`（代码路径） |
| Floor 21 无新修改继承 B | resolver 从 Floor 21 向前遇到 Floor 20 B | `CONFIRMED`（控制流） |
| 删除 Floor 20+ 后回到 Floor 18 读取 A | resolver 跳过不存在/无效 owner，返回 Floor 10 A | `CONFIRMED`，已有删除回退测试支持 |
| 旧 Floor 10 被原地修改 | Coordinator merge 目标为当前 target，未发现旧 Floor 写入 | `CONFIRMED 未发现该污染路径` |
| 未来全局 latest 覆盖历史 | 未发现 World resolver 使用 Chat-level latest fallback | `CONFIRMED 未发现` |
| Swipe 切换污染 | Store/resolver 使用 active Swipe 和完整 version | `CONFIRMED 未发现`，已有测试覆盖基础隔离 |
| Chat 切换污染 | UI token/chat checks 与 resolver Chat-scoped | `CONFIRMED 未发现`，已有 UI stale reload 测试覆盖 |

本轮没有实际执行用户 Chat 的删除操作，以上是 synthetic fixture/现有测试和控制流结论，不是对用户真实数据的操作结果。

## 11. Archive / Restore / Delete 的版本语义

- Archive 是“从 active model 移除完整 subtree，并把 subtree 放进 `world_model_meta.archived_species[]`”的纯数据变换：`core/world-species-archive.js:58-73`。
- Restore 从 archived meta 复制 subtree 回 active model，并从 archive list 移除：`core/world-species-archive.js:75-89`。
- Permanent Delete 只从 archive meta 删除 snapshot，不修改 active model：`core/world-species-archive.js:92-103`。
- 三者最终均通过当前 Floor 的 `saveWorldModel()` 持久化；因此在当前设计中会创建/替换当前 Floor 的 World snapshot，而不会回写过去 Floor。
- 后续 World Full/Supplement 会以当前 valid Floor resolver 的 model/meta 作为 baseline；archive identity 作为 exclusion 输入，不是 Chat-global blacklist。

结论：历史版本语义从代码上符合 Floor 10/A → Floor 20/B → 回退 A 的预期。缺少的是针对“Archive 具体生成 B、删除 Floor 20 及之后、验证 archive 恢复为未归档”的端到端回归测试，而不是已确认的 ownership bug。

## 12. 已有测试覆盖与缺口

### 已有覆盖

- `tests/event-analysis-runtime.test.js:7224-7269`：World save 只写当前 Floor，并保留 Event-owned fields。
- `tests/event-analysis-runtime.test.js:7272-7298`：最近有效 World Floor 与删除后回退。
- `tests/event-analysis-runtime.test.js:7301-7328`：编辑造成 stale Floor Version 后跳过。
- `tests/event-analysis-runtime.test.js:7330-7363`：Swipe owner isolation。
- `tests/ui.test.js:2838-2906`：World view mutation reload、删除 owner、stale reload。
- `tests/ui.test.js:2908-2968`：Chat change 后 stale reload 不污染新 Chat。

### 缺口

- 未发现完整的 World-specific Archive 场景：Floor 10 A → Floor 20 Archive/B → Floor 21 B → 删除 Floor 20+ → Floor 18 A 且 archived species 恢复 active。
- 未发现 Archive/Restore/Permanent Delete 在多个独立 Floor snapshot 上的组合回退测试。
- 未发现“中间 Floor 删除、后续 Floor 有独立 World snapshot”时的 World resolver 明确测试。
- 未发现 UI 打开性能 benchmark 或 DOM render count regression test。
- 未发现同时控制 Floor count、World payload size、history snapshot distance 的 runtime benchmark。

## 13. 已确认根因

当前证据支持以下性能根因候选为 `CONFIRMED`（代码行为层面），但“用户可感知卡顿的唯一主因”仍需 real-host 分层测量：

1. 首次 UI 打开双 render，并可能产生 queued business refresh：`ui/app.js:5776-5860`、`3530-3657`。
2. 每次 business refresh 对所有有效 Character Floor 做 Floor Version 重建和 derived-state 扫描：`runtime/event-analysis.js:1528-1595`、`1767-1830`。
3. business refresh 额外执行 World resolver；回溯距离越大，Storage/Floor candidate checks 越多：`runtime/event-analysis.js:1563-1595`、`runtime/world-analysis.js:323-347`。
4. World UI ingress/render 路径重复构建 View Model，并重复执行 fingerprint/stringify：`ui/app.js:1909-1927`、`ui/world.js:922`、`ui/app.js:4108-4120`。
5. Runtime event 处理存在多处 render 入口，可能在同一事件上重复更新 DOM：`ui/app.js:4990-5122`。

## 14. 尚未验证的怀疑

- `LIKELY`：实际卡顿主要由 UI refresh amplification 而非历史 Floor scan 主导。
- `LIKELY`：大 World Model 的重复 View Model/fingerprint/render 在数据体积达到用户规模后超过 resolver CPU。
- `UNVERIFIED`：SillyTavern 官方 Floor readback/network 等待是否参与 UI 打开路径；本轮 synthetic store 没有异步 I/O。
- `UNVERIFIED`：浏览器 layout/paint、GC 和 `innerHTML` DOM 重建的真实耗时。
- `UNVERIFIED`：宿主是否发送重复/成对 lifecycle event，或是否有多个 App/runtime subscriber。

## 15. 可以安全优化的部分

仅作为后续方案，不在本轮实施：

1. 合并 `openBioWeave()` 首次初始化与显式 render，避免双初始 render/queued refresh；必须保留现有 overlay lifecycle 和 business refresh coalescing。
2. 让 World page 消费已生成的 canonical/view DTO，避免 ingress 和 `renderWorldModelView()` 二次 build；需证明 UI selection/edit helpers 不依赖重新 canonicalize。
3. 合并同一 runtime event 的 invalidation/render 通知，确保每个 authoritative projection 只触发一次可见 render。
4. 在不改变 ownership 的前提下，将一次 `resolveFloorAtIndex()` 返回的 validated `floorData` 作为 resolver 当前候选的局部值，消除同一候选的重复 Floor read；不能变成跨生命周期缓存。
5. 为性能验证增加独立 benchmark/regression harness，而不是在生产路径新增 World Model cache。

## 16. 不建议修改的部分

- 不绕过完整 Floor Version、active Swipe、Chat scope、authoritative readback 或 stale owner guard。
- 不把 World Model 放回 Chat metadata、message mirror 或全局 latest cache。
- 不让 resolver 从未来 Floor 读取历史模型。
- 不把 archive exclusion 提升为跨 Chat/Swipe 的全局 blacklist。
- 不通过减少历史回退检查来换速度；历史正确性优先。
- 不以一次循环、`structuredClone` 或 `JSON.stringify` 的静态存在直接判定根因。

## 17. 最小修复方案

建议后续按风险从低到高分两步，等待用户单独批准：

### Step 1：UI lifecycle/render 去重

- 统一首次 `initializeRoot` / `openBioWeave` render 时机。
- 将 World ingress、runtime event、lifecycle settled 的 render 责任合并为单一提交点。
- 保留 stale reload suppression、Chat token、Floor Version 和 authoritative readback。

### Step 2：局部重复读取与 View Model 去重

- 仅在同一次 resolver 调用内复用已验证 candidate floor data。
- 明确 canonical model、view model 和 render DTO 的 owner，避免同一 ingress 再次完整 build。
- 增加 benchmark 证明优化前后在四维变量矩阵上均不损害历史回退。

不建议第一步就引入持久或跨生命周期 World Model cache。

## 18. Regression test 设计

实施阶段已补充历史回退与生命周期回归测试；以下仍是后续可继续扩展的测试建议：

1. `World Model archive creates a new current-Floor snapshot and rolls back after later-Floor deletion`：构造 Floor 10 A、Floor 20 archive/B、Floor 21 inherit B，删除 20/21 后目标回到 18，断言 A 且 species active。
2. `World Model archive/restore/permanent-delete preserve older Floor snapshots`：分别断言旧 slot 不被原地修改。
3. `World Model resolver uses nearest valid snapshot and ignores future/invalid Swipe owners`：覆盖中间删除、stale version、Swipe switch。
4. `World Model resolver remains Chat-isolated after Chat switch`：同 message index 不得读到另一 Chat model。
5. `UI open performs one initial render and one business refresh`：fake runtime 计数，验证不存在 initialize/open 双调用和 queued duplicate refresh。
6. `World UI ingress builds View Model once per committed projection`：instrument normalizer/view builder/render count。
7. 四维 benchmark：固定三项，只改变 Floor count、model bytes、snapshot distance、UI event sequence，记录 CPU/async/Storage/DOM proxy。

## 19. 文档 / Trellis 影响

- 本轮没有修改生产 Markdown；审计报告和规划 artifacts 位于当前 Trellis task 目录。
- 现有 architecture、Floor ownership、World Model 和 lifecycle 文档仍足以描述本次观察到的 owner/readback 约束。
- 若后续批准 Step 1/2 实施，必须重新检查 `docs/ARCHITECTURE.md`、`docs/bioweave-data-lifecycle.md` 及相关 UI/World Model 文档；本轮不提前修改。

## 20. Verification summary

- 关键源文件 `node --check`：通过。
- 定向 World/UI/history tests：14 项中 13 项通过，1 项既有 scheduler reconciliation 测试失败（期望 3、实际 2），与 World resolver/UI 性能结论无直接因果证据。
- `npm test`：完整 suite 在约 119 秒后被中断；过程中观察到既有 Event preflight、scheduler reconciliation 及 World prompt assertion failures，且大量测试尚未完成，不能宣称全量通过。
- 未执行真实宿主浏览器性能录制、Network timing 或 DOM paint profiling。
- 最终报告结论停止在审计和方案建议，不实施修复。

## 21. 第一阶段实施记录

本阶段经用户批准后实施，范围仅限 UI/World 局部去重和回归测试；未修改 Floor persistence contract、未新增缓存、未执行 Full/Supplement、migration 或真实数据操作。

### 修改文件

- `ui/app.js`
  - `createOverlayLifecycle().open()` 返回本次打开前是否已完成初始化。
  - `openBioWeave()` 仅在关闭后重新打开、或既有 root 被重新初始化时补充 render；首次打开复用 `initializeRoot()` 的初始 render。
  - World 页面将已由 ingress 构建的 View Model 传给页面渲染。
  - World render diagnostic 在同一 render 内复用一次 `stableWorldModelStringify()` 结果。
- `ui/world.js`
  - `renderWorldModelView()` 接受同一生命周期内已构建的 `viewModel`，未提供时保持原有独立调用行为。
- `runtime/world-analysis.js`
  - resolver 使用 `resolveFloorAtIndex()` 返回的已完成 Floor Version 计算的 `candidate.floorData`，保留 `sameFloorVersion()` 校验和原有扫描顺序/停止条件。
- `tests/ui.test.js`
  - 增加 overlay 首次打开与关闭后重开的初始化状态断言。
- `tests/event-analysis-runtime.test.js`
  - 增加 Floor 10 A → Floor 20 Archive/B → Floor 21 继承 B → 删除 20+ 回到 Floor 18/A 的回归测试。
  - 同时断言旧 Floor 10 快照未被 Archive 原地修改、Floor 20 保存 archived 状态。

### Before / After 对比

审计阶段 baseline 与实施后代码路径对比：

| 指标 | Before | After | 口径 |
| --- | ---: | ---: | --- |
| 首次打开同步 `render()` | 2 | 1 | 代码路径；关闭后重开仍为 1 |
| 单次 World 页面 ingress → page render 的 View Model build | 2 | 1 | 代码路径计数 |
| 同一次 World render 的 `stableWorldModelStringify()` | 2 | 1 | 代码路径计数 |
| resolver 每个候选的 Floor read | 2 次读取机会 | 1 次 | `resolveFloorAtIndex()` 已返回并版本校验的 `floorData` |

独立 Node benchmark：synthetic model，7 次迭代取中位数；固定模型后比较“旧路径：ingress build + render 内再次 build”和“新路径：ingress build + render 复用 viewModel”。仅测 CPU/HTML 字符串，不是浏览器 DOM paint：

| 数据规模 | JSON 字节数 | Before | After | CPU 降幅 |
| --- | ---: | ---: | ---: | ---: |
| 2 species / 4 types | 2.1 KB | 0.072 ms | 0.064 ms | 11.9% |
| 20 species / 100 types | 44.3 KB | 0.529 ms | 0.334 ms | 36.8% |
| 80 species / 800 types | 347.6 KB | 3.211 ms | 1.714 ms | 46.6% |

resolver 的历史扫描 benchmark 保持原审计结论：成本仍随回溯距离 O(K) 增长；本阶段只减少每个候选的重复 Floor read，没有改变扫描距离。真实 Storage/Network 等待和浏览器 DOM layout/paint 仍为 `UNVERIFIED`。

### 历史版本回退验证

新增测试通过：

- Floor 10 保存 A，Species X active。
- Floor 20 调用共享 Archive 变换并通过 `saveWorldModel()` 写入 B，Species X archived。
- Floor 18 解析得到 A，Species X active。
- Floor 20 解析得到 B。
- Floor 21 继承 B。
- 删除消息 Floor 20 及之后后，当前回到 Floor 18，解析得到 A，archive metadata 为空。
- Floor 10 slot 仍保持 active Species X，未被原地修改。

已有的 Swipe isolation、Chat stale reload、deleted owner 和 persistence readback 相关测试仍通过定向验证。

### 测试结果

- `node --check ui/app.js ui/world.js runtime/world-analysis.js tests/ui.test.js tests/event-analysis-runtime.test.js`：通过。
- 定向测试：10/10 通过，包含新增历史回退测试、resolver、save、Swipe、UI stale reload、Chat change 和 overlay lifecycle。
- `node --test tests/ui.test.js tests/event-analysis-runtime.test.js`：在约 51 秒后停止；当时 UI suite 182/182 通过，event-analysis suite 存在 1 个审计阶段已有的 `DIGEST_BROKE` preflight failure，另有一个测试文件因中断未完成。未发现由本次修改新增的失败证据。

### 尚未解决与风险

- `collectCurrentFloorStates()` 的全量扫描仍存在；本阶段没有改变 Floor 数量相关 O(N) 成本。
- runtime event 的多入口 render amplification 仍存在；本阶段只处理首次打开重复 render，未重构事件刷新队列。
- 真实 SillyTavern Host I/O、浏览器 DOM paint/GC 和用户规模 World Model 尚未实测。
- 复用 View Model 的前提是 ingress 与同次 render 使用同一 `worldModelState.model`；Chat/Swipe/Floor stale reload 会继续由原有 generation/token/readback guard 控制。

### Docs / Trellis

- 未修改生产 `docs/`；本阶段是内部去重，未改变长期架构 contract。
- 已在本 Trellis task 的本报告和 `implement.md` 记录修改原因、范围、性能对比、测试结果和未解决问题。

## 22. 后续历史演进回归测试记录

本轮仅新增测试代码，没有修改生产代码；此前第一阶段的生产修改保持不变。

新增测试：`tests/event-analysis-runtime.test.js` 中的 `World Model history preserves complete Supplement snapshots and Archive state across rollback`。

测试使用同一合成 Chat 的真实业务入口逐步推进消息：

| Floor | 操作 | 实际验证结果 |
| ---: | --- | --- |
| 2 | `analyzeCurrentWorldModelFull()` | 保存完整模型 A，包含 `Species-A` |
| 4 | 不执行 World 分析 | 无本 Floor 快照，resolver 继承 A |
| 6 | `analyzeCurrentWorldModelPatch()`，AI 返回 `ADD_SPECIES Species-B` | 输入基线为 A；真实 Supplement merge 保存完整 A+B；Floor 2 仍为 A |
| 8 | `archiveWorldModelSpecies()` + `saveWorldModel()` | 保存完整 B，仅 active `Species-B`；`Species-A` 保留在 `world_model_meta.archived_species`；Floor 6 仍为 A+B |
| 10 | `analyzeCurrentWorldModelPatch()`，AI 返回 `ADD_SPECIES Species-C` | 输入基线为 B，携带 A 的 archive meta；真实 Supplement merge 保存 B+C；A 未重新出现；Floor 8 未被修改 |

测试还逐一读取 Floor 2/4/6/8/10，并模拟删除 Floor 10 及之后的合成消息：回到 Floor 8 得到 B，继续回到 Floor 6 得到 A+B，未读取未来快照。

Supplement 并非直接注入 A+B 或 B+C：测试只从模拟 analyzer 返回 `ADD_SPECIES` Patch v2 operation，最终模型由现有 `mergeWorldModelSupplementPatch()`、World persistence coordinator 和 authoritative readback 产生。

Chat isolation、Swipe isolation、删除 owner、stale reload 的既有测试未改动，并在本轮相关定向测试中继续覆盖。新增演进测试本身未创建跨 Chat/Swipe 数据。

### 本轮测试结果

- 新增历史演进测试：通过。
- 新增 Archive 回退测试：通过。
- 相关 resolver/save/Swipe/UI stale/Chat 定向测试：上一阶段已通过；本轮未修改这些生产路径。
- 生产代码：本轮无修改。
- 真实 Chat 数据：未读取或修改。
- Full/Supplement：仅在隔离测试 fixture 中模拟 analyzer 返回，未发起真实 AI/API 请求。

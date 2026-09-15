# 实施计划与执行记录：Floor 分析事实 provenance 修复

规划阶段已完成，用户于 2026-09-16 明确批准后进入 `task.py start` 和
Phase 2。以下保留原实施顺序，并记录实际执行结果。

## Phase 1：先证明问题（已完成）

1. 在现有 fixture/public seam 上补充失败回归：
   - 旧 `character_profiles` 的 capability/evidence 不得授权当前 Event；
   - 旧 `tracking_candidates` 与 nested legacy derived root 不得参与当前判定；
   - 不发删除/截断 lifecycle callback，直接从 host Chat 删除 owner 后，
     `getTrackingRegistry()` 和 `collectActiveBusinessData()` 也必须只反映
     当前 Floor；
   - owner Floor 失效后，`character_context` 和 API request messages 不得
     包含其生物字段/evidence；
   - lifecycle invalidate 发生在请求等待期间时，不得发送或 retry 旧 request；
   - active Swipe 已删除/无内容时不得重新创建其 Floor slot；
   - 高位 stale `last_processed_floor` 不得改变 previous、active events 或
     derived registry。
2. 运行 focused suites，记录每个失败对应的 source → propagation → sink；
   先确认测试确实在旧实现上失败，避免只写 tautological assertions。

执行记录：在临时 detached baseline worktree 上运行同一 Tracking 场景，旧实现
确实把 Chat `character_profiles` 中的 `can_carry_pregnancy: true` 用来提升
当前 Event 的未知能力，错误产生 `active` subject；修复后同场景不再提升，
能力保持 `null`。临时 worktree 已移除，当前 worktree 未被 baseline 命令修改。

## Phase 2：最小业务修复（已完成）

### Slice A — current-facts-only Tracking projection

修改 `core/tracking.js`：

- 保留 `rebuildTrackingRegistry(events, previousChat)` 公共边界和当前 Event/
  World Model/三态 eligibility 行为；
- 将 subjects、candidates、profiles 从当前 valid Events 重新构建；
- 不再使用旧 Chat `tracking_subjects`、`tracking_candidates`、
  `character_profiles` 参与 identity/capability/eligibility；
- legacy nested root 仅可为明确的配置字段提供兼容读取，不能注入 derived
  fields；canonical `character_registry` 仍由 identity 模块管理。

### Slice B — callback-independent runtime reads and API input

修改 `runtime/event-analysis.js`：

- 复用 `collectActiveEvents()` 的当前消息/active Swipe/完整 Version 过滤，
  以一个局部 current-derived projection 供 refresh、business DTO、registry
  read 和 Event API `character_context` 使用；
- `refreshTrackingRegistry()` 继续写 Chat materialized view，但任何读取不以
  该 view 为正确性的前提；失败时 fail closed，不回传旧 derived state；
- `character_registry` 只从当前有效 Event 的 exact IDs 补足，不能从旧
  `character_profiles` bootstrap；现有 canonical identity configuration 保留；
- Floor save 前重新确认当前 Chat、active Swipe 和六字段 Floor Version，过期
  execution 不写回；
- coordinator 在 Chat boundary invalidation/change 时取消 in-flight execution，
  并在 analyzer 调用前作最后一次 current assertion。

### Slice C — deleted Swipe guard and hint recomputation

视 Phase 1 的具体失败位置修改 `storage/store.js`、`runtime/events.js` 或
`runtime/event-analysis.js` 的最小边界：

- active Swipe 必须对应当前仍存在的 host Swipe 内容；无效 Swipe 不得以
  message-level fallback 生成新 Floor，也不得由 adapter 创建 deleted slot；
- `last_processed_floor` 只保留为可重算 scheduling hint。以当前有效 active
  Floor Version 且 `analysis.status === 'success'` 的最高 Floor 重算，避免
  `Math.max(old, target)` 在历史删除/截断后形成不可回退游标；它不参与
  previous、registry facts 或 API input。

除非失败测试证明必要，不修改 `runtime/floor.js` 的已有版本算法、
`storage/schema.js` 的 generic empty/normalization shape、`ai/input-builder.js`
的纯 normalization contract、`ai/analyzer.js` 的 Event response schema 或
`ai/client.js` 的既有 signal-aware retry 实现。

## Phase 3：回归与审查（已完成）

1. 更新 `tests/tracking.test.js` 中把旧 profile/nested root 当作当前事实的
   旧断言；保留当前 Event + World Model baseline、pending re-evaluation、
   Event collection 和 identity schema 的有效行为测试。
2. 在 `tests/event-analysis-runtime.test.js` 覆盖 Case A-I、即时 read、
   API prompt/request sink、reload、edit/regenerate、history truncation、
   Swipe switch/delete、in-flight invalidation 和 last hint。
3. 在 `tests/runtime.test.js` 覆盖 per-Swipe owner、缺失/删除 Swipe 与
   adapter/store 不跨 slot 的行为；只在实际边界要求时调整 fixture。
4. 若测试暴露 `input-builder` 或 prompt formatter 仍可自主发现 Chat
   history，添加最小 guard test；否则保持这些模块不变。

## Phase 4：质量门（已完成）

业务源代码/测试发生修改后，已立即使用仓库本地 Prettier，仅格式化本任务实际
修改的文件；随后运行：

```text
node --test tests/runtime.test.js tests/floor.test.js tests/tracking.test.js tests/event-analysis-runtime.test.js
npm test
npm run check
```

另运行 changed JavaScript 的 `node --check`，检查最终 diff、任务 context、
ownership/provenance 反向搜索，并记录真实 SillyTavern host 的 delete/swipe/
reload 手工验收是否可执行。最终结果：changed JavaScript `node --check` 通过；
focused suites 104/104 通过；`npm test` 527/527 通过；`npm run check` 527/527
通过；`git diff --check` 通过；Prettier check 通过；任务 context validation
通过。本轮没有执行真实 SillyTavern Desktop/Tablet/Mobile host 的手工验收。

实际执行的格式命令：

```text
./node_modules/.bin/prettier --write core/tracking.js runtime/event-analysis.js runtime/events.js storage/store.js tests/tracking.test.js tests/event-analysis-runtime.test.js tests/runtime.test.js
```

最终格式检查命令：

```text
./node_modules/.bin/prettier --check core/tracking.js runtime/event-analysis.js runtime/events.js storage/store.js tests/tracking.test.js tests/event-analysis-runtime.test.js tests/runtime.test.js
```

## 文件边界和回滚

实际实现范围为 `core/tracking.js`、`runtime/event-analysis.js`、
`storage/store.js`、`runtime/events.js` 及其对应测试文件；未修改 `ai/client.js`、
Event/World Model schema、API profile/config、UI 产品契约，也未新建第二个历史存储。
回滚只能针对本任务实际修改的文件，保留用户既有工作区变化和其他 Trellis task。

## 执行结果摘要

- Tracking projection 已改为从当前有效 Floor Events 重建；旧 Chat
  `tracking_subjects`、`tracking_candidates`、`character_profiles` 不再作为
  identity/capability/eligibility 证据。
- Runtime business/API reads 已改为 current-derived projection；失效或缺失
  Floor/Swipe 时 fail closed。`character_registry` 只保留 canonical identity
  configuration，并从当前 Event 补足 exact IDs。
- active Swipe 删除/切换、内容 Version 变化、Chat invalidation 和 in-flight
  completion 都会经过当前 owner/version 校验；`last_processed_floor` 由当前
  有效成功 Floor 重算，只作 scheduling hint。
- 详尽的 source → propagation → sink 审计、保持不改的合规实现和最小修复
  设计见 `design.md`；失败前置断言与修复后断言见对应测试文件。

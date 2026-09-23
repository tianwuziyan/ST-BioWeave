# 执行计划

## 1. 基线与接口

- 阅读当前 `trellis-before-dev` 指南、domain specs 和 exact target blocks。
- 确认 analyzer coordinator 的依赖注入、World prompt settings、Floor save/error conventions。
- 为 World unavailable、patch DTO、gate 和 merge 定义最小内部接口，不改变现有公开签名。

## 2. World pipeline

- 增加首次 World Analysis 与已有模型 Update/Patch 的分支调用。
- 增加独立 patch prompt、parser/schema、证据 gate；AI 只返回新增/明确修正 facts。
- 由 BioWeave 程序实现 deterministic merge `validated A + validated Patch`，再 validate 完整 B；默认不支持 remove/invalidate，省略字段永不删除。
- 若 patch 合法但 B 不合法，整次更新 fail-closed，不保存 B、不进入 Event Analysis。
- 将 World Analysis 结果绑定当前 Floor Version，失败或 stale 时不保存半成品。

## 3. Character/Event hard dependency

- 在自动 `analyzeFloor()` 入口串联 World resolve/update/save/final resolve。
- 在 input builder / analyzer boundary 显式传递并断言 validated normalized World Model。
- 保持 Event validation、persistence、StateReducer、Tracking、Projection downstream 现有顺序和语义。
- 同步收紧 Event prompt；不修改 UI。

## 4. 回归测试

- runtime 顺序、失败 fail-closed、复用、dirty 更新、patch 保留/空/无效/明确替换、删除回退。
- 无 World 不写人物字段、gender/sex 不推能力、User message 不持久化、stale World async 丢弃。
- 保留现有 World resolver/save 隔离测试并补充必要 fixture。

## 5. 验证与收尾

- `npm run check`
- 相关 `node --test` 测试
- `node --check` 覆盖修改的 `.js`
- `git diff --check`
- 复核实际 diff 与本轮范围；同步更新必要的 domain spec / `docs/bioweave-data-lifecycle.md`，若新增字段或 lifecycle contract 则一并登记。

## 6. 阶段级 Retry Contract 与手动取消（本轮）

- 设置中的 `retry_count=N` 表示每个完整业务阶段失败后允许的额外重试次数；首次执行为 `attempt=1/retry_index=0`，因此 N=1 最多两次完整 Stage attempt。
- World Full/Patch 的 Stage attempt 覆盖 AI、解析/严格校验、normalize、Floor persistence、authoritative readback、Floor/Swipe/Version 校验和 canonical World UI-ready；只有整条链成功才进入 Event。
- Event/Character Stage 独立计数，覆盖 AI、解析/严格校验、身份/语义验证、Floor persistence/readback 和 canonical Character/Event readiness；Event 重试不重跑已 Ready 的 World。
- persistence/readback/UI-ready 失败在 execution 仍拥有同一 Floor 时属于可重试 Stage failure；真实 Chat/Floor/Swipe/Version 变化、取消、禁用、destroy 和 execution 被 supersede 仍直接终止，不能把旧结果写回。
- 诊断使用 `*_STAGE_ATTEMPT_*` 与 `*_AI_ATTEMPT_*` 分离表示阶段边界和 AI 边界；阶段成功只在完整链完成后记录。阶段耗尽后才交给既有 `retry_failed_analysis` scheduler policy。
- 手动 World Full/Patch 复用相同 Stage retry 边界；再次点击继续走 AbortController 取消，不启动并发或后续 retry。
- 手动 World Full/Patch 保持同一 Floor single-flight；再次点击当前正在运行的同一按钮进入既有 AbortController 取消流程，不启动并发任务。
- 新增阶段 attempt/retry trace，且不得改变 persistence ownership、Floor Version、Scheduler interval 或 World/Event contract。

## P0 宿主保存收敛（2026-09-23）

- 官方 Floor merge/readback 成功后，必须把同一份完整 sibling-preserving
  `bioweave` slot 写回当前 SillyTavern live `context.chat` 的 active Swipe
  owner；Swipe 0 仍使用 `swipe_info[0].extra.bioweave`。
- 写回前后继续验证 Chat、Character owner、active Swipe 和完整 Floor Version；
  版本或 owner 不匹配时 fail closed，不把结果写入旧对象。
- SillyTavern 生成流程可能在 `CHARACTER_MESSAGE_RENDERED` 之后仍执行
  `saveChatConditional()`。因此 live slot 同步后通过宿主自身保存边界完成一次
  收敛保存，并再次做安全的 official/host presence audit；不使用延时、轮询或
  无界重复保存。
- World 与 Event 仍只替换各自 owned fields；每次 host sync 使用完整的最新
  merged Floor slot，确保后写 sibling 不删除先写 sibling。

## 风险点与回滚点

- 主要风险文件：`runtime/event-analysis.js`、`ai/analyzer.js`、`ai/prompts.js`、`tests/event-analysis-runtime.test.js`、`tests/world-model.test.js`。
- 每个阶段保持独立可回滚：先新增纯函数/测试，再接 coordinator，最后接 analyzer defensive guard。
- 禁止改动 Snapshot、StateReducer、Projection、UI 和 analysis interval。

## Canonical Character readiness 与宿主诊断（2026-09-23）

- Event Stage 成功边界延伸到 authoritative Floor read-back、canonical
  `collectActiveBusinessData()` 重建和 `CHARACTER_UI_READY`；DOM 是否打开不参与
  阶段成功判断。
- 增加 Character canonical source/slot/state trace，并由现有 refresh sequence
  串行化 UI business refresh，避免旧 refresh 覆盖最终结果。
- Full-chat persistence trace 区分 captured、dispatched、resolved 与
  readback-confirmed；新增 init/Chat switch 的 `RELOAD_FLOOR_SLOT_AUDIT`。
- 这些是运行时诊断与阶段边界收紧，不改变 Floor/active Swipe ownership、Scheduler
  interval、World/Event schema 或 stale guard。

## Floor Version convergence 分类与 World persistence owner（2026-09-23）

- `STALE_FLOOR_VERSION` 不再被阶段 retry classifier 一刀切为不可重试；官方 owner
  版本暂时落后、但当前 Chat/Floor/message/active Swipe/正文版本和 execution 仍一致
  时，分类为 `temporary_server_convergence`，并重新执行完整 World Stage（包括新的
  World AI request）。
- live owner 已变化、execution 被取消/替代、插件已禁用或 ownership 丢失时，分类为
  `true_owner_change`，保持严格拒写并停止 retry。
- 每个 World Stage attempt 只有一个 persistence owner token；Stage stop 后或同一
  attempt 的重复调用不能再次进入 World persistence。该 guard 不改变 Floor Version
  equality，也不绕过 official prewrite 校验。
- 版本诊断保留 expected/actual、来源、字段级 mismatch、live/official 比较和
  retryable 分类；用户提示将 convergence、owner stale、普通保存失败与 API 失败分开。

## Event Stage timeout retry classifier（2026-09-23）

- transport 层的 `error.retryable` 不再直接决定业务 Stage 是否重试；在 execution
  ownership 仍有效时，未达到 Event/Character Ready 的普通失败默认可消耗当前 Stage
  的额外 retry budget。
- `REQUEST_TIMEOUT` 与带 timeout 标记的 `AbortError` 属于可恢复 Stage failure，
  会重新发起完整 Event AI attempt；显式用户取消、disabled/destroy、supersede、
  true owner change 和不可用前置仍保持 terminal。
- Event retry 只重新执行 Event Stage，不重新请求已经 Ready 的 World；诊断保留
  `EVENT_STAGE_RETRY_SCHEDULED` 的 retry index，且不把 timeout 误报为用户取消。
- Stage 终态 failed/cancelled metadata 的 Floor save 使用独立 `analysis` trace
  domain，记录为 `ANALYSIS_*`，不伪装成额外的 `WORLD_SAVE_*` persistence owner。

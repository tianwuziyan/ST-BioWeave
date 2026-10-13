# 修复重新分析期间并发重复 canonical business build

## Goal

在不改变 Event、Snapshot、Tracking、Projection 业务语义的前提下，合并同一有效业务状态代际内并发的 canonical 派生构建，增加轻量诊断与定向竞态回归测试。

## Background and confirmed facts

- 手动重新分析期间，UI refresh、`verifyCharacterCanonicalReady` 和 Projection 输入可能同时调用 `collectActiveBusinessData()`。
- `canonical_build_ms` 包含 `await` 的 wall-clock 时间；750ms 与 1500ms 是独立并发调用的两档耗时，不代表单个调用内部必然构建两次。
- `collectCurrentDerivedState()` 是重复工作的共同内层，调用方的 `reason`、`includeDebug`、`route` 主要影响外层 DTO/诊断，不应被跨调用共享的完整 Promise 取代。
- 同一 Floor Version 下重新分析可以更新 Event Snapshot，因此 Chat/Floor/Swipe/Floor Version 不能单独作为跨保存阶段复用键。

## Requirements

- 只合并同一 Chat、Floor、active Swipe、Floor Version、Snapshot/Tracking 代际且输入等价的并发纯派生构建。
- 保留每个调用方自己的 Floor Version、Chat/Swipe、stale execution、Snapshot authoritative readback、Event commit、Tracking rebuild 与 Projection 输入校验。
- 构建完成或失败后清理 in-flight entry，不保留长期结果缓存；错误必须传播，下一代必须重新构建。
- `includeDebug`、`route`、`reason` 差异不得导致错误的 DTO 或诊断共享；返回数据不得被不同调用方互相修改。
- Event commit、Snapshot readback、Tracking 更新、Chat/Swipe/Floor Version 变化和不兼容 analysis phase 必须阻止旧 in-flight 结果被新请求加入。
- 增加安全元数据诊断：`build_started`、`joined_existing_build`、`build_completed`、`build_failed`、`build_duration_ms`、`join_wait_ms`、generation/invalidation reason。
- 不修改 Event Schema、Snapshot Schema、Prompt、continuation 语义、Tracking 业务语义、Projection 排序、Scheduler 或 Floor/Swipe/Version 规则。

## Acceptance Criteria

- [ ] 相同代际的 A/B/C 并发请求只执行一次完整派生构建，B/C 等待 A，构建后清理 in-flight entry。
- [ ] 不同 Floor Version、Snapshot commit、Tracking 更新、Chat、Swipe 或不兼容 analysis phase 不共享。
- [ ] 构建失败后下一次请求可以重新执行；失败不会留下可复用的旧结果。
- [ ] `includeDebug`、`route`、`reason` 差异下各调用方仍获得正确且互不共享可变引用的数据。
- [ ] 增加旧 Snapshot 构建期间发生 Event commit、随后新 Snapshot 请求的竞态测试；新请求不得加入旧构建或返回旧派生结果。
- [ ] 重新分析后的 Event、Tracking、Projection 结果保持现有行为；Floor 66 → 68 continuation 保留原 Event ID 与 `source.floor`。
- [ ] `npm run check` 与 `git diff --check` 通过，且没有增加业务刷新、持久化写入或长期诊断累积。

## Out of scope

- UI refresh 编排、refresh 合并策略、Projection 排序和 Event continuation 优化。
- Snapshot/Event Schema、Prompt、Scheduler 与 Floor ownership 规则变更。
- 长期 canonical cache、跨请求持久化缓存或新的业务事实源。

## Notes

本任务是跨 runtime/test 的复杂修改，必须先完成 `design.md` 与 `implement.md`，再激活执行。

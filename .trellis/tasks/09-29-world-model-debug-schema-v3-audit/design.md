# Technical Design

## Audit boundary

本 task 只建立当前 Debug Schema 的事实 inventory 与设计建议，不实现任何 schema 变化。审计从实际 producer root 开始：

```text
ai/analyzer.js fact_delta_summary
  -> runtime/world-analysis.js latestWorldModelDiagnostic / recentFactDeltaExecutions
  -> runtime/diagnostics.js history trace sanitization
  -> ui/app.js collectWorldModelLiveState()
  -> ui/settings.js debug rendering/export
```

`runtime/events.js` 的 allow-list 作为 serialization boundary 审计，不把 allow-list 自动当作 producer schema。`utils/world-model-debug.js` 作为 fingerprint/layer comparison contract 审计。

## Audit method

1. 建立字段 inventory：producer assignment、clone/retention、serialization allow-list、UI projection、tests/spec/docs references。
2. 对每个字段判断 owner、timepoint、cardinality、absence semantics，并标记 mixed ownership。
3. 用控制流证明 coverage round cardinality：stage attempt、format retry、transport retry、accepted-patch recovery、snapshot accumulation 分别追踪。
4. 用当前 tests 和 read-only focused execution 验证关键分歧；不修改 tests 来“证明”结论。
5. 以错误调试结论为门槛，分 Tier 1 clarity、Tier 2 structural、Tier 3 cosmetic，最后决定 v2 保留或 v3。

## Proposed design output

若满足升级门槛，只提出按 owner 分组的 diagnostics fragment，并保留旧 v2 compatibility/migration 方案；不复制完整 World Model。若不满足，则明确 `DO NOT CREATE DEBUG SCHEMA V3`，只列后续可选 Phase 2。

## Non-goals

不改变 semantic request、Fact Delta、retry、coverage accounting algorithm、persistence、Floor ownership、UI behavior 或 real-host smoke contract。

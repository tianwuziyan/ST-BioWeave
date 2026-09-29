# Phase 6：World Model Supplement Documentation Consistency Pass

## 目标

统一 current developer-facing documentation、architecture notes、source comments 和 test descriptions，使它们描述 JSON Fact Delta、Current Fact Delta Safety Boundary、Host-internal Patch V2 IR、Execution Snapshot 和 Floor persistence 的当前架构。

## 禁止事项

- 不修改 AI prompt behavior、Fact Delta contract、parser、Resolver、Evidence Guard、Patch V2 semantics、retry、Snapshot、persistence、readback、UI projection 或 canonical schema。
- 不批量修改 `.trellis/tasks/archive/**`。
- 不把 current `candidate_model`、`candidate_fingerprint`、`candidate_reference`、`publishWorldModelCandidate` 等 transient persistence candidate 误删或标为 legacy。

## 必须统一

- Patch V2 是 Host-internal deterministic mutation IR，不是 AI output/wire format。
- Supplement wire format 是 JSON Fact Delta。
- Existing 和 Coverage Targets 不是 evidence。
- Supplement 没有 semantic continuation；dynamic coverage 只是 Host-local accounting。
- Debug Schema 使用 v3 terminology。
- `execution_result` 与 `fact_delta_result`、Fact Delta analysis 与 persistence confirmation 分层。
- Full 与 Supplement 是两个独立 pipeline。

## 验收

- current docs/comments/test descriptions 无 stale current architecture wording。
- archive historical references 保留并逐项报告。
- current source-of-truth 明确指向 `.trellis/spec/domain/world-model.md`。
- docs/source scan 对 legacy symbols、Candidate transport、raw Patch V2、continuation/fixed-point wording 完成分类。
- 只发生 documentation/comment/test-description 变更。

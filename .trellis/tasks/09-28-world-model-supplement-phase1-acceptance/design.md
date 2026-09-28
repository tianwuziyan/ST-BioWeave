# Phase 1 Evidence Scope Binding 与 Value Support 审计设计

## Boundary

本 task 只审计并可能最小修复 Supplement Fact Delta 的 evidence provenance、scope binding、value support 和相关 diagnostics。Full / 重新分析保持只读；Dynamic Coverage、completeness、candidate adoption、UI projection、Floor persistence 和 canonical schema 均不在本 task 范围内。

## Audit flow

```text
AnalysisInput / permitted evidence
  -> evidence-unit construction
  -> candidate matching
  -> parent/structured provenance
  -> Species + Biological_Type scope binding
  -> semantic value matching
  -> Evidence Guard
  -> resolver operation disposition
```

审计先以实际代码和现有 tests 确认每一层的 owner、数据结构和 fail-closed contract，再建立 generic fixtures。文本 candidate 命中不等于 scope metadata 正确；Existing、Coverage Targets、Identity Discovery Review、Coverage Review 和 prompt instructions 始终排除在 evidence 之外。

## Required evidence trace

每条 evidence unit 至少记录其实际字段对应的 source、text、Species、Biological Type、parent context、structured context、normalization、candidate eligibility 和 scope eligibility。Diagnostics 只输出 bounded counts、indices、expected scope 和 candidate scope metadata summary，不输出完整 evidence。

## Decision rules

- Type Identity 必须由同一 permitted evidence 范围内明确的 Species + Biological_Type identity 支持；不做 sibling、symmetry、opposite 或 Existing 推断。
- Type identity 与 description/capability/reproduction/lifecycle 等 dependent Facts 独立经过 Guard；identity accepted 不自动授权 detail。
- `SCOPE_BINDING_FAILED` 与 `VALUE_SUPPORT_FAILED` 必须在审计和测试中分开。
- 对 composite claims，先依据现有 spec/tests/code 判断 multiple evidence units 是否可共同支持一个 value；不得自行放宽或收紧 contract。
- 只有确认 valid evidence 被错误拒绝时才修改；正确拒绝保持 fail-closed。

## Deferred work

如果 accepted new identity 产生 dynamic coverage targets，只记录现有行为并将 fixed-point work deferred to Phase 2；不修改 coverage rounds、fixed-point flags 或 completeness semantics。

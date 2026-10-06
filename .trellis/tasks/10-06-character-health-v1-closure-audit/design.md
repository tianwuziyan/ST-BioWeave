# Technical Design

## Audit boundary

本 task 只读检查当前 Character Health owner、Floor ownership、Event/Assessment binding、deterministic evolution、presentation aggregation、Projection Context guidance 与 Character Health UI。审计以 surviving authoritative Floor Event 为上游，禁止把 cache、snapshot 或 UI 计算当作 authority。

## Evidence flow

```text
authoritative BiologicalEvent + valid Floor Version
  -> observation eligibility / fingerprint-bound Assessment
  -> Story Time deterministic Health Evolution
  -> active-only Health Aggregation / severity summary
  -> Character Health UI
  -> active-only Recovery Guidance
  -> existing bioweave_projection_context
```

审计同时反向检查 lifecycle invalidation：删除、编辑、Swipe 切换/删除、Floor Version 变化后，重新从 surviving authority 构建 derived state；不得依赖写回 inactive 或 cache 清理来证明正确性。

## Classification model

- `PASS`: 当前实现、测试或文档有直接证据满足 contract。
- `CONTRACT GAP`: 实现行为违反已确认 contract，须给出最小根因修复方案。
- `DEAD CODE`: 当前 contract 已取代且确认无有效调用方的遗留实现。
- `DOC DRIFT`: docs/spec 与实现不一致，但实现行为尚未被判定为错误。
- `NOT PROVEN`: 代码静态证据不足，尤其是真实 ST Host reload/Story Time 行为；不得推断为 PASS。

## Host acceptance posture

真实 Host 验收只观察既有 Event history、persisted Assessment、read model、UI 与 Projection Context；不创建测试专用事实、不手工改 derived state、不以 snapshot/cache 替代重建。每个阶段记录 Story Time、source Event ID、Assessment binding、active/inactive、severity、guidance 和是否发生写入/AI 调用。

若 Phase 1 发现 contract bug，停止进入 Host acceptance 的“通过”结论，先报告根因和最小修复范围；除非用户另行授权，不修改业务代码。

## Approved narrow recovery-timing correction

后续实现仅修正 Health Assessment 的一次性恢复周期评估提示词与验证覆盖：

- 明确 factual timing 优先进入 `explicit_narrative_timing`；
- 普通且信息充分的 short-term、natural-recovery eligible observation 在没有明确 timing
  时，由一次 Health Assessment AI 调用生成 `ai_derived_assessment` 的 expected recovery；
- 证据不足时继续允许 expected recovery 为 null；
- 复用现有 Assessment persistence、Health Evolution 与 Phase 5B Guidance；
- 不新增 Recovery Plan、schema、第二次 AI pass 或 explicit recovery closure。

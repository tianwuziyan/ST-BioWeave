# 修复 Supplement multiline、Type Identity Guard 诊断与 LIVE STATE 计数

## Goal

修复 World Model Supplement 上游 Fact Delta 的三项可观测问题：允许合法自然语言
payload 的安全多行续行；审计并在有证据时最小修复 Type_Identity Evidence Guard
误拒绝，否则保持 fail-closed；将 LIVE STATE 的 Fact funnel 拆成互斥、可解释的
parser、resolver、Evidence Guard 和 accepted 计数。

本轮不改变 Floor persistence、canonical merge、UI World display/refresh/renderer
或 Debug 的只读与 freshness 架构。

## Confirmed repository facts

- Branch is `fix/world-model-prompt-baseline`; before task artifacts the worktree was
  clean and HEAD was `26c4400 增强 World Model Debug LIVE STATE 跨层诊断`.
- Supplement path is API response → `parseWorldModelFactDeltaText` →
  `validateWorldModelFactDelta` → `resolveWorldModelFactDelta` →
  `applyWorldModelFactDeltaEvidenceGuard` → internal Patch v2 → existing merge and
  `saveWorldModel → commitFloorPatch(owner="world")` path.
- Parser currently treats every non-empty Fact line as `label: value`; a natural-language
  continuation without `:` raises `WORLD_MODEL_FACT_DELTA_LINE_INVALID`.
- Current trace reports `fact_count`/`rejected_fact_count` at mixed stages, so parser
  rejects and Guard rejects can be read as more raw Facts than the response contained.
- Existing LIVE STATE samples Runtime, authoritative Floor, current UI and last-render
  layers independently, with snapshot consistency and read-only collector tests already
  present. That behavior is preserved.

## Requirements

1. Audit and document the lifecycle and disposition of each Fact from raw block discovery
   through canonical mutation, including raw, parse, resolution, Guard, accepted Fact and
   accepted operation counts.
2. Permit deterministic continuation only after an already valid multiline-capable text
   payload label. Continuation must not alter address, Field, payload key schema, block
   framing, boolean token, JSON/collection contract, or identity semantics.
3. Preserve rejection for split labels, unknown labels/keys, split Species,
   split Biological_Type, split Field, split booleans, nested Fact, trailing root text,
   Patch IR, invalid scope, identity Value, and malformed structured payload.
4. Add the smallest prompt instruction that reduces physical-line splitting without
   replacing parser robustness.
5. Audit Type_Identity evidence using generic fixtures only. Explicitly determine whether
   permitted evidence supports the exact Species/Type identity, retains parent scope, and
   avoids Existing, sibling, or cross-Species leakage. Change Guard behavior only for a
   proven false rejection; otherwise add fail-closed regression coverage.
6. Make Guard rejection diagnostics explain stage, code, fact index, field, scope,
   canonical address, candidate/scoped/matched unit counts, and unit indices without
   copying full evidence into trace.
7. Add LIVE STATE fields:
   `raw_fact_block_count`, `parsed_fact_count`, `parse_rejected_fact_count`,
   `resolution_rejected_fact_count`, `evidence_guard_rejected_fact_count`,
   `accepted_fact_count`, and `accepted_operation_count`. Preserve old fields only where
   compatibility requires them, with an unambiguous definition.
8. Preserve `live_state_source = sampled_at_export_time`, HISTORY TRACE as event buffer,
   snapshot metadata, four layer comparisons, and the Debug read-only boundary.
9. Use only generic test fixtures: Species-A/B and Type-A/B/C. Biological_Type remains an
   open string; do not hardcode real Host names or gender enums.

## Acceptance Criteria

- [x] Parser accepts multiline `Type_Description` and schema-approved natural-language
  payloads, with deterministic normalized content and sibling Fact isolation.
- [x] Parser rejects all required malformed continuation/structure cases.
- [x] Type Identity audit has one explicit conclusion: unsupported AI inference or Guard
  false rejection, backed by candidate/scoped/matched evidence indices.
- [x] Guard behavior is unchanged for unsupported/cross-scope/sibling/Existing-only
  identity evidence, unless a minimal evidence-scope root cause is proven and fixed.
- [x] LIVE STATE and trace expose a non-overlapping Fact funnel satisfying the actual
  pipeline accounting invariant; the raw count cannot be misread as parsed-plus-rejected
  across stages.
- [x] Focused parser, resolver, Guard, Supplement, LIVE STATE, read-only, and Floor
  boundary tests pass; modified JS passes `node --check`; `npm run check` and
  `git diff --check` pass.
- [x] No commit or push is performed.

## Out of scope

- Floor persistence coordinator, owner whitelist, transaction key, sibling protection,
  readback, or storage architecture.
- World canonical schema, merge semantics, Full Analysis, Coverage Targets protocol,
  renderer, UI World display semantics, UI refresh scheduling, or Floor-to-UI loading.
- Global Evidence Guard threshold/fuzzy matching, Existing-as-evidence, Species/Type
  special cases, or real Host fixture hardcoding.
- Fact Delta protocol rewrite, Coverage Disposition, or unrelated legacy cleanup.

## Open questions

None blocking. The Type Identity outcome is an audit result to be determined from current
permitted evidence and existing matcher semantics, not a preselected implementation.

## Implementation result

- Multiline continuation is limited to existing natural-language text payload labels and
  rejects split structural labels before continuation normalization.
- Type Identity outcome is `unsupported inference`: the current negative fixture has a
  candidate token but no scoped Species + Biological_Type evidence unit, so the existing
  Guard correctly rejects it.
- LIVE STATE displays the seven-stage funnel. Legacy `fact_count` and
  `rejected_fact_count` remain in diagnostic transport for compatibility but are omitted
  from the visible LIVE STATE detail JSON so they cannot be read as the recommended total.

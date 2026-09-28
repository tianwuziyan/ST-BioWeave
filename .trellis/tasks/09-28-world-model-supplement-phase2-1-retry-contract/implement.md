# Phase 2.1 执行计划

1. 读取总方案、Phase 1/2 task 文档、AGENTS 与相关 Trellis/domain specs；记录 branch、HEAD、status、log 和当前测试基线。
2. 审计 `buildWorldModelPatchMessagesV2()`、`analyzeWorldModelPatchV2()`、`validateWorldModelSupplementCompleteness()`、`runWorldAnalysisJob()` 与既有 retry diagnostics，画出 Initial/Retry/Continuation envelope。
3. 用 generic fixtures 复现 smoke contract：Host rejected EMITTED → completeness/retry → envelope 膨胀或 candidate null；确认 UI 不是根因。
4. 追踪并最小移除 Host-only diagnostics 注入；为三类请求增加 bounded request-size composition diagnostics。
5. 分离 review accounting、mutation acceptance、rejection class 与 retry/continuation directive；复用既有 execution/retry budget。
6. 增加/修复 generic tests T1–T16，重点覆盖 bounded repeated Guard rejection、NO_EVIDENCE、EMITTED accepted/rejected、manual/automatic parity、fixed-point candidate gate 和 no intermediate persistence。
7. 运行 targeted tests、`npm run check`、相关 JS syntax checks、`git diff --check` 与 Trellis validation；审计 Full/UI/Floor/Guard/canonical 非目标边界。
8. 更新本 task 文档中的 implementation/validation record，完成 Phase 2.1 后停止，不进入 Phase 3–5。

## Implementation record

- `ai/prompts.js`: retry/continuation 仅渲染 bounded target、subject、reason、code；移除完整 Host completeness diagnostics JSON 注入。
- `ai/analyzer.js`: 在同一 permitted evidence 与 Existing envelope 下记录 request mode/round/长度组成；将 review accounting 与 mutation acceptance 分开记录，保留 `EMITTED + REJECTED`，不改写为 `NO_EVIDENCE`。
- `runtime/world-analysis.js`: 复用既有 stage retry/execution budget，区分 `completeness_retry` 与 `coverage_continuation` directive；修复首次 Patch continuation state 初始化顺序，确保自动 World Patch 能形成最终 candidate。
- `runtime/diagnostics.js`、`runtime/events.js`: 放行 bounded request-envelope 与 review/mutation 摘要字段，仍不记录完整 prompt/evidence。
- `tests/world-model.test.js`: 增加 Host-only diagnostics 不进入自动 retry envelope 的回归测试，并保留 Phase 1/2 strict guard/fixed-point 覆盖。

## Validation record

- World Model + Event Runtime targeted suite: `457 passed / 0 failed`。
- `npm run check`: `1082 passed / 0 failed`。
- `node --check`: `runtime/world-analysis.js`、`ai/analyzer.js`、`ai/prompts.js`、`ai/world-supplement-protocol.js`、`runtime/diagnostics.js`、`runtime/events.js` 均通过。
- `git diff --check`: 通过。
- Trellis task validation: 通过；仅有既有 context 文件大小截断 warning，无 validation failure。

## Scope closure

本任务完成后停止；不进入 Phase 3 Candidate Adoption、Phase 4 UI Projection 或 Phase 5 Full/Legacy cleanup。

## 后续受限修复记录（API Input Parity + Canonical UI Display）

本次后续修复暂停继续扩展 Supplement completeness/fixed-point，仅处理用户可见的 API 输入 parity 与 canonical → UI projection：

- `ai/analyzer.js` 为 permitted evidence、Existing、Coverage target set、base analysis payload 和 control directive 建立 deterministic fingerprint；evidence 字符数改为只统计 `factDeltaEvidenceUnitRecords()` 的 permitted source units，retry/continuation directive 不进入 evidence。
- `ui/world.js` / `ui/app.js` 补齐 species description、reproductive mechanisms、projection rules 的 canonical display，并在 adoption/render diagnostics 中记录 UI state fingerprint 与 rendered/unrendered field counts。
- `runtime/world-analysis.js` 将 canonical-noop gate 前移到 Candidate publish 之前；无 mutation 时不再产生 `WORLD_CANDIDATE_CREATED`。
- 未修改 Full、Evidence Guard、Scope/Value matcher、permitted evidence boundary、canonical schema、Floor Coordinator 或 transaction key。

## Rollback boundary

只允许回退本 task 新增的 Phase 2.1 代码、tests 和 task docs；保留既有 Phase 1/2 修改及其它用户未提交修改。禁止 reset、clean、checkout、restore、commit、push。

## 本轮 Automatic Retry Identity + Coverage Fact Mapping 修复记录

本轮只修复真实 Smoke 在 Candidate/UI 之前确认的两个问题：

- `runtime/world-analysis.js` 将同一 execution 的 completeness retry 标记为 `AUTOMATIC_RETRY`，不再把 `completeness_retry` directive 传入模型 request；Host 仍保留 retry reason、target IDs、attempt 和 previous failure code。只有 transient candidate 已变化的 `COVERAGE_CONTINUATION` 才继续携带 continuation 控制信息。
- `ai/analyzer.js` 基于真正发送的 `messages` 增加 `model_request_payload_fingerprint`，并新增 bounded `buildWorldModelSupplementCoverageFactMappings()`。它统一 canonical target address 与解析前的 Fact address，记录 expected address、candidate addresses、exact match count、matched Fact indices、scalar/collection semantics 和 bounded failure reason。
- `ai/world-supplement-protocol.js` 的 completeness 校验优先消费 resolver 前的 exact-address mapping；因此 `EMITTED + syntactically valid exact-address Fact + later Guard rejection` 仍满足 structural completeness，不会被错误改写为 `fact_count = 0` 或再次触发同一 completeness retry。mapping trace 随 completeness diagnostics 输出。
- `runtime/diagnostics.js`、`runtime/events.js` 放行 payload fingerprint、retry Host metadata 和 coverage mapping 摘要，不导出完整 prompt/evidence。
- `tests/world-model.test.js` 增加 automatic retry 的实际 messages/payload fingerprint identity、scalar/collection mapping、错误 Species/Type/Field fail-closed 回归；既有 direct retry formatter 测试仍验证显式 continuation/formatter 行为。

两个真实 target ID 的完整 Species / Biological_Type / Field 语义依赖真实 Attempt #1 response payload；本地没有该 payload，因此没有伪造对应 canonical address。新的 `WORLD_SUPPLEMENT_COVERAGE_FACT_MAPPING` diagnostics 会在下一次 Smoke 中直接给出实际 expected address、candidate Fact addresses 和 exact match count。

### 本轮验证记录

- `node --test tests/world-model.test.js`: `271 passed / 0 failed`。
- `node --check`: `ai/analyzer.js`、`ai/world-supplement-protocol.js`、`runtime/world-analysis.js`、`runtime/diagnostics.js`、`runtime/events.js` 通过。
- `npm run check`: `1088 passed / 0 failed`。
- `git diff --check`: 通过。
- Trellis task validation: 通过；仅保留既有 world-model/floor-state context 文件大小 warning，无 validation failure。

## 后续真实 Smoke Root Cause 修复记录

本轮只处理真实 Smoke 已确认的 execution provenance、Evidence Guard 可解释性和结果状态语义；未扩展 completeness、fixed-point、renderer 或 persistence 架构：

- `ai/analyzer.js` 新增 bounded `WORLD_EVIDENCE_GUARD_DECISION` trace。每个 Guard rejection 记录 canonical address、候选值及规范化值、scope/value 两层结果、匹配 evidence unit 索引与 bounded excerpt、策略和精确 rejection detail；不改变 matcher、threshold 或 permitted evidence boundary。
- `runtime/world-analysis.js` 为 Supplement request 记录 `AUTHORITATIVE_FLOOR` / `TRANSIENT_CANDIDATE` baseline source、fingerprint 和相邻 independent execution transition；同 execution continuation 继续使用 transient model，新的 independent execution 仍从现有 authoritative resolver 读取。
- `runtime/world-analysis.js` 增加 `UPDATED`、`NO_CHANGE`、`ALL_FACTS_REJECTED`、`ANALYSIS_FAILED`、`UI_ADOPTION_FAILED`、`PERSISTENCE_FAILED` 的结果分类；Guard 全拒绝不再归类为 canonical no-op 或普通成功。
- `ui/app.js` / `ui/settings.js` 在 Advanced Debug 前置显示 `WORLD MODEL LAST EXECUTION`，并显示 `WORLD MODEL REQUEST TRANSITION`，包含 funnel、candidate/UI/persistence fingerprints 与 final result；不导出完整 prompt/evidence。
- `runtime/diagnostics.js` / `runtime/events.js` 仅放行上述 bounded diagnostics 字段。

本轮新增回归覆盖 Guard decision trace、all-rejected 与 true no-op 区分、调试摘要和 request transition 展示；真实 SillyTavern smoke 仍需在安装刷新后重新执行。

## 后续 Reproductive_Mechanism Parser Contract 修复记录

本轮只修复 `Mechanism_Evidence` 的 parser/schema drift：

- `ai/world-supplement-protocol.js` 的 `factDeltaFinalize()` 原先把 `World_Model_Rule_Refs` 与 `Mechanism_Evidence` 共用 `factDeltaJson(..., 'string[]')`。因此自然语言 `Mechanism_Evidence` 会在 `fact_parse` 阶段错误抛出 `WORLD_MODEL_FACT_DELTA_JSON_INVALID`。
- 现在 `Mechanism_Evidence` 使用 bounded natural-language text parser，并转换为 canonical mechanism 的 `evidence: string[]`；`World_Model_Rule_Refs` 仍严格要求 JSON string array，`Projection_Rule_JSON` 的 object contract 未改变。
- `Mechanism_Evidence` 复用已存在的 structured multiline continuation 边界；不会扩散到 address、boolean、structured key 或 JSON payload。
- JSON parse diagnostics 现在包含 `payload_key`、`expected_type`、`actual_parse_mode`，便于区分真正 JSON 字段错误与自然语言字段错误。
- 未修改 Coverage exact-address matching、Evidence Guard、UI、Candidate Adoption、retry 或 Floor persistence。

### Reproductive_Mechanism payload contract

| Payload key | Transport parser type | Canonical type |
| --- | --- | --- |
| `Mechanism_Key` | non-empty text | `key: string` |
| `Mechanism_Label` | text | `label: string` |
| `Mechanism_Pathway` | text / bounded continuation | `pathway: string` |
| `Carrying_Compatibility` | strict boolean | `carrying_compatibility: boolean/null` |
| `World_Model_Rule_Refs` | strict JSON string array | `world_model_rule_refs: string[]` |
| `Mechanism_Evidence` | natural-language text / bounded continuation | `evidence: string[]` |

### 本轮验证记录

- Reproductive mechanism targeted regressions: `6 passed / 0 failed`。
- World Model targeted suite: `277 passed / 0 failed`。
- `npm run check`: baseline before this repair `1089 passed / 0 failed`; final validation待补录。
- `node --check`、`git diff --check`、Trellis validation: final validation待补录。

### New Type Identity replay / Advanced Debug validation

- Targeted World Model + Debug tests: `287 passed / 0 failed`。
- Full `npm run check`: `1097 passed / 0 failed`。
- `node --check`: `ai/analyzer.js`、`runtime/diagnostics.js`、
  `runtime/events.js`、`runtime/world-analysis.js`、`ui/app.js`、
  `ui/settings.js` 均通过。
- `git diff --check`: 通过。
- Trellis validation: 通过；仅有既有 `world-model.md`/`floor-state.md`
  context size warning。

## New Type Identity replay / Advanced Debug contract record

- Real attachment replay manifest: `输入文件1.txt` and `输出结果1-1.txt`
  are byte-identical (`sha256:52db7342...`), while `输出结果1-2.txt` is the
  distinct 19-Fact response (`sha256:bf890d23...`). The supplied files do not
  establish two independent input/output pairs; no second pair is fabricated.
- The distinct response contains two new `人类` Type Identity Facts. The
  supplied Existing contains `人类` as a Species with no Biological Types, and
  the permitted input only contains candidate `男性`/`女性` mentions rather
  than stable Species-linked classification evidence. Existing debug records
  candidate text hits but `scoped_evidence_unit_count: 0` and
  `SCOPE_BINDING_FAILED`; this is confirmed `LEGITIMATELY_UNSUPPORTED`, not a
  bootstrap circular-dependency bug. The existing resolver already orders
  identity before dependent Facts.
- `ai/analyzer.js` now emits bounded `WORLD_TYPE_IDENTITY_DECISION` records,
  `type_identity_decisions`, `first_failed_stage`, and
  `world_model_debug_schema_version: 2`. `runtime/diagnostics.js` and
  `runtime/events.js` retain these bounded fields, while `ui/app.js` and
  `ui/settings.js` distinguish current-execution candidates from retained
  candidates and render the Type Identity decision section.
- No Evidence Guard threshold, scope matcher, permitted evidence boundary,
  canonical schema, UI renderer, Candidate Adoption, retry, continuation, or
  Floor persistence behavior was changed.

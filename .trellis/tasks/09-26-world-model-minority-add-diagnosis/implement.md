# World Model Supplement Patch v2 实施计划

本文件只定义后续实施顺序；本阶段不执行任何 Phase。

## Global guardrails

- 只修改 v2 所需 Prompt / Patch parser / validator / evidence guard / merge
  与对应测试；不得修改 Full/Event/Character semantic contract。
- 保留 v1 complete-candidate parser、guard、merge 与兼容路径；不得静默
  改变 v1 omission 或 REMOVE 防护语义。
- 不修改 Runtime routing、storage、UI、REMOVE policy、Structural
  Reclassification 或 projection mutable update identity。
- 不增加 fixture-specific production logic 或 deterministic narrative
  semantic classifier。
- AI 只输出 v2 ADD/CHANGE operations；old value 由 Existing resolve。
- `NO-OP` 是 deterministic validation result，不是 AI operation。
- Projection add 只接受现有 raw new-rule fields；AI 不得输出
  `projection_rule_id`，ID 由现有 deterministic production path 生成。

## Phase 1 — Message-role rollback only

### 修改函数

- `formatWorldModelPatchReferences`
- Supplement target-only user formatter
- `buildWorldModelPatchMessages`

### 目标

恢复：

```text
system formal contract
system permitted evidence
assistant Recent Story
user Existing Target + Supplement Request
```

### 不允许修改

- permitted evidence source universe；
- Persona boundary；
- Full / Event / Character builders；
- Patch schema、validator、merge。

### Tests

- Existing only in user Target；
- Worldbook / Character Card / External Memory / Opening Greeting 在原 role；
- Recent Story assistant 且只出现一次；
- Persona 排除；
- Full 不包含 Existing；
- Event reference unchanged。

### Stop / review

若 message sequence 或 evidence provenance 与冻结合同不同，停止，不进入
Phase 2。

## Phase 2 — v2 DTO parser + structural validator

### 修改函数

新增隔离的 v2 parser/validator boundary，例如：

- `parseWorldModelPatchV2`
- `validateWorldModelPatchV2`
- v2 operation shape helpers

### 目标

验证 `schema_version: 2`、operation allowlist、target kind、canonical
identity、SET_FIELD path whitelist、payload shape、禁止 REMOVE/
invalidate/NO_OP。

`ADD_PROJECTION_RULE` 必须调用现有 raw content validation contract；raw
payload 不得包含 `projection_rule_id`。

### 不允许修改

- v1 parser/validator；
- `core/projection-eligibility.js`；
- current projection ID generation；
- evidence semantics。

### Tests

覆盖每个合法 operation、missing identity、array index、identity mutation、
arbitrary path、REMOVE、NO_OP、projection raw ID rejection。

### Stop / review

若 v2 structural validator 需要猜 projection identity 或改变 v1 error
boundary，停止并报告。

## Phase 3 — Operation identity resolution + deterministic classification

### 修改函数

新增 World Model Patch v2 identity/classification helpers。

### 目标

从 Existing 解析：

- species identity；
- species-local type identity；
- mechanism stable key；
- allowlisted field old value。

冻结语义：

```text
old == proposed              -> NO-OP
old unknown -> proposed known -> ADD
old known -> different known  -> CHANGE
old known -> null             -> reject weakening / REMOVE
```

Collection：same identity + same canonical content = NO-OP；same identity +
different content = REJECT；different identity = ADD。

### 不允许修改

- AI narrative classification；
- Existing evidence boundary；
- projection update identity gap。

### Tests

覆盖 false / `"无"`、null、same field no-op、single-field ADD/CHANGE、
collection dedupe/reorder and identity conflicts。

### Stop / review

若任何 operation 可通过 omission 产生 REMOVE，停止。

## Phase 4 — Operation-level evidence guard

### 修改函数

新增或拆分 v2 equivalents of：

- `applyWorldModelPatchEvidenceGuard`
- `patchFactEvidence`
- collection payload evidence helpers

### 目标

每个 operation 独立验证 permitted evidence。一个 supported operation 不
授权 sibling fields。`ADD_TYPE` 的 existence evidence 与 type field evidence
分离；无 capability evidence 的字段保持 null。

`ADD_PROJECTION_RULE` 必须验证 raw new-rule fields，并在现有 deterministic
pipeline 生成 ID；不支持 Existing projection update。

### 不允许修改

- evidence source universe；
- deterministic narrative semantic classifier；
- projection core implementation。

### Tests

覆盖 baseline self-proof、sibling isolation、type/capability separation、
每类 collection evidence、projection add raw payload 与 projection update
blocked。

### Stop / review

若 Existing 内容能单独证明 proposed value，停止。

## Phase 5 — Sparse operation merge

### 修改函数

- `mergeWorldModelPatchV2`
- sparse operation application helpers
- final consistency/strict canonical boundary reuse

### 目标

```text
clone Existing
-> validate identities
-> evidence-validated operations
-> apply sparse operations
-> complete-model consistency guard
-> strict canonical normalization/validation
```

不再替换 complete species。未出现 operation 的 field/sibling 保持原值。
全 Patch 为 NO-OP 时 canonical model 不变。

### 不允许修改

- Runtime persistence ownership；
- write-skip policy；
- v1 complete-candidate merge path。

### Tests

覆盖 untouched sibling preservation、final consistency、strict validation、
all-no-op unchanged model、collection dedupe。

### Stop / review

若 merge 需要打开 arbitrary REMOVE 或 Structural Reclassification，停止。

## Phase 6 — Prompt switch to schema_version: 2

### 修改函数

- `WORLD_MODEL_PATCH_TASK_PROMPT`
- `WORLD_MODEL_PATCH_OUTPUT_CONTRACT`
- Supplement target-only user request formatter

### 前置条件

Phase 2–5 已 review 通过，v2 parser/validator/evidence guard/merge 已可用。

### 目标

Prompt 只要求：

- v2 DTO；
- evidence-supported ADD/CHANGE；
- no complete Existing species；
- no unchanged fields；
- no NO_OP operation；
- no REMOVE/invalidate。

### 不允许修改

- Full prompt/output contract；
- Event/Character prompt；
- Runtime routing。

### Tests

Prompt contract tests only；不以 mock AI 返回 operation 声称 narrative
discovery 已被证明。

### Stop / review

若 Prompt 已切换但 v2 parser 尚未 ready，停止回滚 Prompt switch。

## Phase 7 — v1 compatibility/fallback acceptance

### 修改函数

- World Model Patch compatibility boundary；
- v1-to-internal adapter（如确有需要）。

### 目标

v1 先完成既有 validation，再转换到内部表示；不静默改变 v1 semantics。
明确 v1 fallback 的 diagnostic、版本窗口或 capability flag。

### 不允许修改

- Runtime routing；
- storage schema；
- v1 complete-candidate deletion-risk guard。

### Tests

- v1 regression suite；
- v2 API response acceptance；
- invalid v1/v2 response isolation；
- fallback diagnostics。

### Stop / review

若无法区分 v1 complete candidate 与 v2 operation response，停止发布。

## Phase 8 — Full regression + real API acceptance

### 修改函数

无预设 production 修改；只修复经 review 确认的 v2 contract defect。

### Tests / acceptance

- full World Model regression；
- message role regression；
- operation identity and collection matrix；
- no-op / ADD / CHANGE / known-to-null；
- projection add raw payload and projection update blocked；
- Full no Existing、Event unchanged、Persona exclusion；
- production fixture leakage audit；
- real API acceptance for generic and real permitted evidence。

### Stop / review

出现模型非确定性、真实 API empty patch、projection identity ambiguity、
或 Structural Reclassification 需求时，停止并单独 review，不扩展本任务。

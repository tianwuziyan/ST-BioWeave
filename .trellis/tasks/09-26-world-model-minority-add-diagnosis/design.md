# World Model Supplement Patch v2 DTO 设计冻结

## 1. Scope / Trigger

本设计承接 World Model Supplement 的 regression restore 与
Candidate Ledger 强化结果，冻结两个待实施合同：

1. Existing World Model 仅作为 user message 中的 Supplement Target +
   comparison baseline；permitted evidence 恢复原有 system/assistant role。
2. Supplement Patch 从 v1 complete `update.species` candidate 迁移为
   `schema_version: 2` 的显式 delta-only operation DTO。

本阶段只写 canonical design，不修改 `ai/prompts.js`、`ai/analyzer.js`、
Runtime、storage、UI 或 tests。

## 2. Decision

选择显式 operation/delta DTO，而不是继续扩展含义混合的 v1
`add/update` nested shape。原因是 operation 可以同时明确：

- operation 类型；
- canonical target identity；
- allowlisted field path；
- proposed value；
- collection identity 与 duplicate policy。

AI 不返回 `old_value`，不返回 complete Existing species，不返回
`UNCHANGED`，不返回 `REMOVE` 或 `invalidate`。

```json
{
  "schema_version": 2,
  "operations": []
}
```

`operations: []` 只有在完整 Candidate Ledger、classification、Existing
comparison 与 Empty Patch Gate 后才合法。

## 3. Message architecture

不含可选 boundary system message 时，Supplement role 顺序固定为：

```text
system     formal Supplement contract
system     permitted World Analysis references
assistant  Recent Story
user       Supplement Target + Supplement Request
```

只有 user message 包含：

```text
【Supplement Target：当前已保存的 World Model】
Existing = TARGET + comparison baseline
Existing 本身不是 evidence
<existing_world_model>...</existing_world_model>
```

Worldbook、Character Card、External Memory、Opening Greeting 保留原有
system evidence architecture；Recent Story 保持单独 assistant message；
Persona 继续排除。Full / Event / Character 不变。

## 4. Operation contract

最小 operation set：

- `ADD_SPECIES`
- `ADD_TYPE`
- `SET_FIELD`
- `ADD_SPECIAL_RULE`
- `ADD_MECHANISM`
- `ADD_EXCEPTION`
- `ADD_UNKNOWN`
- `ADD_PROJECTION_RULE`（AI 只输出 raw new-rule fields，不输出 generated ID）

`medical_context` 使用受限 `SET_FIELD`，不增加专用 operation。允许的
target/path：

```text
biological_type:
  capabilities.<canonical capability key>
  reproduction_rules.<canonical rule key>
  lifecycle.maturation
  lifecycle.aging
  description

species:
  description

world:
  medical_context.childbirth_difficulty
  medical_context.care_level
  medical_context.evidence
```

禁止 array index、identity/name mutation、整组替换、schema_version
mutation、`null` 删除语义，以及任意 JSON path。

Canonical identity：

- species：`species_name`；
- type：`species_name + type_name`；
- mechanism：`species_name + type_name + stable key`；
- world field：显式 allowlisted path；
- projection update：继续 blocked。

## 5. Deterministic semantics and evidence

程序从 Existing resolve old value：

| old / proposed | result |
|---|---|
| equal | no-op |
| unknown/null -> known | ADD |
| known -> different known | CHANGE |
| known -> null | reject as weakening/REMOVE |

`false` 与 `"无"` 是 known value。Existing 只能提供 old value，不能证明
proposed value。每个 operation 独立执行 permitted-evidence validation；一
个 capability operation 不授权其它 capability、rule、lifecycle、special
rule 或 mechanism。

`ADD_TYPE` 的 type existence evidence 与 type field evidence 分离；没有
capability evidence 的新 type 仍保持 canonical null。

## 6. Collection and merge contract

集合新增使用专用 operation：

- `ADD_SPECIAL_RULE`：species + type + normalized exact string；append，
  不替换数组；
- `ADD_MECHANISM`：species + type + stable key；key 冲突且内容不同则
  reject；无 stable key fail closed；
- `ADD_EXCEPTION`：canonical `statement + applies_to` equality，不使用
  raw JSON key order；
- `ADD_UNKNOWN`：normalized unknown equality；
- `ADD_PROJECTION_RULE`：沿用当前 production raw contract，只允许
  `schema_version`、`mechanism_key`、`development_concern_key`、
  `development_kind`、`trigger` 及可选 `requirements`、`realization`、
  `contradiction`、`expiration`；AI 不得输出 `projection_rule_id`，由现有
  deterministic production path 生成；Existing projection update 继续
  blocked。

当前 source verification 已完成：`core/projection-eligibility.js` 的
`RAW_RULE_FIELDS` / `validateProjectionRuleContent()` 定义 raw 字段边界，
`normalizeProjectionRules()` 通过 `buildProjectionRuleId()` 生成 ID。本设计
不修改该文件或 ID algorithm。

所有 collection operation 统一采用：same canonical identity + same
canonical content = deterministic `NO-OP`；same identity + different
canonical content = `REJECT`；different identity = `ADD`。`NO-OP` 不是 AI
operation type，不产生 delta、重复 item 或 sibling authorization。

merge 顺序：

```text
clone Existing
-> validate identities
-> evidence-validate each operation
-> apply sparse operations
-> complete-model consistency guard
-> strict canonical normalization/validation
-> persist
```

merge 不再替换 complete species；operation omission 永远是 unchanged。

## 7. Compatibility and migration

1. 保留 v1 parser、guard、complete-candidate merge 作为 temporary backward
   compatibility，不静默改变 v1 omission semantics。
2. 新增隔离的 v2 parser/validator/operation application path。
3. 仅 Supplement Prompt 切换为 v2；Full 不变。
4. v1-to-internal adapter 只放在 World Model Patch compatibility boundary，
   不放 Runtime；adapter 必须先完成 v1 validation。
5. 在 v2 API/Runtime acceptance 完成后，再以独立批准的 cleanup 删除 v1
   Supplement path。

## 8. Generic examples

```json
{"schema_version":2,"operations":[{"op":"ADD_SPECIES","species":{"name":"Species-B","description":"Supported species."}}]}
{"schema_version":2,"operations":[{"op":"ADD_TYPE","target":{"species_name":"Species-A"},"type":{"name":"Type-B","description":"Supported type."}}]}
{"schema_version":2,"operations":[{"op":"SET_FIELD","target":{"kind":"biological_type","species_name":"Species-A","type_name":"Type-A"},"path":["capabilities","can_carry_pregnancy"],"value":true}]}
{"schema_version":2,"operations":[{"op":"SET_FIELD","target":{"kind":"biological_type","species_name":"Species-A","type_name":"Type-A"},"path":["reproduction_rules","gestation"],"value":"Supported gestation rule."}]}
{"schema_version":2,"operations":[{"op":"SET_FIELD","target":{"kind":"biological_type","species_name":"Species-A","type_name":"Type-A"},"path":["lifecycle","maturation"],"value":"Supported maturation rule."}]}
{"schema_version":2,"operations":[{"op":"ADD_SPECIAL_RULE","target":{"species_name":"Species-A","type_name":"Type-A"},"value":"Supported special rule."}]}
{"schema_version":2,"operations":[{"op":"ADD_MECHANISM","target":{"species_name":"Species-A","type_name":"Type-A"},"mechanism":{"key":"stable-mechanism-key","label":"Supported mechanism","pathway":"Supported pathway","carrying_compatibility":null}}]}
{"schema_version":2,"operations":[{"op":"SET_FIELD","target":{"kind":"world"},"path":["medical_context","care_level"],"value":"Supported care level."}]}
{"schema_version":2,"operations":[{"op":"ADD_EXCEPTION","exception":{"statement":"Supported exception.","applies_to":"Species-A"}}]}
{"schema_version":2,"operations":[{"op":"ADD_UNKNOWN","unknown":"Supported unresolved world question."}]}
{"schema_version":2,"operations":[{"op":"ADD_PROJECTION_RULE","projection_rule":{"schema_version":1,"mechanism_key":"stable-mechanism-key","development_concern_key":"concern","development_kind":"possible_detection","trigger":{"kind":"story_time_reached","target_story_time":{"day_index":1}}}}]}
{"schema_version":2,"operations":[]}
```

必须 reject：`REMOVE`、known-to-null、arbitrary path、missing species
identity、missing type identity、duplicate identity、projection update、
Structural Reclassification。

## 9. Implementation handoff

预期修改点：

- `ai/prompts.js`：Supplement role rollback、v2 task/output contract；
- `ai/analyzer.js`：v2 parser/validator、operation evidence guard、sparse
  merge；
- `tests/world-model.test.js`：role、identity、operation、evidence、merge、
  consistency 与 leakage coverage。

不得修改 Full/Event/Character semantics、Runtime routing、storage、UI、
REMOVE policy 或 projection mutable identity。

## 10. Required regression coverage

- Existing only in user Target；permitted evidence original roles；Recent Story
  assistant once；Persona excluded；Full no Existing；Event unchanged；
- every legal operation and identity resolution；
- no-op、ADD/CHANGE derivation、known-to-null rejection、false/"无"；
- sibling isolation、baseline self-proof rejection、untouched Existing merge；
- collection dedupe/reorder invariance；
- REMOVE、Structural Reclassification、projection update rejection；
- final consistency、strict canonical validation、generic fixture leakage。

## 11. REVIEW REQUIRED

- v1/v2 concurrent external API acceptance window；
- implementation conformance to the frozen duplicate policy: same identity +
  same content is `NO-OP`, same identity + different content is `REJECT`；
- species scalar whitelist beyond `description`；
- implementation verification that projection add calls the existing raw
  validator/generator and rejects AI-supplied `projection_rule_id`；
- compatibility-period release/capability flag；
- v2 error codes and adapter boundary details。

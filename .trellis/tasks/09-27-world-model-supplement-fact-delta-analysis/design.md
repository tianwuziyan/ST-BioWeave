# Fact Delta Protocol v1 设计分析

## 当前与目标 production path

当前：

```text
permitted Evidence + Existing
  -> buildWorldModelPatchMessagesV2
  -> hierarchical Complete Evidence-Supported Candidate Text
  -> parseWorldModelSupplementText / validateWorldModelCandidate
  -> worldModelCandidateToPatchV2
  -> Patch v2 Evidence Guard
  -> mergeWorldModelPatchV2
  -> final consistency / canonical validation
  -> Floor persistence / UI
```

目标：

```text
permitted Evidence + Existing
  -> Supplement prompt
  -> AI internal complete Fact Discovery
  -> Fact Delta text
  -> self-contained Fact parser
  -> semantic resolver / Existing comparison
  -> existing Patch v2
  -> existing Guard -> merge -> canonical
```

实际入口：`runtime/world-analysis.js:329-365`、`ai/analyzer.js:4017-4059`；
Existing formatter 在 `ai/world-supplement-protocol.js:142-199`，Supplement prompt
在 `ai/prompts.js:661-735,737-855`。Existing 是 TARGET、comparison baseline、
structure reference，不进入 `evidenceUnits()`；Full 不消费 Existing。

## Fact Delta v1 grammar

```text
[World Model Updates]
[Fact]
Species: Species-A
Field: Species_Identity
[/Fact]
[Fact]
Species: Species-A
Biological_Type: Type-A
Field: Can_Carry_Pregnancy
Value: true
[/Fact]
[/World Model Updates]
```

一个 Fact 是完全独立记录：每条都必须直接携带 `Species`；Type-scoped Field
必须直接携带 `Biological_Type`。不继承前一个 Fact、当前 block、缩进或 parser
parent state。只允许一个 root、完整闭合 Fact 和空白；嵌套 Fact、自由文本、未知
Field、隐式闭合、重复 scalar label、尾部解释均 fail closed。

Species 与 Biological_Type 是非空开放字符串，不是 enum。Field 是严格、有限、
大小写敏感的 semantic vocabulary：

- identity：`Species_Identity`, `Type_Identity`
- descriptions：`Species_Description`, `Type_Description`
- capabilities：`Can_Produce_Sperm`, `Can_Produce_Ova`, `Can_Be_Fertilized`,
  `Can_Fertilize`, `Can_Cause_Pregnancy`, `Can_Carry_Pregnancy`
- reproduction：`Fertilization`, `Pregnancy_Or_Carrying`, `Cycle`, `Ovulation`,
  `Gestation`, `Labor`
- lifecycle：`Maturation`, `Aging`
- collections：`Special_Rule`, `Exception`, `Unknown`
- world medical：`Childbirth_Difficulty`, `Care_Level`, `Medical_Evidence`
- structured：`Reproductive_Mechanism`, `Projection_Rule`

## 最小 payload grammar

| 类型 | payload | 语义 |
| --- | --- | --- |
| identity | identity + `Field`，无 `Value` | 只建立 Species/Type existence |
| scalar | scope + `Field` + typed `Value` | description、capability、rule、lifecycle、medical |
| collection | scope + collection `Field` + item payload | rule、exception、unknown |
| structured | scope + `Field` + exact fields | mechanism、projection |

Capability `Value` 只能是 `true/false`；其它 scalar 是非空 string。`null`、
`unknown`、`NONE RECORDED`、空值不是 claim。`false` 是已知事实，不是 REMOVE。

例：

```text
Species: Species-A
Biological_Type: Type-A
Field: Special_Rule
Value: Type-A follows the stable rule.
```

```text
Species: Species-A
Field: Exception
Exception_Statement: Species-A normally follows the rule, except under the stated condition.
Applies_To: Species-A
Exception_Evidence: The permitted evidence describes the exception.
```

```text
Species: Species-A
Biological_Type: Type-A
Field: Reproductive_Mechanism
Mechanism_Key: stable-mechanism-key
Mechanism_Label: Mechanism label
Mechanism_Pathway: Supported pathway
Carrying_Compatibility: true
World_Model_Rule_Refs: ["rule-reference"]
Mechanism_Evidence: ["evidence sentence"]
```

Mechanism key 必须稳定；compatibility 是 boolean/null，lists 是 string arrays。
Projection 使用单个 raw JSON object，禁止 `projection_rule_id`，继续由现有
validator/ID generator 处理。

## 依赖、dedupe、conflict

- Existing Species/Type detail 不要求同 response identity。
- 新 Species 必须同 response 有 `Species_Identity`；新 Type 必须同 response 有
  `Type_Identity`。新 Species + 新 Type 需要两者，并按 Species → Type 建立依赖。
- identity 不授权 details；合法 Type identity 与 unsupported sibling detail 不应
  被合并。建议 v1 response-level transaction：任一结构/语义 conflict 拒绝整个 response。
- 同一事实重复且 canonical value 相同：dedupe；collection 同 identity + 同内容：
  no-op；同 path 或同 collection identity + 不同内容：reject，绝不 last-write-wins。
- 一个 evidence sentence 支持 Type-A 与 Type-B 时，AI 输出两条完整 scoped Facts，
  resolver 不合并。
- rare/minority Type 仍由现有 Stability/Exclusion Gate 判断，prevalence 不影响 existence。
- empty delta 合法，生成 Patch v2 空 operations，保留 Existing。

## Fact → Patch v2

| Fact | Mapping |
| --- | --- |
| Species_Identity（新） | `ADD_SPECIES` identity-only |
| Type_Identity（新） | `ADD_TYPE` identity-only |
| descriptions | `SET_FIELD` corresponding description |
| six capabilities | `SET_FIELD` capability path |
| six reproduction fields | `SET_FIELD` rule path |
| lifecycle | `SET_FIELD` lifecycle path |
| medical context | world `SET_FIELD` on existing three paths |
| Special_Rule | `ADD_SPECIAL_RULE` |
| new mechanism key | `ADD_MECHANISM` |
| Exception | `ADD_EXCEPTION` by statement + applies_to |
| Unknown | `ADD_UNKNOWN` by canonical text |
| new projection rule | `ADD_PROJECTION_RULE` with generated ID |
| same known fact | no operation |
| known scalar correction | `SET_FIELD`, classified CHANGE |
| omission/null/disappearance | preserve Existing; null transport invalid |

因此 Patch v2 足够承载所有当前可安全映射的 add/scalar/identity outlets，无需新增
operation。但已有 mechanism 的 label/pathway/compatibility/rule refs/evidence correction
没有 outlet：`ADD_MECHANISM` 会把 same key conflict，`SET_FIELD` 不允许 mechanism path。
已有 projection rule update 也被当前 mutable-content identity gap 阻塞。Fact Delta v1
必须显式 fail closed，而不能偷渡成 ADD、replacement 或新 Patch op。建议错误码分别为
`FACT_DELTA_EXISTING_MECHANISM_UPDATE_UNSUPPORTED` 与
`FACT_DELTA_EXISTING_PROJECTION_UPDATE_UNSUPPORTED`。

## 保留的 semantic extraction rules

Fact transport 只是 serialization change，必须继续使用现有 permitted evidence 与
Evidence Guard：Species Binding、Biological Type Exclusion Gate、Stability Gate、
biological/reproductive classification、direct/derived stable classification、
derived-stability frozen gate、rare/minority existence、identity != details、
capability tri-state、scope preservation、Existing != evidence、Human/Nonhuman baseline。
deterministic resolver 不得变成 narrative parser。

## Fail-closed rules

缺 root、未闭合 Fact、嵌套 Fact、自由文本、未知 Field、wrong scope、duplicate scalar、
invalid boolean、null、malformed JSON、未知 payload key、缺 identity、缺 mechanism key、
projection ID supplied、冲突 duplicate 均拒绝；不 re-parent、不 partial last-write-wins。
Fact response 不包含 ADD/CHANGE/SET_FIELD/ADD_TYPE/REMOVE 等 operation 指令。

## 19 个场景结论

1. 新 Species identity-only：合法，`ADD_SPECIES` defaults。
2. Existing Species 新 Type identity-only：合法，`ADD_TYPE` defaults。
3. Existing Type 新 scalar：同 scope evidence 支持则 `SET_FIELD`。
4. Existing scalar correction：直接同 scope evidence 支持才 `SET_FIELD CHANGE`。
5. Existing same fact：no-op。
6. rare/minority：不因少数而拒绝。
7. 一句 evidence 支持多个 Type：每个 Type 独立 Fact。
8. collection：semantic identity dedupe，identity collision with changed content reject。
9. mechanism：新 key 可 ADD；已有 key correction blocker。
10. exception：statement + scope + evidence 的 world collection item。
11. unknown：只能是 evidence 已触及的重要 unresolved proposition。
12. medical：只接受 world-level scope，不把个体事件升级为 world fact。
13. projection：只允许新 raw rule；existing update blocker。
14. malformed Fact：fail closed，不跨边界恢复。
15. duplicate Fact：相同 canonical content dedupe，不同 content reject。
16. 同路径冲突：整 response reject，非 last-write-wins。
17. 新 Type detail 无同 response Type_Identity：reject。
18. 合法 Type identity + unsupported sibling：不得授权 detail；建议整 response reject。
19. empty delta：合法 no-op。

## 后续需要修改的 production files（本轮不改）

`ai/world-supplement-protocol.js`（Fact parser/DTO）、`ai/prompts.js`（Supplement-only
contract）、`ai/analyzer.js`（Fact resolver/adapter）、可能极小范围的
`runtime/world-analysis.js`（优先保持现有 analyzer method shape）、`tests/world-model.test.js`
与 `.trellis/spec/domain/world-model.md`。明确不改 `storage/schema.js`、Floor persistence、
UI、Full/Event/Character path、Evidence Guard、merge、final consistency、projection identity、
`system_top`/`system_bottom`。

## Migration

1. 先决定两个 blocker 是否明确排除；建议排除并 fail closed。
2. 隔离实现 parser/resolver，不接 runtime。
3. 接 Patch v2 adapter，测试所有 mappings。
4. 直接替换 Supplement prompt；production 不保留 Candidate fallback、dual parse 或长期 feature flag。
5. parser、resolver 或 mapping 失败交给当前 retry mechanism；重试耗尽后 fail closed，不持久化。
6. 完成 focused tests、full suite 和真实 Host acceptance 后，旧 Candidate parser 仅保留给 compatibility tests 或其它明确调用者。

## Tests

覆盖 grammar、exact vocabulary、self-contained scope、identity dependencies、rare/minority、
multi-Type evidence、all scalar paths、all collections、mechanism/projection blockers、
dedupe/conflict/no-last-write-wins、malformed/empty delta、Fact → Patch v2 → Guard → merge
→ canonical，以及 Full/runtime persistence unchanged。fixture 只用 `Species-A/B`、
`Type-A/B`。

## Unresolved questions

1. 是否把 existing mechanism/projection corrections 排除在 v1？建议排除，单独设计 Patch v2。
2. 是否允许 valid identity 与 unsupported sibling partial success？建议 v1 whole-response reject。
3. Medical evidence token 使用 `Medical_Evidence` 还是 nested `Evidence`？建议前者避免跨结构歧义。

# Character Evidence Input Boundary 设计

## 1. 精确根因

`bec4320b` 的模块化目标是正确的：Event Analyzer 不再直接序列化 Host 的 Character Card、Persona、Worldbook、External Memory。问题在于它只完成了“禁止 raw source”而没有完成等价的“稳定人物证据 projection”。

当前链路中：

```text
collectAnalysisContext()
  -> buildAnalysisInput()
     -> character / persona / worldbooks / external_memory
buildFloorAnalysisInput()
  -> defaultCharacterContext()
     -> current_character / character_card / profiles
buildEventAnalysisInput()
  -> normalizeEventAnalysisInput()
     -> projectEventIndividualEvidence(characterContext.profiles only)
buildEventAnalysisMessages()
  -> formatEventAnalysisReferences()
     -> identity_context / individual_evidence / world_model / existing_events
```

所以：

- `profiles` 有值时，existing profile 路径仍然工作。
- 新人物、Bootstrap、没有 derived profile 的当前 Character 只有 `character_card`/`current_character`，但 projection 不读取它们。
- Persona、Worldbook、External Memory 虽仍存在于 wide DTO，却没有任何 Character-specific semantic projection。
- 最终 prompt 仍保留“明确生理性别可映射到已存在 biological_type”的规则，但可能没有包含承载该事实的 evidence。

## 2. `16b8dbb` 前后差异

在 `16b8dbb` 版本，`normalizeEventAnalysisInput()` 保留并清洗 `character`、`persona`、`worldbooks`、`external_memory`，`formatEventAnalysisReferences()` 依次格式化 Character Card、Persona、character context、Worldbook、External Memory、World Model 与 Existing BioWeave。

在 `bec4320b` 版本：

- normalize 的返回值移除上述 raw source 字段（保留 `recent_story` 等 narrow fields）。
- 新增 `identity_context`、`individual_evidence`、`existing_events` projection。
- `projectEventIndividualEvidence()` 只枚举 `characterContext.profiles`。
- Prompt references 只消费 projection，不再调用 raw source formatter。
- `buildEventAnalysisInput()` 为 Runtime orchestration 仍返回 wide DTO 的 raw fields，但这只证明来源保留，不证明 prompt 可见。

已确认仍在 Prompt 的内容：`recent_story.items` 经 `formatNarrativeContext()` 进入 assistant narrative；`current_floor` 作为目标正文进入同一 narrative message；`world_model`、identity candidates、existing events 进入 Event semantic reference。Character Card、Persona、Worldbook、External Memory 的 stable-person evidence 在 Event references 中彻底消失。

## 3. 最小 projection 建议

建议扩展现有 `individual_evidence`，不新增大型领域模型。最小形状为：

```js
{
  subject: {
    kind: 'current_character' | 'persona' | 'canonical_character',
    character_id: string | null,
    display_name: string | null,
    identity_hint: string | null,
  },
  source: {
    kind: 'character_card' | 'persona' | 'existing_profile' |
      'worldbook' | 'external_memory',
    source_id: string | null,
    item_id: string | null,
  },
  stable_biological_evidence: string[],
  species: string | null,
  biological_type: string | null,
  explicit_capabilities: object,
  provenance: {
    chat_id: string | null,
    floor_version: object | null,
  },
}
```

实现时可将同一 subject 的多个 source item 合并为一项，但必须保留 `source.kind/source_id/item_id` 列表；如果复用现有 `individual_evidence` 的数组契约，则不应将 raw source nested object 放入其中。`character_id` 可以为 null，Bootstrap 必须依靠 `subject.kind` 和 `identity_hint`，不能以姓名伪造 canonical ID。

建议的 source policy：

| Source | Event Character Evidence | 依据 |
| --- | --- | --- |
| 当前 Character Card description | 允许，绑定 `current_character` | 当前 selected source 已由 `buildCharacterInput()` 清洗；它是当前 Character 的稳定背景，不是当前 Floor Event |
| Persona description | 允许，绑定 `persona` | Persona 是用户人物稳定设定；不得把其中叙述的旧事件当作当前 Floor Event |
| Existing canonical/derived profile | 允许，绑定 profile 的 `character_id` | 现有路径必须保持；只消费当前有效 Floor-derived profile |
| selected Worldbook | 仅显式 subject-bound item 允许 | 当前 entry DTO 只有 label/content 时无法证明人物归属；无绑定项留在 World Model，不进入人物 profile |
| External Memory | 仅显式 subject-bound item 允许 | provider/item label/content 不是 subject proof；无绑定项留在 World Model，不进入人物 profile |
| Recent Story / Target Floor | 不复制进 Character Evidence | 已经由 narrative context 进入 Event prompt，且属于事件事实上下文，不是稳定 profile |

## 4. Initial Registry Bootstrap

当 `identity_context.canonical_candidates` 为空且 current Character Card/Persona 有稳定生理 evidence 时：

1. projection 输出 `character_id: null`、`subject.kind`、`display_name/identity_hint` 和 source provenance。
2. Prompt 允许 analyzer 使用该 evidence 做 species/type mapping，但输出仍使用既有 `identity_status: new/unresolved`、`character_id: null`、response-local `mention_N` 规则。
3. Runtime 继续在 response 后完成 canonical ID 分配和 Floor-owned registry 写入；projection 不创建 registry entity，也不把 `character_registry.entities` 当人物列表。
4. 没有足够 stable evidence 时保持 `biological_type: null`、capabilities unknown/pending；不得为了进入 Tracking UI 猜测。

## 5. Provenance 与 cross-character 防护

- 所有 profile evidence 必须带原有 `character_id`；没有 ID 的 Character Card/Persona evidence 使用明确 subject kind，而不是把 display name 当 ID。
- Worldbook/External Memory 默认 deny；只有 source item 自身存在稳定 subject binding（例如 canonical `character_id` 或明确的 source-level subject key）才允许投影。
- 不使用“文本包含姓名”作为唯一归属证明，不使用 first-match-wins，不把一个人物的 source 推给所有 participants。
- Projection 是本次 Event request 的 transient input；不新增 Chat-level fact，不写 Floor，不改变 ownership/provenance contract。
- `safeStructuredValue`/现有 safe text redaction 继续作为最终清洗层；projection 只能白名单读取字段，不能复制 API/settings/secret/host response。

## 6. 最小文件集合

后续实现预计只触及：

1. `ai/input-builder.js`：构造和清洗 Character Evidence projection，复用现有 source selection、safe text 与 wide DTO。
2. `ai/prompts.js`：仅将已经存在的 semantic projection 格式化为 Event reference，并支持 `character_id: null` 的 Bootstrap evidence；不恢复 raw formatters，也不先改核心 Prompt 文案。
3. `tests/context-prompt.test.js`：A-G input/message boundary 回归。
4. 如测试证明 Runtime 没有把必要的 scoped data 传到 builder，才最小修改 `runtime/event-analysis.js` 的 input assembly；当前证据显示 wide DTO 已保留，暂不预设修改。

不触及 Tracking、World Model schema/persistence、Floor/Event persistence、Generation lifecycle、UI、Story Time、Calendar、StateReducer、Projection、Coordinator 或 Adapter。

## 7. 主要取舍

最小安全方案宁可暂不把无 subject binding 的 Worldbook/External Memory 内容当人物证据，也不通过启发式姓名匹配制造跨人物污染。代价是这类内容只能先参与 World Model；如果产品以后需要人物归属，需单独为 source collection 增加可验证 subject binding 合同，再扩展 projection。

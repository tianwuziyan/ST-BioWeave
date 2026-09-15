# 技术设计：Runtime 权威的人物身份解析

## 1. 已确认的现状

当前生产链路是：

```text
Runtime 组装 AnalysisInput
  → Prompt 要求 LLM 输出稳定 character_id
  → ai/analyzer.js trim / schema normalize / 以字符串检查引用
  → Runtime 丢弃模型 event_id/source，生成自己的 Event ID/source
  → core/events.js normalize / validate
  → Floor/Swipe 保存
  → core/tracking.js 按 character_id 重建 Tracking Subject/Profile
```

`character_id` 首次出现时实际来自模型返回值；没有 Runtime 分配、registry membership
校验、alias/nickname 生命周期或 unresolved identity 状态。`character_context.profiles`
是带证据的语义/生物背景资料，`tracking_subjects` 与 `tracking_candidates` 是从有效
妊娠暴露 Event 派生的索引，均不是可承担全 Chat canonical entity 的 registry。

现有 dedup 在 `ai/analyzer.js` 与 `core/events.js` 都按 trim 后的精确
`character_id` last-record-wins；Tracking 也按该 ID 建 Map。这个行为不会因拼音自动
合并同音人物，但会把模型误用同一 ID 的不同人物静默合并，也无法把同一人物的不同 ID
复原为同一实体。现有 pregnancy 校验要求一个 subject、至少一个 counterpart、精确
participant closure、exposure evidence marker，Collection 再禁止同一 subject 的重复
Event。

## 2. 新的最小数据合同

### 2.1 Chat-local Character Registry

在现有 Chat metadata 内新增一个可选的 `character_registry` 字段；不改变现有 Event
持久化形状：

```json
{
  "schema_version": 1,
  "entities": {
    "char_<opaque-runtime-id>": {
      "character_id": "char_<opaque-runtime-id>",
      "display_name": "沈祁鸢",
      "aliases": ["祁鸢", "鸢儿"]
    }
  }
}
```

`entities` 以 canonical ID 为 key，绝不以 display name 或 alias 为 key；因此同名和
同 alias 可以合法共存。新 ID 由 Runtime 使用仓库已有的 `crypto.randomUUID()` 优先、
无 Web Crypto 时使用随机/时间序列 fallback 生成 `char_...` opaque 值，不读取或编码
任何姓名。display name 可更新，aliases 可追加，ID 不变。

纯函数与 registry 规则集中放在新增的 `core/identity.js`，而不是在 Analyzer、Tracking
和 Storage 各复制一份：

- registry normalize/clone、entry validation、candidate projection；
- opaque ID 生成；
- exact display/alias 候选收集（结果是 ID 集合，不是单值 map）；
- raw participant identity resolution/registration；
- alias candidate 分类与持久化过滤；
- legacy Event ID 的只读兼容引入。

该模块不依赖 Storage，避免 `storage/schema.js` 与 domain 发生循环依赖。

### 2.2 Analyzer raw identity DTO

在现有 participant 事实字段旁加入 raw-only identity 字段；这些字段不会进入最终
BiologicalEvent：

```json
{
  "identity_status": "existing | new | unresolved",
  "character_id": "char_existing_id 或 null",
  "mention_id": "response-local-mention",
  "display_name": "祁鸢",
  "alias_candidate": {
    "value": "鸢儿",
    "kind": "nickname",
    "confidence": 0.97
  },
  "identity_evidence": [
    {"kind": "explicit_alias", "text": "以后叫我鸢儿就好"}
  ]
}
```

`mention_id` 是本次响应内的临时引用；pregnancy relevance 的两个数组可以引用
participant 的临时 handle，但不能引用姓名拼接或模型创造的永久 ID。为兼容旧 DTO，
没有 `mention_id` 的 legacy participant 暂以旧 `character_id` 作为 raw handle；该值
是否为 canonical ID 仍由 Runtime 决定。

`parseEventAnalysisResponse()` 继续负责 JSON、类型、枚举、证据、location 和 raw handle
闭包等结构检查，但不在 `character_id: null` 的 raw DTO 上执行最终 participant-backed
pregnancy validation。最终 `character_id`、subject cardinality、source closure 和
collection duplicate subject 都移动到 identity resolution 之后的 Domain validation。

旧的直接注入 Analyzer/test adapter 若返回没有 identity 字段的完整 Event，作为已有的
trusted legacy Event DTO 兼容读取；生产 `createAnalyzer()` 解析出来的模型响应会带
明确的 identity status，未知 ID 不走这条兼容分支。

## 3. Runtime identity resolution

`runtime/event-analysis.js` 在现有 Runtime event ID/source seam 中插入一层：

```text
Analyzer raw DTO
  → resolveEventAnalysisIdentities(raw, current character_registry)
      - validate existing ID membership
      - re-check exact display/alias candidates without treating names as unique
      - register confirmed new entity with opaque ID
      - collect accepted alias/display-name updates
      - reject unresolved/conflicting identity without writes
  → clean canonical Event DTO（只含 character_id）
  → Runtime event_id/source enrichment
  → validateEventCollection / normalizeEvent
  → Floor + Chat metadata persistence
```

具体规则：

1. `existing` 只有在 `character_id` 当前存在于输入的 registry candidate 集合时才可
   使用；模型返回 `shen_qi_yuan` 而 registry 没有该 ID 时，降级为 identity error/
   unresolved，绝不把字符串写入 Event。
2. `new` 先做一次 exact display/alias recheck，但 display name/alias 不是唯一键。
   没有现有候选时创建新的 opaque ID；命中已有候选时，除非 narrative 明确证明这是
   另一个人物并提供 `explicit_new_entity` 等 identity evidence，否则返回 unresolved。
   现有候选的唯一字符串匹配不能自动复用，避免把同名人物错误合并；同名/同 alias 的
   多个实体仍不以注册先后决定，必须有可靠上下文，否则 unresolved。
3. `unresolved` 永远不能生成 canonical Event participant。为维持最终 Event schema
   和 pregnancy closure，当前响应中含 unresolved 必需参与者时整批分析失败并保留旧
   Floor 成功结果；不保存 registry、Floor Event 或 partial Event。错误只记录安全的
   `identity_resolution` stage/code/path。
4. 只在本次 raw response 的 participant 已解析到一个 canonical ID 后，才以该 ID 合并
   同一人物的多个 mention。不同临时 handle、同名、同音或相似字符串不合并；冲突的
   同一 handle/ID participant 不再 last-record-wins 静默覆盖。
5. final Event participant 使用 narrative 当前可读 `display_name`，但关联字段只写
   canonical `character_id`；raw identity 字段、mention handle 和 alias candidate 不
     落入 persisted Event。

## 4. Alias / nickname 生命周期

第一版将三个动作作为不同 contract，不允许互相隐式升级：

```text
mention resolution  →  当前 mention 指向哪个 candidate entity
alias discovery     →  narrative 是否明确建立了稳定称呼关系
alias persistence   →  Runtime 是否接受 candidate 并写入 registry
```

`“沈祁鸢坐在窗边。鸢儿随后起身。”` 即使 LLM 可以凭上下文判断
`鸢儿 -> char_001`，也只能产生当前 Event 的 mention resolution；没有
alias-establishment evidence 时，不得返回 `alias_candidate`，也不得写入 aliases。
正文中 display name 与另一个称呼同时出现，同样不是自动 alias 证据。

只有类似以下明确叙事才允许 LLM 返回 `alias_candidate`：

- “沈祁鸢说，以后叫我鸢儿。”
- “她名叫沈祁鸢，小名鸢儿。”
- “众人都称沈祁鸢为鸢儿。”

Registry 只保存已被 Runtime 接受的稳定名称变体；raw candidate 永远是建议，不是写入
命令。接受条件为：value 非空、不是 canonical display name、不是已有 alias、不是
pronoun 或 generic/reference/title、candidate kind 属于 `name_variant` 或 `nickname`、
并带有明确 establishment evidence。单次普通 mention、连续性推断或单次高置信度
判断不能触发第一版的永久学习；未来的多次一致 mention 晋升机制不在本次范围内。

所有 display/alias 匹配返回 `Set<character_id>`，而不是 `registry[value]`。alias
collision 是合法数据；精确匹配只产生 candidate entity 集合，不能直接决定
`character_id`。只有 narrative context 能可靠消歧时才接受模型选中的 candidate，
否则返回 unresolved，绝不 first-match-wins。

明确的“叫我 X”“大家都叫她 X”“真名是 X”可分别触发：

- accepted alias candidate：追加 alias，不改变 ID；
- explicit display-name update：更新同一 entry 的 display_name，并保留旧 display
  form 为 alias；
- identity relationship between two already existing IDs：本次只返回 unresolved/
  merge candidate，不删除、redirect 或自动 merge 任一 ID。

nickname-only 新人先以该昵称作为 display_name 创建一个 canonical entity；后续明确的
真名揭示更新同一 entry，ID 不变。若首次 narrative 同时提供正式名和昵称，只创建一个
entry。

## 5. Input / prompt 边界

`normalizeEventAnalysisInput()` 与 Runtime `buildFloorAnalysisInput()` 新增独立的
`character_registry`。Prompt builder 新增明确的 canonical identity block，逐项展示
ID、display name、aliases，并说明 ID 是 Runtime 原样提供的只读候选；现有
`character_context` 仍作为背景/语义 context 单独渲染，不能充当 whitelist。

Prompt 明确规定：

- existing 只能原样引用输入 candidate ID；
- new/unresolved 不得创建 stable ID，使用 `mention_id`/null；
- 不确定 alias、同名、同音或同 alias 时返回 unresolved；
- display_name 是自然语言可读名称，不是 ID 生成输入；
- location 从 narrative/Target Floor/Recent Context/Worldbook 保留原文，未知为 null，
  不翻译、不拼音、不 romanize、不 slugify。

Analyzer 现有 `eventText()` 和 Event normalize 已不会做拼音/slug 转换，因此 location
修复集中在 prompt contract 与原文回归测试，不引入 Location Registry。

## 6. Storage 与旧数据兼容

`storage/schema.js` / `storage/store.js` 对缺少 `character_registry` 的旧 Chat 返回空
registry；保留 `SCHEMA_VERSION === 1`，不做全量 migration。Runtime 在 Tracking rebuild
时可从旧有效 Event participant 和既有 profile 生成 legacy registry entry，原 ID 原样
保留、不重命名、不回写历史 Event。新分析输入此后携带该 registry。

成功分析只在 identity resolution、Domain validation 全部通过后才保存 registry。现有
Floor save、Chat save、Tracking rebuild 的 stale-chat / failure guards 保持不变；如
metadata save 失败，沿用现有失败保护并避免以未验证 identity 更新 Chat registry。

`getTrackingRegistry()` 可在内部/测试 DTO 中附带 `character_registry`，但普通 Characters
UI 仍只枚举 `tracking_subjects`，不渲染 canonical ID、alias provenance 或 raw identity
diagnostics。

## 7. 非目标与风险

- 不把 `character_profiles`、Tracking registry 或 SillyTavern Character Card ID 改名为
  Character Registry；它们继续承担原有职责。
- 不实现 destructive canonical merge、global alias unique constraint、Location Registry、
  完整妊娠状态机或 UI 人物目录扩展。
- 旧 Event 的任意历史 ID 为兼容而保留，不能证明它们曾经由新 Runtime 创建；新生产 API
  返回的未知 existing ID 仍严格拒绝。
- 由于当前 Floor 与 Chat metadata 是两个宿主保存点，identity registry 与 Floor 的
  跨存储原子性仍受宿主 API 限制；实现必须至少保证 validation failure 不产生 partial
  write，并在 save failure 测试中验证旧成功结果保持不变。

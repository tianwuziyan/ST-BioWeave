# BioWeave 数据模型

## Extension Level
`SillyTavern.getContext().extensionSettings.bioweave`：插件级 API Profiles、Secret 引用、四个分析任务的 Profile 选择，以及全局 `api_request_settings: {timeout, retry_count}`。超时以整数毫秒保存（250–600000），重试次数保存为 0–3 的整数；两者不属于 Profile 或 Chat 数据。

最近剧情的全局正则也属于插件级配置，仅保存规则本身，不保存读取楼数或正文：

```json
{
  "recent_story_global": {
    "regex_rules": [
      {"pattern": "/正则/", "type": "extract", "enabled": true}
    ]
  }
}
```

全局正则适用于所有角色卡，并在分析输入收集时先于当前 Chat 的角色卡正则执行。

同一层的 `world_analysis_prompt` 只保存 World Analysis 的用户可编辑补充提示和输入分段标签，不保存 AnalysisInput 正文或 API Key。固定核心约束和结果校验不由该设置覆盖。

Profile 只保存非秘密连接配置和不透明的 `secret_ref`；API Key 由 SillyTavern Secret Store 保存，不能进入 Chat、Floor、Event、Snapshot、Projection、Log、Export 或 Prompt Inspector。

## Chat Level
`chat_metadata.bioweave`：当前 Chat 的 WorldModel、CharacterProfiles、Relationships、Settings、Indexes。API Profiles 不属于 Chat 数据。

World Model v1 保存在 `world_model`，只包含经过规范化的生物学世界规则。顶层固定为 `schema_version`、`species`、`medical_context`、`exceptions` 和 `unknowns`；`biological_types` 只能嵌套在对应的 `species[].biological_types[]` 中，species 不承载合并 capabilities。species 识别与 biological type 识别分开：完整 AnalysisInput 只有在明确出现普通人类，或综合上下文可靠支持普通人类作为默认生物背景且没有独立非人类/冲突生理证据时，才可以建立“人类” species；缺少 species 名称不是无条件回退，也不因识别出人类自动补齐任何 biological type。类型只来自 AnalysisInput 实际出现或规则明确描述存在的分类。固定双性分类的显示名称为“双性”，临时双性化、身体改造、个人模糊状态和种族/属性/来源别名不构成 biological type。明确的非人类证据分别建立对应 species；类型名称保持开放，可表达资料实际定义的分类，不自动生成类型组合。非人类 biological type 必须有同一 species 上下文中的直接证据或唯一、低推断的语义证据，不能用另一个 species 的男性/女性证据跨 species 授权。每个 biological type 的 `capabilities` 仍按证据或适用的人类基线逐项保存 `true`、`false` 或 `null`，不能由名称、性别、代词、称谓、外貌或身体形态触发补全；`reproduction_rules`、`lifecycle` 和 `special_rules` 也都属于具体 biological type。非人类的每个能力和规则字段都必须分别通过对应 AnalysisInput 证据；没有证据时为 `null`，不复制现实人类模板。人类基线按字段使用，优先级为明确当前个体事实 > 明确转化后/特殊体系规则 > 明确世界/世界书规则 > 可靠推断出的人类基线 > 未知；delta 只覆盖明确变化的字段，未变化的稳定基础继续保留。明确的人类等价规则也只支持明确覆盖的字段。AI 分析结果会在结构规范化后执行证据边界清理，手动编辑只执行结构规范化，因此手动修订仍可保存来源未自动识别的合法开放类型。顶层 `medical_context` 记录当前世界医疗条件、生育难易度和证据。`world_model_meta` 只保存最后分析/保存时间、保存方式和来源数量摘要。World Model 的分析输入正文只在当前页面内存中临时生成，不写入 Chat metadata。用户人物设定仍可用于通用 AnalysisInput 预览，但不作为 World Model 世界规则判断依据。

`chat_metadata.bioweave.settings.worldbooks` 只保存当前 Chat 的世界书来源选择：`mode` 与 `selected` 中的稳定子项标识。世界书条目使用 `{source_id, entry_id, enabled}`，角色卡字段使用 `{source_id, field_key, enabled}`。来源名称、宿主 file 内容、请求头和 token estimate 不持久化；选择也不等于最终 BioWeave Context 注入。

AI 原始返回只在当前分析调用中存在；若启用开发调试 trace，只临时保存在当前页面内存并显示在设置页高级/调试区域，不进入 Chat metadata、Floor、Event、Snapshot、Projection、Context 或 World Model schema。

最近剧情和外部记忆是同一 Chat 下的独立配置，不属于世界书来源目录：

```json
{
  "recent_story": {
    "floor_count": 20,
    "regex_user_enabled": false,
    "regex_rules": [
      {"pattern": "/正则/", "type": "extract", "enabled": true}
    ]
  },
  "external_memory": {
    "anima": false,
    "baobaoshu": false,
    "database_memory": false
  }
}
```

`recent_story.regex_rules` 是当前 Chat/角色卡范围的规则，保留既有 Chat-local 数据；既有规则不会自动升级为全局规则。读取楼数和是否处理 USER 楼也只属于当前 Chat。最终执行顺序固定为：插件级 `recent_story_global.regex_rules`，然后当前 Chat 的 `recent_story.regex_rules`。

最近剧情不再提供单独的读取开关；`floor_count` 大于 0 时读取最近楼层，填写 `0` 时不读取。旧数据中的 `enabled` 仅作为兼容字段，不再参与读取判断。

外部来源的可用状态只存在 UI 运行时；未确认公开接口的来源可以显示为不可用，但不会伪造读取或写入能力。

分析来源的 `source_type` 至少区分 `character_card`、`worldbook` 和 `recent_story`。真正的 SillyTavern Worldbook 使用稳定 `file_id`/`source_id`，条目使用宿主稳定 `uid`/`id`/对象 key，显示名称和条目标题都不是唯一 ID。

## World Model 规则字段语义

World Model 规则字段使用统一三态语义：`null` 表示未知、未提及、证据不足或无法判断；`"无"` 表示已经知道机制不存在、能力不具备或规则不适用；非空字符串表示已知存在对应机制。没有资料不能写成 `"无"`。普通 Human Male/Female 已建立后可以使用现实 baseline：Male 的 `pregnancy_or_carrying`、`cycle`、`ovulation`、`gestation`、`labor` 为 `"无"`，Female 的 `cycle`、`ovulation`、`gestation`、`labor` 使用简洁的普通 Human 描述；明确世界/个体规则按 Baseline + Delta 逐字段覆盖，Human baseline 只在当前字段为 `null` 时补值，不覆盖 `true`、`false`、`"无"` 或非空描述。独立的明确结构冲突仍可由 Final Consistency Guard 修正为已知 absence。Human species 的显示 canonical name 为“人类”，仅合并明确的 Human 显示别名，不建立其它 species 的同义词 registry。schema 不因该语义扩展，仍使用现有 `string | null` 字段。

## Floor Level
`message.extra.bioweave` / `message.swipe_info[n].extra.bioweave`：Analysis、Events、Snapshot、Projections。

## 核心链
`Floor Version → BiologicalEvent → State Reducer → Current State → Snapshot → Projection → Context`。

用户编辑 Event 后，保存后的 Event 就是后续计算使用的数据；删除是真删除。Projection 不进入事实历史。

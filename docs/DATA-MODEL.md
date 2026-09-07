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

World Model v1 保存在 `world_model`，只包含经过规范化的生物学世界规则。每个 `biological_types[]` 表示一个种族/生物类型，并通过 `sex_categories[]` 保存该种族自己的性别类别；每个性别类别独立保存 `capabilities` 与 `reproduction_rules`，不能把同一种族不同性别的能力合并。人类默认分别包含男性和女性，双性/间性只有在 AnalysisInput 明确出现实际身份、身体/生殖特征或世界规则证据时才加入；“双性化改造”本身不等于存在双性/间性类别。各项能力仍按证据独立保存，不确定时为 `null`。种族层的 `lifecycle`、`special_rules` 记录共通规则；旧 Chat 中尚未拆分性别的种族层 `capabilities` 与 `reproduction_rules` 只作为兼容数据读取。明确识别为人类时，人类各性别类别的规则分别记录常见排卵、受精、妊娠和产程过程/周期；明确非人类证据优先。顶层 `medical_context` 记录当前世界医疗条件、生育难易度和证据。`world_model_meta` 只保存最后分析/保存时间、保存方式和来源数量摘要。World Model 的分析输入正文只在当前页面内存中临时生成，不写入 Chat metadata。用户人物设定仍可用于通用 AnalysisInput 预览，但不作为 World Model 世界规则判断依据。

`chat_metadata.bioweave.settings.worldbooks` 只保存当前 Chat 的世界书来源选择：`mode` 与 `selected` 中的稳定子项标识。世界书条目使用 `{source_id, entry_id, enabled}`，角色卡字段使用 `{source_id, field_key, enabled}`。来源名称、宿主 file 内容、请求头和 token estimate 不持久化；选择也不等于最终 BioWeave Context 注入。

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

## Floor Level
`message.extra.bioweave` / `message.swipe_info[n].extra.bioweave`：Analysis、Events、Snapshot、Projections。

## 核心链
`Floor Version → BiologicalEvent → State Reducer → Current State → Snapshot → Projection → Context`。

用户编辑 Event 后，保存后的 Event 就是后续计算使用的数据；删除是真删除。Projection 不进入事实历史。

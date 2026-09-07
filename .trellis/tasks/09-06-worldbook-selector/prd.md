# BioWeave 世界书来源选择器

## Goal

修正“世界书来源”设置：读取当前 Chat 的角色卡和 SillyTavern 世界书，支持条目/字段级选择，并把最近剧情与外部记忆配置拆成独立设置。只做来源读取、选择和 Chat-local 保存，不进入 World Model 或分析业务。

## Scope

设置页分为三个轻量区块：

1. **世界书来源**：角色卡字段、世界书及世界书条目。
2. **最近剧情**：启用开关和最近楼数。
3. **外部记忆来源**：构画数据、Anima、柏宝书、数据库记忆的开关与检测状态。

UI 文案全部使用中文，不显示 `Character Card`、`Recent Story Context`、`SevenDaysCal Context` 或 `Worldbook` 作为分类名。

底层来源仍保留明确的 `source_type`：

- `character_card`
- `worldbook`
- `recent_story`
- `sevendayscal`

真正的世界书使用 SillyTavern 的稳定 `file_id` / `source_id`；显示名称不能作为 ID。世界书条目使用实际稳定 `uid` / `id` 或宿主条目 key，不能使用标题或内容。

## Data contract

来源目录只存在于当前 UI 内存，示意 DTO：

```js
{
  source_id: 'st-worldbook:<file_id>',
  source_type: 'worldbook',
  label: '显示名称',
  host_key: '<宿主读取键>',
  entries: [{entry_id: '<stable uid>', label: '条目名称', content: '内存正文', token_estimate: 12}],
  fields: [],
  scopes: ['global_worldbook']
}
```

角色卡使用稳定 `field_key`：

```js
{source_id: 'st-character-card:<stable card key>', field_key: 'description', enabled: true}
```

当前 Chat 只保存选择与独立设置，不保存 label、content、host key、token cache 或任何外部 API/Secret：

```js
settings.worldbooks = {
  mode: 'selected_only',
  selected: [
    {source_id: 'st-worldbook:book-a', entry_id: 'entry-1', enabled: true},
    {source_id: 'st-character-card:alice', field_key: 'description', enabled: true}
  ]
};
settings.recent_story = {enabled: true, floor_count: 20};
settings.external_memory = {
  sevendayscal: false,
  anima: false,
  baobaoshu: false,
  database_memory: false
};
```

## Requirements

### R1. 来源读取

- 通过 SillyTavern public context 和官方 `/api/worldinfo/list`、`/api/worldinfo/get` 读取可用世界书。
- 当前角色卡只显示两类用户可理解的来源：`description`（角色描述）和可展开的 `opening`（开场白）组。组内将当前主开场白 `first_mes` 和每条 `alternate_greetings` 分别作为独立字段；稳定 key 分别为 `opening:main` 和 `opening:alternate:<index>`，不得把 personality、scenario、metadata 或其它内部字段暴露给用户。
- 世界书按书展示，展开后按条目展示；每个条目独立 checkbox。
- 角色卡按字段展示；每个字段独立 checkbox。
- 角色卡与世界书是两个彼此独立的折叠区域。世界书再按实际来源 scope 分为“角色卡挂载世界书”和“全局世界书”。
- 每本世界书的父 checkbox 只根据 entry 选择派生 checked/unchecked/indeterminate，批量操作只写 entry selection，不保存 parent selection。
- 没有稳定条目标识的条目跳过，不用标题、内容或数组索引猜 ID。
- 最近剧情和外部记忆不进入世界书来源目录。

### R2. 搜索与选择

- 支持搜索、全选、全不选、刷新、已选数量、token estimate。
- 搜索同时覆盖世界书名称、条目名称和角色卡字段标签，但不改变选择状态。
- 选择项只保存 `source_id` + `entry_id` 或 `field_key` + `enabled`。

### R3. Chat-local 持久化

- 每个 Chat 使用自己的 `chat_metadata.bioweave.settings`。
- Chat A 选择 `WB1-entry1`、`WB2-entry3`；Chat B 选择 `WB3-entry2`；回到 A 必须只恢复 A 的两个选择。
- 相同角色的不同 Chat 仍然独立。
- 切换 Chat 后从当前 metadata 重新读取，不能依赖角色名或 UI 内存。
- 异步保存必须捕获并校验 `{chatId, epoch}`，不能把旧 Chat 结果写入新 Chat。

### R4. 独立设置

- “最近剧情”只显示启用和读取最近多少楼；不伪装成来源条目。
- “外部记忆来源”显示构画数据、Anima、柏宝书、数据库记忆四个中文选项。
- 已确认的公开能力可显示检测状态；未确认的数据库记忆显示不可用，不伪造实现。
- 本轮不接入 `context/builder.js`，不注入任何上下文。

## Non-goals

- World Model、Event Analyzer、Projection、History Scan。
- Prompt Pipeline、Tavern Context 注入、上下文压缩。
- 修改 SillyTavern 全局世界书选择器或原始世界书/角色卡。
- 读取 SevenDaysCal、Anima、柏宝书的私有 Store。
- 新 Provider、Repository、Registry 或其它大型架构抽象。
- 修改已验收的入口、documentElement 宿主、API/Secret、模型选择器和主题基础。

## Acceptance criteria

- [ ] UI 分类改为中文“世界书来源”，不混入最近剧情或外部记忆。
- [ ] 世界书可以展开到具体条目，每个条目可独立开关。
- [ ] 角色卡只显示“角色描述”和可展开的“开场白”组，主开场白与每条 alternate greeting 都可独立选择。
- [ ] 角色卡与世界书是独立折叠区域；世界书按角色卡挂载/全局来源分组。
- [ ] 每本世界书支持整本全选、全不选和部分选择时的半选状态，持久化仍只保存 entry selection。
- [ ] 使用稳定 source/entry/field ID，不使用名称作为唯一 ID。
- [ ] 搜索、全选、全不选、刷新、已选数量和 token estimate 正常。
- [ ] Chat A/B/A 回归恢复各自条目选择。
- [ ] 最近剧情独立显示楼数配置。
- [ ] 外部记忆独立显示四个来源；未知公开接口明确不可用。
- [ ] 不进入 World Model 或 Context builder，不改冻结基础设施。
- [ ] 现有测试和新增少量回归测试通过，随后停在真实 SillyTavern 验收。

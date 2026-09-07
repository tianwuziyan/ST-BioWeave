# 世界书来源技术设计

## 1. 变更边界

当前最小缺口在 `ai/worldbook.js` 的 source DTO、`storage/schema.js` 的 child selection 归一化、`ui/app.js` 的 Chat 配置读取/写入，以及 `ui/settings.js` 的来源分组和条目级 checkbox 展示。它们无法自然表达世界书条目、角色卡字段和独立设置，因此只在这些既有模块内扩展；不新增服务层或数据库。

不触碰已验收的入口、documentElement 宿主、API/Secret、模型选择器和主题基础；不修改 `context/builder.js`。

## 2. 来源 DTO

### Worldbook

```js
{
  source_id: 'st-worldbook:<file_id>',
  source_type: 'worldbook',
  kind: 'worldbook',
  label,
  host_key,
  available,
  entries: [{
    entry_id,
    label,
    content,
    token_estimate
  }],
  scopes
}
```

`entry_id` 优先取宿主条目的 `uid` / `id` / `entry_id`，缺失时才使用世界书数据对象的宿主 key；绝不从标题、comment、content 或显示名称生成。嵌入角色卡世界书使用当前卡稳定 key 加固定 `embedded-worldbook` 命名空间，条目仍取实际 `uid`/对象 key。

### Character card

```js
{
  source_id: 'st-character-card:<avatar-or-stable-key>',
  source_type: 'character_card',
  kind: 'context',
  label: '角色卡',
  fields: [{field_key, label, content, token_estimate}],
  available: true
}
```

角色卡字段只保留用户可理解的稳定 key：`description`、`opening:main` 和按原始顺序编号的 `opening:alternate:<index>`。`description` 对应“角色描述”；开场白以独立可展开分组显示，主开场白显示为“主开场白”，备用开场白显示为“开场白 2”等，不合并正文，也不显示内部卡片字段。

### 独立设置

最近剧情和外部记忆不加入 source catalog：

```js
settings.recent_story = {enabled: boolean, floor_count: integer};
settings.external_memory = {
  sevendayscal: boolean,
  anima: boolean,
  baobaoshu: boolean,
  database_memory: boolean
};
```

运行时外部提供者状态单独保存在 app 内存，不写 Chat：

```js
{key, label, available, status}
```

构画通过 public context/marker 检测；Anima 通过 TavernHelper 的公开世界书读取能力检测；柏宝书通过 `STBaiBaiBook.getInjectedHistory` 检测；数据库记忆保持 unavailable。

## 3. Chat-local 选择

```js
settings.worldbooks = {
  mode: 'selected_only',
  selected: [
    {source_id, entry_id, enabled: true},
    {source_id, field_key, enabled: true}
  ]
};
```

选择身份由 `source_id` 与 `entry_id` / `field_key` 组成。旧版本只有 source-level 选择时可以读取并保留为 legacy 项，但新 UI 只产生条目/字段级项；新保存不会把正文或标签写回 Chat。

`ui/app.js` 在进入设置或 Chat 变化后读取 `runtime.store.getChat(chatId)` 的当前快照。保存使用现有 `runtime.store.saveChat`，但在队列中为每次写入捕获 token，写入前后都 assert。Chat 变化会清空旧目录、序列和 presentation selection；重新打开设置时重新从新 Chat metadata 装载。

## 4. UI 事件与渲染

`ui/settings.js` 继续是纯 HTML renderer，`ui/app.js` 继续使用根节点集中事件委托：

- `data-bioweave-analysis-source` + `data-bioweave-analysis-entry`：切换某本书的某个条目；
- `data-bioweave-analysis-source` + `data-bioweave-analysis-field`：切换角色卡字段；
- `data-bioweave-recent-story-enabled` / `data-bioweave-recent-story-floor-count`：独立最近剧情设置；
- `data-bioweave-external-memory`：切换外部来源开关。

“角色卡”和“世界书”使用两个独立的 `details` 折叠区域。角色卡的“开场白”组和每本世界书也各自使用独立的 `details/summary` 展开控制；世界书的 `summary` 只包含不换行的 header 行，按展开按钮、父 checkbox、标题的顺序排列，元数据放在 header 外的独立纯文本行。父 checkbox 的点击由根事件委托取消 `summary` 默认展开行为，避免展开和选择互相触发。世界书 source 按 `scopes` 中是否包含 `character_worldbook` 分到角色卡挂载组，否则分到全局组；不根据显示名称猜测。每本书的父 checkbox 使用 `worldbookSelectionState(source, selected)` 派生状态，使用 `setWorldbookEntriesSelection` 批量修改 entry 选择，父项本身不进入 Chat DTO。开场白父 checkbox 使用 `characterOpeningSelectionState` 和 `setCharacterCardOpeningsSelection`，只批量修改各 greeting field selection。

世界书每本书使用轻量 `details/summary` 或等价的展开行；模型选择器的普通下拉交互保持冻结。搜索返回带过滤子项的临时视图，不改变完整目录和选择集合。

“世界书来源”只渲染角色卡和世界书；“最近剧情”和“外部记忆来源”是相邻但独立的设置卡。所有可见分类/按钮文案为中文。

## 5. 读取流程

1. `/api/worldinfo/list` 读取列表，使用 `file_id` 生成 source ID、`name` 只作 label。
2. 用 `context.loadWorldInfo(host_key)`，必要时用官方 `/api/worldinfo/get` 读取 entries。
3. 归一化 entry ID、field key 和内存 token estimate。
4. 从当前 Chat metadata 读取三类设置。
5. 交互只改变内存选择，保存只写最小 Chat DTO。

若角色卡已经提供 `extensions.world` 主世界书挂载，`character_book` 只作为 SillyTavern 的导入/备用数据，不再生成第二个“角色卡内嵌世界书”来源；没有主挂载时才保留真实的内嵌条目回退。世界书合并使用稳定 `host_key`/`file_id`，不按显示名称去重。

加载失败保留已有目录；新 Chat 只显示该 Chat 自己的选择。旧异步请求不能越过 token 写入或覆盖新 Chat。

## 6. 测试 seam

- `normalizeWorldbookEntries`：同标题不同 uid、缺失稳定 ID、token estimate。
- `normalizeCharacterCardFields`：常见和其它实际字段独立归一化。
- `normalizeWorldbookSettings`：entry/field selection 去重，保留稳定字段，拒绝正文。
- `createStore` / 动态 metadata adapter：Chat A 两个条目、Chat B 一个条目，返回 A 后精确恢复 A。
- `settingsPage`：中文“世界书来源”、可展开 entry/field checkbox、独立最近剧情/外部记忆，且不出现旧英文分类或 Context injection 文案混淆。

这些测试不启动新业务数据库，也不测试 World Model 或 Context 注入。

# 外部记忆来源公开接口审查

## 审查结论

本轮只把外部来源做成 Chat-local 配置和状态展示，不读取或注入外部记忆正文。

### 构画 / SevenDaysCal

SevenDaysCal 的 `business/axis/story-clock.js` 负责故事时间解析，主入口通过
SillyTavern 的公开 `context.setExtensionPrompt` 写入故事时间提示；同时它会从
消息中的 `SDC-start` / `SDC-end` 标记恢复可见故事时间。BioWeave 可以通过
`SillyTavern.getContext()` 的 `extensionPrompts` 和消息标记检测“构画数据”，不需要
读取 SevenDaysCal 的 `sp-store`。

### Anima

SevenDaysCal 的公开读取路径使用 `globalThis.TavernHelper`：

- `getChatWorldbookName('current')` 获取当前聊天关联的世界书；
- `getWorldbook(name)` 获取条目；
- 只把 `entry.extra.createdBy === 'anima_summary'` 且带 `extra.history` 的条目识别为
  Anima 摘要，再按条目内容中的唯一切片标记读取。

因此本轮只检测这两个公开 TavernHelper 能力并显示可用状态；不读取 Anima 的私有
模块、私有 Store 或内部响应式对象。

### 柏宝书

柏宝书公开文档提供只读全局 API `globalThis.STBaiBaiBook`，包括
`getInjectedHistory()`、`getSnapshot()` 等 DTO 读取方法，并提供
`st-baibai-book:ready` / `st-baibai-book:changed` 事件。

本轮只检测 `getInjectedHistory` 是否存在，保存开关，不调用 API，也不把返回 DTO
接入 BioWeave Context。

### 数据库记忆

SevenDaysCal 当前实现的“数据库”选项仍是其自身的处理逻辑：通过 TavernHelper 读取
指定世界书，再使用 SevenDaysCal 私有的 `isDatabaseMemoEntry` 规则筛选条目。没有
确认到可供 BioWeave 稳定依赖的独立公开数据库记忆 API。

所以本轮“数据库记忆”保留为可见但不可用的配置项，状态显示“未检测到公开接口”，
不伪造读取能力，也不直接读取任何私有 Store。

## 参考的一手源码

- [ST-SevenDaysCal/index.js](https://raw.githubusercontent.com/atonal519/ST-SevenDaysCal/master/index.js)
- [ST-SevenDaysCal/business/memory/database.js](https://raw.githubusercontent.com/atonal519/ST-SevenDaysCal/master/business/memory/database.js)
- [ST-SevenDaysCal/business/axis/story-clock.js](https://raw.githubusercontent.com/atonal519/ST-SevenDaysCal/master/business/axis/story-clock.js)
- [ST-BaiBai-Book/PUBLIC_API.md](https://github.com/baibai-git/ST-BaiBai-Book/blob/main/PUBLIC_API.md)

## 本轮边界

- “世界书来源”页面不显示最近剧情、构画数据或其它外部来源。
- 外部记忆开关只保存 Chat-local 的布尔配置和运行时可用状态，不参与
  `context/builder.js` 或任何 Prompt 注入。

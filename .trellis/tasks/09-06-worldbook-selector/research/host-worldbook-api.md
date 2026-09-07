# SillyTavern / SevenDaysCal 宿主边界研究

研究日期：2026-09-06。目标是为 BioWeave Worldbook 选择器确认公开、稳定且不泄露秘密的读取路径；本文件不是产品运行时依赖清单。

## SillyTavern 公开上下文

SillyTavern 扩展文档建议通过 `SillyTavern.getContext()` 获取扩展需要的宿主能力，并使用上下文提供的 Chat 元数据读写能力。官方 release 源码中的上下文对象包含 `characters`、`characterId`、`chatId`、`chat`、`chatMetadata`、`saveMetadata`、`getRequestHeaders`、`loadWorldInfo`、`getWorldInfoNames` 等字段，但没有直接公开完整的 `world_info` 私有 Store。

- [SillyTavern 扩展开发文档](https://docs.sillytavern.app/for-contributors/writing-extensions/)
- [官方 `st-context.js`](https://raw.githubusercontent.com/SillyTavern/SillyTavern/release/public/scripts/st-context.js)

结论：读取 BioWeave 的当前 Chat、角色卡和 Chat-local 配置时，每次操作重新取得当前 context；不缓存跨 Chat 的 `chat` 或 `chatMetadata` 对象，不 import SillyTavern 私有前端模块。

## 官方世界书列表与内容

官方 `world-info.js` 暴露 `getWorldInfoNames`、`loadWorldInfo` 和世界书 prompt 相关能力。服务端 `src/endpoints/worldinfo.js` 的 `POST /api/worldinfo/list` 返回世界书文件的 `file_id`、显示 `name` 与扩展信息；`POST /api/worldinfo/get` 按宿主键读取内容。

- [官方 `world-info.js`](https://raw.githubusercontent.com/SillyTavern/SillyTavern/release/public/scripts/world-info.js)
- [官方 `worldinfo` endpoint](https://github.com/SillyTavern/SillyTavern/blob/release/src/endpoints/worldinfo.js)

结论：

1. `file_id`/宿主文件键和显示 `name` 必须在 DTO 中分开。
2. BioWeave 的稳定 ID 使用命名空间，例如 `st-worldbook:<file_id>`，不能使用显示名称。
3. 读取请求通过当前 context 的 `getRequestHeaders()` 和宿主 `fetch` 能力发出；不引入新的 Provider 系统。
4. 已知的官方接口变化只能导致可说明的 unavailable/refresh error，不应回退到读取私有全局变量。

## 角色卡与角色世界书

官方世界书逻辑从当前角色的公开卡数据读取：内嵌书位于角色卡 `data.character_book`；角色主世界书位于 `data.extensions.world`。当前公开 `getContext()` 没有把内部 `world_info.charLore` 附属书列表作为稳定字段暴露出来。

结论：本任务支持公开可确认的 Character Card 和 Character Worldbook 主关联；不读取 `world_info.charLore` 或其他私有变量来制造“完整列表”。如果未来 SillyTavern 提供稳定公开能力，可以在已有来源读取函数中消费它，不建立复杂兼容层。

## SevenDaysCal / 构画

SevenDaysCal 的故事时间模块从当前消息中的 `SDC-start`/`SDC-end` 标记解析故事时间，并通过公开 `context.setExtensionPrompt` 注入扩展提示。其业务 Store 使用自己的 `sp-store`，并没有给 BioWeave 一个可依赖的公开 Worldbook/Context service。

- [SevenDaysCal `story-clock.js`](https://raw.githubusercontent.com/atonal519/ST-SevenDaysCal/master/business/axis/story-clock.js)
- [SevenDaysCal `index.js`](https://raw.githubusercontent.com/atonal519/ST-SevenDaysCal/master/index.js)
- [SevenDaysCal `store.js`](https://raw.githubusercontent.com/atonal519/ST-SevenDaysCal/master/store.js)

结论：BioWeave 只读取当前公开 context 中可见的 `extensionPrompts` 和最近 Chat 消息标记，使用固定虚拟来源 ID `seven-days-cal:context`；不读取 `sp-store`，不 import SevenDaysCal 私有模块，也不触碰其 API 设置或 Secret。

## 边界决定

世界书输入选择器与最终 BioWeave Context 注入分开：

```text
SillyTavern public context / official worldbook endpoint
  -> source catalog DTO (memory only)
  -> Chat-local selected source_id list
  -> settings UI only

Current State / compact events / projections / rules
  -> existing context/builder.js
  -> Tavern extension prompt (later task, not this task)
```

本任务不调用 `context.setExtensionPrompt`，不修改 `context/builder.js`，也不把来源正文写入 `chat_metadata.bioweave`。

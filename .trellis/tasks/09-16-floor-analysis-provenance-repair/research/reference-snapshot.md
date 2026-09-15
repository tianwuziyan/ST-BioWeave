# 参考项目：ST-SevenDaysCal `snapshot.js`

## 来源与版本

- 仓库：[atonal519/ST-SevenDaysCal](https://github.com/atonal519/ST-SevenDaysCal)
- 文件：[snapshot.js](https://github.com/atonal519/ST-SevenDaysCal/blob/master/snapshot.js)
- 本次审计读取的远端分支：`master`
- 读取时的远端 commit：`88954c08b74b66a35fc8dbc349f6abb2d20f6b6e`

## 对本任务有用的设计事实

参考实现把快照放在宿主消息的生命周期内，而不是建立一个独立的
chat-level 历史事实表：

- 普通消息的快照位于 `message.extra[gouhua_snapshot]`。
- 有结构化 swipe 的消息，持久所有者是
  `message.swipe_info[swipe_id].extra[gouhua_snapshot]`。
- active message-level `extra` 是宿主切换 active swipe 时使用的镜像；
  per-swipe 数据由适配层同步到对应槽位，业务读取依赖宿主当前 active
  消息语义。
- 因此删除消息或删除某个 swipe 会自然移除其快照；切换 swipe 只会看到
  当前槽位的结果。
- `message` 数组位置只用于定位当前消息，不应被当成跨删除仍稳定的外部
  Floor ID。

## 对 BioWeave 的适用边界

这份参考只证明“事实跟随宿主 message/swipe 生命周期”的存储方向；BioWeave
仍必须通过既有 Floor storage abstraction 读写，并继续用项目规范定义的六字段
Floor Version 和 Event `source` 做有效性校验。参考实现的镜像同步不能成为
BioWeave 业务代码直接写 `message.extra` 或 `swipe_info` 的理由。

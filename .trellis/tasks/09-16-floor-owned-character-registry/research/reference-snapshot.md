# 参考项目：ST-SevenDaysCal `snapshot.js`

## 来源与版本

- 仓库：[atonal519/ST-SevenDaysCal](https://github.com/atonal519/ST-SevenDaysCal)
- 文件：[snapshot.js](https://github.com/atonal519/ST-SevenDaysCal/blob/master/snapshot.js)
- 上一轮审计读取的 commit：`88954c08b74b66a35fc8dbc349f6abb2d20f6b6e`

## 对本轮的适用事实

参考实现把快照绑定在宿主消息的生命周期内，不建立独立的 Chat-level
历史事实表：

- 普通消息的结果位于 `message.extra[gouhua_snapshot]`。
- 结构化 Swipe 的结果位于
  `message.swipe_info[swipe_id].extra[gouhua_snapshot]`。
- active message-level `extra` 只是宿主切换 Swipe 时的镜像；真正需要跟随
  Swipe 生命周期的数据仍由对应的 per-Swipe 槽位拥有。
- 删除消息或 Swipe 会自然删除其快照；切换 Swipe 只读取当前槽位。
- 消息数组下标只能用于当前定位，不能成为删除后仍稳定的外部 Floor ID。

BioWeave 只复用这个 ownership 方向：canonical identity history 的累计
snapshot 也要写在 BioWeave 的现有 Floor/Swipe storage slot 内，并继续由
六字段 Floor Version 验证。参考实现的宿主镜像同步不能成为业务代码直接
读写 `message.extra` 或 `swipe_info` 的理由。

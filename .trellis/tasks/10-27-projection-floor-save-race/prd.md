# Projection Floor 写入竞态

## 目标

修复 Projection/Projection Timing 在同一 Floor 上与 SillyTavern 宿主
`saveChat()` 并发时的持久化竞态，确保 API 返回后的 Projection 快照能进入写入、
权威回读和 Runtime 读取链路。

## 已确认根因

- `ST-BioWeave-Debug-20261027-224121` 中 `PROGRESSION_PARSE` 已是
  `validated_snapshot`，不是 JSON 解析失败；Projection 在 AI 调用前停在宿主保存阶段。
- 原生 `saveChat()` 在约 `1010.2ms` 时被旧的 `1000ms` 等待上限判定为
  `FLOOR_HOST_SAVE_TIMEOUT`，因此本次 Projection 在进入 API / 写回 / readback 前就失败。
- 历史正常宿主保存耗时约 `4985–6328ms`，说明旧上限过短；这不是 Projection 数据格式或
  同 Floor 队列本身的失败。当前有界等待已调整为 `8000ms`，仍保留真正挂起时的失败关闭。
- 最新 `ST-BioWeave-Debug-20261027-225735` 表明仅提高上限仍不足：前一次 native save
  在 `8000ms` 超时后仍未 settle，后续事务立即重叠；后续 `saveChat()` 虽 resolved，
  权威 GET 仍返回旧 revision/旧 Floor slot，最终 `FLOOR_PERSISTENCE_READBACK_FAILED`，
  刷新后只能读到旧版本。

## 约束

- Projection owner 仍必须经过 FloorPersistenceCoordinator、当前 owner/Swipe/Floor
  Version guard、完整 sibling merge 和 authoritative readback。
- Projection/Projection Timing 与 World/Event 统一使用
  `floor_write_transport: "host_context"` 和宿主原生 `saveChat()`；超时或取消返回
  unknown/failed，不再切换 Projection 专用官方 API。当前有界等待为 8000ms，高于已观测
  的约 4985–6328ms 正常 Chat flush 延迟；真正挂起仍必须有界失败。
- 同一 Chat 的未完成 native save 必须进入保存屏障；后续写入必须等待其 settle 或在
  独立有界屏障等待后失败，禁止并发 native save。保存后的权威 readback 若仍为旧
  revision/slot，必须先重新校验当前 Chat、Character 消息、active Swipe 和四字段
  Floor Version，再执行一次有界收敛保存；校验失败立即失败关闭，之后才进行有界
  短退避重试。所有重试仍经过相同 owner/Floor/Swipe 校验。
- 不增加 Chat-level 事实源，不修改历史 Floor，不改变 Prompt 或业务状态机。

## 验收

- 宿主 `saveChat()` 永不返回时，Projection Floor 写入在有界等待后以 unknown/failed
  结束，并释放事务；不得发起 `/api/chats/save`。
- 宿主 `saveChat()` 正常快速返回时，不应发起整份聊天的 `/api/chats/save`。
- 现有 World/Event Context-first 原生保存测试保持通过。
- Debug 能看到 `floor_write_transport`、native save 超时/取消和后续 readback 状态；不记录
  正文或 raw API payload。

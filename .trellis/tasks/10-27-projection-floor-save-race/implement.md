# 实施记录

## 已完成

1. 为 `storage/projection.js` 与 `storage/projection-timing.js` 统一注入
   `floor_write_transport: "host_context"` 标记。
2. 在 `runtime/events.js` 统一使用宿主原生 `saveChat()`，保存等待支持 8000ms 有界超时和
   AbortSignal；超时/取消返回 unknown/failed，不再切换 Projection 专用官方 API。
3. 保留官方权威读取作为成功写入后的 readback，不把它作为 Projection 保存兜底写入。
4. 增加同 Chat native save 屏障：超时但仍未 settle 的保存会阻塞后续写入，禁止重叠
   `saveChat()`；增加保存后旧 revision/旧 slot 的有界 readback 短退避重试；收敛重试
   前再次校验当前 Chat、Character 消息、active Swipe 和四字段 Floor Version。
5. 增加 `tests/runtime.test.js` 回归测试，覆盖原生快速保存、宿主保存挂起后不发送
   `/api/chats/save`、取消、超时后屏障串行化，以及延迟权威 readback。
6. Chat reload/rebind 到达时，取消并排空绑定旧 Context 的 Projection/Storyline 请求，
   取消后的 Projection Context 恢复只读，避免加载完成通知与在途写回竞争同一 Chat。

## 验证结果

- `node --test tests/runtime.test.js`：43/43 通过。
- `node --test tests/projection-storyline.test.js`：54/54 通过。
- `npm run check`：1941 项，1925 通过，16 跳过，0 失败。
- `git diff --check`、相关 `node --check`：通过。

## 尚待真实宿主验收

- 需要在真实 SillyTavern 宿主中重新复现“API 返回后仍未读写”的 Projection/Storyline
  场景，确认正常原生保存、取消/超时后的终止状态，以及成功写入后的权威回读在宿主环境中的实际行为。

# P1 SillyTavern 宿主原生持久化能力验证

## Goal

验证当前实际 SillyTavern 宿主 Chat 原生保存接口的完成语义、并发控制、失败/未知结果及 Chat/Swipe 生命周期边界；只新增隔离测试和审计报告，不修改生产持久化逻辑。

## Requirements

- 优先定位并核验本机实际运行的 SillyTavern 源码、版本/commit 或可识别状态；无法确认时标记 `HOST_VERSION_UNVERIFIED`。
- 追踪 `saveChat()`、`saveChatDebounced()`、`/api/chats/save`、`/api/chats/get` 的前后端调用链，记录 Promise resolve、HTTP 响应、服务端文件处理、队列、锁、版本/CAS 及生命周期边界。
- 通过确定性 Promise barrier 隔离测试验证连续保存、不同字段并发、旧状态覆盖、Chat/Swipe/消息变化、失败、响应丢失、刷新/关闭和保存后立即读取等边界；不得修改真实 Chat。
- 调查 `/api/chats/get` 偶发秒级等待的已证实事实与未证实假设；没有宿主服务端耗时证据时不得归因。
- 将宿主能力与 BioWeave Floor Version、Swipe、epoch、历史不可变、Snapshot 继承、Sibling merge、Timing/Aggregation 部分成功和失败语义逐项对照。
- 在新的任务目录中提交 Markdown 审计报告，明确哪些能力可依赖、哪些必须由插件补足、哪些竞争条件仍无法解决，以及是否值得进入原型阶段。
- 仅新增审计测试/辅助模型和文档；不修改 Coordinator、Adapter、Runtime、业务规则或宿主源码。

## Acceptance Criteria

- [ ] 报告包含当前宿主版本证据或明确的 `HOST_VERSION_UNVERIFIED` 标记。
- [ ] 报告给出 save/get 前后端调用图、完成语义矩阵、并发/CAS 矩阵、生命周期风险和失败/`UNKNOWN_OUTCOME` 处理。
- [ ] 隔离测试使用确定性 barrier，不依赖固定延时，并标注 source/runtime/test 证据边界。
- [ ] 报告不把 Promise resolve、HTTP 200 或 native save 调用等同于权威 readback 确认。
- [ ] `npm run check` 通过且 `git diff --check` 通过；工作区已有修改和 Trellis 目录保持不变。
- [ ] 未实施任何生产持久化优化，报告完成后停止等待下一步确认。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.

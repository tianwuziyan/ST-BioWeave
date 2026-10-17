# 技术设计：当前 SillyTavern 宿主原生持久化能力验证

## 证据边界

本任务把证据分为：

- `SOURCE_VERIFIED`：本机实际 SillyTavern 源码或 BioWeave 当前源码直接支持。
- `ISOLATED_TEST_VERIFIED`：不写真实 Chat 的确定性测试模型支持。
- `HOST_RUNTIME_UNVERIFIED`：尚未在当前运行宿主或对应版本源码/实测中确认。
- `UNKNOWN`：现有证据不足，不能补充推断。

## 研究边界

先寻找当前安装的 SillyTavern 根目录、版本文件、Git 状态和启动日志；将实际路径、版本、commit 和源码快照写入研究笔记。若只找到其他版本或 GitHub 源码，必须在报告中降级为 `HOST_VERSION_UNVERIFIED`。

源码追踪顺序：

1. 宿主 Context 导出及 `saveChat` / `saveChatDebounced` 的定义、调用者和数据捕获时点。
2. 前端 `/api/chats/save` 请求构造及服务端 route/controller、文件读写、响应时点。
3. `/api/chats/get` 服务端读取、解析、锁/队列/缓存和响应时点。
4. Chat 切换、Swipe 切换、消息编辑/删除和宿主替换 Context 的事件路径。
5. BioWeave adapter 当前假设与上一轮审计报告的契约映射。

## 隔离测试 seam

测试只模拟已经从宿主源码确认的可观察边界：

- Context save 的 deferred Promise 和 debounce 合并。
- 服务端写入完成与响应丢失的分离。
- 同 Chat 队列、跨队列/直接 API 写入和 last-write-wins。
- Chat/Swipe/message/epoch token 在 save 前后变化。
- `message.extra` / `swipe_info` sibling 和其他扩展字段的覆盖。

测试模型必须把“调用已发出”“宿主接受”“服务端写入完成”“权威 readback 确认”分成不同状态，不得用理想化的单个 resolved Promise 代表全部状态。

## 非目标

- 不向生产 Adapter、Coordinator、Runtime 或宿主添加测试分支。
- 不修改真实 SillyTavern Chat/Floor 数据；若需要真实宿主写入，应在报告中列为需要用户单独授权的下一步。
- 不把隔离模型通过升级为当前宿主保证。

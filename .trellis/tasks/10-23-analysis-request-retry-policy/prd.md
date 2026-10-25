# 收紧分析阶段 API 重试分类

## Goal

避免人物重新分析在模型输出校验失败后原样重复发送 API 请求，仅保留请求层故障重试。

## Requirements

- `api_request_settings.retry_count` 只允许在一次 AI 请求已经失败结束后增加后续请求；任何两个 Stage attempt 不得并发。
- 只有请求层的暂时性故障可以消耗重试次数，包括本地请求超时、网络中断、临时服务端错误、限流、空响应或损坏的传输响应。
- 模型已经返回正文后发生的 Event/World 解析、Schema、领域、identity 或 evidence guard 校验失败必须直接结束当前分析，不得原样再次发送同一请求。
- AI 已成功返回后发生的 Floor persistence、readback、canonical/UI readiness 失败不得通过重新请求 AI 修复。
- 用户取消、插件禁用、Chat/Floor/Swipe/版本所有权变化、认证或配置错误继续失败关闭，不得重试。
- 手动人物重新分析、手动刷新和自动分析共用同一分类规则；不新增人物页专用旁路。
- 保留现有 `timeout` 与 `retry_count` 设置字段、取值和 UI，不增加重试等待时间配置。
- Debug trace 必须能区分可重试请求故障与不可重试的响应/业务阶段失败，并记录停止决定。

## Acceptance Criteria

- [x] `retry_count=1` 时，Event Schema/领域校验失败只调用一次 Event analyzer，并以失败结束。
- [x] `retry_count=1` 时，World 响应校验或 canonical readiness 失败只调用一次 World analyzer。
- [x] Event/World 请求超时等允许的请求故障仍可按配置追加一次请求，第二次只能在第一次失败后开始。
- [x] Event persistence/readback/canonical readiness 失败不再重新调用 AI。
- [x] 取消、stale owner 和不可用前置继续保持不可重试。
- [x] 既有 Floor/Swipe ownership、previous resolution、API assignment 与数据持久化位置不变。
- [x] 聚焦测试、完整检查和 `git diff --check` 通过；相关重试语义文档与最终实现一致。

## Notes

- 根因：共享 Stage classifier 将除少数硬失败以外的所有错误默认视为可重试，导致模型输出校验失败后再次发送完全相同的 Prompt。
- 本任务不改变 API Prompt、模型输出契约或 Floor persistence ownership。

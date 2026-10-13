# Technical design

## Boundary

AI Event DTO 与持久化 Domain Event 必须继续分层。持久化 Schema 不增加 continuation 字段。修复只允许发生在 AI response envelope/normalization seam，以及必要的 Runtime handoff；Runtime 仍负责 identity、Floor provenance、authoritative readback 和最终 canonical cleanup。

## Protocol decision

首选保持 Prompt 声明的固定 envelope：`{schema_version, events[]}`。解析器在 envelope 内严格读取 Event；若代码证据确认真实 provider 将单个 Event 对象错误地提升到响应顶层，则只增加一个显式、可判定的兼容转换：将“完整 Event 形状且不存在 envelope keys 的对象”包装为 `events: [object]`，随后仍走同一套 `validateRawEventShape()`。该兼容入口不得把任意 unknown object 变成合法响应，也不得接受顶层 `continuation_of_event_id` / `state_fact` 作为独立 envelope metadata。

如果真实响应实际是“顶层业务字段 + Event 字段混合”而无法无歧义判定，则不放宽校验；应把失败留给 provider/Prompt 协议修正，并报告需要扩大范围。这是安全停止条件。

## Continuation handoff

`parseEventAnalysisResponse()` 输出的 Event 中间对象可以保留显式 continuation metadata；`character-event-analysis.js` 继续在权威 current/visible existing events 上校验 reference 和兼容字段，合并时只写 canonical Event 字段并删除 metadata。测试必须断言 parsed intermediate 与 persisted output 两个边界，避免把临时字段误加入 Event Schema。

## Testing seam

使用现有 `createAnalyzer` + mock `ChatCompletionService.processRequest()`，让 mock 返回真实失败形状和合法 envelope 形状；断言 request 经过 analyzer parser，而不是直接调用 merge helper。Runtime fixture 继续使用现有 Floor 66 → 68 continuation 测试，并新增/复用保存后的 Snapshot 断言。

## Performance audit boundary

只读取 Debug trace 和代码。把 `CHARACTER_CANONICAL_BUILD_*` 与 `CHARACTER_UI_PERFORMANCE(operation=business-read)` 按 sequence 配对；把 `request_source=unknown` 视为未归因，而不是强行归给 refresh。说明 canonical timer 是包含 await 的 wall-clock，不能由 Debug 单独推出 CPU 长任务。下一阶段方案只提出“在同一首次打开初始化生命周期复用一次 authoritative business read/拆分非关键读取，并用 Chrome Performance Profile 验证”，不在本任务实施。

## Compatibility and rollback

新增兼容解析必须是局部、可删除的函数或分支；不得改动持久化 Schema 或既有 Runtime generation/in-flight 代码。失败时保持 strict rejection。若测试发现响应形状无法安全区分，撤回兼容分支并只修正协议文案/测试，不扩展 validator。

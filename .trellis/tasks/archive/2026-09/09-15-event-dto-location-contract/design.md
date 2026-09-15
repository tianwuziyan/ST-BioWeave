# Event DTO location contract 设计

## Boundary and data flow

```text
AI raw JSON
  -> ai/analyzer.js eventPayload / validateRawEventShape
  -> normalizeEventRecord(location: eventText)
  -> Runtime enriches event_id + authoritative source
  -> core/events.js validateEventCollection / normalizeEvent
  -> Floor save
  -> Chat save + rebuildTrackingRegistry
  -> Characters UI consumes tracking_subjects
```

`location` 的责任分配如下：

- Prompt 是模型输出契约的唯一说明处，要求模型只产生 `string | null`。
- Analyzer 是 AI boundary，继续只接受当前已实现的 `string | number | null` scalar；object/array 直接失败，不做 `{display}` 展开。
- Domain 是 canonical owner，`core/events.js` 继续使用 `nullableText()`，因此持久化 Event location 永远是 `string | null`。
- Runtime 只在 Analyzer 成功、Event collection 完整通过校验后保存新 Events；失败路径继续记录失败尝试而不替换旧成功 Events，也不重建出新 Registry。
- UI/Tracking 只消费成功保存的 `tracking_subjects`，不重新解析 raw AI response，也不负责补救 location 形状。

## Strict-vs-compatibility decision

选择 strict DTO。理由是当前 Event parser 已对 JSON envelope、未知字段、证据、participant 和 pregnancy collection 采用明确拒绝策略，`eventText()` 已是现有 scalar normalization seam；仅为一个未被定义的 object 形状新增兼容分支会模糊 Prompt contract，且没有必要改变 Core schema。保留 `number` 是现有 Analyzer scalar compatibility，不代表 Prompt 允许模型输出 number；Domain 已负责将数值文本 canonicalize 为 string。

## Test design

- `tests/event-analysis.test.js`：补充 Prompt contract 断言、两个字符串地点的双 subject parser 成功、`null` 合法和 object location strict rejection。
- `tests/event-analysis-runtime.test.js`：在既有多 Event Runtime 测试中锁定 `location_alpha`/`location_beta` 字符串和两个 subject/profile；新增或改造 raw API failure 测试，第二次返回两个 subject 但其中一个 location 为 object，验证 failed、旧 Event/Registry 保留。
- `tests/phase2a-ui.test.js`：只增加一个输入回归，传入两个 `trackingSubjects` 和对应 profiles，验证人物页面显示两个人；不改 `ui/` 源码。

## Safety and rollback

- 所有编辑限定在 `ai/prompts.js`、既有 Event/Runtime/UI 测试、必要的领域 spec 和本 task artifacts；先读取目标区块再小补丁。
- 保留 worktree 中与本任务无关的既有修改；不使用 reset/checkout/clean，不 commit，不 push。
- 若回归暴露 Runtime 或 Tracking 已有行为变化，只修复本轮新增测试与契约，不扩大到 eligibility、subject-local 模型或 UI 实现。

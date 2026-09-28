# Technical Design

## Boundary

本轮只增强 `ai/prompts.js` 中 Supplement request 的 semantic discovery contract，并在 `tests/world-model.test.js` 增加 prompt-level 与 generic fixture regression。`ai/analyzer.js`、`ai/world-supplement-protocol.js` 只在测试证明 request contract 必须同步时做最小文案/轻量字段调整；默认不改其行为。

## Four-layer responsibilities

| Layer | Responsibility | This task |
| --- | --- | --- |
| Discovery | 从完整 permitted evidence 找出 evidence-supported claims，并确定 scope/field | 重建为 Identity、Type、World 三个 pass |
| Serialization | 把已发现 claim 序列化为独立 Fact Delta blocks | 保持现有 root、Fact、Review grammar |
| Validation | parser、resolver、Evidence Guard、Coverage/Identity Review | 保持现有 per-Fact fail-soft 与 deterministic boundary |
| Persistence | Runtime/Floor-owned canonical save and UI projection | 完全冻结 |

## Request topology

当前 request 中 target/review queue 过于突出，模型容易先对 target 做局部搜索并提前发出 `NO_EVIDENCE`。调整为：

```text
System: Fact Delta + address/evidence rules
Permitted Evidence: complete evidence
Existing: complete canonical reference
Task: PASS 1 Identity -> PASS 2 Type matrix -> PASS 3 World pass
      -> internal claim inventory -> Existing comparison -> Fact serialization
Coverage Targets: completeness audit checklist after discovery task
Output Contract: independent Facts + Coverage Review + Identity Review
```

Retry/continuation 复用同一 base semantic contract，仅在末尾附加 bounded directive；不得变成只扫描失败 target 的简化请求。

## Semantic matrix

PASS 2 固定顺序为 Identity/Description、Capabilities、Reproduction、Lifecycle、Collections；每个字段独立搜索，缺少前一字段证据不能短路后续字段。PASS 3 对全部 permitted evidence 重新扫描，不使用“Type pass 已消费的证据”作为排除条件。

## Safety invariants

- Existing 只能作为 address/compare/search seed，永远不成为 evidence。
- World-scoped Facts 禁止 Species/Biological_Type；Type-scoped Facts 必须同时带二者。
- Identity 不授权 details；Species-level statement 不自动投射到 sibling Types。
- `NO_EVIDENCE` 只能表示完成完整 discovery 后仍没有足够合法 evidence。
- malformed Fact A 不影响 valid Fact B/C。

## Rollback / risk

实现仅限 prompt constants/order 和 tests，易于按文件局部回滚；前序未提交修改不得被恢复或重排。Prompt discovery 仍是 probabilistic，Evidence Guard 是 deterministic acceptance boundary；不能用提高 Fact 数量替代安全校验。

# World Model Supplement JSON Fact Delta Adapter

## 目标

将 World Model Supplement 的 LLM wire format 从自定义文本 Fact Delta 迁移为 JSON Fact Delta，同时保留当前 Host-owned semantic pipeline：

```text
JSON wire format
→ per-Fact validation
→ current Fact IR
→ current Resolver
→ current Evidence Guard
→ current Accepted Ops
→ current fixed point
→ current Runtime/Floor persistence
→ current UI projection
```

## 硬约束

- JSON 不是 canonical World Model、persistence schema 或 Patch V2。
- Root JSON validation 与 per-Fact validation 分层；一个 malformed Fact 不得丢弃 sibling valid Facts。
- 覆盖状态只能由 accepted Fact 推导；parser/resolver/Evidence Guard 拒绝的 matching Fact 不得算 `EMITTED` 或 `NO_EVIDENCE`。
- `NO_EVIDENCE` 只能来自模型显式 `no_evidence_target_ids`，且 accepted exact-address Fact 数必须为 0。
- Coverage 与 identity review 可独立失败；一方 malformed 不得破坏另一方合法数据。
- Supplement request 必须隔离 analyzer control、permitted evidence、Existing reference、Coverage Targets。
- JSON mode 是 capability enhancement；未知或不支持时必须使用 prompt-only JSON contract。
- 只允许 root JSON 无法恢复时触发一次 FORMAT_RETRY；单 Fact invalid 只本地 reject。
- 不恢复 Full JSON，不修改 Reproductive_Mechanism mapping/persistence 语义。
- 使用 generic fixtures：Species-A/B、Type-A/B；Biological_Type 保持 open string。

## 验收标准

1. `valid Fact A + invalid Fact B + valid Fact C` 解析后 A/C 保留，B 有 parser/validation diagnostic。
2. accepted Fact 才能参与 scalar/collection coverage accounting。
3. matching 但被 resolver 或 Evidence Guard 拒绝的 Fact 使 coverage 保持 incomplete/unresolved，并沿用现有 completeness retry。
4. 合法 Identity Review 不因 malformed Fact 丢失；合法 Facts 不因 malformed Identity Review 丢失。
5. 最终 API request message topology 中 analyzer control 为真实 system instruction，所有 permitted evidence 明确作为 data/evidence 包裹，Existing 与 Targets 不是 evidence。
6. 既有 Resolver、Evidence Guard、Patch V2、fixed point、persistence 和 UI 行为保持不变。
7. 自动化测试覆盖 parser、coverage、identity isolation、request topology、JSON mode fallback、FORMAT_RETRY separation。

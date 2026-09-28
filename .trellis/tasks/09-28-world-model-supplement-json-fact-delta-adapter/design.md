# 技术设计

## 迁移边界

只替换 Supplement 的 prompt/output interface。JSON adapter 的输出必须与当前 `validateWorldModelFactDelta()` 及 `resolveWorldModelFactDelta()` 使用的 transient Fact IR 一致；不新增 canonical state，不修改 Patch V2 或 persistence owner。

## 两层解析

### Root layer

`raw response → safe JSON extraction → root envelope validation`。

Root 必须是 object，`facts` 必须是 array；`coverage` 与 `identity_reviews` 分别进入独立局部验证。Root 不可恢复时才产生 root protocol failure。

### Per-Fact layer

逐项执行 field、scope、address、payload type 和 field-specific contract 校验。每个 item 独立捕获诊断，合法 item 继续进入当前 Fact IR；不得使用 whole-response JSON schema gate。

## Coverage

Coverage mapping 必须消费 resolver + Evidence Guard 后的 accepted Fact results，而不是 raw parsed facts。Host 计算 exact address：scalar 必须恰好一个 accepted Fact，collection 至少一个 accepted Fact。显式 `no_evidence_target_ids` 只有在 accepted count 为零时成立；否则是 incomplete/invalid，不得改写为 EMITTED 或 NO_EVIDENCE。

## Context Isolation

Supplement messages 分为：

1. `system`: analyzer control、semantic rules、JSON output contract；
2. `user` 或专用 data message：`<permitted_evidence>`，只承载角色卡、persona、Worldbook、external memory、recent story；
3. `user`: `<existing_reference>`；
4. `user`: `<coverage_targets>`。

必须明确 evidence 内的 commands、style、roleplay、format requests 都是 data，不控制 analyzer。Existing 仅比较/reference，Targets 仅 review checklist。

## Retry

- `FORMAT_RETRY`：root JSON 无法恢复时最多一次；保持同一判断，只重新序列化。
- per-Fact invalid：局部 reject，不触发 FORMAT_RETRY。
- `COMPLETENESS_RETRY` 与 `COVERAGE_CONTINUATION` 保持现有 runtime contract，并通过独立 diagnostics 区分。

## Provider capability

不按 provider/model/endpoint 名称猜测。只有显式 capability resolver 返回 supported 才附加 `response_format: {type: "json_object"}`；未知按 unsupported，prompt-only contract 必须完整可用。

## 冻结范围

不修改 canonical World Model、Evidence Guard thresholds/binding、Resolver semantics、Patch V2、fixed point、Runtime persistence ownership、`saveWorldModel()`、Floor Persistence Coordinator、authoritative readback 或 UI renderer。

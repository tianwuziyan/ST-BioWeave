# Technical Design

## Boundary

生产 semantic pipeline 继续使用现有 internal values；v3 migration 只在 diagnostics producer、allow-list/sanitizer、debug serializer、Debug UI 和相关测试/规范中改名或重塑。任何发现的 runtime semantic/persistence bug 单独记录，不在本 task 修复。

## Ownership model

- `execution_result`：整个 World execution 的最终结果。
- `fact_delta_result`：单次 Fact Delta/attempt 的分析结果。
- `persistence_requested`、`persistence_confirmed` 和 reconciliation telemetry：execution/persistence owner。
- `derived_target_accounting_records`：Host-local derived-target accounting records；数组顺序保留，记录索引使用能反映 producer 的名称，不宣称 semantic continuation。
- candidate diagnostics：validated canonical persistence candidate 的 transient diagnostics，不是 AI hierarchical Candidate。

## Compatibility

v3 使用新字段，不永久双写 v2 key。历史 audit/fixture 文档可以保留旧词并在报告中列出；current production/debug consumers 必须迁移。若存在不可迁移 external consumer，暂停删除并报告其 consumer 与移除条件。

## Safety

不修改 API message builder、retry loop、Fact acceptance、Patch V2、snapshot、Floor write 或 authoritative readback control flow。Schema mapping 必须通过现有 serializer/allow-list，不创建第二套 version source。

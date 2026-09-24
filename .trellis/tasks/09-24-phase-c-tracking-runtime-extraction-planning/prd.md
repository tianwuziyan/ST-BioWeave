# Phase C Tracking Runtime Extraction Planning

## Goal

以当前工作树真实代码为准，审计“根据当前 canonical Floor/Event/World 状态重建并刷新 Tracking runtime state”的完整调用图、数据来源、生命周期触发点和依赖边界，并提出不改变 Tracking semantics 的 extraction plan。

## Confirmed current facts

- Phase A `runtime/diagnostics.js` 与 Phase B `runtime/event-editing.js` 已存在于当前工作树；本 Phase 不修改它们。
- `core/tracking.js:514-630` 的 `rebuildTrackingRegistry` 是纯 Tracking Domain 算法，输入为 Events 与 provenance-checked World Model DTO，输出 `tracking_subjects`、`tracking_candidates`、`character_profiles`。
- `runtime/event-analysis.js:2078-2112` 的 `collectCurrentFloorStates` 负责遍历当前 Chat 的 Character message、active Swipe、Floor slot，并重新计算六字段 Floor Version；它是 general Floor traversal，不是 Tracking 专用输入读取器。
- `runtime/event-analysis.js:2283-2353` 的 `collectCurrentDerivedState` 同时完成 valid Floor filtering、Event aggregation、World Model resolution、Tracking rebuild、canonical character registry selection、Story Time、Snapshot restore / StateReducer 和 current-state DTO 组装，不能整体搬到 Tracking Runtime。
- `runtime/event-analysis.js:2355-2376` 的 `refreshTrackingRegistry` 串行化 refresh、调用 derived collection、发送 `TRACKING_REGISTRY_REFRESHED`，不写 Floor。
- `tracking_subjects`、`tracking_candidates`、`character_profiles` 在当前代码中没有独立 persisted Floor writer；它们是从当前有效 Floor Events/World Model 重建的 Runtime-derived projection。
- `character_registry` 是 Floor-owned canonical identity snapshot，不等同于 Tracking registry；刷新时从最近有效成功 Floor 的 `character_registry` 读取。
- `runtime/events.js` 仍是 Runtime facade；`ui/app.js` 通过 `collectActiveBusinessData()` 读取 Tracking DTO，并通过 `TRACKING_REGISTRY_REFRESHED` 等 Runtime events 触发业务刷新。

## Requirements

- 输出真实 Tracking Runtime call graph：canonical Floor → valid Events/World → Tracking Domain → Runtime registry → business DTO → Characters UI。
- 逐步审计 `refreshTrackingRegistry` 的输入、Floor/Swipe/Version guards、World/Event/registry reads、state/snapshot coupling、notification payload、error behavior 和并发串行化。
- 分别定义 Tracking Domain、Tracking Runtime、General Derived State 的当前 owner，不把 `collectCurrentDerivedState` 或 `collectCurrentFloorStates` 整体误归 Tracking。
- 分别审计三个 Tracking output 的 authoritative source，并区分 `character_registry` 与 Tracking registry。
- 记录 Event Editing、Event Analysis、World Analysis、lifecycle、clear、reload、init、Chat/Swipe/Floor mutation 对 Tracking refresh 的真实触发关系，保持现有调用时机不变。
- 提出 `runtime/tracking-runtime.js` 是否合理，以及最小 factory/API 和窄 capability/plain-data seam。
- 明确目标模块不得 import `runtime/event-analysis.js`、`runtime/event-editing.js`、`runtime/events.js`、Persistence coordinator 或 Generation lifecycle。
- 设计必须保留现有 UI Runtime API、`TRACKING_REGISTRY_REFRESHED` schema、Tracking eligibility、candidate/profile 语义和 Floor ownership 约束。
- 标出 extraction 风险、必须保持原文件的函数、所需回归测试和是否需要真实 ST/F5；本阶段只计划，不实施。

## Out of scope

- 修改任何 production code、tests、project docs 或 `runtime/diagnostics.js`。
- 修改 `runtime/event-editing.js`、World/Character/Event Analysis、Prompt/Input、Generation lifecycle、Persistence、Snapshot、Projection 或 Characters UI semantics。
- 修改 `core/tracking.js` 的 eligibility、candidate、pregnancy tracking 或 profile 语义。
- 引入 service framework、event bus、repository 或 speculative cache abstraction。
- 创建或修改新的 persisted tracking Floor fields。

## Acceptance Criteria

- [x] A-T：Current Tracking Runtime call graph 完整并有代码位置证据。
- [x] B-T：`refreshTrackingRegistry` execution trace 覆盖 17 个审计问题。
- [x] C-T：tracking_subjects / tracking_candidates / character_profiles / character_registry authoritative-source map 完成。
- [x] D-T：`collectCurrentDerivedState` 与 `collectCurrentFloorStates` 按 sub-block 拆分并标记 proposed owner。
- [x] E-T：business/UI data flow、Characters list source 和 refresh 回路完成。
- [x] F-T：Event Editing、Analysis、lifecycle trigger matrix 和 Persistence interaction 完成。
- [x] G-T：Snapshot/State boundary、shared helper dependency map 和 circular dependency analysis 完成。
- [x] H-T：提出最小 target module responsibility/API、old → target map、必须留在 `event-analysis.js` 的函数。
- [x] I-T：列出 regression tests、risk level、SAFE/NOT SAFE recommendation 与 FOLLOW-UP issues。
- [x] J-T：Phase C implementation completed without changing Tracking semantics, Persistence, lifecycle ordering, UI contracts, tests, project docs, or Diagnostics.

## Open questions

无 repository-answerable blocking question；如发现 Tracking Runtime 与 general derived state 没有足够窄的 seam，只能在报告中标为 `NOT SAFE TO EXTRACT YET`，不得通过改变语义解决。

## Requirements

- TBD

## Acceptance Criteria

- [ ] TBD

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.

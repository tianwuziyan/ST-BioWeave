# 评估 World Model Supplement Fact Delta Protocol

## Goal

只读审计当前 Supplement production path，设计 Fact Delta v1 grammar、映射、依赖规则与迁移方案，不实施代码变更

## Requirements

- TBD

## Acceptance Criteria

- [ ] TBD

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
# World Model Supplement Fact Delta Protocol 只读设计分析

## Goal

评估把 Supplement AI transport 从 hierarchical Complete Evidence-Supported
Candidate Tree 改为 self-contained Fact Delta Protocol，同时保持 Existing、
canonical World Model、Patch v2、Evidence Guard、merge、final consistency、
Floor/UI 与 Full Analysis 的既有边界。

## Scope and constraints

- 审计 AI prompt/analyzer/protocol、schema、canonical/merge、runtime path、tests
  与 World Model spec，并输出 grammar、Field vocabulary、payload、mapping、依赖、
  conflict、fail-closed、migration、tests、blockers。
- Existing 完整发送给 API，仅作 TARGET、comparison baseline、structure reference，
  不作 evidence；AI 完成 permitted-evidence Fact Discovery，runtime 转换为既有 Patch v2。
- 不修改 canonical schema；不新增 AI-facing Patch IR；omission 永远 preserve Existing，
  不表示 REMOVE；不讨论 system_top/system_bottom。
- 本轮只分析；不改生产代码、测试、spec/docs、Floor/UI，不 commit、不 push。
- 所有示例只用 Species-A/B、Type-A/B；Species/Type 是开放字符串，Field 是严格语义词汇。

## Confirmed facts and anchors

- Runtime Supplement path：`runtime/world-analysis.js:329-365`。
- Analyzer path：`ai/analyzer.js:4017-4059`，即 text → Candidate parser → Candidate
  validator → Candidate-to-Patch v2 → Evidence Guard。
- Existing formatter：`ai/world-supplement-protocol.js:142-199`；prompt：
  `ai/prompts.js:661-735,737-855`。
- Canonical schema：`storage/schema.js:7-68`；Patch v2 operation set：
  `ai/analyzer.js:2911-2944`。

## Acceptance criteria

1. 明确当前与目标 production path。
2. Fact 每条 self-contained，覆盖 canonical schema 所需 scalar、identity、collection、
   structured payload grammar 与严格 Field vocabulary。
3. 覆盖用户列出的 19 个场景和 A-K 约束。
4. 逐 outlet 判断 Patch v2 是否足够，并报告真实 unmappable correction outlet。
5. 给出 deterministic dependency/dedupe/conflict/fail-closed/migration/test 设计。
6. 形成后续 planning artifacts，但本轮不启动实现。

## Implementation authorization update

用户已明确批准实施本设计，并冻结以下约束：Supplement production path 切换后不得回退旧 hierarchical Candidate、不得 dual parse、不得长期 feature flag；Fact ordering 无语义，必须 parse-all → canonicalize → index → dependency → compare → Patch；v1 使用 whole-response transaction。Full Analysis、canonical schema、Patch v2 vocabulary/semantics、Guard、merge、final consistency、Floor/UI、Event/Character Analysis 与系统边界不变。

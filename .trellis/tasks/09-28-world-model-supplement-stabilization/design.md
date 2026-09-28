# World Model Supplement 稳定化方案

> Contract Baseline · Acceptance · Fixed Point · UI Projection

文档定位：这是后续 World Model 修复任务的约束基线。先确定事实、边界和验收标准，再实施代码修改，避免把 Full、Supplement、UI、Guard 和 Floor 问题混在一起。

## 1. 事实基线

- Full / 重新分析只是表现较好的只读对照，不是 canonical truth；本阶段不修改 Full 行为。
- Full 与 Supplement 最终都汇入同一 Canonical World Model v1；当前没有证据证明 persistence 层保存两套不同 JSON shape。
- Supplement 的 Fact Delta → Patch V2 mapping 与当前 canonical 路径总体对齐；不能把“数据显示少”简单归因于字段名迁移失败。
- 真实 Supplement 样本中 8 个 Fact 全部解析成功，但最终只有 1 个 accepted Fact / operation；主要损耗发生在 Resolver / Evidence Guard 之前或之中，而不是 UI renderer 之后。
- UI 已确认存在独立 projection 缺口：`species[].description`、`reproductive_mechanisms[]`、`projection_rules[]` 没有对应显示。
- Dynamic Coverage 存在语义/实现缺口：accepted new identity 可以产生新的 dynamic targets，但 coverage expansion round 仍为 0、`fixed point=false`，却可同时出现 `complete=true`。
- Candidate Adoption → exact ACK → Runtime persistence → existing Floor coordinator → authoritative readback → reconciliation 的架构保留，不重新设计。
- 当前测试基线不是全绿：phase2a candidate-adoption 场景存在 null species regression，必须在后续修复中恢复 0 failures。

## 2. 核心不变量

```text
AI / Full JSON 或 Supplement Fact Delta
        ↓ 各自分析协议
唯一 Canonical World Model v1
        ↓ Candidate Adoption
UI application state ACK
        ↓ Runtime saveWorldModel()
commitFloorPatch(owner="world")
        ↓ Floor Persistence Coordinator
authoritative readback / reconciliation
```

- UI 不直接写 Floor。
- Floor Persistence Coordinator 保持唯一普通 Floor 写入协调器。
- 不修改 coordinator owner whitelist 和 transaction key，除非有独立、可复现证据证明必须修改。
- `Biological_Type` 始终是开放字符串；不得硬编码二元性别、固定枚举或最小 Type 数量。
- Existing / Coverage Targets / prompt instructions 都不是事实证据。
- Evidence Guard 必须 fail-closed；禁止为了让数据显示更多而全局降低 threshold。
- Full 暂时只读，不因 Supplement 修复而顺手重构 Full。

## 3. 问题分层

| 层级 | 已知问题 | 本阶段处理 | 禁止误判 |
| --- | --- | --- | --- |
| Acceptance | `SCOPE_BINDING_FAILED`；部分 `VALUE_SUPPORT_FAILED` | P0 | 不能把 Guard rejection 当 UI bug |
| Completeness | dynamic targets 产生后未真正达到 fixed point | P0 | 不能把 review complete 当 fixed-point complete |
| Candidate/UI State | 现有 off-route/loading regression test 失败 | P0 | 不推翻现有 adoption 架构 |
| UI Projection | 3 类合法 canonical 字段未渲染 | P1 | 不是 stale path 就不要按字段改名处理 |
| Full / Legacy | 历史 compatibility surface 仍存在 | 后置 | Full 表现好不等于 Full 是标准答案 |

## 4. 分阶段实施方案

### Phase 0 — Baseline Freeze

- 记录 branch、HEAD、git status、当前测试基线和真实 runtime trace。
- 建立 canonical field inventory 与关键 contract fingerprint。
- 后续每一阶段开始前确认没有意外修改 Full、Floor coordinator 或其它非目标模块。
- 若事实与本方案冲突，先更新方案并说明证据，不得静默改变方向。

停止条件：基线无法复现、当前代码与审计报告明显不一致，或无法区分本地未提交修改与目标修改时，停止实施。

### Phase 1 — Supplement Acceptance：Scope Binding + Value Support

- 优先复现 `Type_Identity` 的 candidate evidence units > 0 但 `scoped_unit_count = 0` 的 `SCOPE_BINDING_FAILED`。
- 检查 evidence-unit builder 的 Species / Biological_Type provenance、父级上下文继承、canonical normalization 和 scope metadata。
- 只在明确证明 scope metadata 丢失/错绑时修复；不得扩大 permitted evidence 边界。
- `VALUE_SUPPORT_FAILED` 必须逐类审计：faithful support、过度组合、富化描述、world exception。正确拒绝保持拒绝；只有可证明的 false rejection 才修。
- Type identity support 与 Type description/value support 分离；identity 可接受而 description 仍可拒绝。
- 不修改 Full，不全局降低相似度阈值。

验收：generic fixture 能证明正确 scope 可绑定、错误 scope 仍 fail-closed、Existing 不被当 evidence、无 sibling/symmetry 推断；真实失败 trace 能解释每个 rejection boundary。

### Phase 2 — Dynamic Coverage Fixed Point

- accepted new Type 后重新计算 current coverage targets。
- 若产生新 target，则必须进入已有 bounded retry / continuation 架构，直到所有当前 target 已 disposition 且没有新 identity 继续产生未审 target。
- `complete=true` 必须与 fixed-point contract 一致；review accounting complete 不得替代 fixed-point complete。
- retry budget 耗尽时明确返回 incomplete，不得静默声称 complete。
- Target ID 在轮次间保持稳定；`NO_EVIDENCE` 只是 disposition，不是事实。
- 不要求任何 Species 至少存在 2 个 Biological Types。

验收：`dynamic_target_count > 0` 且 `fixed_point=false` 时不能产生最终 `complete=true`；下一轮补齐后才可达到 fixed point。

### Phase 3 — Candidate Adoption Regression Stabilization

- 调查当前 phase2a off-route/loading 测试中的 null species regression。
- 保留 candidate revision / fingerprint / exact ACK 架构。
- candidate adoption 不得被 generic `world_state_loading` gate 阻塞。
- stale Floor reload 不得覆盖更新的 candidate。
- duplicate ACK 必须幂等。
- 不修改 Floor transaction key，不把 UI state 塞入 Floor coordinator identity。

验收：candidate adoption 相关 targeted tests 全绿，随后 `npm run check` 必须 0 failures。

### Phase 4 — World UI Canonical Projection Completeness

- 单独补齐 `species[].description` 的 UI projection。
- 单独补齐 `biological_types[].reproductive_mechanisms[]` 的 UI projection。
- 单独补齐 `projection_rules[]` 的 UI projection。
- 建立 canonical-display coverage test：所有定义为用户可展示的 canonical 字段必须被 renderer 显式处理或显式声明 non-UI。
- 本阶段只消费 canonical model；不得为 UI 显示方便改变 canonical schema。

验收：canonical candidate 中存在上述字段时，ViewModel 保留且 renderer 可见；Floor shape 不发生改变。

### Phase 5 — Full / Legacy Cleanup（后置、需单独批准）

- 重新分析 / Full 继续作为只读对照。
- 旧 hierarchical Supplement parser、candidate adapter 等只有在确认无 production caller 后才考虑退役。
- 任何 Full 行为修改必须单独立项，不能夹带在 Supplement 稳定化任务中。
- compatibility cleanup 不得早于 P0/P1 稳定化。

## 5. 测试矩阵

| ID | 验收场景 |
| --- | --- |
| T1 | 正确 Species+Type scope 的新 Type identity 被 Guard 接受 |
| T2 | candidate units 存在但 scope 不匹配时仍 `SCOPE_BINDING_FAILED` |
| T3 | 无明确 scope 的自然语言证据仍 fail-closed |
| T4 | identity accepted，但 unsupported rich description 仍 rejected |
| T5 | Existing / Coverage Targets 不作为 evidence |
| T6 | 不做 sibling / symmetry / opposite inference |
| T7 | accepted new identity 创建 dynamic coverage targets |
| T8 | dynamic targets + `fixed_point=false` ⇒ final `complete=false` |
| T9 | 后续轮次 disposition 完整 ⇒ `fixed_point=true` |
| T10 | retry budget exhausted ⇒ incomplete / no false completeness |
| T11 | off-route candidate adoption 更新 application state |
| T12 | loading 不阻塞 candidate adoption |
| T13 | stale reload 不覆盖新 candidate |
| T14 | duplicate ACK 幂等 |
| T15 | 三个缺失 canonical UI projection 均可显示 |
| T16 | Floor coordinator / owner / sibling preservation regression 全绿 |

## 6. 修改边界

允许按证据修改：Supplement analyzer/protocol、evidence provenance/scope binding、runtime completeness/fixed-point、candidate-adoption bug 所在的最小 UI/runtime 范围、后续独立 UI renderer。

默认禁止修改：Full/重新分析行为、`storage/floor-persistence-coordinator.js`、`runtime/floor-persistence.js`、Floor owner whitelist、Floor transaction key、canonical schema（除非另行批准）。

Full / 重新分析继续定义为只读参考，不得改动。

## 7. 执行纪律

1. 每次只做一个 Phase；不得把后续 Phase 顺手带入。
2. 先复现、再定位、再修改；每个修改必须对应可失败的测试或真实 trace。
3. 最终报告区分 confirmed root cause、correct rejection、false rejection、hypothesis。
4. 任何方案外修改必须停止并请求批准。
5. 不得 commit / push，除非用户明确要求。
6. 每阶段结束运行 targeted tests、`npm run check`、`node --check`、`git diff --check`，并报告 git status。

## 8. 成功定义

最终目标不是“让 UI 看起来数据更多”，而是：

- 有证据支持的 Supplement Fact 能稳定进入唯一 canonical contract；
- 不受支持的 Fact 继续被正确拒绝；
- 新 identity 触发的 semantic coverage 真正达到 bounded fixed point；
- candidate adoption / persistence 无 race regression；
- 所有应展示 canonical 字段都有明确 UI projection；
- Full 与 Floor 基础架构不被无关改动破坏；
- 完整测试恢复 0 failures。

## 9. 后续 Codex 任务引用规则

后续所有 World Model Supplement 修复任务开头必须写：

> Read and follow the project stabilization plan first. Do not broaden scope beyond the current Phase. If runtime evidence contradicts the plan, stop and report the contradiction before changing architecture.

建议项目路径：`.trellis/tasks/09-28-world-model-supplement-stabilization/design.md`

## 10. Identity bootstrap 与 Debug observability 长期约束

`Type_Identity` 可以建立 Existing 中尚不存在的 Biological Type，但只有
permitted evidence 明确建立同一 Species 下稳定、命名明确的 Type 时才可
接受。候选文本命中、临时个体标签、Identity Discovery Review、Existing
和 Coverage Target 都不能替代该 evidence。Identity 接受后，响应内的
dependent Facts 才按既有 deterministic identity-first resolver 继续处理；
普通 Type detail 仍要求严格 Species + Biological_Type scope。

任何 World Model pipeline 修改都必须同时审计并在必要时更新 Runtime
diagnostics、Advanced Debug 的采集/渲染、diagnostics schema/version 与
回归测试。Advanced Debug 属于 runtime observability contract，不是临时
日志；必须 bounded、只读，不得写入 canonical/Floor，并明确区分当前
execution 与更早 execution 保留的 candidate。

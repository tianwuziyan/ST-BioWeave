# World Model Supplement 协议重构实施

## Goal

依据上传的《ST-BioWeave World Model Supplement 协议重构方案》，在当前分支 `fix/world-model-prompt-baseline` 的真实 HEAD 上完成 Supplement 从 AI-facing Patch v2 JSON 到层级标签 Candidate Text 的生产迁移。

## Source authority

上传 DOCX 是本次架构与协议的设计权威。旧对话、旧审计建议和历史设计不得覆盖文档中的最终约束。若文档假设与当前代码冲突，先核实代码事实；涉及 ownership、Floor、Evidence Guard、UI/storage 或 frozen Type Gate 的冲突必须停止扩大范围并报告。

## Requirements

- 协议必须保持 `Species → Biological Type → Details` 层级，不得扁平化。
- parser 必须只依据明确 opening/closing tags 与 parser stack/state machine 判断 ownership；缩进、最近出现节点、自然语言和隐式闭合不得参与语义。
- Species/Type identity 或父链不明确时 fail closed；不得跨 Species/Type re-parent。
- leaf 字段错误允许在明确 ownership 的最小 subtree 内局部拒绝并记录 diagnostics。
- Existing canonical World Model 必须继续发送给 Supplement AI，作为 TARGET、comparison baseline 和结构参考，但不得进入 evidenceUnits()。
- AI 输出层级 Candidate Text，不输出 Patch v2 operation、target、path、classification 或 JSON Patch DTO。
- Candidate 不经过会补齐 canonical `null`/`[]` 的 complete normalizer；field presence 保留 sparse semantics。
- Candidate omission 只表示 no claim / preserve Existing，永远不表示 false、null、不存在或 REMOVE。
- Candidate 只允许明确 boolean `true/false`；无证据字段省略；world-level unresolved proposition 使用 Unknown outlet。
- Candidate → internal Patch v2 由 deterministic translator 完成。
- Patch v2 保留为 internal deterministic mutation IR，继续复用现有 validation、classification、Evidence Guard、merge、projection identity、final consistency 和 strict canonical validation。
- 不新增 REMOVE，不新增 mechanism/exception/projection update，不降低 frozen Type Gate。
- Floor 只保存最终 complete canonical World Model JSON；Candidate、AI Text、Patch、diagnostics 不得进入 Floor.world_model。
- UI 只读取 canonical World Model；不得让 UI 直接消费 Candidate/Patch/diagnostics。
- Full、Event、Character、Pregnancy Tracking、Human baseline、system_top/system_bottom 不在迁移范围，行为必须保持不变。
- `.trellis/spec/domain/world-model.md` 与实现同批更新，移除与新架构冲突的旧 AI-facing Patch v2 normative contract，并补充 hierarchical protocol contract。
- 新测试只使用 `Species-A`、`Species-B`、`Type-A`、`Type-B` 等 generic fixture。
- 不 commit，不 push。

## Phases

1. Phase 1：更新 canonical World Model spec；冻结 grammar；实现 Existing formatter、hierarchical parser、Sparse Candidate validator、Candidate → Patch translator 与 generic tests。
2. Phase 2：替换 Supplement AI-facing Patch JSON prompt 为层级 Candidate Text；Existing 保留在 Supplement Target；Analyzer 解析文本并转换 internal Patch v2。
3. Phase 3：接入生产 Supplement Runtime；保持 canonical persistence/UI 与 Full/Event/Character/system boundaries；执行完整验证。

## Acceptance criteria

1. 层级 grammar、tag stack、ownership、leaf recovery 和 subtree fail-closed 规则均有实现与测试。
2. 缩进变化不影响解析；缺 parent、缺 Name、closing mismatch、跨 Species/Type 边界错误不会 re-parent。
3. Existing formatter 能稳定输出完整层级 Reference Text，一个 Species 可包含多个 Type。
4. Candidate omission 保留 Existing，且永不生成 REMOVE。
5. Candidate → Patch 覆盖现有八种 operation outlet；不新增 mechanism/exception/projection update。
6. same fact → NO-OP，unknown→known → ADD，known→different known → CHANGE candidate，并继续通过现有 Evidence Guard。
7. Candidate → Patch → Guard → Merge 输出完整 canonical World Model；失败时不污染 Floor/UI。
8. Existing 保留在 Supplement user Target，但不进入 evidenceUnits()。
9. Full/Event/Character/Pregnancy Tracking/Human baseline/system_top/system_bottom 行为不变。
10. 完成 focused World Model tests、full suite、node --check、git diff --check、fixture leakage audit、stale-comment audit，并报告实际 counts/results。

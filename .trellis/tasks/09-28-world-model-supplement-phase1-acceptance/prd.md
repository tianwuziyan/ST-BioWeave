# World Model Supplement Phase 1 Acceptance

## Goal

审计并最小修复 Supplement Evidence Scope Binding 与 Value Support；严格遵守 09-28 稳定化方案 Phase 1，不进入 Phase 2。

## Requirements

- 仅处理 Supplement Fact → parser → resolver → evidence provenance/scope binding → Evidence Guard → accepted operation。
- 先建立 generic evidence-unit provenance trace 和最小 generic reproduction，再决定是否存在 false rejection。
- 严格区分 `SCOPE_BINDING_FAILED`、`VALUE_SUPPORT_FAILED` 及其它实际 rejection boundary；Existing、Coverage Targets、Review 信息和 prompt instructions 不得作为 evidence。
- 只有有证据证明 valid permitted evidence 被错误拒绝时，才允许对 evidence-unit builder、scope/address normalization、resolver/Guard seam 或 diagnostics 做最小修改。
- 不修改 Full / 重新分析、Dynamic Coverage、Supplement completeness、Phase 3 candidate adoption、Phase 4 UI projection、Floor persistence、canonical schema、Evidence Guard 全局 threshold 或 permitted evidence boundary。
- 新增或修改的 generic fixture 仅使用 `Species-A`、`Species-B`、`Type-A`、`Type-B`、`Type-C`。

## Acceptance Criteria

- [x] 记录 branch、HEAD、既有未提交修改和 baseline tests，并确认 `fix/world-model-prompt-baseline`。
- [x] 找到实际 evidence-unit construction、candidate search、scope binding、value matching 和 Guard 函数，并记录 source/text/scope/parent/structured/normalization/provenance 语义。
- [x] 有 generic cases 覆盖 explicit scope、parent inheritance、wrong scope、candidate hit but scoped zero、Existing/Target-only support、identity/detail separation、faithful/embellished/world-scope value support、dependency 和 no sibling inference。
- [x] 明确 `SCOPE_BINDING_FAILED` 的结论为 `NOT CONFIRMED`：candidate-only hit + scoped zero 是错误 Species/Type scope 的正确 fail-closed 拒绝，未修改 matcher。
- [x] 明确 `VALUE_SUPPORT_FAILED` 的 correct rejection、false rejection、ambiguous 分类；本轮未发现 confirmed false rejection，因此未修改 Guard。
- [x] 验证 valid evidence 可通过且 wrong scope/unsupported value/Existing-only/Target-only/symmetry inference 仍拒绝。
- [x] Phase 2、Phase 3、Phase 4、Full、Floor、canonical schema 均无修改。
- [x] 运行 targeted tests、`npm run check`、相关 `node --check`、`git diff --check` 和 Trellis validation；没有新增 failure，当前全量测试通过。

## Audit result

- `SCOPE_BINDING_FAILED` confirmed root cause：`NOT CONFIRMED`。当前 evidence-unit builder 会把显式 Species/Type label 或结构化 parent headings 作为 transient scope provenance 保留到 unit 文本和 bounded debug `parent_context`；合法 `Species-B / Type-A` explicit/parent evidence 均通过。错误 Species/Type 的文本 token 可以进入 candidate search，但 exact scope filter 返回 0，这是预期拒绝，不是 false rejection。
- `VALUE_SUPPORT_FAILED`：identity/detail 分离、unscoped value、wrong sibling/type、unsupported capability、embellished/composite overclaim 和 world-scope overclaim 均保持正确拒绝；faithful generic capability/rule/world-scope controls 通过现有 contract。本轮没有证据证明 false rejection。
- 唯一代码变更是 `tests/world-model.test.js` 的 generic scope regression；没有产品代码修复。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.

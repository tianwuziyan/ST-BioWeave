# 技术设计

## 根因与责任边界

当前 Prompt 将 Human baseline 说成“当前资料支持普通人类背景后才能使用”，模型容易把显式 `Human/人类` 词当成必要条件。问题发生在语义 Contract，而不是 schema 缺少来源字段。

当前分析链：

```text
AnalysisInput
  → Prompt 语义判断基础来源与当前 delta
  → AI 输出当前 canonical species/type/field values
  → normalizeWorldModel（v1 schema）
  → applyWorldModelEvidenceGuard（现有证据范围）
  → applyWorldModelFinalConsistencyGuard（现有确定性一致性）
  → World Model
```

- Prompt 负责综合 Character Card、Worldbook、Recent Story、External Memory 和当前上下文，判断是否存在可靠的隐含 Human 默认背景，并把 delta 应用到最终字段。
- Analyzer 负责 canonical/schema、现有 Human Male/Female fallback、局部证据与确定性冲突 guard；不识别“某体系”在陌生世界中的语义。
- `storage/schema.js` 不增加来源或 inheritance 字段；“来源 Human 但当前 species label 已变化”只作为本次 AI 推理过程，不作为持久化关系。

## Prompt Contract 设计

将现有 Human 段落改成紧凑的 Baseline + Delta 语义：

1. **来源判断**：显式 Human 或完整上下文可靠支持普通 Human 默认背景时，才建立 Human baseline；无 species 不是充分条件。
2. **冲突排除**：明确独立 Nonhuman、陌生生命、明显不同身体结构/生理体系或无法判断时禁止 fallback；类人外形、称谓、行为和社会结构不足以授权。
3. **字段合成**：逐 capability、rule、lifecycle field 处理优先级；delta 只覆盖明确改变的字段，其余 baseline 字段保留。
4. **当前分类与来源分离**：路线/职业/身份/体系仍不能成为 biological_type；永久变化是否产生新 species 由资料语义决定，但不新增来源字段。
5. **现有 Contract 继续有效**：Human baseline 只能作用于已成立的普通 Human Male/Female；Human custom type、Nonhuman type、unknown、fertilization、gestation、maturation 规则不被放宽。

## Analyzer 审计结论

现有 `applyWorldModelEvidenceGuard()` 通过 canonical `species.name` 判定是否走 `sanitizeHumanType()`；`sanitizeHumanType()` 对 Male/Female 按字段使用 baseline，明确 field evidence 优先。没有转化词表，也没有从关键词把 species 判为 Human。

因此默认不改 Analyzer。AI 若将可靠隐含背景规范化为 `species = 人类`，现有 Human branch 可以继续应用 Male/Female baseline；若资料明确要求当前 label 是新 species，Prompt 必须直接输出 delta 后的当前字段，Analyzer 不应擅自把该新 label 改回 Human 或创建来源关系。只有当现有 `hasSpeciesSubtreeEvidence()` 等通用 gate 证明会误删合法的 AI 输出，才做最小、非物种特化的结构修正。

## 兼容性与风险

- 主要风险是 Prompt 过度放宽，导致“没有 species”被误判 Human。用“可靠默认背景 + 无冲突证据 + 非 Human 排除”三件套限制，并加入来源不明回归。
- 另一风险是把路线名称升级为 type。复用已完成的 biological_type Contract，不引入新分类轴。
- 新 schema 不需要迁移；旧 World Model、UI renderer 和下游消费者保持兼容。
- `docs/DATA-MODEL.md` 如修改，只同步 Human fallback 的正式语义，不增加新字段。

## 受保护工作区

实现前后保留当前未提交的 Analyzer/UI/CSS/Trellis 改动；检查时按 `git diff` 分离本任务主动改动与既有改动，不执行破坏性回滚。

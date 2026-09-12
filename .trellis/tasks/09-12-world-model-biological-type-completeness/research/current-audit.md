# biological_type 完整性与 Prompt 召回审计

## 审计范围

只读检查当前 `ai/prompts.js`、`ai/analyzer.js` 和
`tests/world-model.test.js`。本阶段没有修改产品代码。

## 1. Prompt 当前 Contract

`ai/prompts.js` 的 `WORLD_MODEL_CORE_INSTRUCTIONS` 当前把 biological type
定义为 species 内稳定的生理/生殖分类，并要求候选同时满足 A–E：

- 位于同一 species 内；
- 是稳定分类而不是一次性/条件状态；
- 直接涉及身体结构、生理机制、生殖角色或生殖能力；
- 删除职业、身份、社会、组织、能力体系、等级和成长阶段后仍成立；
- AnalysisInput 对该分类有“充分直接证据”。

同时要求证据不足时使用 `biological_types: []`，并在内部检查中确认单一候选
不是普通子类或其它分类轴。

问题不在于 A–E 本身，而在于当前文字没有给“充分直接证据”定义召回范围：
模型可能只把直接出现 canonical label 当成证据，把“多数/少数/罕见/例外/也存在/
除……外”等确定性低推理语义当成背景修饰，从而只输出主要 type。

当前内部自检验证候选是否应该成立，但没有要求在每个 species 的列表完成后，
反向扫描 AnalysisInput，检查是否有已表达但未输出的稳定 type。

## 2. 历史边界冲突

早期 biological type evidence 设计正确地写过“absent types are not filled for
completeness”，用于禁止从一个已知 type 猜测其它 type。该边界本身不能删除。

本任务需要把它拆成两个互不冲突的判断：

```text
无输入证据的缺失 type       -> 不补
输入已明确表达但模型漏掉的 type -> 必须补回
```

因此 `空数组优于错误分类` 应改为“空数组优于无证据猜测，但遗漏已被输入明确
证明的稳定 type 也是错误”，而不是放宽为完整性优先。

## 3. Analyzer 当前证据路径

`ai/analyzer.js` 的主要路径为：

```text
parseWorldModelResponse()
  -> normalizeWorldModel()
  -> applyWorldModelEvidenceGuard()
       -> hasTypeSubtreeEvidence()
  -> applyWorldModelFinalConsistencyGuard()
```

`hasTypeSubtreeEvidence()` 当前检查：

1. `biological_type.name` 在 evidence unit 中的通用直接标签证据；
2. parent species 与 type 的 scoped 关系；
3. type description 的直接文本证据；
4. reproduction rule / lifecycle / special rule 的直接证据；
5. type-local capability、rule、lifecycle 的既有 evidence patterns。

`hasGenericScopedTypeEvidence()` 已包含通用关系词，包括“基本、主要、多数、少数、
极少、少量、大多、通常、存在、包括、分为”等。由此目前没有证据表明 Analyzer
按“主要类型”主动截断 biological_types。

仍存在一个需要回归确认的边界：如果 AI 输出的 type name 是输入称呼的规范化表达，
且 type description/rule 也没有能直接回指原文的片段，`hasTypeSubtreeEvidence()`
可能把它当作无绑定证据而删除。该情况必须通过 Raw 与 Canonical 对照测试区分，
不能直接放宽 Evidence Gate。

## 4. 根因假设与验证顺序

优先级从高到低：

1. Prompt 没有把低推理数量/例外语义声明为 type existence evidence，AI Raw 已
   只输出主要 type；
2. Prompt 没有 completeness check，AI 在完成列表后没有回扫遗漏候选；
3. AI Raw 已包含少数 type，但 Analyzer 因 canonical name 与原文不逐字相同而
   删除；
4. 当前 type 候选本身属于其它分类轴，删除是正确的 Contract 行为。

验证必须记录 Raw、normalized 和 canonical 三个阶段；只看最终 UI 无法区分 1–3。

## 5. 抽象回归设计

测试 fixture 使用新名称，不进入生产代码或 Prompt：

- `绯环族绝大多数属于曜型，仅极少暮型个体。`：两种稳定 type 都有独立
  数量/例外证据；若 Raw 已返回两者，Canonical 必须保留两者。
- `某 species 通常为 A，另有少量 B。`：验证“通常 + 另有”并不只保留 A。
- 只有 A 的输入，Raw 故意返回 A+B：B 没有自己的证据，必须被拒绝，证明
  completeness check 不是成对补全。
- 输入只用派生/代称描述 type，但 AnalysisInput 明确建立稳定生理分类：用于
  诊断 canonical name 的局部绑定是否会误删；该测试只观察现状，不预先规定
  Analyzer 必须改动。
- type 成立但 capability/rule/lifecycle 都未知：type 保留，字段仍为 `null`。

另保留既有“职业/身份/阶段/临时状态/parent species 重述”拒绝回归。

## 6. 规划阶段结论

默认实现范围为 `ai/prompts.js` 与 `tests/world-model.test.js`。只有第 5 节的
Raw/Canonical 回归证明存在通用误删时，才将 `ai/analyzer.js` 纳入最小修正；不新增
词典、alias、registry、species mapping 或具体世界知识。

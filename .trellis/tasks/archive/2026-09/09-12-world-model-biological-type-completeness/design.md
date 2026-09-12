# biological_type 完整性与 Prompt 证据召回设计

## 1. 目标与职责边界

本任务只修正 World Model Prompt 对已被 AnalysisInput 明确证明存在的少数/例外
biological type 的召回 Contract。Prompt 负责自然语言语义理解；Analyzer 继续负责
结构规范化、AnalysisInput 证据边界和确定性校验。

不改变 World Model v1：

```text
species[]
  -> biological_types[]
      -> capabilities
      -> reproduction_rules
      -> lifecycle
      -> special_rules
```

## 2. Prompt Contract 设计

在现有 `WORLD_MODEL_CORE_INSTRUCTIONS` 中合并规则，不追加相互重复的长反例。

### 2.1 Evidence 召回定义

将“充分直接证据”改为两类合法 evidence：

1. 直接证据：输入明确写出 type、分类、性别/生殖角色或稳定生理差异；
2. 确定性低推理证据：输入通过数量、频率、对比、例外或并存结构，明确指出
   一个稳定分类存在，例如“多数/少数/极少/罕见/通常/也存在/除……外”。

低推理表达只负责证明该候选存在，不负责推导 capability 或其它字段。
“罕见”必须修饰一个可识别的类别；没有可识别类别时仍不能发明 type 名称。

### 2.2 独立证据与 canonical 名称

模型应为每个候选记录自己的 evidence。输入不必逐字使用最终 canonical name；
如果派生称谓、指代或同一语句结构可以唯一回指到稳定分类，可使用简洁、忠实的
规范化名称。若无法唯一回指，则不能创建该 type。

这允许召回少数 type，但不放宽 species/type、职业/身份/阶段/临时状态边界。

### 2.3 Per-species completeness check

输出每个 species 的 `biological_types` 前，模型内部执行：

```text
扫描 AnalysisInput 中该 species 的直接与低推理分类表达
  -> 列出每个被明确指向的稳定生理/生殖候选
  -> 与当前 biological_types 对照
  -> 对遗漏候选重新执行 A–E
  -> 通过才加入；不通过保持 []/不加入
```

该步骤是遗漏保护，不是“常见类型列表补全”。不能因为已经有一个 type、
数量分布看起来像二分体系、或模型常识认为存在配对 type，就新增候选。

### 2.4 Field isolation

补回一个少数 type 后：

- 不自动创建其它 type；
- 不复制 sibling type 的 capabilities/rules/lifecycle；
- 各字段仍按既有证据独立写 `true / false / null` 或规则三态；
- Human baseline 规则保持现状；
- Nonhuman 没有字段证据时保持 `null`。

## 3. Analyzer 诊断与条件性范围

先不改 Analyzer。使用测试桩返回受控 Raw model，并分别保存：

- Raw AI response；
- `parseWorldModelResponse()` / normalize 结果；
- `applyWorldModelEvidenceGuard()` 后结果。

如果 Raw 已包含有稳定分类证据的陌生 type，而 canonical 为空，才定位
`hasTypeSubtreeEvidence()` 的具体误删条件。允许的后续修正只能是通用、确定、
可解释的证据绑定改动；不得新增具体 type 名称、关键词表、alias、registry 或
完整性 whitelist。

如果 Raw 本身已经遗漏 type，Analyzer 不应修改；该问题由 Prompt Contract 和
后续真实黑盒验证承担。

## 4. 测试边界

测试分为三层：

1. Prompt contract string tests：确认新定义和 completeness check 存在，并确认
   不出现具体世界观教学示例。
2. Canonical pipeline tests：用原创 Raw model 区分保留/删除，验证 analyzer
   不把未知字段误变成 type existence，也不误删有绑定证据的陌生 type。
3. 既有回归：继续覆盖空数组、单一候选、临时状态、非生物分类轴、Nonhuman
   field-local null、Human baseline、fertilization 和 lifecycle。

单元测试不能证明模型在真实调用中一定召回；真实黑盒仅作为补充，不写入生产
逻辑，也不把具体角色卡名称写入 Prompt。

## 5. 兼容性与回滚

- schema、AnalysisInput、存储、UI、Event、State、Projection、Runtime 不变。
- 首选只变更 `ai/prompts.js` 和 `tests/world-model.test.js`。
- 若后处理误删被证明，再单独提交最小 Analyzer 变更；Prompt-only 方案保持可
  独立回滚。
- 未得到 implementation approval 前不运行 `task.py start`，不修改产品代码。

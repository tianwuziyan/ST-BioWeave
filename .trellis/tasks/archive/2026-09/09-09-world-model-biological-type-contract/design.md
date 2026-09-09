# 技术设计

## 当前行为缺口

当前 `ai/prompts.js` 已定义 species/type 分层、稳定性、临时状态、局部 evidence 和 Human/Nonhuman 边界，但把 biological type 的定义压缩成一条较宽的允许描述，缺少一组必须同时满足的成立条件和完整的非生物分类排除清单。模型因此可能把“species 的某类成员”误当成 biological type。

当前工作区的 `ai/analyzer.js` 有未提交的通用证据范围改动，不能回滚。它不是本任务新增逻辑的基线；本任务优先只改变 Prompt Contract，避免再次把 Analyzer 变成陌生世界观的中文分类器。

## 数据流与责任边界

```text
AnalysisInput
  → World Model Prompt（定义分类语义和证据规则）
  → AI JSON
  → schema normalization（固定 v1 结构、去除未知 key）
  → existing generic evidence/final guards
  → canonical World Model
  → shared World UI renderer
```

- Prompt 负责理解概念在当前资料中的语义，并对每个候选 type 做稳定生物分类判断。
- Analyzer 负责 JSON/schema、nullable 值、现有 Human baseline、局部证据边界和确定性 consistency guard；不根据具体名称猜世界观。
- `storage/schema.js` 继续是唯一五 capability 结构定义；本轮不添加字段。
- UI、Event、State、Projection 没有本轮需要的接口变化。

## Prompt Contract 方案

把现有核心指令中的 biological type 规则收敛为四段信息，而不是继续追加反例：

1. 定义：species 是生物层级；type 是同一 species 内稳定且直接对应生理/生殖差异的分类轴，不是普通 taxonomy subtype。
2. 成立条件：同 species、稳定、直接生物学差异、删除社会/职业/身份/能力/等级/阶段背景后仍成立、AnalysisInput 有充分证据；五项必须全部满足。
3. 排除与未知：列出其它分类轴；信息不足使用 `[]`；单候选不能放宽门槛；临时/可逆/条件变化留在既有 type 的规则/例外中。
4. 内部检查：逐候选执行 A–E 检查，同时复核非 null capability、fertilization 和 lifecycle；只输出最终 JSON。

保留并合并现有 capability、Human、Nonhuman、fertilization 和 lifecycle 语义；不在 Prompt 中使用任何具体世界观名词或教学例子。

## 测试设计

- Prompt 测试检查成立条件、排除轴、单候选规则、A–E 自检、空数组和既有字段语义，同时检查生产 Prompt 不含具体世界知识。
- Analyzer 回归使用新的原创名称，验证现有通用 parent/type 重复、临时状态、非受精行为、Nonhuman capability null 和固定稳定分类路径。
- 不用测试名称在生产实现中建立词典；污染保护只检查生产文件的具体专用词和 registry 形态。

## 受保护的已有改动

当前 `ai/analyzer.js`、`tests/world-model.test.js`、`ui/world.js`、`style.css` 以及 `.trellis` 文件已有未提交改动。实现时按 diff 精确落 patch，不执行 reset、checkout、清理或整体格式化。测试文件中已有一处 `assert.doesNotMatch(dualHtml, /双性\/);` 的未闭合正则，若仍存在，只修为等价的合法断言。

# World Model 三态语义与 Human baseline 审计记录

日期：2026-09-09

本记录只保存当前分支的规划审计结论，不是产品实现。

## 读取范围

- ai/prompts.js
- ai/analyzer.js
- storage/schema.js
- ui/world.js
- ui/app.js
- tests/world-model.test.js
- docs/DATA-MODEL.md

## 结构与消费者

storage/schema.js 的 WORLD_MODEL_SCHEMA v1 已将 reproduction_rules 的六个字段和 lifecycle 的两个字段定义为 string 或 null；五个 capability 仍是 boolean 或 null。没有必要新增 absence_reason、known_absent 或 status enum。

ui/app.js 在加载 Chat、手动保存 section、AI 分析保存三个路径调用 normalizeWorldModel()。ui/world.js 通过统一的 renderPropertyRows()/displayText() 展示规则值：null 显示“未知”，非空字符串原样显示。因此 "无" 可以由现有 renderer 直接显示，当前没有 UI 层丢失三态的证据。

Event、State、Projection 和 Runtime 中没有发现读取 reproduction_rules 或五个 capability 的业务消费者；本任务不应借机修改这些模块。

## 当前实现证据

### Prompt

ai/prompts.js 当前已经定义 species/type 分层、Human baseline + delta、Nonhuman evidence gate、fertilization/maturation/gestation 语义边界。但 WORLD_MODEL_OUTPUT_CONTRACT 仍使用“未知标量为 null”的宽泛表达，没有定义已知 absence 的 canonical value，因此需要补充三态 contract 而不是继续堆叠世界观示例。

### Analyzer

- nullableText() 将 undefined/null、空字符串和 unknown/null/未知/不确定归一为 null；任意其它非空字符串（包括 "无"）会被保留。
- normalizeBiologicalType() 当前用 localizedWorldModelText() 处理规则字段，没有固定 absence value 的归一化。
- humanBaseline('男性') 当前将 fertilization 保留为施受精描述，但 pregnancy_or_carrying、cycle、ovulation、gestation、labor 都是 null。
- humanBaseline('女性') 当前已有非空的 fertilization、pregnancy_or_carrying、cycle、ovulation、gestation、labor。
- sanitizeHumanType() 只在 isHumanSpeciesName() 成功时使用 Male/Female baseline；因此 Human species alias 没有 canonicalize 时，Female 也会走 Nonhuman path 并保留 null。
- applyWorldModelFinalConsistencyGuard() 当前在 can_produce_ova === false 或 can_carry_pregnancy === false 时把关联规则清成 null；fertilization 机制检查也没有把 "无" 当作合法 absence。
- normalizeSpecies() 当前只转换名称，不合并 species。localizedWorldModelText() 将 Human 替换为“人类”，但“人类 (Human)”会变成“人类 (人类)”；HUMAN_SPECIES_NAMES 也不能识别这一结果。

## 黑盒复现

使用 createAnalyzer() 的现有测试 fake generateRaw 返回两个 entry：

- name = Human，type = 男性
- name = 人类 (Human)，type = 女性

AnalysisInput 为“Human 世界明确存在男性和女性。”

当前输出包含两个 species：

- 人类 → 男性，使用 Male baseline，但四个已知不适用规则仍是 null；
- 人类 (人类) → 女性，五个 capability 和 reproduction rules 均为 null。

这同时证明：

1. Female baseline 文本本身存在；
2. alias/canonicalization 失败会使 Female 无法进入 Human branch；
3. normalizeWorldModel() 当前没有合并重复 Human species；
4. Male 的 null 主要是 baseline 定义和 final guard 语义问题，不是 UI 显示问题。

## 计划边界

推荐最小修改为 ai/prompts.js、ai/analyzer.js、tests/world-model.test.js、docs/DATA-MODEL.md。storage/schema.js、ui/world.js、ui/app.js、Event/State/Projection/Runtime 不需要修改，除非实现阶段出现与本审计相反的直接证据。

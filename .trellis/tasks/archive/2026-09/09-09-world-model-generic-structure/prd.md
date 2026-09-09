# 重做通用 World Model 结构与证据边界

## Goal

撤回上一轮基于错误架构判断的 World Model 代码变更，从其父提交恢复干净基线，再让 BioWeave 仅根据当前 `AnalysisInput` 分析任意 species 的统一生物结构。Human Male/Female 仍可使用现实生物 baseline，但 Human 与所有其它 species 必须共享同一套 v1 数据结构。

## Confirmed facts

- 上一轮实际代码提交为 `09b9b86`；本轮必须先撤回该提交的代码/测试/spec 修改，不在其结果上继续叠加补丁。
- 当前 v1 capability 只有五个三态字段：`can_produce_sperm`、`can_produce_ova`、`can_be_fertilized`、`can_fertilize`、`can_carry_pregnancy`。
- `ai/analyzer.js`、`ai/prompts.js`、`ui/world.js` 和 `storage/schema.js` 共同维护这个固定结构；Event、State、Projection、Context 当前不读取具体 capability。
- 当前没有 `lactation`、`regeneration`、`shapeshifting` 的正式结构化消费者，因此本轮不增加猜测性 capability 字段。
- `ui/world.js` 已经使用统一的 species/type map renderer；Human 消失的主要风险在 Analyzer 的证据过滤层。

## Requirements

### R1. 恢复并重做生产代码边界

- 先用精确的 `09b9b86` 反向变更恢复上一轮代码/测试/spec 基线，再进行本轮实现。
- 生产 Prompt、Analyzer、正则和分支不得包含具体幻想 species/type、别名、registry、ontology 或世界专属 physiology。
- 不得通过新建词典、黑名单或另一批具体物种名称绕过该约束。

### R2. 保持统一 World Model v1 schema

- 保持 `species[] → biological_types[] → capabilities / reproduction_rules / lifecycle / special_rules`。
- 保持开放字符串 species/type 名称，不建立 species/type enum。
- 保持固定五个 capability key 和 true/false/null 三态；模型返回的 schema 外 capability 或字段必须被丢弃。
- `lactation`、`regeneration`、`shapeshifting` 暂不进入正式 capability；没有下游消费者的稳定机制继续放在规则或特殊规则文本中。

### R3. 重新划分 Prompt 与 Analyzer 职责

- Prompt 只定义任意世界的通用提取任务：species/type 分层、局部证据、未知为 null、Human baseline 边界、非人类不套 Human template、真实受精语义和严格输出结构。
- Prompt 不提供任何具体幻想物种正例/反例。
- Analyzer 保留 JSON/schema normalization、开放名称、Human 名称本地化、通用 male/female 与生殖证据 guard、Human Male/Female baseline、父子同名检查和最终一致性 guard。
- Analyzer 不再理解具体幻想世界，不再把自己扩展为中文世界观 NLP 引擎。
- 非人类 capability/rule/lifecycle/special_rule 仅接受当前 species + biological_type 的直接证据；唯一 type 不得吸收 species-level 证据；不同 species/type 不互相授权。
- `fertilization` 仅表示受精/授精/配子结合机制；普通性交、双修、体液/能量交换等没有受精语义时不得写入。
- `false` 与 `null` 保持区别；最终 guard 保留并只清理确定冲突。

### R4. 保持统一 UI 与下游范围

- 不为 Human 或任何其它 species 增加独立 renderer/schema。
- 用回归测试证明 Human 与原创 Nonhuman species/type 在同一 UI renderer 中同时可见。
- 不修改 Event、State、Projection、Genealogy、Runtime、宿主入口、Chat-local storage 或 AnalysisInput 结构。

### R5. 测试与文档

- 重构 World Model 测试覆盖 Human Male/Female、Human custom type、原创 Nonhuman、非人类 Male/Female 不继承 Human baseline、无 type species、临时状态、父子重复、非受精行为、schema 外 capability、统一 UI、Human override、single-type 隔离和 final guard。
- 增加轻量生产污染 regression，只检查 `ai/prompts.js` 与 `ai/analyzer.js` 中的具体 fixture 特判/词汇，不粗暴禁止自然中文中的单字。
- 必须运行 World Model tests、全项目 tests、`npm run check`，并检查最终 diff 范围。

## Acceptance Criteria

- [ ] 生产 Prompt 不含具体 fixture species/type 教学、正例或反例。
- [ ] Analyzer 不含具体 fixture species/type 分支、别名、黑名单或 registry；single-type species-wide fallback 已删除。
- [ ] Human Male/Female baseline 只在已成立的 Human type 上生效，且世界/剧情明确事实可覆盖 baseline；Human custom type 不套 baseline。
- [ ] 任意非人类即使 type 名称为男性/女性，也不会自动获得 Human capability/rules。
- [ ] 未知 capability 保持 null，显式 false 保持 false；fertilization 和最终一致性 guard 行为正确。
- [ ] schema v1、AnalysisInput、统一 World UI、Event/State/Projection 接口保持不变。
- [ ] 原创 species 测试、UI 同时渲染测试和生产污染回归通过。
- [ ] World Model tests、全项目 tests、`npm run check` 全部通过，无新增依赖。
- [ ] 最终 commit message 使用中文并基于实际 diff；最终报告包含文件、职责、证据正则、测试数量、check 结果、diff 范围和 commit hash。

## Out of scope

- 不增加新的 capability 字段或新框架/依赖。
- 不把幻想 physiology 迁移成 species 专属字段。
- 不重构 Event/State/Projection/Genealogy/Runtime/Worldbook selector/API Profile/Secret/Chat-local storage。
- 不修改参考 HTML/图片中的静态设计示例，除非它们被证明是运行时生产逻辑。

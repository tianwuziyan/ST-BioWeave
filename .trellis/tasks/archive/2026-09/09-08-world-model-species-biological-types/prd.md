# World Model species biological types hierarchy correction

## Goal

根据真实 `AnalysisInput` 测试结果，修正 World Model 的生物分类层级，使模型先识别 `species`，再在每个 species 内记录资料实际出现的 `biological_types`，并把 capability 保持在具体 biological type 上。用户重新用同一份输入测试时，不再看到把“人类、妖、剑灵、双性”混为同一级的结果。

## Background and confirmed facts

- 当前 schema 和解析器把 `biological_types` 直接放在顶层；`ai/analyzer.js:75-87,153-173`、`storage/schema.js:3-38` 和 `ai/prompts.js:26-33` 都以此为契约。
- 当前 World Model UI 也把顶层 biological type 直接渲染和编辑；`ui/world.js:107-223`、`ui/app.js:1156-1205` 负责这些视图和表单数据。
- 当前 capability 已经是每个 biological type 的字段，但由于 species 层缺失，模型仍可能把 species 与 biological type 混列；`ai/analyzer.js:144-150` 的旧双性过滤也需要适配新的嵌套结构。
- World Model 仍应复用现有 `AnalysisInput`、请求消息、Chat-local 保存和既有 API assignment；本轮不改变这些边界。

## Requirements

- 顶层结构改为 `species[]`；每个 species 至少包含 `name`、`description` 和 `biological_types[]`。每个 `biological_types[]` 项保留现有描述、capabilities、生殖规则、生命周期和特殊规则字段。
- 禁止把 biological type 放在 species 同级；`biological_types` 只能出现在对应 species 内。species 对象不得承载 species 级合并 capabilities。
- 默认人类规则：资料出现男性、女性、双性或其它人类常规身体/生殖分类，且没有明确非人类证据时，可创建 species“人类”；只创建资料实际出现或明确描述的 biological types，不因为“人类”自动补齐男性、女性或双性。
- species 识别与 biological type 识别必须分开：允许先根据人类常规性别/身体证据默认识别 species“人类”，但识别出“人类”本身绝不能自动产生任何 biological type；每个 biological type 永远只来自本次 `AnalysisInput` 中实际出现或被规则明确描述存在的类型。
- 明确非人类证据优先：妖、魔、剑灵、精灵、兽人或其它种族分别建立 species；每个 species 只记录资料实际出现/明确描述的 biological types。`“剑灵性别基本都为男性，极少女剑灵”` 必须能表达为剑灵下的男性和女性。
- biological type 名称必须是开放的资料分类，不得由 schema 或校验硬编码为男性/女性/双性；应支持 ABO 的 Alpha、Beta、Omega 以及资料定义的其它分类。
- capabilities 必须位于 `species[].biological_types[].capabilities`，各 biological type 独立使用 `true`、`false` 或 `null`。不得生成或保存 species 级 capability，也不得仅凭名称、性别、代词、称谓、外貌或身体形态机械推断能力。
- 保留当前“无明确证据则未知”的语义，继续规范化字符串、布尔值和未知值，并保留现有医疗条件、例外、unknowns、失败保留和 Chat-local 保存行为。
- 更新 World Model 固定 Prompt / 输出契约，使模型先识别 species，再识别其下 biological types；明确说明默认人类、明确非人类、开放分类和 capability 位置规则。
- 更新 schema、AI 响应解析/规范化/校验、编辑表单、查看页面及对应中文文案；不新增人物、事件、状态、推演、复杂 ontology 或多维性别矩阵。
- 本轮不自动猜测旧的扁平模型如何拆分为 species；无法安全迁移的旧模型应按无效模型处理并提示重新分析，避免凭空制造种族归属。

## Acceptance Criteria

- [x] `WORLD_MODEL_SCHEMA`、Prompt 输出契约和解析器都只接受/产出 `schema_version + species[] + medical_context + exceptions + unknowns` 的层级；顶层没有 `biological_types` 或 species 级 capabilities。
- [x] 解析一个包含“人类→男性/女性/双性”和“剑灵→男性/女性”的结果时，四个/两个 biological type 分别保存在对应 species 下，capabilities 只存在于各 type。
- [x] 解析结果允许 `人类→Alpha/Beta/Omega` 或其它开放 biological type 名称，不因名称不在固定枚举中而失败；只出现男性时不会自动新增女性或双性。
- [x] species 与 biological type 的识别分开验证：只有男性证据得到“人类→男性”，男性+女性得到“人类→男性、女性”，明确“剑灵基本男性、极少女剑灵”得到“剑灵→男性、女性”；仅识别出人类时不自动补出任何 biological type。
- [x] 明确非人类 species 不会套用默认人类规则；没有证据的 capability 为 `null`，已有 `true/false` 证据能在对应 type 上独立保留。
- [x] biological type 名称不会触发 capability 自动补全；capability 只按输入证据或既定人类基线规则逐项判断。
- [x] World Model 查看页按“物种 → 生物学/生殖类型”展示，编辑页也按同一层级添加、删除和保存；中文 UI 不把 biological type 显示为 species。
- [x] 现有 AnalysisInput 收集、四段请求消息、请求 assignment、Chat-local 保存、失败保留、来源摘要和其它 World Model 页面功能不被重构或回归破坏。
- [x] 新增/更新回归测试覆盖层级、开放分类、默认人类不补齐、明确非人类嵌套、capability 位置、旧扁平结构不被误迁移和中文层级展示。
- [x] `npm test`、`npm run check` 以及所有修改过的 JavaScript `node --check` 通过。

## Out of scope

- 不实现人物、事件、状态、快照、推演、Context 注入或其它 World Model 模块。
- 不设计复杂 ontology、物种谱系、多维性别矩阵、跨物种能力推演或能力自动推断。
- 不改变 API Profile / Secret、AnalysisInput 来源选择、请求消息分层和 Chat-local 元数据边界。

## Open questions

无。用户已明确目标层级、默认人类与非人类规则、开放 biological type、capability 位置和本轮范围。

## Notes

- 保持 `prd.md` 聚焦于需求、约束和可观察验收结果；具体文件边界与步骤分别记录在 `design.md` 和 `implement.md`。

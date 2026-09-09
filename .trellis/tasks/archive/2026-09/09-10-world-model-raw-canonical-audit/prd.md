# 审计 World Model Raw 到 Canonical 数据差异

## Goal

建立一条可验证的 AI Raw → Canonical World Model → Chat storage → World UI 数据契约，定位两类黑盒差异的真实责任层，并以最小、通用的修改修复语义误删或过严 Evidence Guard。

本任务不把任何具体世界观、species、biological type、角色卡或能力体系写入生产代码、生产 Prompt、Analyzer 词典或测试专用判断。

## Confirmed audit findings

### A. fertilization 非空值消失

- createAnalyzer.analyzeWorldModel() 在 ai/analyzer.js:1026-1035 接收 API raw response；raw 只存在局部变量，不会直接进入 storage。
- parseWorldModelResponse() 经过 validateWorldModel() / normalizeWorldModel()；normalizeRuleText() 会把真正的 null、字符串 "null"、未知标记规范化为 JS null，并把明确 absence 规范化为 "无"。
- 对 Nonhuman type，sanitizeNonHumanType() 当前只返回 canonical type，不会主动清除 fertilization。
- 当前最终清除点是 applyWorldModelFinalConsistencyGuard() 的 ai/analyzer.js:868-872：只要非空值不是 "无" 且不匹配 REPRODUCTION_RULE_EVIDENCE_PATTERNS.fertilization，就改成 null。该关键词门槛会把没有固定字面词、但语义上确实描述配子融合/受精机制的合法描述误删。
- 同一个门槛也会使普通交互文本得到 null，但这不是可靠的语义判定方式；Analyzer 不应通过扩展关键词来替代 Prompt 的自然语言理解。
- 新抽象复现使用 弧晶体 → 甲相：两类配子在专门器官内融合并形成新个体。 在 parser 后仍为非空字符串，但最终 canonical 被清为 null；使用含“配子结合/受精”的描述则保留。

### B. biological_type 整体消失

- normalizeWorldModel()（ai/analyzer.js:906-929）只做 schema 规范化和 Human alias 合并，不按证据删除 type。
- sanitizeNonHumanType()（ai/analyzer.js:550-552）不删除 type。
- applyWorldModelFinalConsistencyGuard()（ai/analyzer.js:858-904）只修改 type 内规则值，不过滤 biological_types[]。
- AI 分析路径唯一的通用 type 删除点是 applyWorldModelEvidenceGuard()（ai/analyzer.js:792-807）：先排除 parent species / generic derivative / 明显非生物类型，再用 hasTypeSubtreeEvidence()（ai/analyzer.js:748-775）决定候选是否有当前 AnalysisInput 的同 species 证据。
- 新抽象复现表明：当 raw type 名称与输入中的稳定生理分类没有可定位关系，且没有 type-local 字段证据时，type 被删除；这符合当前“没有证据不得建立 type”的 Contract，并非 UI/storage 丢失。
- 相同测试中，陌生名称只要在 AnalysisInput 中被明确建立为同一 species 内稳定生理分类，type 会保留。因此当前没有证据支持新增 species/type 词典或按名称放行。

### 当前数据管线

    callOpenAICompatible()
      → createAnalyzer.analyzeWorldModel() 的 raw 局部变量
      → responseText/jsonCandidates()
      → parseWorldModelResponse()
      → normalizeWorldModel()
      → applyWorldModelEvidenceGuard()
      → applyWorldModelFinalConsistencyGuard()
      → ui/app.js 再次 normalizeWorldModel()
      → runtime.store.saveChat()
      → adapter.saveChatMetadata('bioweave', ...)
      → runtime.store.getChat()
      → worldModelState.model
      → worldPage() / renderWorldModelView()

- Raw AI response 当前不会保存；Chat metadata 只保存 canonical world_model 和不含正文的 world_model_meta。
- UI 读取 canonical model。ui/world.js:94-103 只做基础显示映射：null 为“未知”、布尔值为“是/否”、"无" 原样显示、其它字符串转义后显示；没有 biological reasoning 或 semantic filtering。
- 当前设置页所谓“原始内容”预览显示的是 AnalysisInput JSON，不是 AI raw response。现有页面无法直接并排查看 AI raw 与最终 canonical。

## Requirements

### R1. 保持统一语义边界

- fertilization 只表示真实受精、授精或配子结合机制。
- 普通性行为、体液/能量交换、激活、感染、寄生、改造或力量变化本身不能证明 fertilization。
- biological_type 仍只表示 species 内稳定的生理/生殖分类；职业、路线、身份、组织、阶段、临时状态和 parent species 重述不能成为 type。
- Nonhuman type 的 capability、rule、lifecycle 继续按局部 AnalysisInput 证据处理；不能跨 species/type 借证据。

### R2. 修复或确认 fertilization 的责任层

- 合法、真实的受精机制不能因为缺少 Analyzer 的固定字面关键词而被清为 null。
- 普通交互内容应由 Prompt/AI 语义 Contract 排除；Analyzer 只保留确定性的 capability/role consistency guard，不新增世界观关键词表。
- 若 raw 内容与明确的 can_be_fertilized / can_fertilize 角色相冲突，仍按现有最终 guard 清除。

### R3. 修复或确认 biological type 的责任层

- 明显 parent species/type 重复、generic derivative 和无 AnalysisInput 证据的候选继续删除。
- 全新的、陌生名称只要有同一 species 的稳定生理分类证据就必须保留。
- 不通过 species registry、alias table、fixture blacklist 或新增物种关键词解决问题。
- 如果正向复现仍被 hasTypeSubtreeEvidence() 误删，只做通用证据边界的最小调整；否则保留现有删除行为。

### R4. 保持 Raw / Canonical / UI 边界

- 不把 raw AI response 写入 Chat metadata、World Model v1 schema 或普通 World UI。
- 增加轻量、开发/测试可用的 raw/canonical trace 方案，复用设置页现有高级/调试预览，使未来能够直接判断差异发生在 AI 还是 Analyzer；该 trace 不改变 canonical storage。
- UI 继续只显示 canonical model，不参与任何语义恢复。

### R5. 保持现有兼容性

- 字符串 "null" 继续规范化为 JS null，且不变成 "无"。
- null / "无" / 非空描述三态语义、Human baseline、Nonhuman Evidence Gate、biological_type Contract、special_rules 和 World Model v1 schema 不回退。
- 不修改 Event、State、Projection、Runtime host 或统一 World UI renderer 的业务结构。

## In scope

- 当前 Trellis task 的审计记录、技术设计和实现计划。
- ai/analyzer.js 的 fertilization final guard 与必要的通用 type evidence guard 最小修正。
- tests/world-model.test.js 的全新抽象 Raw/Canonical 回归。
- 如 trace 接入现有调试状态，最小范围修改 ui/app.js / ui/settings.js；不改变普通 World Model UI。
- docs/DATA-MODEL.md 对 raw 不持久化、canonical storage 和调试 trace 边界的同步说明。

## Out of scope

- 具体世界观或测试角色卡知识、species registry、幻想生物词典、专用 alias/regex/blacklist。
- 新 capability、schema 字段、status enum 或 raw 字段持久化。
- special_rules renderer/normalization、Human 专用规则重写，除非调用链证明与本任务直接相关。
- Event / State / Projection / Genealogy / Runtime host、Worldbook selector 和 API Profile 行为。
- 通过 UI renderer 恢复 Analyzer 已删除的数据。

## Acceptance Criteria

- [x] 研究记录明确列出 Raw → parser → normalize → evidence guard → final guard → storage → UI 的函数和职责。
- [x] 合法的、没有固定关键词但语义明确属于真实受精机制的非空 fertilization 不再被错误清为 null。
- [x] 普通交互/能量交换没有受精语义时不会被 Prompt Contract 误写为 fertilization；确定性的 role conflict guard 仍有效。
- [x] biological_type 的正确删除与正确保留分别有全新抽象 fixture 回归；陌生名称不会单独触发删除。
- [x] raw type 因确实缺少当前输入证据而被删除时，测试明确证明删除发生在 evidence guard，而不是 normalize、storage 或 UI。
- [x] raw 字符串 "null" 变成 JS null；canonical null、"无"、普通非空字符串分别按现有 UI 映射显示。
- [x] special_rules、Human baseline、Nonhuman Evidence Gate、三态规则语义和 schema 不回退。
- [x] 开发/测试 trace 能同时观察 raw 与 canonical，但普通 Chat storage 仍只保存 canonical。
- [x] 不新增任何具体世界观专用分类知识或第三方依赖。
- [x] 定向 World Model tests、npm test、npm run check、修改 JS 的 node --check 和 git diff --check 全部通过。

## Key decisions and risks

- **推荐决策：**移除或缩小 final guard 中基于正向 fertilization 关键词的语义准入门槛，保留能力角色冲突等确定性 guard。代价是 Analyzer 不再承担识别任意自然语言“是否像受精”的职责；Prompt 必须继续承担该语义任务。
- **B 的当前结论：**已复现的无证据 type 删除符合 Contract，暂不设计“陌生名称放行”。只有新增正向 fixture 在存在 type-local/source-grounded evidence 时仍被误删，才修改通用 evidence gate。
- **可观测性风险：**raw 可能包含完整模型正文，trace 只能是设置页高级/调试区域的临时内存状态，不能写入 Chat metadata、日志或普通 World 页面。
- **兼容性风险：**若 final guard 修改，旧测试中把交互文本直接塞入 raw 的案例需要改为反映真实 AI Contract（AI 应输出 null），并保留一个确定性角色冲突案例验证 Analyzer 的安全边界。

## Blocking questions

无。实现阶段按上述推荐决策执行；若新回归证明 Problem B 的正向候选仍被误删，再在实现前的局部 diff 中记录具体证据和最小变更。

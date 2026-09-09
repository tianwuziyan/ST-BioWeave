# World Model Raw → Canonical 审计记录

## 审计范围

审计阶段只读取和执行内存中的测试 fixture；fixture 使用全新的抽象名称：弧晶体、甲相、穗核型。这些名称不应进入生产 Prompt、Analyzer 规则或生产文档中的世界观知识。

## 1. 调用链与持久化边界

### AI response 到 Analyzer

- ai/client.js:369-384 的 callOpenAICompatible() 返回宿主 API raw result，没有 World Model 专用缓存。
- ai/analyzer.js:965-978 的 parseWorldModelResponse() 从 string/object 提取 JSON，尝试 JSON candidate，最后调用 validateWorldModel()。
- ai/analyzer.js:78-105 的 nullableText() / normalizeRuleText() 负责 nullable string、未知标记和 canonical absence；字符串 "null" 会命中 UNKNOWN_TEXT，变成 JS null。
- ai/analyzer.js:1026-1035 的 analyzeWorldModel() 按顺序执行 API → parse/normalize → applyWorldModelEvidenceGuard() → applyWorldModelFinalConsistencyGuard()，返回的已经是 canonical result。

### Analyzer 到 Storage

- ui/app.js:1350-1400 再次对 analyzer 结果调用 normalizeWorldModel()，然后把 world_model: model 和 world_model_meta 交给 runtime.store.saveChat()。
- storage/store.js:466-482 的 getChat/saveChat 只 clone/sanitize Chat metadata；没有 Raw World Model 字段，也没有重新做 World Model 语义判断。
- runtime/events.js:43-53 只把已经准备好的 bioweave metadata 写入宿主 chat metadata。
- storage/schema.js:4-35 的 v1 schema 没有 raw 字段；emptyChat() 只预留 world_model 与 world_model_meta。

结论：当前 storage 保存的是 canonical，不是 raw；AI raw 在 analyzer 局部变量中结束生命周期。

### Storage 到 UI

- ui/app.js:1125-1148 从 runtime.store.getChat() 读取 world_model，再 normalize 后放入 worldModelState.model。
- ui/world.js:581-607 将该 model 交给 renderWorldModelView()；没有另一个 raw 输入。
- ui/world.js:94-108 / 159-175 只做基础 scalar/list 映射。null 显示“未知”，true/false 显示“是/否”，非空字符串包括 "无" 原样转义输出，数组只做列表展示。
- ui/world.js:193-211 的 resolveWorldModelSelection() 只选择首个有 type 的 species，不删除 species/type。

结论：UI 是纯 renderer，本次两个差异都发生在 UI 之前。

## 2. Problem A 复现

### 合法机制但缺少现有关键词

输入描述：

> 弧晶体的甲相是稳定的生殖分类；两类配子在专门器官内融合并形成新个体。

Raw reproduction_rules.fertilization：

> 两类配子在专门器官内融合并形成新个体。

观察：

    parseWorldModelResponse(): "两类配子在专门器官内融合并形成新个体。"
    final canonical: null

准确删除点：

- ai/analyzer.js:838-840 的 hasFertilizationMechanism() 只测试 REPRODUCTION_RULE_EVIDENCE_PATTERNS.fertilization。
- ai/analyzer.js:868-872 对非空且非 "无"、但未命中固定模式的 fertilization 写回 null。

这不是 normalize 或 UI 的丢失。当前 guard 对普通交互文本也会得到 null，但它通过“没有命中有限关键词”间接实现，无法区分合法新表述和非受精语义，因此属于过严的 Analyzer semantic gate。

### 合法机制且命中现有关键词

Raw：通过配子结合完成受精。

观察：parser 与 final canonical 都保留该值。说明 role consistency 不是该复现中的清除点。

### 普通交互

输入描述：资料只说通过体液交换激活能量循环，没有受精或配子结合。

Raw：通过体液交换激活能量循环。

观察：最终为 null。结果符合语义，但原因仍是同一正向关键词准入，不足以作为通用语义判定器。

### 确定性 role conflict

当 raw 有受精机制描述、同时 can_be_fertilized=false 与 can_fertilize=false，ai/analyzer.js:891-897 会因角色冲突清除 fertilization。这是 capability/reproduction 的确定性一致性 guard，应保留并单独回归。

## 3. Problem B 复现

### 无 type-local 证据

Raw type：穗核型，description 说明它是稳定生殖分类；AnalysisInput 只说存在某种稳定分类，但没有给出名称，也没有该 type 的规则/能力字段原文。

观察：

    parseWorldModelResponse(): biological_types = ["穗核型"]
    final canonical: biological_types = []

准确删除点：

- ai/analyzer.js:792-794 先做通用名称/结构排除。
- ai/analyzer.js:801-803 的 supportedTypes 只保留 hasTypeSubtreeEvidence(type, evidence) 为真的候选。
- ai/analyzer.js:748-775 要求 type 名称、description、规则/生命周期/特殊规则或局部字段能够在当前输入中建立 direct/type-local evidence。

这一删除符合当前 Contract：AI 不能仅凭一个未在输入中出现的名称，把“某个稳定分类”与该名称建立事实连接。不能为了保留陌生名称而增加放行表。

### 明确 stable type 的保留

输入描述：

> 弧晶体存在稳定的生殖分类，名为穗核型；该分类直接影响生殖机制。

同一 raw type 穗核型 会被 evidence guard 保留。说明陌生名称本身不是删除原因；删除原因是缺少能把候选与当前输入绑定的证据。

### parent/derived type

ai/analyzer.js:624-635 的 isSpeciesNameOrGenericDerivative() / isObservedNonBiologicalType() 删除 parent species 同名、generic suffix 和明显 ambiguous type。这是结构性 Contract guard，不应改成 species registry。

## 4. 当前调试可观测性

- ui/settings.js:763-796 的“原始内容”模式实际渲染 JSON.stringify(input)，即 AnalysisInput，不是 API raw。
- ui/app.js:1086-1122 的 analysisPreviewState 只保存 collect 之后的 input；analyzeWorldModel() 成功后仍只写回 input 和 canonical model。
- docs/DATA-MODEL.md 与 docs/UI.md 均说明正文不进 Chat metadata，但当前没有 raw/canonical 并排 trace。

建议的最小后续 seam：createAnalyzer 可选 onWorldModelTrace 内存回调，默认关闭；ui/app.js 将它放入现有 analysisPreviewState，ui/settings.js 的高级/调试区域显示 raw 与 final canonical，供开发者直接比较。trace 不加入 schema、storage 或普通 World UI。

## 5. 审计结论

1. Problem A 是 final consistency guard 的有限关键词准入过严；推荐让 Prompt 负责 fertilization 语义，Analyzer 只保留确定性 role consistency。
2. Problem B 当前复现是 evidence guard 按 Contract 正确删除，不支持新增 type 词典；需要正向/负向新 fixture 锁定该边界。
3. "null" → JS null → UI “未知”已经正常，不修改。
4. special_rules 显示链路没有参与本次两个差异，不修改。
5. storage 和 UI 不需要为恢复丢失值增加语义逻辑；任何修正应停留在 Analyzer/测试/开发 trace 边界。

## 6. 实施结果

- 移除 `applyWorldModelFinalConsistencyGuard()` 对 fertilization 非空文本的固定关键词准入；保留 capability 与 fertilization role 的确定性冲突 guard。
- 保持 `applyWorldModelEvidenceGuard()` 的 biological_type 证据门不变；陌生名称只在当前 AnalysisInput 有稳定、局部证据时保留。
- 增加可选的 analyzer trace 回调，并在设置页高级/调试区域临时显示 AI 原始返回与最终规范化世界模型；不进入 Chat metadata 或 World Model schema。

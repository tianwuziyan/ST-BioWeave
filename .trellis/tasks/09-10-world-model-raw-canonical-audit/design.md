# World Model Raw 到 Canonical 审计设计

## 1. 设计目标与边界

本任务只修正 Raw AI 输出进入 canonical model 时的通用语义/证据边界，不改变 World Model v1 schema、storage key、统一 renderer 或下游 Event/State/Projection。

职责分层：

- Prompt：从完整 AnalysisInput 理解当前世界语义，决定哪些内容是 species、biological_type、capability、fertilization、lifecycle 或 temporary state。
- Analyzer：解析 JSON，规范化固定字段，执行通用 evidence boundary、Human/Nonhuman 边界和确定性 capability/role consistency。
- Storage：只保存 canonical model 与来源摘要，不保存 raw 或 AnalysisInput 正文。
- UI：只把 canonical scalar/list 映射为可读文本，不恢复、不推断、不过滤生物语义。

## 2. Raw → Canonical → Storage → UI

    API response
      ↓ callOpenAICompatible()
    createAnalyzer.analyzeWorldModel()
      ├─ raw：局部变量，不持久化
      ├─ responseText/jsonCandidates
      ├─ parseWorldModelResponse
      │    └─ validateWorldModel → normalizeWorldModel
      ├─ applyWorldModelEvidenceGuard
      └─ applyWorldModelFinalConsistencyGuard
           ↓ canonical result
    ui/app.js analyzeWorldModel()
      ├─ normalizeWorldModel(result)
      └─ runtime.store.saveChat({world_model: canonical, world_model_meta})
           ↓
    storage/store.js → runtime/events.js → chat_metadata.bioweave
           ↓ getChat()
    worldModelState.model → worldPage() → renderWorldModelView()

格式与职责：

| 边界 | 输入 | 输出 | 允许的语义处理 |
| --- | --- | --- | --- |
| API → parser | provider raw/text/object | JSON candidate | 提取响应文本和 JSON，不做世界观判断 |
| parser → canonical | schema-valid object | fixed v1 object | null/“无”/字符串、布尔值、额外字段和 alias 规范化 |
| canonical → evidence guard | canonical + AnalysisInput | evidence-bounded model | 只做通用 species/type evidence boundary，不建立世界观词典 |
| evidence → final guard | bounded model | consistent model | capability 与 reproduction role 的确定性冲突处理 |
| analyzer → storage | canonical model | Chat-local canonical model | clone/sanitize，不写 raw |
| storage → UI | canonical model | HTML | null/布尔/字符串/数组的基础显示映射，不做 semantic filtering |

## 3. Problem A 方案

### 已确认根因

normalizeRuleText() 对合法非空字符串没有清除行为；Nonhuman sanitizer 也不会清除。真正的过严逻辑是 applyWorldModelFinalConsistencyGuard() 中调用 hasFertilizationMechanism() 的正向关键词准入门槛。

### 最小修正方向

1. 保留 normalizeRuleText() 的三态处理和 "null" → JS null。
2. 移除/缩小“非空值必须命中特定受精词”的语义准入逻辑。
3. 保留 fertilizationRoleFlags() 及 capability role conflict：明确 can_be_fertilized=false 时不能保留受体描述，明确 can_fertilize=false 时不能保留供体描述；无角色信息且能力明确冲突时仍清除。
4. 继续由 Prompt Contract 要求 AI：普通交互、能量交换、改造等没有真实受精语义时输出 null，明确 absence 时输出 "无"。
5. 不新增受精关键词、世界观词典或负面 blacklist。

这样 Analyzer 不会因为自然语言换一种合法表述而误删，也不会把 Analyzer 变成第二个语义模型。raw 中若违反 Prompt Contract 地塞入普通交互描述，只有在存在确定性 capability/role 矛盾时由 Analyzer 拒绝；语义正确性本身由 AI Prompt 负责。

## 4. Problem B 方案

### 当前判定

- normalizeWorldModel()、sanitizeNonHumanType()、final consistency guard 和 UI 都不会主动删除已 canonicalize 的 type。
- applyWorldModelEvidenceGuard() 的 normalizedTypes.filter(hasTypeSubtreeEvidence) 是明确的删除点。
- parent species 重复、generic suffix、明显 ambiguous name 的 isObservedNonBiologicalType() 是结构性排除，应保留。

### 实施判定

先用全新 fixture 固定两组行为：

- 输入明确建立陌生名称的稳定生理分类，raw type 保留；证明名称开放且不会因陌生而删除。
- 输入只提到身份、路线、临时状态或没有提供 type-local 证据，raw candidate 删除；证明删除发生在 evidence guard 且符合 Contract。

当前审计的 positive/negative 复现已满足这一边界，因此默认不修改 B 的 guard。若实施阶段新增的 positive fixture 仍显示“同一 species 的明确 type-local 证据”被删除，才对 hasTypeSubtreeEvidence() 做单点通用修正；不得为该 fixture 添加名称放行表。

## 5. Raw / Canonical 可观测性

当前 settings/world preview 的 raw 模式是 AnalysisInput JSON，不是 AI raw；当前 app/analyzer 不保存或显示 AI raw。因此建议增加一个显式可选、只在高级/调试区域显示的 trace seam：

- createAnalyzer 接受可选 onWorldModelTrace 回调；默认不设置，不改变生产行为。
- 回调 payload 只包含内存中的 response text/raw 摘要、parser 后 model 和 final canonical model；不进入 schema、Chat metadata、日志或普通 World UI。
- ui/app.js 将 trace 放入现有 analysisPreviewState 的临时字段；ui/settings.js 在高级/调试预览中并排显示 Raw response 与 Canonical model。ui/world.js 不显示该字段，避免污染普通 World Model UI。
- trace 展示是纯 JSON/text 展示，不复用 World Model renderer，不让 UI 参与判断；切换 Chat 或刷新页面后自然消失。

## 6. 兼容与回滚

- schema v1 不变，已有 Chat metadata 无迁移。
- raw 不持久化，现有 Chat storage shape 不变；trace 只存在当前页面内存。
- 若 final guard 修改后出现旧测试失败，优先将测试 raw 调整为符合 Prompt Contract 的 AI 输出（例如普通交互应为 null），另用 role conflict 测试覆盖 Analyzer 的确定性拒绝。
- 如 positive type fixture 失败，回滚只涉及 evidence guard 单点，不触碰 UI/storage。

# Research: 推演反应语义匹配方案与风险

- Query: 对比确定性同义词/类别匹配、标题/内容 Token 匹配和额外 AI 语义分类，评估正文生理反应与 Projection 卡片关联的误判、生命周期、Debug 与测试风险，并推荐最小安全 MVP。
- Scope: internal
- Date: 2026-10-21

## Findings

### 当前基线与既有决策

- 归档任务已经实现了一个只读、结构化、人物与时间窗口受限的 matcher：`matchBuiltInObservedReaction()` 只接受 `pre_confirmation_observation:nausea`，要求同一 `subject_id`、`physical_symptom`、`confirmed`、Health `observation` 角色、`symptom.kind === nausea`，并要求 Event 相对 Projection `reference_story_time` 的差值落在分支窗口内（`core/projection-eligibility.js:225-279`）。
- 既有测试明确把描述文字与结构化 kind 分离：一个 `kind=odor_discomfort` 但 description 含“恶心”的 Event 不会替代真正的 `kind=nausea` 命中；不同人物、窗口外、intervention、negated 均不命中（`tests/projection-eligibility.test.js:209-244`）。这正是本任务扩大覆盖时必须保留的安全基线。
- 既有设计明确禁止自由文本猜测、禁止把 `nausea` 自动等同于 `odor_discomfort`、`appetite_change` 或 `nausea_worsening`，并把关联定义为读模型提示而非 Projection factual realization（`.trellis/tasks/archive/2026-10/10-21-projection-observed-reaction-link/design.md:2.2-2.3`）。
- 当前产品 DTO 仅输出 `observed_reaction: {matched}`，不泄漏内部 ID；Debug 才带 `matched_event_ids`、`reason_code` 等信息（`runtime/projection-runtime.js:96-184`）。UI 只依赖 `matched === true` 渲染“已触发”，保留原状态和删除 hook（`ui/projection.js:224-247`）。

### 三种候选方案比较

| 方案 | 可覆盖范围 | 主要误判面 | 生命周期/性能 | 结论 |
| --- | --- | --- | --- | --- |
| A. 确定性同义词/类别表 | 在结构化 Event 已有 `kind` 的前提下，把少量稳定别名归一到同一 canonical kind；可逐步覆盖 `vomiting`、`fatigue` 等明确类别 | 别名表把不同医学语义合并；尤其“恶心加重”不能自动命中普通“恶心”，类别层级也不能替代时间/主体/状态判断 | 纯函数、读时重算、无外部调用；可以复用现有 matcher 和测试 | 推荐作为 MVP，但只允许显式、版本化、窄范围映射，不读取 title/content |
| B. 标题/内容 Token 匹配 | 能匹配结构化字段缺失但卡片标题或 Event 文本出现相似词的案例 | 高：否定（“没有恶心”）、不确定（“可能恶心”）、他人叙述、泛化说明、同句多症状、因果/触发条件都会产生假阳性；卡片 description 本身就包含“闻到…恶心”等示例词（`core/projection-eligibility.js:33-36`） | 仍可纯本地计算，但需要 tokenizer、否定/范围规则和大量维护；任何缺乏结构化证据的结果都难以解释 | 不建议用于产品命中；最多作为 Debug 候选信号，不能驱动 badge |
| C. 额外 AI 语义分类 pass | 理论上可从自然语言判断同义表达、否定、主体和多反应 | 高且难审计：模型会把可能/回忆/他人/模板文字当事实；分类结果可能漂移，单次或重读不稳定；模型错误不能由现有 `healthAssessmentEligibility()` 兜底 | 需要额外请求、成本、超时、错误与 stale-result 处理；若持久化会引入新事实/生命周期契约，若不持久化则每次读结果可能变化 | 不纳入 MVP；当前 Projection read path 只应消费已验证 Floor Event，不能在读 UI 时触发 AI |

### 重点误判边界

- **否定与不确定**：已有 Health 资格层明确排除 `negated`、`fictional`，并要求事实型 Event 的 `observation` 角色（`core/health-assessment.js:62-82`）。但这只保护结构化 Event；Token 或 AI 若重新解释 `source_evidence.text`，仍可能把“没有恶心”“未出现恶心”“可能是恶心”当命中。因此 matcher 应继续以结构化 `status`/`kind` 为必要条件，不能以自然语言覆盖失败的结构化资格。
- **另一个人物**：当前 matcher 在任何语义比较前按 `state_fact.subject_id` 与 Projection `subject_id` 隔离（`core/projection-eligibility.js:235-245`）。Token/AI 方案若先从整段正文提取反应再回填卡片，必须额外完成人物归属；这是最容易产生跨人物污染的分支，且自然语言中的代词、群体描述和对话转述很难可靠解析。
- **泛化/模板文案**：卡片 title/content 自身是可能性说明，不是事实；例如内置分支 description 含“这只是备选剧情方向，不是已确认怀孕事实”（`core/projection-eligibility.js:20-49`）。搜索卡片文本或生成 statement 会把产品文案反向当作正文证据。
- **无反应分支**：`no_reaction_early` 与 `no_reaction_late` 是“没有明显反应”的可能路线，不存在一个正向 Event 可以证明“无反应”。沉默、缺少 Event、未命中其他分支都不能转成 matched；否则会把数据缺失误作事实。现有 Evolution 测试也明确 silence/time 不产生 factual transition（`tests/projection-eligibility.test.js:390-399`）。
- **多个同时反应**：一个正文 Event 可能含多个结构化事实，也可能存在多个同人物、同窗口的 Event。安全语义是每个 Projection 分支独立计算：命中某一 canonical kind 不应自动命中相邻类别；同一分支可返回稳定排序的多个 matched IDs 供 Debug，但产品仍只显示一个 boolean。不能在“有任意反应”后批量点亮整组卡片。

### 读时与生命周期约束

- Projection 是基于有效 Event、Current State、Story Time 等输入的纯派生读模型，不能创建/修改 BiologicalEvent、Snapshot 或 factual Projection 状态（`.trellis/spec/domain/floor-state.md:1230-1256`）。因此语义匹配必须保持 read-time、非持久化、非 lifecycle mutation；不可写 `factual_status=realized` 或追加 lifecycle record（归档设计 `design.md:2.3`）。
- 当前 `getBusinessData()` 先解析当前 Floor，再读取 endpoint Projection Views；只有 `businessData.current_floor.version` 与当前 Floor 完全一致时才把 `active_events` 交给 matcher，否则传空 Event 集合并 fail closed（`runtime/projection-runtime.js:1277-1298`）。任何新方案都应保留这条检查，不能用 Chat cache、旧 DTO 或上一次匹配结果补偿。
- Floor-derived active Events 只能来自当前有效 owner slot、active Swipe 和完整六字段 Floor Version；存储版本不完整/过期或与当前文本/Swipe 不同的 Event 必须被排除（`.trellis/spec/domain/floor-state.md:1062-1098`；`docs/bioweave-data-lifecycle.md:1082-1094`）。因此删除正文、删除 Event、切换/删除 Swipe、编辑导致版本变化、回退旧 Floor 后，下一次读必须自然重算并消失；不应为 matcher 新增 Chat-level ledger 或 cache。
- Chat rebind 的 read-only 恢复只能读取当前有效 Floor/Projection Views，不能触发 Projection processing、Analyzer、lifecycle tick 或 delivery 写入（`.trellis/spec/domain/floor-state.md:495-551`）。这排除了“切换页面时额外 AI 分类一次”的安全做法。

### Debug 与接口边界

- 产品 DTO 应继续只暴露 presentation-safe boolean；UI 已经按此契约渲染 badge，且测试确认 HTML 不泄漏 Event ID、Floor Version 或 Projection ID（`ui/projection.js:229-245`; `tests/ui.test.js:1420-1438`）。
- Debug 可以保留每张当前内置卡片一条有界记录，包括 `matched`、canonical kind、matched Event IDs、reason code、stage key 和 `source_type: CURRENT_DERIVED`（`runtime/projection-runtime.js:150-184`；`runtime/events.js:7065-7083,7172-7183`）。若增加 synonym/category 层，建议 reason code 明确区分 `EXACT_STRUCTURED_KIND_MATCH`、`CANONICAL_SYNONYM_MATCH`、`NO_VALID_SOURCE_EVENT`、`NEGATED_OR_UNCERTAIN_SOURCE`、`SUBJECT_MISMATCH`、`EVENT_OUTSIDE_OBSERVATION_WINDOW`，而不是把所有结果归为“semantic match”。
- 不建议在 Debug 中默认保存原文全文、Prompt、模型输出或新的 AI evidence；归档设计已经规定 Debug 不包含正文全文、模型输出或 Secret（`.trellis/tasks/archive/2026-10/10-21-projection-observed-reaction-link/design.md:4.3`）。

### 推荐的最小安全 MVP

1. 保持现有结构化 Event 作为唯一命中前提，继续复用 `healthAssessmentEligibility()`、人物隔离和 Story Time 窗口。
2. 将现有单一 `nausea` 特例收敛为一个很小的 canonical mapping：仅允许经过审查的结构化 `symptom.kind` 别名归一；不要把 title、description、`generated_statement` 或 `source_evidence.text` 纳入命中输入。
3. 只为与 canonical kind 一一对应、且有正向结构化事实的分支提供 badge。`no_reaction_*` 永不因缺少证据而 matched；`nausea_worsening`、`odor_discomfort`、`appetite_change` 等不能由普通 `nausea` 或文本相似自动推导，除非未来明确增加各自结构化 Event kind/契约。
4. 每个 branch 独立匹配；多 Event 允许多个 Debug IDs，但产品仍是 boolean。匹配结果不改 Projection status、factual lifecycle、Context delivery、保存或删除行为。
5. 不增加 AI pass。若未来要研究 AI，应先另立任务定义结构化分类输出的 owner、Floor/Swipe provenance、缓存/失效、stale response、失败回滚和人工可审计契约；不能在本任务的读路径临时加入。

### 建议测试矩阵

| 维度 | 必测案例 | MVP 期望 |
| --- | --- | --- |
| exact/canonical | exact kind；允许的 synonym；未知 kind；kind 与 description 冲突 | 仅 exact/白名单 canonical 命中；未知和冲突不命中 |
| 主体 | 同人物；另一人物；缺 subject；代词/群体文本 | 仅同一结构化 `subject_id` 命中 |
| 状态/角色 | confirmed observation；negated；fictional；uncertain/probable；intervention；缺 source evidence | 只有 confirmed observation 且资格有效命中 |
| 时间 | 窗口开始前、边界日、结束后、不可比较 Story Time、错误单位 | 只有可比较且在 branch min/max 内命中 |
| 分支 | nausea vs odor/appetite/worsening；no-reaction branch；generic Projection | 只命中对应 branch；无反应分支永不由 absence 命中；generic 不参与 |
| 多反应 | 同窗口多个不同 kind；同 kind 多 Event；正文同句多个症状但只一个结构化 kind | 分支独立；同 kind 可聚合 Debug IDs；文本不能拆出额外命中 |
| 生命周期 | Event 删除/编辑、来源 Floor 删除、Swipe 切换/删除、Floor Version 变化、回退旧 Floor | 下一次权威读取重算，失效来源不留 badge |
| 读时安全 | current Floor 与 business snapshot mismatch；Chat rebind read-only；重复 getBusinessData | fail closed；不调用 Analyzer/AI、不写 Floor、不写 lifecycle/delivery |
| UI/Debug | matched true/false；多人物卡片；普通 HTML 不泄漏内部字段；Debug 有界 reason | 只显示对应卡片“已触发”；内部 provenance 仅 Debug |

## Related specs

- `.trellis/spec/domain/floor-state.md`：Projection 纯派生边界、当前有效 Floor/Swipe/六字段 Version、批量持久化和 read-only Chat rebind 约束。
- `docs/bioweave-data-lifecycle.md`：Floor/Event/Projection 的 owner、失效与重建规则。
- `.trellis/tasks/archive/2026-10/10-21-projection-observed-reaction-link/prd.md`：既有产品范围、结构化匹配和 UI/Debug 验收标准。
- `.trellis/tasks/archive/2026-10/10-21-projection-observed-reaction-link/design.md`：上一版精确 matcher、DTO、Debug、回滚与非目标。

## Caveats / Not Found

- 本次只做内部代码/spec/测试审计，未使用外部文档；没有找到现成的通用 synonym ontology、否定范围解析器或可复用的安全 AI semantic-classification contract。
- 当前已有测试通过：`node --test tests/projection-eligibility.test.js tests/projection-runtime.test.js tests/ui.test.js`，结果为 152 passed、5 skipped、0 failed；测试运行产生了既有的主题存储失败日志，但未导致测试失败。
- 测试行号会随当前分支变更；实现前应重新用 `rg -n` 定位相关测试，不应把本研究的行号当作 API 契约。
- 不能仅凭当前静态测试宣称真实 SillyTavern Desktop/Tablet/Mobile 已验收；归档任务要求刷新已安装插件后执行真实宿主验收。

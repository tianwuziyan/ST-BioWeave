# 建立 Runtime 权威的人物身份解析闭环

## Goal

改造 Event Analyzer 与 Biological Event 的 character identity、registry、alias 和 unresolved 生命周期，保持事件数据兼容。

## Requirements

- 将 `character_id` 定义为当前 Chat 内由 Runtime/Plugin 创建、校验和持久化的
  canonical entity identifier。LLM 只能发现 mention、提出 existing/new/unresolved
  判断和 alias candidate，不能根据姓名、拼音、slug、hash 或数字后缀创建永久 ID。
- 增加一个与 `character_profiles`、`tracking_subjects`、`tracking_candidates` 分离的
  Chat-local Character Registry；每个实体至少保存稳定 `character_id`、可变
  `display_name` 和可重复使用但不保证全局唯一的 `aliases`。同名、同音、同 alias
  的不同人物必须可以共存。
- Event Analyzer 输入显式携带 canonical identity candidates；`character_context`
  继续表示语义/背景上下文，不能再被当作隐式 ID 白名单。输入必须声明候选 ID
  来自 Runtime 且只能原样引用。
- AI raw response 支持 `existing`、`new`、`unresolved` 三种 identity status。
  `new`/`unresolved` 在 resolution 前可以没有 `character_id`，只能用 response-local
  mention handle；existing 的 ID 必须经过 Runtime registry membership 校验。
- 建立 raw AI DTO → identity resolution/registration → canonical Event DTO →
  BiologicalEvent validation → persistence 的顺序。最终持久化的 participant、
  `gestational_subject_ids` 和 `counterpart_ids` 必须全部是已验证的 canonical IDs；
  不能通过放宽最终 Event schema 来容纳未解析人物。
- 新人物在本次 Event 成功提交前由 Runtime 重新检查 registry，生成不依赖姓名的
  opaque canonical ID，注册到 Character Registry，并将当前 Event 与后续 Analyzer
  输入绑定到同一 ID。解析失败或低置信度的 unresolved 不得污染 registry 或写入不完整 Event。
- Runtime 必须拒绝/降级不存在于当前 canonical registry 的 existing ID；不得把
  `shen_qi_yuan` 等模型字符串直接当作 canonical ID。已有旧 Event 的旧 ID 必须继续
  可读，兼容处理不能重写历史引用。
- Participant 去重只能发生在 canonicalization 之后并以已验证 canonical ID 为依据；
  raw provisional mention 不得触发跨人物合并。重复或冲突的 raw identity records
  不得再被静默 last-record-wins 丢弃。
- Alias 生命周期必须区分 canonical display name、已确认的 stable name variant/
  nickname 与 contextual mention。LLM 只能返回 alias candidate，Runtime 仅在有明确
  命名证据且通过空值、代词、generic/title、重复等检查后写入 aliases；关系称谓、
  泛称和代词只用于当前上下文，不能默认永久保存。alias 不建立全局唯一约束，冲突
  时无充分上下文必须 unresolved。
- 必须严格分离 mention resolution、alias discovery、alias persistence。一个 mention
  在当前 narrative 中解析到既有实体，不等于该称呼自动成为 alias；只有明确的
  alias-establishment evidence 才允许 LLM 返回 `alias_candidate`。第一版禁止因为
  单次高置信度 mention、正文同时出现 display name 与称呼、或普通上下文连续性而
  自动学习永久 alias；不实现多次 mention 晋升机制。
- alias 精确匹配只返回可能的 candidate entity 集合，不能直接决定 `character_id`。
  Registry 中同一 alias 可属于多个实体；必须结合 narrative context 消歧，无法可靠
  消歧时返回 unresolved，禁止 first-match-wins。
- 支持 nickname-only 新人、后续正式名/真名揭示和非破坏性 display name 更新；不能
  因名称变化创建第二个实体，也不能自动删除或 merge 两个已经存在的 canonical IDs。
- Event Analyzer 的 `location` 继续是自然语言 `string | null`，保留 narrative、
  Target Floor、Recent Context 或 Worldbook 中的原文、语言和字符，不做翻译、拼音、
  romanization、snake_case、slug 或 ASCII 化。
- 保持现有 `event_id` Runtime-authoritative、Floor/Swipe 绑定、pregnancy subject
  分组、participant-backed closure、Tracking Registry 派生和 UI 边界不变；不引入
  无必要依赖，不把完整 Event 或 identity diagnostics 暴露到普通 Product UI。
- 为 existing alias、同音/同名、new 生命周期、unresolved、hallucinated ID、alias
  candidate/冲突、rename、location、pregnancy validation 顺序和旧 Event load 增加测试。

## Acceptance Criteria

- [ ] 当前 identity 数据流、现有 registry 复用调查、LLM 信任点、participant 去重、
      validation 顺序和 pregnancy 约束有仓库证据记录，并与实际实现一致。
- [ ] 每次生产 Analyzer request 都显式携带独立的 canonical identity candidates；
      `character_context` 与 Character Registry 的职责可从输入和 prompt 中区分。
- [ ] 新/旧/别名/昵称/同名/同音/无法确定身份的流程均能在 Runtime 中解析为正确的
      canonical ID 或保持 unresolved；模型生成的姓名格式 ID 永远不会直接持久化。
- [ ] 新人首次出现会在同一成功 Event 提交前进入 Chat-local registry，当前 Event 使用
      新 ID，下一 Floor 可从 registry candidate 解析同一人物而不重复创建。
- [ ] 最终 Event schema 仍要求 participant-backed canonical IDs；pregnancy-related
      participant/reference validation 发生在 identity resolution 之后且保持现有
      subject-local 0/1/N 规则。
- [ ] alias candidate 只有 Runtime 在明确稳定命名证据下才写入；contextual title、
      generic reference 和 pronoun 不会污染 aliases；alias/display name 冲突不会自动
      合并实体。
- [ ] “沈祁鸢坐在窗边。鸢儿随后起身。”这类只有 mention continuity 的文本可以解析
      当前身份，但不会产生或持久化 alias；“以后叫我鸢儿”“小名鸢儿”“众人都称为鸢儿”
      等明确 establishment evidence 才会产生 candidate，并由 Runtime 决定写入。
- [ ] 两个实体拥有同一 alias 时，精确匹配返回两个 candidates；没有可靠上下文时为
      unresolved，不使用 first-match-wins，也不因 alias 注册先后改变结果。
- [ ] `location: "传灯院"` 等原文最终保持不变，未知地点保持 `null`。
- [ ] 既有 persisted BiologicalEvent、Floor/Swipe、Tracking、profile 和 Chat scope
      数据仍可读取；旧 Chat 无 registry 时按空 registry 读取，不要求破坏性迁移。
- [ ] 现有测试与新增 identity 测试全部通过，并执行 repository-local Prettier（对
      本次修改的所有 source 文件）。

## Confirmed current architecture

- `ai/analyzer.js` 当前把 participant `character_id` 当作普通非空字符串解析；
  `ai/analyzer.js` 和 `core/events.js` 都会以该字符串做 participant/reference 去重或
  closure 检查，但没有 registry membership 校验。
- `runtime/event-analysis.js` 当前顺序是 AI parse/normalize → Runtime 注入
  `event_id`/`source` → Domain validate/normalize → Floor save → Tracking rebuild；
  没有 identity resolution/registration 阶段，首次人物 ID 实际来自 LLM 返回字符串。
- `storage/schema.js` 的 Chat skeleton 只有 `character_profiles`、`tracking_subjects`
  和 `tracking_candidates`；其中 Tracking Registry 是 pregnancy exposure 的派生索引，
  不是全 Chat canonical character registry。当前没有必须复用的通用 identity 机制。
- `core/events.js` 当前 participant normalize 和 `ai/analyzer.js` raw participant
  normalize 均存在按 ID 的 last-record-wins 行为；实现需在不破坏旧 load 的前提下，
  让生产 raw path 在 canonicalization 前保留/检查冲突，最终 path 才按 validated ID 去重。
- 当前 baseline 为 `npm test`：490 passed, 0 failed。该 baseline 只证明现有契约，
  不代表已满足本任务的 identity contract。

## Compatibility and scope boundaries

- Registry 采用 additive Chat metadata 字段和空值兼容读取；不做全量 historical
  Event ID 重写。旧 Event 引用的 ID 作为 legacy canonical references 保留，只有新
  Runtime 创建的实体使用 opaque ID。
- 不实现 destructive entity merge、全局 alias unique index、Location Registry、
  完整妊娠状态归约或 UI 人物列表改造。已经存在的两个 canonical IDs 若后来被怀疑
  是同一人，只保留 unresolved/merge candidate 语义。
- unresolved Event 不写入最终 Event；Runtime 保留上一份成功 Floor 结果并提供安全的
  identity-resolution failure diagnostic，以维护最终 schema 的完整性。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.

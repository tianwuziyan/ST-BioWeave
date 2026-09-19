# Character Registry 与 Floor Snapshot 生命周期审计

## Goal

基于当前 HEAD 的实际代码、测试、存储抽象和最新 Data Lifecycle Contract，重新整理 BioWeave 的 Character Registry、`character_id`、`mention_id`、Floor/Swipe Snapshot、previous lookup 与 Event reanalysis 生命周期，形成一份证据可追溯、可确认、可直接指导后续最小实现的中文 planning + audit 报告。

本轮只做 Planning + Audit：不得修改产品代码、测试、规范、UI 或配置，不得启动实施，不得提交、推送、合并或重置。允许写入本 Trellis task 的规划工件。

## Requirements

### 产品边界

- Character Registry 是 Chat-local 的 Floor/Swipe successful analysis snapshot，不是 character-global storage、全局数据库、跨 Chat Registry、Character Card Registry、`localStorage` Registry、`extensionSettings` Registry 或独立 Registry 文件。
- Registry 的 authoritative history 由 surviving valid Floor/Swipe snapshots 构成；Runtime 在当前分析开始时从目标楼之前最新合法成功 snapshot 派生 working copy，成功后随当前 Floor Version 原子保存，失败时丢弃 working copy 并保留当前 Floor 上一次成功结果。
- 当前分析只能读取当前 Chat 中、严格位于 target Floor 之前、active Swipe、Floor Version 有效、未删除且未 invalidated、未跨 reset boundary 的最新 surviving successful BioWeave snapshot。不得使用 target Floor 自己旧的分析、Event 或 Registry 作为 previous history。
- 删除或失效行为必须复用现有 Event/State/Data Lifecycle 规则；不得为 Character Registry 创造独立生命周期。中间楼层删除后的后续 Floor 是否继续有效，必须以当前 Contract 和实际实现审计为准，不得凭设计假定。
- 不维护 Chat-global `next_character_id`、counter、tombstone 或其它不可逆全局编号状态。删除导致 snapshot 回滚后，编号可从 surviving previous Registry 的最大合法序号重新自然使用。

### `character_id` Contract

- 正式 ID 由 BioWeave Runtime 创建，目标新格式为 `char_` 加六位十进制递增序号：`char_000001`、`char_000002`……。
- ID 是 Chat 内 opaque canonical entity identifier；序号不得被业务层解释为姓名、性别、物种、生物类型、楼层、角色、身份或来源。
- AI 对已有角色只能返回 `identity_status=existing` 且引用 previous Runtime Registry 中的 canonical ID；`mention_id` 为 `null`，`display_name` 为当前显示名称。
- AI 对新增人物只能返回 `identity_status=new`、`character_id=null`、response-local `mention_id` 和当前 `display_name`。AI 不得生成姓名、拼音、slug、hash、翻译名、随机或自创 `char_xxx` 作为永久 ID。
- Runtime 由 previous working Registry 读取合法 `char_XXXXXX` 的最大序号加一；空 Registry 从 `char_000001` 开始；同一 response 多个新人物按确定性注册顺序连续编号且不重复；稀疏编号不填洞。
- 当前为开发阶段，旧开发数据由用户清空，不实现旧 `character_id` read、迁移、兼容层或
  tombstone。只有正式 `char_000001` 至 `char_999999` 参与 sequence max。

### `mention_id` 与身份解析

- `mention_id` 只作为单次 AI response-local 的临时引用，用于同一响应内尚未取得正式 ID 的 `new`/`unresolved` participant 及其临时 Event 引用。
- Runtime identity resolution 完成后，participants、`pregnancy_relevance.gestational_subject_ids[]` 和 `counterpart_ids[]` 等最终 canonical 引用必须全部替换为正式 `character_id`；持久化 Event 不得依赖 `mention_id` 作为跨楼层身份。是否保留 nullable schema 字段必须依据实际实现审计回答。
- 同一 response 内重复出现的同一 `mention_id` 必须映射到一个 canonical ID；不同 mention 只有在证据足够确定时才可合并，不能按 display name 无条件合并。
- `existing` 的未知/姓名型 ID 不得直接接受。若 display name 或 alias 在 previous Registry 中唯一 exact match，Runtime 可拒绝模型 ID 后确定性 canonicalize；0 个或多个候选必须 fail closed，不能 first-match-wins，也不能未经安全 Contract 把 existing 擅自转换为 new。

### API、存储与重分析审计范围

- 实际追踪 `buildFloorAnalysisInput()`、`buildEventAnalysisInput()`、`buildEventAnalysisMessages()`、`findPreviousSuccessfulBioWeave()`、`registerNewCharacter()` 及相关调用链，确认 canonical Registry 的来源、API payload、`recent_context`/`current_floor` 是否重复、current Floor 自排除是否成立。
- 核对 Registry schema 至少包含 `character_id`、`display_name`、`aliases` 及现有必要 identity metadata；不得把 display name 作为 primary key，不因本轮 sequential ID 重新设计完整人物 Profile。
- 核对成功/失败、普通分析/手动 reanalysis、Floor/Swipe 保存与切换、删除、编辑、版本变化、reset boundary、owner/epoch guard、Chat isolation、World/Character reset 的实际行为和测试覆盖。
- 明确回答空 previous、existing resolution、new registration、同一 response 多 Event 去重、pregnancy reference canonicalization、旧 ID 不兼容、Chat 隔离和 sequence rollback 的当前事实、缺口、风险与最小实现落点。
- Prompt 只做必要的最小文字调整建议；UI 不在本轮范围，Event schema 默认不修改。

### 规划输出

审计报告必须以当前代码为准，至少回答用户指定的 28 类问题：HEAD、ID 生成与格式、mention 用途、Registry 保存/快照、previous 来源与自排除、空 previous、new/existing 调用链、中文姓名 ID 根因与安全 fallback、API canonical Registry、pregnancy remap、顺序 ID与生命周期一致性、counter/schema/Prompt/UI/旧 ID 兼容、最小实现文件集合、完整测试矩阵、lifecycle/reset/swipe/delete 风险和实施顺序。每项关键结论给出精确文件/函数/行号证据，并区分已确认事实、推断、缺口和后续决策。

报告末尾必须给出供确认的 `Proposed Character Identity Contract` 和 `Proposed Floor Snapshot Lifecycle`。

## Acceptance Criteria

- [ ] 当前工作树、HEAD、近期提交和相关 Trellis/领域规范已只读核对；产品代码、测试、UI、配置未被修改。
- [ ] 已沿实际调用链核对 `findPreviousSuccessfulBioWeave()` → input builder → analyzer/API → Runtime resolution → canonical Event → Floor/Swipe persistence。
- [ ] 已明确 Registry authoritative storage、snapshot 完整性、active Swipe/Floor Version/删除/失效/reset/owner guard/Chat isolation 语义，并指出任何与目标 Contract 不一致之处。
- [ ] 已明确当前 sequential ID、旧 ID兼容、mention 生命周期、existing fallback、new registration、跨 Event 去重和 pregnancy reference remap 的实际行为及最小修复落点。
- [ ] 已检查当前测试与 package scripts，并提出覆盖 24 个用户场景（含 lifecycle、reanalysis、canonicalization、兼容和 API 输入重复）的完整测试矩阵。
- [ ] 已形成 `prd.md`、`design.md`、`implement.md` 规划工件；规划工件不包含未经审计确认的实现完成声明。
- [ ] 已向用户展示最终 planning summary，并停在等待明确实施批准；不执行 `task.py start`。

## Out of Scope

- 本轮不修改产品代码、测试、Prompt、Event schema、UI、样式、配置或领域规范。
- 本轮不执行实现、迁移、数据修复、重分析、提交、推送、合并、发布或任何 destructive Git 操作。
- 不新增 global registry、Chat-global counter、tombstone、独立持久化数据库或以姓名派生 ID 的兼容层。
- 不重新设计 Character Profile、Tracking、World Model 或产品 UI；只审计它们与 canonical Registry/Floor lifecycle 的边界。

## Open Questions

- 当前代码可回答的技术问题不向用户反问，先通过代码、测试、文档和历史任务证据解决。
- 仅在审计后仍存在会改变产品行为、兼容策略或实现边界的用户决策时，保留一个最高优先级问题；未解决前不得宣称 planning 收敛。

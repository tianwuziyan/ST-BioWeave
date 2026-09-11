# Phase 2A：NSFW Event Extraction 与 Pregnancy Tracking

## Goal

完成第一条真实业务闭环：

```text
当前剧情 → 结构化 BiologicalEvent → 受孕相关 Tracking Subject
          → Floor/Swipe 持久化与引用维护 → 人物 / 事件 / 总览 UI
```

人物列表只表示当前 Chat 中已经进入妊娠相关追踪流程的角色，不表示当前 Chat 的全部角色。

## Background and confirmed facts

- `core/events.js:1-5` 已有 BiologicalEvent 类型列表和最小 `normalizeEvent` / `validateEvent` / `sortEvents`，但尚未实现本阶段所需的固定结构、证据边界和 Tracking Subject 关联。
- `ai/analyzer.js:961-1017` 的 `analyzeFloor` 当前仍调用通用自由文本 `buildPrompt`，没有固定 Event JSON parser；World Model analyzer 已有独立的 JSON 解析与证据约束，可作为边界参考，但本阶段不修改 World Model State 计算。
- `storage/schema.js:439-453` 的 Chat/Floor 默认结构已有 `character_profiles`、`index` 与 Floor `events` 槽位，但没有明确的 Tracking Subject Registry；`storage/store.js:469-520` 已提供 Chat Scope、普通 Floor/per-swipe 读写和 stale guard。
- `runtime/floor.js:1-109` 已实现六字段 Floor Version、成功跳过、版本变化重试、手动刷新和失败时保留旧成功结果；本阶段必须把这些规则延伸到真实 Event 数据，而不是另建分析去重逻辑。
- `ui/characters.js:40-46` 仍显示 `demo-character-1`，`ui/events.js:1` 和 `ui/overview.js:1` 仍为页面壳或 mock/empty DTO；`ui/app.js:1808-1855` 当前没有向这些页面传入 Chat 业务数据。
- `story/time.js:1` 只有 provider wrapper；已有宿主研究记录 SevenDaysCal 的公开故事时间来自消息标记 / extension prompt，不能读取其私有 Store（`.trellis/tasks/09-06-worldbook-selector/research/host-worldbook-api.md:34-42`）。
- 基线 `npm run check` 通过，当前共 249 项测试；新增行为必须保持既有 World Model、Chat boundary、per-swipe 和 Popup/UI 契约。

## Requirements

### R1. 业务边界与人物列表语义

- 只有真实或可靠识别的 `sexual_activity` / NSFW Event，且事件参与者实际存在、具备有证据支持的妊娠承载能力，并且本次事件存在实际受孕暴露可能时，才创建或更新 Pregnancy Tracking Subject。
- 一次 Event 允许产生 0、1 或多个 Tracking Subject；不得使用 `female = pregnancy subject` 或 `male = conception source` 的默认规则。
- Event Role 与 Gender 分离；允许 `potential_gestational_subject`、`potential_conception_source`、`other_participant`、`unknown` 等语义，不以“攻/受”作为生物学判断。
- `true`、`false`、`null` 三态能力语义必须保留；`null` 是 unknown，不得自动变成 `true`。
- 非 NSFW、NSFW 但无受孕暴露、能力未知或明确不具承载能力的事件不得建立人物卡。

### R2. Event Analysis Pipeline

- Event Analyzer 输入必须覆盖 Current Chat Scope、Current Floor Version、当前 Floor Narrative、必要最近剧情上下文、World Model、Story Time 和必要的角色设定上下文。
- Event Analyzer 必须返回固定 JSON 结构；不能接受自然语言自由输出作为成功结果。
- `sexual_activity` 是本阶段重点，但 Event Schema 必须继续接受现有其它 BiologicalEvent 类型。
- 解析后的 Event 必须通过统一 normalize/validate 后才能写入 Floor；失败不得写入半结构化结果。

### R3. BiologicalEvent 事实结构

每个事件至少具备：

- `event_id`、`type`、`status`、`location`、`participants[]`、`pregnancy_relevance`、`source_evidence`。
- `source`：`chat_id`、`message_id`、`floor`、`swipe_id`、`content_hash`、`message_version`。
- `story_time`：`display`、`normalized`、`calendar_id`、`day_index`、`provider`、`precision`、`confidence`。
- 每个 participant：`character_id`、`display_name`、`event_role`、`reproductive_capabilities_used`、`evidence`；可带有 World Model/species 的最小生物上下文。
- `pregnancy_relevance`：`relevant`、`possible_conception`、`gestational_subject_ids[]`、`counterpart_ids[]`、`confidence`。
- `counterpart_ids` 永远是数组，允许 0/1/N；姓名只用于显示，关联使用稳定 `character_id`。

### R4. Story Time

- 优先使用可用的 SevenDaysCal Story Time Adapter；不可用时使用 BioWeave Fallback StoryTimeProvider。
- 数据库存储结构化 Story Time；`display` 只用于 UI 显示，任何排序/计算不得重新解析 display 文本。
- 无法可靠得到 `normalized` 或 `day_index` 时保存 `null`，不得伪造准确日期；模糊时间仍可保留 display、precision 和 confidence。
- 本阶段不实现妊娠天数、Gestational Age 或预计分娩日计算。

### R5. Pregnancy Tracking Subject / Registry

- 增加明确的 Tracking Subject Registry。Subject 只保存稳定角色标识、显示名、创建事件引用、`exposure_event_ids[]` 和 active 状态等索引，不复制完整 Event。
- 完整事实只保存在对应 Floor-bound BiologicalEvent 中；Registry 只引用有效 `event_id`。
- 同一角色多次事件必须复用一个 Subject 并累积多个 exposure 引用；一个 Event 可以创建多个 Subject。
- 只有真正进入 Tracking 的角色才建立必要的持久人物生理资料；普通聊天角色不进入通用生理数据库。
- 删除/替换 Floor 或切换 Swipe 后必须重建/清理 Registry，不能留下 dangling `event_id`。
- 本阶段的 active registry policy：没有有效 exposure Event 且没有后续 pregnancy/delivery 等状态时，从 active 人物列表移除；保留必要的无事件人物资料作为非展示历史，直到后续明确的资料清理策略确定。

### R6. Floor / Swipe / Version

- Event 本体必须保存到产生它的 `message.extra.bioweave`，或存在 swipe 结构时保存到对应 `message.swipe_info[swipe_id].extra.bioweave`；不得只复制到 Chat-level 事件大数组。
- Event 的 `source` 必须精确绑定产生它的 Chat、Message、Floor、Swipe 和 Floor Version。
- 删除 Floor 后事件必须消失；切换到没有事件的 Swipe 后旧 Swipe Event 不得参与当前有效状态。
- 相同 Floor Version 的成功结果不得因 UI reopen 或 extension init 重复请求；失败可重试；手动刷新可强制请求。
- 手动刷新成功替换该 Floor Version 的旧成功 Event；刷新失败保留旧成功结果，同时不能把旧版本 Event 当作新 Floor Version 的事实。

### R7. Event / Subject UI

- 人物列表没有 Tracking Subject 时显示“当前尚无需要追踪的角色。”及受孕相关说明；删除 `demo-character-1` 运行占位。
- 人物详情显示人物名称、稳定 `character_id`、可用的 species/type、已知 reproductive capabilities、所有 exposure Event 和“等待状态引擎计算”；不得伪造 probability 或 gestational age。
- Events UI 开始消费真实 `BiologicalEvent[]`，显示列表、详情、Story Time、Floor、Location、Participants、Reproductive Roles、Pregnancy Relevance、Status、Confidence、Source。
- Event 支持直接编辑当前有效事实和真删除；不得增加 `user_override` priority layer。
- Overview 的人物统计/人物总览来源是 Tracking Subject Registry，事件统计/最近事件来源是有效 BiologicalEvent；Projection 和 Genealogy 继续 Empty State。
- UI 只显示和调用业务结果，不根据 gender、receiver 或其它参与者文本推导能力、Subject 或人物列表。

### R8. Event Prompt 核心契约

Event Analyzer Prompt 必须明确写入：识别 sexual_activity；提取结构化 Story Time、地点和全部参与者；使用 World Model baseline + Narrative Evidence；按 capability 判断 reproductive role；输出 gestational_subject_ids[] / counterpart_ids[]；两个数组允许 0/1/N；不因 NSFW 自动判定 conception/pregnancy；不因症状判定 pregnancy；unknown 不得变 true；只返回完整 JSON；UI 不做二次生殖判断。

### R9. Tests / Docs

- 覆盖无 Subject、单/多 Subject、单/多 counterpart、Gender 不决定能力、`null` 不变 true、非 NSFW、无暴露、重复事件、Event 编辑/删除、Floor 删除、Swipe 切换、Floor Version 替换、手动刷新成功/失败、UI 不推导资格和 Overview 统计来源等行为。
- 更新 README、`docs/DATA-MODEL.md`、`docs/DEVELOPMENT.md`、`docs/UI.md`，必要时新增 Event Schema 文档；明确人物列表语义、Event 单一事实源、结构化日期和 UI contract。
- 完成后运行 `npm run check`；真实 SillyTavern、SevenDaysCal、移动端 UI 和实际 AI 请求仍需人工验收。

## Acceptance Criteria

- [ ] Event Analyzer 对当前 Floor 输出固定可解析 JSON；成功写入前经过 schema normalize/validate，保留现有 BiologicalEvent 类型兼容性。
- [ ] Event source 精确绑定 Chat/Floor/Swipe/Floor Version，Story Time 为结构化对象，counterpart 为数组。
- [ ] 只有通过 World Model + Narrative Evidence + capability 且存在受孕暴露的参与者进入 Tracking Registry；gender、NSFW 单独存在和 unknown 都不能触发 Subject。
- [ ] 一个 Subject 能累积多个 exposure refs，一个 Event 能生成多个 Subject；Registry 不复制完整 Event。
- [ ] Floor 删除、Swipe 切换、Event 编辑/删除和 Floor Version 替换后没有 dangling reference，当前有效 Event 集合正确。
- [ ] 自动分析遵守既有 N-floor interval / Floor Version 去重；UI reopen/init 不重复请求；失败可重试；手动刷新成功替换、失败保留旧成功。
- [ ] Characters、Events、Overview UI 只消费真实业务数据；无 Subject 显示真实 Empty State；Projection/Genealogy 保持 Empty State。
- [ ] `npm run check` 全部通过，并新增本阶段要求的自动化回归测试。
- [ ] 文档明确“人物列表不是当前 Chat 的全角色列表”，以及 BiologicalEvent、Registry、Story Time 和 UI 的边界。

## Out of scope

- 完整 Pregnancy State、最终妊娠概率、Gestational Age、预计分娩日、完整 StateReducer、生理 Snapshot 恢复、Projection Engine、Genealogy 推导、自动出生/子女关系。
- UI 根据事件自行计算生殖资格、概率、妊娠状态或时间；不生成 mock 数据填充页面。
- 不扫描整个 Chat 建立所有角色的通用生理数据库；不把当前主卡、出现过的名字或普通剧情角色自动加入 Registry。
- 不建立 `user_override` priority layer；用户编辑直接修改当前有效 Event。
- 不把 Event 事实复制为 Chat-level 唯一事件账本；不改变 Secret 只保存 `secret_ref` / `secret_id` 的边界。
- 不进行与本闭环无关的架构大重构、Factory/Repository/Service 抽象或完整 UI v2.0 重绘。

## Risks and deferred items

- SevenDaysCal 的公开 Story Time 形状需要在真实宿主中确认；代码必须通过可注入 Adapter 和结构化 fallback 保持安全降级。
- 本地 Node 测试只能验证纯函数、Fake DOM 和存储契约，不能证明实际 SillyTavern EventEmitter、Popup、Swipe 数据形状和 API 请求可用。
- AI 可能返回证据不足或不稳定角色信息；解析器必须拒绝无效结构，Domain 只接受显式 capability true，不把模型常识当事实。

## Open questions

无。用户已确认进入规划；技术未知项按设计中的可注入 Adapter、明确 fallback 和真实宿主验收步骤处理。

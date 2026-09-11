# BioWeave 开发规范（轻量模块版）

## 模块边界

- `core/events.js`：BiologicalEvent 类型、固定结构、normalize / validate / sort；统一拥有 Event 边界，不让 UI 或其它消费者各自解析原始 payload。
- Tracking Registry 领域逻辑：从已验证的 Floor-bound Event 建立/重建 Chat-local Tracking Subject 索引；只保存稳定人物信息和 `event_id` 引用，不访问 DOM、AI 或宿主。
- `core/state.js`：纯程序 State Reducer，不调用 AI；Phase 2A 不接通完整妊娠状态归约。
- `core/snapshot.js`：检查点与删除楼层后的局部恢复。
- `core/projection.js`：未来软推演数据；不是事实。
- `core/genealogy.js`：家系查询、世代与排序。
- `ai/client.js`：API Profile 的校验、SillyTavern Secret 引用和宿主代理测试请求；不在浏览器或 Chat 数据中保存明文 API Key。
- `ai/prompts.js`：受保护 Core Prompt + 用户 Prefix/Task/Suffix Pipeline。
- `ai/worldbook.js`：世界书枚举/选择/Token 估算。
- `ai/analyzer.js`：World / Floor / Projection 三类 AI 任务；Phase 2A 的 Floor Event 分析必须使用固定 JSON 解析和统一 Event 校验，不能以自由文本作为成功结果。
- `runtime/chat.js`：ChatBoundary。
- `runtime/floor.js`：Floor Version、N-floor 分析间隔、成功版本去重、失败重试与手动刷新规则。
- `runtime/event-analysis.js`：Event Analysis coordinator；拥有目标 Floor 解析、输入构建、自动/手动调度、去重、提交、状态 DTO、Event CRUD 与 Registry 重建。
- `runtime/events.js`：SillyTavern 生命周期事件映射与公开 Runtime Event Analysis API；自动分析在 Runtime 初始化后有效，不依赖 overlay 或 UI subscriber。
- `storage/store.js`：两级存储统一入口。
- `storage/schema.js`：默认结构和版本，包括 Chat-local Tracking Registry 的兼容读取边界。
- `story/*`：外部记忆公开接口适配；`story/time.js` 负责结构化 Story Time provider、fallback 和 display formatter，不反向解析 display。
- `context/builder.js`：向 Tavern 注入短、稳定、结构化的 BioWeave Context。
- `ui/*`：一个一级页面一个文件；页面只消费 Runtime 传入的 Tracking Registry / BiologicalEvent DTO，不判断生殖资格。

## 不再继续细拆的规则

只有文件稳定超过约 500–800 行、出现两个独立职责、或独立测试明显更清楚时才拆。不要建立 event-store / event-validator / event-factory / event-interface 这类碎片目录。

## Phase 2A Event / Tracking 实施契约

Phase 2A 只新增事实提取和追踪索引，不是完整妊娠状态引擎。跨层数据流保持轻量：

```text
当前 Chat / Floor / 最近剧情 / World Model / Story Time
  → Event Analyzer 固定 JSON
  → Event normalize / validate
  → Floor-bound BiologicalEvent[]
  → Chat-local Tracking Subject Registry
  → Characters / Events / Overview
```

实现时必须保持以下边界：

- 人物列表不是当前 Chat 的全角色列表，只读取 active Tracking Subject Registry。Subject 的进入由 BiologicalEvent、World Model、Narrative Evidence 和 reproductive capability 决定，UI 不参与判断。
- BiologicalEvent 是完整 NSFW 历史事实的单一来源。Subject 只保存 `created_from_event_id`、`exposure_event_ids[]` 等 Event 引用和必要索引，不复制完整 Event；稳定关联使用 `character_id`，不用姓名。
- Event Analyzer 输入至少覆盖 Current Chat Scope、Current Floor Version、当前 Floor Narrative、必要最近上下文、World Model、结构化 Story Time 和必要角色设定上下文。输出只能是固定 `{schema_version, events[]}`；只有通过统一 normalize / validate 的结果才能写入 Floor。
- `source` 由分析调度器强制绑定 `chat_id`、`message_id`、`floor`、`swipe_id`、`content_hash`、`message_version`，不信任模型返回的跨 Chat/Floor/Swipe 身份。存在 swipe 结构时 Event 只写对应 `message.swipe_info[swipe_id].extra.bioweave`，包括 swipe `0`；没有 swipe 结构时才使用 `message.extra.bioweave`。
- `story_time` 是结构化存储对象；`display` 只由 formatter 显示。排序和计算只使用 `normalized`、`day_index` 等结构化字段，无法可靠获取时保存 `null`。SevenDaysCal 只能通过公开、可注入的 Adapter 使用，缺失时降级到 BioWeave Fallback StoryTimeProvider。
- `counterpart_ids` 与 `gestational_subject_ids` 永远是数组，可为 0/1/N；Event type 保留现有其它类型兼容，但本阶段只实现 `sexual_activity` 的 Tracking 闭环。
- `true`、`false`、`null` capability 三态不可压缩；`null` 不能变为 `true`。不以 gender、receiver、攻受、姓名或 NSFW 单独推导 Subject。
- StateReducer、Snapshot、Projection、Genealogy、完整妊娠计算、Gestational Age 和预计分娩日不在本阶段接通；对应页面/领域模块保持空状态或兼容骨架。

### Floor / Swipe / Version 生命周期

自动分析继续使用现有 `analysis_interval` 的 N-floor 规则。目标 Floor 先比较六字段 Floor Version：相同成功版本跳过，版本变化或失败允许请求，UI mount/open/reopen/init 不触发请求。手动刷新始终强制请求；成功替换当前 Floor Version 的旧成功 Event，失败保留旧成功结果，但旧版本 Event 不能进入当前有效 Registry。

删除 Floor、切换 Swipe、Event 编辑/删除或 Chat 切换后，Runtime/Storage 必须以当前有效 Floor-bound Event 重建 Registry，不留下 dangling `event_id`。Event 删除是真删除，不新增 `user_override` priority layer。失败分析不得写入半结构化 Event。

### Event Analysis Runtime API

`createRuntime()` 对 UI 暴露 `analyzeCurrentFloor({force})`、`analyzeFloor(target, {force})`、`refreshCurrentFloorAnalysis()`、`requestAbortCurrentFloorAnalysis()`、`getCurrentFloorAnalysisStatus()`、`getCurrentFloorEvents()`、`getTrackingRegistry()`、`collectActiveBusinessData()`、`updateEvent()` 与 `deleteEvent()`。当前楼层始终是当前 Chat 最后一条消息的 active Swipe；指定消息优先按稳定 `message_id` 匹配，不能直接假定 lifecycle payload 的 `message_id` 是数组下标。

`collectActiveBusinessData()` 的 `analysis_status` 至少包含 `state`、`busy`、`current_floor`、`floor_version`、`attempt`、`last_success`、`last_error`、`event_count`、`active_event_count`、`sexual_activity_count`、`tracking_subject_count`、`current_floor_events`、`active_events`、`tracking_decisions` 与 `registry_summary`，并在有执行记录时提供 `error_stage`、`error_code`、`safe_error_summary`、`started_at` 和 `finished_at`。`running` 只存在于 Runtime transient execution，不作为持久历史状态；终止分析使用 Runtime AbortController，迟到结果不能写回 Floor 或 Registry。该 DTO 只包含结构化、可脱敏显示的数据；Raw AI Response 与 API Secret 不写入 Chat。

UI 只能调用这些 API 并显示 busy/success/error。不得在 `ui/app.js` 或页面模块重新实现 Floor Version 有效性、Event normalize/validate、Tracking eligibility 或 Registry rebuild。强制刷新失败时，Runtime 写入失败状态，但保留同一 Floor Version 的上一份成功 Events；UI 不清空事件或人物。

### 页面职责

`ui/characters.js`、`ui/events.js` 和 `ui/overview.js` 只负责展示或提交业务 DTO：人物详情展示稳定 ID、可用 species/type、已知 capabilities、exposure Event 和“等待状态引擎计算”；事件页展示真实 Event 的 Story Time、Floor、Location、Participants、Reproductive Roles、Pregnancy Relevance、Status、Confidence 和 Source；总览统计分别来自 Registry 与当前有效 Event。页面不伪造 probability / gestational age，也不根据文本重新判断资格。

## 推荐实施顺序

1. SillyTavern Adapter 与 Chat-local Storage。
2. UI Foundation：魔法棒入口、documentElement-level overlay、响应式壳、主题与生命周期。
3. API Profile、Secret 引用与测试连接。
4. BiologicalEvent schema、normalize / validate、结构化 Story Time 与 Tracking Registry 纯逻辑。
5. 固定 Event Analyzer、Floor-bound Event 持久化与 N-floor / Floor Version 生命周期。
6. Event CRUD 和 Characters / Events / Overview 真实 DTO 接线。
7. State Reducer。
8. Snapshot restore、Projection 和 Genealogy。
9. Worldbook + Prompt Pipeline 与后续分析任务。
10. Tavern Context。

## UI Foundation 手工验收

以下步骤需要在更新后的真实 SillyTavern 页面执行。BioWeave 主窗口使用独立高层级宿主；不把“先手动关闭酒馆 drawer”作为打开主 UI 的前置条件。

### Desktop（>= 1200px）

1. 点击输入区附近的魔法棒。
2. 在 `#extensionsMenu` 点击 BioWeave。
3. 确认出现左侧完整导航和多人总览；关闭后再次从同一菜单打开。
4. 确认总览、人物、事件、推演、家系、世界模型、设置均可进入，并切换跟随酒馆、日、夜主题。

### Tablet（768–1199px）

1. 将窗口或 iPad viewport 调整到约 1024×800。
2. 重复魔法棒 → `#extensionsMenu` → BioWeave。
3. 确认导航变为顶部紧凑布局、内容区保持可滚动，关闭/重开不丢失 overlay。
4. 检查三主题和人物详情壳，没有横向溢出。

### Mobile（< 768px）

1. 将 viewport 调整到约 390×844；无需先手动关闭酒馆 drawer。
2. 重复魔法棒 → `#extensionsMenu` → BioWeave。
3. 确认单列页面和底部“总览 / 人物 / 事件 / 推演 / 更多”导航出现。
4. 点击“更多”，确认真实菜单可进入家系图谱、世界模型、设置、分析状态。
5. 检查底部安全区、关闭/重开、三主题和页面没有普通横向滚动。

## Phase 2A 验证与真实宿主验收

实现波次完成后，自动检查至少应覆盖固定 Event JSON 的拒绝/写入边界、0/1/N Subject、0/1/N counterpart、gender 不决定能力、`null` 不变 `true`、无受孕暴露、重复 Event、Event 编辑/删除、Floor 删除、Swipe 切换、Floor Version 替换以及手动刷新成功/失败。文档波次不把这些待实现回归写成已经通过的测试。

自动检查不能证明真实 SillyTavern 行为。人工验收仍需在刷新或重装后的实际插件中完成：验证宿主 EventEmitter 与消息 `extra` / `swipe_info` 形状、自动 N-floor 触发、相同 Floor Version 去重、UI 重复打开不重复请求、失败重试、手动刷新替换/保留、Floor 删除与 Swipe 切换、Event 编辑/真删除、SevenDaysCal 可用/不可用时的 Story Time，以及 Desktop / Tablet / Mobile 页面无横向溢出。完成人工验收前不应把 Phase 2A 描述为完整妊娠状态能力。

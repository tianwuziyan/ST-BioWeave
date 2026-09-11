# BioWeave UI

无头像、轻量、继承 SillyTavern Theme Variables。

一级页面：总览 / 人物列表 / 历史事件 / 推演预测 / 家系图谱 / 世界模型 / 设置。

Desktop：左侧完整导航。Tablet：顶部紧凑导航。Mobile：总览/人物/事件/推演/更多，触控目标至少 44px；更多菜单包含家系图谱、世界模型、设置和分析状态。

主 UI 由输入区魔法棒 → #extensionsMenu → BioWeave 打开；#extensionsMenu 只承载入口，主 UI 挂载在稳定的 `document.documentElement` 下，结构为 `bioweave-overlay / bioweave-panel`。入口 click 同步打开预挂载宿主，酒馆关闭菜单不会移除主 UI。

设置页先选择 API 来源：使用 SillyTavern 当前 API，或使用 BioWeave 独立 API。独立 API 的 Profile 编辑器只显示 Profile、Provider、API URL、API Key 和 Model；超时和重试属于 API 来源下的全局请求设置，修改后通过 change 事件即时保存，不写入 Profile 或 Chat。超时对用户显示为秒，插件设置中保存为毫秒。Model 优先通过“刷新模型”从 SillyTavern custom status 接口获取并在可搜索、可滚动列表中选择，手动输入只作为回退；“测试连接”与刷新模型分开，均不保存当前 draft。保存成功后只显示安全配置摘要，API Key 不回填。世界分析、事件分析、推演、历史扫描的任务分配独立于连接参数，可跟随默认、使用当前 API、指定独立 Profile 或不使用 API。

设置页的“世界书来源”区域读取当前 Chat 的角色卡字段、角色关联世界书和可用的全局世界书。世界书按书展开到条目，角色卡按实际字段拆分；每个条目/字段使用独立 checkbox，选择使用稳定 `source_id` + `entry_id` 或 `field_key`。搜索、全选、全不选、刷新、已选数量和 token estimate 都只作用于选择器内存目录。

“世界模型”页面使用已选择的 AnalysisInput 生成当前 Chat 独立的生物学规则。用户人物设定不参与 World Model 判断；角色卡、世界书以及可选的剧情/记忆证据用于识别生物规则和当前世界医疗条件。页面按“物种 → 性别 / 生殖类型”展示嵌套结果，编辑器也按同一层级增删和保存。species 识别与 biological type 识别分开：资料只呈现默认男性/女性二元或其它人类常规身体/生殖证据、没有明确非人类证据时，可以建立“人类” species，但识别 species 本身不自动创建任何 type；每个 type 只来自资料实际出现或规则明确描述存在的分类。固定的双性分类统一显示为“双性”；临时双性化、身体改造、单个人的性别模糊和种族/属性/来源别名不占用 type。明确的非人类证据按资料实际内容分别建立 species，类型名称保持开放并支持用户自定义分类。非人类 type 必须有同一 species 上下文中的直接或低推断证据。每个 biological type 的能力逐项按证据或适用的人类基线判断，未知保留为 `null`，不从名称、性别、代词、称谓、外貌或身体形态推断；非人类没有字段级机制证据时不会复制现实人类男女模板。人类基线只在对应的人类 type 已建立后使用，优先级为剧情事实 > 世界/世界书规则 > 个人例外 > 人类基线；非人类没有直接机制证据时保持未知。页面显示当前模型、最后分析时间、来源摘要、医疗条件和临时分析输入预览；失败或无效的 AI 结果不会覆盖上一份成功模型。手动编辑保存后成为当前 Chat 的权威版本。World Model v1 不进入 Floor、Event、Projection 或 Context 注入。

设置页的“分析提示词”是所有 BioWeave AI Analysis 共用的用户自定义层，保存于全局 `analysis_prompt`，提供可编辑的顶部 SYSTEM、公共补充、输入前后说明和尾部 SYSTEM；补充内容可以留空。固定 BioWeave Core、World/Event 等任务契约、输出 JSON Contract、Validator Contract 和 `AnalysisInput` 的实际资料由代码保留，用户不能覆盖；旧 `world_analysis_prompt` 只作为迁移读取来源，保存后只写 canonical 字段。World Analysis 使用公共分析提示词，但不把 User Persona 正文作为世界规则证据；Event Analysis 使用公共分析提示词，并读取经过清理的 Persona context。调试预览可切换查看 World Analysis 与 Event Analysis 的最终 messages，区分公共层、任务层和输入层，不显示 Secret。

“最近剧情”是独立折叠设置，内部按截图式结构分为读取设置、正则提取与清洗、使用提示三张紧凑卡片；读取设置只填写读取楼数，`0` 表示不读取。规则启用状态使用可访问的自定义 Switch，而不是浏览器默认 checkbox。正则区分“全局正则”和“当前角色卡正则”：全局规则适用于所有角色卡，当前角色卡规则只随当前 Chat 保存；两组规则均支持新增、删除、上下移动和启停，执行顺序固定为全局正则→当前角色卡正则。正则默认不处理 USER 楼，可单独开启；0 楼开场白始终保留原文。最近剧情请求只发送实际提取出的正文，不附加楼层标题或 `[Floor · role]` 包装。“外部记忆来源”是独立设置，显示 Anima、柏宝书和数据库记忆及其公开接口检测状态。最近剧情和外部来源不伪装成世界书条目，也不在本阶段进入 Tavern Context 注入。

人物列表可以进入 Tracking Subject 的人物详情单页人物卡，详情只改变 UI focus，不改变 Chat Scope。人物卡按固定顺序同时显示：人物摘要（Summary）、生殖能力（Reproductive Capabilities）、当前状态（Current State）、受孕相关记录（Related Events）、推演（Projection）、关系（Relations）和备注（Notes）；这些是连续纵向 section，不是互斥 Tab。详情入口唯一门槛仍是当前 Chat 的 `tracking_subjects` 中存在对应 `character_id`，单独存在的 `character_profiles` 不会创建详情入口。

人物详情的 section 只展示 Runtime/Core 已提供的 DTO 或明确空状态：受孕相关记录沿 Tracking Subject 的 Event 引用显示事件类型、状态、时间、地点和唯一的“相关对象”；“相关对象”只由 canonical Event 的 `counterpart_ids[]` 映射，不显示全部 participants，也不读取 protection、physical_effect、capability 或 event_role 做判断。当前状态、推演、关系和备注在尚未接入对应 State / Projection / Relations / Notes DTO 时显示约定的等待/空状态。UI 不在详情层推导 Tracking eligibility、妊娠状态、概率、孕周、Story Time elapsed 或任何 StateReducer、Projection、Genealogy 结果。

## Phase 2A 业务页面契约

### 人物列表与 Tracking Subject

人物列表不是当前 Chat 的全角色列表，只显示当前 Chat 中已经进入妊娠相关追踪流程的 active Tracking Subjects。普通出场角色、当前主卡角色、只有姓名的参与者和 capability 为 unknown 的参与者不会因为出现在 Chat 中就进入列表。对 `sexual_activity`，`BiologicalEvent.participants[]` 只记录 actual reproductive exposure chain 的直接参与者，不等于 Tracking Subject；Character Profile 也不等于人物列表实体。

进入列表由业务层依据 BiologicalEvent、World Model、Narrative Evidence 和 reproductive capability 决定；UI 只接收并展示 Registry 结果，不根据 gender、攻受/receiver、姓名、参与者文本或 NSFW 标记二次推导资格。

没有 Subject 时必须区分业务状态：当前 Floor 尚未分析时显示“尚未完成事件分析”与“分析当前楼层”；分析成功但 Registry 为空时显示“当前没有需要妊娠追踪的角色”，并展示 Runtime 提供的 active Event、`sexual_activity` 与 Subject 数量。失败时显示错误摘要，并明确旧成功事件仍可保持有效。Tracking Decision reason code（例如 `CAN_CARRY_PREGNANCY_UNKNOWN`）只来自 Core selector，用于 Debug 或 Analysis Detail；普通人物列表不读取这些诊断，UI 也不重新执行资格判断。

人物详情至少显示人物名称、可用的物种/生理类型、已知 reproductive capabilities、所有 exposure Event 引用及其可读事实，并显示“等待状态引擎计算”。稳定 `character_id` 和其它技术字段可以放入折叠的调试信息。本阶段不得伪造 probability、妊娠状态、Gestational Age 或预计分娩日。

### 历史事件页

事件页消费当前有效的 `BiologicalEvent[]`，不是另建 UI 事件账本。普通卡片默认以用户可读语言显示事件类型、状态、Story Time、Location、canonical Participants、妊娠相关性、Confidence 和简短证据；Reproductive Role 使用可读标签，事件 ID、Source、结构化时间和其它 raw 字段放入折叠的详情/调试区。底层 Source 仍只读，并保留其 Chat、Message、Floor、Swipe、content hash 和 message version 绑定。人物 exposure card 不重新计算 actual exposure，只显示 `counterpart_ids[]` 投影出的相关对象。

当当前 Chat 没有 Event 时，页面必须区分“当前楼层尚未分析”和“当前楼层已分析成功但 0 Event”，并提供调用生产 Runtime pipeline 的“分析当前楼层 / 重新分析当前楼层”入口。

Event 的 actual reproductive exposure 事实只存在 Floor-bound Event；页面显示人物 exposure 时通过 `event_id` 引用读取 Event，不把完整事件对象复制进人物卡。`counterpart_ids` 和 `gestational_subject_ids` 始终按数组渲染，空数组、单项和多项都必须可显示。

Event 编辑直接修改当前有效事实并保留 `event_id` 与 authoritative Source；删除是真删除，不新增 `user_override` priority layer。保存和删除完成后由业务层重建 Tracking Registry，UI 不自行补齐或删除 Subject。

### Story Time 显示

Story Time 持久化为结构化对象：`display`、`normalized`、`calendar_id`、`day_index`、`provider`、`precision`、`confidence`。UI 的 formatter 只显示 `display` 或未知/模糊时间文案，不从 display 反向解析排序或计算；`normalized` / `day_index` 不可靠时显示对应未知状态。SevenDaysCal 不可用时展示 Fallback provider 的结构化结果，不能伪造准确日期。

### 总览、推演与家系

总览的人物数量与人物卡来自 Tracking Subject Registry；事件数量和最近事件来自当前有效 BiologicalEvent。总览不得用 Chat 全角色数、名字扫描或 UI 过滤结果代替 Registry。

总览的 Event Analysis 状态卡显示当前 Floor、六字段 Floor Version、`not_analyzed/running/success/failed/cancelled`、最近成功时间、当前 Floor Event 数、Tracking Subject 数和错误摘要。运行中按钮保持可点击并显示“分析中… · 点击可终止”；二次点击通过 SillyTavern confirm Popup 请求 Runtime 取消，拒绝确认不改变执行。轻量详情使用脱敏后的 Runtime DTO，包含 Execution Status、Stage、Attempt、Started At、Finished At、Error Code、Safe Error Summary、解析后的当前 Floor Events 与 Registry 摘要；不永久保存或默认展示 Raw AI Response、请求头或 Secret。主动取消显示信息提示，且保留上一份有效 Event/Tracking 结果。

Projection、Genealogy、StateReducer、Snapshot 和完整妊娠计算在本阶段保持 Empty State 或兼容骨架。页面可以显示“等待后续状态引擎”类说明，但不得生成 mock 业务 DTO、概率、妊娠天数或亲子关系。

### 生命周期与刷新

页面 mount、open 和 reopen 只读取当前 Chat 的业务 DTO，不单独触发 Event Analyzer。Runtime 在 extension init 时绑定 SillyTavern lifecycle；即使 overlay 从未打开，`MESSAGE_RECEIVED`、`GENERATION_ENDED` 及编辑/Swipe 事件仍按 N-floor 和六字段 Floor Version 调度。相同成功版本跳过，失败可重试，手动刷新强制请求。手动刷新成功替换当前 Floor Version 的 Event，失败保留旧成功结果，但旧版本 Event 不得进入当前有效 Registry。所有 terminal branch 都必须退出 running；取消或 stale Chat 后的迟到响应只能被忽略，不能覆盖新执行或重建 Registry。

删除 Floor、切换 Swipe、Event 编辑/删除或 Chat 切换后，Characters、Events、Overview 都必须重新读取当前有效 Event 和 Registry；不存在事件的 Swipe 不得显示旧 Swipe 的人物或事件。

Desktop / Tablet / Mobile 均提供跟随酒馆、日、夜主题按钮。主题使用 BioWeave CSS variables，选择持久化但不修改 SillyTavern 本身主题。

Event 可编辑删除；Projection 仅删除。Phase 2A 业务页只允许使用真实 DTO 或明确 Empty State；现有路由壳未接入真实数据时，不得把 `demo-character-1` 或其它占位 DTO 当作当前 Chat 的人物、事件或总览统计，也不得写入 Chat。

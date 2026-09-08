# BioWeave UI

无头像、轻量、继承 SillyTavern Theme Variables。

一级页面：总览 / 人物列表 / 历史事件 / 推演预测 / 家系图谱 / 世界模型 / 设置。

Desktop：左侧完整导航。Tablet：顶部紧凑导航。Mobile：总览/人物/事件/推演/更多，触控目标至少 44px；更多菜单包含家系图谱、世界模型、设置和分析状态。

主 UI 由输入区魔法棒 → #extensionsMenu → BioWeave 打开；#extensionsMenu 只承载入口，主 UI 挂载在稳定的 `document.documentElement` 下，结构为 `bioweave-overlay / bioweave-panel`。入口 click 同步打开预挂载宿主，酒馆关闭菜单不会移除主 UI。

设置页先选择 API 来源：使用 SillyTavern 当前 API，或使用 BioWeave 独立 API。独立 API 的 Profile 编辑器只显示 Profile、Provider、API URL、API Key 和 Model；超时和重试属于 API 来源下的全局请求设置，修改后通过 change 事件即时保存，不写入 Profile 或 Chat。超时对用户显示为秒，插件设置中保存为毫秒。Model 优先通过“刷新模型”从 SillyTavern custom status 接口获取并在可搜索、可滚动列表中选择，手动输入只作为回退；“测试连接”与刷新模型分开，均不保存当前 draft。保存成功后只显示安全配置摘要，API Key 不回填。世界分析、事件分析、推演、历史扫描的任务分配独立于连接参数，可跟随默认、使用当前 API、指定独立 Profile 或不使用 API。

设置页的“世界书来源”区域读取当前 Chat 的角色卡字段、角色关联世界书和可用的全局世界书。世界书按书展开到条目，角色卡按实际字段拆分；每个条目/字段使用独立 checkbox，选择使用稳定 `source_id` + `entry_id` 或 `field_key`。搜索、全选、全不选、刷新、已选数量和 token estimate 都只作用于选择器内存目录。

“世界模型”页面使用已选择的 AnalysisInput 生成当前 Chat 独立的生物学规则。用户人物设定不参与 World Model 判断；角色卡、世界书以及可选的剧情/记忆证据用于识别生物规则和当前世界医疗条件。页面按“物种 → 生物学 / 生殖类型”展示嵌套结果，编辑器也按同一层级增删和保存。species 识别与 biological type 识别分开：资料只呈现默认男性/女性二元或其它人类常规身体/生殖证据、没有明确非人类证据时，可以建立“人类” species，但识别 species 本身不自动创建男性、女性或双性/间性 type；每个 type 只来自资料实际出现或规则明确描述存在的分类。明确的妖、魔、剑灵、精灵、兽人或其它非人类证据优先并各自建立 species，类型名称开放支持 Alpha、Beta、Omega。每个 biological type 的能力逐项按证据或适用的人类基线判断，未知保留为 `null`，不从名称、性别、代词、称谓、外貌或身体形态推断。页面显示当前模型、最后分析时间、来源摘要、医疗条件和临时分析输入预览；失败或无效的 AI 结果不会覆盖上一份成功模型。手动编辑保存后成为当前 Chat 的权威版本。World Model v1 不进入 Floor、Event、Projection 或 Context 注入。

设置页的“世界分析提示词”只提供 World Analysis 的可编辑补充内容；补充内容可以留空。固定生物学约束、输出字段校验和 `AnalysisInput` 的实际资料由 BioWeave 保留；用户人物设定不会进入 World Model 请求。调试预览与请求使用 `system → system → assistant → user` 消息分层：固定约束、角色卡/世界书资料、实际提取出的最近剧情正文、最后分析任务分别显示；每段消息都可独立展开查看，不发送格式围栏或完整 schema 代码块，也不在最近剧情正文外附加楼层标题。

“最近剧情”是独立折叠设置，内部按截图式结构分为读取设置、正则提取与清洗、使用提示三张紧凑卡片；读取设置只填写读取楼数，`0` 表示不读取。规则启用状态使用可访问的自定义 Switch，而不是浏览器默认 checkbox。正则区分“全局正则”和“当前角色卡正则”：全局规则适用于所有角色卡，当前角色卡规则只随当前 Chat 保存；两组规则均支持新增、删除、上下移动和启停，执行顺序固定为全局正则→当前角色卡正则。正则默认不处理 USER 楼，可单独开启；0 楼开场白始终保留原文。最近剧情请求只发送实际提取出的正文，不附加楼层标题或 `[Floor · role]` 包装。“外部记忆来源”是独立设置，显示 Anima、柏宝书和数据库记忆及其公开接口检测状态。最近剧情和外部来源不伪装成世界书条目，也不在本阶段进入 Tavern Context 注入。

人物列表可以进入人物详情壳：状态 / 事件 / 推演 / 关系 / 备注。人物详情只改变 UI focus，不改变 Chat Scope。

Desktop / Tablet / Mobile 均提供跟随酒馆、日、夜主题按钮。主题使用 BioWeave CSS variables，选择持久化但不修改 SillyTavern 本身主题。

Event 可编辑删除；Projection 仅删除。当前业务页允许使用 empty state 或明确的 demo DTO，但不得把占位数据写入 Chat。

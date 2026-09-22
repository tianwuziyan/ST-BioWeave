# World Analysis 首次默认输入选择

## 目标

为当前 Chat 的 World Analysis source selection 增加一次性、Chat-local 的默认初始化：首次成功加载可用分析来源时，默认选择当前实际使用的角色开场白，以及 Character-owned Character Lorebook 中未命中默认排除规则的全部条目。

初始化完成后，selection 完全由用户控制。World Model 是否存在、World Analysis 是否成功、Full/Patch/Auto/Reuse、UI 重开、source refresh 或插件重载都不得重新应用默认规则。

## 背景与已确认事实

- 当前 selection 持久化在 settings.worldbooks，默认是 {mode: 'selected_only', selected: []}。
- 当前 selection identity 是 source_id + entry_id，角色卡字段使用 source_id + field_key。
- 当前 greeting 通过首条 Character message 的 swipe_id 判定，并在 source field 上产生 is_current === true。
- 当前 World Analysis 与 Full/Patch 共用 collectCurrentAnalysisInput → collectAnalysisContext → buildAnalysisInput → World Prompt 路径。
- 当前 normalizeWorldbookEntries() 没有保留独立的 comment、keys、secondary keys metadata，无法可靠执行默认排除。
- 首次默认范围严格限定为 character_card；character 是 Character additional Lorebook，仅作为可手动选择的分析来源。全局、Persona、Chat 和 other 来源同样必须排除在首次默认范围之外。

## 功能需求

### R1：明确的一次性初始化状态

在 settings.worldbooks 下增加明确的 Chat-local 初始化语义，字段名采用 selection_initialized。

缺失字段表示尚未初始化；不得使用 selected.length === 0 推断状态。

初始化事务成功后，即使 selected 为空，也必须保存 selection_initialized: true。

### R2：默认 source 范围

首次初始化只处理 character_card。

character additional Lorebooks（`character`）继续发现、展示、手动选择、持久化并进入 AnalysisInput/Full/Patch，但首次默认不勾选。

不得默认选择 selected_global、Global World Info、Persona Lore、Chat Lore、other 或未确认来源。

仍使用 mode: selected_only；不得以 mode: all 代替默认选择。

### R3：当前 greeting

只默认选择 is_current === true 的 greeting，不默认选择所有主/alternate greetings。

无法可靠判定当前 greeting 时，不得静默 fallback 到 opening:main；greeting 保持未选中，但 Character Lorebook 初始化仍可继续，并可记录非阻断 diagnostic。

### R4：默认排除

默认排除词为：状态、手机、NSFW、cot、玩法、超雄、思维链。

排除规则仅用于首次默认选择。用户之后仍可手动取消任何已选条目或重新勾选任何默认排除条目。

排除匹配只作用于 normalized entry metadata：comment、keys、secondary keys。不得匹配 content、整个 entry JSON、uid/id 或 source id。

中文使用 Unicode 安全的直接包含匹配；英文关键词大小写不敏感。cot 与 NSFW 必须避免普通英文单词内部的偶然 substring 命中，例如 cotton 不应因包含 cot 被排除。

### R5：Chat-local 与异步隔离

初始化必须绑定当前 Chat owner/token。Chat A 的异步 source load 返回时如果当前 Chat 已切换为 Chat B，不得修改 Chat B。

Character 切换、Chat 切换和 source refresh 不得触发第二次默认初始化；新增来源或新增 entry 也保持未选中，除非用户手动选择。

### R6：失败事务

只有默认 selected 与 selection_initialized: true 一次性成功保存到正确 Chat 后，初始化才算完成。

source load 失败、无法确认当前 `character_card` primary（若存在）已完成 hydrate、saveChat 失败、Chat/Character owner stale 或当前 Chat 已切换时，不得写入 initialized；additional/global/other 的 deferred content 不属于首次 completeness gate。

失败时不得留下 selected 已写入而 initialized 未写入的半初始化状态；UI/runtime 保留旧 selection。

### R7：分析 DTO 边界

为 selection policy 增加的 metadata 不得自动进入 AnalysisInput 或 World Prompt。Full/Patch 仍只发送当前真正选中的 entry content 与现有必要显示字段。

### R8：不变边界

本任务不得修改 World Model、BiologicalEvent、StateReducer、Snapshot、Projection、analysis interval、Full/Patch 业务定义、Character/Event pipeline、Character Floor ownership、Projection Context，也不得写入 Character Card 或 SillyTavern World Info 原始数据。

## 验收标准

1. 新 Chat 首次 source load 后，current greeting 被选中，非 current greetings 不被选中。
2. 无法确定 current greeting 时不选择 main，Lorebook 默认初始化仍可完成。
3. character_card 的符合条件 entry 被默认选择；character additional Lorebook、其它来源不被默认选择，但 character 仍可手动选择。
4. comment、keys、secondary keys 命中排除词时首次不选；content 单独命中时仍默认选择。
5. cot 不会误伤明显的英文单词内部 substring，并支持大小写不敏感匹配。
6. 初始化后用户取消、重新勾选或全部取消的选择在 reload、refresh、失败、重试、Full、Patch、Auto、Reuse 和重开 UI 后保持不变。
7. selection_initialized: true 且 selected: [] 不会再次初始化。
8. Chat A/B、Character 切换和异步 stale 返回不会串写 selection。
9. entry 顺序、comment 或 content 改变但 uid/id 不变时，selection identity 保持；重复 label 不串项。
10. Full/Patch Prompt 只消费 selected entries；默认排除项不进入，手动重新勾选后进入。
11. persistence 失败不会产生 initialized=true 或半初始化 selection。

## 范围外

- 不为没有显式 uid/id 的 Character Book entry 引入 content hash、模糊匹配、名称匹配或 migration guessing。
- 不把默认 policy 持续应用于后续新增 source/entry。
- 不建立 compatibility layer 来维护互相矛盾的旧默认语义；旧 Chat 缺失 initialized 只表示尚未初始化。

## 规划决策

- 采用 settings.worldbooks.selection_initialized 作为明确状态。
- 初始化触发点位于 sources 首次成功加载完成后、World Analysis 请求之前。
- 初始化逻辑属于 Chat-local configuration initialization，不进入 Analyzer、Prompt builder、buildWorldbookInput()、render 或 World Full/Patch handler。
- metadata 采用 BioWeave 统一字段命名，不长期同时保存 SillyTavern 的多套 alias；stable identity 继续使用现有 source_id + entry_id。

## 阻塞问题

无。用户已明确产品范围、current greeting 无法判定时的行为、metadata 边界、cot 匹配边界、失败事务和测试要求。

# 修复自动分析中的 World Model 依赖顺序与增量更新

## 目标

建立自动分析的硬依赖顺序：当前 Character Floor 必须先解析出当前 Floor 最终有效、已校验且已规范化的 World Model，之后才允许启动 Character / Event Analysis。首次没有 World Model 时自动运行首次 World Analysis；已有模型默认复用，仅在明确 world-relevant evidence 或手动 refresh 时执行 World Model 更新。World 更新必须是当前 Floor 上的增量 patch 合并，不能用 AI 重写的完整模型覆盖旧规则。

## 用户价值

防止 AI 在缺少世界规则时依据现实人类常识、Character Card 性别或旧默认能力猜测 species、biological_type、reproductive capabilities 和 mechanism compatibility，避免生成不可追溯的人物数据和事件事实。

## 已确认的仓库事实

- `runtime/event-analysis.js` 已有 `resolveWorldModelAtOrBefore()`、严格前序解析和 `saveWorldModel()`；resolver 会校验 Character Floor、active Swipe、完整 Floor Version，并能在较新 Floor 删除后自然回退。
- `ai/analyzer.js` 已有 `analyzeWorldModel()`、JSON/schema parse/normalization 错误链和 `analyzeFloor()`；当前 analyzer 工厂同时暴露 World 与 Event 分析能力。
- `ai/prompts.js` 已有 World Model 完整生成 prompt/schema，以及 Event prompt 中的 World Model 说明，但 Runtime 目前允许 `world_model: null` 进入 Event Analysis。
- `runtime/event-analysis.js` 的 `buildFloorAnalysisInput()` 当前只读取严格前序 World Model；`runAnalysis()` 随后直接调用 Event Analyzer 并保存 analysis/events/registry。
- World Model 的 Floor 保存已经只更新 `world_model` / `world_model_meta`，保留 Character/Event 字段；生命周期和 provenance 规范要求不得使用 Chat-level World Model 作为事实源。
- 当前测试已覆盖 World Model parser/normalizer、Floor resolver、保存隔离、删除回退、stale Chat Event Analysis；未覆盖自动 World Analysis 依赖顺序与增量 patch。

## 需求

### R1 当前 Floor 的自动分析顺序

当前 Character Floor 达到既有 analysis interval/触发条件后，Runtime 必须按以下顺序执行：resolve 当前 Floor → resolve 当前有效 World Model → 必要时运行 World Analysis 或 World Update → validate + normalize 并保存/确认当前 Floor 的最终 World Model → 将同一 DTO 显式传给 Character/Event Analyzer → Event validation → persistence → 既有 StateReducer/Tracking/Projection downstream。

不得修改既有 interval 判定、StateReducer 语义、Snapshot 算法、Contributor Attribution、Projection Persistence/Context、Genealogy 或 UI 结构。

### R2 World Model 缺失时 fail-closed

没有当前有效 World Model 时必须先运行首次 World Analysis。API、JSON parse、schema validation、normalization、stale Floor Version 或 save 任一失败，本轮返回明确可识别的 `WORLD_MODEL_UNAVAILABLE`（或项目现有等价错误），不得调用 Character/Event Analyzer，不得写入新的 Character Profile、analysis、Event、biological facts、registry 或 tracking-derived facts。

### R3 已有 World Model 的复用和更新 gate

已有最近有效 World Model 时默认复用，不因每个分析点重复调用 World AI。自动 World Analysis 仅在当前 Floor 存在明确 world-relevant evidence / stale signal 时触发；手动 refresh 可强制更新。没有可靠 signal 时采用保守复用。

### R4 首次生成与增量更新分离

首次没有 World Model 时允许使用完整 World Model prompt/schema 生成初始模型。已有 World Model 时必须使用独立的 patch prompt/DTO，只输出当前 Floor 新增或明确修正的 world facts；AI 不得接收“请返回合并后的完整模型”任务。最终 B 必须由程序执行 `validated A + validated Patch -> deterministic merge -> validate B`。patch 未提及的旧字段保持原样，永远不表示删除。若当前版本没有成熟 remove/invalidate contract，则本轮不支持自动删除旧规则；patch 为空时继续复用 A，不得得到空模型。

### R5 冲突、删除和历史 Floor

只有当前正文明确表达规则变化/旧规则错误，并且 patch contract 明确表达 `update` / `replace` / `remove` / `invalidate` 时才可改变旧规则。不允许因 patch 缺字段静默删除或 last-write-wins。World B 只保存当前 Floor；不得回写 World A 所在历史 Floor。删除保存 B 的 Floor 后，resolver 必须恢复最近 surviving A。

### R6 Character/Event 硬前置和 prompt

Character/Event 调用边界必须拒绝 null、未规范化或未验证 World Model，并显式接收本轮最终 World Model DTO。Event prompt 继续声明 World Model 是权威世界规则输入，species、biological_type、capabilities 和 compatibility 只能基于正文 + World Model；gender/sex 不能单独推导 capability；缺失 World Model 的请求在业务代码层不应发生。

### R7 Floor、User message 和 stale async

只允许当前有效 Character Floor/active Swipe 持有 World Model 与 Character/Event 结果；User message 不得触发 World/Character persistence。World Analysis 的请求、patch merge 和 save 必须沿用完整 Floor Version、Chat epoch、active Swipe 和 stale guard；返回到新 Floor/新 Swipe/新 Chat 的异步结果必须丢弃，不能写入任何 Floor。

## 验收标准

- A1 新 Chat 无 World Model 达到自动分析点时，World Analysis 先调用，成功保存最终模型后 Event/Character Analysis 才调用，并收到同一 normalized DTO。
- A2 World Analysis API/parse/schema/normalize/save/stale 任一失败时，Event/Character Analyzer 调用次数为 0，人物数据和 biological facts 不更新，结果包含 `WORLD_MODEL_UNAVAILABLE` 或等价诊断。
- A3 已有 World A 且当前 Floor 无 world-relevant evidence 时复用 A，不调用 World AI，Event/Character 正常运行。
- A4 当前 Floor 有明确新世界规则时先生成 World B；B 只保存当前 Floor，Event/Character 使用 B。
- A5 A + 单条新增规则 patch 保留 A 的所有既有规则；patch 漏字段、空 patch、无明确删除指令均不删除旧内容。
- A6 明确修正规则只替换对应规则；patch JSON/schema 无效时保留 A 且跳过 Event/Character。
- A6a Patch 合法但 deterministic merge 后 B 不合法时，整次 World Update 失败，不保存 B、不调用 Character/Event，A 与历史 Floor 不变。
- A7 删除保存 B 的较新 Floor 后 resolver 恢复 A，历史 Floor A 不被修改。
- A8 无 World Model 时不得写入 species、biological_type、reproductive_capabilities；gender/sex 不能推导 capability。
- A9 User message 不触发 World/Character persistence；stale async World Analysis 返回被丢弃。
- A10 通过 `npm run check`、相关测试、`node --check` 和 `git diff --check`。
- A11 Initial World Analysis 与 World Patch Analysis 是两个明确流程；Patch DTO、merge 位置、允许 add/update 字段和 remove 支持状态可审计；不存在 AI 返回完整模型覆盖旧模型的更新路径，也不存在无 World Model 调用 Character/Event AI 的路径。

## 范围外

Snapshot 算法、StateReducer 语义、Contributor Attribution、Projection Persistence、Projection Context、Genealogy、UI 结构、analysis interval 规则，以及与本调用顺序无关的旧数据迁移均不在本轮。

## 阻塞问题

无。world-relevant gate 采用最小保守实现：复用仓库已有 world evidence 入口/语义；无法可靠识别时不自动更新，保留手动 refresh 强制更新能力。

# 建立 Floor State Ownership 架构规范

## Goal

把 BioWeave 的 Floor 数据所有权、消息/Swipe 生命周期、previous-state 解析、derived state provenance 和 API 输入边界固化为项目级长期约束。以后新增疾病、药物、生殖、暴露或其他跨楼层功能时，设计者能够先判断事实的拥有者，并且不会把 Floor 历史事实悄悄复制成 Chat Metadata 的第二事实源。

## Scope

- 新增 `.trellis/spec/domain/floor-state.md`，作为 Floor State Ownership Contract 的唯一详细规范。
- 更新 `.trellis/spec/domain/index.md`、`event-pipeline.md`、`world-model.md` 和 `AGENTS.md` 的导航/入口关系。
- 在 `storage/store.js`、`runtime/event-analysis.js`、`core/tracking.js` 的真实架构边界补充少量短注释。
- 在现有测试体系中补齐或重命名表达架构不变量的回归测试。
- 不改变与本契约无关的业务 schema、UI、提示词语义或宿主兼容行为。

## Architecture Context

- `runtime/floor.js` 定义六字段 Floor Version，并让 Floor Events 只有在当前消息、active Swipe 和完整版本匹配时才有效。
- `storage/store.js` 通过统一 store 读取 Floor；有 Swipe 结构时按指定 `swipe_info[swipe_id]` 隔离，没有 Swipe 结构时读取普通 `message.extra`。
- `runtime/event-analysis.js` 已有从目标 Floor 之前寻找最近成功分析的路径，`ai/input-builder.js` 和 prompt 层负责把 previous BioWeave 送入 API 边界。
- `core/tracking.js` 与 runtime 会把有效 Floor Events 投影为 tracking/registry 等 Chat Metadata；这些字段的事实来源和失效规则需要由新规范统一约束。
- `last_processed_floor` 位于 Chat index，适合作为调度 hint，不应承担历史事实恢复职责。
- 参考项目 [ST-SevenDaysCal 的 `snapshot.js`](https://github.com/atonal519/ST-SevenDaysCal/blob/master/snapshot.js) 将快照绑定到 message，并为 Swipe 使用 per-swipe durable slot；本项目只借鉴这一所有权边界，不引入新的历史数据库。

## Requirements

### R1. Canonical Floor contract

`floor-state.md` 必须完整定义以下章节：Source of Truth、Floor lifecycle、Per-swipe ownership、Previous Floor Resolution、Derived State、Provenance、API Input Boundary、`last_processed_floor`、Mutation Safety 和 Feature Development Checklist。规范必须明确：Floor-derived analysis/events/facts 由 Floor/active Swipe 拥有；current valid Floors 是 derived runtime state、registry、UI model 和 API context 的唯一事实输入；Chat cache 与 runtime cache 不能恢复已不存在的 Floor facts。

### R2. Lifecycle and boundary rules

规范必须覆盖 message 删除、multi-floor 删除、Swipe 删除/切换、编辑导致的 Floor Version 变化、regeneration、history truncation、chat/plugin reload，并要求业务代码通过统一 Floor storage abstraction 访问 `message.extra` 与 `message.swipe_info[swipe_id].extra`。规范不得要求各业务调用方自行双写，也不得允许旁路的 `message.extra.xxx` 或 `chatMetadata.floors[mesId]` 写入。

### R3. Previous and derived-state rules

规范必须规定 previous 只能从当前聊天中向前找最近的 active-swipe、完整版本有效且 `analysis.status === "success"` 的 Floor；目标 Floor 自身旧结果、Chat Metadata、runtime cache、已删除 registry 和 `last_processed_floor` 都不构成 fallback。无合法 Floor 时 previous 必须为空。

规范必须区分 Chat Metadata 中的 authoritative configuration 与 derived state。tracking registry/subjects/candidates、event-derived character profile 部分、indexes、summaries 和 caches 只能由当前有效 Floor facts 重建；缓存不能反向成为事实源。混合型 profile/registry 只能按字段或来源分类，独立配置不因本规则被误删。

### R4. API provenance

规范必须要求所有发送给 AI/API 的历史 BioWeave facts 可追溯到当前仍存在且版本有效的 Floor；没有合法 previous 时 API input 必须真实表示 no previous state。`last_processed_floor` 仅能作为 cache/performance/UI hint。

### R5. Repository entry points

`AGENTS.md` 只保留简短的“BioWeave 数据所有权红线”和规范入口，不复制完整契约；触发范围必须覆盖 storage、floor、analysis、events、tracking、registry、character state、world state、API context 及任何新增跨楼层状态。`event-pipeline.md` 与 `world-model.md` 只保留自身领域内容，并在涉及 Floor-bound storage、event persistence、tracking、previous 或 derived state 的位置指向 `./floor-state.md`。

### R6. Executable contract

测试名称和断言必须长期表达以下 invariant：reanalyze N 不使用 N 自身 previous；删除 Floor 或 Swipe 后不能贡献 previous/API state；active Swipe 隔离；stale Floor Version 失效；无合法 Floor 时 previous 为空；derived registry 不含 orphan Floor facts。优先复用现有 fixture、store、runtime 和 tracking 测试边界，不为了测试建立第二套 fake ownership model。

## Acceptance Criteria

- [ ] 新规范包含用户要求的十个章节，并明确未来疾病状态追踪器的 Floor fact、derived current state、删除/Swipe/version 失效和 API provenance 结论。
- [ ] Domain index 有 Floor State 入口；event-pipeline/world-model 有 `./floor-state.md` 引用且没有复制另一套完整 ownership contract。
- [ ] `AGENTS.md` 在 Trellis managed block 外提供强制读取入口和五条绝对红线，正文保持精简。
- [ ] 关键 storage、previous-resolution、derived-registry 边界各有少量可操作注释，注释指向规范而非复制规范。
- [ ] 回归测试覆盖上述 invariants，并保持既有合法 Chat configuration、Event schema、identity 与 UI 行为不变。
- [ ] 运行并记录 repository-local Prettier、定向测试、`npm test` 和 `npm run check`；若未运行真实 SillyTavern 宿主，明确说明人工验收未包含在自动化结果内。
- [ ] 仅有本任务范围内的规范、入口、边界注释和 executable contract 变化；不新增永久 Floor ID 数据库或 README 架构副本。

## Out of Scope

- 继续扩展疾病/药物/生殖等具体业务功能。
- 重写 storage adapter、Event schema、identity model、World Model 或 UI。
- 把合法用户/角色/插件配置从 Chat Metadata 迁出。
- 提交、推送、合并或其他 Git 历史操作。

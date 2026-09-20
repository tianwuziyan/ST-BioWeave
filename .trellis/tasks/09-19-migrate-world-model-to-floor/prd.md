# 将 World Model 持久化迁移到 Floor Store

## Goal

World Model Floor migration does not merge the World Model domain with
Character/Event Analysis. Floor Store is shared infrastructure only.

将 World Model 的唯一历史真源从 Chat-level 元数据迁移到现有 Floor Store，使其和 analysis、events 一样绑定当前 message + active Swipe + 完整 Floor Version。当前楼层显示和历史 Event Analysis 都只能从目标楼层向前解析最近的 Floor World Model，不再读取或双写 `chat.world_model` / `chat.world_model_meta`。

本次迁移不把 World Model 并入 Character / Event Analysis。World Model 与 Character/Event 是两个独立业务域，只共享 Floor Version、Floor Store、owner slot、生命周期失效和通用历史遍历基础设施；Floor 是 storage container，不是统一业务 owner。

## Confirmed repository facts

- `storage/schema.js:683-710` 的 `emptyChat()` 目前仍创建 Chat-level `world_model` 与 `world_model_meta`；`emptyFloor()` 尚无这两个字段。
- `storage/store.js:793-935` 已统一负责普通 message 的 `message.extra.bioweave` 与 per-Swipe 的 `message.swipe_info[swipe_id].extra.bioweave` 读写，且旧 Floor 字段会自然透传。
- `runtime/event-analysis.js:757-850` 已有目标 Floor 解析、当前有效 Floor 扫描及 `findPreviousSuccessfulBioWeave()`；`buildFloorAnalysisInput()` 仍在 `:1488` 使用 `chatData.world_model`。
- `ui/app.js:1413-1437` 从 Chat 读取 World Model；`:1603-1669` 手动保存使用 `saveChat()`；`:1675-1770` AI 分析成功后也使用 `saveChat()`。
- `storage/lifecycle.js`、`docs/bioweave-data-lifecycle.md`、README 与数据模型文档仍把 World Model 描述为 Chat-local，需要同步为 Floor-owned 历史并区分正常 AI DTO 字段。
- 当前 Floor Version / mutation invalidation 已能使删除、编辑、Swipe 切换与 Swipe 删除后的 Floor 事实失效；目标是复用这套机制，不新增 World Model rollback ledger。
- 当前长期规范确认 Character/Event 的 `character_registry`、identity、BiologicalEvent、Tracking 与 World Model 的 prompt/parser/normalizer/evidence guard 属于不同业务边界；Event Analysis 只能消费已解析的 World Model DTO，不能拥有或修改 World Model。

## Requirements

1. 在 `emptyFloor()` 增加 `world_model: null`、`world_model_meta: null`；老 Floor 缺字段按 null 读取。
2. 从正常运行时持久化路径移除 Chat-level World Model 槽位、读取和写入；新数据只能通过 `store.getFloor()` / `store.saveFloor()` 保存到当前有效 Floor。
3. 提供统一的 Floor World Model 保存 helper，AI 分析与 UI 手动修改共用，并保留 Chat token、Floor Version、active Swipe 与异步 stale-result 防护。
4. 提供统一 resolver：从目标 Floor 沿当前 Chat 路径向前扫描，选择最近仍存在、active Swipe 匹配、Floor Version 有效且含 `world_model` 的 Floor；无历史时返回 null。当前 Floor 是否包含自身由明确调用语义决定：当前 UI 可读取自身，历史 Event Analysis 使用严格的 target 之前 Floor。
5. UI 当前世界模型以当前有效末楼为目标调用 resolver；不得使用 Chat-level fallback。
6. Event Analysis 构建目标 Floor 输入时传入 resolver 得到的历史 World Model，不能读取未来 Floor 或 Chat-level World Model。至少覆盖 F15 不读 F20/F30 的行为。
7. 删除/失效 Floor 或 Swipe 后不建立额外 rollback；resolver 自然返回更早有效 Floor 的 World Model。编辑或版本变化后的失效 Floor 不得贡献模型。
8. 保持 World Model 随现有 Floor Store 跟随 Swipe；切换、删除 Swipe 后分别读取或失去对应历史。
9. legacy Chat-level 数据采用保守兼容策略：不把无法定位时间点的旧 Chat 模型猜测迁移到任意 Floor，也不作为正常 runtime fallback；保留旧存档可读性所需的最小隔离/清理行为，并用测试明确“不迁移即不读取”。
10. 保留 AI input/output schema 中合法的 `world_model` DTO 字段；全局搜索后确认生产运行时没有 `chat.world_model` / `chat.world_model_meta` 作为状态源或新数据写入。
11. 更新与字段所有权、清除/失效和历史解析相关的 lifecycle/spec/docs，避免文档继续宣称 Chat-level World Model 是权威状态。
12. 明确业务边界：World Model 保存 helper 只能更新 `world_model` / `world_model_meta`；Character/Event 保存只能更新 `analysis` / `events` / `character_registry`；两者都必须 preserve 同一 Floor 中的其它业务字段，除非完整 Floor lifecycle invalidation 明确清除。
13. 增加 ownership regression：Character/Event 更新保持既有 World Model；World Model 更新保持既有 Events 与 Character Registry；Tracking rebuild 不写 World Model；只有明确的完整 Floor invalidation 才能同时清除不同业务域字段。

## Acceptance Criteria

- [ ] AI 分析成功只保存当前 Floor 的 `world_model` / `world_model_meta`，Chat 不新增或更新对应字段。
- [ ] 手动修改同样只保存当前 Floor，并复用同一保存边界。
- [ ] 当前楼缺模型时能找到最近更早 Floor；删除最新模型 Floor 后能自然回退到更早 Floor；不需要额外 rollback 数据结构。
- [ ] 不同 Swipe 可保存不同模型，切换读取对应历史，删除 Swipe 后不再读取其模型。
- [ ] 编辑、版本变化、删除或 Floor invalidation 后，失效 Floor 的模型不再被 resolver 或 Event Analysis 使用。
- [ ] Event Analysis 对目标 Floor 使用历史模型，不会读未来 Floor；没有历史 Floor 模型返回 null。
- [ ] 老 Floor 缺字段不报错；legacy Chat-level 模型行为有明确测试且不成为正常 fallback。
- [ ] 原有测试全部通过，并新增覆盖用户列出的 14 类持久化、解析、Swipe、失效、legacy 场景。
- [ ] 全局搜索确认生产代码不再把 Chat-level World Model 作为状态来源或写入目标；AI DTO/schema 中的字段仍保留。
- [ ] 文档明确 World Model 与 Character/Event 的允许依赖方向，且 resolver 位于 World/Floor resolution 边界，不成为 Character Registry helper。
- [ ] Ownership regression 覆盖跨域 preserve 与 lifecycle-only 联合清除行为。

## Out of scope

- 不改 World Model 的领域 schema、AI 证据边界或提示词语义。
- 不复制 ST-SevenDaysCal 的 `_mirrorToCurrentSwipe()`；不直接操作 message.extra / swipe_info.extra。
- 不新增 Chat cache、World Model rollback history、永久 Floor ID ledger 或第二历史数据库。
- 不进行与本迁移无关的 UI 重设计、Tracking 领域重构或 Event schema 变更。
- 不创建同时管理 World + Character/Event 的巨大 save/update helper；如需共享机械遍历，只允许抽取无业务语义的通用 Floor traversal primitive。

## Risks and deferred verification

- Node 测试无法替代真实 SillyTavern host 的 message/swipe 持久化行为；完成后仍需刷新插件并进行 Desktop/Tablet/Mobile 的真实 host acceptance。
- lifecycle/README/DATA-MODEL 的既有 Chat-level 描述必须与代码同一轮更新，否则会形成错误维护契约。

# BioWeave 数据生命周期清除与楼层失效机制

## Goal

在不触碰 BioWeave 全局配置的前提下，为当前 Chat 建立可长期维护的数据清除、Chat 边界隔离和楼层/编辑/Swipe 变更后的派生数据失效机制，避免旧状态复活、跨 Chat 污染和 dangling reference。

## Background and constraints

- 必须先以实际源码和测试审计 ST-SevenDaysCal 与本分支 BioWeave，再决定最终数据域；不能根据字段名猜测删除范围。
- `extensionSettings.bioweave` 中的 API Profiles、API Key/Secret 引用与 Secret Store、API Source、默认 Profile、任务 assignment、request settings、analysis prompt、插件级最近剧情正则及其它全局设置永远保留。
- 清除只允许作用于当前 Chat/角色卡会话的 BioWeave 数据；聊天正文、Swipe 正文和其它插件数据必须保留。
- 清除实现必须集中于 Clear Service/数据所有权定义，UI 不直接删除 storage 字段；清除结果结构化、幂等，明确保存失败不能假装成功。
- 必须严格区分普通切换与用户主动 Start New Chat：普通 `CHAT_CHANGED` 只加载目标 Chat、保留 source Chat；Start New Chat 是绑定 source Chat A 的 destructive operation，永久清除 A 的全部 BioWeave Chat-local、Floor-local、Swipe-local 和 derived 数据，然后让新 Chat B 从空状态开始。
- 清除、Chat 变更和消息/Swipe 变更必须让旧异步分析失效；旧响应不得写入新 owner 或已清除的数据。
- 需要同时建立仓库级 Data Lifecycle Contract、正式 docs 手册、AI 开发规则和生命周期 contract tests。

## Requirements

- 审计并记录真实数据地图：global、Chat-local、message-local、swipe-local、derived、runtime transient 及其 ownership/provenance。
- 建立与真实 schema 对齐的集中式 data-domain/ownership registry，至少覆盖人物、世界、事件、楼层分析、Swipe 分析、projection、history/snapshot、runtime 等实际域，并使新增持久化字段可被 contract test 检查。
- 提供统一清除 API：人物、世界、全部 BioWeave Chat-local 数据；保留历史事实或使其失效的语义必须由审计后的最终域设计决定。
- 人物清除后人物当前状态、tracking、人物派生结果和人物 runtime cache 不复活；世界模型、正文、全局配置按域规则保留。
- 世界清除后清理/标记所有 world-derived character reference，不能留下 dangling reference；人物独立数据和事件按最终域规则保留。
- 全部清除必须遍历所有 `message.extra.bioweave` 与所有 `message.swipe_info[*].extra.bioweave`，只删除 BioWeave 自有 Chat-local 数据，保留正文和其它插件字段。
- Start New Chat 必须锁定发起时的 source Chat identity/owner，在 ST 正式生命周期事件确认新 Chat 创建后清理 source Chat；不得把清理目标解析成事件发生时的 current Chat。source Chat 的正文、所有 Swipe 正文、其它插件数据和全局/API 配置必须保留。
- 必须研究并记录当前 SillyTavern 的 `doNewChat`、`CHAT_CHANGED`、`CHAT_CREATED` 和保存时序；没有可取消的 pre-new-chat 事件时，使用边界前捕获的 source snapshot/identity 与 source-targeted storage adapter，清理失败必须 fail closed、报告失败且不触碰新 Chat。
- Start New Chat 清理完成后，重新切回原 Chat A 时只能看到保留的正文/其它插件数据，BioWeave 数据不得复活；Chat B 以及所有 Swipe 都必须保持 BioWeave 空状态。
- 接入 `CHAT_CHANGED`、`MESSAGE_DELETED`、`MESSAGE_EDITED`、`MESSAGE_SWIPED` 等真实生命周期入口；删除/编辑按 provenance 或安全保守策略失效 earliest affected floor 之后的派生数据，Swipe 切换保留仍有效的非 active Swipe 源分析但重建 Chat-level 派生链。
- 清除期间支持 abort、owner/chat boundary token 或 epoch 校验、快照/rollback；明确持久化失败和 unknown save 状态，防止 silent corruption。
- 只在 BioWeave 设置页新增独立“数据管理”区域，集中提供清除人物、清除世界、清除全部三个操作；每项说明当前 Chat 的删除/保留范围，使用现有 Popup 二次确认、loading/disabled、防重复点击、成功 Toast/空状态刷新和明确失败反馈，不新增“清除并开始新聊天”按钮，也不使用 `window.confirm`。
- 增加覆盖清除、新聊天、已有 Chat 切换、楼层删除/编辑、Swipe、race、失败 rollback、全局配置不变和 registry 完整性的自动化测试。
- 新增 `docs/` 下正式 Data Lifecycle 手册，并在仓库 AI 开发规则中以短规则指向该文档；未来新增持久化字段必须同步声明 domain、ownership、clear/new-chat/mutation/swipe/async/test 行为。

## Acceptance Criteria

- [ ] 代码审计报告确认真实的 global/Chat/message/Swipe/runtime 数据域及所有持久化入口。
- [ ] Clear Service 的 domain registry、clear plan、结构化结果、owner/epoch 校验、async invalidation 和持久化错误路径均有代码与测试证据。
- [ ] 人物、世界、全部清除只影响允许的当前 Chat BioWeave 数据，且 API/Secret/全局设置、正文、Swipe 正文、其它插件数据保持不变。
- [ ] 普通已有 Chat 切换不会删除 source Chat；用户主动 Start New Chat 会以明确 source Chat A 为目标完成 destructive cleanup，且新 Chat B 只从空 BioWeave 状态开始；A 的 pending response 不能写回 A 或 B。
- [ ] Start New Chat 测试覆盖 Chat A 的 metadata、所有普通 message 与所有 Swipe slot 的 BioWeave 清除，正文/Swipe 正文/其它插件字段保留；切回 A、刷新页面、切换角色均不会恢复或误删 BioWeave。
- [ ] 消息删除、编辑和 Swipe 切换/编辑后，旧 floor/source 及 downstream derived state 不再被读取或复活；仍有效的源分析按设计保留。
- [ ] UI 只在设置页“数据管理”区域调用统一 Clear Service，具备当前 Chat 范围说明、Popup 二次确认、loading/disabled、成功/失败反馈和空状态刷新；不存在重复的 Start New Chat 按钮或直接 storage 删除。
- [ ] 生命周期 contract tests 能覆盖当前 Chat-local schema/registry；全球 fixture 在所有 clear API 前后 deepEqual。
- [ ] 完整自动化测试、静态检查和 git diff 审计通过；文档与代码域定义同步。
- [ ] 最终报告列出修改文件、最终架构、各清除范围、生命周期行为、并发保护、全局配置证明、测试结果和已知限制。

## Open questions

- 仅保留经过源码/测试审计后仍成立的技术不确定性；产品语义由用户本次需求给定，不能以猜测替代。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.

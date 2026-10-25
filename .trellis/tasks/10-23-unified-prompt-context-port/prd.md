# 统一 API Prompt 上下文资料端口

## Goal

复用世界书、人物资料、插件世界观、外部记忆与近期正文的统一读取和格式化边界，避免各 API 调用重复拼装与反复调格式。

## Background

- 当前不同分析任务会分别整理世界书、人物资料、插件世界观、外部记忆和近期正文，新增 API 调用时仍需重复调整标题、用途说明、中文标签、列表排版与消息角色。
- 用户希望这些资料完成一次规范化后即可被后续所有 API 调用直接复用；调整公共格式时，既有调用方应同步获得一致结果。
- 用户记得项目可能已经存在部分隔离或共享输入能力。本任务先审计现有实现和历史决策，再决定补齐或收敛边界，不默认新建平行体系。

## Confirmed Findings

- 既有隔离真实存在，但只完整覆盖“读取什么”：`collectAnalysisContext()` 与 `buildAnalysisInput()` 已统一 Worldbook、Character、Recent Story 和 External Memory 的读取、筛选、清洗与 normalized DTO。
- `docs/CONTEXT-AND-PROMPT.md` 明确要求未来任务复用共享 collector、不得建立 Raw SillyTavern 私有读取路径；它同时把“怎么组织消息”交给各任务 Prompt Builder，并要求统一正文格式由共享 presentation port 提供。
- `ai/prompts.js` 已有 Worldbook、External Memory、World Model 和 narrative 等 formatter，但除少数导出外，多数是 World/Event 私有组合；没有一个可让新任务声明资料子集并取得统一正文的稳定公共 interface。
- 10-22 Storyline 实现复用了 `buildFloorAnalysisInput()` 及既有 External Memory formatter，但在 `ai/projection-storyline.js` 新写了 World Model、其他参考数据、人物资料和消息 section 的 presentation 逻辑。它没有复制 Host reader，却复制了 presentation implementation。
- 10-22 的 `design.md`“可复用能力”只列出 Projection、Floor persistence、Generation 与 lifecycle，未把 shared AnalysisInput / Prompt formatter 列为必须复用的 seam；`implement.jsonl` 与 `check.jsonl` 也未纳入 `docs/CONTEXT-AND-PROMPT.md`，因此实现与审查上下文都没有把 formatter locality 当作门禁。
- 既有测试分别锁定 World/Event 或 Storyline 的最终文本，没有“同一资料的所有消费者必须经过同一个 formatter”的跨消费者契约测试，所以重复实现仍可通过全部检查。
- 根因是 presentation seam 缺失与规划/审查漏项共同造成，不是共享 collector 失效，也不只是单纯文档措辞问题。

## Requirements

- 建立稳定、可复用的 Prompt 上下文资料出口，覆盖至少：世界书、人物资料、插件内世界资料、外部记忆、近期剧情正文。
- 各业务分析模块只声明需要的数据块、消息角色及自身任务要求，不再自行实现同一资料的读取与基础排版。
- 现有 shared collector 继续统一负责来源读取、筛选与规范化；新的公共 presentation 出口统一负责字段投影、中文字段标签、排序、空值策略和可读正文格式，标题、用途说明、消息角色和任务要求由调用模块负责。
- 允许不同任务选择不同资料子集及消息角色，不强制所有 API 请求发送全部上下文。
- 世界分析、人物分析、事件分析及剧情支线分析的既有业务语义、数据所有权和 API 路由不得因格式复用而改变。
- 优先复用或扩展已有共享 collector、input builder、formatter 或 message builder；不存在充分证据时不得再造重复实现。
- 公共格式必须由契约测试锁定，后续修改能够验证所有消费者的一致性和预览/真实请求一致性。
- 本任务只调整 API 输入收集、呈现和组装边界，不新增跨楼层持久化状态，不改变 Floor 事实所有权。
- 新公共 module 必须是纯计算 presentation seam；不得读取 Host/Storage/Floor，也不得引入 Registry、Factory、Repository 或 Service 层。
- 旧的公开 World/Event message builder 保持兼容；Storyline 可以迁移为直接返回 `messages[]`，但其规则、角色顺序、API 路由、取消语义和 JSON parser contract 不变。
- 同一种资料的中文字段标签、字段白名单、内部 ID 过滤、列表和空值规则必须由公共 module 唯一拥有；标题、用途说明、消息角色和任务要求由调用方拥有。

## Acceptance Criteria

- [x] 已列出现有共享输入、格式化和消息构建边界，以及仍然重复实现的调用方。
- [x] 同一种资料只有一个权威的基础读取/呈现实现，所有纳入范围的 API 调用通过该出口获取。
- [x] 业务调用方可以声明资料子集和角色布局；公共端口统一正文中文标签及列表格式，标题和用途说明由调用方拥有。
- [x] 世界书、人物资料、插件世界观、外部记忆和近期正文分别具有覆盖真实请求输出的契约测试。
- [x] Prompt 预览与实际 API 请求复用同一构建结果，不存在单独维护的展示格式。
- [x] 既有 World、Character/Event 与 Projection Storyline 请求的业务规则、JSON 协议和任务 API 分配保持兼容。
- [x] Floor、Swipe、Chat 与外部记忆的读取边界继续符合现有所有权和生命周期规范。
- [x] 相关架构、Prompt/context 文档在实现后与最终公共端口保持一致。

## Out of Scope

- 改变 World Model、BiologicalEvent、Projection 或剧情支线的业务判定规则。
- 新增 Prompt 编辑 UI、资料来源选择 UI 或新的持久化配置。
- 将所有 API 调用强制改成完全相同的 SYSTEM/ASSISTANT/USER 消息结构。
- 清理与本次公共资料出口无关的旧 Prompt 文案或业务模块。

## Key Decisions

- 保留 `ai/input-builder.js` 作为 source collection / normalization owner，不增加第二个输入 collector。
- 新增 `ai/prompt-context.js` 作为唯一 presentation owner，以固定 kind/variant 和两个小入口提供复用；不继续扩大 `ai/prompts.js`，也不建立可插拔 Registry。
- `ai/prompts.js` 与 `ai/projection-storyline.js` 保留 task rules/output contract、资料标题/用途说明和消息布局，仅委托公共 module 生成统一资料正文。
- Event 继续只消费 semantic `event_reference`，不会因为公共 port 恢复 raw Character/Persona/Worldbook/External Memory。
- Storyline 继续不发送 Worldbook；公共 port 只渲染调用方显式声明的资料。
- 迁移完成后清理无调用方的旧 formatter 和 marker parser，不永久保留两套实现。

## Notes

- 已按用户批准进入实施并完成公共 Prompt Context 端口迁移；尚未提交或推送。
- Storyline 已删除字符串 marker 入口，Analyzer、Runtime、调试摘要和测试直接复用同一份 `messages[]`。

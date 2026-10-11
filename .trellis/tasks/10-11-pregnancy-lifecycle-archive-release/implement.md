# 实施计划：Pregnancy Lifecycle Archive & Release

本文件是当前实施清单。任务已通过 `task.py start` 进入 `in_progress`；实施保持
生产锁定 gate disabled，并保留所有既有未提交修改。

## 阶段 0：进入实施前门禁

1. 用户已确认最终规划摘要及 PRD 中四项设计决策。
2. 重新读取本 task 三份规划、Floor State Ownership、Event Pipeline、Pregnancy Tracking、Data Lifecycle 和相关 aggregation task。
3. 记录 `git status --short --branch` 基线，确认用户未提交修改不被覆盖。
4. 先补 canonical lifecycle fact 与 archive/release 状态机的失败用例，再实现最小 domain DTO。

实施前必须锁定的业务契约：`not_pregnant` 绑定当前 `cycle_id`、显式 `pregnancy_id: null`，禁止创建 confirmed pregnancy identity；父方追踪独立；所有技术失败可重试且不能升级为永久锁；Exposure exit 必须删除当前 Floor 精确 Event 快照，不能只做逻辑隐藏。

## 阶段 1：Canonical lifecycle fact

1. 在 Event Schema/AI contract 设计并实现 `pregnancy_lifecycle` factual boundary；兼容既有 confirmation/loss/abortion/delivery，但不让 generic terminal names 自动释放。
2. 实现六状态 payload、`pregnancy_id`/`cycle_id` binding、source Event/Floor Version/evidence refs 校验与确定性 fact ID。
3. 保持 `probable`、`ambiguous`、`negated`、`fictional` 不触发状态变更；labor/postpartum 不替代 lifecycle outcome。
4. 在 Event Analysis 规范化后、State/Tracking 消费前建立统一 DTO；UI/Tracking 不解析 raw payload。

## 阶段 2：Lifecycle reducer 与冲突策略

1. 从当前有效完整 Event snapshot 重建 lifecycle facts，保留历史不确定事实。
2. 实现 ongoing→one terminal 的单调转换、unknown 可被后续明确事实解决、terminal conflict fail-closed。
3. 生成显式 episode-to-cycle binding；禁止按最近 Story Time、Exposure 顺序或 Projection 推断绑定。
4. 为 legacy no-cycle / generic pregnancy_loss 建立诊断与 disabled fallback。

5. 明确 `not_pregnant` 不进入 `pregnancy_ref:new` materialization；验证现有 identity contract 与 status-specific nullable pregnancy identity 的兼容边界。

## 阶段 3：Floor-owned archive timeline

1. 增加独立 `pregnancy_lifecycle_timeline` schema、lifecycle registry、clear/invalidation 和 Coordinator owner。
2. 实现 immutable archive snapshot、current candidate/accepted IDs/participant mapping/Projection evidence capture 和 deterministic archive ID。
3. 实现 append-only release state machine、readback digest/provenance verification、owner/epoch/Floor Version guard。
4. 保存独立 candidate records 和 archive evidence 后，按 cycle 精确删除当前完整 `floor.events[]`；不写 Chat-level fallback；验证 active Swipe、删除、编辑、历史 Floor 与 endpoint readback。
5. 支持删除后 `events: []` 的权威空快照，不从旧 Floor、未来 Floor、Chat cache 或 registry 继承 Event。

## 阶段 4：Release orchestration 与 lock gate

1. 按 lifecycle fact→candidate/archive persistence→complete current Event snapshot deletion→Event readback→cycle-scoped lock release→release readback 接入 runtime coordinator。
2. 删除只作用于精确目标 cycle Exposure IDs；保留其它 cycle、人物、医疗/症状/lifecycle facts 和非 NSFW Event，随后从 readback 快照重建 Tracking/Projection。
3. 将 lock decision 改为 `(subject_id,pregnancy_id,cycle_id)` scope，并继续由 unified gate 默认 disabled。
4. 增加 archive-success/cleanup-failure、cleanup-success/release-failure、stale callback 和 retry 测试；未通过统一 gate 不允许真实过滤或 edit lock。

5. 将 `fact_conflict`、`event_analysis_failed`、`archive_persistence_failed`、`archive_readback_failed`、`exposure_exit_failed`、`lock_release_failed` 分开断言，避免把临时技术失败持久化为人物锁定。

## 阶段 5：跨周期验收

1. 完整实现 C001→aggregation→pregnant_ongoing→delivery→candidate/archive persistence→删除旧 Exposure→Event readback→release→C002。
2. 完整实现 C001→aggregation→not_pregnant→删除旧 Exposure→Event readback→release→C002。
3. 验证 C001 father unknown 不阻止 C002，C002 不继承旧 aggregation、candidate、mapping、Projection evidence 或 lock。
4. 验证 C001/C002 同一 subject、不同 cycle；同一 cycle 重复事实幂等；terminal conflict fail closed。
5. 验证历史 Floor snapshot 不被改写，active Swipe/删除/Chat switch 后 stale state 不复活。

## 必须新增的测试组

- canonical payload：六状态、source/evidence/provenance、deterministic identity、缺失/错误 cycle binding；
- state transitions：ongoing、miscarriage、termination、delivery、not_pregnant、outcome_unknown、重复和冲突；
- identity：`not_pregnant` 必须是 `subject_id + cycle_id + pregnancy_id:null`，不能生成新的 pregnancy ID；已确认妊娠状态必须是 `subject_id + pregnancy_id + cycle_id`；
- source restrictions：Timing、Story Time 跨度、Projection AI、father unknown 都不能生成结束/释放；labor/postpartum 不越权；
- father independence：delivery/miscarriage/termination 不改变 `father_status`；father unknown 不阻止 archive/release/C002；Exposure 删除前独立保存后续父方所需候选、mapping 和 evidence；
- archive content/readback：候选、accepted Exposure IDs、participant mapping、Projection evidence、digest 和 Floor/Swipe guard；
- failure recovery：剧情事实冲突、Event Analysis、archive persistence/readback、Exposure exit、lock release 分别失败和 stale async retry，且不丢证据、不改历史、可幂等重试；
- complete snapshot deletion：当前 Floor 精确删除目标 cycle Exposure IDs，readback 验证，`events: []` 保持权威且不继承旧 Event；
- NSFW boundary：aggregation success 后仅阻止目标人物/目标 cycle 的新 NSFW Event，已锁定 Event 只能禁止编辑但允许删除；医疗、症状、lifecycle facts 与无关人物不受影响；多人物 Event 先拆分再过滤；
- candidate cleanup：father confirmed 时删除该 pregnancy candidate list；pregnancy end + father unknown 时保留独立 candidate record，后续确认再删除；
- aggregation integration：现有 aggregation success 仍幂等，lifecycle 只引用不重写 `participant_aggregation_timeline`；
- C001/C002：旧周期退出、新周期正常写入、跨周期隔离、father unknown 不阻塞；
- unified gate：capability 未完整通过时 lock 仍 disabled；通过后仅 cycle-scoped old slice 生效；
- real host acceptance：Desktop、Tablet、Mobile 的 Chat reload、Swipe switch/delete、message edit/delete 和 new-cycle flow。

## 验证命令（后续实施阶段）

```bash
node --test tests/events.test.js tests/event-analysis-runtime.test.js tests/tracking-window.test.js tests/tracking-window-phase2.test.js
node --test tests/participant-aggregation.test.js tests/participant-aggregation-lock.test.js tests/projection-context.test.js tests/projection-runtime.test.js
node --test tests/floor-persistence-coordinator.test.js tests/lifecycle-contract.test.js
npm run check
python3 ./.trellis/scripts/task.py validate .trellis/tasks/10-11-pregnancy-lifecycle-archive-release
```

自动化通过不等于真实 SillyTavern host acceptance；必须单独记录 host 结果。

## 回滚点

- canonical fact parser/normalizer：可独立回退，保持已有 Event type 只读兼容；
- lifecycle timeline schema/persistence：read/write/readback contract 未通过时不接 runtime gate；
- release coordinator：partial failure 保留 archive、关闭真实 lock gate，不用删除历史记录恢复；
- unified gate：始终可回退到 `disabled_until_lifecycle_archive_release`，不得通过配置默认值误启用；
- 不使用 reset/clean/restore 等破坏性 Git 操作，不 commit/push/切换分支。

## 实施前最终检查（已完成）

- [x] 用户确认统一 `pregnancy_lifecycle` fact boundary。
- [x] 用户确认独立 lifecycle timeline owner。
- [x] 用户确认 `not_pregnant` 的 `pregnancy_id=null + cycle_id` 语义。
- [x] 用户确认冲突 fail-closed 与 retryable release 策略。
- [x] 用户确认当前 Floor 精确 Event deletion 是唯一有效 Exposure exit，逻辑隐藏不能替代。
- [x] `task.py start` 已执行，任务状态为 `in_progress`。

## 子代 NPC 审查后的实施边界修订

本轮只读审查确认：现有 `character_registry` 是唯一可复用的 canonical 人物 ID 体系，但没有 child/NPC profile、亲子关系写入入口或 genealogy Floor owner。因此本 task 不直接实现孩子 NPC；后续实现必须拆分或明确授权独立的 `Pregnancy Child NPC & Genealogy` 子任务。

后续子任务进入实现前必须先补齐：

1. 复用 `allocateSequentialCharacterId()` 生成现有 `character_id`，禁止 `child_id` 和角色卡 ID；
2. child birth/name/parent facts 的 Floor-owned schema、Coordinator owner、readback、clear/invalidation 和 active Swipe/六字段 guard；
3. 明确出生人数未知、死产、未命名、双胞胎命名无法绑定时的 fail-closed 状态；
4. child-specific parent relationship binding，尤其是出生后 father confirmation 不能只用 pregnancy_id；
5. 母亲 candidate 转移的“child record readback → 母亲侧 cleanup → cleanup readback”顺序；
6. Floor 20/30/35、回退 Floor 25/32、Swipe 切换和 Chat 切换的历史隔离测试；
7. 在 canonical father attribution 增加 `cycle_id` 或 child target 之前，不自动清理任何无法唯一绑定的候选名单。

当前 lifecycle task 的 C001→C002、Exposure 删除、archive/readback、cycle release 和生产 gate 约束不依赖孩子命名、父源确认或角色卡创建。`miscarriage`、`termination` 不得进入出生 NPC/候选转移路径。

## 已批准的 delivery handoff 实施限制

- 本 task 只归档可验证的母亲 `character_id`/subject、pregnancy/cycle、delivery source Event IDs、Story Time、Floor/Swipe provenance、父方状态和候选来源引用。
- 当前 canonical schema 尚不能表达 birth count、存活/死产结局或 child-target fact；不得在本 task 中自行新增字段或让 AI 编造这些值。
- delivery archive 必须允许后续 `Pregnancy Child NPC & Genealogy` task 读取来源证据，但母亲 Exposure deletion、lock release 和 C002 不等待 child creation、命名、父源确认或候选迁移。
- child record readback → 母亲 candidate cleanup 的转移顺序属于新 task；本 task 失败恢复时不得删除无法安全转移的母亲侧候选。

## 当前 lifecycle 验收补充

继续补齐并记录以下属于本 task 的 Runtime/持久化测试：

1. delivery、miscarriage、termination 各自完成 C001 Exposure deletion → readback → cycle release → C002 独立保存；
2. lifecycle deletion 与新 Event 写入交错时，使用 Coordinator、六字段 Version 和重试保护，不能误删 C002；
3. active Swipe、Floor 回退、`events: []` 和 stale Version 不得泄漏未来 cycle；
4. Projection evidence 在 C001 Exposure 删除后失效，历史 Projection 可保留，C002 不引用 C001；
5. 重复 archive/release、删除成功但 release 失败、archive 成功但删除失败均可幂等恢复；
6. 生产 NSFW gate 继续保持 `disabled_until_lifecycle_archive_release`。

## 本轮并发审查结果与 Runtime 锁验证

- 当前 Floor lifecycle deletion 已通过 Coordinator 的 latest-snapshot patch resolver 执行；确定性交错测试证明同一 Version 上并发写入的无关 Event、C002 Event 不会被 C001 删除覆盖。
- 已覆盖 archive-success/delete-failure、delete-success/release-failure、release-readback-failure 的幂等重试；失败不会删除 archive 或误删新周期 Event。
- 已通过真实 Runtime 测试入口验证 `participantAggregationLockCapability: true`：聚合成功后新 NSFW Exposure 被过滤，锁定 Event 的 `updateEvent` 被拒绝，`deleteEvent` 仍允许；多人物先拆分再按人物/cycle 过滤，非锁定人物可保存。默认 capability 仍为 `false`，生产 gate 保持 `disabled_until_lifecycle_archive_release`。
- 专项回归已证明：聚合成功→手动删除 Exposure→未发生 lifecycle release 时，当前 cycle 仍保持锁定；只有 archive/delete/readback/release/readback 完成后，后续 C002 才恢复 NSFW 写入。手动删除不等于 release。

## Projection 超时收尾审查结论

当前链路为 `createProjectionRuntime.process()` → Projection/evidence persistence → `refreshProjectionContext()` → `projection-context.write()` → `setExtensionPrompt()` → `GENERATION_STARTED` → `GENERATION_ENDED` + `CHARACTER_MESSAGE_RENDERED` settle → current Floor Event Analysis → `EVENT_ANALYSIS_COMMITTED`。`PROJECTION_READBACK` 只能证明 Projection 自身已落盘；setter 成功只能证明可验证的 prompt 提交边界，不能证明 ST 模型实际消费。

`runtime/events.js` 可能在 generation start、message received、scheduler refresh 和 owner refresh 多次调用 `refreshProjectionContext()`；`runtime/projection-runtime.js` 也会在 Projection process 完成时 refresh。因此同一 Projection 可在多个 generation 复用，未来提交 receipt 必须按 Projection/aggregation/subject/cycle/六字段 Floor Version/context fingerprint 幂等，不得因 refresh 重置等待起点。

“提交后的新正文”只能由新的完整六字段 Floor Version（尤其 `message_id`、`swipe_id`、`content_hash`、`message_version`）和对应 `CHARACTER_MESSAGE_RENDERED` 后 Event Analysis `success`/`EVENT_ANALYSIS_COMMITTED` 共同证明。`MESSAGE_RECEIVED`、Host generation end、analysis failed/skipped/stale 均不计数；regenerate/Swipe 必须视为新的 version，Floor 回退只读目标 Floor，不得继承未来提交。

已实现最小 `projection_delivery_record`，作为 `projection_timeline.delivery_records` 的 Floor-owned 扩展，由现有 Coordinator、六字段 Version guard 和 readback 管理。提交记录绑定 projection/aggregation/subject/pregnancy/cycle、提交 Version、context fingerprint；Event Analysis success/readback 后追加响应记录。`timeout_no_pregnancy` 复用现有 archive/delete/release 流程，不伪造显式 lifecycle fact，也不引入第二套 Projection 身份或 Exposure 清理机制。`projectionPostProcessor` 已移动到 `EVENT_ANALYSIS_COMMITTED` 之后，正常 Runtime 成功分析会自动进入响应观察和超时评估；生产 gate 保持 `disabled_until_lifecycle_archive_release`。

本轮 reroll 回归根因是 streaming regenerate 在同一 Chat/Floor/Swipe owner 下合法改变 `content_hash/message_version`，而 scheduler completion 仍要求旧六字段完全相同，导致完成结果被错误丢弃。修复后仅对明确 reroll 放宽到同一 owner，普通 stale/reconciled execution 仍按六字段和 scheduler revision fail-closed。相关 reroll 与 Projection/lifecycle 聚焦测试均通过；完整宿主消费仍不被声称。

已确认 overdue compensation 的现有 `resolveParticipantAggregationTrigger()` 在尚未聚合且 `elapsed > effective_max` 时返回 `aggregate_due_overdue`，Runtime 会先持久化 aggregation 并继续 Projection 流程；它不会在同一步骤自动 release。提交回执和后续正文响应已使用同一 Floor-owned `projection_timeline.delivery_records` 契约，由成功的 `EVENT_ANALYSIS_COMMITTED` 后处理进入 `timeout_no_pregnancy` 评估；仍需真实 SillyTavern host 验收模型外部消费边界，系统不会把它伪称为模型已阅读。

## 最终验收配套

- 现有 Timing min/max、冻结 Timing Instance、Projection 开关和 Story Time 调试开关已覆盖用户需要的配置边界；本 task 不新增第二套 horizon、Projection 设置或可手动开启生产锁的设置。
- `runtime/events.js` 的 `collectActiveBusinessData({includeDebug:true})` 复用当前 Floor readback，补充 Participant Aggregation、Projection Delivery、Pregnancy Lifecycle archive/release 和 cycle-scoped NSFW lock 的安全摘要；不复制持久化事实，也不输出完整剧情正文。
- Settings Debug 页面复用现有业务状态卡片，显示 aggregation identity/Exposure 数量/effective window、delivery/response/analysis 状态、lifecycle closure/release 状态和 gate/lock 状态；未知或 readback 不可用时显示安全失败状态。
- Runtime diagnostics 与 Persistence Trace 白名单补充 lifecycle/delivery/lock 诊断字段；错误仍使用现有安全 error code/summary，不记录敏感正文。
- `cross-layer-thinking-guide.md` 与 `docs/ARCHITECTURE.md` 已加入统一交付审查：设置、调试、诊断、状态展示、Schema/兼容性、Runtime 接口、文档和测试；不适用项可说明原因，不要求为内部函数增加 UI 开关。

## 真实 SillyTavern Host Acceptance（2026-10-12）

本轮为宿主验收阶段，不新增业务功能。当前工作树未获得可操作的真实 SillyTavern 宿主，因此不得把自动化结果记为 Host PASS。

### 宿主可用性审查

- Computer Use inventory：无可用 Native App、浏览器或浏览器标签；原生宿主通道启动失败。
- 本机进程检查：未发现 `SillyTavern`、ST server 或对应 Node host 进程。
- TCP listener 检查：未发现可归属 SillyTavern 的监听端口。
- 当前 checkout 的加载入口仍是 `manifest.json → index.js`，无 build/dist bundle；但没有运行中的宿主，无法证明本次工作树已被宿主加载。
- 因此以下项目均为 `HOST_BLOCKED`：宿主加载身份、正文生成、Runtime 初始化、Event Analysis、Projection prompt 注入、Settings Debug、真实 capability 开启后的锁行为。

自动化证据单独保留：`npm run check` 的 Node 测试不能证明宿主加载、SillyTavern 生成器消费 Projection prompt 或真实宿主持久化。

### 人工 Host Acceptance 执行脚本

以下步骤必须在独立测试 Chat、测试角色和可回滚的本地 SillyTavern 实例中执行。不得使用用户现有剧情作为测试数据；不得直接编辑 Chat/Floor 持久化文件；所有 ID 由 Runtime 生成。

| Case | 操作 | 预期结果与必须保存的证据 |
|---|---|---|
| H0 | 加载当前 checkout，确认扩展版本/路径，再打开 Settings Debug | `debug.lifecycle_runtime.status=ready`；记录宿主版本、扩展路径、当前 Chat ID；确认 production gate 仍为 `disabled_until_lifecycle_archive_release` |
| A | 在 C001 聚合前记录两个受孕方的合法 NSFW Exposure，推进到各自冻结 Timing Instance 的 `effective_min` | 两人物独立记录；Debug 记录 `subject_id/cycle_id/aggregation_id/accepted_exposure_count/effective_min/effective_max/aggregation_story_time` |
| A2 | 删除一个 Exposure，再触发正常 Runtime 重建 | accepted Exposure 与候选来源按当前完整 Event snapshot 重算；`events: []` 时 Debug/读回必须显示权威空快照，不继承旧 Floor |
| A3 | 直接跳过有效范围上限 | 先执行 overdue compensation、aggregation、Projection；同一处理不得立即 timeout/release；保存 aggregation 与 delivery 状态 |
| B | 在隔离环境以非持久化测试注入开启 `participantAggregationLockCapability`，聚合前后分别记录 NSFW、编辑、删除、多人物和非 NSFW Event | 聚合后仅当前 subject/cycle 的新 NSFW 被拒绝；锁定 Event 编辑被拒绝但删除成功；其它人物、非 NSFW Event 正常；记录过滤/拒绝原因。无法安全注入则全部记 `HOST_BLOCKED` |
| B2 | 完成 C001 release 后记录 C002 Exposure，并切换 Swipe | C002 正常保存；旧 Swipe lock 不泄漏；Debug 的 locked cycle keys 与 Runtime 行为一致 |
| C | 让 Projection 正常生成并触发 generation start | Projection/evidence persist/readback 成功；`refreshProjectionContext` 与 `setExtensionPrompt` 成功；产生唯一 delivery receipt，记录 `projection_id/aggregation_id/context_fingerprint/submitted_floor_version/receipt status` |
| C2 | 重复 generation refresh、模拟 setter 失败、模拟 Projection 失败 | 重复 refresh 不重复 receipt、不重置起点；setter/Projection 失败不产生有效 receipt；只记录可验证的 prompt 提交，不声称模型已阅读 |
| D | 提交后不生成新正文；再生成一条正文但让 Event Analysis 失败；最后生成一条成功分析正文 | 前两步不得满足 timeout 条件；只有成功 Event Analysis/readback 后才出现 response evidence；记录 response Floor Version、analysis status 与 receipt 状态 |
| D2 | 在成功 response 后超过冻结 `effective_max`，分别输入明确怀孕、not_pregnant、delivery、miscarriage、termination 和无反馈正文 | 明确事实优先；无反馈且满足全部条件才产生 `timeout_no_pregnancy`；timeout 不写伪造 not_pregnant fact；保存 closure reason、archive/delete/release/readback |
| E | 分别执行五种 closure 路径 | archive/readback、精确删除 C001 accepted IDs、保留其它人物/C002 Event、release/readback、C002 可写；delivery 不等待孩子 NPC 或父源确认 |
| F | Floor 回退、Swipe regenerate、正文编辑、Start New Chat A→B、重复 CHAT_CREATED、A 持久化失败 | 未来 Floor/Swipe evidence 不泄漏；旧正文分析失效；A 不污染 B；重复创建不重复清理；失败可诊断且不触碰 B；保存六字段 Version、active Swipe、stale/readback 诊断 |

### 当前 Host Acceptance 统计

- Host PASS：0
- Host FAIL：0
- HOST_BLOCKED：H0、A、A2、A3、B、B2、C、C2、D、D2、E、F
- AUTOMATED_ONLY：现有 Node Runtime、Projection、Lifecycle、lock、Floor/Swipe/Version 与 Start New Chat 回归测试

当前不能给出 production gate ready 结论。生产 capability 默认仍关闭，未创建普通用户可开启的隐藏设置，也未修改生产默认值。真实宿主可用后，应先完成 H0，再按 A→F 保存 Debug/日志/readback 证据，并重新记录本表；在此之前 lifecycle task 保持 `in_progress`。

### 第一轮真实宿主验收执行记录（2026-10-12）

本轮仅在已授权的 `BioWeave disposable fixture` Chat 中操作，未操作其它 Chat，未修改安装目录、生产 gate 或测试 capability。当前宿主为 Edge 中已登录的 SillyTavern 1.19.0，Chat 为 `30Days - 2026-10-02@02h30m27s624ms`。

| Case | 实际操作 | 预期 | 实际结果 | 状态 |
|---|---|---|---|---|
| H0 | 在当前 Edge 会话打开 BioWeave 面板和 Settings → 高级 / 调试；核对 Chat、Floor、Swipe 和六字段 Version | fixture 可安全操作；Runtime、Debug 和版本来源可读 | 面板标题确认 fixture；真实宿主显示 BioWeave；`Chat=30Days - 2026-10-02@02h30m27s624ms`、`Floor=3`、`Active Swipe=0`；Debug 可读；`Capability enabled=false`、`Gate=disabled_until_lifecycle_archive_release` | `HOST_PASS` |
| A1 | 通过正常 ST 输入发送无业务副作用消息，等待助手正文完成；随后在 BioWeave 事件页使用“分析当前楼层”正常入口 | 正文生成、Event Analysis commit/readback；空事件也应以 `events: []` 为权威结果 | 助手正文生成完成；诊断出现 `ANALYSIS_SUCCESS`、`EVENT_SAVE_END`、`OFFICIAL_GET_AFTER_SAVE_END`、`BIOWEAVE_FULL_CHAT_SAVE_READBACK(commit_state=readback_confirmed)`、`EVENT_SLOT_AFTER_READBACK(present=true, floor_version_match=true, swipe_match=true)`、`FLOOR_TX_CONFIRMED(commit_state=confirmed)`；`EVENT_EMPTY_RESULT_CLASSIFIED(valid_empty=true, reason=persisted_current_floor_events_empty)`；当前快照为权威 `events: []`，六字段 Version 与 `Chat/Floor=3/Swipe=0` 一致 | `HOST_PASS` |
| A2 | 仅在 fixture 中通过正常 ST 输入发送明确的成年虚构人物 Exposure 剧情；未直接写入 Event | 新正文完成后再由正常 Event Analysis 判断是否产生合法 Exposure | 用户消息已正常写入为新楼层 `#4`；诊断出现 `GENERATION_STARTED`、`generation_intent_id=generation-2` 和 `rungenerate calling API`，但截至本轮停止时没有新的助手正文、`GENERATION_ENDED`、完成后的 Floor Version 或可执行的 Event Analysis readback。未伪造 Exposure，也未重试 | `HOST_BLOCKED` |
| A3 | 由于 A2 未形成新的已完成正文，未推进 Story Time 或观察 Timing | 必须先取得可比较的真实 Story Time，再验证冻结 Timing Instance | 未执行；旧 Debug 仍是 A1 的 `Floor=3` 采样，不能将其当作 A2 结果。后续自动化/宿主流程不再推进 | `HOST_BLOCKED` |
| A4 | 未继续触发 aggregation | 必须有真实合法 Exposure、当前 cycle 和可验证 Timing 条件 | 未执行；没有合法 Exposure readback，不能声称 participant aggregation 成功 | `HOST_BLOCKED` |
| A5 | 未继续触发 Projection delivery | 必须先有 aggregation，再验证 Projection persist/readback、`setExtensionPrompt` 与 delivery receipt | 未执行；没有 aggregation，不能声称 Projection delivery 成功 | `HOST_BLOCKED` |

#### A2 停止证据与边界

- 新用户消息确实属于当前 fixture；Chat 面板仍显示 `BioWeave 30Days - 2026-10-02@02h30m27s624ms`，未发生 Chat 切换。
- 消息 `#4` 已进入宿主聊天，但没有对应助手消息；日志只证明宿主开始生成和调用 API，不证明生成完成，也不证明 ST 正文已可供 Event Analysis 使用。
- 当前 debug/readback 仍指向上一条已确认的 Floor `3`、Active Swipe `0`；因此没有把 `#4` 错当成已完成业务 Floor，也没有继续执行 A3～A5。
- 生产 gate 仍为 `disabled_until_lifecycle_archive_release`，`participantAggregationLockCapability` 仍为 `false`。本轮没有启用或修改任何 gate/capability。

本轮结论为：真实宿主的 H0 与无业务副作用 A1 已 `HOST_PASS`；A2 因 ST 正文生成未达到完成边界而 `HOST_BLOCKED`，A3～A5 均未执行。不能给出第一轮 Host Acceptance 全部通过，也不能给出 production gate ready 结论。继续验收所需的最小用户配合是：在不切换 Chat 的前提下确认当前宿主 API 可完成一次普通回复，然后重新加载当前 fixture；之后从 A2 重新开始，不应跳过正文完成和 Event Analysis readback。

#### A2 等待后的安全停止修正

在上述记录后继续等待宿主生成，页面随后出现正文，但当前宿主 Chat 已变为“与剑灵们的双修日常”，可见楼层为 `#64`，不再是授权的 `BioWeave disposable fixture`。由于无法证明这条正文属于 fixture，也无法安全确认其来源、Floor 或 Swipe，立即停止验收；该正文不计入 A2，也不触发 Event Analysis、Exposure、Aggregation 或 Projection 验收。未对该 Chat 发送消息、修改数据或执行清理。

因此 A2 继续保持 `HOST_BLOCKED`，新增阻塞原因为“等待期间当前 Chat 身份发生变化/无法确认授权边界”。后续必须由用户重新打开并确认 `BioWeave disposable fixture` 后，才能从 H0/A2 重新开始；不得在当前“与剑灵们的双修日常” Chat 中继续操作。

### 当前角色卡 Host Acceptance 补充记录（2026-10-12）

用户明确授权改用当前角色卡“与剑灵们的双修日常”进行测试。该 Chat 已存在历史剧情，当前操作仅追加一条测试消息，不执行删除、回退、Swipe 切换、锁定或 gate 修改。

- 当前角色卡/Chat：`与剑灵们的双修日常`，发送前可见历史楼层至 `#64`。
- 发送的测试消息写入新用户楼层 `#65`；宿主正常生成新助手楼层 `#66`。
- `#66` 的实际内容为模型拒答：`我无法生成涉及未成年角色的性描写内容。`。这不是合法 Exposure，也不是 Event Analysis 的成功业务事实。
- BioWeave 面板可见正常入口“分析当前楼层”。触发后等待约 60 秒，面板仍显示“当前楼层尚未完成分析”，没有新的 `ANALYSIS_SUCCESS`、`ANALYSIS_FAILED` 或 Event Analysis readback 证据；现有面板中的 5 条事件是历史事件，不属于 `#66` 的当前分析结果。
- 因模型输出拒答且当前楼层分析未完成，本轮标记为 `MODEL_NONDETERMINISTIC` + `HOST_BLOCKED`；未伪造 Exposure，未进入 Story Time、Aggregation、Projection 或 Lifecycle 流程。
- 当前角色卡测试证明了正常 ST 生成入口可以产生新楼层，但不能证明当前测试消息产生了可用于 Pregnancy Lifecycle 的合法 Exposure。生产 gate 仍为 `disabled_until_lifecycle_archive_release`，capability 仍关闭。

### 宿主目录与远程连接复核（2026-10-12）

- 开发源 `/Users/ll/Library/CloudStorage/SynologyDrive-LL/VSCode/BioWeave`：可访问，真实目录。
- ST 目标 `/Volumes/docker/SillyTavern/extensions/BioWeave`：可访问，真实目录，非符号链接。
- ST 目标是独立副本；未执行任何同步、覆盖、删除或写入。
- ST 副本的 175 个部署文件均可在开发目录找到，内容 SHA-256 一致；开发目录额外存在 `.git`、`.trellis`、`.agents`、`.codex`、`.gitignore`、`.gitattributes` 等开发控制文件，不属于部署代码差异。
- `manifest.json`、`index.js`、`package.json` 三个部署标记文件的 hash 一致。
- `http://twzy.myds.me:8001/` 网络可达，响应为 `401 Unauthorized`，`WWW-Authenticate: Basic realm="SillyTavern"`，可确认远程端是受 Basic Auth 保护的 SillyTavern 入口，但当前没有认证凭据，也没有通过认证后的页面证据。
- Microsoft Edge 当前不可接入：Computer Use inventory 没有 Edge 或其它浏览器会话，Native pipe 启动失败；未关闭、重启或修改 Edge，也未绕过认证。

因此目录一致性已确认，但“浏览器已加载当前副本”“BioWeave 已加载”“Settings Debug 可见”“Runtime/Projection 正常初始化”仍全部是 `HOST_BLOCKED`，不能作为 Host PASS。继续验收前需要用户在已登录 Edge 会话中完成以下非破坏性步骤：

1. 打开 `http://twzy.myds.me:8001/` 并完成正常 Basic Auth；
2. 确认进入的是 SillyTavern 主界面，且扩展列表中出现 BioWeave；
3. 按正常宿主方式刷新页面/重载扩展，使当前 ST 副本重新加载；
4. 打开 BioWeave Settings → Debug，确认 `debug.lifecycle_runtime.status=ready`、当前 Chat/Floor/Swipe provenance 和 gate 状态；
5. 将宿主版本、扩展加载路径、Settings Debug 截图/安全摘要和后续 A～F 验收 readback 证据提供给本任务。

不得把 Basic Auth 响应、目录 hash 或 Node 自动化测试当作宿主加载证据；在完成上述步骤前不建议 production gate ready。

### 已恢复的真实 Edge 会话复核（2026-10-12）

本节 supersede 上述“Edge 不可接入”的临时审查结论；此前结论来自当时 Computer Use 通道不可用，不代表当前宿主状态。

- 已通过 Microsoft Edge 现有会话控制真实页面：浏览器为 Edge，现有标签页标题为 `SillyTavern`，地址为 `https://st.123502.xyz:1111/`。
- 页面可见 `SillyTavern 1.19.0`；用户提供的 `http://twzy.myds.me:8001/` 仍是另一个需要 Basic Auth 的地址，不能将两者视为同一已认证端点。
- 页面可见 `BioWeave` 浮动入口；打开后真实宿主显示 BioWeave 当前 Chat 面板、总览/人物/事件/推演/家系/世界/设置/状态导航，证明扩展已被宿主加载。
- `Settings → 高级 / 调试` 可展开，显示“分析输入预览”“当前生产业务状态”“最近一次运行诊断”“Story Time 调试”，证明 Settings Debug 入口可用。
- 在已存在的 `BioWeave disposable fixture` 测试 Chat `30Days - 2026-10-02@02h30m27s624ms` 中，运行时能解析当前目标：Floor `0`、active Swipe `0`、完整六字段 Floor Version，且 World Model 来源为 `CURRENT_RESOLVED`。调试读数显示当前没有 Event、aggregation、Projection delivery receipt、Pregnancy Lifecycle archive/release，也没有锁定周期。
- 宿主调试明确显示 `Capability enabled=false`、`Gate=disabled_until_lifecycle_archive_release`、`Lifecycle archive/release ready=false`；本轮没有启用 capability 或生产 gate。
- 运行诊断记录了真实宿主事件 `GENERATION_STARTED`、`CHAT_CHANGED`、当前 Chat/Floor/Swipe 的 Floor source resolve，以及 Projection context refresh/clear；这证明 Runtime 初始化和宿主事件入口已接通，但由于本轮未发送新消息，不能据此宣称完成正文生成、Event Analysis 或 Projection AI 的全链路验收。
- 本轮只切换到现有 disposable fixture 并刷新只读 Debug 状态；没有发送消息、触发生成、修改剧情、创建角色、改写持久化文件或操作安装目录。

### 当前 Host Acceptance 重新分类

- `H0`：部分通过。真实 Edge、SillyTavern、BioWeave、Settings Debug 和当前 Floor provenance 已有宿主证据；但“当前宿主加载资源就是开发工作树最新代码”仍以目录 hash 一致和当前界面/调试字段间接佐证，未进行额外部署或强制刷新。
- A～F：仍为 `NOT_RUN`，不是 `HOST_PASS`。当前 disposable fixture 没有可用于 lifecycle 流程的 Exposure/Event，且本轮未发送剧情正文、未执行 aggregation/Projection/lifecycle closure，也未在真实宿主开启测试 capability。
- 生产 gate：继续 `disabled_until_lifecycle_archive_release`；当前结论为 `not ready`，不能因扩展加载成功或自动化测试通过而切换为 ready。

### Event Analysis 失败后浮动入口持续旋转修复（2026-10-12）

#### 根因

浮动入口的旋转条件是 `runtime/activity.js` 提供的 `getActivityState().busy`；`floating-launcher.js` 将 `busy=true` 映射为 `is-running`，CSS 再驱动图标旋转。分析终态由 `runtime/events.js` 的 `notify()` 送入 `createRuntimeActivity().handleRuntimeEvent()`，因此失败、取消和成功都应通过同一个 execution owner 清理活动。

日志中的 `REQUEST_TIMEOUT`、`ANALYSIS_FAILED`、`REQUEST_ABORTED` 和 `manual-abort` 都已经到达分析终态；问题不在固定延迟或 CSS，而在 activity owner key：原实现直接对嵌套 `floor_version` 使用 `JSON.stringify()`。开始事件和终态事件的六字段值相同但对象字段顺序不同时会生成不同 key，终态无法匹配开始任务，`busy` 保持 true，浮动入口持续旋转。`CHARACTER_UI_REFRESH_SUPERSEDED` 是失败后业务刷新排队的独立诊断状态，不是浮动入口 spinner 的直接驱动。

#### 修复与边界

- `runtime/activity.js` 新增稳定的六字段 Floor Version key，按 `chat_id`、`message_id`、`floor`、`swipe_id`、`content_hash`、`message_version` 的固定顺序编码，不再依赖输入对象属性顺序。
- 未放宽 owner 校验：不同 attempt 的旧失败终态仍不能清除新分析任务；只有匹配当前 execution identity 的终态才会清除对应活动。
- 未清空全部运行任务，未修改 Floor Version、Event snapshot、Lifecycle 或生产 gate；没有新增第二套 loading 状态或用户设置。

#### 回归证据

- `tests/floating-launcher.test.js` 新增字段顺序变化的失败终态测试，验证 `busy=false`；并通过真实 launcher DOM 订阅验证旧 attempt 失败不停止新 attempt 的 `is-running`，新 attempt 结束后才停止旋转。
- `tests/event-analysis-runtime.test.js` 的真实 Runtime API timeout 与 manual-abort 路径增加 `runtime.getActivityState().busy === false` 断言；该断言验证的是 Runtime→Activity 状态链，而非只验证 `ANALYSIS_FAILED` 事件。
- Settings、诊断字段和持久化 owner 无需新增或调整：本次修复只修正既有 transient activity identity matching，现有错误诊断已能区分 timeout/abort/floor supersede。未新增用户设置；无需同步架构或生命周期规范。
- 原自动化统计仍为 `npm run check`：1424 tests，1408 passed，0 failed，16 skipped；该统计继续标记为 `AUTOMATED_ONLY`，不替代真实宿主 A～F 验收。

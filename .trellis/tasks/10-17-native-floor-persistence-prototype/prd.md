# P2 宿主原生 Floor 快速保存隔离原型与测试

## Goal

在不修改 BioWeave 生产持久化路径、不写入真实 SillyTavern Chat/Floor 的前提下，构建一个独立的 SillyTavern Context 原生 Floor 保存行为模型，验证它能否在保留现有 Floor 数据契约和 Timing/Aggregation 部分成功语义的边界内减少官方 Chat GET，并以确定性并发测试和实际模型计数决定是否值得继续进入生产原型。

## Background and confirmed facts

- 既有审计 `.trellis/tasks/10-17-native-host-persistence-architecture-audit/audit-report.md` 与 `.trellis/tasks/10-17-sillytavern-native-persistence-capability-audit/audit-report.md` 已确认：当前 Timing + Aggregation changed 基线为 2 笔 Floor 事务、12 次官方 Chat GET、2 次 SAVE；no-op 基线为 2 笔事务、6 次 GET、0 次 SAVE。
- 当前普通 Floor writer 必须通过 `FloorPersistenceCoordinator`；其 owner acquisition、latest merge、Floor Version/Swipe/epoch guard、官方 SAVE 和 authoritative readback 是已冻结的正确性边界。原型不得替换、绕过或修改这些生产路径。
- SillyTavern `context.chat` 是当前页面的可变 live Context；原生保存发送完整 Chat 快照，宿主接口当前没有被证明提供 BioWeave 所需的 Floor-level CAS、字段级 merge 或可分类的 durable confirmation。
- `saveChatDebounced()` 的完成结果不可等待；原生 immediate save 的 Promise/HTTP 结果不能自动等同于 Floor authoritative readback。
- Timing no-op、Timing changed、Aggregation no-op/changed 是不同状态；Timing 成功而 Aggregation 失败的 `timing_persisted: true` 部分成功语义必须保留。
- 测试通过只能证明隔离模型内的行为；不得把模型证据写成当前真实宿主已经提供的保证。

## Requirements

### R1. 独立原型边界

- 新增仅供测试使用的原型模块，优先放在 `tests/helpers/native-floor-persistence-prototype.js`，不得 import 或修改生产 Coordinator、Adapter、Runtime、UI、业务规则或 SillyTavern 源码。
- 原型必须模拟当前 Context、官方归档状态、原生 `saveChat()` / `saveChatDebounced()`、可控保存完成、失败和 unknown 结果；所有竞争使用 Promise barrier/deferred，不使用固定 sleep。
- 原型输出必须区分至少 `DISPATCHED`、`HOST_ACCEPTED`、`SERVER_WRITE_COMPLETED`、`AUTHORITATIVE_READBACK_CONFIRMED`、`FAILED`、`UNKNOWN_OUTCOME`，不能用 fulfilled Promise 直接代表 confirmed。

### R2. Floor 身份与数据所有权

- 目标必须携带并校验 Chat ID、message ID、Floor、Swipe ID、message version、content hash、epoch。
- 只允许更新原型声明的 BioWeave owner Snapshot 字段；必须保留其他 `message.extra`、其他 Swipe、其他 BioWeave sibling Snapshot 以及历史 Floor。
- 历史 Floor、User message、已切换 Chat/Swipe、消息编辑/删除、epoch 变化和 owner token stale 必须 fail closed。
- 原型不得把 `message.extra` 或 host Context 变成生产事实源；所有结论必须标明 test-model 证据边界。

### R3. Timing + Aggregation 语义

- 模拟 Timing Instance 更新、Timing no-op、Aggregation 重评估和独立结果确认。
- 保持 Timing Instance ID、Cycle ID、sampled offset/effective range、Aggregation 幂等和历史 Floor 不可变。
- Timing 与 Aggregation 默认保持两笔逻辑事务；不得为了减少 SAVE 把二者合并成一笔不可分割事务。
- 必须覆盖 Timing 成功/Aggregation 失败，并验证 UI 结果为部分成功而不是整体成功。

### R4. 确定性并发与外部写入

至少覆盖：同 Floor 连续/并发写入、不同 Snapshot 并发、两个角色、其他扩展修改 `message.extra`、同 Chat 旧快照、Chat/Swipe 切换、消息正文编辑、消息删除、保存期间页面生命周期变化、保存失败、服务端已写入但响应丢失、readback 不一致、重复执行、历史 Floor 写入拒绝。

每个并发用例必须记录初始权威状态、精确 barrier 位置、原始/候选行为差异、是否发生覆盖、是否误报成功及契约结论；不能通过削弱断言让候选路径通过。

### R5. 可量化性能对照

- 记录每个场景的模型 Chat GET、Chat SAVE、等待阶段、authoritative readback、数据覆盖、最终状态和证据等级。
- 与既有生产基线对照：普通 changed `6 GET + 1 SAVE`、普通 no-op `3 GET + 0 SAVE`、Timing + Aggregation changed `12 GET + 2 SAVE`、Timing + Aggregation no-op `6 GET + 0 SAVE`。
- 原型只报告实际模型计数；任何理论最低请求数必须单独标为理论值，不冒充真实宿主测量。
- 必须同时列出减少请求所失去的保护：CAS、latest merge、冲突拒绝、readback、失败/unknown 分类和部分成功边界。

### R6. 报告与证据分级

在本任务目录提交 Markdown 审计报告，至少包含：原型调用图、Context/official 状态关系、请求计数、所有并发时序、失败与 unknown 处理、数据覆盖风险、方案安全边界、生产前置条件和明确推荐。

每个场景/候选方案使用以下分类，并区分单页、同浏览器多标签页、跨浏览器/设备和直接 API：

- `PROVEN_SAFE_WITHIN_TEST_MODEL`
- `CONDITIONALLY_SAFE`
- `PROVEN_UNSAFE`
- `UNKNOWN`

## Acceptance Criteria

- [ ] 新任务目录包含 `prd.md`、`design.md`、`implement.md`，并在 Execute 前通过规划审查；dispatch 模式下 `implement.jsonl` 与 `check.jsonl` 各有真实的规范/研究条目。
- [ ] 独立原型只在测试目录/任务目录中新增，不修改生产 Coordinator、Adapter、Runtime、UI、业务规则、真实宿主源码或真实 Chat/Floor。
- [ ] 所有并发控制使用显式 Promise barrier；不存在依赖固定延时的竞争测试。
- [ ] 测试覆盖 R4 列出的外部写入与生命周期场景，并在输出中区分模型通过、源码证据、真实宿主未验证和未知结果。
- [ ] Timing + Aggregation 保持独立逻辑事务和部分成功语义；原型不得以合并 SAVE 作为默认安全结论。
- [ ] 测试输出实际记录 GET/SAVE/readback/等待/覆盖/成功状态，且报告不会把理论计数写成实测结果。
- [ ] 报告明确回答：是否存在比当前 Coordinator 更少 GET 且仍保持 BioWeave 契约的宿主原生方案；若不能证明，明确写出阻碍和证据缺口。
- [ ] 运行 `npm run check` 与 `git diff --check`；失败时区分本轮新增失败与既有失败，不修改生产逻辑绕过断言。
- [ ] 完成 Markdown 影响检查；由于本轮不改变生产行为，除新任务报告外不修改 README、架构契约或生命周期合同。

## Out of scope

- 不实施生产 native Floor writer、Coordinator/Adapter/Runtime/UI 改造或性能优化。
- 不删除任何官方 GET、Floor Version/Swipe/epoch 校验、authoritative readback 或错误语义。
- 不合并 Timing 与 Aggregation 事务，不改变业务规则、历史 Floor 不可变性、数据模型或用户数据。
- 不执行真实 SillyTavern Chat/Floor 写入；若未来需要真实宿主写入验证，必须另行授权。
- 不切换分支、commit、push、reset、clean，也不覆盖无关工作区修改或现有 Trellis 任务目录。

## Evidence and open questions

### 已有证据

- 当前生产保存边界及 GET/SAVE 基线：两份既有 native-host audit 报告及前序 Floor write audit。
- Floor owner、Swipe、版本、历史不可变和 Coordinator 冻结契约：`.trellis/spec/domain/floor-state.md`、`docs/ARCHITECTURE.md`、`docs/bioweave-data-lifecycle.md`。
- 既有 SillyTavern 行为模型测试：`tests/native-host-persistence-audit.test.js`、`tests/sillytavern-native-persistence-capability-audit.test.js`。

### 规划阶段待验证的技术问题

- 原型能否在不假设宿主 CAS 的前提下安全模拟 native Context path 的最窄成功边界。
- 对外部 full-Chat writer、其他扩展字段和同 Floor sibling 的最小确定性反例集合。
- 两笔独立逻辑事务使用原生保存时，能够实测减少多少模型 GET/SAVE，以及哪些减少只来自不做权威确认。
- 哪些结果只能归为 `UNKNOWN`，不能升级为 `PROVEN_SAFE_WITHIN_TEST_MODEL`。

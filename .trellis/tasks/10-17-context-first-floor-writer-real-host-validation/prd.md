# Context-first Floor Writer 真实宿主验证

## 目标

在当前实际运行的 SillyTavern 上验证 SevenDaysCal 式的 Context 直接写入是否能在一个新建、专用临时 Chat 中保存 BioWeave Floor Snapshot。验证范围只包含隔离工具、只读宿主检查和经确认目标后的临时 Chat 写入；不得改动生产持久化逻辑或任何正式 Chat。

## 需求

### R1：Phase A 宿主能力与工具

- 记录当前宿主 URL、UI 版本/构建可识别信息以及可读取的 `SillyTavern.getContext()`、`saveChat()`、`saveChatDebounced()` 接口。
- 新增测试专用 Host Adapter/验证工具，不能被生产入口 import。
- 工具必须在执行写入前确认目标是本轮新建的专用临时 Chat；不能接受“当前 Chat”作为充分授权。
- 工具必须记录 Writer 主动发起的 `/api/chats/get`、`/api/chats/save`、Context 检查、merge、保存等待和 readback 阶段。

### R2：真实临时 Chat 验证

只在以下条件同时满足时进入 Phase B：

1. 通过宿主 UI/API 明确创建了新临时 Chat；
2. 能取得新 Chat 的稳定身份并与创建动作关联；
3. 目标消息、Floor、active Swipe 可逐次重新确认；
4. 不需要选择或覆盖任何已有正式 Chat。

如果任一条件无法证明，必须停止 Phase B，报告 `HOST_TEST_BLOCKED`，不得猜测目标或使用已有聊天代替。

在安全目标上验证：

- 读取当前消息的 `extra` 和 `swipe_info[swipe_id].extra`；
- 只修改 `extra.bioweave` 中符合现有 Schema 的测试 Snapshot；
- 同步 active Swipe 镜像，保留其他扩展字段、其他 Swipe 和历史消息；
- 调用宿主原生保存并分别记录 `HOST_ACCEPTED`、`CONFIRMED`、`FAILED`、`UNKNOWN`、`STALE`；
- 保存后官方读取与页面刷新后的持久化结果；
- 不替换整条消息对象。

### R3：生命周期与请求计数

在不影响其他聊天的前提下，验证或明确阻断：Chat/Swipe 切换、正文编辑、消息对象替换、同 Floor 连续写入。每项都必须先确认是否仍指向专用临时 Chat；无法安全执行时用隔离模型记录，不伪造真实宿主结果。

区分 Writer 主动请求、SillyTavern 自身请求和其他扩展请求；不得把测试模型计数当成真实网络计数。

### R4：结论等级

使用以下标签：

- `HOST_VERIFIED`
- `HOST_TEST_BLOCKED`
- `CONDITIONALLY_SAFE`
- `PROVEN_UNSAFE`
- `UNKNOWN`
- `BLOCKED`

`saveChat()` Promise 完成或 HTTP 成功不能自动等同于权威确认；没有 readback 或结果丢失时必须保留 `UNKNOWN`。

## 安全约束

- 不修改生产 Coordinator、Adapter、Runtime、UI、业务规则或 Snapshot Schema。
- 不修改真实正式 Chat/Floor，不删除历史数据，不修改宿主源码。
- 不切换分支，不执行 commit、push、reset、clean。
- 保留所有现有工作区修改和 Trellis 任务目录，包括 `.trellis/tasks/10-15-nsfw-auto-aggregation-diagnostics/`。

## 验收标准

- [ ] 当前宿主版本和保存接口已取得 SOURCE_VERIFIED 证据，或明确 `HOST_VERSION_UNVERIFIED`。
- [ ] Phase A 验证工具、隔离测试和运行说明已落库。
- [ ] Phase B 仅在新建专用临时 Chat 上执行；无法安全识别时报告 `HOST_TEST_BLOCKED`。
- [ ] 真实 GET/SAVE 计数与测试模型计数分栏记录。
- [ ] Context 写入、active Swipe 镜像、其他扩展字段和历史不可变性有证据。
- [ ] 保存完成、readback、刷新和未知结果语义未被混淆。
- [ ] `npm run check` 与 `git diff --check` 通过。

# Context-first Floor Writer 真实宿主验证执行计划

## 1. 当前授权

用户已批准 Execute。本任务只允许测试专用工具、隔离测试、只读宿主检查、专用临时 Chat 验证和报告；不授权任何生产持久化改造。

## 2. 执行顺序

### Phase A：工具和静态证据

1. 读取当前工作区约束、Floor State Ownership、生命周期和架构文档。
2. 核对实际浏览器中 SillyTavern 版本、`SillyTavern.getContext()` 结构、`saveChat()`/`saveChatDebounced()` 以及脚本中的 `/api/chats/save` 调用。
3. 新增 `tests/helpers/real-host-floor-writer-verification.js` 与对应隔离测试；工具只通过注入 Context/Host Adapter 工作，不连接正式聊天。
4. 用现有生产 Schema 根构造测试 Snapshot，禁止发明第二套结构。

### Phase B：专用临时 Chat（条件进入）

1. 只通过宿主明确的“临时聊天”创建入口建立新 Chat。
2. 记录创建前后身份；若没有稳定、可复核的专用身份，立即输出 `HOST_TEST_BLOCKED`。
3. 每次操作前重新确认 Chat/Floor/message/Swipe/version/epoch。
4. 在目标消息上执行最小 Snapshot 写入，记录主 extra 与 active Swipe extra 的同步和其他字段保留。
5. 通过 CDP Network 观察请求，分别记录 `saveChat()`、debounced save、官方 GET/SAVE、readback、刷新结果。
6. 保存后执行官方 readback；必要时刷新专用临时 Chat，再确认 Snapshot。不能对正式聊天做补测。
7. 生命周期切换只在不可能离开专用隔离目标时执行；否则用隔离测试结果标记 `UNVERIFIED`，不强行操作。

## 3. 允许新增文件

- `tests/helpers/real-host-floor-writer-verification.js`
- `tests/real-host-floor-writer-verification.test.js`
- 当前任务目录的 `prd.md`、`design.md`、`implement.md`、`audit-report.md`

禁止修改生产 Coordinator、Adapter、Runtime、UI、业务规则、Snapshot Schema、宿主源码和真实正式 Chat/Floor。

## 4. 隔离测试 seam

- Host Context summary 与身份 guard；
- Snapshot probe 只更新 BioWeave 根；
- Save outcome 状态分类；
- Network/request recorder；
- 临时 Chat 未确认时 fail-closed。

所有竞争测试使用显式 Promise/deferred barrier，不使用固定延时。Mock readback 只标记 `ISOLATED_TEST_VERIFIED`。

## 5. 验证命令

```bash
npm run check
git diff --check
```

运行结果必须区分新增测试、既有工作区测试和真实宿主手工/自动化证据。不能以隔离测试通过替代 `HOST_VERIFIED`。

## 6. 结束条件

- 如果 Phase B 安全条件满足，报告真实目标、真实请求计数、保存/readback/刷新结果和风险。
- 如果不满足，报告 `HOST_TEST_BLOCKED`，写明缺少的具体身份/隔离证据；不得选择已有聊天继续。
- 完成报告后停止，不自动接入生产路径，不清理现有工作区。

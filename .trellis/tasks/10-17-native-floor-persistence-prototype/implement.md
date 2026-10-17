# 执行计划：宿主原生 Floor 快速保存隔离原型

## 前置门槛

- [x] 已获用户允许创建 Trellis 任务并进入规划。
- [x] 已读取 `AGENTS.md`、Floor State Ownership Contract、Lifecycle Contract、Architecture，以及两份既有宿主持久化审计。
- [x] 用户批准本次最终规划摘要后，运行 `task.py start` 进入 Execute；当前不得修改测试实现。

## Execute checklist

### 1. 建立测试模型

- [x] 新增 `tests/helpers/native-floor-persistence-prototype.js`。
- [x] 实现独立 live Context / official archive / save ticket 三层状态。
- [x] 实现 deterministic deferred barriers、save failure/unknown/readback mismatch、Chat/Swipe/message/epoch lifecycle mutation 和请求计数。
- [x] 实现 owner-scoped Snapshot merge，验证 sibling、extension、Swipe、历史 Floor 保留。

### 2. 实现候选操作

- [x] 实现目标 Floor token capture 与历史/非 Character/stale guard。
- [x] 实现 `context-fast` 和 `native-confirmed` 两种测试模式；不得将任何一种接入生产代码。
- [x] 实现 plugin-only per-key queue，并在报告中明确它不保护外部 writer。
- [x] 实现 Timing 与 Aggregation 两笔独立逻辑事务及 partial-success result。

### 3. 编写确定性测试

- [x] 覆盖 Timing changed/no-op、Aggregation changed/no-op、Timing + Aggregation 组合及重复执行。
- [x] 覆盖两个角色、两个 Snapshot、其他 extension `message.extra`、同 Floor 旧快照覆盖。
- [x] 覆盖 Chat/Swipe 切换、正文编辑、删除目标、epoch 变化、历史 Floor 拒绝。
- [x] 覆盖 save failure、server write/response 分离、response lost、readback mismatch、save-after-failure retry。
- [x] 每个用例断言 baseline/candidate 结果、GET/SAVE/readback、等待阶段、覆盖与最终确认状态；不依赖固定时间。

### 4. 运行与记录

- [x] 先运行新增定向测试，修复只影响测试模型的缺陷，不修改生产逻辑或削弱已有断言。
- [x] 生成/整理本任务 `audit-report.md`，引用原型、测试、生产源码和既有真实 Debug 的不同证据等级。
- [x] 将所有候选请求计数标为模型实测或理论值，不写成当前真实宿主保证。

### 5. 最终质量门

- [x] `npm run check`（1643 total；1627 passed；0 failed；16 skipped）
- [x] `git diff --check`
- [x] `git status`/`git diff --name-only` 核对新增范围；既有工作区变更未被覆盖。
- [x] 检查 Markdown 影响：本轮不改变生产行为，因此无需同步 README、Architecture 或 lifecycle contract。
- [x] 报告明确结论：若缺少 CAS/patch/confirmation，不能宣称存在可进入生产的少 GET native Floor 方案。

## 预期交付文件

- `tests/helpers/native-floor-persistence-prototype.js`
- `tests/native-floor-persistence-prototype.test.js`
- `.trellis/tasks/10-17-native-floor-persistence-prototype/audit-report.md`
- 本任务 `prd.md`、`design.md`、`implement.md`、`implement.jsonl`、`check.jsonl`

## 风险与停止条件

- 任何测试若需要导入生产 Coordinator/Adapter/Runtime 才能成立，停止并改为 test-only model，不扩大生产修改范围。
- 任何测试若依赖固定 sleep，停止并改为 deferred/barrier。
- 若模型无法表示某个真实宿主边界，标记 `UNKNOWN`，不通过简化模型提升安全等级。
- 若发现工作区已有修改与新增文件冲突，保留原修改并暂停整合，不使用 reset/clean/restore。

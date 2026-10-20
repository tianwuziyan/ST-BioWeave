# 实施计划

1. 建立失败回归循环
   - 在 `tests/projection-persistence.test.js` 增加“20 楼 A、26 楼 B、终点 26 只读 B、终点 23 读 A”的测试，并断言 26 楼没有 A 或 A 的删除记录。
   - 在 `tests/projection-runtime.test.js` 增加“同阶段零生成零写入”和“跨阶段一次替换”的测试。
   - 在 `tests/event-analysis-runtime.test.js` 增加“lease 先过期、真实正文后到达，仍等待 settled 后只处理一次”的测试。
   - 先运行三个精确测试文件，确认至少一个新增断言在旧实现上失败。

2. 实现 Floor 阶段快照解析
   - 在 `core/projection-persistence.js` 的 replay 层按现有身份字段选择 endpoint 前最近的内置阶段 creation Floor。
   - 保持 `storage/projection.js` 的现有 batch 写入和 Coordinator 不变；让 Delivery replay 从 surviving historical Floor creations 独立收集 Projection ID，不依赖已过滤的产品 views。
   - 验证 endpoint 回退、Floor 删除、Swipe/版本失效、两人物不同阶段和精确重放。

3. 调整 Projection Runtime 顺序
   - 阶段切换不再构造或保存旧阶段 lifecycle 记录。
   - 当前阶段完整存在时走复用路径。
   - 跨阶段完成内存生成后，只调用一次现有 `saveProjectionBatch()` 写新阶段。
   - 把最终 readback 收敛为一次，保留单独 lifecycle/creation 的兼容路径。

4. 收敛宿主尾部触发
   - provisional false start 后若出现真实正文信号，恢复延后并等待 Generation Lifecycle settled。
   - 保留打开角色卡无生成时的只读重绑和 hard-watchdog fail-closed。
   - 验证一个生成过程不会由 `MESSAGE_RECEIVED`、render、ended 各跑一次完整 Projection。

5. 同步文档与诊断
   - 更新 `.trellis/spec/domain/floor-state.md` 的阶段快照与 endpoint 回退契约。
   - 更新 `docs/ARCHITECTURE.md` 的内置阶段切换说明。
   - 更新 `docs/bioweave-data-lifecycle.md`，明确无新字段、append-only 历史和当前视图替换。
   - 复用现有 transient status/Debug seam 增加 `PROJECTION_STAGE_REUSED` 与 `PROJECTION_STAGE_SNAPSHOT`，不新增持久化状态。

6. 验证
   - `node --test tests/projection-persistence.test.js tests/projection-runtime.test.js tests/event-analysis-runtime.test.js`
   - `node --check storage/projection.js`
   - `node --check runtime/projection-runtime.js`
   - `node --check runtime/events.js`
   - `npm run check`
   - `git diff --check`
   - `rg -n "\\[DEBUG-" runtime storage core tests`
   - 审查实际 diff，确认未触碰 UI、Prompt、Timing/Aggregation 和 Coordinator。

## Review Gates

- 写实现前确认新增测试 seam 与 PRD 一致。
- Storage 通过后再改 Runtime；Runtime 通过后再改 host lifecycle，避免同时移动三个变量。
- 若必须修改 Projection schema、Timeline root 或 Coordinator，立即停止并回到规划，不自动扩大范围。
- 自动化通过后仍需用户在真实 SillyTavern 中验证一次长正文生成和一次跨阶段 Story Time；本任务不把 Node 测试描述成真实宿主验收。

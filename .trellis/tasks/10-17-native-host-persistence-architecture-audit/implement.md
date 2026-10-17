# 执行计划：宿主原生 Chat 保存机制架构审计

## 只读研究与测试步骤

1. 读取当前任务规范、上一轮两份 Floor/Timing 审计报告及当前生产链路，建立已确认事实、推测和未知项清单。
2. 固定读取 ST-SevenDaysCal 与 st_bs_biotracker 的生产源码、测试和相关文档；记录仓库 commit，避免使用未固定的在线页面作为唯一证据。
3. 搜索 BioWeave 的 Context、消息 extra/Swipe slot、原生 save、Coordinator、Timing、Aggregation 和 diagnostics 入口，记录函数/行号。
4. 新增只读隔离测试模型，使用 deferred Promise/barrier 覆盖候选方案的保存完成、owner 变化、同 Floor 合并和失败语义；不导入或改造生产持久化代码。
5. 运行新增测试、相关现有测试、`npm run check` 和 `git diff --check`；核对生产 diff，确保本轮没有生产逻辑变化。
6. 写入 `audit-report.md`，只把测试模型测得的计数写成实测值；理论值、未验证的真实宿主行为和缺失的 CAS 能力分别标注。

## 交付检查

- [ ] 参考仓库源码/测试调用图和 commit 已记录。
- [ ] BioWeave 当前链路、数据所有权和 `/api/chats/get` 根因已记录。
- [ ] A-D 每个方案有安全边界和证据等级。
- [ ] 测试场景包含成功、no-op、并发、切换、失败、刷新和 fallback。
- [ ] 没有修改生产持久化逻辑、真实数据或既有任务目录。
- [ ] `npm run check` 与 `git diff --check` 结果真实记录。
- [ ] 最终报告明确给出是否可进入生产改造以及所需真实宿主前置条件。

# 技术设计：宿主原生 Chat 保存机制架构审计

## 变更边界

本轮的最小行为目标不是替换保存实现，而是回答“宿主 Context 原地修改 + 原生保存是否能在现有 Floor 契约下成为安全实现”。生产写入边界仍以 `storage/floor-persistence-coordinator.js`、`storage/store.js` 和 `runtime/sillytavern-adapter.js` 为基线。本轮只新增隔离测试与审计文档，不改动这些生产文件。

预期新增文件仅为：

- `tests/native-host-persistence-audit.test.js`：测试专用宿主 Context/保存队列模型及确定性竞态场景；
- 本任务目录的 `audit-report.md`、规划文档及必要的研究记录。

明确不做：迁移生产写入、删除 Coordinator 读取/readback、修改宿主 API、合并 Timing/Aggregation 事务、改变部分成功语义、修改 UI 或真实 Chat。

## 证据层次

1. **源码静态证据**：当前 checkout、两个参考仓库固定 commit 的文件、函数和行号。
2. **隔离测试证据**：测试专用模型记录 `baseline_result`、`candidate_result`、GET/SAVE 计数、并发 mutation 和 `invariant_preserved`。
3. **真实宿主证据**：仅使用已有真实宿主诊断/项目记录；本轮不向真实宿主写入数据。

隔离模型不能证明 SillyTavern 的实际原子性。没有宿主接口契约支持的结论最高只能是 `CONDITIONALLY_SAFE` 或 `NOT_YET_PROVEN`。

## 测试模型

测试模型包含：

- 当前 Chat、active Swipe、消息正文/版本、Floor Version 和 BioWeave 自有 slot；
- 非 BioWeave `message.extra` 字段，验证字段所有权合并；
- 官方 GET/SAVE 模拟，SAVE 可被 deferred barrier 阻塞或失败；
- 当前宿主 Context 与持久化存档可独立变化；
- Chat/Swipe/正文/epoch mutation barrier；
- 同 Floor sibling patch 与 Timing/Aggregation 两个 Snapshot；
- 原生保存不可用时的严格 fallback 标记。

候选模型只用于暴露原地写入/批量写入/前置 dirty 判断的安全边界。它不会修改或替代生产 Coordinator。

## 评估标准

- 原生 save 函数的调用只代表“提交给宿主”，不代表 confirmed；必须有显式完成信号或权威 readback。
- Context token、Floor Version、Swipe 和 epoch 在修改前及异步完成后都必须仍匹配。
- 直接修改一个 Snapshot 必须保留同 Floor 其他 owner 字段和其他扩展字段；历史 Floor 不得写入。
- Timing no-op 不能跳过 Aggregation 输入重评估；Timing 参数不变时，Exposure/Window/依赖状态仍可能让 Aggregation changed。
- 单一原生 SAVE 不能在没有额外事务日志、回滚或独立确认的情况下自动等同于现有 Timing 成功/Aggregation 失败的部分成功语义。

## 报告结构

报告按“执行摘要 → 参考项目 → BioWeave 当前链路 → 契约/架构差异 → 候选 A-D → 测试结果 → 性能与等待 → 推荐路线 → 真实宿主前置条件”组织。每一项结论附来源位置并标明证据层次。

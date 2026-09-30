# 审计设计

## 方法

采用只读、证据优先的分层审计：

1. 读取当前 worktree 状态、适用 AGENTS/spec 与相关任务背景。
2. 建立真实文件/符号索引，沿生产入口反向追踪 import、调用、存储读回和 UI 消费。
3. 分别审计纯 Core 能力与 Runtime 接线，避免函数存在被误判为生产启用。
4. 用 Floor/Swipe/Version 作为 provenance 轴，检查 derived registry、tracking、state、snapshot 和 UI 是否绕过权威来源。
5. 阅读相关测试并运行现有低风险检查；把测试存在与真实 Runtime 接线分开报告。
6. 对代码与规范/README/架构文档逐项比对，记录 `DOC/CODE MISMATCH`。

## 证据结构

报告按 A–R 输出，关键结论带 `path:line` 或符号名；每个模块分别说明：代码存在、生产调用方、持久化位置、UI 调用方、生命周期/删除行为和当前状态。

## 关键边界

- Floor facts 只从当前有效 Character Floor + active Swipe + 完整六字段 Floor Version 读取。
- Registry 是 canonical identity snapshot，不等于 Tracking Subject、Character Profile 或 Current State。
- Tracking 是由有效 Event 重建的 derived projection；Window 独立于 Event/ Episode，不能从 schema 或目标文档推断已实现。
- StateReducer 的纯函数支持与 Runtime Current State API 必须分别判定。
- Snapshot 只有被 `getCurrentBiologicalState()` 或等价生产路径实际读取才算 Runtime 接线。
- Projection 只审计其是否读取 Current State，不提出或执行施工。

## 风险与回滚

本任务不改变生产代码，不需要业务回滚。仅新增/更新本 task 的规划与审计记录；若发现 worktree 在审计期间出现非本任务变化，停止写入 task 以外文件并报告。

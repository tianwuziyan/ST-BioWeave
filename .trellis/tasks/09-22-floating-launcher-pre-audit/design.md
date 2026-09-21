# 审计与规划设计

## 证据策略

1. 以 SevenDaysCal GitHub 源码为第一方参考，记录文件、函数和调用顺序。
2. 以当前 BioWeave 工作树和 `fix/world-model-prompt-baseline` HEAD 为实现事实，不按设计文档猜测。
3. 只读检查现有 UI、Host Entry、Runtime、任务状态、设置存储和生命周期测试。

## 重点边界

- Floating Launcher 只能是 Host/UI 入口与状态视图，必须复用现有 UI open callback。
- 位置数据必须进入独立 UI preference，不得进入 Floor、Snapshot、State、Event、Projection 或 World Model。
- 不新增 Runtime、Panel、分析调度或业务状态源。

## 输出结构

按用户要求输出 A–M：参考源码事实、BioWeave 源码事实、接口复用/缺失、架构、状态、生命周期、持久化、跨设备交互、风险、Wave、重复逻辑和测试计划。

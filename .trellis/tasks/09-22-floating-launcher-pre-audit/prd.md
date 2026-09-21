# BioWeave Floating Launcher Pre-Audit

## 目标

只读审计参考项目 SevenDaysCal 与当前 BioWeave 分支，确定 Floating Launcher 是否具备直接实施条件，并形成带源码证据的最小实施规划。

## 范围

- 阅读 SevenDaysCal 中浮动入口的创建、挂载、拖动、点击判定、边界、吸附、位置持久化、移动端 Pointer/Touch、状态、初始化、Chat 切换、reload/destroy 清理实现。
- 阅读 BioWeave 当前 Host Entry、UI shell、Runtime coordinator、分析任务状态、设置合同和生命周期实现。
- 明确复用接口、缺失接口、状态映射、位置存储边界、重复 mount/stale DOM/listener 风险和最小实施 Wave。
- 不修改产品代码、测试、现有文档或业务数据结构。

## 验收条件

- 输出 A–M 全部审计结论，并引用实际源码文件与函数。
- 清楚区分 SevenDaysCal 可借鉴机制与 BioWeave 不兼容部分。
- 给出 idle/running/success/error/disabled 的最小状态来源，且不把 Active Projection 当作 running。
- 明确位置只属于 UI preference，Chat 切换和 extension reload 的行为可验证。
- 只列真实 blocker，并明确是否已具备直接实施条件。

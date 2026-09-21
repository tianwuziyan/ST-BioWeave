# 审计执行计划

1. 获取并定位 SevenDaysCal 相关源码，记录浮动入口完整调用链。
2. 搜索 BioWeave 当前入口、UI open/close、Runtime 状态、设置和 destroy/reset 代码。
3. 对照两套实现，识别可复用机制、架构冲突和真实 blocker。
4. 设计最小 Floating Launcher Wave、状态映射、测试矩阵和宿主生命周期防护。
5. 运行只读检查（Git diff/status、源码搜索、必要的现有测试清单确认），不修改产品代码、测试或既有文档。

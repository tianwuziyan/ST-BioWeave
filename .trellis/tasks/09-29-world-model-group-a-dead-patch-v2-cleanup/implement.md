# Implementation Plan

1. 记录修改前 status、diff 和测试 baseline。
2. 全仓搜索两个 legacy symbol 的定义、调用、exports、re-exports、动态 lookup、tests、docs 和 package/public surface。
3. 阅读两个函数完整实现，记录 input contract、Evidence Guard 语义和 current replacement。
4. 证明 Full/Supplement/runtime/UI current call graph 不经过 legacy path。
5. 根据 gate 结果：FAIL 则停止并报告；PASS 才删除 dead-island assets。
6. 扫描 legacy symbol，确认 current production/test/spec count；确认所有 current lower-level symbols 仍在。
7. 验证 prompt、Fact Delta、Patch V2 classification、Snapshot、Floor/renderer invariance。
8. 运行 syntax、required tests、full test、diff check，并比较 failure identity。

禁止修改 Debug Schema v3、Fact parser、Resolver、current guards、retry、Snapshot、persistence/readback/UI projection 和 Group A 之外的代码。

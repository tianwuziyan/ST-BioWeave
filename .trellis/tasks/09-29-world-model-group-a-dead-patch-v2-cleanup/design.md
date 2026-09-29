# Technical Design

先进行只读审计，再决定是否进入删除阶段。审计需要覆盖定义、直接/间接调用、exports/re-exports、动态属性、测试、docs/examples、package entry 和 plugin surface。

如果 gate 通过，删除只限两个 compatibility entry/guard 及其仅服务于它们的 helper/export/test/comment/spec reference；不触碰 current Fact Delta safety boundary 或 Patch V2 lower-level primitives。

验证重点：current Supplement 通过 JSON Fact Delta parser、resolver、Fact Delta safety boundary、classification 和 classified merge；Full 通过其现有 Evidence Guard；两者均不依赖 legacy raw Patch V2 entry path。

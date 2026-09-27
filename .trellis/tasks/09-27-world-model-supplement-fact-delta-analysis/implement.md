# Fact Delta Protocol v1 后续实施计划（本轮不执行）

1. 决定并冻结 existing mechanism correction 与 existing projection update 的 blocker
   处理；没有 Patch v2 授权就从 v1 排除。
2. 隔离实现 self-contained Fact parser、exact vocabulary validator 与 canonical DTO。
3. 实现 pending identity dependency、Existing resolver、canonical dedupe/conflict。
4. 实现 Fact → 既有 Patch v2 adapter，不改变 operation set、Guard、merge 或 schema。
5. 只改 Supplement prompt/output contract；保留所有共享 evidence/extraction rules。
6. 直接切换 production parser；禁止 Candidate fallback、dual parse 与长期 feature flag。
7. 解析/验证/依赖失败交给现有 retry mechanism；耗尽后 fail closed。
8. 完成 focused/full tests 与 real-host acceptance 后，旧 Candidate parser 仅保留给 compatibility tests 或其它明确调用者。

验证：`npm run check`、focused `tests/world-model.test.js`、`node --check`、
`git diff --check`、generic fixture leakage audit；Node tests 不替代真实 Host 验收。

本轮不执行任何代码、测试、production prompt、spec、schema、Floor、UI、Full/Event、
`system_top` 或 `system_bottom` 修改。

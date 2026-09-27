# 实施计划

1. 完成当前 parser、resolver、Guard、diagnostic transport、LIVE STATE projection 与
   Settings debug rendering 的精确符号审计；记录现有旧字段消费者和 Floor/debug
   read-only 静态边界。
2. 在 `ai/world-supplement-protocol.js` 实现最小、schema 驱动的 text payload
   continuation；补齐 P1-P9 parser regression，并确认不改变 structured/boolean/address
   parsing。
3. 在 `ai/prompts.js` 增加一条最小 physical-line serialization 指令。
4. 在 `ai/analyzer.js` 审计 Type_Identity 的 evidence unit parent scope、candidate/
   scoped/matched filtering 与 rejection diagnostics；按审计结论仅做最小 Guard 修复
   或仅补 fail-closed regression。同步阶段计数与 accounting invariant。
5. 贯通 `runtime/world-analysis.js`、`runtime/diagnostics.js`、`runtime/events.js`、
   `ui/app.js` 与 Settings debug 展示所需的新字段；保留 freshness、snapshot 和历史
   trace contract。
6. 补充 G1-G6、D1-D6 以及 resolver/operation/read-only/Floor boundary tests，统一
   使用 generic fixtures。
7. 运行 modified JS 的 `node --check`、focused tests、Floor architecture/static
   boundary tests、`npm run check`、`git diff --check`；检查实际 diff 与未授权文件。
8. 最终报告按用户指定 A-M 结构，明确 Type Identity 是 unsupported inference 还是
   false rejection；不 commit、不 push。

## Review gates

- Parser policy must be explicit in code comments/tests before implementation is accepted.
- Every parsed Fact has exactly one terminal disposition bucket; no mixed-stage aggregate
  can be presented as a raw Fact total.
- Evidence diagnostics must expose indices/counts only, not full evidence bodies.
- Debug collector must remain free of `saveWorldModel`, `commitFloorPatch`, `store.saveFloor`,
  analysis, repair, and canonical mutation calls.
- Floor path must remain `saveWorldModel → commitFloorPatch(owner="world") → existing
  coordinator → authoritative readback → FLOOR_TX_CONFIRMED`.

## Completed verification notes

- Focused `tests/world-model.test.js` and `tests/world-model-debug.test.js`: 264 passed.
- `npm run check`: 1058 passed.
- Modified JavaScript syntax checks and `git diff --check`: passed.
- No changes were made to `storage/floor-persistence-coordinator.js`, World renderer,
  refresh scheduling, or live-state sampling/fingerprint comparison architecture.
- The actual Host-like Type Identity evidence chain is candidate evidence present,
  scoped evidence absent, matched evidence absent; conclusion is unsupported inference,
  so Guard behavior was not relaxed.

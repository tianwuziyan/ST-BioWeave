# Context-first Floor Writer Execute 计划

## 当前状态

`IN_PROGRESS`。用户已 review 并批准 Execute；本文件只允许测试隔离原型、确定性测试和报告，不授权修改生产路径。

## 1. Execute 文件边界

建议新增：

- `tests/helpers/context-first-floor-writer-prototype.js`：独立原型、Context locator、merge、queue、host adapter、状态机。
- `tests/context-first-floor-writer-prototype.test.js`：确定性 Promise barrier 测试。
- `.trellis/tasks/10-17-context-first-floor-writer/audit-report.md`：执行结果、请求计数、反例和结论。

禁止修改：

- `storage/floor-persistence-coordinator.js`
- `storage/store.js`
- `storage/projection-timing.js`
- `storage/participant-aggregation.js`
- `runtime/events.js`
- `runtime/event-analysis.js`
- `runtime/sillytavern-adapter.js`
- 任何 UI、宿主或真实 Chat/Floor 数据

## 2. 实施顺序

### Phase 1：参考实现快照和测试 fixture

1. 在报告中记录 SevenDaysCal `snapshot.js` 的实际机制：Context 读取、幂等比较、主 extra/当前 Swipe extra 双写、debounced save。
2. 记录 BioTracker 的 Chat State 队列、未知状态保守写入和 host adapter 边界。
3. 构造包含多个 message、多个 Swipe、历史 Floor、其他扩展 extra、多个 BioWeave root 的 fixture。

通过条件：fixture 能独立表达当前目标身份和历史不可变性；没有引用生产 Coordinator。

### Phase 2：纯函数 Snapshot Merge

1. 实现 owner 到 root 的白名单。
2. 实现完整继承和 explicit empty sentinel。
3. 实现 sibling root、外部 extra、其他 Swipe、历史 message 保留。
4. 对输入做 clone，断言原输入不变。

通过条件：Event、World、Tracking、Projection、Timing、Aggregation 的 patch 独立/组合结果稳定；相同输入幂等。

### Phase 3：Identity locator 和 Context writer

1. 从模拟 Context 解析 Chat/Floor/Message/Swipe/Version/Epoch。
2. 修改 `message.extra` 和当前 `swipe_info[swipe_id].extra` 的同一 BioWeave payload。
3. 保留其他扩展字段，不替换整条 message。
4. 在每个实际写入前重新校验当前 Context，不复用失效引用。

通过条件：Chat、Swipe、正文、删除、epoch 或版本变化均进入 STALE/拒绝；不会写错目标。

### Phase 4：队列和保存状态

1. 按 Chat/Floor/Swipe 串行化插件内部任务。
2. 通过可控 Promise 模拟 `saveChat()` 成功、失败、响应丢失、防抖未完成。
3. 只有显式 readback 匹配才产生 `CONFIRMED`。
4. 无法判断的结果为 `UNKNOWN`，不自动重放旧 payload。

通过条件：状态转换和错误码在 barrier 场景中稳定；队列不声称保护外部标签页/设备。

### Phase 5：Timing/Aggregation 两阶段流程

1. Timing 和 Aggregation 使用两笔原型逻辑事务。
2. 保持 Instance/Cycle/sampled offset。
3. 保持 Aggregation 幂等和 Timing 成功/Aggregation 失败的部分成功。
4. 在 Timing 未确认时不得继续报告已完成的 Aggregation 前置状态。

通过条件：四种组合均有明确结果：Timing no-op/changed × Aggregation no-op/changed；失败不会被吞掉。

### Phase 6：请求计数和审计报告

每个场景记录：

- official GET/SAVE；
- prototype GET/SAVE；
- merge count；
- queue wait；
- status；
- readback；
- overwrite；
- external concurrency limitation。

必须把 0 GET 作为测试模型结果，不写成真实宿主保证。报告结论按 `IMPLEMENTED_IN_PROTOTYPE`、`TESTED_IN_ISOLATION`、`HOST_VERIFIED`、`CONDITIONALLY_SAFE`、`PROVEN_UNSAFE`、`BLOCKED` 分类。

## 3. 测试执行要求

使用：

```bash
npm run check
git diff --check
```

测试必须使用 Deferred/Promise barrier，不使用固定延迟。若完整测试集已有日志输出，区分“测试通过但模拟暴露的预期错误日志”和实际失败。

## 4. 回退

由于原型只在 tests/helper 和 Trellis task 目录：

- 可删除/停用原型文件而不触及生产逻辑；
- 不执行 `git reset`、`clean` 或覆盖无关目录；
- 不删除旧 Coordinator；
- 若候选暴露覆盖风险，保留原型和反例报告，不为通过测试而放宽断言。

## 5. 验收门槛

只有同时满足以下条件，才可把原型结论写成 `TESTED_IN_ISOLATION`：

- 20 类并发/失败场景均有明确断言；
- 外部扩展、旧标签页和整 message 替换至少有一个确定性反例或限制结论；
- Timing/Aggregation 部分成功保持；
- no-op 不触碰对象、不保存；
- 双写、历史 Floor 和显式清空有独立断言；
- `npm run check`、`git diff --check` 通过。

仍不能写成 `HOST_VERIFIED`，除非用户另行授权在独立临时 Chat 中进行真实宿主验证。

## 6. Execute 状态

用户已完成 review 并批准 Execute；本任务已通过 `task.py start` 进入 `in_progress`。最终报告保留真实宿主未验证和外部并发未解决的限制，并接受原型可能以 `PROVEN_UNSAFE`/`BLOCKED` 结束，而不是以“0 GET”作为成功标准。

# 技术设计：并发 canonical 派生构建合并

## 变更边界

行为缺口位于 `runtime/event-analysis.js` 的多个 `collectActiveBusinessData()` 调用共同进入
`collectCurrentDerivedState()`。本任务只在该共同纯派生层增加短生命周期的 in-flight 合并，
不共享外层 DTO，也不改变任何权威校验和持久化流程。

预期生产文件：

- `runtime/event-analysis.js`：拥有 in-flight entry、代际判断、清理和安全诊断。
- 如现有 runtime facade 需要传递明确代际或 phase，只做窄接口 wiring，不改变公共业务结果。

预期测试文件：

- `tests/event-analysis-runtime.test.js`：并发合并、代际失效、失败清理、调用方选项隔离和旧 Snapshot 竞态。
- 只有现有 continuation 集成测试无法覆盖时，才扩展对应现有测试文件；不新增独立测试框架。

## 合并层级

不共享完整 `collectActiveBusinessData()` Promise，因为：

- `includeDebug` 会改变调试 DTO；
- `route`、`reason` 进入诊断输出；
- 各调用方需要保留自己的当前 target 校验、Snapshot readback 和 stale guard；
- 返回对象包含可变嵌套数据，直接共享会有调用方互相修改风险。

共享对象限定为一次代际内由 `collectCurrentDerivedState()` 产生的派生结果。共享结果完成后，
每个调用方继续独立完成自己的业务 DTO 构建和权威检查，并对外返回隔离的数据对象。

## 代际与失效

合并键必须包含当前 Chat、Floor、active Swipe、完整 Floor Version，以及能够区分同一
Floor Version 下 Snapshot/Tracking 更新的 runtime generation/revision。优先复用现有可靠的
Snapshot commit / persistence epoch / Tracking refresh revision；若它们无法提供统一代际，
使用由当前 `event-analysis` owner 管理的短生命周期 generation token：

1. 每次 Event commit/readback 成功后推进；
2. 每次 Tracking rebuild 完成或明确失效后推进；
3. Chat、active Swipe、Floor Version 或 analysis phase 变化时推进并拒绝旧 entry；
4. in-flight entry 完成或失败即删除，不保存结果。

关键竞态：A 在旧 generation 开始后发生新 Snapshot commit，generation 变化；B 生成新 key，
不会加入 A。A 即使完成，也必须经过原有 stale execution 校验，不能写入新代际。

## 错误与引用安全

- entry 保存原始 Promise、started timestamp 和 generation 元数据；构建异常通过原 Promise 传播。
- `finally` 删除 entry，只有仍指向同一 Promise/entry 时才删除，避免旧任务清掉新任务。
- 对共享派生结果使用现有 clone/normalization 边界；不能让调用方修改 in-flight 内部对象。
- 不做额外 `JSON.stringify`、完整 Snapshot 构造或敏感内容诊断。

## 诊断

使用现有 persistence/history trace，记录计数和安全元数据，不记录 Event 正文、evidence、Prompt
或 API Key。每次 build 只记录开始、加入、完成/失败及毫秒数；joined 请求记录等待时间。
诊断为有界的本次 runtime trace，不能保存无限增长的 per-request 明细。

## 兼容性与回滚

这是运行时内部的短生命周期合并；关闭/移除合并层即可恢复原调用路径。Event、Snapshot、
Tracking、Projection 与 Scheduler 的公共语义保持不变。若任何输入无法证明等价，则该请求
绕过共享并独立构建。

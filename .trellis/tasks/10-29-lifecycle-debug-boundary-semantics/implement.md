# Implementation Plan

1. 更新生产 SillyTavern adapter 生命周期 listener：
   - 增加可选 fail-open trace callback；
   - 记录宿主同步返回策略、handler Promise 形态、投递状态与耗时；
   - 保持返回值恒为 `undefined`。
2. 更新 `runtime/events.js`：
   - 把 trace callback 传入 production `subscribeLifecycle`；
   - 替换 generation Projection refresh 的歧义字段；
   - 为 refresh 和 Runtime init 增加有限阶段耗时；
   - 不改变 lifecycle/初始化控制流。
3. 更新 `runtime/diagnostics.js` 与安全 allowlist：
   - 接受新字段；
   - summary 拆成 `host_boundary` / `runtime_boundary` / initialization；
   - 删除旧字段和旧映射。
4. 补充测试：
   - adapter 立即返回、同步抛错、异步 rejection、trace callback 失败；
   - Runtime 内部顺序与新字段；
   - diagnostics summary 新结构和旧字段缺失；
   - init 成功、fail-open/终止失败阶段的耗时与状态。
5. 同步直接相关 Markdown/code-spec，检查旧语义引用和孤儿字段。
6. 验证：
   - `node --check runtime/sillytavern-adapter.js runtime/events.js runtime/diagnostics.js`
   - `node --test tests/runtime.test.js tests/diagnostics.test.js tests/event-analysis-runtime.test.js`
   - `npm run check`
   - `git diff --check`
7. 检查实际 diff，只保留本任务文件；不提交或 push，除非用户另行授权。
8. 删除 Floor 回归：
   - 先补 Projection 目标在运行期间变旧的失败测试；
   - 仅将 `STALE_FLOOR_VERSION` 归类为 stale-context cancellation；
   - activity 以 neutral cancellation 收口，不写 error/success；
   - 验证真正的 readback/persistence failure 仍为 failed，并验证 lifecycle 最近合法
     Character Floor 回退测试继续通过。

## Verification Result

- 定向测试：407 通过，0 失败。
- 完整 `npm run check`：1941 通过，16 跳过，0 失败。
- `git diff --check`：通过。
- 旧歧义字段已从生产代码、allowlist、summary 和文档中移除；测试仅保留一条
  `projection_refresh_awaited` 不存在的负向断言。
- 尚未执行真实 SillyTavern 页面 Performance trace；新初始化阶段耗时用于后续
  真实宿主性能定位，不影响本任务的边界语义验收。
- 删除 Floor 回归：Projection stale-context 用例 2 条通过；删除最新/中间 Floor、
  最近合法记录与身份快照回退用例 4 条通过；完整 `npm run check` 更新为 1943 通过、
  16 跳过、0 失败，`git diff --check` 通过。

## Risk / Rollback Points

- `subscribeLifecycle` 是宿主响应性边界；任何测试发现 listener 不再同步返回
  `undefined`，立即停止并回退 adapter trace 方式。
- `runtime.init()` 计时不得包掉或转换异常；测试必须对比原返回/抛错语义。
- 当前 worktree 有其它未提交修改；实现和验收按本任务文件精确审查，不清理其它改动。

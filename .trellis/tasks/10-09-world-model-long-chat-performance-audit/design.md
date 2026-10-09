# Technical Design: 只读性能审计

## Boundary

本任务不实现优化。审计只读取当前 checkout 的源代码、规范、测试、fixtures 和 Git 状态；如需性能实验，只在进程内构造 synthetic messages/slots，并通过现有模块 API 或独立 instrumentation 采集结果，不写回 Host、Floor、Chat metadata 或 fixture。

## Evidence model

每条发现保留四类信息：

1. `CONFIRMED`：直接由源代码控制流/调用计数或可重复测量证明。
2. `LIKELY`：代码路径显示风险，但缺少完整 real-host 或分层计时证据。
3. `UNVERIFIED`：当前测试/fixture/环境不能安全验证，不能作为根因。

报告将把 CPU、Promise/async 等待、Storage/Host I/O、Network 和 DOM/render 单独记录；若模块边界无法分离，则报告测量代理及误差来源。

## Read-path map

从 World owner 出发检查：

```text
UI action / lifecycle event
  -> ui/app.js orchestration
  -> runtime/events.js facade or runtime/event-analysis.js coordinator
  -> runtime/world-analysis.js resolver/reload
  -> runtime/floor.js / resolveFloorAtIndex
  -> storage/store.js
  -> runtime/sillytavern-adapter.js host slot I/O
  -> ai/analyzer.js normalize / view model
  -> ui/world.js / ui/app.js render
```

实际代码若存在不同路径，以代码为准；报告需列出分支、重复调用和扫描边界。

## Measurement strategy

- 先运行既有 World Model、Floor、event-analysis、UI-ingress/debug 相关测试，确认基线。
- 搜索是否存在可复用 fake Host/store/fixture；优先复用，避免新增测试代码。
- 如现有测试没有性能 harness，使用临时内存脚本或 Node `--input-type=module` 进程，通过 wrapper 计数并在 stdout 输出结果；临时脚本不纳入 repository，不修改 fixture。
- 规模至少覆盖小/中/大 synthetic history；规模与数据生成方式写入报告。
- 对无法隔离 DOM 的 UI 阶段只报告代码级 call count，real-host DOM timing 标记为 UNVERIFIED。

### Controlled benchmark matrix

性能实验优先构造独立、内存内、可重复的 synthetic 数据，不读取或修改用户真实 Chat。至少形成以下正交变量：

| 变量 | 控制方式 | 目的 |
| --- | --- | --- |
| Floor/message count | 固定每个 Floor 的 World payload，改变消息/Floor 数量 | 区分历史扫描与 UI 初始化随楼层增长的成本 |
| Current World Model size | 固定 Floor 数量和快照数，改变 species/type/rules/archive payload 大小 | 区分 normalize/clone/view-model/DOM 数据体积成本 |
| Historical snapshot count | 固定当前模型大小和消息数量，改变有效历史 World 快照数量 | 区分 resolver 历史读取与历史数据聚合成本 |
| UI lifecycle | 固定同一 World 数据，分别执行一次打开、重复打开、refresh/persistence-confirmed 事件序列 | 区分 UI initialization 和 event amplification |

每组记录 CPU 时间、Promise/async 等待、Storage/Host read count、normalize/clone/stringify/view-model/render 计数；不能隔离的 Network 和真实 DOM 时间标记为 `UNVERIFIED`。循环、clone 或 stringify 只作为待测候选，不作为结论。

### Historical-version semantics matrix

审计实际 owner-slot 写入和 resolver 回退，至少验证以下逻辑模型：

```text
Floor 10: World Model A, species X active
Floor 20: Archive X -> World Model B, X archived from Floor 20
Floor 21+: no new World edit -> resolve B
remove Floor 20+ and return to Floor 18 -> resolve A, X active again
```

同时检查独立后续快照、删除中间 Floor、Archive/Restore/Permanent Delete、Swipe switch 和 Chat switch。任何建议必须保留 complete Floor Version、active Swipe、Chat scope、authoritative readback 和 stale invalidation；不能用全局 latest model 或新建 global cache 简化回退。

## Safety and compatibility

不提出以 Chat-level cache、inactive Swipe、stale Floor、last_processed_floor、message.extra mirror 或跳过 authoritative readback 换取速度的建议。任何候选优化都必须保留 Floor Version、owner/epoch/stale-result guards、archive semantics 和 event invalidation。

## Rollback

审计无生产写入；若临时脚本或 task artifact 需要撤销，只删除本任务新增文件，不能触碰用户已有 worktree 修改。不得使用 reset、clean 或 broad restore。

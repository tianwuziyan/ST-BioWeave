# World 页面手动 Full/Patch 分析

## 目标

世界页固定提供 `开始分析` 与 `补充分析` 两个 World-only 操作。底层只定义两种 World Analysis 能力：Full World Analysis 与 World Patch Analysis；Manual/Auto 只是触发条件，不复制业务实现。

Initial Full Analysis 与 Manual Full Reanalysis 不是两个功能，而是同一个 Full World Analysis 能力在不同上下文下的使用。

## 业务定义

### Full World Analysis

`开始分析` 始终执行同一个 Full World Analysis，无论当前是否已有 World：

```text
当前有效 Character Floor 上下文
→ Full World Analysis
→ 完整 World Model
→ validate / normalize / consistency guard
→ stale guard
→ 保存到当前 Character Floor
```

无 World 时建立完整模型；已有 World 时仍完整重建并替换当前 Floor 的 World，不使用 Patch 基底，不修改历史 Floor。Initial Full、Manual Full、Auto Full 必须复用同一个 Full 能力。

### World Patch Analysis

`补充分析` 始终执行同一个 World Patch Analysis，前提是当前有效 Character Floor 已存在有效 World：

```text
读取已有有效 World
→ 分析当前上下文中新增、遗漏或需要修正的信息
→ AI 只输出 Patch
→ validate Patch
→ deterministic merge(existing World, Patch)
→ validate final World
→ stale guard
→ 保存当前 Character Floor
```

未提及字段继续保留；Patch 不得重新生成完整 World、删除旧字段或绕过 deterministic merge。Manual Patch 与 Auto Patch 必须复用同一个 Patch 能力。

## 触发规则

- Manual “开始分析”：强制 Full；前提是存在有效 Character Floor。
- Manual “补充分析”：强制 Patch；前提是存在有效 World。
- Auto 无有效 World：Full，成功后才 Character/Event。
- Auto 有有效 World 且当前 Floor 有确实的 world-relevant 更新证据：Patch，成功后才 Character/Event。
- Auto 有有效 World 且没有 world-relevant 新证据：不调用 World AI，Reuse 现有 World，随后 Character/Event。

自动流程不能因为“已有 World”就每次强制 Patch。

## UI

世界页始终显示 `[开始分析] [补充分析]`。

- “开始分析”：有效 Character Floor 存在时可用；运行显示 `分析中…`。Tooltip：`重新分析当前上下文，构建完整的世界模型。`
- “补充分析”：有效 World 存在且无 World job 运行时可用；运行显示 `补充中…`。可用 Tooltip：`基于现有世界模型查漏补缺，补充或修正遗漏的世界信息。`
- 无有效 World 时“补充分析”仍显示但 disabled。Tooltip：`需要先建立世界模型后才能进行补充分析。`
- 任一 World job 运行时两个按钮均不得启动第二个请求。

## 不变规则

- UI 不直接调用 Analyzer/persistence；Runtime 提供 World-only Full/Patch 入口。
- Manual Full/Patch 不触发 Character/Event；Auto 只有 World 成功或 Reuse 后才进入 Character/Event。
- Full/Patch/Auto 共用 complete Floor Version（`chat_id`、`message_id`、`floor`、`swipe_id`、`content_hash`、`message_version`）single-flight/互斥。
- 仅当前有效 Character/assistant Floor owner 可写；User-only Chat 不持久化，不创建 virtual Floor；历史 Floor immutable，forward-only persistence。
- API、parse、validate、normalize/merge、final validation、stale guard、persistence 任一阶段失败都 fail closed，保留已有有效 World。
- 保持 active Swipe ownership、canonical strict Validator、Patch deterministic merge、stale guard；不实现 Repair Retry，不修改 StateReducer、Snapshot、Projection、schema、analysis interval、migration 或 `user_override`。

## 验收标准

- 两按钮、文案、Tooltip、disabled/loading 状态正确。
- Manual Full 无/有 World 都走同一个 Full，不走 Patch；Manual Patch 仅有 World 时走 Patch并保留未提及旧字段。
- Auto 无 World/有更新/无更新分别走 Full/Patch/Reuse。
- Manual Full/Patch Character/Event API calls 均为 0；Auto 只有 World 成功或 Reuse 后才允许 Character/Event。
- 失败/stale 不覆盖原 World；历史 Floor 不变；User-only Chat 不持久化。
- Full+Full、Patch+Patch、Full+Patch、Auto+Manual 同 Floor Version 不产生并发 World 请求或写入。
- 覆盖按钮、调用路由、merge 保留、失败、历史不可变、single-flight、自动选择、stale、User-only 和 Tooltip 测试。
- 通过 `npm run check`、变更 JS 的 `node --check`、`git diff --check`；真实宿主验收另行记录。

## Out of scope

StateReducer、Snapshot、Projection、Character/Event schema、analysis interval、World schema 重设计、legacy compatibility、migration、Repair Retry、user override 及其它页面。

## 阻塞问题

无。

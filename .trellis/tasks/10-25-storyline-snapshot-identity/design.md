# 技术设计：剧情支线快照按人物归属、当前楼层重写

## 1. 问题边界

当前 `subject_id` 已经是 `storyline_snapshots` 的 Map key，但
`snapshot_id` 同时把完整支线内容、计数状态和 `created_at_floor_version`
放入确定性摘要。运行时从旧 Floor 读取状态后，修改并写入当前 Floor 时，
storage 会正确地把完整集合重新绑定到当前 Floor；运行时却仍拿旧版本对象的
`snapshot_id` 做 readback/ judge stale 比较，导致合法的完整重写被误判为失败。

本任务只修正身份职责，不改变 Floor 所有权：

```text
最近完整快照（逻辑基线）
  -> 按 subject_id 修改人物状态
  -> 将完整集合重绑定当前 Floor/Swipe
  -> 保存并回读当前 Floor
```

## 2. 身份分层

| 字段 | 责任 |
| --- | --- |
| `chat_id` | Chat 作用域，不表示人物 |
| `subject_id` / `character_id` | canonical 人物身份和快照归属键 |
| `created_at_floor_version` | 当前副本的 Floor/Swipe provenance 和 stale ownership |
| `branch_id` | 支线身份，选线后继续使用 |
| delivery/attempt ID | 回执、判定尝试和幂等控制 |

不再把 `snapshot_id` 当作产品业务身份。最小实现可以移除快照 DTO、校验、
readback 和 judge stale guard 对它的要求；如果仍需要内容指纹，只能作为
运行时比较工具，并且不能把 Floor provenance 作为人物状态身份的一部分。

## 3. 受影响代码

- `core/projection-storyline.js`：移除 snapshot ID 构造/校验依赖；保留
  `subject_id`、branch、delivery 和 attempt 的现有约束。
- `storage/projection.js`：继续按 `subject_id` overlay 并把完整集合
  restamp 到当前 `resolved.version`；不再为保存成功制造或要求快照业务 ID。
- `runtime/projection-storyline-runtime.js`：
  - `saveVerified()` 用 subject、状态和分支结构比较当前 Floor readback，
    不比较旧快照的 `snapshot_id`；目标快照必须先按当前 Floor 规范化；
  - judge API 返回后使用当前 Floor/subject/attempt 的 stale guard，不再以
    snapshot ID 判断是否可以继续；
  - 继续保留 owner/epoch/Floor Version 校验和 complete sibling readback。
- `runtime/diagnostics.js`、`runtime/events.js`、`ui/settings.js`：安全摘要和
  设置 Debug 只显示人物、状态、支线与判定信息，不再读取或显示 storyline
  `snapshot_id`；其它 Projection triggered snapshot 的 `snapshot_id` 不变。
- `tests/projection-storyline.test.js`、`tests/projection-storyline-runtime.test.js`
  及必要的 storage tests：覆盖人物键、旧 Floor 基线到当前 Floor 重写、
  late judge、回退和兄弟人物。
- `docs/ARCHITECTURE.md`、`.trellis/spec/domain/floor-state.md`、
  `docs/bioweave-data-lifecycle.md`：只同步最终已实现的身份/重写契约。

## 4. 不做的事

- 不移除 `created_at_floor_version` 或 Floor Version stale guard。
- 不改变 delivery receipts、branch IDs、attempt IDs 或 API 消息格式。
- 不改变人物 registry、Event、Tracking、Pregnancy 或 UI 数据模型。
- 不把状态提升到 Chat/runtime cache，也不合并多个 Floor 的局部 patch。

## 5. 验证重点

1. Floor 20 `[A,B]`，Floor 26 更新 A 后回读 `[A′,B]`；Floor 20 仍为
   `[A,B]`，回退到 Floor 23 仍返回 `[A,B]`。
2. 同一 Floor 重复分析可替换目标人物而不丢 sibling。
3. 当前 Floor 快照变化后，旧 judge 响应不能覆盖新状态。
4. 显式空/terminated 快照不能向前复活，且所有既有 Storyline 测试继续通过。

## 6. 并行请求与合格数据合并

同一 settled Floor 的不同 `subject_id` 可以并行等待设计/判定 API；每个
subject 的请求都有独立的取消、解析、版本和尝试校验。API 结果不直接互相
覆盖，也不把一个 subject 的异常提升为整个 settle 失败。

结果进入持久化前必须按 subject 逐项经过 storyline schema、当前 Floor/Swipe、
subject 归属和 judge attempt 校验；一个 subject 的支线结果必须完整满足该
subject 所需的全部分支/节点字段，不能用只返回部分字段的结果拼成半条快照。
只有通过校验的结果才进入 complete collection overlay；失败、超时、取消、
过期或解析不合格的结果只进入有界诊断，不进入 Floor。若本批只有部分结果
合格，仍保存合格结果并保留已有合法 siblings；若没有任何合格结果，则不写入
新的 storyline state。

API 请求可以并行，但同一 `projection_timeline` 的完整集合提交必须通过
现有 Floor Coordinator 的当前快照合并边界；不能让并行请求携带的旧完整
timeline 互相覆盖。必要时在写入端重新读取最新 timeline 后按 subject overlay，
再做一次完整集合 readback。

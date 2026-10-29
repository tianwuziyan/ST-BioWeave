# 实施计划：节点完成后的同支线推进事件

本任务已获用户确认并进入 `in_progress`。核心、AI、Runtime、Debug、UI 和文档改动
已经完成，正在进行最终独立审查与验收。

## 阶段 0：实施前门禁（已完成）

1. 重新读取本任务三份规划、Floor State Ownership、Data Lifecycle、Architecture
   和相关测试，确认“原始节点是独立入口、后续由同一支线动态生成推进事件”已经成为
   唯一实施语义。
2. 记录 `git status --short --branch`，确认本轮只保留当前任务目录，既有已发布
   Storyline 工作和用户修改不被覆盖。
3. 先补失败测试：节点完成后仍重复注入旧目标、没有生成 progression event、
   progression Judge 仍携带原始其它节点、`awaiting_outcome` 仍继续生成事件。
4. 保持生产边界不变：不新增 Chat/runtime 事实源，不修改 Event/State/World Model
   owner，不写入历史 Floor。

## 阶段 1：Core 状态模型与 Floor 快照（已完成）

1. 在 `core/projection-storyline.js` 增加 `progression_event` 的 normalize、validate、
   create、ID 和安全摘要；确认 schema version/旧快照兼容策略后再落地字段。
2. 保留 `selected_node_id/selected_node_status` 作为入口历史，不把
   `current_node_index` 改回顺序游标；原始候选节点 2/3 永远不是后续步骤。
3. 增加阶段派生：`candidate_selection`、`node_active`、`progression_generation`、
   `progression_active`、`awaiting_outcome`、`terminated`。
4. 更新纯状态转换：
   - 初始入口 `complete`：标记入口完成并进入 progression generation；
   - 生成成功：写入一个 active progression event；
   - progression `stay`：保留当前 event；
   - progression `complete`：标记当前 event 完成并再次进入 generation；
   - progression `awaiting_outcome`：停止生成，等待 Event Analysis；
   - 任一失败：保留原快照和 due 状态，可重试。
5. 更新 context/payload：入口节点完成后不再渲染旧 objective/completion signal；
   有 progression event 时只渲染当前引导、完成信号和结论目标。

## 阶段 2：AI 推进事件生成与判定（已完成）

1. 在 `ai/projection-storyline.js` 增加独立的“推进事件生成”消息构造和严格 JSON
   parser；沿用现有统一资料端口和 SYSTEM 1/SYSTEM 2/ASSISTANT/USER 排版。
2. 生成 API 输入：已选支线、已完成入口节点、近期正文、人物资料、World Model、
   事件参考、外部记忆；不发送 Floor/Event/cycle/pregnancy ID；人物 ID 仅通过当前
   canonical registry 派生的独立只读身份参考正文提供，并保留 `known_characters`、
   `display_name`、`character_id`、`aliases` 原始字段名，不改变返回协议。
3. 生成 API 输出一个当前有效的 progression event，至少包含标题、跨楼层引导、
   完成信号、结论目标；禁止生成新支线、重新选原始节点或连续动作脚本。
4. 修改 progression Judge：只判断当前 progression event，不再发送原始候选节点二/三；
   严格接受 `stay|complete|awaiting_outcome`。
5. 增加 prompt/parser regression：生成内容必须依赖当前世界观和上下文，不能套用固定
   场景机制；必须是阶段性条件引导而非连续动作；不得把线索写成怀孕结论。

## 阶段 3：Runtime 顺序、生成和写回（已完成）

1. 在 `runtime/projection-storyline-runtime.js` 保持事实闭环优先：合法怀孕/未孕事实
   先进入现有终止路径。
2. 入口节点 Judge `complete` 后，在同一当前 Floor 生成 progression event，并经
   owner/epoch/stale guard、完整 replacement 和 authoritative readback 写入。
3. 当前 progression event 每两条合格正文进行一次判定：
   - `stay`：继续当前 event；
   - `complete`：生成下一 event；
   - `awaiting_outcome`：停止推进 API，等待事实。
4. 生成/判定 API、parser、persist、readback 失败时不清空当前 event、不换支线、不误
   生成下一步；保留 due attempt，推进事件生成失败时等待后续 settled Floor 重试，Judge 继续沿用既有 retry budget。
5. 同 Floor 重复分析只替换当前 Floor 的完整 storyline snapshot；历史 Floor 不修改。

## 阶段 4：Runtime DTO、Debug 和 UI（已完成）

1. 在 `runtime/projection-runtime.js`、`runtime/diagnostics.js` 增加安全的
   `progression_phase`、当前推进事件状态/标题和来源入口摘要。
2. Trace 必须体现：入口节点完成 → 生成请求 → parser → snapshot 写回/读回 → 正文
   注入 → progression Judge → 下一 event 或等待事实。
3. 不输出完整正文、完整 Prompt、raw API response 或内部身份到产品 UI；UI 复用现有
   支线/节点卡片，把入口节点作为历史，把 progression event 作为当前内容。

## 阶段 5：回归测试（已完成）

1. `tests/projection-storyline.test.js`：progression event schema、入口完成转换、
   complete/stay/awaiting_outcome、context 不重复旧节点、原始节点不自动切换。
2. `tests/projection-storyline-progression-runtime.test.js`：入口完成后生成 event、
   active 状态不重复生成、并发 settle 单飞；既有 Storyline Runtime 测试覆盖
   waiting、失败重试、事实终止和当前 Floor readback。
3. `tests/projection-runtime.test.js` / `tests/diagnostics.test.js`：安全阶段字段、
   trace 顺序、current-Floor replacement、sibling 保留。
4. 现有 Floor complete-snapshot 测试覆盖当前 Floor 替换、兄弟保留、回退和事实终止；
   新增测试验证无合法事实时仍沿同支线推进。

## 阶段 6：文档、检查与交付（已完成）

1. 按实际 diff 同步 `.trellis/spec/domain/floor-state.md`、
   `docs/bioweave-data-lifecycle.md`、`docs/ARCHITECTURE.md` 中关于 Storyline
   snapshot、推进事件、cadence 和事实边界的描述。
2. 运行修改文件的 `node --check`、聚焦 Storyline/Runtime/Diagnostics 测试、
   `npm run check`、`git diff --check`，并执行
   `python3 ./.trellis/scripts/task.py validate .trellis/tasks/10-27-storyline-node-progression-update`。
3. 最终检查实际 diff、旧实现残留、未授权文件和 real-host 限制；不自动 commit/push，
   除非用户另行授权。

## 验收门槛

- [x] 原始支线 3 个节点仍是独立入口，不自动切换。
- [x] 入口节点完成后，当前 Floor 能保存一个新的同支线 progression event。
- [x] 后续正文只收到当前 progression event，不再重复旧入口节点目标/完成信号。
- [x] progression event 是跨楼层的条件引导，不是连续动作脚本。
- [x] progression `complete` 会生成下一阶段，`awaiting_outcome` 才停止并等待事实。
- [x] 合法怀孕/未孕事实出现前不清理 storyline；事实闭环仍由 Event Analysis 负责。
- [x] API/解析/持久化/readback/stale 失败均保持可重试且不误推进。
- [x] 当前 Floor 写回、历史 Floor、回退读取和 Debug 顺序均通过测试。
- [x] 受影响 Markdown 已同步，或明确证明无需更新。

## 回滚点

- Core progression event schema/phase reducer 可独立回退，但不得恢复旧节点重复注入。
- AI 生成 API 与判定 API 可分别回退到上一阶段，失败时保留当前已选支线和入口节点。
- Runtime 生成/写回可以关闭为“保留当前 event、等待重试”；不得使用
  `reset --hard`、`clean`、`restore` 或覆盖用户历史 Floor。

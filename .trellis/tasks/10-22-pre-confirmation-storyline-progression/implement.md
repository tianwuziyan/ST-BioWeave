# 实施计划：受孕前观察事件支线生成与持续推进

本文件仅定义开发顺序。用户确认最终规划后，才执行 `task.py start` 并修改生产代码。

## 阶段 0：开发门禁与基线

1. 使用 `trellis-before-dev` 重读 workflow、适用 spec、AGENTS 和当前任务三份规划。
2. 记录 `git status --short --branch`，保护用户现有未提交内容。
3. 先修复并测试 10-21 三个 P1：完整 triggered readback、terminated 不复活、active item 非空 `event_ids`。
4. 确认 P1 聚焦测试通过后才开始新 schema；失败则停止，不把新功能叠在不可靠触发态上。

验证：Projection core/persistence/runtime 既有测试与新增 P1 回归通过。

## 阶段 1：Storyline domain 与完整快照

1. 测试先行定义 branch、subject snapshot、delivery record、确定性 ID 和严格 validator。
2. 在 `projection_timeline` 增加可选 `storyline_snapshots`、complete marker 与 delivery records；保持旧 Floor 兼容。
3. 实现 endpoint 最近完整快照解析、显式空权威、多人物 sibling preservation 和当前 Floor complete replacement。
4. 扩展 projection storage/coordinator readback，比较整个期望集合与 digest。

验证：20/26/30/回退23、空快照、active Swipe、未来 Floor 隔离、多人物修改/删除、旧 schema 兼容。

## 阶段 2：设计与判定 AI 合同

1. 为设计 API 编写严格 prompt/parser 测试：请求由 Host 预绑定单人物，模型输入显示角色名、必要 aliases 与人物资料而非裸 ID；已触发信号证据按各自 Event ID 归属，人物 profile evidence 不进入人物资料；已知人物只保留有昵称的角色，并以有序的角色名/昵称嵌套列表呈现；无昵称时省略角色和空的已知人物块；固定 3 branch，每条 3–5 node 和 1 conclusion goal。
2. 为候选判定编写唯一 ID/null 输出合同；拒绝未知/重复 ID 和附加事实结果。
3. 为推进判定编写 `stay|advance|awaiting_outcome` 合同；拒绝换线、新 branch 和妊娠事实。
4. 实现受限输入 projection；设计/选线/推进响应不要求人物 ID，由 Host 按请求作用域归属；不持久化 prompt/raw response/probability。

验证：角色名/aliases 正确呈现且不存在 ID-only prompt；合法与边界响应、malformed JSON、超长文本、未知 branch ID、节点数量错误、事实越权全部 fail closed。

## 阶段 3：settle 后设计编排

1. 增加独立 `projection-storyline-runtime`，接收完全 settle 且已重新验证的 Character Floor。
2. 读取 triggered + 最近完整 storyline；只有 triggered 且人物状态 absent 时调用设计 API。
3. 实现 subject/source revision single-flight、API 前后 stale guard、完整 snapshot write/readback。
4. 重复 settle、重复 render、非首次 triggered 有数据时不再设计；缺数据时允许补设计。

验证：settle 前零调用、首次恰好一次、重复事件去重、API/parse/persist/readback/stale 失败不产生半状态。

## 阶段 4：Projection Context 注入与有效正文回执

1. 在现有 `bioweave_projection_context` 中加入候选或已选段落，不新增 slot。
2. 候选 prompt 强制主动创造条件且只起一线；已选 prompt 只含所选线当前目标。
3. 成功提交 context 时写确定性 delivery receipt；生成成功、合法 response Floor 和事实分析 settle 后补 response evidence。
4. 只有匹配回执的 response 才进入 cadence；重复 render/失败/取消/User/无上下文/stale 不计数。

验证：注入内容与状态一致，同一 response 只计一次，regenerate/Swipe/编辑/回退不串线。

## 阶段 5：两条正文后的选线与推进

1. 在 snapshot 中持久化 count、counted versions 和 deterministic due attempt。
2. 候选阶段第 2 条有效 response 后调用 selection judge；null 时保留 3 branch 并重置窗口。
3. 唯一 ID 时在当前 Floor 写 complete replacement，仅保留选中 branch，游标 0，计数归零。
4. 已选阶段每 2 条调用 progression judge；实现 stay/advance/awaiting_outcome 的有界转换。
5. API/parse/persist/readback 失败保留 due attempt 幂等重试，不重复计数。

验证：1/2 条边界、null 重试、唯一选线压缩、不可换线、末节点等待结论、失败恢复和多人物并发。

## 阶段 6：明确未孕事实入口

1. 扩展 Event prompt/parser，使 identity context 始终把角色名/aliases 与 Host 身份引用成对提供；明确未孕结论先形成可由 Host 解析到 canonical `subject_id` 的人物级 candidate，AI 不读取、选择或输出 `cycle_id`。
2. 在 Runtime 接受 candidate 后，按 `subject_id` 从当前有效 Tracking/Aggregation/Lifecycle read model 解析该人物的活动 cleanup cycle，并由 Host 补齐既有 canonical lifecycle schema 所需的 `cycle_id` 与 `pregnancy_id:null`。
3. 验证 Projection Context/支线/judge 不是事实证据；模糊阴性、暂未检出、其它疾病不得越权结束观察。
4. 保持 Event persistence owner 不变，只修改 analysis routing/input 和 canonical validation。

验证：人物归属正确、模型输出不含 cycle、Host cleanup binding 成功；无绑定/多绑定时不误清历史周期并可重试；明确怀孕仍走既有 confirmation。

## 阶段 7：事实终止与生命周期整合

1. `pregnancy_confirmation` 后在同一当前合法 Floor 写 storyline terminal/empty，停止注入。
2. `not_pregnant` 先完成既有 archive → Exposure complete snapshot deletion → readback → cycle release → readback，再终止 storyline/triggered/受孕前 Projection 活态。
3. 中间失败保留可重试状态，不提前清支线、不改历史 Floor。
4. 保留周期自然变化的显式 hook，但不注册自动清理触发器。

验证：两种事实路径、重复事实幂等、partial failure、历史 Aggregation/归档不变、C002 不继承旧活态。

## 阶段 8：文档、全量验证与宿主验收

1. 同步 `docs/ARCHITECTURE.md`、`docs/bioweave-data-lifecycle.md`、`.trellis/spec/domain/floor-state.md`；若实现影响其它现有 Markdown，同步修正。
2. 更新 lifecycle registry kind/field contract 与测试；确认 Character/All clear、Chat/Swipe/message lifecycle。
3. 运行聚焦测试、完整 `npm run check` 和 task validate。
4. 在真实 SillyTavern 测试 Chat 验证 settle 后设计、下一正文起线、两条判定、单线推进和事实终止。自动化通过不得替代 host 结论。

## 阶段 9：Storyline Debug（已实现）

1. 在 `runtime/projection-storyline-runtime.js` 统一发出 settle、输入/触发读取、设计、快照写入/readback、回执、正文引用读取、cadence、judge、closure 顺序事件。
2. 在 `runtime/diagnostics.js` 以 bounded session buffer 保存安全摘要，并由现有 business.debug 和 TXT 导出读取；不持久化原始正文、prompt 或 API response。
3. Settings Debug 以现有框架渲染当前快照、回执和最近 trace，并通过回归测试验证敏感内容不会进入导出。

## 预计修改范围

- 新增：`core/projection-storyline.js`、`ai/projection-storyline.js`、`runtime/projection-storyline-runtime.js` 及对应测试。
- 扩展：`core/projection-persistence.js`、`storage/projection.js`、`storage/schema.js`、`storage/lifecycle.js`、`runtime/projection-context.js`、窄范围 runtime 接线。
- 事实闭环：`ai/input-builder.js`、`ai/prompts.js`、Event analysis input routing 与测试。
- 文档：Floor ownership、data lifecycle、architecture。

实际文件以实现时的调用链审计为准；不触碰无关 UI，不大规模重构 `runtime/events.js`。

## 验证命令

```bash
node --test tests/projection.test.js tests/projection-persistence.test.js tests/projection-runtime.test.js tests/projection-context.test.js
node --test tests/projection-storyline.test.js tests/projection-storyline-runtime.test.js
node --test tests/event-input-builder.test.js tests/prompts.test.js tests/event-analysis-runtime.test.js
node --test tests/floor-persistence-coordinator.test.js tests/lifecycle-contract.test.js
npm run check
python3 ./.trellis/scripts/task.py validate .trellis/tasks/10-22-pre-confirmation-storyline-progression
```

测试文件名若与仓库实际现有命名不同，实施时按真实测试入口调整，不创建重复测试套件。

## 回滚点

- P1 修复独立提交边界可单独验证，不依赖 storyline。
- 新持久化字段为可选兼容扩展；停用 runtime 接线不会要求重写历史 Floor。
- AI 设计/判定器可在未接 runtime 前独立回退。
- 人物级未孕事实入口与 Runtime cleanup binding 分离；后者可独立关闭，无法安全定位当前周期时保持旧数据不动。
- 不执行 destructive Git 操作，不 commit/push，除非用户另行明确授权。

## 完成条件

- 所有 PRD acceptance criteria 有自动化或明确 host evidence。
- Floor 完整快照、stale guard、失败恢复与事实权威边界均有回归测试。
- 相关 Markdown 与最终实现一致。
- 未实现的周期自动清理、妊娠期新支线和真实宿主阻塞必须在交付报告中明确说明。

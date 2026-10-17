# Research: floor 66/70 sexual_activity Episode 连续性

- Query: 对照 2026-10-18 调试附件，解释 floor 66 与 floor 70 的 `sexual_activity` 为何没有合并；核对 Runtime 匹配、AI `existing_events`、continuation 字段、Episode key/时间规则；比较 `a438c6a` 前后与当前未提交改动。
- Scope: mixed
- Date: 2026-10-18

## Findings

### 1. 附件证明的是“已经持久化了两条”，不是 floor 72 本轮又生成了 sexual_activity

- `/Users/ll/Downloads/ST-BioWeave-Debug-20261018-010942.txt:675-790` 显示 floor 66 的 canonical Event：`evt_f41c07e4402b25d622240756_6`，类型 `sexual_activity`，Story Time `cn-1-3-20T11:00`，地点 `底舱`，subject `char_000001`，counterpart `char_000005`，机制 `intravaginal_exposure`。
- 同一文件 `:794-940` 显示 floor 70 的另一条 canonical Event：`evt_a75ea1a7f39ac44383cf11ab_7`，类型和主体/对应方/机制/地点相同，但 Story Time 为 `cn-1-3-20T13:10`，且 `event_id` 与 source Floor 都不同。
- 两条 Event 的 `source_evidence`、机制 pathway 和证据文本不同；这会使严格 semantic key 不同，但不应阻止 Episode continuity。
- 当前导出的 floor 72 请求只返回一个 `physical_symptom`（`/Users/ll/Downloads/【补充】输出结果1-1.txt:1`）。调试 trace 也显示该请求输入 7 个历史 Event、candidate 只有 1 个，最终仅新增 `evt_e30e275bef01f824fd525c72_8`：`ST-BioWeave-Debug-20261018-010942.txt:19177-19210`、`:19664-19680`、`:19840-19915`。所以不能把 floor 72 这次响应解释成“模型再次输出了 floor 70 sexual_activity”。
- floor 72 的 `existing_events` 选择确实把 floor 66/70 两条同时带入 bounded 输入：trace 的 `input_total_count=13`、`unique_event_id_count=7`、`selected_version_source_counts` 从 `:19207` 起可见；最终 pre-analysis IDs 同时包含两个事件：`ST-BioWeave-Debug-20261018-010942.txt:19870-19889`。

### 2. AI 输入契约已经允许省略 marker，但附件缺少决定性原始响应

- 当前 Prompt 明确要求：同一 sexual activity 的 subject、mechanism、地点及 canonical participant/counterpart 集合不变时，即使省略 `continuation_update`，Runtime 也可唯一匹配；时间前进、跨午夜、Floor 变化、证据/pathway 改写不是 Episode 边界：`ai/prompts.js:98-103`。
- AI 输入 builder 将 `existing_events` 直接从 bounded projection 传入，而不是建立 Chat-level Event cache：`ai/input-builder.js:949-973`；Runtime 组装输入时将 `existingEventsSelection.events` 放入 `existing_events`：`runtime/event-analysis.js:3880-3947`。
- 补充输入文件把“已有 canonical Event 参考”说明为：重复则返回空、同一持续 Episode 有重要增量才引用真实 ID、独立边界才输出无 continuation 的新 Event：`/Users/ll/Downloads/【补充】输入文件1.txt:321-322`。其中可见的历史 Event 仍是 floor 58/60 参考（例如 `:323-391`、`:461-529`），附件没有提供 floor 70 那一次 API 原始 JSON 响应。
- canonical persisted Event 不保留 `continuation_of_event_id` / `continuation_update`；这些字段在 Runtime materialization 前会从 facts 中剔除：`runtime/character-event-analysis.js:725-729`。因此仅凭 floor 70 的持久化对象无法判断模型当时是“省略 marker”还是显式返回了 `continuation_update:false`。

### 3. 旧 Runtime 的直接分裂规则：strict semantic identity + 显式 continuation + 精确 Story Time

- 严格 semantic key 仍然故意包含 normalized Story Time、precision、participant IDs、subject/counterpart、mechanism kind/label/pathway/rule refs、source evidence 和 state fact：`core/events.js:1114-1152`。floor 66 与 floor 70 因时间、precision、pathway、evidence 不同，不能命中 exact dedupe；这是正确的“完全相同事实去重”行为，不是 Episode 合并规则。
- 在 `a8e046e` 以前的 Runtime，`eventContinuityKey()` 被注释限定为同一当前 Floor，跨 Floor 复用要求显式且经过校验的 continuation；`validateContinuationReference()` 还要求 participant/counterpart 集合完全相等，并最终调用 `continuationStoryTimeCompatible()`。
- `continuationStoryTimeCompatible()` 对 normalized Story Time 要求字符串完全相同且 calendar 相同；因此 `11:00` 与 `13:10` 必然失败，跨午夜也必然失败。该旧行为可由 `git show a8e046e^:runtime/character-event-analysis.js` 的对应实现复核；当前文件保留非 sexual_activity/旧显式路径的 helper 形态于 `runtime/character-event-analysis.js:249-259`，而 sexual_activity 的新 Episode 分支已绕开它。
- `a8e046e` 的提交主题是“修复事件连续性协议并降低分析重复计算”，其 diff 把原先按 subject 的同楼层语义改成 narrative Episode/continuation 协议，并在 Prompt 中要求 continuation 引用；它是规则收紧/显性化的直接历史变更点。
- `c9feca3` 随后引入完整 Floor Event 状态继承；这使旧 Event 在新 Floor 继续存在，也让“旧 Event 继承 + 新 candidate 追加”的重复结果可见。`3239980` 引入 bounded discovery window、`existing_events` 与严格 `eventSemanticKey()`；两者分别解释了为什么历史 Event 会进入输入，以及为什么时间/证据变化不能被 exact dedupe 消掉。

### 4. `a438c6a` 不是回归点

- `git show --stat a438c6a26259912cad90e9f608f3ac6b34fcf744` 只修改：前端组件规范、该任务的 Trellis 文件、`tests/phase2a-app.test.js` 和 `ui/app.js`。
- `git diff-tree --name-status -r a438c6a...` 未包含 `core/events.js`、`runtime/character-event-analysis.js`、`runtime/event-analysis.js`、`ai/prompts.js` 或 Event tests。因此它不可能直接改变 Event identity、`existing_events` 选择或 continuation 校验。

### 5. 当前未提交改动已经实现了所需的 Runtime fallback，但只有在实际运行的是该工作区代码时才生效

- 当前新增 `eventEpisodeContinuityKey()` 只由 `type=sexual_activity`、唯一 gestational subject 和 mechanism kind 构成，不含时间、evidence、pathway、participants 或 counterpart：`runtime/character-event-analysis.js:147-155`。
- 当前新增 `eventStableContinuityKey()` 在 Episode key 上增加地点、完整 canonical participant `(character_id,event_role)` 集合和 counterpart 集合，用于 marker-free 的保守唯一匹配：`runtime/character-event-analysis.js:157-173`。
- `findContinuityIndex()` 对无 marker 的 candidate 使用 stable key；只有一条兼容历史 Event 才返回 index；集合扩展需 `continuation_update=true` 才使用宽 Episode key；显式 `false` 阻断 implicit path；多候选返回 undefined：`runtime/character-event-analysis.js:693-720`。
- 命中 marker-free stable match 后，Runtime 复用旧 `event_id`，并在 materialization 后记录 implicit index；随后通过 `mergeContinuedEvent()` 保留旧 source/起始时间并合并证据：`runtime/character-event-analysis.js:761-785`、`:894-927`、`:332-380`。
- floor 66/70 的附件字段满足当前 stable key：两者都是 `sexual_activity`、subject `char_000001`、mechanism `intravaginal_exposure`、location `底舱`，participants 是同一 subject/source，counterpart 是 `char_000005`（附件行号见本报告第 1 节）。因此在当前工作区实现中，若 floor 70 candidate 没有 `continuation_update:false` 且 `existing_events` 中唯一可见，缺少 `continuation_of_event_id` 本身不应再导致新 Event。
- 当前新增回归测试已验证这一点：marker-free、同日时间推进且 pathway/evidence 改写仍复用旧 ID：`tests/event-analysis-runtime.test.js:5089-5170`；跨午夜和 counterpart 扩展需 marker：`:5172-5244`；完全相同 stable identity 的多个历史重复会收敛到最早 Event 并记录 removed ids，合法显式引用属于重复组时保留被引用 Event，多个不完全相同候选仍保守处理。只读运行的 focused pattern 测试全部通过（同时 Node test runner 还执行了文件内其它测试；输出中相关 continuity tests 均为 `✔`）。

## Root cause / Minimal repair recommendation

### Root cause

已确认的历史根因是：旧设计把“完全重复事实”和“持续 Episode 更新”绑定在同一套严格条件上。`eventSemanticKey()` 将时间/evidence/pathway 纳入 exact identity；旧 cross-Floor Runtime 又要求显式 continuation 与 exact Story Time，因此 floor 66 的 11:00 Event 与 floor 70 的 13:10 Event 既无法 semantic-dedupe，也无法 continuation-match，最终保留两个 Event。真正的直接回归点在 `a8e046e` 引入/收紧的 continuity 协议及其前后配套的 `c9feca3`/`3239980` 状态继承与历史输入链，不是 `a438c6a`。

对本次实测附件，还只能确认“两个 Event 已经在历史 Floor 中存在”。不能从现有材料确认 floor 70 当时是否回传了 `continuation_update:false`，也不能确认宿主当时是否已加载当前未提交代码；因此不应把“模型没有回传 continuation”单独定性为事实。

### Minimal repair recommendation

1. 保留 `eventSemanticKey()` 作为 exact duplicate guard，不将 Story Time/evidence 从 semantic identity 中删除。
2. 确保生产宿主真正运行当前工作区的 marker-free fallback：对 `sexual_activity` 在 bounded `existing_events` 中找到唯一 stable candidate 时复用旧 ID；如果存在多个完全相同 stable identity 的历史重复，且 candidate 没有 `continuation_update:false`、稳定集合没有扩展，则收敛到最早 Event；candidate 明确 `continuation_update:false`、稳定集合扩展但无 `true`、或存在多个不完全相同候选时仍 fail closed。
3. 在真实宿主 trace 中补充/确认以下证据：floor 70 `EVENT_ANALYSIS_INPUT_EVENTS` 是否包含 floor 66；`EVENT_RAW_RESPONSE_SHAPE`/raw response 中是否存在 `continuation_update:false`；`EVENT_RECONCILIATION_RESULT` 是否记录 `updated_event_ids=[evt_f41...]` 或 `added_event_ids=[evt_a75...]`。当前附件只有 floor 72 的 reconciliation trace，缺少这三项，所以无法进一步把失败归因到 Prompt/model、输入 selection 还是 Runtime execution。
4. 如当前代码在真实宿主已刷新且 floor 70 仍重复，最小下一步应只增加诊断/测试覆盖实际 raw response 与 stable-key candidate count，不应放宽到按 subject/location 无条件合并，也不应修改 Floor persistence ownership。

## Related specs

- `.trellis/spec/domain/event-pipeline.md:1-70`：`core/events.js` 是 semantic dedupe owner；`runtime/character-event-analysis.js` 负责 explicit continuation、bounded Episode reconciliation、source/story-time preservation；同一 pregnancy-related sexual_activity 可在稳定唯一 candidate 下省略 marker。
- `.trellis/spec/domain/floor-state.md:1-80`：Event 必须由当前 Chat、active Swipe、有效六字段 Floor Version 拥有；不得通过 Chat-level cache 旁路。
- `docs/DATA-MODEL.md:340-390`：Event 是单一事实来源，`existing_events` 是 bounded discovery reference，canonical source 表示当前 persistence owner。
- `.trellis/tasks/10-17-event-episode-continuity/prd.md`、`design.md`、`implement.md`：本任务的连续 Episode、subject-local、marker-free unique match 与 fail-closed 要求。

## Caveats / Not Found

- 未找到 floor 70 当次 API 的原始 JSON 响应或同一请求的 raw-response trace；`【补充】输出结果1-1.txt` 是 floor 72 的 `physical_symptom` JSON，不是 floor 70 的 sexual_activity response。
- 未执行任何生产代码、测试或文档修改；只读取仓库、提交历史和附件，并运行了只读 Node focused test command 作为当前工作区行为证据。
- 当前工作区存在 11 个未提交生产/测试/文档/UI 文件改动；本研究未修改、未清理、未提交其中任何改动。研究文件是本次唯一新增写入。

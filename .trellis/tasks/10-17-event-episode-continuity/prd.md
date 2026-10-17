# 修复跨 Floor 持续事件重复记录

## Goal

将同一场景中持续数小时或跨午夜的 pregnancy-relevant sexual_activity 识别为同一 Event，避免因 Story Time 变化重复记录。

## Background and confirmed facts

- Floor 是一次分析与持久化快照，不应自动成为叙事 Event 的边界。
- 当前 `core/events.js::eventSemanticKey()` 把精确 Story Time、机制字段和 `source_evidence` 纳入严格 semantic identity；不同观察时间或证据措辞可能因此产生不同 key。
- 当前 `runtime/character-event-analysis.js::continuationStoryTimeCompatible()` 要求两条 Event 的 normalized Story Time 完全相同；同一天相差数小时也会失败，跨午夜也会失败。
- 当前 `eventContinuityKey()` 明确只用于同一当前 Floor 的 reconciliation；跨 Floor 主要依赖 `continuation_of_event_id`，且现有校验过于严格。
- 当前 `event.status` 表示事实确定性（如 `confirmed`、`probable`、`ambiguous`），没有 `ongoing` / `ended` 生命周期语义，不能直接拿来判断连续性。
- Floor ownership、active Swipe、六字段 Floor Version、事件原始 `source` 和 Floor 完整快照持久化边界保持不变；本任务不是 persistence root-cause 修复。

## 历史审计结论（以 `a438c6a26259912cad90e9f608f3ac6b34fcf744` 为支点）

- 支点提交 `a438c6a` 本身只涉及手动事件分析失败提示、UI 和对应测试，没有修改 Event identity、跨 Floor 分析或事件连续性代码，因此不是事件重复规则的直接改坏点。
- 最初的 Event 管线（`171eee4`）只分析当前 Floor/recent input，没有 `existing_events` 历史事件输入、semantic duplicate guard 或跨 Floor continuation 协议；它的“看起来不重复”主要来自没有反复把历史事件重新发现并追加到当前状态，并不代表已经存在完整的跨 Floor 连续性模型。
- `3239980` 引入了 bounded discovery window、`existing_events` 和严格 `eventSemanticKey()`。该 key 将精确 Story Time、precision、参与者、机制和 source evidence 纳入完全相等条件，所以时间推进或证据措辞变化会绕过 exact dedupe。
- `c9feca3` 将已有 Event 变成目标 Floor 的完整继承状态，使后续候选会与历史 Event 同时参与分析；这保证了历史事实不丢失，但也让连续性匹配失败时的“继承旧 Event + 追加新 Event”重复路径可见。
- `a8e046e` 将跨 Floor 复用收紧为显式 `continuation_of_event_id`，并要求 Story Time 精确兼容；同 Floor fallback 也只对当前 Floor 来源事件生效。由此，同一主体/参与者/机制/场景在两小时后或跨午夜观察到时，既可能无法命中 exact semantic key，也无法命中 continuity fallback，最终形成第二条 Event。

因此，本任务需要修正的是“完全重复”和“持续 Episode”被混为一套严格匹配规则的问题，不是简单放宽 Floor 边界，也不是回退到最初的无历史状态分析。

## Requirements

### R1. 持续事件的业务边界

- 同一人物/主体关系、同一事件机制和同一场景线程持续进行时，跨多个 Floor 只保留一个 canonical Event。
- 同一个 `gestational_subject` 在同一持续 Episode 中对应多个实际 exposure source 时，仍只保留一个 Event；所有对应方进入同一 Event 的 `counterpart_ids[]` 和 `participants[]`。
- 同一天相差不超过 6 小时、跨午夜或仅因为分析 Floor 改变，不得单独创建新 Event；无标记超过 6 小时、时间缺失或不可比较时，不得仅凭稳定身份隐式合并。
- 合法的明确 continuation 仍可在 6 小时窗口之外确认同一持续 Event。
- 明确结束后重新开始、明确转场形成独立事件、参与主体/事件机制实质变化时，必须允许创建新的 Event。
- 不得仅按“人物 + 地点”强制合并；地点是兼容性辅助条件，不能替代叙事连续性。
- 如果是多个不同 `gestational_subject`，即使属于同一场景、同一时间和同一连续 Episode，也必须按主体拆成不同的 subject-local Event。

### R2. 身份与连续性分离

- 保留严格 semantic identity 用于完全重复事实去重。
- 增加或重用独立的 episode continuity 判断：连续性不得要求 Story Time、证据文本、pathway 或 label 完全相同。
- Story Time 继续作为事实时间和顺序信息，并继续接受现有的“不得晚于目标 Floor”校验；它不再要求精确相等，但无标记连续性必须使用可比较的实际间隔并限制在 6 小时内。
- 不新增 `ongoing` / `ended` Event status；事实确定性与事件生命周期保持分离。

### R3. Runtime 合并与来源

- 合法持续合并必须保留原始 `event_id` 和原始 Event `source`，并通过现有 Floor 完整快照路径写回。
- 合并时保留原始 Event 的起始 Story Time，合并新增事实证据；本任务不新增 `last_observed_story_time` 或时间区间字段。
- `existing_events` 仍只来自当前 Chat、合法 Floor 和 bounded discovery window；不得建立 Chat-level Event cache 或无界历史扫描。
- continuation 关系优先使用现有 continuation 元数据：`continuation_update=true` 是同一持续 Episode 的强提示，`continuation_of_event_id` 是可选的精确身份提示；当 subject、机制、地点以及 canonical participant/counterpart 集合均稳定且匹配唯一时，即使 AI 省略这两个字段，Runtime 仍可在 Story Time 可比较且间隔不超过 6 小时（含跨午夜）时完成延续，不能因缺少精确 ID 或 marker 就重复创建。超过 6 小时、时间缺失或不可比较时，必须有明确 continuation 才能跨窗口合并。集合扩展时仍要求 `continuation_update=true` 才允许合并。
- 多个不完全相同的兼容候选仍不得猜测合并，应保留候选并留下可验证诊断；如果多个历史 Event 的 stable continuity identity 完全相同，且当前候选没有明确 `continuation_update=false`、稳定集合也没有扩展，则将这些历史重复收敛到最早 source Floor/Event，并合并证据；若存在合法 continuation 引用且目标属于该重复组，则保留被引用 Event 作为身份锚点。

### R4. 同响应重复候选

- 同一 AI 响应内 semantic key 完全相同、仅响应序号/Event ID 不同的候选只保留一个。
- 不得因为该修复合并不同 gestational subject、不同机制或明确独立 Episode。

### R5. 契约、测试和文档

- 更新 Event Prompt、Event pipeline spec、数据模型和架构说明，使“时间不是持续事件身份”成为唯一一致的最终规则。
- 替换当前“structure-only continuity 不合并”以及“跨 Floor 必须严格 continuation license”的过时测试/文档表述。
- 增加同日两小时、跨午夜、证据措辞变化、明确结束后重启、同响应重复候选和不同主体隔离的回归测试。

## Acceptance Criteria

- [ ] 同一主体/参与者/机制/场景在两个相隔约两小时的 Floor 中继续发生时，最终只保留一个 `event_id`，且保留原始 `source`。
- [ ] 同一事件跨午夜继续时，最终只保留一个 `event_id`；不得因 Story Time 日期变化新增 Event。
- [ ] 同一 `gestational_subject` 在同一持续 Episode 中出现多个 exposure source 时，只有一个 Event，且 `counterpart_ids[]` / `participants[]` 完整包含这些对应方。
- [ ] 同一场景中存在多个不同 `gestational_subject` 时，仍按主体保留多个 subject-local Event。
- [ ] 无标记同一稳定事件超过 6 小时、时间缺失或不可比较时新增 Event；明确 continuation 可以跨越 6 小时。
- [ ] 同一持续事件的 pathway、label 或 evidence 文本变化不会单独触发新 Event。
- [ ] 明确结束后重新开始的同人物同地点事件仍保留两个独立 Event。
- [ ] 不同 gestational subject 的 Event 仍然分开；不同机制或无法唯一匹配的候选不被强制合并。
- [ ] 同一 AI 响应内的完全 semantic duplicate 只保留一个候选。
- [ ] 所有 Event 事实仍写入当前有效 Floor/active Swipe 的完整快照，原始 Event provenance 不被旁路覆盖。
- [ ] 既有 scheduler、stale owner、Tracking、Projection、Event 编辑和 Floor persistence 回归保持通过。
- [ ] 相关 Markdown/spec 与最终实现一致；不新增 Chat-level derived Event state。

## Out of scope

- 不修改 Floor/Swipe ownership、Floor Version、Coordinator、Adapter 或 Generation boundary。
- 不新增 Event lifecycle status、时间区间字段、Chat-level Event history 或无界历史搜索。
- 不改变 gestational-subject 分组、Tracking eligibility、pregnancy lifecycle、Projection 或 NSFW lock 规则。
- 不在本任务中清理已经存在的历史重复数据；如需修复旧数据，另行设计可回滚的 repair workflow。

## Open decisions

- 当前没有阻塞产品决策：用户已确认“连续优先、明确断点才拆分”，并确认窗口内的时间变化本身不应切分 Event；无标记窗口为 6 小时，明确 continuation 可跨窗口。
- 技术风险保留在设计中：隐式连续性对唯一 stable candidate 直接复用；多个完全相同 stable identity 的历史重复只在没有明确独立边界、且当前候选没有集合扩展时收敛；不完全相同的多匹配继续 fail-closed，避免同人物同地点的独立事件被吞并。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.

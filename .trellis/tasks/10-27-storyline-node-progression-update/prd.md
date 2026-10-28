# 节点识别后的剧情事件状态推进

## Goal

完善支线节点识别后的 Floor 状态更新、正文注入和同一支线内的后续推进事件生成，
直到合法怀孕/未孕事实闭环。

## Confirmed Evidence

- 附件中的正文请求在 `RecentRequestLog_与剑灵们的双修日常_2026-10-27 17_44_12_全文.txt:3349` 仍然注入 `<bioweave-storyline>`；其中“当前节点”仍是“密室切脉与病症陈述”，并标记为“节点状态：已完成”，没有新的事件推进状态或新的当前目标。
- 附件 Debug 的 `storyline` 区域（`ST-BioWeave-Debug-20261027-175001.txt:24535` 起）显示柳如烟的快照仍是 `selected_node_id=node_1`、`selected_node_status=completed`、`current_node_index=0`、`valid_body_count=0`，快照来源停留在 108 楼，而当前读取 Floor 是 110 楼；这说明当前读取/写回链路没有把“节点完成后、事实确认前”的状态变化形成新的当前快照。
- 当前 `core/projection-storyline.js` 的 `applyStorylineJudge()` 对 `complete` 只会把当前节点标记为 `completed`，不会生成后续事件状态；`storylinePromptPayload()` 与 `buildStorylineContextPrompt()` 随后仍会读取并注入同一个节点。
- 当前 `ai/projection-storyline.js` 的已选支线判定协议只有 `stay`、`complete`、`awaiting_outcome`，没有表达“当前节点完成后生成下一阶段推进事件”的协议；Runtime 只持久化 Judge 返回的快照，不会从节点完成结果生成独立的后续引导。
- 既有 Floor 合同仍然有效：支线属于非事实剧情引导；所有修改只写当前合法 Character Floor/active Swipe；历史 Floor 不改；怀孕或未孕只能由 Event Analysis 的合法事实闭环终止支线。

## Requirements

### 1. 节点识别后的状态边界

- 节点识别成功后，必须在当前 Floor 形成可读、可持久化、可回退的“当前事件推进状态”，不能只保留一个已完成标记后继续重复注入旧节点。
- 该状态必须区分至少：已选支线、已完成的入口节点、当前推进事件、推进事件是否进行中/完成/等待事实结论，以及是否已经进入终止态。
- 事件推进状态属于 storyline 非事实状态，不得写入 BiologicalEvent、Current Biological State、pregnancy status 或 World Model。
- 未产生合法怀孕/未孕 Event 时，不得因为 API 返回 `complete`、正文出现检查或支线目标而提前结束整个观察过程。

### 2. 正文注入与更新

- 已选支线阶段的下一次正文只注入当前有效的推进事件；不能继续把已经完成的入口节点当作当前目标重复发送。
- 当前节点完成后，必须根据该节点、近期正文和上下文生成新的推进事件。推进事件不是第二条支线，也不是原节点的连续动作，而是跨越多个正文楼层的引导方向，用来创造合理条件并把剧情推向检查/确认入口。
- 推进事件的具体因果机制必须由 API 结合当前世界观、人物关系、组织规则、资源条件、信息流和正文上下文自行推导；插件只规定结构、跨度和事实边界，不预设医疗、社会、NPC 或任何固定场景。不能强行套用当前示例中的机制，也不能直接宣布怀孕。
- 注入内容必须明确当前阶段允许正文做什么（继续创造条件、自然形成检查/结论入口或等待事实），并保留“不把线索当作怀孕结论”的边界。
- 同一 Floor 重复分析时，当前人物的 storyline 事件状态可以被当前 Floor 的新结果替换；不得修改之前 Floor 的快照，也不得把旧状态与新状态拼成一条历史事实。
- 读取必须使用最近一次合法完整快照；回退到旧 Floor 时恢复旧状态。

### 3. 判定 API 与状态更新

- 需要定义并验证“入口节点完成 → 生成下一推进事件 → 推进事件完成/等待事实结论”的状态转换协议；API 只能在当前已选支线内生成一个当前有效的推进事件，不得换线、重新让正文逐楼选支线、输出人物内部 ID、cycle_id、pregnancy_id 或怀孕结论。
- `complete` 表示当前推进事件已完成，应触发下一阶段推进事件生成；`awaiting_outcome` 才表示进入事实/检查结果等待阶段；`stay` 表示继续当前推进事件。
- 新推进事件必须使用结构化字段表达“阶段目标、可接受的自然条件、完成信号和结论目标”，不能依赖字符串拼接或把连续动作硬编码成步骤列表。
- API、解析、Floor owner/stale guard、持久化或 readback 失败时，必须保留原有可重试状态，不丢失已选支线，不重复计数，也不误推进。

### 4. 事实闭环

- 只有正文事实经过 Event Analysis 并成功保存/读回后，才允许进入 `pregnancy_confirmation`、`pregnancy_lifecycle:not_pregnant` 或其它既有事实终止路径。
- 任何症状、行为、调查、制度流程、环境变化、第三方判断、怀疑或支线结论目标都只是线索或剧情状态，不能直接清理 storyline。
- 明确未孕的人物归属仍按角色身份解析；本任务不把 cycle_id 交给模型，Runtime 只在现有 cleanup 入口安全绑定时使用。

### 5. 诊断与回归

- Debug 必须能区分：节点识别结果、当前事件推进状态、正文注入状态、事实 Event 终止状态；不得只显示 `selected_node_status=completed` 而无法判断下一步读取了什么。
- 补充 domain、AI parser、runtime、Floor 完整快照和 context 注入测试；覆盖入口节点完成后生成推进事件、推进事件更新、不得重复旧节点、不得换线、等待结论、重复 settle、同 Floor 替换、回退读取、API/parse/readback 失败和事实终止。

## Acceptance Criteria

- [ ] 节点识别后，当前 Floor 会保存新的、可回退的事件推进状态；旧 Floor 数据保持不变。
- [ ] 节点已完成但未出现合法怀孕/未孕 Event 时，后续正文不再重复注入旧节点目标，而是收到同一支线下新的推进事件引导。
- [ ] 新推进事件具有明显的阶段跨度和条件导向，不是“继续做下一个连续动作”。
- [ ] 已选支线仍保持单线，不会切换到其它候选支线；非法 API 返回不会改变状态。
- [ ] 事实 Event 缺失、API 失败、解析失败、stale 或 readback 失败时，状态可安全重试且不会重复计数或提前终止。
- [ ] 20/26/30 楼完整快照和回退旧楼行为符合 Floor 合同。
- [ ] Debug 能呈现节点识别、事件状态更新、正文注入和事实闭环的先后顺序与结果。
- [ ] 相关 Markdown 与最终实现保持一致；未实现的周期自动清理和孕后新支线继续明确为范围外。

## Settled Product Decision

同一支线下原始的 3 个节点仍然是互相独立的初始切入点，不是连续步骤；识别出其中
一个节点后不得自动切换到另外两个节点。但“节点完成”也不代表整条支线结束：

- 原始已选节点保留为历史入口，不再作为下一次正文的当前目标；
- 插件根据已选支线、已完成入口节点、近期正文和当前上下文，生成同一支线下一个新的“推进事件”；
- 这个推进事件是一个跨楼层的引导方向；具体是通过人物关系、信息传播、制度流程、资源约束、环境变化、第三方介入还是其它机制推进，必须由 API 根据当前世界观自行选择，不要求连续描写下一个动作；
- 同一时刻只保留一个当前推进事件，不重新让正文逐楼选择支线，也不把原始节点 2/3 当作后续步骤；
- 当前推进事件完成后，再生成下一阶段推进事件；只有 `awaiting_outcome` 或 Event Analysis 合法事实才进入等待/终止路径；
- 直到 Event Analysis 产生合法怀孕/未孕事实，或后续明确的终止入口执行，才清理 storyline；
- 所有状态仍只写当前 Floor，历史 Floor 可回退恢复旧状态。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.

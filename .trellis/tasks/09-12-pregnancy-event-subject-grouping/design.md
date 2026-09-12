# 技术设计：按 gestational subject 形成 subject-local Event

## 1. 目标边界

本任务只调整 Event Analysis 的输出粒度与一致性验证。数据流保持：

```text
Prompt → AI DTO parser → Runtime ordinal/source enrichment
      → Domain Event/collection validator → Floor/Swipe
      → Tracking Registry → Product UI
```

不新增 UI 事件账本、不在 UI 重建 Event、不改变 Tracking eligibility，也不
触碰 StateReducer、Snapshot、Projection、Genealogy、StoryTime canonical index
或 Phase 2B。

## 2. Prompt 合同

在 `ai/prompts.js` 的 Core / Task / Output 三层同步替换旧的单 Event 约束：

- `events[]` 明确允许 `0 / 1 / N` 个 Event；独立非 pregnancy Event 仍按独立生物事实标准保留。
- pregnancy-related `sexual_activity` 先识别实际 gestational subjects，再按 subject 分组。
- 每个 subject 只生成一个 subject-local Event；该 subject 的多个 actual exposure sources 合并在同一 Event。
- 保护动作只作为证据，最终实际进入有效受孕路径的结果决定 exposure；普通参与者、在场者、无有效路径对象不得进入 participants。
- immediate physical effects / 直接身体反应继续并入同一 sexual exposure Event；普通补品、静态外貌和无直接医疗行为不独立成 Event。
- 明确禁止按性别、攻受、receiver、姓名或显示标签推断角色/能力。

## 3. AI DTO parser

`ai/analyzer.js` 继续作为严格 JSON 边界，但删除 `payload.events.length > 1`
拒绝分支。保留 `event_id` / `source` 兼容字段忽略行为和所有既有字段形状检查。

在 Event normalization 后增加 subject-local exposure 检查：

1. pregnancy-related `sexual_activity` 必须有且只有一个 normalized gestational subject；
2. counterpart 非空、引用 participants，且不包含 subject；
3. participants ID 集合严格等于 subject 与 counterpart 的并集；
4. ID 数组与 participants 输出保持去重；同一 participant 的重复记录按现有“最后记录生效”兼容语义归一化；
5. `possible_conception=true` 继续要求 `relevant=true`、实际 exposure evidence marker 和非空 source；无 exposure 的 sexual activity 保持空 participants/空 ID 数组；
6. 一个 response 内 pregnancy-related `sexual_activity` 的 subject ID 只能出现一次，重复时以 `duplicate_gestational_subject_event` 拒绝。

Parser 的诊断使用稳定 code/path，例如：

- `invalid_gestational_subject_cardinality`：`$.events[i].pregnancy_relevance.gestational_subject_ids`；
- `invalid_counterpart_cardinality`：`$.events[i].pregnancy_relevance.counterpart_ids`；
- `invalid_pregnancy_participants`：`$.events[i].participants`；
- `gestational_subject_counterpart_overlap`：subject 同时出现在 counterpart；
- `duplicate_gestational_subject_event`：同一 response 重复 subject。

## 4. Domain / Runtime 校验

`core/events.js` 的单 Event validator 扩展相同的 pregnancy exposure 结构约束，
同时保留非 pregnancy Event 类型兼容性。现有 `normalizeIdArray` 的去重语义继续
作为 canonical 输出边界；participants 归一化为唯一 ID 集合。

新增轻量 `validateEventCollection(events)`：

- 逐个执行现有 `validateEvent`；
- 只对 pregnancy-related `sexual_activity` 建立 subject→event 索引；
- 同一 subject 第二次出现返回带 `events[index]` 前缀的错误路径；
- 不对不同 subject 的 Events、互为 source/subject 的合法角色复用或普通非 pregnancy Events 做全局合并/排斥。

Runtime 在生成 ordinal-based `event_id`、绑定 authoritative `source` 后调用集合校验，再保存 Floor。这样 parser 负责 AI DTO，Domain 负责最终持久化对象，直接注入 Runtime 的无效多 Event 也不能绕过重复 subject 规则。失败路径仍由既有机制保留旧成功结果。

## 5. ID 与关系语义

本任务不添加 source→subject 新字段。Event-local 结构只能证明：当前 Event 的
subject、counterpart 和 participants 没有结构性交叉；“某 source 在叙事中实际暴露
给哪个 subject”仍必须由 AI 根据 World Model + narrative evidence 提取。测试以
抽象 ID 固定每个 Event 的 counterpart 集合不跨 Event 混入，同时允许同一人物在
两个不同 Event 中分别作为 subject/source（互相 exposure 场景）。

## 6. 兼容性与回滚

- 保留 Event schema version、其它 BiologicalEvent type、Runtime ordinal ID、Floor/Swipe source、失败 refresh、Tracking Registry 和 UI DTO 签名。
- 只撤销单 Floor 单 Event 的错误限制；不恢复完整 NSFW 日志，也不让无 actual exposure 的参与者进入 pregnancy Event。
- 回滚点为本任务变更文件；禁止使用 destructive Git 操作，不 commit、不 push。

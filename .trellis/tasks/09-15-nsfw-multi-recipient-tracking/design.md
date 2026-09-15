# 技术设计：NSFW 多人物妊娠追踪对象识别

## 1. 设计边界

本次以现有 `BiologicalEvent -> Core Tracking -> Chat Storage -> Runtime DTO -> UI`
链路为基础，只扩展缺失的 candidate 状态与 World Model capability resolution：

```text
Target Floor narrative
  -> Event Analyzer exhaustive recipient scan
  -> AI Event DTO (0/1/N, one subject per pregnancy Event)
  -> Domain Event validation/normalization
  -> Core exhaustive Exposure Candidate collection
  -> World Model + explicit profile/event evidence resolution
  -> eligible tracking_subjects / pending tracking_candidates
  -> Runtime persistence and UI read-only projection
```

Event 仍是 exposure 事实的唯一来源；Registry 只保存稳定引用和小型解析索引。UI 不
重新执行任何资格判断。

## 2. Prompt / AI contract

在 `ai/prompts.js` 的固定 Core、Task、Output contract 中增加同一条保护规则，避免只
修改一处导致不同 prompt 层含义漂移：

1. 生成 pregnancy-related `sexual_activity` 前，先扫描完整 Target Floor。
2. 把所有 actual pregnancy-relevant exposure recipients 放入临时集合，再对集合中
   每个 recipient 独立完成 exposure detection、identity resolution、capability
   resolution、eligibility decision。
3. 不因 Persona/current user/current Character Card、existing profile、首个 eligible
   recipient 或某个 false/unknown recipient 早停；`character_context` 只提供上下文，
   不是 participant whitelist，也不赋予扫描优先级。
4. 允许 Event Analyzer 综合稳定的 Character Card、Persona、Worldbook、Narrative、
   Existing profile、身体/生殖事实、族群特征和 World Model，把多条一致上下文证据映射
   到当前 species/type；明确 identity 是强证据。名字、称谓、主动/被动、性行为位置、
   社会身份、穿着、气质和单一外貌可以参与综合上下文，但单一弱线索不能单独决定
   biological_type/capability，冲突或不足时输出 null/pending。
5. 先用 World Model 的 species/type baseline，再由人物明确证据覆盖或补充；未知字段
   保持 null。
6. exposure 机制由 World Model、当前 species/type rules 和 narrative evidence 共同
   决定，不把某一种现实机制写成所有世界的硬编码。`possible_conception` 仅表达本次
   exposure 具备潜在受孕相关性，不表达 actual conception/pregnancy。

现有 subject-local Event 文本和输出 schema 保持不变：不同 recipient 拆 Event，同一
recipient 的多个 direct source 合并；participants 只允许 subject + direct source。

## 3. Core tracking resolution

### 3.1 单一决策入口

扩展 `core/tracking.js` 现有 `trackingDecisionPath()`，使其返回：

```js
{
  character_id,
  eligibility: 'eligible' | 'pending' | 'ineligible',
  reasons: []
}
```

事件级无关、无 exposure、invalid、非 subject 或排除状态直接为 `ineligible` 并保留
相应 reason code。对有效 pregnancy exposure recipient：

```text
resolved can_carry_pregnancy === true  -> eligible
resolved can_carry_pregnancy === false -> ineligible
resolved can_carry_pregnancy === null  -> pending
```

`eligibleGestationalSubjects()` 与正式 Registry 必须调用同一条 resolution，不保留
一套二态旁路。可提供 pending 的只读 selector 供测试/Runtime 使用，但不能让 null
进入 eligible selector。

### 3.2 两阶段 Registry rebuild

在现有 `rebuildTrackingRegistry()` 内保持最小模块化，按两个明确阶段执行：

**阶段一：Candidate collection**

- 对 `uniqueEventList()` 返回的全部有效 active Events 做完整遍历。
- 只把有效 pregnancy-relevant `sexual_activity` 的全部
  `gestational_subject_ids[]` 收集到 Map；不在收集循环中做 capability reject 或
  return。
- 按 `character_id` 合并多次 exposure，保存 `exposure_event_ids[]` 和最小的
  `exposure_records[]`：`event_id`、原始 `story_time`、authoritative `source`。
- 同一 Event 的 counterparts 不复制到 candidate 参与者集合；完整 Event 仍由 Floor
  存储保管。

**阶段二：Candidate resolution**

- Candidate 集合完成后，逐个解析 display/profile、species、biological_type、能力和
  evidence。
- `eligible` 只写入现有 `tracking_subjects`，沿用 `created_from_event_id`、
  `exposure_event_ids[]`、`status: 'active'` contract。
- `pending` 写入新的 Chat-local `tracking_candidates`，状态明确为 pending，并保存
  用户要求的 identity/capability/evidence/source fields。
- `ineligible` 不写入 active subjects 或 pending candidates；已有 active/pending
  记录在本次 rebuild 中被移除，但 Floor Event 不动。
- 过滤 dangling references 时只依据本次 active Event collection；历史 sanitized
  `character_profiles` 可继续保留而不产生 UI 入口。

### 3.3 World Model baseline 与个体证据

新增一个只做结构匹配的内部 resolver，优先复用 `core/events.js` 的 capability key
归一化，不创建新的 species/type registry：

1. 取当前 participant 的明确 `biological_context.species` 与 `biological_type`。
2. 缺失时回退到该人物已有 `character_profiles` 的明确 identity。
3. Event Analyzer 先基于全部上下文完成 identity resolution；Core 只接受能在当前
   World Model 的 `species[].name -> biological_types[].name` 中精确匹配的已解析结果，
   再读取该 type 的 capability baseline。无法唯一映射的 contextual inference 保持
   null/pending，不由 Core 自己发明类型。
4. 当前 Event participant/profile 中非 null 的个体字段覆盖 baseline；null 只表示
   当前没有该字段的个体覆盖，不把 unknown 转成 false/true。
5. `can_fertilize` 等 World Model 结构别名只在已有通用归一化边界转为对应 canonical
   key；最终 gestational qualification 永远由 World Model 实际提供的
   `can_carry_pregnancy`（或明确的当前模型等价字段）决定，不能由
   `can_be_fertilized` 单独推导。

匹配必须是开放字符串的精确结构关系，不能新增现实物种、性别、名称或 fixture-specific
alias；允许的 contextual inference 发生在 AI identity resolution，而不是 Core 的
硬编码词典。无法唯一匹配时保留 null/pending。

## 4. Storage / Runtime contract

### 4.1 Chat-local data

在 `storage/schema.js` 与 `storage/store.js` 增加与 `tracking_subjects` 对称的
`normalizeTrackingCandidates()` 和 `tracking_candidates: {}` 默认字段。兼容旧 Chat：
缺失字段按空 object 读取，不做破坏性迁移。

pending record 的最小形状：

```json
{
  "character_id": "subject_a",
  "display_name": null,
  "exposure_event_ids": ["evt_a"],
  "exposure_records": [
    {
      "event_id": "evt_a",
      "story_time": {},
      "source": {}
    }
  ],
  "eligibility": "pending",
  "species": null,
  "biological_type": null,
  "reproductive_capabilities": {},
  "evidence": []
}
```

`source` 只保留已经由 Domain/Runtime 验证的可追溯 Floor/Swipe version，不复制 raw
AI response。`character_profiles` 继续作为小型、已脱敏的可信人物证据索引；它可以为
pending 保留，但单独 profile 不能创建人物列表入口。

### 4.2 Rebuild / re-evaluation

`runtime/event-analysis.js:425-445` 的现有 `refreshTrackingRegistry()` 继续作为唯一
Registry rebuild 调度入口，并把当前 Chat 的 World Model 与 profile evidence 传给 Core。
现有 Floor 分析成功、Event 编辑/删除、Swipe/Chat 生命周期刷新都会自动重跑两阶段
resolver。

World Model 在 `ui/app.js` 的手动保存和 AI 保存完成后，调用现有 Runtime
`refreshTrackingRegistry()`；UI 只触发 Runtime，不读取或计算 capability。这样 Floor 10
的 pending exposure 在 Floor 20 更新 World Model 后能转为 eligible/ineligible。

当前没有独立 Profile 编辑 API；新的 Event/profile evidence 通过已有分析和 Registry
rebuild 进入同一 resolver。若未来新增可信 Profile 更新调用方，必须在保存后调用同一
`refreshTrackingRegistry()`，不复制资格逻辑。

### 4.3 Runtime DTO / UI

Runtime 的 `getTrackingRegistry()` 和必要的业务 DTO 增加 pending registry 的只读字段，
并可增加 pending count 供诊断。`tracking_decisions` 改用 `eligibility` 三态，reason
code 仍只给 Runtime/Core/Debug 使用。

`ui/app.js` 只读取 DTO；`ui/characters.js` 继续只枚举 `tracking_subjects`，因此
pending 默认不会进入普通人物列表。不得在 UI 中补一条 `can_carry_pregnancy` 判断，也
不得从 `tracking_candidates` 推导怀孕状态。

## 5. Tests

优先扩展 `tests/tracking.test.js`、`tests/event-analysis.test.js` 和
`tests/event-analysis-runtime.test.js` 的现有 fixture/contract，不新建重复的测试基础
设施。新增 fixture 只使用抽象 ID 与 `species_alpha -> type_a/type_b` World Model：

1. 两个 true recipient -> 两个独立 subject-local Events/Subjects。
2. true/false/true -> 首尾保留，中间删除，后者不漏扫。
3. true/null -> eligible + pending。
4. pending + 后续 World Model true -> eligible，Story Time 保持原 exposure。
5. pending + 后续 false -> removed/ineligible，Event 保留。
6. 明确 species/type 或多条一致稳定 evidence -> World Model baseline 可授权 true。
7. 只有单一姓名/称谓/外貌/主动被动/位置弱线索 -> identity/capability null，pending。
8. Persona source + 两个 recipient -> 两个 recipient 都分析。
9. Persona recipient + 另一 recipient -> 两者都分析。
10. fertilized true + carry false -> 不进入正式 tracking。
11. eligible registry record 不含 actual pregnancy state，不生成
    `pregnant`/`conception_confirmed`。

另加 prompt/source scan 断言：完整 Target Floor、临时 Candidate 集合、无早停、
`character_context` 非 whitelist、显式 identity mapping 允许项和禁止猜测项都存在；
现有 0/1/N、duplicate subject、participant closure、AI-owned identity/source contract
必须继续通过。

## 6. 风险与回滚边界

- 最大兼容风险是旧测试/消费者读取 `decision.eligible`；实现时统一更新仓库内调用方和
  DTO 文档，避免同时维护两套资格状态。
- World Model 名称匹配必须保持精确，避免把相似字符串当作身份映射。
- Registry rebuild 若遇到旧 Chat 缺字段，必须按空 candidates 兼容读取；不得删除历史
  Event 或无关 profile。
- 若实现中发现现有 schema/World Model 不能表达“模型定义的其它承孕 capability”，应
  保持 null/pending 并在测试中锁定，不添加现实规则兜底。
- 回滚时只撤销本任务的生产文件与任务文档，不使用 destructive Git 命令，不触碰其它
  worktree 变更。

# 技术设计：严格模式推演生理反应语义匹配

## 1. 设计目标

把“正文中明确发生了什么”与“推演卡片描述的是什么”分别归一为受控反应概念，再在人物、观察轮次和时间范围都合法时求交集。标题和内容只帮助理解卡片语义；它们不能证明正文事实。

## 2. 不变量

- BiologicalEvent 仍是唯一事实来源。
- 只消费当前有效 Floor/active Swipe 的 `active_events`，继续校验完整六字段 Floor Version。
- 只接受同人物、`confirmed`、`physical_symptom`、`health_role=observation` 且具有有效来源证据的 Event。
- Event 到卡片的语义匹配仍是确定性纯计算；首次有效命中后，由现有 Floor-owned `projection_timeline` 保存卡片触发记录，不新增 Chat ledger、Runtime cache 或 API 请求。
- 触发记录只引用现有 `projection_id` 和来源 Event/Floor，业务读取按 `subject_id` 隔离；不重复保存 `pregnancy_id` 或周期编号。卡片创建记录已有的技术归属只用于 owner 校验。
- Product DTO 区分当前阶段触发标记与本轮历史触发摘要；内部匹配细节只进入有界 Debug。
- `no_reaction_early`、`no_reaction_late` 永不因缺少 Event 自动命中。

## 3. 反应概念表

首版只覆盖当前受孕前观察分支：

| 概念 | 明确事实要求 | 严格排除 |
| --- | --- | --- |
| `fatigue` | 疲倦、嗜睡、明显乏力、提前想休息 | 单纯睡觉、注意力变化但无疲倦 |
| `breast_sensitivity` | 乳房/胸部触碰敏感、胀痛或明显不适 | 普通胸口疼、衣物摩擦但部位不明确 |
| `scent_food_change` | 对气味或食物出现明确偏好/轻微变化 | 已达到恶心、呕吐但没有偏好变化描述 |
| `nausea` | 恶心、反胃、作呕 | 仅胃痛、口苦、担心会恶心 |
| `odor_discomfort` | 明确由闻到某种气味触发不适、反胃或回避 | 只有恶心但没有气味触发 |
| `mood_change` | 明确情绪波动、易怒、易哭等已发生变化 | 他人评价、可能变化、普通对话情绪 |
| `appetite_change` | 食欲不振/增加、食量或食物偏好明确改变 | 单次没吃、因为无食物而没吃 |
| `nausea_worsening` | 明确写出比之前加重、持续恶化或越来越明显 | 单次“剧烈恶心” |
| `vomiting` | 明确呕吐、吐出或孕吐已经发生 | 干呕、作呕但未吐 |
| `persistent_fatigue` | 明确持续、多日或反复疲倦 | 单次疲倦、刚睡醒 |

概念表由 Core 单一模块拥有。词表只收录高置信度中文短语、必要的结构化 kind 别名和排除组合，不做分词相似度或概率评分。

## 4. 数据流

```text
当前有效 active_events
  -> Event 资格过滤
  -> 从 symptom.kind + symptom.description 提取 0..N 个明确反应概念
                                              \
                                               -> 同人物 + 同轮次 + 时间窗求交 -> matched
                                              /
当前 Projection View/DTO
  -> 内置 branch key；否则严格读取标题/内容
  -> 得到且仅得到 1 个卡片反应概念
```

首次匹配成功后的保存与读取：

```text
当前阶段卡片 + 合格 Event
  -> 保存该 projection_id 的 triggered observation record
  -> 健康自然恢复可继续清理 Event，不改触发记录
  -> 阶段替换时，将已有 triggered 历史与当前阶段新 triggered 合并为完整人物快照
  -> 新楼层直接保存完整 triggered 快照，不再跨多个旧楼层按人物 ID 拼接
  -> 当前候选与历史触发分别组装 UI / ST Context
```

### 4.1 Event 侧

新增纯函数，例如：

```js
extractObservedReactionConcepts(event)
  -> {concepts: string[], evidence_modes: string[], reason_code: string}
```

处理顺序：

1. 先复用 `healthAssessmentEligibility()`、`status === confirmed`、subject 与类型检查。
2. 精确 `symptom.kind` 映射拥有最高优先级。
3. 只读取已经结构化保存的 `symptom.description`，允许一条 Event 提取多个明确概念。
4. 排除短语优先于正向短语，例如“干呕但未吐”不得产生 `vomiting`。
5. 不读取 `source_evidence.text`、聊天正文、Health Assessment guidance 或 Projection 文案作为事实。

柳如烟示例应得到：

```text
nausea + odor_discomfort + appetite_change
```

不应得到：

```text
vomiting + nausea_worsening
```

### 4.2 Projection 侧

新增纯函数，例如：

```js
resolveProjectionReactionConcept(projectionView)
  -> {concept: string|null, source: string, reason_code: string}
```

处理顺序：

1. `pre_confirmation_observation:<branch>` 的稳定 branch key 优先，避免文案变化破坏内置候选。
2. 仅对 `tracking_scope=pre_confirmation` 且没有可用 branch key 的候选，读取 `rule.label`、`rule.description`、`generated_statement`。
3. 文本归类必须唯一；零个或多个概念都失败关闭，不显示“已触发”。
4. 标题/内容只是卡片语义输入，不写回 Projection，也不改变 Projection identity。

### 4.3 匹配与时间

- 内置分支继续使用自身 `min_elapsed_story_days` / `max_elapsed_story_days`。
- 文本归类出的 pre-confirmation 候选使用该 canonical 概念在同一概念表中定义的观察时间范围。
- Event Story Time 必须可与 Projection `reference_story_time` 比较，且处于对应范围内。
- 一个 Event 可以命中多张语义不同但各自明确对应的卡片；一张卡片可汇总多个 Event ID 到 Debug，但产品仍只显示一个布尔值。

## 5. Runtime、保存与接口

- 将当前 `matchBuiltInObservedReaction()` 收敛为受孕前观察 matcher，避免把词表和多概念逻辑继续堆在 `runtime/events.js`。
- `runtime/projection-runtime.js` 继续复用已有 Event business snapshot，不增加第二次完整读取。
- 当前卡片 DTO 保留 `observed_reaction.matched`，其值由已保存触发记录或本轮新匹配共同决定。
- 在 `projection_timeline` 内增加 append-only observation record 集合；记录以现有 `projection_id` 为 owner，包含 `triggered` / 当前阶段手动纠错所需的撤销动作、来源 Event 引用和完整 Floor Version。它不是 Event，也不改变 `factual_status` 或通用 Projection lifecycle。
- 增加人物级完整触发快照。阶段切换时只从向前最近的合法完整快照继承已触发项目，再合并当前阶段新命中，并在同一当前楼层事务中保存；未触发旧卡不进入快照。
- 当前 UI 与 Context 只消费当前楼层的完整触发快照，不再把 `subject_id` 当作跨多个历史楼层重新发现触发内容的关联键。`subject_id` 仅用于同一完整快照中的人物隔离。
- 某人物观察结束时，当前楼层写入该人物明确的终止/空快照；“字段缺失”不代表结束，因为缺失仍可能触发历史继承。多人场景只终止目标人物，其他人物快照原样保留。
- 健康自然恢复路径不写撤销记录。用户手动编辑/删除 Event 成功后，只同步当前阶段 observation records；旧阶段历史不重算。
- Context builder 将历史触发写为“此前出现过，不代表当前仍持续”，当前阶段 active 候选仍使用“当前可能出现”的现有语义。
- Debug 每张卡最多一条记录，新增安全字段：`projection_concept`、`event_concepts`、`match_mode`、`reason_code`、有界 `matched_event_ids`；不包含原始正文、完整 description 或 Prompt。

## 6. 兼容与生命周期

- 旧 Event 无需迁移：只要已有 `symptom.kind` 或明确 `symptom.description`，下一次读取即可得到结果。
- 旧 Projection 无需迁移：内置 branch key 继续生效；无稳定 key 且文本无法唯一归类的候选保持无 badge。
- 旧数据无需迁移：没有 observation record 时仍可对当前阶段执行一次现有严格匹配，并在合法写入时补充当前 Floor-owned 记录。
- 健康自然恢复后保留触发记录；用户手动编辑/删除只重算当前阶段。Floor 删除、版本变化、Swipe 切换/删除仍通过 owner 失效自然移除对应记录。
- 阶段替换只改变当前候选快照；同一次当前楼层写入还必须保存截至该阶段的完整已触发快照。旧卡不重新进入当前候选列表，只进入“本轮曾经触发”。
- 最近完整快照是唯一继承输入；阶段切换、当前阶段首次触发、手动当前阶段纠错与观察结束都通过现有 Floor coordinator 原子写入并权威读回。写入失败时保留上一合法快照，不产生半份 `[A, B]`。
- 历史楼层永远不回写。回退到旧楼时，以该 endpoint 向前最近的完整快照为准；终止/空快照阻止继续回退继承。
- 旧 append-only observation records 只作为兼容输入，在首次合法阶段切换或当前阶段写入时收敛为完整快照；完成迁移后，产品读取不得继续同时维护“跨楼层拼接”和“完整快照”两套权威路径。

## Health recovery current-Floor snapshot boundary（本轮追加）

- 健康恢复指导的完整多阶段 Assessment 仍保留原始 `source_floor_version` 和
  `source_observation_fingerprint`，不改写来源，也不把指导文字升级为事实 Event。
- 读取健康数据时，优先使用当前 Floor 或向前最近的完整 Assessment timeline；当故事时间进入新恢复阶段、或当前 Floor 的健康 Event 被手动编辑/删除时，才把完整 timeline 复制到当前 Floor，并记录当前 Floor 的阶段选择标记。
- 复制的是全部阶段指导，不是只复制当前阶段文本。之前 Floor 的 timeline 永远不回写；回退到旧 Floor 时只读取旧 Floor 的快照。
- 阶段切换不重新调用 Health Assessment AI。当前 Event 的来源版本、指纹和有效性仍必须重新校验；被删除或编辑后不再有效的 Assessment 不能进入当前快照。
- 健康快照属于现有 Character Floor owner 的派生记录；健康指导仍是非事实提示，不能写入 Event factual payload，也不能成为第二份 Chat 级事实源。
- 回退旧楼只看 endpoint 之前的合法记录；该人物的观察作用范围结束后，从当前读模型清理其触发历史，不再进入 UI/Context。历史 Floor 不被反向改写，因此回退仍可得到当时状态。
- 因 `projection_timeline` 增加持久化集合，必须同步 lifecycle registry、`docs/bioweave-data-lifecycle.md`、Floor State、Event/Projection 规范与完整生命周期测试。

## 7. 风险与控制

- 中文自由表达无法做到无限覆盖。首版宁可漏识别，也不猜测；新增同义词必须带正例、反例和冲突测试。
- `symptom.description` 是 AI 生成的结构化事实摘要，仍可能包含复合句；因此使用明确短语和排除组合，不做模糊相似度。
- 自定义候选可能同时描述多种反应；严格模式将其标为 `AMBIGUOUS_PROJECTION_CONCEPT`，而不是部分命中。
- 词表必须集中维护，Event 与 Projection 不能各自复制一套规则。
- 完整快照会重复保存少量已触发摘要，但每个人物最多只累积本轮已触发的有限反应，换取当前楼层可独立读取和确定性回退；不得复制未触发候选、原始正文或完整 Event。
- 终止状态必须是显式快照而不是字段缺失，否则历史 fallback 会让已经结束的反应重新出现。

## 8. 回滚

新增触发记录是 append-only、Floor-owned 数据。回滚时停止写入和读取 observation records；未知集合必须保持向后兼容，不得修改 Event 或健康数据。严格概念解析模块可以独立保留。

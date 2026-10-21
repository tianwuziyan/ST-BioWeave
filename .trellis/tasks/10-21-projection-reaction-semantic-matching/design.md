# 技术设计：严格模式推演生理反应语义匹配

## 1. 设计目标

把“正文中明确发生了什么”与“推演卡片描述的是什么”分别归一为受控反应概念，再在人物、观察轮次和时间范围都合法时求交集。标题和内容只帮助理解卡片语义；它们不能证明正文事实。

## 2. 不变量

- BiologicalEvent 仍是唯一事实来源。
- 只消费当前有效 Floor/active Swipe 的 `active_events`，继续校验完整六字段 Floor Version。
- 只接受同人物、`confirmed`、`physical_symptom`、`health_role=observation` 且具有有效来源证据的 Event。
- 匹配是读取时纯计算，不新增持久化字段、Runtime cache、Chat ledger、Projection evidence/lifecycle record 或 API 请求。
- Product DTO 继续只输出 `observed_reaction.matched`；内部匹配细节只进入有界 Debug。
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

## 5. Runtime 与接口

- 将当前 `matchBuiltInObservedReaction()` 收敛为受孕前观察 matcher，避免把词表和多概念逻辑继续堆在 `runtime/events.js`。
- `runtime/projection-runtime.js` 继续复用已有 Event business snapshot，不增加第二次完整读取。
- Product DTO 不扩张：`observed_reaction: {matched: boolean}`。
- Debug 每张卡最多一条记录，新增安全字段：`projection_concept`、`event_concepts`、`match_mode`、`reason_code`、有界 `matched_event_ids`；不包含原始正文、完整 description 或 Prompt。

## 6. 兼容与生命周期

- 旧 Event 无需迁移：只要已有 `symptom.kind` 或明确 `symptom.description`，下一次读取即可得到结果。
- 旧 Projection 无需迁移：内置 branch key 继续生效；无稳定 key 且文本无法唯一归类的候选保持无 badge。
- Event 编辑/删除、Floor 删除或版本变化、Swipe 切换/删除、阶段替换和回退旧楼后，由当前权威事实重新计算。
- 不修改 `docs/bioweave-data-lifecycle.md` 的字段表，因为不增加持久化字段；但必须同步 UI、Event Pipeline/Projection 读模型规范和 Debug 文档。

## 7. 风险与控制

- 中文自由表达无法做到无限覆盖。首版宁可漏识别，也不猜测；新增同义词必须带正例、反例和冲突测试。
- `symptom.description` 是 AI 生成的结构化事实摘要，仍可能包含复合句；因此使用明确短语和排除组合，不做模糊相似度。
- 自定义候选可能同时描述多种反应；严格模式将其标为 `AMBIGUOUS_PROJECTION_CONCEPT`，而不是部分命中。
- 词表必须集中维护，Event 与 Projection 不能各自复制一套规则。

## 8. 回滚

所有新逻辑是只读派生。回滚时删除新的概念解析模块和 Runtime 调用，恢复现有 `nausea` 精确 matcher；Floor 数据、Projection timeline 和 Event 不需要迁移或清理。

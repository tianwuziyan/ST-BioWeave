# 技术设计：Event participant 生物身份上下文

## 设计目标

在不重构 World Model / Profile 的前提下，让 pregnancy exposure Event 的每个 participant 都携带可检查的生物身份上下文，并让 capability 判断的证据顺序在 Prompt 与 DTO 校验之间一致。

## 现状与边界

- `ai/prompts.js` 已把 World Model、character card/persona/profile、Worldbook、当前剧情与既有 BioWeave 作为 Event Analysis 参考资料，但 participant 的 `biological_context` 仍是可选项。
- `ai/analyzer.js` 已负责 raw Event shape、normalization，以及 pregnancy exposure 的结构校验；应在同一 AI DTO 边界补充 participant context 校验。
- `core/events.js` 的 `normalizeParticipant()` 已将 `species` / `biological_type` 归一化并保存为 nullable text。
- `core/tracking.js` 的 `profileFromParticipant()` 已读取这两个字段；不改变 Tracking eligibility 或 profile 写入流程。
- UI 继续只消费 `tracking_subjects` / 已验证 Event，不参与身份补全或 Event 拆分。

## 合同定义

定义 pregnancy exposure Event 为：

```text
event.type === "sexual_activity"
&& event.pregnancy_relevance.relevant === true
&& event.pregnancy_relevance.possible_conception === true
```

此类 Event 的每个 participant 必须有：

```json
{
  "biological_context": {
    "species": "string or null",
    "biological_type": "string or null"
  }
}
```

校验要求是字段存在且值为字符串或 `null`；不要求本轮新增 canonical World Model membership 校验，也不新增 `gender`。

Capability 判断采用以下优先级：

```text
current World Model
  + existing character profile
  + Character / Worldbook / current narrative evidence
  -> biological_context
  -> reproductive_capabilities_used
```

身份资料不足时可以输出两个 `null`。如果没有直接人物证据，Prompt 要求未知 capability 为 `null`；不能由 event_role、位置、主动/被动、姓名或外貌补齐。Validator 只做可可靠机器判断的结构合同，不用自然语言 `evidence` 做启发式“证据真假”判定。

## 实施方案

### 1. Prompt

在 Event Analyzer core contract 与 participant 输出说明中，将 pregnancy-related `sexual_activity` participant 的 context 从“可带”改为“必填”。明确 species/type 的来源、nullable 语义、禁止 gender/性别推断，以及 identity context 与 capability 判断的关系。

保留已有 0/1/N Event、按 gestational subject 分组、actual conception-relevant exposure、即时 physical effect 不机械拆 Event、普通食物/补品/静态外貌不生成 Event 等规则。

### 2. AI DTO validation / normalization

在 `ai/analyzer.js` 的 Event normalization 流程中，待 Event type 与 pregnancy relevance 已确定后，对该 Event 的每个 raw participant 检查：

1. `biological_context` 对象存在且不是 `null`；
2. `species` 与 `biological_type` own field 均存在；
3. 两个值只能是字符串或 `null`；
4. 失败时抛出带 Event/participant/path 的诊断，不让结果进入 Domain。

非 pregnancy Event 继续沿用现有可选 context 兼容行为。对通过验证的 pregnancy participant，normalization 保留两个字段及现有 participant 数据；不在 analyzer 里猜测或补写身份。

### 3. Core / Tracking / UI

不改 `core/events.js` 的字段保存逻辑；新增/调整测试以证明 species/type 不丢失。

不改 `core/tracking.js` 的 `profileFromParticipant()`，也不改 eligible subject 计算。UI 不添加补字段或按人物重建 Event 的逻辑。

### 4. Regression tests

使用 `subject_a`、`source_a` 等抽象 ID，更新共享 pregnancy Event fixture 以显式带 `{ species: null, biological_type: null }`，并增加：

- 明确 species/type 与 capability evidence 的合法 fixture；
- 资料不足、无直接人物证据时身份为 `null`、capability 为 `null` 的 fixture；
- 只有 event_role、没有身份/能力证据时不能返回完整 capability 套装的 fixture；
- 缺 context、缺 species、缺 biological_type、非法值的拒绝测试；
- `core/events.js` normalization 保存两个字段的测试；
- 既有 multi-Event / subject-local exposure、Tracking profile 测试继续通过。

## 风险与取舍

- 这是 pregnancy exposure 的条件合同，不把所有 BiologicalEvent participant 变成强制 schema，避免非 pregnancy 历史数据不必要地失效。
- 不能从自然语言 `evidence` 稳健判断“是否为直接人物证据”，因此不增加可能误伤合法资料的 capability 启发式 validator；保护规则由 Prompt + 抽象回归 fixture 锁定。
- Core normalization 目前会把数值转成文本；AI DTO boundary 对新输出严格拒绝非 string/null，保持两层职责清晰。

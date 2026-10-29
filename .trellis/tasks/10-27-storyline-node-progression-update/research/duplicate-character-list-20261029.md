# Research: 柳如烟重复人物身份审计

- Query: 审计 2026-10-29 18:52 的 Event API 返回、身份解析、Floor 状态、Tracking Registry 与人物列表 UI，定位同一显示名出现两次的来源。
- Scope: internal
- Date: 2026-10-29

## Findings

### 1. API 返回本身没有创建两个正式人物 ID

附件 [RecentRequestLog_与剑灵们的双修日常_2026-10-29 18_52_26_RESPONSE.txt](/Users/ll/Downloads/RecentRequestLog_与剑灵们的双修日常_2026-10-29%2018_52_26_RESPONSE.txt) 中，3 个 Event 都使用：

- `柳如烟`：`identity_status: new`、`character_id: null`、`mention_id: mention_liuruyan`；
- `常和`：`identity_status: new`、`character_id: null`、`mention_id: mention_changhe`。

API 没有返回 `char_000002` 或 `char_000003`，所以重复正式 ID 不是 API 直接返回两个 ID，而是 Runtime 在当前 Registry 基础上把本次 `new` mention 物化后，与历史 Event 已存在的 `char_000003` 并存。

响应中的 `mention_liuruyan` 在 medical_event、pregnancy_confirmation、physical_symptom 三处复用，属于同一 response-local 人物；这部分是正确的，不能把 3 个 Event 误当成 3 个角色。

### 2. 最终 Floor 同时存在两套柳如烟身份

附件 [ST-BioWeave-Debug-20261029-185550.txt](/Users/ll/Downloads/ST-BioWeave-Debug-20261029-185550.txt) 的最终业务状态显示：

- `business_debug.character_registry`（当前 Floor 120）只有：
  - `char_000001` → `常和`
  - `char_000002` → `柳如烟`
- `business_debug.tracking_registry.tracking_subjects` 同时有：
  - `char_000001` → `祁鸢`
  - `char_000003` → `柳如烟`
- `business_debug.event_state.events` 中，历史暴露和症状/检查早期事实仍使用 `char_000003`；当前 Floor 120 的 medical_event、pregnancy_confirmation、physical_symptom 使用 `char_000002`。

关键证据可由以下命令复核：

```bash
jq '.business_debug.character_registry, .business_debug.tracking_registry.tracking_subjects' \
  '/Users/ll/Downloads/ST-BioWeave-Debug-20261029-185550.txt'

jq -r '.business_debug.event_state.events[] |
  [.event_id, (.subject_ids|join(",")), (.participant_ids|join(",")), .event_type, .source.floor] | @tsv' \
  '/Users/ll/Downloads/ST-BioWeave-Debug-20261029-185550.txt'
```

因此，这不是人物列表 renderer 自己把同一个对象循环两次，而是当前派生业务数据确实包含 `char_000002` 和 `char_000003` 两个不同 key，且二者 `display_name` 都是“柳如烟”。

### 3. 重复在 `mergeTrackingSubjectsWithActivePregnancies()` 后进入 UI

Runtime 的 `buildBusinessData()` 在 `runtime/event-analysis.js:3531-3534` 执行：

```text
mergeTrackingSubjectsWithActivePregnancies(
  registry.tracking_subjects,
  stateInfo.current_state,
)
```

`core/tracking-window.js:603-619` 的合并函数按 `characterId` 判断是否已有对象：

- `tracking_subjects` 已有 `char_000003`，显示名柳如烟；
- `current_state.characters` 因当前 Floor 的 `pregnancy_confirmation` 使用 `char_000002`，又有一个已确认妊娠角色；
- `result[char_000002]` 不存在，于是追加第二条人物。

这个函数本身按 canonical ID 合并是正确的；如果身份 ID 已经正确，它不会产生重复。当前重复是上游 ID 分裂的可见后果。

### 4. 人物列表 UI 没有再做第二次身份合并

`ui/app.js:3846-3878` 直接读取 `collected.tracking_subjects` 并存入页面状态。
`ui/characters.js:91-95` 的 `subjectEntries()` 只是按对象 key/`character_id` 建立条目；`ui/characters.js:642-665` 按每个 subject key 渲染一行，显示名来自 `subject.display_name`。

因此 UI 的行为是：

```text
char_000002 + 柳如烟 → 一行
char_000003 + 柳如烟 → 一行
```

在 UI 层按显示名去重会掩盖两个事实身份的冲突，且可能错误合并真正同名的不同角色，不应作为第一修复点。

### 5. 最可能的上游断点：当前 Registry 没有继承历史 canonical identity

`runtime/event-analysis.js:276-289` 的 `currentCharacterRegistryResolutionFromStates()` 只从合法 Floor 状态中取最近一份 `floorData.character_registry`；`runtime/event-analysis.js:2117-2137` 将它作为本次分析的 `characterRegistry`。

`runtime/event-analysis.js:4090-4107` 的 `buildFloorAnalysisInput()` 对非当前 Floor 也通过 `resolveCharacterRegistryAtOrBefore(target, {strictBefore: true})` 获取历史 Registry，然后作为 `analysisInput.character_registry`。

本次最终 Registry 只有 `char_000001=常和`、`char_000002=柳如烟`，而历史 Event 已明确存在 `char_000003=柳如烟`、`char_000006=常和`，这说明本次分析接收的 Registry 快照没有包含所有仍被活动 Event 引用的 canonical entities，或者该快照在更早一次 Floor 写入时已经被错误替换。Debug 导出没有给出 API 前的完整 `character_registry` 快照/指纹，因此无法仅凭附件确定是：

1. 历史 Registry 没有被带入本次分析；
2. 某次当前 Floor 写入用一个不完整 Registry 覆盖了完整快照；
3. 更早的 `new` 解析已经错误地把同名人物重新分配成新 ID。

但可以确认：`char_000002` 的当前 Floor 事实和 `char_000003` 的历史 Tracking 事实已经在同一完整事件状态中并存，导致后续列表重复。

## Minimal safe fix

1. **先修身份连续性，不在 UI 按名字去重。** 在 Event Analysis 身份物化前，必须保证输入 Registry 至少包含当前有效 Event/State 引用的所有 canonical IDs；如果 Registry 缺失但历史 Event 已存在唯一的 `display_name`/alias 候选，才允许在 Runtime 内部做“唯一候选补绑”。同名多候选必须失败关闭，不能按名字硬合并。
2. **对 `new` mention 做当前 Registry/历史 Event 的唯一身份复核。** `柳如烟` 已存在于历史 Event 的 `char_000003`，本次 response 仅返回 `new` 且没有 `explicit_new_entity` 证据时，不应直接分配 `char_000002`；应唯一补绑到 `char_000003`，或在无法唯一判断时返回 `identity_unresolved`，保留旧状态、不写入当前 Floor。
3. **写入前增加完整性守卫。** 生成的新 `character_registry` 必须覆盖 `nextEvents` 中所有 participant/state/pregnancy reference 的 canonical IDs；若出现 Event 引用 ID 不在 Registry，或同一 display name 被拆成多个 ID 且没有明确 distinct evidence，失败关闭并记录安全诊断。
4. **UI 只作为防御性显示。** 可以在 Debug/人物列表提示 duplicate display name，但不要静默把 `char_000002` 与 `char_000003` 合并，否则会破坏同名角色隔离和回退 Floor 语义。真正修复应在 `core/identity.js` / `runtime/character-event-analysis.js` 的 identity boundary。

## Regression tests

- `tests/character-identity.test.js`：历史 Event 已有 `char_000003=柳如烟`、Registry 缺失该 entry、本次 `new` mention 柳如烟；唯一候选时复用 `char_000003`，没有 `explicit_new_entity` 时不创建新 ID。
- 同文件：两个 canonical IDs 都叫柳如烟时，`new` mention 必须 `identity_unresolved`，不得 first-match-wins。
- `tests/event-analysis-runtime.test.js`：当前完整 Event 集合包含历史 `char_000003`，API 返回 `mention_liuruyan` 的 medical/pregnancy_confirmation/physical_symptom；分析后所有三件事都绑定 `char_000003`，Floor Registry、Tracking Registry 和 Current State 不产生 `char_000002`。
- `tests/tracking-window.test.js`：`mergeTrackingSubjectsWithActivePregnancies()` 在事实身份一致时只保留一条；如果输入两个不同 canonical IDs 但同名，应保留两个并让上游诊断发现冲突，不能由该函数静默合并。
- `tests/context-prompt.test.js`/人物列表 renderer 测试：UI 仅验证按 canonical ID 渲染，不把同名去重作为身份修复。

## Caveats / Not Found

- Debug 没有导出 API 请求前的完整 Registry 以及 identity resolution 的逐项映射，因此不能从附件确定第一次生成 `char_000002` 的精确写入点；建议后续 Debug 增加 `IDENTITY_RESOLUTION_RESULT` 的安全摘要（raw mention、display name、candidate IDs、resolution、最终 canonical ID），不导出正文。
- API response 本身使用 `character_id:null` 和同一 `mention_liuruyan`，没有直接制造两个正式 ID。
- 本次没有修改生产代码、测试或规格文件，也没有执行 Git 操作。

# Phase 2A 技术设计

## 1. 设计边界

本阶段新增的是事实提取和追踪索引，不是妊娠状态引擎：

```text
AI Analyzer
  → Event JSON Parser / Domain Normalize
  → Floor-bound BiologicalEvent[]
  → Tracking Registry（只存索引）
  → Characters / Events / Overview
```

`core/state.js`、`core/snapshot.js`、`core/projection.js`、`context/builder.js` 和 `core/genealogy.js` 不承担本阶段的新计算职责。已有 Skeleton 保持 Empty State 或基础兼容测试。

模块职责继续保持轻量：

| 模块 | 本阶段职责 |
| --- | --- |
| `core/events.js` | Event 常量、Schema DTO、normalize/validate/sort、编辑/删除所需的纯函数 |
| `core/tracking.js` | 从已验证 Event 建立/重建 Tracking Registry；不访问 DOM、AI 或宿主 |
| `story/time.js` | Story Time 结构化 normalize、SevenDaysCal provider wrapper、fallback provider、显示 formatter |
| `ai/input-builder.js` | 组装 Event Analyzer 所需的当前 Floor / 最近上下文 / 角色资料输入 |
| `ai/prompts.js` | Event Analyzer 核心契约、固定输出结构和消息构造 |
| `ai/analyzer.js` | Event 请求、固定 JSON 解析、Event normalize/validate；保留 World Model pipeline |
| `runtime/floor.js` | Floor Version 比较、当前有效 Floor Event 筛选、自动/手动分析判定辅助 |
| `storage/schema.js` / `storage/store.js` | Chat Registry 默认结构、Floor 数据读写和 Chat-local 保存边界 |
| `runtime/events.js` / `ui/app.js` | 宿主生命周期、分析调度、Floor 事件保存、Registry 同步、路由状态 |
| `ui/characters.js` / `ui/events.js` / `ui/overview.js` | 只渲染传入的 Tracking Registry / BiologicalEvent 业务结果 |

不建立 `event-store`、`event-factory`、`event-validator`、Repository 或全局 UI Store。

## 2. BiologicalEvent contract

### 2.1 响应外层

AI 成功响应固定为一个对象：

```json
{
  "schema_version": 1,
  "events": [
    {
      "event_id": "evt_floor_001_0",
      "type": "sexual_activity",
      "status": "confirmed",
      "story_time": {
        "display": "2026-08-20",
        "normalized": "2026-08-20",
        "day_index": 20685,
        "calendar_id": "calendar_main",
        "provider": "bioweave_fallback",
        "precision": "day",
        "confidence": 1
      },
      "location": "永和府邸",
      "participants": [
        {
          "character_id": "char_A",
          "display_name": "A",
          "event_role": "potential_gestational_subject",
          "biological_context": {
            "species": "人类",
            "biological_type": "女性"
          },
          "reproductive_capabilities_used": {
            "can_produce_sperm": false,
            "can_produce_ova": true,
            "can_be_fertilized": true,
            "can_carry_pregnancy": true,
            "can_cause_pregnancy": false
          },
          "evidence": [
            {"kind": "narrative", "text": "剧情明确描述 A 存在受孕暴露。"}
          ]
        },
        {
          "character_id": "char_B",
          "display_name": "B",
          "event_role": "potential_conception_source",
          "biological_context": {
            "species": "人类",
            "biological_type": null
          },
          "reproductive_capabilities_used": {
            "can_produce_sperm": true,
            "can_produce_ova": null,
            "can_be_fertilized": null,
            "can_carry_pregnancy": null,
            "can_cause_pregnancy": true
          },
          "evidence": [
            {"kind": "narrative", "text": "剧情和 World Model 支持 B 的本次受孕来源角色。"}
          ]
        }
      ],
      "pregnancy_relevance": {
        "relevant": true,
        "possible_conception": true,
        "gestational_subject_ids": ["char_A"],
        "counterpart_ids": ["char_B"],
        "confidence": 0.9
      },
      "source_evidence": [
        {"kind": "current_floor", "text": "当前楼层中与事件相关的最小证据摘要。"}
      ]
    }
  ]
}
```

### 2.2 Source canonicalization

AI 返回的 `source` 不是可信的 Floor 身份来源。分析调度器把当前目标的 authoritative Floor Version 注入 parser，并为每个 Event 强制写入：

```js
{
  chat_id,
  message_id,
  floor,
  swipe_id,
  content_hash,
  message_version,
}
```

这样模型不能把事件写到另一个 Chat、另一个 Floor 或另一个 Swipe。`event_id` 由 AI 提供时保留；缺失或非法 ID 的 Event 使本次结构化结果失败，不用随机 ID 掩盖模型错误。若实现需要保证同一响应内唯一性，parser 只允许基于 source + response ordinal 生成确定性临时 ID，并在测试和文档中明确这是技术标识，不是剧情事实。

### 2.3 Capability 与角色判定

`reproductive_capabilities_used` 使用 `true | false | null`。World Model 现有 `can_fertilize` 可以在 Event DTO 的 role-specific capability normalization 中映射为 `can_cause_pregnancy`，但不改变现有 World Model schema。

`core/tracking.js` 只接受以下明确条件创建 Subject：

1. `event.type === 'sexual_activity'`；
2. Event 状态不是 `negated` 或 `fictional`；
3. `pregnancy_relevance.relevant === true` 且 `possible_conception === true`；
4. candidate ID 同时存在于 participants、`gestational_subject_ids[]` 和 participant 的 `can_carry_pregnancy === true`；
5. Event 的 participant/evidence 结构通过 Domain validate。

不会读取 `gender`、`display_name`、`event_role` 的中文字面来补全 capability；`event_role` 只是 AI 提取的事件语义，不能单独授权 Subject。

`counterpart_ids[]` 始终由 Event 事实保存。Registry 不把它们复制为逗号字符串；UI 通过当前 Event 的 participant ID 查找显示名。

## 3. Story Time design

### 3.1 Stored DTO

```js
{
  display: String | null,
  normalized: String | null,
  day_index: Number | null,
  calendar_id: String | null,
  provider: String | null,
  precision: 'year' | 'month' | 'day' | 'hour' | 'minute' | 'unknown',
  confidence: Number | null,
}
```

`day_index` 是可排序/可计算的 canonical numeric value；没有可靠值时必须保持 `null`。`formatStoryTime(storyTime)` 只返回 `display` 或空状态文案，禁止从 `display` 反向解析。

### 3.2 Provider order

1. 调用注入的 SevenDaysCal provider / 当前公开 context 可见的结构化 Story Time。
2. 若 provider 未返回足够结构，使用 `bioweave_fallback`。
3. Fallback 只接受明确的 machine-readable date/marker 或调用方提供的结构化值；模糊自然语言只保存 display，不制造 `day_index`。

Adapter 只依赖公开 context 或传入 provider，不 import SevenDaysCal 私有模块、不读取 `sp-store`、不触碰 API/Secret。真实宿主中 provider 字段不匹配时，保留 fallback 和人工验收记录。

## 4. Tracking Registry

### 4.1 Chat-local storage

在 `chat_metadata.bioweave` 中增加向后兼容的 Chat-local 字段：

```json
{
  "tracking_subjects": {
    "char_A": {
      "character_id": "char_A",
      "display_name": "A",
      "created_from_event_id": "evt_001",
      "exposure_event_ids": ["evt_001", "evt_008"],
      "status": "active"
    }
  },
  "character_profiles": {
    "char_A": {
      "character_id": "char_A",
      "display_name": "A",
      "species": "人类",
      "biological_type": "女性",
      "reproductive_capabilities": {
        "can_produce_sperm": false,
        "can_produce_ova": true,
        "can_be_fertilized": true,
        "can_carry_pregnancy": true,
        "can_cause_pregnancy": false
      },
      "evidence": ["当前事件参与者证据摘要"]
    }
  }
}
```

`tracking_subjects` 是人物列表唯一来源；`character_profiles` 只为曾真正进入追踪的角色保留最小资料，不保存完整 Event 和不新增 `event_id` 数组。

### 4.2 Rebuild policy

每次 Event 分析成功、Event 编辑/删除、Floor 删除、Swipe 切换、Chat change 或手动刷新后：

1. 遍历当前 Chat 的 message 数组。
2. 以当前 message 的 active `swipe_id` 读取 Floor extra。
3. 只接受与当前 Floor Version 完全匹配的 Event。
4. 按 `event_id` 去重、排序并调用 `rebuildTrackingRegistry(activeEvents, previousChat)`。
5. 只保存 Subject 引用和必要 profile，覆盖旧 Registry；不追加不可验证的引用。

没有有效 exposure 的 Subject 从 active registry 移除；profile 不因一次 Floor 删除立即物理删除，以避免本阶段擅自定义永久人物历史策略。后续 State/History 任务可以增加明确的保留或清理规则。

## 5. Floor analysis and persistence

### 5.1 Input and request

`buildEventAnalysisInput` 组装：

```js
{
  chat_scope: {chat_id},
  floor_version: authoritativeFloorVersion,
  current_floor: {floor, message_id, swipe_id, narrative, role},
  recent_context: [{floor, role, content}],
  world_model: chatData.world_model,
  story_time: structuredStoryTime,
  character_context: selected character/worldbook evidence only
}
```

Event Prompt 使用一条固定 `system` 消息和一条结构化 `user` 消息；AI 返回只能是 `{schema_version, events[]}`。Prompt 中明确要求所有字段、数组语义、unknown 和无自动 conception/pregnancy 规则。

### 5.2 Automatic/manual scheduling

- 继续使用 `settings.analysis_interval` 作为 N-floor 自动分析间隔，默认值保持现有 3。
- 自动触发只由新的/编辑的/切换的/生成完成的 Floor lifecycle 事件驱动；UI mount/open/reopen 不触发 AI。
- 目标 Floor 先通过 `floorVersion()` 和 `shouldAnalyze()` 判断；同一成功版本跳过；版本变化或失败允许请求；`manual: true` 永远允许刷新。
- 成功请求用 `commitAnalysis` 保存当前 `analysis` 和当前版本 Event；同一版本的成功刷新替换旧 `events[]`。
- 失败保留 `analysis.last_success` 和旧成功 Event 数据，但 active-event scan 仍按 Event.source 与当前 Floor Version 过滤，旧版本不会混入当前有效 Registry。
- 手动/自动成功后更新 Chat-local `index.last_processed_floor`；失败不推进该索引，以便后续重试。

### 5.3 Event edit/delete

UI 只提交当前 active Event 的可编辑字段。保存逻辑：

1. 根据 Event source 定位当前 message + active swipe。
2. 保留 `event_id` 与 authoritative `source`，normalize 用户编辑字段。
3. 直接替换该 Floor 的 `events[]` 并通过现有 `saveFloor` 保存。
4. 重建并保存 Tracking Registry。

删除是真删除：从当前 Floor `events[]` 删除，重建 Registry；不产生 `user_override`、删除标记或第二份历史事实。

## 6. UI data flow

`ui/app.js` 负责读取当前 Chat 的业务 DTO、响应 runtime 事件和把数据传给页面模块：

```text
runtime.store.getChat(chatId)
runtime.store.getFloor(messageIndex, activeSwipeId)
  → activeEvents + trackingRegistry DTO
  → overviewPage / charactersPage / eventsPage
```

页面模块不能读取宿主 context、调用 Analyzer 或解析 gender。页面模块只格式化：

- `charactersPage`：Tracking Subject 列表、Subject detail、exposure Event 引用。
- `eventsPage`：真实 Event 列表、detail、编辑/删除 action。
- `overviewPage`：Subject count、Event count、最近 Event；Projection/Genealogy 固定 Empty State。

事件详情的 source fields 只读；`location`、`status`、participants/reproductive role、pregnancy relevance 和 evidence 等结构化事实可编辑，但保存统一回到 Domain normalize/validate。

## 7. Compatibility / migration

- 不升级或重写现有 World Model schema；当前 `can_fertilize` 只在 Event role DTO 做语义映射。
- 老 Chat 没有 `tracking_subjects` 时按空 Registry 读取；老 Floor 没有完整 Event 字段时不能进入 active Registry。
- 既有非 sexual BiologicalEvent 类型继续通过 `EVENT_TYPES` 和列表/UI；只有 `sexual_activity + pregnancy_relevance` 参与 Subject 推导。
- 既有普通 message 与 swipe 0/1/2 存储路径不变；不把 swipe 0 移回 `message.extra`。
- Secret sanitizer、Chat Scope 和 stale token 继续包住所有 Chat/Floor 保存；Event/Story Time 文本不能成为 secret 绕过路径。

## 8. Rollback / failure behavior

- Event parser、Story Time provider、Registry builder 全部为纯函数或可注入边界，可在单元测试失败时独立回滚。
- AI JSON 解析失败：保存失败分析状态，不写入半结构化 Event；旧成功数据按 Floor Version 规则保留。
- Registry 保存失败：保留 Floor Event，UI 显示上一次已保存 Registry，通知使用现有 Toast；下一次 lifecycle/打开时可重建。
- 宿主缺少 Story Time：明确显示未知/模糊时间，不伪造日期，不阻塞 Event 其它字段存储。
- 真实 SillyTavern 验收前不进行 Git push；完成后停在人工验收，不进入下一阶段状态引擎。

## 9. Event Analysis Runtime ownership follow-up

新增一个轻量 `runtime/event-analysis.js` coordinator，作为 Phase 2A Event Analysis 的唯一业务 owner：

```text
SillyTavern lifecycle / UI action
  -> Runtime Event Analysis Coordinator
  -> authoritative current/specified Floor Version
  -> Analyzer -> normalize/validate -> commitAnalysis
  -> Floor-bound events + analysis metadata
  -> rebuild Tracking Registry
  -> Runtime read-only status/selectors
  -> Overview / Events / Characters
```

Coordinator API 至少覆盖：

- `analyzeCurrentFloor({force})`
- `analyzeFloor(target, {force, reason})`
- `refreshCurrentFloorAnalysis()`
- `getCurrentFloorAnalysisStatus()`
- `getCurrentFloorEvents()`
- `getTrackingRegistry()`
- `collectActiveBusinessData()`
- `handleLifecycleEvent(event)`

Runtime 在扩展初始化时创建 coordinator，并由自身宿主 lifecycle listener 调用它。UI mount/open/reopen 只读取状态，不触发 AI。UI 仍可负责 Event 编辑表单和确认交互，但 Event normalize/validate、authoritative source、Floor 保存与 Registry rebuild 必须通过 Runtime API 完成。

当前 Floor 状态 DTO 使用 `not_analyzed | running | success | failed`，同时携带 Floor Version、attempt、last_success、last_error、当前有效 Event 数量、Chat-wide Tracking Subject 数量和 Core tracking diagnostics。Raw AI Response 不进入 Chat/Floor metadata。

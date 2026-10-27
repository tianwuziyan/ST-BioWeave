# 生产实现设计

## 边界

当前有效 Floor/Swipe 仍是事实来源。妊娠知情快照继续使用已存在的
`pregnancy_knowledge_snapshot` Floor 存储和 `resolvePregnancyKnowledgeProjectionAtFloor()`；本任务只把该投影接到业务读取 DTO，不改写入协议、不新增清理语义。

妊娠状态由现有 `current_state.characters[*].pregnancy` 提供。新增轻量 Core 派生函数，结合当前有效 Event 的 `story_time` 与当前 Story Time 计算已确认 episode 的孕周；它只返回只读 UI DTO，不能把计算结果反写 State/Floor。孕周锚点优先使用该 episode 的 `conception_event_ids` 中最早可比较时间，缺失时再使用该 episode 的确认事件时间；两者都不可比较则 `gestational_weeks` 为 `null`。

## 数据流

```text
current valid Floor
  ├─ Current State + active Events + current Story Time
  │    └─ core/pregnancy-status.js -> pregnancy_status[]
  └─ existing pregnancy_knowledge_snapshot
       └─ existing runtime resolver -> pregnancy_knowledge[]
             ↓
runtime/events.js collectActiveBusinessData()
             ↓
ui/app.js businessState
  ├─ ui/characters.js -> ui/character-state.js + shared knowledge renderer
  └─ ui/projection.js -> existing detail meta status button + same renderer
```

`pregnancy_status` 和 `pregnancy_knowledge` 都是当前读取的派生字段；Runtime
异常时返回空数组，不能把人物、Event 或健康 DTO 清空。UI 只使用名称与孕周，稳定 ID 只保留在事件委托所需的 `data-*` 上，不显示给用户。

## UI 交互

- `ui/pregnancy-status.js` 负责状态/名单的窄投影、中文状态文案、按钮和只读弹层，人物页与推演页共用，避免两套格式漂移。
- `ui/character-state.js` 在受孕事实格内放置名单按钮；弹层作为人物详情的现有 editor popover 渲染，不创建新 modal shell。
- `ui/projection.js` 把 confirmed 状态的第一个 meta badge 渲染为按钮，复用同一弹层内容；疑似/未知保留现有 badge。
- `ui/app.js` 只维护一个按 subject/character ID 记录的 popup 状态，沿用现有 delegated click、outside click、Escape、route/person change 关闭路径。
- 总览 renderer 不接入妊娠字段。

## 兼容与回退

- 没有 `pregnancy_status` 时保持现有“当前状态未知/暂无记录”语义；没有知情投影时 confirmed 弹层显示“暂无已记录知情人”，不从 Event 参与者或在场人物猜测知情人。
- 没有可比较 Story Time 时不生成周数；状态仍可显示“已确认怀孕”，妊娠状态格显示“孕周待时间”。
- 不修改现有 `pregnancy_knowledge` 存储、事件分析、Projection 选择或 Floor owner。

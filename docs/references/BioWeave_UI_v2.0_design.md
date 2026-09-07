# BioWeave UI 完整设计文档 v2.0
## 多人总览 → 人物详情 · PC / iPad / 手机响应式设计

> 配套视觉稿：`BioWeave_UI_v2.0_多人总览响应式设计稿.png`
>
> 本版替代此前“以当前角色为全局主视角”的 UI 方案。
>
> **核心模型：当前 Chat 是一级作用域；多人总览是入口；人物详情是二级页面。**

---

# 0. 设计结论

BioWeave 的 UI 导航模型固定为：

```text
当前 Chat
│
├── 总览（多人）
├── 人物列表（多人）
├── 历史事件（全 Chat）
├── 推演预测（全 Chat）
├── 家系图谱（全 Chat）
├── 世界模型（当前 Chat）
└── 设置（当前 Chat）
        │
        └── 点击人物
              ↓
           人物详情
           ├── 状态
           ├── 事件
           ├── 推演
           ├── 关系
           └── 备注
```

禁止把某一个 `currentCharacter` 作为整个插件的全局根节点。

---

# 1. UI 最高优先级规则

1. **总览必须是多人总览。**
2. **人物详情才是单人 UI。**
3. 不使用头像。
4. 所有动态数据属于当前 Chat。
5. “当前查看人物”只影响页面焦点，不改变 Chat Scope。
6. Event / Projection / Genealogy / World 默认都是 Chat-level 页面。
7. 从人物详情进入 Event / Projection 时，可以自动增加该人物过滤器。
8. 返回全局页面时，不强制保留人物过滤器。
9. PC / iPad / 手机功能等价，只允许改变布局和交互形式。
10. Event 支持编辑、删除。
11. Projection 只有删除，没有接受。
12. 世界模型允许查看、编辑、重新分析。
13. 分析成功后不主动重复分析；失败可重试；用户可手动刷新。
14. 刷新失败保留最后一次成功结果。
15. `null / unknown` 显示“未知”，不得显示为“否”。
16. 人物和家系关系使用稳定 `character_id`，不得以名字作为唯一身份。

---

# 2. 路由模型

推荐显式路由状态：

```js
{
  chatId: "chat_xxx",
  view: "overview",
  characterId: null,
  filters: {}
}
```

人物详情：

```js
{
  chatId: "chat_xxx",
  view: "character",
  characterId: "char_carol",
  tab: "state"
}
```

全 Chat 事件页：

```js
{
  chatId: "chat_xxx",
  view: "events",
  characterId: null,
  filters: {}
}
```

从 Carol 详情进入事件：

```js
{
  chatId: "chat_xxx",
  view: "events",
  characterId: "char_carol",
  filters: { characterId: "char_carol" }
}
```

**不要使用一个全局 `currentCharacter` 控制整个 BioWeave。**

---

# 3. 响应式断点

```css
@media (max-width: 767px) {}
@media (min-width: 768px) and (max-width: 1199px) {}
@media (min-width: 1200px) {}
```

```text
Desktop：完整侧栏 + 多列
Tablet ：顶部导航 + 1~2 列
Mobile ：单列 + 底部导航 + Sheet
```

---

# 4. PC 端导航

```text
BioWeave

总览
人物列表
历史事件
推演预测
家系图谱
世界模型
设置
```

底部轻量显示：

```text
当前聊天
New World
Floor 42 · 6 人物

● 已启用
v2.0.0
```

---

# 5. PC 多人总览

顶部：

```text
总览                                      [刷新分析] [···]

New World
Floor 42 · 已识别 6 人物 · 最近分析 3 小时前
```

## 5.1 Chat Summary

四个小型摘要：

```text
6 人物   12 事件   4 推演   3 代
```

不要做巨型统计卡。

## 5.2 人物总览

人物卡采用纯文本：

```text
┌──────────────────┐
│ Alice          ⋮ │
│ 健康             │
│ 可生育           │
│ 周期 12 / 28 天  │
│ 未怀孕           │
│ 更新 F42         │
└──────────────────┘
```

点击卡片主体：进入该人物详情。

`⋮`：

```text
查看详情
查看事件
查看推演
查看关系
```

人物卡只显示 3~5 个最重要状态，不能把完整 Profile 塞进总览。

## 5.3 人物卡字段优先级

```text
健康 / 身体状态
生殖能力
当前生理阶段
周期
妊娠状态
特殊状态
最近更新时间
```

不存在的世界机制不显示。例如世界不存在周期机制，则不显示“周期”，而不是显示“周期：无”。

---

# 6. 总览辅助区

## 最近事件

默认 5 条：

```text
F42  Alice, Bob   亲密接触（可能受孕）   高
F40  Carol        身体不适（恶心）       中
F39  Emma         服用避孕药             高
F38  David        医疗检查               低
F35  Alice        月经结束               中
```

`查看全部` → 全 Chat Event 页面。

## 当前推演

```text
Carol   可能出现早孕期反应    80%
Emma    可能进入排卵窗口      45%
Alice   可能出现周期延迟      35%
```

点击人物名 → 人物详情；点击内容 → Projection 详情。

## 家系概览

```text
2 个家系 · 3 代 · 6 人物
[查看完整图谱]
```

## 世界概览

```text
主要种族：人类、兽人
生殖规则：……
特殊机制：……
世界时间：2024-05-20
[查看详情]
```

## 分析状态

```text
✓ 分析状态
Floor 42 · 3 小时前
失败重试：—
任务状态：空闲
[查看详情]
```

---

# 7. 人物列表页

```text
人物

[搜索人物…………]
[全部状态 ▼] [生殖能力 ▼] [特殊状态 ▼]
```

PC 紧凑表格：

```text
人物     身体状态   生殖状态   当前阶段      最近更新
Alice    健康       可生育     周期 12/28    F42   >
Bob      健康       可生育     正常          F39   >
Carol    身体异常   可生育     疑似妊娠      F42   >
```

点击整行进入人物详情。

---

# 8. 人物详情页

```text
← 返回
人物 / Carol

Carol
[状态] [事件] [推演] [关系] [备注]
```

## 8.1 状态

```text
健康状态        身体异常
生殖状态        可生育
妊娠状态        疑似妊娠（80%）
周期状态        未知
上次分析        Floor 42 · 3 小时前
```

下面按 World Model 动态展示：

```text
基础身体
生殖能力
周期
妊娠
症状
药物 / 外部影响
特殊世界机制
```

## 8.2 人物事件

只显示 `participants` 包含当前 `character_id` 的全局 Event；不复制人物事件数据库。

## 8.3 人物推演

只显示与当前人物关联的 Active Projection。仍然只有 `[删除]`，没有 `[接受]`。

## 8.4 人物关系

```text
父母
X >
Y >

伴侣 / 相关关系
B >

子女（3）
C >
D >
E >

后代
孙辈 2 · 总后代 5

[在家系图中查看]
```

点击任何人物名进入对应人物详情。

---

# 9. 历史事件页（全 Chat）

```text
历史事件

人物     [全部人物 ▼]
类型     [全部类型 ▼]
状态     [全部 ▼]
楼层     [全部 ▼]
搜索     [………………]

[+ 手动添加事件]
```

Event Row：

```text
F42
Alice, Bob
亲密接触（可能受孕）
置信度：高
Story Time：3 小时前

[编辑] [删除]
```

---

# 10. Event 编辑器

```text
事件类型
发生楼层（只读）
Story Time
参与人物
人物角色 / reproductive_role
生殖相关
受孕可能
置信度
状态
描述
备注

[取消] [保存]
```

删除确认：

```text
确定删除？

删除后：
• 事件不再参与 State
• 后续 Projection 可能变化
• 不再注入 AI Context

[取消] [删除]
```

---

# 11. 推演预测页（全 Chat）

```text
人物 [全部人物 ▼]
类型 [全部 ▼]
置信度 [全部 ▼]
```

Projection：

```text
Carol
可能出现早孕期反应
80%

原因：
• 已发生可能受孕事件
• 当前生理状态
• Story Time 已经过 X 天

[删除]
```

必须显示：

```text
推演并非已发生事实。
```

**没有接受按钮。**

---

# 12. 家系图谱页（全 Chat）

```text
家系图谱

[图谱] [列表] [世代]
[全部家系 ▼]
[搜索人物]
```

图谱无头像：

```text
             Alice ───── Bob
                  │
        ┌─────────┼─────────┐
        Carol    David      Emma
                  │
                Frank
```

点击节点：进入人物详情，或先打开轻量 Preview：

```text
David
身体状态：健康
生殖能力：不可生育
子女：Frank

[查看人物详情]
```

---

# 13. 家系排序

稳定顺序：

```text
generation
→ birth_story_time
→ birth_floor
→ relationship_created_floor
→ stable character_id
```

支持：

```text
父母
子女
兄弟姐妹
祖先
后代
```

核心存储保留基础关系；兄弟姐妹、祖先、后代由 Graph 计算。

---

# 14. 世界模型页

Chat-level 页面：

```text
世界信息
日历系统
种族 / 生物类型
生殖机制
妊娠模型
周期模型
特殊机制
信息来源

[编辑] [重新分析世界]
```

重新分析提示：

```text
重新分析只更新当前 Chat 的 World Model，
不会修改 Character Card。
```

---

# 15. 设置页

## 基础

```text
启用 BioWeave                         [开关]
自动分析间隔              [ 3 ] 个楼层
Snapshot 间隔             [ 3 ] 个楼层
启用推演                             [开关]
```

## 分析

```text
自动世界分析                         [开关]
初始历史扫描                         [开关]
推演详细程度              [简洁/正常/详细]
失败自动重试                         [开关]
```

## 时间

```text
Story Time 来源           [当前剧情正文]
```

## Context

```text
注入 BioWeave Context                [开关]
最近事件                             [开关]
Active Projection                    [开关]
最大长度                  [数字]
```

## 数据

```text
当前作用域
New World / 当前 Chat

Schema Version
vX

[查看当前聊天数据]
[导出当前聊天数据]
[清理当前聊天数据]
```

## 高级

```text
显示分析状态                         [开关]
显示 Floor Version                   [开关]
Debug Log                            [开关]
```

---

# 16. 分析状态 / 刷新分析

总览顶栏提供 `[刷新分析]`，针对当前 Floor Version。

```text
Floor           42
status          success
generation      2
attempt_count   3
last_success    3 小时前
last_error      —
```

开发模式可显示：

```text
chat_id
message_id
swipe_id
content_hash
message_version
```

刷新失败：

```text
刷新失败。
当前继续使用上一次成功分析结果。
[重试]
```

不能清空旧成功结果。

---

# 17. iPad 端

顶部导航：

```text
☰ BioWeave
总览 / 人物 / 事件 / 推演 / 家系 / 世界 / 设置
```

多人总览人物区域改为紧凑 List：

```text
Alice   健康 · 可生育       周期12/28 · 未怀孕   F42 >
Bob     健康 · 可生育       状态正常             F39 >
Carol   身体异常 · 可生育   疑似妊娠80%          F42 >
```

而不是强行保留 PC 六宫格。

宽屏 iPad 可将“最近事件 / 当前推演”做两列。触控目标 ≥ 44px。

---

# 18. 手机端

顶部：

```text
☰ BioWeave                     ⋮
```

Chat Header：

```text
New World             [刷新分析]
Floor 42 · 6 人物
最近分析 · 3 小时前
```

摘要：

```text
6 人物 | 12 事件 | 4 推演 | 3 代
```

人物：

```text
人物                         查看全部

Alice
健康 · 可生育
12/28 · 未怀孕             >

Bob
健康 · 可生育
状态正常                   >

Carol
身体异常 · 可生育
疑似妊娠 80%              >
```

下面：

```text
最近事件（3 条新事件）       >
当前推演（2 人存在预测）     >
家系图谱（6 人 · 3 代）      >
世界模型                    >
```

底部导航：

```text
总览 | 人物 | 事件 | 推演 | 更多
```

`更多`：

```text
家系图谱
世界模型
设置
分析状态
```

---

# 19. 手机人物详情

```text
← 人物

Carol

状态 | 事件 | 推演 | 关系

基础状态
────────────
身体状态      身体异常
生殖状态      可生育
妊娠状态      疑似妊娠 80%
周期状态      未知
上次分析      F42

生殖状态        >
当前症状        >
药物 / 影响     >
关系             >
```

编辑器使用 Fullscreen Sheet / Bottom Sheet。

---

# 20. UI 数据契约

## Overview

```text
ChatSummary
CharacterSummary[]
RecentEvents[]
ActiveProjections[]
GenealogySummary
WorldSummary
AnalysisMeta
```

## Character Detail

```text
CharacterProfile
CurrentState
CharacterEvents
CharacterProjections
CharacterRelationships
```

## Events

```text
BiologicalEvent[]
```

## Genealogy

```text
CharacterNode[]
RelationshipEdge[]
```

## World / Settings

```text
WorldModel
ChatLocalSettings
```

---

# 21. CharacterSummary DTO

总览不要直接消费完整 Profile：

```ts
interface CharacterSummary {
  character_id: string;
  display_name: string;
  body_status: string | null;
  reproductive_status: string | null;
  stage_summary: string | null;
  pregnancy_summary: string | null;
  active_event_count: number;
  active_projection_count: number;
  last_updated_floor: number | null;
}
```

```text
Core 完整数据
     ↓
Selector
     ↓
CharacterSummary
     ↓
多人总览
```

人物卡不得自行重新推导业务状态。

---

# 22. 推荐 UI 文件结构

```text
src/ui/
├── router/
│   ├── routes.js
│   └── navigation-state.js
├── layouts/
│   ├── desktop-layout.js
│   ├── tablet-layout.js
│   └── mobile-layout.js
├── views/
│   ├── overview/
│   │   ├── overview-view.js
│   │   ├── character-grid.js
│   │   ├── chat-summary.js
│   │   ├── recent-events.js
│   │   └── projection-summary.js
│   ├── characters/
│   │   ├── character-list-view.js
│   │   ├── character-detail-view.js
│   │   ├── character-state-tab.js
│   │   ├── character-events-tab.js
│   │   ├── character-projection-tab.js
│   │   └── character-relations-tab.js
│   ├── events/
│   ├── projections/
│   ├── genealogy/
│   ├── world/
│   └── settings/
├── components/
│   ├── character-summary-card.js
│   ├── character-summary-row.js
│   ├── status-badge.js
│   ├── event-row.js
│   ├── projection-row.js
│   ├── analysis-status.js
│   ├── dialog.js
│   └── bottom-sheet.js
└── styles/
    ├── tokens.css
    ├── layout.css
    ├── overview.css
    ├── character.css
    ├── genealogy.css
    └── responsive.css
```

---

# 23. 视觉规范

```text
无头像
小圆角
细边框
低饱和状态色
13–14px 正文
14–18px 标题
紧凑间距
无巨型 Dashboard Card
无发光
无复杂渐变
```

优先继承 SillyTavern Theme Variables。

---

# 24. 空状态

```text
没有人物：
尚未识别到可追踪人物。
BioWeave 会根据当前角色卡、世界书和剧情逐步建立人物资料。

人物资料不足：
该人物目前没有足够的生理信息。
未知字段不会自动推测。

没有事件：
当前 Chat 尚无生理历史事件。

没有 Projection：
当前没有需要展示的生理推演。

没有家系：
尚未建立已确认的亲子关系。
```

---

# 25. UI 验收标准

```text
[ ] 总览默认展示多人，而不是单一 currentCharacter
[ ] 总览人物卡可以进入人物详情
[ ] 人物详情返回后恢复多人总览
[ ] 人物列表支持搜索和过滤
[ ] 同名人物依赖 ID 区分
[ ] 人物详情事件来自全局 Event 过滤，不重复存储
[ ] 人物详情 Projection 来自全局 Projection 过滤
[ ] 家系节点可进入人物详情
[ ] 多代 A → B → C 导航正确
[ ] 全 Chat Event 页面默认显示所有人物
[ ] 全 Chat Projection 页面默认显示所有人物
[ ] World / Settings 明确属于当前 Chat
[ ] PC 多人卡片布局正常
[ ] iPad 自动切换紧凑列表
[ ] 手机总览单列且无横向溢出
[ ] 手机人物详情完整可用
[ ] Event 编辑 / 删除完整
[ ] Projection 只有删除
[ ] 刷新分析完整
[ ] 刷新失败保留旧成功结果
[ ] Chat A → Chat B 后 UI 无残留
[ ] 不出现人物头像
[ ] unknown/null 显示“未知”
```

---

# 26. 最终导航闭环

```text
                   ┌──────────── 世界模型
                   │
                   ├──────────── 设置
                   │
当前 Chat ──→ 多人总览 ──→ 人物列表
    │              │             │
    │              │             ▼
    │              │         人物详情
    │              │        ┌────┼────┐
    │              │        状态 事件 推演 关系
    │              │                    │
    │              ├────→ 全局事件      │
    │              ├────→ 全局推演      │
    │              └────→ 家系图谱 ─────┘
    │
    └── 所有页面始终处于同一个 Chat Scope
```

**最终产品模型：先看“这个故事里有哪些人以及整体发生了什么”，再进入某个人查看他的生理轨迹。**

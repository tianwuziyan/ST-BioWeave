# 技术设计：正文生理反应与推演卡片关联

## 1. 设计目标

在不改变 Projection 生命周期、不新增持久化事实源的前提下，把当前有效正文中的结构化生理反应投影到同一人物、同一观察轮次、同一时间段的内置推演卡片，并在产品 UI 显示“已触发”。

## 2. 核心边界

### 2.1 事实来源

- 唯一事实来源是 `collectActiveBusinessData()` 已解析出的当前有效 `active_events`。
- 不使用 `current_health_state` 作为事实来源，因为它受 Health Assessment 与恢复阶段约束，可能遗漏仍然有效的原始 Event。
- 不读取 Chat-level cache，不新增 Timeline、Registry 或 Floor 字段。
- Event 与 Projection Views 必须绑定同一个当前 Chat、active Swipe 和六字段 Floor Version；目标发生变化时失败关闭，不混合两次读取结果。

### 2.2 匹配语义

第一版只支持确定性的内置分支匹配：

```text
confirmed physical_symptom
+ health_role = observation
+ 同一 subject_id
+ symptom.kind = nausea
+ concern_key = pre_confirmation_observation:nausea
+ Event 相对本轮 reference_story_time 的天数位于该卡片 min/max 区间
=> observed_reaction.matched = true
```

- 使用 `healthAssessmentEligibility()` 复用健康观察边界，再额外要求 `status === confirmed` 和 `type === physical_symptom`。
- 使用 `builtInPreConfirmationBranchForConcern()` 取得稳定 branch key，不比较中文标题或描述。
- 使用 `differenceStoryTime(event.story_time, projection.timing.reference_story_time)` 计算 Event 在本轮的相对天数；无法比较、不是 day 单位、早于本轮、或不在 branch 的 min/max 区间时不匹配。
- 不搜索 Event description、Projection statement 或标签文本。
- `nausea` 不自动等同于 `odor_discomfort`、`appetite_change` 或 `nausea_worsening`。

### 2.3 Projection 生命周期保持不变

“已触发”是当前读模型的说明，不是 Projection 的终止状态：

- 不写 `factual_status=realized`。
- 不追加 Projection lifecycle record。
- 不改变 `context_visible`、ST API Context、候选删除、阶段替换或推送内容。
- 卡片继续保持 `status=active` 与“当前可能出现/始终可能”原语义。

## 3. 数据流

```text
Event Runtime 当前有效 business snapshot
  ├─ active_events
  └─ current_floor.version
          +
Projection Storage 当前 endpoint views
          ↓
Core 精确匹配函数
          ↓
Projection Runtime DTO
  observed_reaction: { matched: boolean }
          ↓
ui/projection.js
  matched=true → 卡片右上角“已触发”
```

`runtime/events.js` 在已有的业务 DTO 合并处把同一次 Event business snapshot 传给 `projectionRuntime.getBusinessData()`。Projection Runtime 在生成 DTO 前验证目标一致性，并将 `active_events` 交给纯 Core matcher。不得为此再次执行完整业务状态读取。

## 4. Core 与 DTO 设计

### 4.1 Core helper

优先扩展现有 `core/projection-eligibility.js`，因为该模块已经拥有内置观察阶段、branch key 与 Story Time eligibility 语义；不为单个 helper 新建碎片模块。

建议导出：

```js
matchBuiltInObservedReaction({projectionView, events})
  -> {
       matched: boolean,
       matched_event_ids: string[],
       matched_kind: string | null,
       reason_code: string
     }
```

返回值本身保持纯函数、不可变。`matched_event_ids` 只供 Runtime Debug 使用，不进入产品 DTO。

### 4.2 产品 DTO

每张内置卡片增加稳定的 presentation-safe 字段：

```js
observed_reaction: {
  matched: true | false
}
```

普通 UI 不接收 Event ID、Floor Version、raw description、reason code 或内部匹配类型。

### 4.3 Debug DTO

在现有 `business_debug` / Projection diagnostics 下增加有界、只读的当前 endpoint 结果，每张当前内置卡片最多一条：

```js
{
  subject_id,
  projection_id,
  projection_concern_key,
  matched,
  symptom_kind,
  matched_event_ids,
  reason_code,
  stage_key,
  source_type: 'CURRENT_DERIVED'
}
```

Debug 不包含正文全文、Event description、Prompt、模型输出或 Secret。Debug 复用现有导出，不新增日志系统或持久化字段。

## 5. UI 设计

`signalCard()` 使用已有但尚未接入的 `.bioweave-projection-signal-head`：

```html
<article class="bioweave-projection-signal">
  <div class="bioweave-projection-signal-head">
    <strong>恶心</strong>
    <span class="bioweave-badge good bioweave-projection-signal-observed">已触发</span>
  </div>
  <p>……</p>
  <em>当前可能出现</em>
  <div class="bioweave-projection-signal-foot">删除</div>
</article>
```

- badge 只由 `item.observed_reaction.matched === true` 控制。
- 不根据 `status`、标题、描述或 concern key 在 UI 二次推断。
- badge 在右上角；底部状态和删除按钮保持同一行及原有 hook。
- 复用 `bioweave-badge good`，不新增颜色 token。
- header 跨 signal grid 两列，标题可收缩，badge 不换行；不使用绝对定位或固定宽度。
- Desktop/Tablet 保持现有候选网格，Mobile 保持单列，禁止横向溢出。

## 6. 失效与回退

因为关联不持久化，以下变化在下一次权威读取后自然重算：

- Event 删除或编辑为其他 kind/status/role；
- 来源 Floor 删除或六字段版本变化；
- active Swipe 切换或删除；
- 当前 endpoint 回退到更早 Floor；
- 当前完整推演阶段被新阶段替换；
- 当前人物、观察轮次或卡片时间范围变化。

回退示例：Floor 26 的恶心 Event 与标注在回退到 Floor 23 后均不可贡献；若 Floor 23 自身存在合法匹配，则只使用 Floor 23 endpoint 可见事实重新生成标注。

## 7. 兼容与迁移

- 无持久化 schema 变化，无历史数据迁移。
- 旧 Projection DTO 缺少 `observed_reaction` 时按未命中显示。
- Generic/world-model Projection 不参与第一版匹配。
- 现有内置阶段生成、API Context、Projection delivery 与 lifecycle 行为保持不变。

## 8. 文档同步

实现后按项目固定顺序检查并同步：

1. `docs/ui-framework.config.json`
2. `docs/UI_FRAMEWORK.md`
3. `docs/UI_FRAMEWORK_EXAMPLE.html`
4. `docs/UI_FULL_REFERENCE.html`
5. `docs/UI.md`

由于未新增持久化字段，`docs/bioweave-data-lifecycle.md` 只需确认现有“derived UI model 从当前有效 Floor facts 重建”已经覆盖；若最终实现没有改变该契约，则不产生无意义修改。

## 9. 主要风险与控制

- **误把相似文字当匹配**：只比较结构化 kind 与稳定 branch key。
- **跨人物污染**：subject ID 必须一致。
- **旧症状污染新轮次**：Event 相对 reference Story Time 必须落在该 branch 时间范围。
- **竞态混合两个 Floor**：Event snapshot 与 Projection endpoint 必须通过同一六字段目标校验。
- **标注影响推送/卡片可见性**：不修改 factual status 或 lifecycle。
- **窄屏遮挡**：复用 flex header，badge nowrap，实测 1200×800、1024×800、390×844。

## 10. 回滚形状

本功能是 DTO/UI 增量。回滚时删除 Core matcher、Runtime DTO enrichment、Debug 投影及 UI badge，并恢复同步文档；因为没有持久化数据，回滚不需要清理用户 Floor 或迁移历史记录。

# 技术设计：人物详情单页人物卡

## Architecture and boundaries

保持现有 plain DOM 页面模块与 `ui/app.js` 单一 presentation owner：

- `ui/characters.js` 继续消费 `trackingSubjects`、`characterProfiles`、`activeEvents`，并把人物详情组装为一个连续 HTML fragment。
- `ui/app.js` 只保留 `focusedCharacterId` 作为页面 focus；删除人物详情 Tab state、Tab action selector 和 handler。`tracking_subjects` 仍是详情入口的唯一业务门槛。
- `style.css` 只删除旧 Tab 专用选择器，section 继续复用 `bioweave-card` / `bioweave-detail-section`。
- `docs/UI.md` 记录页面契约和 UI / Business boundary。

## Data flow and rendering contract

```text
Runtime business DTO
  ├─ trackingSubjects ──> subjectEntries ──> tracking subject list/detail gate
  ├─ characterProfiles ─> profileFor ──────> summary/capabilities only
  └─ activeEvents ──────> eventEntries ────> exposure event projection
                                        └─ counterpart remains display-only
```

`detailPage({characterId, subject, profile, activeEvents})` 依次调用纯 renderer：

1. `renderCharacterSummary({characterId, subject, profile})`
2. `renderCapabilities(profile)`（已有函数保留）
3. `renderCurrentState()`
4. `renderExposuresSection(subject, activeEvents)`，内部唯一调用 `renderExposures`
5. `renderProjectionSection()`
6. `renderRelationsSection()`
7. `renderNotesSection()`

当前未接入的 State / Projection / Relations / Notes 不增加伪造参数；renderer 直接返回约定的空状态。未来有正式 DTO 时再向对应 renderer 增加数据入口。

## Compatibility and migration

- `charactersPage()` 保持现有列表输入和详情入口输入兼容，只移除 `characterDetailTab` 参数。
- `trackingSubjects` 与 `activeEvents` 的 array/object 兼容读取、HTML escaping、capability 三态展示、Event 参与者和 counterpart 显示保持不变。
- 顶级 `pages` 路由和 `focusedCharacterId` 返回列表行为保持不变。
- 删除 `.bioweave-character-tabs` CSS 不会影响其它页面，因为当前仓库搜索显示它只有 `ui/characters.js` 一个消费者。

## Key trade-offs

- 选择连续 section 而不是在详情页新增状态容器：满足当前产品需要，并避免把未来业务 DTO 预先伪造成 UI state。
- 选择小型纯 renderer 而不是新的组件/服务层：符合项目的 plain DOM 和轻量模块化约束，也让 section 空状态和 Event 去重可直接测试。
- 保留事件参与者角色文案和 counterpart 展示：它们是完整 Event 的用户可读投影，不承担 eligibility 或关系推导。

## Rollback shape

变更集中在 `ui/characters.js`、`ui/app.js`、`style.css`、`tests/phase2a-ui.test.js`、`docs/UI.md`。若验证失败，可按文件级 diff 回退本轮变更；不涉及 storage、Runtime、Core 或持久化数据迁移。

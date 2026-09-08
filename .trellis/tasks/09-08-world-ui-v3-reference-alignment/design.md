# Technical Design: World UI v3 Reference 对齐与顶部信息降噪

## Boundary

只改现有 World UI 渲染和 scoped CSS：

```text
world_model_meta.source_summary
  -> ui/world.js 短摘要渲染

现有 World UI DOM
  -> .bioweave-world-model-page scoped reset/尺寸覆盖
  -> v3 reference 的 top/species/workspace/module 响应式结构
```

`ui/app.js` 的 World Model 状态、保存流程和事件委托不需要改变。所有
World Model 数据仍来自现有 Chat-local payload；CSS 不向宿主 document、body
或其他 BioWeave 页面泄漏。

## Metadata presentation contract

保留 `worldModelMeta` 原对象及其字段，只改变 `worldPage()` 的默认可见内容：

- 时间使用本地时间 `YYYY/MM/DD HH:mm`，不显示秒。
- `character_fields > 0` 才显示“角色卡”。
- `worldbooks > 0` 显示“X 本世界书”，不显示 entry 数量。
- 最近剧情优先显示实际 `floor_start/floor_end` 范围；没有范围时显示实际
  `floors_read` 数量。禁用或没有实际 items 时不显示。
- 外部 provider 只在 `enabled === true && read_status === 'success'` 时显示
 其 label；disabled/unavailable/error/empty 不显示。
- 没有任何来源时保留短的“暂无已记录来源”占位，不暴露配置细节。
- 不渲染状态、`last_saved_at`、`last_saved_by`、entry count、token estimate。

## CSS mapping

在现有 World UI CSS 的最后增加或整理一个页面级覆盖区，严格采用 reference
HTML 的数值，并通过现有 `--bioweave-*` theme token 接入颜色：

| Reference | BioWeave scope |
| --- | --- |
| `body` font `14px/1.5` | `.bioweave-world-model-page` reset |
| `.bw-top` | `.bioweave-world-model-top` |
| `.bw-btn` / `.bw-btn.small` | page-scoped primary/secondary/edit/switch/action buttons |
| `.bw-section-title` | `.bioweave-world-model-section-heading` |
| `.bw-species-grid` / `.bw-species` | existing species selector/card classes |
| `.bw-workspace` / `.bw-frame` | existing content grid/frame classes |
| `.bw-module-grid` / `.bw-module-head` | existing type module/grid/header classes |
| `.bw-kv-row` / `.bw-editor` / `.bw-field` | existing properties/editor classes |
| `.bw-world-stack` | `.bioweave-world-model-world-stack` |

The page reset must explicitly set inherited font and control properties for
`button`, `input`, `textarea`, and `select`, while retaining native accessibility
and existing theme colors.

## Compatibility and rollback

- No schema/storage migration or API change is needed.
- If a host theme still wins over a World control, add only a more-specific
  `.bioweave-world-model-page ...` rule; never add a global selector or `!important`
  blanket rule.
- Rollback is limited to `ui/world.js`, `style.css`, and the focused UI tests.

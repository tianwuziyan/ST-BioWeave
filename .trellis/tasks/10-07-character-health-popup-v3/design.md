# Technical Design — Character Health Popover v3 visual alignment

状态：实现完成，等待人工 review

## Boundaries

本次变更只属于 `ui/characters.js` presentation markup 与 `style.css` component styling。`healthViewModel()` 继续负责从当前 Runtime DTO 形成现有 view model；不在 UI 中重新判断 observation/intervention、severity、recovery 或 provenance。

## Data and event contracts

- `healthSourceEventIds()` 继续验证当前人物 active Event 中的 canonical `event_id`，返回值只传给现有 `renderHealthSourceActions()`。
- `renderHealthSourceActions()` 的按钮、`data-bioweave-action="view-health-source-event"` 和 `data-bioweave-event-id` 保持不变，只移动到 issue 第一列底部。
- `health_observations[]` 中每条 observation 继续展示 `current_description`，缺失时沿用 factual description fallback；不使用 demo 数据。
- severity 继续消费现有 observation/group read-model 字段，UI 不根据 kind、description 或 body_site 推断。
- `recovery_stage` 仅作为 presentation state class/ARIA label，缺失或未知时不输出 recovery markup。

## Markup shape

Popover header 保持现有 dialog/id/ARIA/action hooks。每个 presentation issue 使用：

```text
article.issue
├── .issue-site
│   ├── body_site
│   ├── laterality
│   └── renderHealthSourceActions(...)
├── .issue-content
│   ├── current issue label
│   ├── factual/current description(s)
│   └── optional recovery thermometer
└── .issue-side
    └── severity label
```

如果一个 site group 含多个 observation，保留同一 site group 的现有 grouping，不覆盖 observation；内容区逐条渲染其 current/factual description，第一列来源合并使用现有 source ids。

## CSS strategy

- 使用已有 `bioweave-*` token 体系，健康弹窗局部通过明确的 health values 对齐参考稿；不新增全局框架或依赖。
- 弹窗使用 `#202e36` 级深蓝灰 surface、`#526a74` 边框、10px radius、指定 shadow；正文/次级/辅助/分隔/强调/警告颜色按 PRD。
- issue grid 固定为 `94px minmax(0, 1fr) 48px` 和 12px gap；小屏不改变逻辑三列，只压缩中间列并保证 `min-width: 0`、`overflow-wrap`。
- thermometer 使用一个三等宽 grid 轨道和一个连续 `linear-gradient(90deg, #559eae 0%, #8acde0 100%)`；未到达段使用统一遮罩，不输出百分比。

## Compatibility and rollback

不涉及 persistence、DTO、runtime、domain 或 lifecycle。若验证失败，只回滚本次 `ui/characters.js` 与 `style.css` 的健康弹窗局部变更，保留用户已有 `work/` 内容和其他未相关修改。

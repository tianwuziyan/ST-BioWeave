# SevenDaysCal 日期源码审计

审计来源：`https://github.com/atonal519/ST-SevenDaysCal`，`master` 当前提交 `6eb76a8bef21da5af1a7f5fbe4b64b3285f5aab2`。

## 可移植纯函数

- `utils/cn-date.js:4-8`：中文数字映射、既有月份短 alias、全角数字归一化。
- `utils/cn-date.js:10-39`：`_cnToNumber`，含 `元`、阿拉伯数字、单字、廿/卅、十/百/千和繁体大写。
- `utils/cn-date.js:41-64`：`extractDayFromTime`，按 Arabic 年月日、分隔日期、纪元年名加数字月日、相对日、古代中文日期的顺序返回 key 或 `null`。
- `business/calendar/date.js:2-92`：`calendarDate`、`validateCalendarDescriptor`、`weekdayFor`、`isGregorian`、`daysInMonth`、`validateCalendarDate`、`ordinalOf`、`dateFromOrdinal`、`addCalendarDays`、`parseCalendarDate`、`formatCalendarDate`。

## 不移植的控制器

- `business/axis/date-detection.js:1-125` 把解析结果交给 API/diagnostics/anchor 流程，包含 AbortController、chat/floor/swipe identity、Toast 和 aftermath；BioWeave 只需要纯日期输入适配。
- `business/axis/date-actions.js:1-70` 写入 anchor repository、处理旧版认领、Toast 和 Story Clock 校准；本需求只复用它导入的 `addCalendarDays` 计算语义。
- `business/axis/story-clock.js` 还包含 Story Clock 标签、注入和聊天扫描，明确排除；仅将其纯日期识别规则作为上游行为对照，不复制模块。

## 关键兼容观察

- 上游 `extractDayFromTime` 本身只保留 `cn-year-month-day` key，不保留任意纪年标签；Story Clock 的纯解析结果才附加 `eraLabel`，且无界定纪年默认要求两字。BioWeave 为满足用户给定的三类测试，保留上游优先级和 key 约定，同时将纪年识别扩展为通用 CJK 纪年 token，不写具体名称。
- 上游 `date.js` 自定义历法不经过 JS `Date`；跨年/星期计算依赖历法月份描述和可选 epoch/absoluteCycle。BioWeave 不应从文学日期或 `display` 伪造连续 `day_index`。

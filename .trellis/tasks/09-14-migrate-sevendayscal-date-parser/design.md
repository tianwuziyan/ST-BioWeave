# 技术设计：SevenDaysCal 日期能力接入 StoryTime

## 1. 边界和模块

```text
SevenDaysCal public provider raw value
        │
        ▼
utils/cn-date.js  ── 中文数字、月份/节日词典、文本日期解析与 day key
        │
        ▼
business/calendar/date.js  ── CalendarDate、合法性、序号与加减日
        │
        ▼
story/time.js  ── provider 输入适配、StoryTime DTO、现有 fallback/diff
        │
        ▼
Event Analysis / UI 只消费结构化 StoryTime
```

新增纯函数模块保持与参考项目同名的 `utils/cn-date.js` 和 `business/calendar/date.js`，便于逐项比对；不复制 `business/axis/date-detection.js` 和 `date-actions.js` 的宿主控制逻辑。

## 2. 中文日期模块

- 先机械保留 SevenDaysCal 的 `_CN_NUM_MAP`、`normalizeCnDateDigits`、`_cnToNumber` 和 `extractDayFromTime` 的基础顺序与返回约定。
- `_CN_MONTH_ALIAS` 扩展为用户给出的传统月份固定词典，同时保留 `正`、`冬`、`腊`、`臘` 等参考项目既有短 alias。含“月”的别称和不含“月”的别称都作为词典 token 处理，不通过完整句子分支处理。
- 增加固定 `_CN_FESTIVAL_ALIAS`，值为结构化 `{month, day}`；匹配时按 token 长度降序，解决“中秋”/“中秋节”“下元”/“下元节”等前缀关系。
- 增加一个小型纯解析入口（名称以实现时的实际命名为准，预计为 `parseCnDate`），返回 `{year, month, day, eraLabel?}`；规范 key 继续遵循 SevenDaysCal `cn-year-month-day` / `day-n` 约定，纪年标签作为结构化附加信息而不是硬编码映射。
- 解析组合遵循 SevenDaysCal 的优先级：精确阿拉伯日期优先，其次完整中文年月日/带纪年日期，再是月日、节日和相对日期；显式完整年份解析失败时不退化为无年份月日。对纪年后的标点/非日期连接文本只使用通用边界容错，以覆盖测试中的叙述分隔，不识别任何具体纪年名。

## 3. 历法纯函数模块

逐函数移植 SevenDaysCal `business/calendar/date.js`：

- `calendarDate`、`isGregorian`、`validateCalendarDescriptor`；
- `daysInMonth`、`validateCalendarDate`；
- `ordinalOf`、`dateFromOrdinal`、`addCalendarDays`；
- `parseCalendarDate`、`formatCalendarDate`、`weekdayFor`。

不把这些函数改造成 JS `Date` 的统一封装；自定义历法仍只按月份描述计算，公历只在参考实现允许的分支使用 UTC `Date`。

## 4. StoryTime 适配

- `story/time.js` 新增公开的日期解析入口/别名，并导入上述纯模块。
- `createSevenDaysCalProvider` 在其“调用方提供的公开值”边界解析原始字符串或只有 `display` 的日期值；已有 `normalized`、`day_index`、`calendar_id` 等结构化字段优先保留。
- `createFallbackStoryTimeProvider` 继续只接受结构化值，不从 fallback 的 `display` 反向解析；`formatStoryTime` 继续只负责显示。
- 公历完整日日期可按既有 `strictDayIndex` 生成连续 `day_index`。自定义历法/纪元日期没有明确连续纪元时仅保存规范 key/结构化年月日，`day_index` 保持 `null`；`addCalendarDays` 等计算能力通过纯历法 API 提供。
- 现有 `createStoryTime()` 的 provider 优先、fallback 降级、`diff` 和 DTO 字段不改名、不改调用签名；适配参数只以可选参数形式增加。

## 5. 兼容性和风险

- 现有 `normalizeStoryTime` 对结构化对象的字段优先级保持不变，避免影响 `core/events.js`、分析输入和历史 Event。
- 解析发生在 provider 输入边界，避免让 UI 或 formatter 各自实现日期解析，也避免违反“display 仅展示”的领域约定。
- 上游 `date-detection.js` / `date-actions.js` 的函数依赖 API、diagnostics、anchor repository、Toast 和 floor/chat identity；整体移植会扩大范围并带入无关状态，因此只把 `date-actions.js` 使用的 `addCalendarDays` 作为纯计算能力移植。
- 自定义历法的绝对跨年计算依赖显式 calendar 描述/epoch；没有这些证据时不生成伪造连续索引。

## 6. 回滚形状

生产改动限定在新的纯模块、`story/time.js`、日期测试和日期契约文档。若验证发现 StoryTime DTO 回归，可先撤销 adapter 的原始字符串解析接线，保留独立纯函数测试；不得回退当前分支已有无关改动。

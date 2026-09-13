# 迁移 SevenDaysCal 通用中文日期解析到 BioWeave

## Goal

让 BioWeave 在现有 `StoryTime` 机制中获得与 SevenDaysCal 相同或尽可能接近的通用日期能力：中文数字解析、中文年月日解析、日期归一化、月份名称解析、日期合法性检查和可计算日期转换；不重新设计日期解析器，也不引入 SevenDaysCal 的 UI 或私有状态。

## Background / Confirmed Facts

- 参考仓库 `atonal519/ST-SevenDaysCal` 当前审计版本为 `master` 提交 `6eb76a8bef21da5af1a7f5fbe4b64b3285f5aab2`。
- SevenDaysCal 的无状态中文日期基础在 `utils/cn-date.js`：`normalizeCnDateDigits`、`_cnToNumber`、`extractDayFromTime` 以及 `_CN_NUM_MAP` / `_CN_MONTH_ALIAS`；解析顺序是阿拉伯年月日、分隔符日期、纪元年名加数字月日、相对天数、古代中文年月日，失败返回 `null`。
- SevenDaysCal 的历法纯函数在 `business/calendar/date.js`：`calendarDate`、历法描述校验、公历/自定义历法区分、月日校验、序号转换、加减日、格式化和解析。
- SevenDaysCal 的 `business/axis/date-detection.js` 还承担 API 请求、AbortController、诊断、锚点写入和 aftermath；`business/axis/date-actions.js` 还承担锚点 repository、Toast 和生命周期身份检查。这些不属于本需求。
- BioWeave `story/time.js` 已有结构化 Story Time DTO、注入式 SevenDaysCal provider、fallback provider 和 `formatStoryTime`；当前 provider 只调用调用方注入的公开方法，不读取私有 Store。`runtime/events.js` 默认创建该 StoryTime，`core/events.js` 和分析输入也消费其结构化结果。
- BioWeave 当前合同要求 formatter 不从 `display` 反向推导排序或计算。解析应发生在可信的 provider 输入边界；fallback 仍保持只接受结构化值的保守行为。

## Requirements

### R1. SevenDaysCal 基线兼容

- 直接移植 SevenDaysCal 的中文数字和纯历法算法，尽量保持函数行为、解析优先级、`null` 失败语义和规范 key 兼容。
- 不把 SevenDaysCal 的 `Story Clock`、Chat Date Anchor、Floor 状态、private store、UI 或 API 控制器带入 BioWeave。
- 不在生产代码中写死测试里的 `赤曜历`、`天河` 或 `某任意纪年`；纪年名必须按通用规则识别并作为解析结果保留（如能力允许）。

### R2. 固定月份和节日词典

- 将用户给出的 1–12 月传统别称作为固定月份 alias，统一放入中文日期词典，并让既有中文日期解析流程使用它们。
- 将用户给出的节日 alias 映射到固定月日，统一放入同一日期解析流程；至少覆盖 alias 的带“节”和不带“节”变体及最长匹配优先。
- 不为任意完整句子增加专用分支；测试文本只能出现在测试文件中。

### R3. 日期结构和合法性

- 支持阿拉伯日期、SevenDaysCal 原有中文数字日期、月份 alias、节日 alias，以及通用纪年名加年份的组合。
- 公历和自定义历法分别按 SevenDaysCal 的规则检查月份、日、闰年和历法描述；无效日期返回 `null`，不能静默降级成较弱的月日结果。
- 支持规范日期 key / 结构化日期之间的转换，并复用 SevenDaysCal 的 `ordinalOf`、`dateFromOrdinal`、`addCalendarDays` 等可计算操作。

### R4. StoryTime 接入

- 在 `story/time.js` 暴露一个可测试的日期解析/归一化入口，并让 SevenDaysCal provider 在输入边界使用它。
- 已提供结构化 `normalized` / `day_index` 时保持原有优先级；只有公历完整日期或调用方明确提供的连续索引才能产生 `day_index`。
- 自定义历法或纪元日期可以得到结构化年月日和规范 key，但没有可靠连续纪元时不得伪造 `day_index`。
- 保持现有 StoryTime DTO 字段、provider 优先级、fallback 行为和 formatter 行为兼容。

### R5. 验证和文档

- 新增覆盖中文数字、月份 alias、节日 alias、中文年月日、纪年名、解析优先级、无效日期、历法计算和 StoryTime provider 接入的测试。
- 测试包含用户给出的三个示例，但生产代码中不得出现这些示例的专名或完整句子。
- 同步更新日期/StoryTime 领域文档，明确“输入边界解析、formatter 不反向解析”的边界。

## Out of Scope

- SevenDaysCal UI、Story Clock 注入/标签、Chat Date Anchor、楼层快照/状态、private store、API 请求、AbortController、Toast 和宿主生命周期控制器。
- BioWeave UI 改版、事件 schema 重设计、妊娠天数/预计分娩日、新的日期存储层或新的 Provider/Factory/Registry 层。
- 任何具体世界观纪年名、完整句子特例或把模糊展示文案强行转换为准确日期。

## Acceptance Criteria

- [ ] SevenDaysCal 纯中文日期和纯历法函数按其原有优先级/错误语义可在 BioWeave 中独立调用。
- [ ] 用户给出的全部月份别称和节日别称可通过统一词典解析，未添加完整句子特例。
- [ ] `赤曜历十二年霜月初七`、`天河四十二年春，三月十八`、`某任意纪年十九年中秋节` 仅在测试中分别得到 12/7/7、42/3/18、19/8/15（并保留可用纪年标签）。
- [ ] 非法公历/自定义日期返回 `null`；序号转换和加减日覆盖跨月、跨年以及未知年份边界。
- [ ] SevenDaysCal provider 能把原始日期输入归一化为 StoryTime 结构；fallback 不因展示字符串生成伪造的规范日期或 `day_index`。
- [ ] 现有全量测试与新增定向测试通过，所有 changed JS 通过 `node --check`，`git diff --check` 无错误。
- [ ] 对生产代码执行检索可证明测试示例中的三个纪年名没有被写入。

# 执行计划：SevenDaysCal 日期能力迁移

## Phase 1 完成前检查

- [x] 已创建独立 Trellis task 并确认 worktree 初始干净。
- [x] 已审计 BioWeave `story/time.js`、Runtime/Event 消费边界和现有 StoryTime 测试。
- [x] 已读取 SevenDaysCal `master` 当前提交及用户指定四个文件，确认纯函数与宿主控制器边界。
- [x] 已确定不移植 UI、Story Clock、Chat Date Anchor、Floor 状态、private store 和 API 控制器。
- [x] 已写入 `prd.md`、`design.md` 和本执行清单；实现前仍需用户明确批准本规划摘要。

## Phase 2 有序实现

1. 新增 `utils/cn-date.js`：机械移植中文数字/date-key 基础，加入月份/节日固定词典及通用 token 解析；验证导出和旧优先级。
2. 新增 `business/calendar/date.js`：机械移植 SevenDaysCal 纯历法函数，不引入宿主依赖。
3. 修改 `story/time.js`：在 SevenDaysCal provider 输入边界接入日期与传统时辰解析/规范化，保留结构化字段优先、fallback 保守语义，并提供独立的日期 display formatter；最终 Event 归一化只显式调用该 formatter，不重算结构化字段。
4. 新增/修改日期与 StoryTime 定向测试：覆盖所有 alias 类别、完整中文日期、纪年名泛化、样例、非法日期、传统时辰/刻数、时辰跨日、日序/加减日、provider/fallback 边界。
5. 若 public StoryTime 合同或现有文档语义变化，仅同步 `docs/DATA-MODEL.md`、`docs/DEVELOPMENT.md` 和必要 README 说明；不触碰 UI 框架文档或生产 UI。

## 验证命令

```bash
npm test
npm run check
git diff --check
node --check utils/cn-date.js
node --check business/calendar/date.js
node --check story/time.js
node --test tests/cn-date.test.js tests/calendar-date.test.js tests/story-time.test.js
rg -n "赤曜历|天河|某任意纪年|未时三刻|丑时八刻" utils business story --glob '*.js'
```

最后一条必须无生产代码命中；样例命中只能出现在测试文件或任务文档中。

## 风险点 / 回滚点

- `utils/cn-date.js` 的分支顺序是兼容核心；词典扩展不得把先前 Arabic/relative 分支移位。
- `story/time.js` 的 provider/fallback 优先级和现有深比较测试是回归重点。
- `runtime/*`、`ui/*` 不在默认修改范围；因真实 `event.story_time` 在 `core/events.js` 的最终归一化边界进入生产，本轮只允许在那里显式启用 display 日期格式化，不顺手重构其它 Event 逻辑。
- 不执行 `git reset`、`restore`、`clean`、`checkout`、`stash`、commit 或 push；提交需要另行授权。

## 本轮传统时辰扩展记录

- `utils/cn-date.js` 新增 `TRADITIONAL_TIME_START_HOURS`、`matchTraditionalTime` 和 `parseTraditionalTime`；数字刻统一先经 `normalizeCnDateDigits` 再经 `_cnToNumber`，无刻使用 `marks: 0`。
- `story/time.js` 只在 SevenDaysCal 可信输入边界移除同一通用匹配结果后解析日期；date-only display 保持既有兼容规则，日期加时辰时将解析出的数字年月日与原始时辰子串组合显示。已有结构化 `normalized` / `day_index` 时，display 格式化独立执行且不覆盖它们。纯时辰为 `HH:MM`，日期组合为 `date-keyTHH:MM`，跨日使用 `addCalendarDays`，无法推进时不生成规范日期或绝对索引；最终 `core/events.js` 归一化边界覆盖 narrative StoryTime 的显示层。

## Phase 3 收尾

- [x] 独立质量检查确认实际 diff、测试和文档没有 scope drift。
- [x] 按要求报告日期函数、适配改动、alias 所在位置、测试结果和样例未进入生产代码的证据。
- [ ] 未获得提交授权前保留变更未提交。

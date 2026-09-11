# Phase 2A 实施计划

## 0. Start gate

- [x] 已完成 task creation consent。
- [x] 已完成当前仓库、规范、旧任务和基线测试审计。
- [x] 已形成 `prd.md`、`design.md` 和本实施清单。
- [x] 已获得用户对最新规划摘要的批准，并已运行 `task.py start` 后进入实施。
- [x] `task.py validate` 通过后进入实施阶段。

## 1. Wave A：Domain Event、Story Time 和 Tracking Registry

单一写入范围：`core/events.js`、新增 `core/tracking.js`、`story/time.js`、相关 domain/story tests。

- [x] 定义并导出 `BIOLOGICAL_EVENT_SCHEMA`、Event Status、Event Type、Reproductive Role 和 Story Time precision 常量。
- [x] 扩展 `normalizeEvent` / `validateEvent`：补齐 source、story_time、participants、pregnancy_relevance、source_evidence，保留所有既有 BiologicalEvent 类型。
- [x] 保证 `counterpart_ids`、`gestational_subject_ids` 始终归一化为稳定 ID 数组；禁止逗号字符串和姓名关联。
- [x] 实现 `eligibleGestationalSubjects(event)`：只接受明确 `can_carry_pregnancy === true`、实际受孕暴露和有效 Event 状态；不读取 gender。
- [x] 实现 `rebuildTrackingRegistry(events, previousChat)`：支持 0/1/N Subject、1/N counterpart、同一 Subject 多 exposure，并清理 dangling refs。
- [x] 实现 Story Time normalize、SevenDaysCal provider wrapper、fallback provider、无反向解析的 display formatter。
- [x] 验证 domain tests：无能力、单 Subject、多 counterpart、多 Subject、gender 不决定、null 不变 true、非 NSFW、无暴露、重复事件、结构化/模糊 Story Time。

## 2. Wave B：固定 Event Prompt 与 Analyzer

单一写入范围：`ai/prompts.js`、`ai/input-builder.js`、`ai/analyzer.js`、Event analyzer tests。

- [x] 在 `ai/prompts.js` 增加固定 Event Analyzer core contract 和 JSON output contract；明确所有用户要求的 19 条约束。
- [x] 增加 `buildEventAnalysisMessages()`，把 Chat Scope、Floor Version、当前 Floor Narrative、最近上下文、World Model、Story Time 和角色资料作为结构化输入。
- [x] 增加 `parseEventAnalysisResponse()`，只接受 JSON 对象/固定 `events[]`，拒绝自然语言自由输出和非法事件。
- [x] 在 parser 边界注入 authoritative Floor Version；不信任 AI 返回的跨 Chat/Floor/Swipe source。
- [x] 将 `createAnalyzer().analyzeFloor()` 改为 Event messages + parser；保留 World Model analyzer、Projection 兼容入口。
- [x] 验证 Event prompt 不使用 gender 推导；`counterpart_ids` 为数组；schema 兼容非 sexual BiologicalEvent 类型；parser 失败不返回半结构化事实。

## 3. Wave C：Storage、Floor Version 与 runtime 调度

单一写入范围：`storage/schema.js`、`storage/store.js`、`runtime/floor.js`、`runtime/events.js`，随后由 app 集成这些边界。

- [x] 为 `emptyChat` 增加向后兼容的 Tracking Registry 默认值；读取老 Chat 时按空 Registry 处理，不做危险迁移。
- [x] 保留现有 Chat Scope、secret sanitizer、ordinary/per-swipe storage；必要时补充 Registry normalize 和保存入口。
- [x] 增加当前 active swipe Floor/Event 扫描：只接收 Event.source 与当前 Floor Version 完全匹配的事实。
- [x] 复用 `shouldAnalyze` / `commitAnalysis` / `isIntervalTarget`，实现 N-floor 自动目标、失败可重试、手动强制刷新和成功替换。
- [x] 设计失败语义：旧成功数据可保留在 `last_success`，但旧 source 不得进入新 Floor Version 的 active Registry。
- [x] 让 runtime lifecycle 在 Chat/Floor/message/swipe 变化时刷新 Registry；UI open/reopen/init 不触发新的 AI 请求。
- [x] 验证 Floor delete、Swipe A/B、Floor Version replacement、manual success replacement、manual failure preserving previous success。

## 4. Wave D：App orchestration 与业务 UI

单一集成写入范围：`ui/app.js`；页面写入范围：`ui/characters.js`、`ui/events.js`、`ui/overview.js`；样式只做必要的现有 `bioweave-*` 页面规则。

- [x] 在 app 中读取当前 Chat 的有效 Floor Events 和 Tracking Registry，向页面传递真实 DTO；不从 UI 推导资格。
- [x] 删除 `demo-character-1` 和所有人物 demo 文案；无 Registry 时显示精确 Empty State。
- [x] 实现人物列表/详情：稳定 ID、species/type、known capabilities、exposure Event 列表和“等待状态引擎计算”。
- [x] 实现 Event 列表/详情：Story Time、Floor、Location、Participants、Roles、Pregnancy Relevance、Status、Confidence、Source。
- [x] 实现 Event 编辑和真删除：保留 event_id/source，直接更新当前 Floor Event 并重建 Registry；不建 override layer。
- [x] 接通 Overview Subject count、Event count、最近真实 Event；Projection/Genealogy 保持 Empty State。
- [x] 增加 runtime/action tests：编辑后 UI/Registry 读取新 Event，删除后 exposure ref 消失，UI source-level 不含 gender eligibility 推导。

## 5. Wave E：Documentation and contract review

单一写入范围：`README.md`、`docs/DATA-MODEL.md`、`docs/DEVELOPMENT.md`、`docs/UI.md`、必要时新增 `docs/EVENT-SCHEMA.md`。

- [x] 记录 Event JSON Schema、Story Time 结构和 Source binding。
- [x] 明确人物列表不是当前 Chat 的全角色列表；进入列表由 BiologicalEvent + World Model + Narrative Evidence 决定，UI 不参与判断。
- [x] 明确 BiologicalEvent 是完整 NSFW 历史事实的唯一来源，人物卡只保存 event_id 引用；日期（姓名）只由 UI formatter 生成。
- [x] 明确 Floor/Swipe deletion、active registry policy、失败刷新和本阶段 State/Projection 空状态边界。
- [x] 检查文档没有把 Phase 2A 描述成完整 Pregnancy State 或已完成的 Projection/Genealogy。

## 6. Validation gates

### Focused checks after each wave

- [x] `node --check` 所有变更 JavaScript。
- [x] 对应的 `node --test tests/<focused>.test.js`。
- [x] `git diff --check`。

### Final automated gate

- [x] `npm run check`（288 tests pass）。
- [x] `rg` 检查生产 UI 不含 `demo-character-1`、gender eligibility 分支、`partner: "A,B"` 或自然语言 Event parser fallback。
- [x] 检查所有 Event persisted source 都含六字段 Floor Version，Registry exposure refs 都能在 active Event 集合中解析。
- [x] 检查 `Projection`、`Genealogy`、`StateReducer`、`Snapshot` 未被本阶段提前接通。
- [x] 对完整 diff 做文件级审查：只修改与 Phase 2A 直接相关的代码、测试和文档。

### Real-host acceptance handoff

- [ ] 刷新/重装当前 SillyTavern 插件，确认 manifest 与实际安装版本一致。
- [ ] 在真实 Chat 发生一个满足/不满足受孕暴露的 NSFW 剧情，确认自动分析按 N-floor 触发，重复打开 UI 不重复请求。
- [ ] 确认 AI 返回的 Event JSON 能被解析，Floor/Swipe extra 位置正确，Chat metadata 只有 Registry 引用和必要 profile。
- [ ] 切换 Swipe、删除 Floor、编辑/删除 Event，确认人物列表和 exposure records 与当前有效事实同步。
- [ ] 验证 SevenDaysCal 有/无时的 Story Time provider、模糊日期 null 行为和 UI display。
- [ ] 在 Desktop / Tablet / Mobile 验证人物、事件、总览空状态和详情布局无横向溢出。

## 7. Rollback points

- Domain/Story Time contract 不通过时只回滚 Wave A，不触碰现有 World Model。
- Analyzer parser 不通过时保留现有 `analyzeFloor` 入口但禁止写 Event，先修复固定 schema。
- Runtime/Storage 回归时恢复到现有 `events: []` Floor 行为，保留独立纯函数测试定位问题。
- UI 回归时保留真实 Empty State，不恢复 demo-character mock；修复数据接线而不是生成占位数据。
- 未完成人工 SillyTavern 验收前不执行 push；本 task 完成后停在人工验收等待点。

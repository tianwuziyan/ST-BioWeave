# 实施计划：妊娠参与者名单聚合生命周期

## 阶段 0：实施门禁

1. 重新读取本 task 的 `prd.md`、`design.md`、本文件及适用 `.trellis/spec` 索引。
2. 检查 `git status --short --branch`，保留用户已有修改。
3. 记录基线测试；仅在用户批准规划摘要后运行 `task.py start`。

## 阶段 1：Domain 与策略

1. 增加 aggregation record 的 normalize/validate/deterministic identity。
2. 增加 `at_effective_min` 策略接口和未来策略的不可执行占位，不新增随机抽样。
3. 从当前完整 Event 集合按 accepted Exposure IDs 重建当前参与者名单。
4. 增加 domain tests：多 Exposure、删除一条、重复 success、Timing 字段只读；在 lifecycle archive/release 未具备前不得默认启用 lock。

## 阶段 2：Floor-owned persistence

1. 在 `storage/schema.js` 增加 `participant_aggregation_timeline` 默认结构。
2. 增加独立 storage adapter，复用 Coordinator、active Swipe、六字段 Version 和 stale guard。
3. 增加 timeline normalize/resolve/dedupe/readback。
4. 接入 lifecycle registry、clear/invalidation 和 diagnostics。
5. 验证历史 Floor/未来 Floor/active Swipe 不串读，且不改变 `floor.events` 事实源。

## 阶段 3：Runtime 与 Projection 衔接

1. 在现有 Timing resolution 后读取 aggregation timeline。
2. elapsed < effective min 不聚合；elapsed >= effective min 尝试；elapsed > effective max 立即补做。
3. success 写入后把独立 aggregation DTO 传给 Projection Eligibility/Runtime。
4. 新聚合路径 Projection 使用 `aggregation_path=participant_aggregation` provenance；Eligibility、Generation、Projection persistence 和 Context readback 均要求完整 aggregation evidence。历史无 evidence Projection 保持兼容，不得让新记录退化为历史格式。
5. AI 失败只影响 Projection 执行，不清除 success、不重新开放 Exposure 收集。
6. Event edit/delete 重新计算名单但不重建 Timing；Story Time 跳跃保证先聚合再 Projection。
7. 普通 NSFW Event 保存路径保持不变。

## 阶段 3A：Event 写入过滤与编辑锁定（先实现禁用状态）

1. 在 AI 原始结果进入当前 canonical parser 的单主体校验前，建立复合 AI 中间结果；不得让多主体 `sexual_activity` 先被现有 parser 拒绝。该阶段只实现禁用状态下的边界和测试。
2. 在 `runtime/character-event-analysis.js` 的中间结果 → `normalizeEventRecord`/最终 collection validation 边界读取当前 Floor-owned aggregation success 状态并建立人物 slice；只移除处于聚合锁定期的主体 slice，保留其它主体 slice。
3. 重建每个保留 slice 的 `participants`、`pregnancy_relevance`、counterpart/relationship references、participant evidence 和 source evidence。
4. 在该边界为每个保留 slice 生成 subject-local canonical Event；最终每个 Event 继续符合单 gestational subject Schema，若无 Exposure 且无其它业务内容则丢弃，不放宽最终 Schema。
5. 预留 `updateEvent()` 持久化前的人物/事件级编辑锁和 `deleteEvent()` 豁免边界，但在 lifecycle archive/release capability 未通过统一上线门禁前保持 edit lock disabled；`deleteEvent()` 明确不受该锁阻止。
6. 删除锁定 Event 后重新派生当前名单；按 aggregation/cycle/pregnancy、accepted Exposure IDs、参与者和 Exposure mapping 逐粒度重校验 Projection evidence，不一致的历史 Projection 只从当前 ST Context 排除，不删除历史记录。
7. 保持完整 `events` 数组一次性 Floor 写回、active Swipe 和六字段 Version guard；不得先写入再排除。启用前必须完成妊娠结束归档、旧 Exposure 退出和 lock release 的跨周期验证。

## 阶段 4：专项测试与验收

必须新增以下测试：

1. 14～42 配置经现有偏移后，聚合使用 effective min/max。
2. 同周期重复运行不重新抽取偏移。
3. effective min 前不聚合，到达 min 后立即聚合。
4. 直接超过 effective max 自动补做聚合并进入 Projection。
5. `random_within_effective_range` 接口存在但当前不抽样。
6. 聚合成功后不重复聚合、不重新开放收集；AI 失败不改变 success。
7. 聚合后删除一条 Exposure，其余有效 Exposure 和参与者保留。
8. Floor/Swipe 回退和切换不继承未来 Floor success。
9. AI 返回复合 Event 时，在 canonical 单主体 parser 拒绝前进入中间结果拆分；锁定人物 slice 被过滤、未锁定人物 slice 独立保留。
10. 过滤后 participants、subject IDs、counterpart IDs、关系和证据引用一致，并再次通过 schema/collection validation；最终仍为单 gestational subject。
11. 全部 Exposure slice 被过滤且无其它业务内容时不写入 Event；存在其它业务内容时不残留锁定人物引用。
12. 聚合锁定 Event 禁止编辑但允许删除；非锁定 Event 仍可编辑；未锁定人物和普通非受孕 NSFW Event 正常写入。
13. 删除多 Exposure 参与者的一条 Exposure 后其余 Exposure/参与者保留，Projection evidence 因 mapping 不一致从当前 ST Context 排除；删除唯一 Exposure 后参与者退出且旧 Projection 不注入；删除全部 Exposure 后同样不注入但保留历史 Projection。
14. 聚合 success 仍存在但 accepted Exposure 集合或参与者 mapping 与旧 Projection 不同，当前 Context 重新校验并排除；AI 失败、重复执行不改变 success。

### 锁定功能上线门禁

本 task 不得把 aggregation lock 作为永久锁上线。用户已确认统一上线门禁：`pregnancy_end` 的 ST 明确事实识别、候选/证据归档、旧 Exposure 当前有效性退出和 lock release 必须先形成可用的 lifecycle archive/release capability；在该 capability 未就绪时，aggregation success 可以继续作为规划/只读基础，但新增 Exposure 写入过滤和 `updateEvent` edit lock 必须保持 disabled。不得以 Story Time、Timing Window、Projection AI 或父方 unknown 推断释放；父方 unknown 不阻止新妊娠周期。

如果产品希望本 task 在后续实现后可独立上线，最小衔接方案是把 lifecycle archive/release 作为同一上线 gate 的必选依赖，而不是把它留给未来再补；否则本 task 只能交付未启用的锁定能力和测试/接口准备，不能宣称完整闭环。

### 后续父方追踪阶段（本 task 不实施）

以下项目只作为后续独立任务的验收边界，不得在本次聚合实现中提前扩展：

1. 候选按 `pregnancy_id`/`cycle_id` 隔离；同一 subject 的新妊娠不继承旧候选。
2. 一个候选不启动周期性父方剧情，也不自动写入 confirmed father；多个候选、ST 确认妊娠、father unknown、至少一个相关人物 awareness=true 才进入可推动状态。
3. Awareness 必须逐人物、逐 pregnancy 记录，并由 ST 正文/Event Analysis 的事实输入产生；覆盖目标本人、CHAR、相关 NPC 与父方确认，不能由 Timing/Projection/Exposure 次数推断。
4. 未知人物不会收到主动调查方向；插件掌握完整候选集不等于该人物知道候选集。
5. 父方确认发生在妊娠期间或生产后都更新原 `pregnancy_id`；ST 未明确确认时 `father_status=unknown`。
6. Story Time lifecycle 可重复执行时不重复催促；后续父方阶段使用已确认的正整数 Story Day interval（最小 1，暂定默认 7，UI 实施前再次确认）；AI 失败不重置候选、awareness 或 Exposure lock。
7. Projection Context 只注入通过 pregnancy_id、Floor/Swipe provenance 和 awareness gate 的父方剧情 DTO；失效 Event/Projection 不能继续进入当前 ST Context。

8. UI 在现有「推演周期」区域增加独立的父方确认剧情间隔数字输入和说明；输入值由用户自定义，暂定默认 7 Story Day，正式 UI 实施前再次确认。
9. 实施 UI 前先复用现有配置机制证据：`ui/characters.js:311-328`、`ui/app.js:3925-3952`、`core/character-timing-config.js:3-48`、`storage/character-timing.js:11-23`。推荐使用独立 Chat-local father-tracking config namespace；不得把 interval 写入 Timing Instance/config_snapshot 或改变现有 Timing API 的 effective range。
10. 当前暂定后续 UI 规则为默认 7 Story Day、最小 1 Story Day、正整数；旧聊天缺失字段使用默认值，清空输入恢复默认值。7 Story Day 仍是待最终确认的推荐默认值，正式实施 UI 前必须再次提示用户确认。
11. 父方调度以 ST Story Time 为准：首次满足四项 gate 后建立 pregnancy-specific schedule anchor，后续按配置间隔判断，每次执行机会最多一次；Story Time 跳跃不补发历史提示，推动后持久化 pregnancy-specific dedupe state。
12. 父方追踪停止只由对应 `pregnancy_id` 的 ST/Event Analysis 明确 father confirmation 触发；妊娠结束、生产后延续、旧 pregnancy unknown 与新周期并存必须分别测试。
13. Event lock release 不使用统一 factual-terminal 映射：not pregnant 使本轮 Exposure 退出当前有效集合且不启动父方追踪；pregnant ongoing 继续锁定；miscarriage/termination/delivery 等妊娠实际结束事实出现时先归档候选/证据再释放；outcome unknown 不自动归档或解锁；father confirmation 只结束父方追踪，不单独解锁 Exposure。
14. 妊娠生命周期状态只能由 ST 明确剧情事实经 Event Analysis 识别更新；不得使用 Timing、Tracking Window、Projection AI 或 Story Time 跨度推断结束。归档/清理不得修改历史 Floor 快照。
15. 跨周期场景 C001：Exposure 收集 → 聚合成功 → 确认怀孕 → 确认分娩 → 候选/必要证据归档 → 旧 Exposure 退出当前有效集合；随后 C002 新 Exposure 正常写入。
16. C001 父方仍 unknown 不阻止 C002；C002 不继承 C001 聚合成功状态、不继承 C001 候选名单；历史 Floor 快照保持不变。

### 当前能力审查结论

- 候选派生与按妊娠隔离：已有，见 `core/reproductive-attribution.js:43-75`、`runtime/event-analysis.js:2920-2984` 和 `tests/reproductive-attribution.test.js:19-60`。
- 显式 contributor 事实：已有部分能力，见 `core/reproductive-attribution.js:26-40` 与 `tests/reproductive-attribution.test.js:62-87`；它不等价于 awareness 或 father storyline state。
- 人物 awareness/knowledge：`NOT_TESTED`/当前无专用结构；本次不新增。
- 独立父方 Projection prompt：当前无专用通道；可复用通用 context slot，但必须由后续任务新增 DTO、gate 与证据测试。
- Story Time 执行机会：已有通用入口，见 `runtime/events.js:2485-2591`；当前无父方专用调度或去重状态。

因此，本 task 的实现验收不包括父方剧情、awareness 识别、父方 interval UI 或 father confirmation；这些内容必须以独立后续 task 规划和测试，避免把聚合成功误当作人物知情或父方确认。

验证命令：

```bash
node --test tests/projection-timing.test.js tests/tracking-window.test.js tests/tracking-window-phase2.test.js tests/projection-runtime.test.js
node --test tests/event-analysis-runtime.test.js
npm run check
```

同时必须区分自动化测试与真实 ST Desktop/Tablet/Mobile host acceptance。

## 风险与回滚点

- 旧 `window_missed` 测试需要按新业务契约调整，但不能修改 Timing Instance 偏移算法。
- 新 Floor root 任一 readback/lifecycle/stale guard 失败时停止扩展，不用 Chat cache 补偿。
- Projection 旧 evidence 为历史 append-only；其删除/编辑语义必须在实现前明确并以测试锁定。
- 当前 AI parser 先拒绝多主体 sexual_activity；复合 Event 支持必须落在“中间复合结果 → subject-local canonical Event”边界，不能通过放宽最终完整 Event 快照约束来规避。
- 每阶段保持可独立回滚边界；本 task 不授权 commit、push 或分支操作。

## 实施前审阅门

- [ ] 用户批准本 task 的最终规划摘要。
- [ ] 用户接受独立 `participant_aggregation_timeline` 推荐方案，或指定替代 owner。
- [ ] 用户确认 accepted Exposure 删除后旧 Projection evidence 的产品语义。
- [x] 用户确认“妊娠实际结束”的事实来源边界，以及未怀孕、妊娠进行中、流产、终止、分娩和未知结果的归档/解锁语义；具体 canonical fact/payload 延后审查 Event Schema、pregnancy_id 关联和持久化边界后再设计。
- [x] 用户确认 lifecycle archive/release capability 与 aggregation lock 使用同一上线门禁；门禁未满足时不启用新 Exposure 过滤或 `updateEvent` 编辑锁。
- [ ] 正式实施父方 UI 前再次提示用户确认暂定 7 Story Day 推荐默认值；规则为最小 1 Story Day、正整数、旧聊天缺省使用默认值、清空恢复默认值。
- [ ] 用户确认父方后续任务依赖本 task 的 aggregation success/provenance，但不把其作为 awareness、father status 或父方调度状态的替代。
- [ ] 用户确认妊娠结束状态仅由 ST 明确事实/Event Analysis 更新，并覆盖未怀孕、进行中、流产、终止、分娩和未知结果。
- [ ] `implement.jsonl` / `check.jsonl` 已有真实 spec/research context。
- [ ] 通过后才允许 `task.py start` 和生产代码修改。

# Phase 1 Read-only Closure Audit

日期：2026-10-06

范围：当前 worktree 的 Character Health v1 factual Event、persisted Assessment、deterministic Evolution、presentation Aggregation、Current Health State、Character Health UI、Recovery Guidance 与 Projection Context。未修改业务代码、测试、spec 或产品文档；未 commit/push。

## Verification executed

- 定向 Health/UI/Projection 测试：120 tests passed。
- 相关模块 `node --check`：通过。
- `git diff --check`：通过。
- 完整 `npm test`：未完成。运行约 3 分钟后无新增输出，手动中止；过程中出现既有的 Floor preflight/World/Host 模拟失败日志，属于本 task 明确排除的无关范围，不能作为 Health closure 证据。

## Audit matrix

| # | 审计项 | 分类 | 证据与结论 |
|---|---|---|---|
| 1 | Event → Assessment 只接受显式 `health_role=observation` | PASS | `core/health-assessment.js:49-73` 只从规范化 factual payload 读取显式 role，并要求 factual Event、subject、source evidence；`runtime/health-assessment.js:46-49` 只处理 eligible；`tests/health-assessment.test.js:110-147` 覆盖 intervention 与缺失 role。 |
| 2 | Assessment 绑定 source Event + 六字段 Floor Version + observation fingerprint | PASS | `core/health-assessment.js:98-112,162-179,209-220`；`runtime/health-assessment.js:49-56,84-92`；`tests/health-assessment.test.js:149-168,250-263` 覆盖复用、编辑、Swipe/version 失效。 |
| 3 | Evolution 只从 surviving authoritative Event、valid Assessment 与 Story Time 派生 | PASS（静态/现有测试） | `runtime/health-evolution.js:6-19` 从每个 Floor state 的 active source-bound Assessment 和 Event 收集；`core/health-evolution.js:76-100` 再次要求 explicit observation 并按 Story Time 派生；`runtime/event-analysis.js:1528-1560,1563-1569,1767-1794` 只把 valid Floor states 传入。真实 Host rebuild 仍需 Phase 2。 |
| 4 | expected recovery boundary 只改变 derived inactive，不产生 persistence mutation | PASS（静态/单元测试） | `core/health-evolution.js:40-46,76-100` 返回 null observation，不写入；`tests/health-evolution.test.js:274-285` 验证 Event/Assessment 输入未改变。Host persistence observation 仍为 NOT PROVEN。 |
| 5 | earliest recovery 不关闭 observation | PASS | `core/health-evolution.js:40-46` 只检查 expected boundary；`tests/health-evolution.test.js:155-177` 覆盖 earliest-only。 |
| 6 | long-term/permanent 不自然过期 | PASS | closure 条件固定为 `short_term && natural_recovery === eligible && expected boundary reached`（`core/health-evolution.js:43-46`）；`tests/health-evolution.test.js:179-194` 与 guidance tests 覆盖大时间跳跃。 |
| 7 | Aggregation 只做 presentation compression，不共享 lifecycle/deadline | PASS | `core/health-aggregation.js:24-71` 只接收 active observations，输出 group/source IDs，不读取或写入 Assessment/deadline/lifecycle；`tests/health-evolution.test.js:64-91,108-137` 覆盖独立 deadline 与压缩显示。 |
| 8 | Severity 只来自 active observation，UI 不重复计算 lifecycle/severity | PASS | `core/health-evolution.js:90-93` 对 active observations 汇总；`core/health-aggregation.js:24-33` 为 presentation summary；`ui/characters.js:389-429` 只读取 `severity_summary`/grouped DTO，不计算 lifecycle。相关 UI 测试通过。 |
| 9 | Guidance 只消费 active observation，inactive 后消失 | PASS（静态/单元测试） | `core/health-recovery-guidance.js:103-136` 只读取 Current Health `active_observations`；inactive 由 Evolution 先移除；`runtime/events.js:1851-1861` 校验 current Floor/version 后消费。真实 Host 消失行为仍留给 Phase 2。 |
| 10 | Guidance 不产生 Event、Assessment 或 write | PASS | `core/health-recovery-guidance.js:123-126` 明确 pure/non-factual；`runtime/events.js:1851-1861` 仅读取并返回 DTO；`core/projection-context.js:89-149` 只组合 context。 |
| 11 | delete/edit/Swipe/version invalidation 后可由 surviving authority 重建 Health State | PASS（代码/现有测试）；Host reload NOT PROVEN | `runtime/event-analysis.js:1528-1569,1767-1794` 重新收集 active Swipe、完整 Floor Version 与 valid states；`runtime/event-editing.js:32-102` CRUD 后刷新 derived path；`activeHealthAssessments()` 过滤 source/Floor/fingerprint；定向测试覆盖 delete/edit/swipe/version binding。真实 ST reload/rebuild 尚未执行。 |
| 12 | intervention 不泄漏；`source_event_id` traceability 成立 | PASS | explicit eligibility 在 `core/health-evolution.js:79-88` 过滤 intervention；Aggregation 保留 source IDs（`core/health-aggregation.js:41-65`）；UI source navigation 校验当前 canonical Event（`ui/characters.js:363-376`）。intervention/guidance/Severity 测试通过。 |
| 13 | 无撤回 trajectory/Condition/freshness/legacy fallback health lifecycle 残留 | PASS（健康路径） | 健康实现中未发现 `trajectory_id`、Condition authority、health freshness/expiry、legacy health-role fallback 或 intervention current-health lifecycle 的有效调用路径；现存 generic generation/world/host `supersede`、adapter `getChatFreshness` 与本 task 无关，未误判为 Health dead code。历史设计文字明确标注 retired/deferred。 |
| 14 | docs/spec 与当前实现一致 | DOC DRIFT | 发现真实不一致，见下节；因此不能归类为 PASS。 |

## PASS

审计项：1、2、3（静态/现有测试）、4（静态/单元测试）、5、6、7、8、9（静态/单元测试）、10、11（代码/现有测试）、12、13。

## CONTRACT GAP

无。当前实现没有发现违反已确认 v1 contract、且已有足够代码/测试证据可确认的业务缺口。

## DEAD CODE

无可确认的 Health-specific dead code。generic `supersede`、`freshness`、`reopen` 等命中属于 Generation、World、Host 或其它领域，不是撤回 Health 模型残留。

## DOC DRIFT

1. 分组 contract 不一致：实现和当前 UI/Development 描述按 `body_site + laterality` 分组（`core/health-aggregation.js:14-20`；`docs/DEVELOPMENT.md:15`；`docs/UI_FRAMEWORK.md:250`），但 `docs/CHARACTER-HEALTH-STATE.md:241-246`、`docs/DATA-MODEL.md:179-182`、`.trellis/spec/domain/event-pipeline.md:493-500` 仍写成包含 `factual kind` 的分组。现有测试明确同 site/laterality 的不同 kind 保持一个 site group（`tests/health-evolution.test.js:108-121`）。
2. Assessment key 文档残留旧建议：`docs/CHARACTER-HEALTH-STATE.md:1212-1216` 和 `1282-1286` 仍描述 `(source_event_id + source_floor_version)`，而当前实现和同一文档后文要求/使用 `(source_event_id, source_floor_version, source_observation_fingerprint)`（`core/health-assessment.js:98-112`；`docs/CHARACTER-HEALTH-STATE.md:1111-1158`、`docs/DATA-MODEL.md:195-200`）。
3. `docs/DATA-MODEL.md:172-174` 仍把 Context/Projection 描述为 `DESIGN / NOT IMPLEMENTED`，但该文档 `188-194` 及实现已记录/实现 Phase 5B Recovery Guidance → `bioweave_projection_context` 的窄范围链路。

这些是文档同步问题，不在本次 Phase 1 业务修复范围内；本阶段未修改文档。

## NOT PROVEN

### 可由静态代码/现有测试继续证明的边界

- Health State 由 valid Floor state 重建，而不是从 Snapshot/cache 读取：代码路径已明确，定向测试已覆盖 source binding；不需要新增抽象。
- inactive 不写回 Event/Assessment：纯函数与输入不可变测试已覆盖，但完整 Host persistence trace 未覆盖。

### 必须留给真实 ST Host Phase 2 的运行时事实

- 使用全新生成 observation 后，真实 Event history、persisted Assessment、Character Health active issue、Severity 与 Guidance 同时出现。
- Story Time 推进到 boundary 前：真实 Host 不重复调用 Assessment AI、不修改 factual Event/Assessment，active/guidance 阶段变化正确且不生成 recovery Event。
- 到达/超过 boundary：真实 Host 保留原 Event 与 Assessment，仅 derived read model inactive，并从 Character Health、severity、Guidance 中消失。
- 刷新/重载 ST 后，inactive 由 Event + Assessment + Story Time 重建，Snapshot/cache 不成为 authority。
- 真实 Host 的 Extension Prompt 更新/清除与 Projection Context reload 行为。

## Phase 2 gate

当前不满足“直接进入 Phase 2 Host acceptance”的条件：虽然没有 CONTRACT GAP，且 Host-only 项已清晰隔离为 NOT PROVEN，但存在上述 DOC DRIFT。按本 task 的 closure gate，必须先完成文档对照/同步或由用户明确接受这些文档差异后，才能进入 Phase 2。

## Code modification decision

本 Phase 1 没有发现需要修改业务代码的问题，因此没有代码修改方案需要实施。最小后续动作是针对列出的三组文档漂移做同步，然后再进行真实 Host acceptance；这不应扩大为 Health 产品功能开发。

## Closure decision

Character Health v1 当前主链暂不能标记为 `CLOSED`：真实 Host acceptance 尚未执行，且存在 DOC DRIFT。当前最准确状态为：**实现/定向测试路径通过；文档一致性未通过；真实 Host recovery 尚未证明。**

## Phase 1.5 document synchronization

已按批准范围只修改以下文档/spec，未修改业务代码：

- `docs/CHARACTER-HEALTH-STATE.md`
  - aggregation identity 改为 `body_site + laterality`；缺失部位使用 source Event ID 的 per-event fallback，并保留 neutral `general` display label。
  - Assessment binding/key 改为 source Event ID + complete six-field Floor Version + observation fingerprint；补充 `reference_story_time` 为 timing context。
- `docs/DATA-MODEL.md`
  - 同步 aggregation、Assessment binding 与 Projection Context / Recovery Guidance 已实现状态。
- `.trellis/spec/domain/event-pipeline.md`
  - 同步 aggregation 与 Recovery Guidance → existing `bioweave_projection_context` 的 non-factual boundary。

Phase 1.5 checks：

- 旧的 two-part Assessment key 描述：已清零。
- 旧的 `body_site + laterality + factual kind` grouping 描述：已清零。
- 将 Projection Context / Health Recovery Guidance 误标为未实现的描述：已清零；generic Health Projection 仍明确保持未实现。
- `git diff --check`：通过。

DOC DRIFT = **RESOLVED**。Phase 2 real-host acceptance 的前置文档条件已满足；尚未开始 Host 测试，Character Health v1 仍不能标记为 `CLOSED`。

## Phase 2 real ST Host recovery acceptance

### Host evidence

使用全新自然语言生成的 observation，不使用旧测试数据。提交的新剧情要求当前角色在搬运重物时出现右手腕短期扭伤，约三天自然恢复。Host 生成了新的剧情消息（用户消息 #87、AI 消息 #88），并在 BioWeave 中显示为新的右手腕身体问题。

Event history 的来源导航可定位到当前事件索引中的右手腕事件，事件正文包含右手腕关节深处扭伤痛楚的 factual observation。Character Health 初始显示 2 项 active issue，其中包括右手腕问题；整体健康状态为异常。

随后提交了 1 天和 3 天的 Story Time 推进请求（用户消息 #89、#90）。截至本次 Host 等待窗口结束，Host 没有生成对应的 AI 回复，页面中可见的 Story Time 尚未推进到可比较的 boundary。普通产品 UI 和当前 dev logs 也没有暴露 Assessment identity、source observation fingerprint 或 Assessment AI 调用计数；因此不凭 UI 文本推断这些内部事实。

### Acceptance matrix

| 阶段 | 验收项 | 分类 | 证据与限制 |
|---|---|---|---|
| A | 新 factual Event 存在并可从 Character Health 导航到来源 | PASS | 新剧情消息已生成；Event history 显示右手腕 factual observation，来源导航成功。 |
| A | `health_role=observation`、persisted Assessment、`short_term`、`natural_recovery=eligible`、expected recovery assessment 与完整 Assessment identity | NOT PROVEN | 当前 Host 产品 UI 未展示这些持久化字段，且没有现成 diagnostics 可证明 Assessment identity/fingerprint。剧情文本和 UI 描述提供语义线索，但不足以替代 persisted read model 证据。 |
| A | Character Health active issue 与 severity | PASS（产品层） | Character Health 显示右手腕 active issue，整体状态为异常；内部精确 severity 数值未在产品 UI 展示。 |
| A | Recovery Guidance 可生成 | NOT PROVEN | 本次 Host 流程尚未获得可核验的 Guidance 展示证据。 |
| B | boundary 前 Event 不变、Assessment 不重复调用、Assessment identity 不变 | NOT PROVEN | 1 天推进请求未得到 Host AI 回复；无 Assessment 调用计数或现成 diagnostics，不能证明 no-repeat。 |
| B | boundary 前 observation 仍 active | PASS（当前可见阶段） | 重新分析后右手腕仍显示为 active issue；但 Story Time 实际未被 Host 响应推进，不能把它当作 elapsed-time 验收。 |
| B | recovery stage/guidance 随 elapsed Story Time 变化，且不生成 recovery Event | NOT PROVEN | Story Time 请求没有形成可比较的 Host 回复；未能进入有效的 elapsed-time 比较。 |
| C | 到达/超过 expected boundary 后 derived observation inactive | NOT PROVEN | Host 未推进到可验证的 expected boundary。 |
| C | Event/Assessment 保留、Character Health/severity/Guidance 消失、不生成 recovery Event、不修改 factual Event | NOT PROVEN | 依赖 C 的 boundary 状态，当前没有运行时证据。 |
| D | reload/rebuild 后 inactive 由 Event + Assessment + Story Time 重建，Snapshot/cache 不成为 authority | NOT PROVEN | 未获得 boundary 后的 inactive 状态，无法验证对应 reload/rebuild 结论。 |
| E | reload、Story Time、UI refresh、derived rebuild 均不重复触发 Assessment AI | NOT PROVEN | 当前没有可观察的 Assessment 调用计数或 diagnostics；不新增业务 diagnostics 以制造 PASS。 |

### Phase 2 conclusion

- CONTRACT GAP：none。
- DOC DRIFT：已在 Phase 1.5 清零。
- 真实 Host acceptance：未完成；保留上述 NOT PROVEN 项。
- 当前 Host blocker：时间推进请求已写入聊天，但没有产生对应 AI 回复，因此无法验证 Story Time elapsed、expected boundary、inactive derived state 及其 reload/rebuild 行为。
- Assessment 是否出现重复调用：NOT PROVEN；没有证据证明发生重复，也没有证据证明没有发生重复。
- reload/rebuild 是否通过：NOT PROVEN；boundary 后的 inactive 状态尚未建立。
- 业务代码修改：无。未增加 lifecycle 语义、diagnostics 或新产品功能。

Character Health v1 不能正式标记为 `CLOSED`。当前状态为：**contract 无缺口、文档已同步、真实 ST Host recovery acceptance 因 Story Time Host 响应未完成而保留 NOT PROVEN。**

## Follow-up read-only contract audit: Host samples A/B

日期：2026-10-06

本轮没有修改业务代码、测试或产品行为；没有为旧数据增加 compatibility、migration、fallback 或 backfill；没有 commit/push。

### 1. Authoritative Event preservation 与 derived Health lifecycle 隔离

#### 静态代码证据

- `core/health-evolution.js:19-46,76-100` 的 lifecycle 计算是纯派生：只读取 Event、Assessment 与 Story Time，expected boundary 命中时返回 `null` observation；没有 Event mutation、Floor patch、delete 或 Event payload write。
- `runtime/health-evolution.js:5-25` 只从当前 valid Floor states 收集 source-bound Assessment 并调用纯 Evolution；没有调用 Event editing 或 persistence API。
- `runtime/health-assessment.js:104-112` 的唯一 Health persistence patch 是 `{health_assessment_timeline: next}`，owner 固定为 `health`；没有写 `events`。
- `storage/floor-persistence-coordinator.js:8-15,358-403` 将 `health` owner 限定为 `health_assessment_timeline`，并在 readback 中检查所有 sibling fields；Event owner 才能写 `events`。Health patch 不会以缺少 sibling 为由用空数据覆盖 Event。
- `runtime/event-analysis.js:1528-1562,1767-1794` 从当前 active Swipe、完整 Floor Version 的 Floor states 重建 `activeEvents` 与 `current_health_state`；Health derived rebuild 不反向改变 canonical Event collection。
- `ui/events.js:303-304,329-348` 的 Events 页面消费 `analysisStatusEvents(..., 'active_events')` 并按 Event status 过滤，没有读取 `current_health_state`、active observation 或 recovery status；不存在“Health inactive 即从 Events 页面隐藏”的过滤路径。
- `runtime/event-editing.js:32-102` 是明确的 Event edit/delete mutation path，独立于 Health lifecycle；这也是合法移除 Event 的唯一相关入口之一。

静态结论：**PASS**。当前没有发现 Health inactive → Event delete/hide、Health Assessment 覆盖 sibling Event、或 derived rebuild 覆盖 canonical Event 的路径。

#### 当前 Host 证据

当前真实 Host 的高级诊断对应 Floor：`message_id=88`、`floor=88`、`swipe_id=0`，并显示 `floor_version_match=true`。Health persistence 的诊断序列显示：

- `owner=health`、`operation_type=health-assessment-persist`；
- `FLOOR_TX_READBACK` 为 `after_presence.events_present=true` 与 `health_assessment_timeline_present=true`；
- `FLOOR_TX_SIBLING_AUDIT` 的 `missing_owner_fields=[]`、`missing_siblings=[]`；
- `FLOOR_TX_CONFIRMED` 后仍为 `events_present=true`；
- 后续 canonical read 仍报告 `event_count=10`、`source=authoritative_floor`、`ready=true`。

全局 Events 页面当前显示 10 条 Event，其中两条 `身体症状` Event 均仍存在并可展开：

- 右肩旧伤在重压下产生拉扯痛楚；
- 右手腕关节出现明确扭伤痛楚。

因此，本次可观察 Host 状态证明了 **Health write 没有删除或清空 Event slot**，分类为 **PASS**。

“曾经在 Character Health 出现、后来 Character Health 与 Events 页面都看不到”的具体样本，在当前可读取的 Floor 88 / active Swipe 0 中无法被复现：对应的两个 bodily Event 仍在全局 Events 页面。当前不能判断它历史上属于 A、B、C 中哪一种，也没有证据支持 Health lifecycle 或 persistence corruption；该具体样本分类为 **NOT PROVEN（当前 Host 证据不足）**，不是 BUG。

同时，Character 页面人物卡的“6 条相关事件”与全局 Events 页的“10 条事件索引”不是同一个 presentation read model；不能用人物卡缺少某条 Event 推导 canonical Event 已删除。

### 2. Persisted Assessment 驱动的 observation lifecycle

#### 静态 contract

`core/health-assessment.js:77-112,121-179,209-220` 要求并校验：

- `source_event_id`；
- complete six-field `source_floor_version`；
- `source_observation_fingerprint`；
- `reference_story_time`；
- `persistence`、`natural_recovery`、`earliest_recovery`、`expected_recovery`、`severity`；
- `assessment_id`、`request_key` 与完整 source binding validity。

`activeHealthAssessments()` 同时要求 source Event、Assessment Floor Version、当前 Floor Version 与 fingerprint 全部匹配。`core/health-evolution.js:19-46` 只在 `short_term + eligible + comparable expected boundary reached` 时返回 inactive；earliest boundary 不参与关闭；long-term/permanent、not eligible、缺失 boundary 或不可比较 Story Time 均保持 active/unresolved。每个 Event 通过自己的 Assessment 进入 `assessmentByEvent()`，没有共享 deadline 或 lifecycle。

分类：**PASS**。

#### Host 样本 A/B 的可证明程度

当前 Host UI 显示右肩与右手腕两个 health observations 均仍在 Character Health；全局 Events 页面也显示其 factual Events。当前诊断只显示 Assessment accepted/failed 阶段与 persistence/readback presence，不展示逐条 Assessment 的 `source_event_id`、fingerprint、`persistence`、`natural_recovery`、`expected_recovery` 或 reference/current Story Time，因此：

- 样本 A“已经 inactive”的前提在当前 Host 状态中没有可核验的对应 Event/Assessment；不能凭“某 UI 消失”推断它跨过 expected boundary；分类 **NOT PROVEN**。
- 样本 B“仍 active”的当前 UI 结果可见，但缺少 persisted Assessment 字段，无法解释为 short-term/long-term/permanent/not-eligible 中哪一种；分类 **NOT PROVEN**。
- 当前未获得可比较 current Story Time 与每条 Assessment expected boundary，因此不能给出准确的下一次 Host 推进时间。任何“再推进 N 天”的建议都会是基于自然语言的猜测，违反本审计要求。

这不是对 Evolution 规则的反例，也不是确认 BUG；是 Host observability 不足。

### 3. Assessment reuse / no-repeat

#### 静态 contract

`runtime/health-assessment.js:18-33,44-60` 以 `source_event_id + complete Floor Version + source_observation_fingerprint` 生成 request key；已有且 valid 的 Assessment 直接返回并发出 `HEALTH_ASSESSMENT_REUSED`，只有 fingerprint 或 source identity 变化才进入 AI request。`core/health-evolution.js` 与 `core/health-recovery-guidance.js` 都不持有 analyzer 或 persistence seam。

分类：**PASS（静态 contract）**。

#### Host evidence

现有 Host diagnostics 能显示 Assessment accepted/failed 阶段以及 Floor readback，但没有可靠的逐 source invocation count，也没有展示 reuse request key。UI refresh、derived rebuild 和 reload 的 no-repeat 不能从当前证据逐一确认。

分类：**NOT PROVEN（real Host）**。本轮不增加 diagnostics；如果后续确需证明，最小方案应是 observation-only 的 request-key / reused-vs-AI-call 计数，不改变 lifecycle 或 persistence 语义。

### 4. 更广泛同类风险审计

| 检查项 | 分类 | 证据 |
|---|---|---|
| 任意 inactive observation 保留历史 Event | PASS（静态） | Evolution 无写路径；Events UI 按 `active_events`/Event status，不按 Health lifecycle 过滤。 |
| 独立 observations 不互相关闭 | PASS | `assessmentByEvent()` 按 source Event 绑定；closed 只由当前 observation 自己的 Assessment boundary 决定；Aggregation 只读取 active observations。 |
| Aggregation 纯 presentation | PASS | `core/health-aggregation.js:24-71` 不读写 Assessment/deadline/lifecycle。 |
| Guidance 只消费 derived state | PASS | `core/health-recovery-guidance.js:124-136` 与 `runtime/events.js:1851-1861` 无 Event/Assessment write。 |
| Health Assessment write 严格 Floor-owned | PASS | health owner 仅允许 `health_assessment_timeline`，readback/sibling audit 已在 Host 通过。 |
| Health runtime hooks 保持窄编排 | PASS | `runtime/health-assessment.js`、`runtime/health-evolution.js` 仅协调已有 core、Floor persistence 与 derived path。 |
| Health Manager / God module / generic runtime 新增 Health business rule | PASS | 未发现新的集中式 Health Manager；规则位于 health core，runtime 仅编排。 |
| Snapshot / Projection / Current Health State 反向成为 factual authority | PASS | Current Health 从 valid Floor Event + Assessment + Story Time 重建；Projection/Guidance 只读 derived state；Health write 不写 Event。 |

### Follow-up audit classification

- PASS：authoritative Event preservation contract；Health owner sibling preservation；Events UI 不按 Health inactive 过滤；persisted Assessment-driven Evolution 静态规则；独立 observation lifecycle；Aggregation/Guidance authority boundary；Health runtime ownership boundary；Snapshot/Projection 非 factual authority。
- CONTRACT GAP：无确认项。
- BUG：无确认项。
- DOC DRIFT：本轮未发现新的真实文档漂移；Phase 1.5 已清零的三组 drift 保持 resolved。
- NOT PROVEN：具体“Health 与 Events 同时消失”历史样本的原因；样本 A/B 的逐条 persisted Assessment 与 boundary 解释；Host no-repeat 的实际调用次数。

### Code modification decision

本轮没有确认 BUG 或 CONTRACT GAP，不修改业务代码，不增加兼容/迁移/fallback/backfill，也不增加 diagnostics 实现。Character Health v1 仍不能标记为 `CLOSED`，因为上述 Host NOT PROVEN 项仍未清零。

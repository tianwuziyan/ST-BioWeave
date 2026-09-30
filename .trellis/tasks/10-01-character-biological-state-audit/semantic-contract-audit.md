# Current Biological State Semantic Contract 审计

本文件记录当前代码、测试和当前权威文档之间的语义证据。以下冻结决策已获产品确认，并作为本 task 的 implementation contract；不授权修改其它领域。

## 0. Frozen semantic contract

- Confirmed `conception` is not confirmed pregnancy. It may create a Pregnancy
  Episode with status `unknown`, records `conception_event_ids`, and updates the
  conception summary. It never performs `unknown → suspected/confirmed`.
- Only a `confirmed` Event may transition factual Episode status. `probable` and
  `ambiguous` Events remain history and may write uncertain records/IDs, but may
  not upgrade, downgrade, or reactivate an Episode. `negated` and `fictional`
  Events do not modify factual state.
- An ended Episode may receive a historical conception Event, but remains ended.
- `labor` is an independent factual Event. It records `labor_event_ids` and is
  not pregnancy confirmation, delivery, or termination.
- `postpartum` is an independent factual Event. It may be recorded without a
  prior delivery/loss/abortion Event and does not infer delivery, termination,
  confirmation, or Episode closure.
- A valid labor/postpartum Event is retained even when lifecycle history is
  incomplete. No reality-based missing Event is manufactured and no new
  lifecycle diagnostic system is added in this patch.

The implementation boundary is limited to the uncertain branches of
`pregnancy_suspicion` and `pregnancy_confirmation`, plus regression tests and
the closest canonical Event domain documentation. Conception, labor, postpartum,
Snapshot architecture, UI, Tracking, Registry, Projection, and other out-of-
scope domains retain their existing behavior.

## 1. 证据范围

- `core/state.js`: `reduceState()`, `applyStateFact()`, `refreshPregnancyDerived()`。
- `core/events.js`: `EVENT_TYPES`, `EVENT_STATUS`, `validateStateFactPayload()`, `validateEvent()`。
- `runtime/event-analysis.js`: `buildCharacterFacts()`, `restoreStateFromNearestSnapshot()`, `collectCurrentDerivedState()`, `getCurrentBiologicalState()`。
- `tests/state.test.js`, `tests/events.test.js`, `tests/snapshot.test.js`。
- `docs/DATA-MODEL.md`, `.trellis/spec/domain/event-pipeline.md`, `.trellis/spec/domain/floor-state.md`, `.trellis/spec/domain/pregnancy-tracking.md`。

目标测试：`node --test tests/state.test.js tests/events.test.js tests/snapshot.test.js`，60 passed，0 failed；`node --test tests/event-analysis-runtime.test.js`，195 passed，0 failed。

## 2. 当前 Episode 状态机

当前 reducer 允许的 Episode 状态值为 `unknown | suspected | confirmed | ended`。

| Transition | 当前实际触发源 | 当前实际行为 |
| --- | --- | --- |
| `unknown → suspected` | `pregnancy_suspicion` confirmed | 有 `pregnancy_id` 时创建/保留 Episode 并设为 `suspected` |
| `unknown → confirmed` | `pregnancy_confirmation` `confirmed` | 创建缺失 Episode 并设为 `confirmed` |
| `unknown → ended` | `pregnancy_loss`、`abortion`、`delivery` `confirmed` | 创建缺失 Episode 并设为 `ended`；无确认事实时加 diagnostic |
| `suspected → confirmed` | `pregnancy_confirmation` `confirmed` | 设为 `confirmed` |
| `suspected → ended` | `pregnancy_loss`、`abortion`、`delivery` `confirmed` | 设为 `ended` |
| `confirmed → ended` | `pregnancy_loss`、`abortion`、`delivery` `confirmed` | 设为 `ended`，保留历史 Event ID |
| `ended → ?` | 普通 confirmation 不重新激活；重复 termination/delivery 产生 conflict diagnostic；labor/postpartum/conception 不改变 Episode status | 没有合法重新激活 transition |

`reproductive_source_attribution` 不创建 Episode；只操作已有 Episode。

## 3. Event → State Transition Matrix（当前代码行为）

| Event type | Event status | Create episode | Status transition | End episode | Other mutation | Missing `pregnancy_id` | Existing ended episode | Conflict behavior |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `sexual_activity` | confirmed/probable/ambiguous | No | No | No | 写入 exposure；probable/ambiguous 进入 unresolved records | 不适用 | 不适用 | 无 Episode conflict |
| `sexual_activity` | negated/fictional | No | No | No | 保留 activity history，不写 exposure | 不适用 | 不适用 | 无 diagnostic |
| `conception` | confirmed | Yes（`episodeFor`） | Episode 保持 `unknown`；独立 `conception.status=confirmed` | No | `conception_event_ids`、`confirmed_event_ids`、`pregnancy_ids` | schema/validator 拒绝；直接 reducer 输入会产生无效事实 diagnostic | 保留 ended，不重新激活，但仍可记录 conception ID | 当前无专门 conflict diagnostic |
| `conception` | probable/ambiguous | Yes | Episode 保持 `unknown`；`conception.status` 至少为 `suspected` | No | `uncertain_event_ids` | schema/validator 拒绝 | 不重新激活 | 当前无专门 conflict diagnostic |
| `conception` | negated/fictional | `applyStateFact` 忽略 | No | No | 仅 activity history | schema/validator 拒绝 | 不修改 Episode | 无 diagnostic |
| `pregnancy_suspicion` | confirmed | Yes（有 ID） | `unknown → suspected` | No | `suspicion_event_ids` | validator 允许缺失；reducer 加 `unresolved_pregnancy_suspicion`，不创建 Episode | 保持 ended | 缺 ID diagnostic |
| `pregnancy_suspicion` | probable/ambiguous | Yes（有 ID） | 不改变 status | No | `uncertain_event_ids` | 同上 | 保持 ended | 当前无 uncertain-transition diagnostic |
| `pregnancy_confirmation` | confirmed | Yes | `unknown/suspected → confirmed` | No | `confirmation_event_ids` | validator 拒绝 | 保持 ended，加入 `pregnancy_episode_conflict` | confirmation-after-termination diagnostic |
| `pregnancy_confirmation` | probable/ambiguous | Yes | 不改变 status | No | `uncertain_event_ids` | validator 拒绝 | 保持 ended，当前仍记录 uncertain ID | 未定义为 conflict |
| `pregnancy_confirmation` | negated/fictional | No | No | No | 仅 activity history | validator 拒绝 | 不修改 | 无 diagnostic |
| `pregnancy_loss` / `abortion` | confirmed | Yes | `unknown/suspected/confirmed → ended` | Yes | `termination_event_ids` | validator 拒绝 | 重复 termination diagnostic | `repeated_termination` |
| `pregnancy_loss` / `abortion` | probable/ambiguous | Yes | 保持 `unknown` 或原 status | No | `uncertain_event_ids` | validator 拒绝 | 保持 ended | 当前无 uncertain conflict |
| `pregnancy_loss` / `abortion` | negated/fictional | No | No | No | 仅 activity history | validator 拒绝 | 不修改 | 无 diagnostic |
| `labor` | confirmed | Yes | 不改变 status | No | `labor_event_ids` | validator 拒绝 | 仍可追加 labor ID，无 conflict | 无自动 delivery |
| `labor` | probable/ambiguous | Yes | 不改变 status | No | `uncertain_event_ids` | validator 拒绝 | 保持 ended | 无 diagnostic |
| `labor` | negated/fictional | No | No | No | 仅 activity history | validator 拒绝 | 不修改 | 无 diagnostic |
| `delivery` | confirmed | Yes | `unknown/suspected/confirmed → ended` | Yes | `delivery_event_ids` | validator 拒绝 | `pregnancy_episode_conflict` | 无确认事实时加 termination diagnostic |
| `delivery` | probable/ambiguous | Yes | 不改变 status | No | `uncertain_event_ids` | validator 拒绝 | 保持 ended | 无 diagnostic |
| `delivery` | negated/fictional | No | No | No | 仅 activity history | validator 拒绝 | 不修改 | 无 diagnostic |
| `postpartum` | confirmed | Yes（仅建立 postpartum record） | 不改变 Episode status | No | `postpartum.episodes`、`factual_event_ids` | validator 拒绝 | 仍可记录 postpartum | 无 diagnostic |
| `postpartum` | probable/ambiguous | Yes（仅建立 record） | 不改变 Episode status | No | postpartum uncertain record | validator 拒绝 | 仍可记录 postpartum | 无 diagnostic |
| `postpartum` | negated/fictional | No | No | No | 仅 activity history | validator 拒绝 | 不修改 | 无 diagnostic |
| `reproductive_source_attribution` | confirmed | No | No | No | 写入已有 Episode 的 confirmed/excluded contributors | validator 拒绝 | 当前允许操作已有 ended Episode | opposite relationship 产生 conflict，fail-closed |
| `reproductive_source_attribution` | probable/ambiguous | No | No | No | 不写 contributor，不写 uncertain attribution ID | validator 接受 | 不修改 | 无 diagnostic |
| `reproductive_source_attribution` | negated/fictional | No | No | No | `applyStateFact` 忽略 | validator 接受 | 不修改 | 无 diagnostic |

## 4. 三个 PARTIAL 的分类

### conception — `INTENTIONALLY_PARTIAL`

代码明确区分 conception summary 与 Pregnancy Episode：confirmed conception
会把 `conception.status` 设为 `confirmed`，但不会把 Episode 设为 confirmed，且
Episode 以 `unknown` 创建。冻结 contract 进一步确认 ended Episode 可以追加
conception historical fact，但不得重新激活。

### labor — `INTENTIONALLY_PARTIAL`

当前测试明确断言 “labor does not deliver”。当前 code 只记录
`labor_event_ids`，不确认、不结束 Episode；现有 canonical 文档没有要求 labor
自动触发 delivery。当前行为符合 `labor != delivery` 的保守边界。

### postpartum — `INTENTIONALLY_PARTIAL`

当前测试明确断言 postpartum 只有显式 Event 才形成 factual record；code 只建立
postpartum record，不改变 Episode lifecycle。现有文档没有要求 postpartum 自动
推断 delivery、loss、abortion 或结束 Episode。当前行为符合不使用现实医学常识补事实的边界。

## 5. Event status semantics

| Status | 当前 State 作用 |
| --- | --- |
| `confirmed` | 可写入 factual records；特定 Event 可推进/结束 Episode；attribution 可写 confirmed/excluded contributors |
| `probable` | 保留 Event 与 activity；state facts 写 `uncertain_event_ids` 或 uncertain records，不改变 factual Episode status |
| `ambiguous` | 与 probable 相同的 reducer 分支 |
| `negated` | 不写 factual state；仍进入 `processed_event_ids` / activity history |
| `fictional` | 不写 factual state；仍进入 `processed_event_ids` / activity history |

实现后的语义遵守 frozen contract：probable/ambiguous suspicion/
confirmation 只能记录 uncertain state/history，不得改变 Episode status。

## 6. Reducer invariants

| Invariant | 结果 | 证据/说明 |
| --- | --- | --- |
| exposure 不自动创建 conception | SATISFIED | `possible_conception` 无 state_fact；state test |
| exposure 不自动创建 pregnancy | SATISFIED | exposure test 保持 pregnancy unknown |
| conception 不等价于 confirmation | SATISFIED（当前行为） | conception 只改 summary，Episode 不确认 |
| missing attribution 不猜 contributor | SATISFIED | orphan attribution diagnostic；state test |
| ended episode 不被普通 confirmation 重新激活 | SATISFIED | `confirmation_after_termination` |
| delivery/loss/abortion 保留 episode history | SATISFIED | termination/delivery IDs 保留 |
| uncertain Event 不升级 factual state | VIOLATED / CONTRACT UNCLEAR | probable/ambiguous suspicion/confirmation 当前可设 Episode 为 suspected |
| fictional/negated 不修改 factual state | SATISFIED | `IGNORED_STATUSES`；state test |
| Story Time 不制造 Event | SATISFIED | `refreshExposureDerived` 只算 elapsed |
| Story Time 不制造 pregnancy | SATISFIED | Runtime/state tests |
| Snapshot restore 与 full replay 等价 | SATISFIED | snapshot test；包含 Current State DTO 的全部字段 |
| Event 删除后 derived state 可 replay 消失 | SATISFIED | Runtime event edit/delete tests |
| reducer 不以现实常识补事实 | SATISFIED | 仅按 Event type/status/payload 分支 |
| UI 不参与状态推导 | SATISFIED | UI 消费 `currentState.characters[id]` |

## 7. Contributor Attribution

当前 invariant 保持正确：

- 只消费 `reproductive_source_attribution`；不从 exposure、时间或 biological type 猜 contributor。
- 需要已有 `pregnancy.episodes[pregnancy_id]`；缺失只写 `unresolved_reproductive_source_attribution` diagnostic。
- 只接受 Event status `confirmed`；probable/ambiguous/negated/fictional 不写 contributor。
- confirmed/excluded 同一 relationship 冲突时移入 `conflicts` 并 fail-closed。
- 不创建 pregnancy、conception 或 Episode。

当前唯一边界疑问是：代码允许对已经 `ended` 的已有 Episode 追加 attribution；当前规范没有明确禁止，因此不能擅自判为 bug。

## 8. Character Facts blocker

`buildCharacterFacts()` 输出 identity、species、biological_type、六项 tri-state
capabilities 和空 `resolved_mechanism_facts`，并从 active Events 补充参与人物。
这足以支持 reducer、Episode、Current State 和 Characters UI。Episode facts 本身
来自 Event replay，不依赖新的 profile storage root。

结论：**NO CHARACTER PROFILE PERSISTENCE CHANGE REQUIRED**。

## 9. Snapshot equivalence

任何后续 semantic correction 都必须同时满足：

```text
reduceState(full events)
=== restore(snapshot) + reduceState(later events)
```

至少保持以下字段等价：Episode status、conception/suspicion/confirmation/
termination/labor/delivery/postpartum Event IDs、contributors、uncertain IDs、
diagnostics，以及 derived active/current status。当前 Snapshot 测试已覆盖通用
deep-equal replay；尚未为每一种 Episode transition 单独建立矩阵化测试。

## 10. UI downstream impact

Characters UI 已消费 `currentState.characters[character_id]`，并由
`ui/character-state.js` 展示 Episode status、confirmation/termination/delivery/
labor IDs、conception summary、postpartum/symptom/medical counts 和 diagnostics。
只要 semantic correction 保持 Current State DTO 字段兼容，结论为：

**NO UI CHANGE REQUIRED**。

## 11. DOC/CODE/TEST CONTRACT MISMATCH

存在局部而非完整的 mismatch：

1. `docs/DATA-MODEL.md` / `.trellis/spec/domain/event-pipeline.md` 明确
   `possible_conception` 不创建 conception fact，且 negated/fictional 不改变
   factual state；代码和测试一致。
2. 同一文档只笼统说明 Episode 由 conception/suspicion/confirmation 等事实归约，
   没有定义 conception 对 Episode status 的确切 transition；代码保留 Episode
   `unknown`，测试只断言 conception summary。冻结决策已将其分类为
   `INTENTIONALLY_PARTIAL`。
3. labor/postpartum 的“不自动推进 lifecycle”由代码和测试支持，当前文档也未要求
   相反 transition；暂不构成 mismatch。

## 12. Frozen decision resolution

上述决策现已冻结。本轮实现完成后，剩余未决问题仅限于未来未授权的其它
Episode/lifecycle 语义，不在本 patch 中扩张。

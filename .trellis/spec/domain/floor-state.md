# Floor State Ownership Contract

This is the single detailed contract for Floor ownership, lifecycle,
previous-state resolution, derived-state invalidation, and API provenance in
BioWeave. Domain documents may link here, but must not define a competing
history or ownership model.

The data flow is intentionally one-way:

```text
current Character/assistant message + its active Swipe
  -> authoritative BioWeave Floor Version
  -> Floor/Swipe analysis, Events, and cumulative canonical identity snapshot
  -> current valid Floor facts
  -> derived runtime state, registries, UI model, and API context
```

Projection generation follows the same owner boundary but is transient until a
later persistence wave: its context upper bound is the current valid Character
Floor and active Swipe, never a latest User message.
Non-factual pre-confirmation storyline candidates and progress use the same
Floor-owned complete snapshot boundary; they are generated only after settle
and never become Event facts. Every generated result carries the complete Floor
Version, Chat scope, rule binding and Eligibility context;
owner changes invalidate the result before any future persistence step.

The contract applies to storage, Floor/version code, analysis, Events,
tracking, registries, character state, World Model state, API context, and any
new disease, medication, reproduction, exposure, or other cross-Floor state.

API context presentation has a separate pure boundary: `ai/input-builder.js`
collects and normalizes permitted sources, while `ai/prompt-context.js` renders
those normalized DTOs into reusable model-facing content. Its
`formatPromptContextContent()` entry returns only the standardized body;
task prompt builders own section titles, purpose text, message roles, grouping,
and task instructions. The latter must not read Floor/Storage/Host or alter
provenance. Task prompt builders may select source kinds and variants, but may
not duplicate source field formatting or internal-ID filtering. This
presentation rule does not change Floor ownership, previous-endpoint
resolution, or the causal input boundary below.

The presentation contract is also responsible for empty-content behavior:
`formatPromptContextContent()` omits empty arrays, objects, and nested fields;
semantic `false`, `0`, and non-empty strings remain visible. An optional source
that renders to an empty string may be omitted by its caller together with the
caller-owned title and purpose. There is no complete-block compatibility
wrapper; all callers use the content entry directly and own any surrounding
section text.

### Prompt Context content-port contract

#### 1. Scope / Trigger

- Trigger: World/Event/Health Assessment/Storyline 共用资料呈现边界已从“完整区块”修正为“统一正文端口”，避免调用方拆包重包或重复实现字段格式。
- Scope: 只约束 normalized DTO 的纯计算呈现；不改变 AnalysisInput 收集、Floor/Swipe ownership、API assignment、事实 Event 或持久化。

#### 2. Signatures

- `formatPromptContextContent({kind, value, names, variant, empty}) -> string`：生产调用的统一正文入口。
- `composePromptMessages({systemTop, groups, user, systemBottom}) -> Array<{role, content}>`：只负责 role/group 与首尾 SYSTEM 布局。

#### 3. Contracts

- `formatPromptContextContent()` 只返回字段投影、中文字段标签、列表/嵌套和来源筛选后的正文；不得返回场景标题、用途说明、消息角色或任务要求。
- 生产 task builder 负责标题、用途说明、消息角色、SYSTEM/ASSISTANT/USER 分组和任务要求；同一资料不得在调用方复制字段标签、ID 过滤或列表格式。
- `kind` 与 `variant` 使用 `ai/prompt-context.js` 的受控白名单。Event 只能请求 `event_reference`、`event_identity_registry`、`event_character_profiles` 和 `event_existing_events` 这些 semantic kinds，不得恢复 raw Character/Persona/Worldbook/External Memory DTO。
- ID/credential-shaped 内部字段不得进入正文；有语义的 `false`、`0` 和非空字符串必须保留；空正文由调用方决定是否省略其自有标题和用途。

#### 4. Validation & Error Matrix

- 未知 `kind` → `PROMPT_CONTEXT_KIND_UNSUPPORTED`。
- `kind` 不支持 `variant` → `PROMPT_CONTEXT_VARIANT_UNSUPPORTED`。
- `composePromptMessages()` 收到非法 role/group → `PROMPT_CONTEXT_LAYOUT_INVALID`。
- 不存在返回标题/用途的公共兼容包装器；调用方必须直接消费正文端口。

#### 5. Good / Base / Bad Cases

- Good: 调用方取得 `formatPromptContextContent({kind: 'character_profile', ...})`，再自行拼接 `【人物资料】`、用途说明并放入 USER。
- Base: 可选资料正文为空时，调用方连同自己的标题和用途一起省略；其它 SYSTEM/USER 顺序不变。
- Bad: 先取得一个“标题+用途+正文”的完整区块，再用正则拆掉外层后重新包装；或把 `JSON.stringify(analysisInput)` 放入 USER。

#### 6. Tests Required

- `tests/prompt-context.test.js`：正文入口不包含 `【标题】`/“本段用途”，ID 过滤、中文字段、嵌套列表、空值和错误矩阵。
- `tests/context-prompt.test.js`、`tests/event-analysis.test.js`、`tests/health-assessment.test.js`：World/Event/Health 最终 messages 仍有调用方拥有的标题/用途，且 Event 保持 semantic projection。
- `tests/projection-storyline.test.js`：Storyline SYSTEM 1/2、ASSISTANT、USER 顺序与标题/用途保持；继续排除 Worldbook 和 raw DTO。

#### 7. Wrong vs Correct

**Wrong**

```js
const legacyBlock = getCompletePromptBlock({kind: 'character_profile', value})
const content = legacyBlock.replace(/^【人物资料】[\\s\\S]*?\n/u, '')
return content ? ['【人物资料】', '调用方自己的用途说明。', content].join('\n') : ''
```

**Correct**

```js
const content = formatPromptContextContent({kind: 'character_profile', value, variant: 'storyline_design', empty: ''})
return content
  ? promptBlock`
      【人物资料】
      调用方自己的用途说明。
      ${content}
    `
  : ''
```

这里的 `promptBlock` 仅表示调用模块已有的多行文本 tagged helper（或等价的
dedent helper），不是 `ai/prompt-context.js` 提供的公共 API。它负责保留最终正文、
去除源码缩进并处理插值；调用方仍然拥有标题、用途说明和消息角色布局。

#### 8. 多行 Prompt 文本书写约定

- 规则、用途说明、任务要求、JSON 输出协议、参考资料区块等包含多行自然语言的
  Prompt 文本，必须使用一个有明确起止的多行模板/标签包容；中间内容应能直接粘贴，
  动态资料通过 `${...}` 插值进入。
- 禁止把同一段长文本拆成大量逐行 quoted strings，再通过 `.join('\n')` 拼接。这种
  写法容易漏行、误改引号或产生重复包装，是本规范明确禁止的旧语义。
- `map/join` 仍可用于真正的动态列表或结构化数据（例如根据资料条目生成列表）；
  不得把静态 Prompt prose 当作结构化列表来编码。
- 改写多行 Prompt 后，必须用最终 `messages[]` 做回归断言，至少检查正文内容、源码
  缩进清理、空白/换行、消息顺序以及动态插值均保持正确。

The persisted Projection timeline uses the exact same Floor/Swipe owner slot as
other Floor data. Its `creations`, `evidence_records`, `lifecycle_records`,
`observation_records`, and `triggered_snapshots` are append-only roots under
`projection_timeline`; later Floors never mutate an earlier creation.
Storyline response receipts remain append-only, while a storyline submission
receipt occupies one current-Floor slot per `subject_id` and exact six-field
`created_at_floor_version`: a changed submission replaces that slot, and an
exact repeat is deduped. Historical Floors and response receipts are preserved.
A read must first resolve surviving Character Floors and their
active Swipe, verify each current six-field Floor Version, then aggregate the
timeline in Character Floor order. User messages, Chat metadata, inactive Swipes,
and stale versions are never fallback sources.
`triggered_snapshots` is the complete per-subject current-Floor triggered
history. Stage transitions persist cumulative triggered entries, while an
ended observation round persists an explicit empty terminal snapshot; the
latest valid snapshot is used directly by product reads and rollback. The
`triggered_snapshot_complete` marker distinguishes an explicit empty complete
batch from a legacy Floor that has no snapshot collection; product reads select
one nearest complete batch and never merge subjects from different complete
Floors.
When the Projection DTO is rebuilt, a current active triggered snapshot may
preserve `observed_reaction.matched` even if the derived Event list is
temporarily unavailable, but only when both `projection_id` and the resolved
`reaction_concept` match exactly. An unresolved or different reaction concept
fails closed and must not inherit another reaction's badge.
Each new subject snapshot may carry the compact `stage_code` (`1-1`, `1-2`,
`1-3` for the current pre-confirmation stages), independently of `status`;
the code is part of deterministic snapshot identity. Legacy snapshots without
the code may be read compatibly only when the same timeline's historical
built-in Projection branch identifies it; current-stage filtering is not a
valid compatibility source and legacy Floors are never rewritten.

Built-in pre-confirmation creations are complete Story Time stage snapshots.
Their snapshot identity is `subject_id + pregnancy_id|null + cycle_id`;
mechanism metadata does not split one subject's four branches into separate
stage snapshots. For each identity, the endpoint read selects the latest valid
Character Floor containing a complete four-branch stage snapshot and excludes
earlier stages from the product view. For legacy timelines, the resolver may
reconstruct that complete snapshot from the latest valid records for the same
identity and stage across multiple Character Floors; it never mixes cycle,
pregnancy, or stage identities. Stage selection is monotonic in the built-in
schedule: a late legacy branch from an older stage cannot regress a newer
complete stage; within one stage, the latest complete snapshot wins. Thus Floor 20 may own `[A]` and Floor 26
may own `[B]`; the endpoint at 26 returns only `[B]`, while an endpoint at 23
returns only `[A]`. A stage change appends only the new complete creation and
evidence batch to the current Floor: it does not append a synthetic `deleted`
or `expired` lifecycle record for the old stage. Factual lifecycle and user
deletion records retain their existing replay semantics.
Delivery replay is a separate historical read: it validates references against
surviving Floor creations, not the current product view, so an earlier-stage
submission or response remains available for timeout/observation processing
without re-exposing that creation as a current Projection.

### Pre-confirmation storyline complete-snapshot contract

#### 1. Scope / Trigger

This contract applies after a settled Character Floor has an active triggered
Projection subject. It covers storyline design, context delivery, two-response
selection/progression cadence, factual termination, and endpoint rollback. The
storyline is non-factual guidance; only the Event pipeline may establish a
pregnancy or not-pregnant fact.

#### 2. Signatures

```js
createProjectionStorylineRuntime({
  analyzer,
  getProjectionViews,
  saveProjectionStorylineSnapshotBatch,
  saveProjectionStorylineDelivery,
  readStoryBodyByFloorVersion,
  archiveAndReleasePregnancy,
  resolveCurrentFloor,
  requestSettingsResolver,
})

storylineRuntime.settled({
  inputs,
  responseId,
  settled: true,
  generation,
})

saveProjectionStorylineSnapshotBatch({
  chatId,
  ownerFloor,
  floorVersion,
  snapshots,
  traceContext,
})

recordStorylineTrace({
  stage,
  floor_version,
  phase,
  status,
  message_summary?,
  response?,
  io?,
})

getStorylineDiagnostics({chat_id?, floor_version?})
```

`snapshots` contains one or more changed subject snapshots. Storage overlays
them on the nearest earlier complete collection, restamps every retained
subject to the current six-field Floor Version, and writes one complete current
Floor collection. Product reads use the nearest valid
`storyline_snapshot_complete=true` collection at or before the endpoint.
After the Coordinator confirms the owner-scoped save and authoritative Floor
readback, Storage returns that complete timeline to Runtime for the immediate
logical comparison. Runtime must not reject a confirmed write merely because
the host's ordinary in-memory projection view has not caught up yet; later
product reads still use the normal valid-Floor projection view.

#### 3. Contracts

- `candidates` contains exactly three branches; each branch has three to five
  ordered nodes, every node has non-empty `title`, `objective`, and
  `completion_signal`, and the branch has one `conclusion_goal`. `selected`
  contains exactly one of those branches. `terminated` contains no branches
  and is an authoritative tombstone that prevents earlier state from reviving.
- At the settled boundary, the active `triggered_snapshots` are read from the
  current Floor, while the existence check that decides whether candidate
  design is needed reads the previous endpoint (`floor.index - 1`) and never
  treats an old snapshot already written to the current Floor as a reason to
  skip design. Design/readback still writes to the current Floor; a repeated
  analysis of that same Floor replaces only the target subject in the complete
  current collection and preserves all siblings. Factual closure, response
  counting, and branch progression continue from the latest current-endpoint
  snapshot; the previous-endpoint read is not a substitute for current state.
- `subject_id` is the only storyline snapshot ownership key within a Chat.
  `created_at_floor_version` records the current Floor/Swipe provenance of the
  stored copy and remains part of stale-owner validation; it is not a
  storyline business identity. Reads use the nearest valid complete snapshot
  as a logical baseline. When that state changes, the complete subject
  collection is rebound and written to the current Floor, leaving historical
  Floors unchanged. Judge attempts retain their own `due_attempt_id` and are
  derived from the logical storyline state rather than a Floor-sensitive
  snapshot ID.
- A response counts only when a prior valid Floor has a matching storyline
  submission receipt. Exactly two distinct valid responses make a judge due.
  Judge failure keeps the same two response IDs and `due_attempt_id`; a third
  response is not counted while that attempt remains due.
- A Judge retry is keyed by `chat_id + subject_id + due_attempt_id`. The same
  key is single-flight while its API request is pending. Once a request has
  failed, the Runtime may start another outer Judge attempt only within the
  same API-source `api_request_settings.retry_count` budget (`retry_count + 1`
  total outer attempts, with `retry_count=0` allowing only the initial call).
  When the API Client reports a consumed transport `error.attempt`, that count
  is charged to the same budget so a settled callback cannot open an extra
  request after Client retry exhaustion. Exhaustion preserves the due snapshot
  and records a skipped retry; it does not clear or rewrite the storyline.
- Independent subject design/judge API waits may run in parallel after the
  settled and two-response gates. Results are consolidated independently:
  only current-Floor/Swipe, subject, attempt, parser, and schema-valid results
  enter the complete current-Floor collection. Failed, cancelled, timed-out,
  stale, or invalid results are diagnostic-only and must not prevent qualified
  siblings from being persisted.
- A submission receipt is current-Floor slot state, not an unbounded append-only
  collection: repeated context injection for the same subject and exact Floor
  Version replaces the prior submission, while submissions from other Floors,
  subjects, and all response receipts remain available for replay.
- Advancing past the last node keeps the selected branch and injects its
  `conclusion_goal`. It does not switch branches or create an Event.
- Design and judge API inputs show `display_name`, aliases, the recent-story
  collection bounded exactly by Settings `最近剧情.floor_count`, Character
  context, processed Event reference data, plugin World Model/worldview, other
  reference data, and filtered external memory. Worldbook content is not sent.
  Internal subject, Event, cycle, pregnancy, source, entry, or file IDs are not
  model-facing storyline context.
- Source formatting is source-specific: plugin World Model/worldview uses
  Chinese readable labels with `- 内容` on the same line and correctly
  indented nested lists; other reference data uses labeled readable bullets;
  external memory uses only enabled, available, content-bearing provider items
  under `【外部历史参考信息】`. Worldbook content is intentionally omitted.
  Provider state, raw DTO wrappers, and internal source/entry/file IDs are not
  sent to the storyline API.
- Triggered-signal evidence is resolved narrowly as
  `triggered[].event_ids -> current events[].event_id -> source_evidence[].text`
  and is rendered beneath its matching signal. Tracking/profile `evidence`
  fields are recursively omitted from `【人物资料】`; they describe prior
  exposure or profile derivation and must not be presented as evidence for a
  triggered symptom. If the matching Event evidence is unavailable, the signal
  remains visible without an evidence line. `known_characters` is rendered as
  one `- 已知人物：` parent followed by ordered children only for characters that have
  at least one nickname; each child has `- 角色名：...` and `昵称：...` lines. If
  no character has a nickname, the whole block is omitted. The first character
  must not be collapsed onto the parent heading.
- Storyline API messages use this order whenever the corresponding content is
  present: SYSTEM 1 contains the storyline rules and response contract; SYSTEM
  2 contains the readable `【当前 World Model 参考】` block, other reference
  data, and filtered external memory; ASSISTANT contains only the
  `【近期剧情正文】` context; and USER contains the target character,
  character data, triggered physiological signals, candidate/selected branch
  data when applicable, and the current task request. Empty optional SYSTEM 2
  or ASSISTANT blocks are omitted rather than replaced with placeholder text.
  Each retained block explains its purpose. Context objects and branch plans
  are rendered as labeled nested text, not raw JSON or path-flattened DTO
  keys. The response remains a Host-parsed JSON object, while the independent
  API does not receive a redundant BioWeave identity sentence.
- Judge cadence is independent from prompt context: every two qualified
  response receipts make the judge eligible, but those two bodies are only
  read for cadence and are not inserted into the prompt. Ordinary Projection
  `DELIVERY_RESPONSE` persistence failures are diagnosed separately and must
  not prevent an eligible storyline settle/judge request from proceeding.
- Storyline Judge 的重复 settle 只允许消费 API 来源 `retry_count` 指定的额外
  尝试（总预算为 `retry_count + 1`）。同一 `due_attempt_id` 在已有 Judge
  请求进行时只保留单飞请求；若 API Client 已在错误上报告更高的 transport
  attempt，Runtime 将其计入同一预算，不再额外开启一轮外层 Judge 请求。
- Storyline design must keep pregnancy unresolved until a later factual Event:
  before confirmation, prompts must explicitly forbid “安胎”“保胎” and other treatment
  wording that presupposes an established pregnancy; a neutral examination,
  conditioning, or follow-up hook is required instead.
- `GENERATION_STARTED` may rebuild the transient prompt only. It cannot call
  design/judge APIs or write a storyline snapshot/delivery receipt.
- Factual termination writes `terminated` only after the existing
  not-pregnant archive/delete/readback/release/readback sequence succeeds (when
  applicable) and the terminal storyline complete-snapshot readback matches.
- Storyline Debug sequence events are runtime-only bounded diagnostics. Current
  snapshot and delivery summaries still come from the endpoint's valid
  Floor/active-Swipe view. The execution sequence is filtered by current Chat,
  intentionally retains bounded cross-Floor success/failure/stale history, and
  carries each event's own six-field Floor provenance; that provenance describes
  the attempt and does not make a stale trace authoritative. Diagnostics may
  summarize body Floor references, Prompt message role/section/length/fingerprint,
  `projection` API assignment, response shape and parse outcome, but are not state and never
  contain complete 正文, prompts, or raw API responses.
- Debug trace summaries are safe DTOs: prompt messages expose only `role_order`,
  known section labels, length, and fingerprint; responses expose only shape,
  length, and fingerprint; body reads expose response/Floor references, status,
  and length. `api_assignment` and `projection_route` must be `projection` for
  storyline requests; `profile_resolution_task` is internal resolver metadata
  and must not be presented as the configured assignment.

#### 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Floor is not settled, active Swipe changed, or six-field version changed | No API result or Floor write is accepted |
| Design result is not exactly 3 branches, any branch has outside 3–5 nodes, or a required branch/node field is empty | Reject that subject's result; keep it absent for retry while qualified siblings continue |
| Triggered item has no matching current Event/source evidence | Keep the readable signal label and omit its evidence line; never borrow profile or another Event's evidence |
| Fewer than 2 eligible response receipts | Do not call the judge |
| Judge returns an unknown branch/action or API/parse fails | Preserve the due snapshot and retry the same attempt |
| Same `due_attempt_id` is already being judged | Do not start a second concurrent Judge; record an in-flight skip |
| Judge retry budget is exhausted, including a Client error whose `attempt` already reaches the budget | Preserve the due snapshot; record `retry_decision=stop`; do not call the API again |
| Readback loses a target or sibling snapshot, or any logical state differs | Raise `STORYLINE_READBACK_MISMATCH`; do not report success |
| Explicit pregnancy/not-pregnant Event is absent | Keep selected guidance, including `conclusion_goal` |
| Not-pregnant archive/release or terminal readback fails | Do not consider the storyline terminated |
| Prompt/API/response debug summarization fails | Keep the request path fail-open; omit the unavailable summary |
| Trace payload contains prompt, 正文, raw response, or credential-shaped data | Sanitize it out before the session-only buffer/export |

#### 5. Good / Base / Bad Cases

- Good: Floor 20 owns candidates `[A,B]`; Floor 26 changes A and writes
  `[A′,B]`; Floor 30 terminates B and writes `[A′,B-terminal]`; endpoint 23
  still reads Floor 20.
- Base: a unique branch is not yet visible after two responses; the judge
  returns null, all three candidates remain, and the next response window starts
  at zero without redesign.
- Bad: Runtime patches only A, merges it with B from an unrelated Floor, counts
  a response without a prior receipt, or accepts a judge callback after Swipe
  change.
- Good Debug: `CONTEXT_PORT_READ → PROMPT_BUILD → API_REQUEST → BODY_READ/JUDGE_PARSE →
  SNAPSHOT_WRITE → SNAPSHOT_READBACK` remains visible with safe summaries and
  the real `projection` assignment.
- Base Debug: a request completes but response parsing fails; keep response
  shape/fingerprint and `parse_outcome=rejected`, never the raw response.
- Bad Debug: export the assembled prompt, full正文, or raw API response, or
  let a diagnostics callback prevent the actual request.

#### 6. Tests Required

- Domain: schema cardinality, revision digest, last-node-to-conclusion cursor,
  stable due attempt, unknown judge output, and terminal prompt suppression.
- Persistence: 20/26/30 plus endpoint-23 rollback, explicit complete terminal,
  active Swipe/version filtering, and multi-subject sibling restamping.
- Runtime: settle-only design dedupe, two-response judge boundary, same-attempt
  failure retry, retry_count=0 no-retry, retry_count=1 with Client
  `error.attempt=2` no extra outer call, same-due single-flight, stale callback
  rejection, complete readback mismatch, and archive/release-before-terminal
  ordering.
- Context: `GENERATION_STARTED` performs no storyline write; the model-facing
  prompt contains readable names/current story/world context and no internal
identity fields; triggered evidence stays under its matching signal,
  character-profile evidence is absent, and known characters with nicknames retain
  source order plus role-name/nickname labels.
- Debug: assert trace stage order, `projection` routing, safe message/response
  summaries, body references, redaction, bounded retention, and fail-open
  diagnostics callbacks.

#### 7. Wrong vs Correct

Wrong: store a per-subject patch or compare a previous-Floor snapshot identity
after the sibling is restamped to the new Floor.

Wrong: print tracking/profile `evidence` under `【人物资料】`, or flatten the first
known character into `- 已知人物：角色名：...`.

Correct: read the nearest complete collection as the logical baseline, rebuild
the complete subject collection, normalize all expected siblings against the
current Floor Version, write once through Projection storage, and compare the
logical complete readback collection before accepting success.

Correct: resolve each triggered signal's evidence only through that signal's
Event IDs, and render known characters as a consistently nested ordered list.

Wrong: label a storyline request as `storyline` API assignment because that is
the analyzer's internal resolver task, or serialize `messages[]` into Debug.

Correct: resolve the configured `projection` profile, record the internal
resolver task separately, and retain only role/section/length/fingerprint
summaries in the session-only trace.

Wrong: treat every repeated `settled()` callback as a fresh Judge budget, or
let a Client transport attempt and the Runtime each start their own unlimited
retry sequence.

Correct: use the same `retry_count` setting for the due-attempt outer budget,
single-flight the `chat + subject + due_attempt_id` key, and charge a reported
Client transport attempt before deciding whether another call is allowed.

### Projection generation batch persistence contract

#### 1. Scope / Trigger

This contract applies when one Projection Runtime execution generates one or
more candidate creations and their evidence records from the same captured
business input. It optimizes one generation wave; it does not change Projection
identity, eligibility, timeline schema, lifecycle, or factual status.

#### 2. Signatures

The Runtime generation boundary requires:

```js
createProjectionRuntime({ saveProjectionBatch })
```

The Projection storage boundary is:

```js
saveProjectionBatch({
  chatId,
  ownerFloor,
  floorVersion,
  records: [{ projectionCandidate?, evidenceRecord? }],
  traceContext?,
})
```

`records` must be a non-empty array. Every item must contain at least one of
the two documented record fields. The single-creation and single-evidence APIs,
when retained, are thin wrappers over this batch boundary rather than separate
persistence implementations.

#### 3. Contracts

- Runtime collects successfully generated records in memory. Built-in local
  candidates use execution-local liveness checks; AI candidates retain the
  request-before and response-after full stale checks.
- Runtime performs one complete current-input comparison immediately before a
  non-empty batch is submitted.
- Storage validates every candidate, deterministic evidence ID, and record
  Floor Version before calling `mutateFloor()`.
- Storage appends every creation and its evidence in deterministic input order
  on one normalized timeline, then submits exactly one Projection owner patch
  through the existing `FloorPersistenceCoordinator`.
- Any validation, append conflict, owner, Swipe, Chat, or Floor Version failure
  rejects the whole batch before a partial timeline can be committed.
- Coordinator dispatch-time guards, sibling preservation, official save, and
  authoritative readback remain mandatory. Runtime performs the final
  Projection views read and Context refresh only after the batch attempt.

#### 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| `records` missing, non-array, or empty | Reject with `PROJECTION_BATCH_RECORDS_REQUIRED`; no Floor read/write |
| Item has neither documented record field | Reject with `PROJECTION_BATCH_RECORD_REQUIRED`; no Floor write |
| Candidate schema or record Floor Version invalid | Reject the whole batch; no Floor write |
| Supplied evidence ID is not deterministic | Reject with `evidence_record_id:not_deterministic`; no Floor write |
| Creation/evidence append conflicts | Reject the whole batch; no Floor write |
| Exact duplicate batch | Return deduped/no-op; do not call Host save |
| Chat, owner, active Swipe, or six-field Floor Version changed | Fail closed through the existing Projection/Coordinator guards |

#### 5. Good / Base / Bad Cases

- **Good**: two subjects generate eight built-in candidates; Runtime collects
  the input at start and once before persistence, then Storage saves all eight
  creations and evidence records in one confirmed Floor transaction.
- **Base**: no candidate is generated; Runtime does not call the batch API and
  continues to the ordinary final read model.
- **Bad**: each candidate rereads all business inputs or separately saves its
  creation and evidence, producing multiple Host saves/readbacks for one wave.

#### 6. Tests Required

- Runtime: two subjects/eight built-in candidates cause exactly two complete
  input collections, one batch call carrying eight records, and zero AI calls.
- Storage: eight creation/evidence pairs produce one `saveFloor()` and the
  confirmed timeline contains all sixteen append-only records.
- Storage: duplicate, empty, unsupported, invalid, conflicting, stale,
  wrong-Chat, wrong-owner, and wrong-Swipe inputs assert both the returned error
  semantics and absence of an unauthorized/partial Floor write.
- Integration: existing Coordinator sibling, queue, save, and authoritative
  readback tests remain green without modifying the Coordinator implementation.

#### 7. Wrong vs Correct

```js
// Wrong: one generation wave becomes repeated business reads and Host writes.
for (const candidate of candidates) {
  await collectInputs();
  await saveGeneratedProjection(candidate);
  await saveProjectionEvidence(candidate.evidence);
}

// Correct: validate freshness once, then commit one owner-scoped timeline patch.
const records = candidates.map(toProjectionBatchRecord);
if (await currentInputsMatch(executionId)) {
  await saveProjectionBatch({chatId, ownerFloor, floorVersion, records});
}
```

Runtime Context Injection is downstream of this read. It consumes only the
current `getProjectionViews()` result with `context_visible === true`, through
the stable `bioweave_projection_context` extension slot. It does not read raw
timeline arrays, persist a Chat-level prompt, or make the prompt part of Event
evidence. Built-in pre-confirmation views are selected independently for each
`subject_id + pregnancy_id|null + cycle_id` identity; mechanism metadata does
not split one subject's stage branches. When a
complete four-branch snapshot for the current Story Time schedule stage is
available, only that stage is injected. During a stage transition, while the
new complete snapshot is not available yet, the latest complete prior stage is
temporarily retained so the next API request does not lose its context. After
the 42-day observation window, the prior stage is no longer injected.
Generic/world-model projections are unchanged. When the current Character
Floor, Chat, Swipe, or Floor Version is missing or changes, the slot is
refreshed or explicitly cleared.

### Internal settled-floor Projection stage synchronization

The automatic scheduler's `analysis_interval` gates only the external
World/Event/Projection API route. After every valid Character Floor has passed
the Generation settle barrier, the Runtime may run an internal built-in
pre-confirmation stage synchronization independently of that interval. It
re-reads the authoritative Timing/Aggregation inputs and current Story Time;
the same complete stage is reused without generation or persistence, while a
stage transition prepares the complete built-in batch in memory and persists
only the new current-Floor creation/evidence batch. It does not call an
external analyzer and does not create a lifecycle deletion/expiry record for
the previous stage.

If the external Event API was skipped by the interval and the current
Character Floor has no complete owner slot yet, the internal route may first
use the existing Event/Floor Coordinator to seed that current slot from the
nearest valid prior Event snapshot (`events` and `character_registry`) with
the current six-field Floor Version. This seed does not copy or invent
`analysis.status=success`, does not reset the scheduler baseline, and does
not create Chat-level or Runtime-derived fact storage. The Projection batch
owner guard and authoritative readback remain unchanged; the seed is only a
legal Floor-owner prerequisite for a new internal Projection batch.

Opening a Character Card, ordinary Chat rebind, or a read-only UI refresh is
not a settled Character Floor and must not create this owner slot or run the
internal stage synchronization.

Health Assessment snapshot synchronization at the settled boundary follows the
same owner rule: an early `GENERATION_ENDED` attempt may fail closed as
deferred while the current Event collection is incomplete, and the final
`CHARACTER_MESSAGE_RENDERED`/settled handoff may retry that same
Floor/Swipe/version once. The retry reuses the existing Coordinator and
version guards, performs no AI/API request, and remains idempotent for an
already complete or stale target.

### Projection delivery batch persistence contract

#### 1. Scope / Trigger

Projection Context delivery submissions and response observations use explicit
delivery-only batch boundaries; they are not mixed with candidate/evidence
generation batches. The contract applies to one Context submission wave or one
completed-response observation wave.

#### 2. Signatures

```js
saveProjectionDeliverySubmissionBatch({chatId, ownerFloor, floorVersion, records, traceContext?})
saveProjectionDeliveryResponseBatch({chatId, ownerFloor, floorVersion, records, traceContext?})
```

#### 3. Contracts

- Each boundary requires a non-empty `records` array, validates every normalized
  delivery identity and Floor Version before mutation, appends records in input
  order, and submits at most one `projection_timeline` owner patch.
- A submission uses `readback_verified`; a response uses `response_observed` and
  must carry a current `response_floor_version`.
- Runtime builds the complete wave in memory. A successful analysis
  post-processor shares one captured business-input snapshot and one delivery
  read between response observation, timeout evaluation, and the following
  Projection generation. It may recapture only when timeout closure changes the
  business state; AI request/response stale guards remain the explicit
  exception to the normal one-snapshot path.
- Coordinator dispatch guards, official save, sibling preservation, and
  authoritative readback remain unchanged.

#### 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| `records` missing, non-array, or empty | Reject with `PROJECTION_DELIVERY_BATCH_RECORDS_REQUIRED`; no Floor write |
| Any delivery identity, referenced Projection, or Floor Version invalid | Reject the complete batch; no partial write |
| Response has no `response_id` or current `response_floor_version` | Reject the complete batch; no partial write |
| Owner, Chat, active Swipe, or six-field Floor Version is stale | Fail closed through the existing Coordinator boundary |
| Exact duplicate batch | Return `deduped`; do not call Host save |

#### 5. Good / Base / Bad Cases

- **Good**: 23 Context deliveries are normalized in memory and appended by one
  submission batch; 23 completed responses are appended by one response batch.
- **Base**: no context-visible delivery exists; Runtime performs no delivery
  write.
- **Bad**: each Projection invokes a separate delivery save and repeats the
  Floor read, Host save, and authoritative readback.

#### 6. Tests Required

- Storage: 23 submissions and 23 responses each cause exactly one `saveFloor()`;
  exact repeats are no-ops and invalid/stale records cause zero saves.
- Runtime: a completed response wave produces one response batch call; an old
  single-response dependency remains usable through the compatibility fallback.
- Runtime post-processing: response observation, timeout evaluation, and normal
  built-in generation share the input and delivery snapshots.

#### 7. Wrong vs Correct

```js
// Wrong: one Floor transaction per Context delivery.
for (const view of visibleViews) {
  await saveProjectionDeliverySubmission({deliveryRecord: toDelivery(view)});
}

// Correct: construct first, then use one owner-scoped batch boundary.
const records = visibleViews.map(toDelivery);
if (records.length) {
  await saveProjectionDeliverySubmissionBatch({chatId, ownerFloor, floorVersion, records});
}
```

The existing single-delivery submission and response APIs remain thin one-record
wrappers over these batch boundaries.

### Projection lifecycle batch persistence contract

Projection deletion upgrades and factual evolution updates are append-only
lifecycle records. Runtime collects each semantic kind for one execution before
persisting it; deletion records and factual records remain separate batches when
both are present. The storage boundary is:

```js
saveProjectionLifecycleBatch({chatId, ownerFloor, floorVersion, records, traceContext?})
```

The boundary requires a non-empty record array, normalizes and validates every
lifecycle identity and six-field Floor Version before mutation, appends records
in input order, and submits at most one Projection owner patch. Any invalid,
stale, unknown-Projection, owner, Chat, active-Swipe, or append-conflict record
rejects the whole batch before a partial timeline can be committed. Exact
duplicates return `deduped` without Host save. The existing
`saveProjectionLifecycle()` and `saveEvolutionDecision()` APIs remain thin
single-record wrappers for compatibility.

After the lifecycle batches complete, Runtime performs one authoritative
Projection views read for the execution when any batch changed the timeline.
The existing Coordinator owner/version guards, sibling preservation, official
save, and readback confirmation remain mandatory; lifecycle batching does not
change factual status, deletion visibility, Projection DTOs, or time semantics.

## 1. Source of Truth

Host message semantic role MUST be normalized before any Floor ownership
decision. Under the current SillyTavern semantics, `is_user === true`
identifies a User; `extra.type` distinguishes narrator, comment, and other
system-like non-Character entries; and `is_system` is a hidden/display-state
flag that MUST NOT independently determine semantic role. Character Floor
eligibility derives from the normalized host role. The legacy `message.role`
field is a compatibility fallback only when native host role fields are absent.

A BioWeave Floor is a Character/assistant message after that normalization.
User messages are narrative
context only: they never create a BioWeave Floor, Floor Version, or
authoritative payload. Runtime resolves the current BioWeave Floor as the
nearest Character/assistant message at or before the current host message.

A Floor-derived analysis, Event, or biological fact belongs to that Character
message and, when it has Swipe structure, to its durable per-Swipe slot. The authoritative binding is the
complete six-field Floor Version owned by `runtime/floor.js`:

`chat_id`, `message_id`, `floor`, `swipe_id`, `content_hash`, and
`message_version`.

`storage/store.js` is the business storage boundary. Its read/write contract
is:

- a Character message without Swipe structure uses `message.extra.bioweave`;
- a Character message with Swipe structure uses exactly
  `message.swipe_info[swipe_id].extra.bioweave`;
- a User message is rejected as a BioWeave Floor owner;
- the requested message, Chat, and Swipe must still exist;
- a complete Event state is active when the containing Floor slot has a
  matching complete six-field Floor Version and a persisted analysis result;
  inherited Events keep their original `source`, which need not equal the
  containing Floor slot Version.

An automatic Analysis Job captures one complete Floor Version boundary. Its
Current Target Floor, bounded Recent Story, `existing_events`, and Character
Registry must be resolved from that same boundary. A delayed background/foreground
callback cannot change the owner or revive a stale Floor; generation-bound work
must revalidate Chat, active Swipe, Floor Version, and generation identity before
AI and fail closed on any mismatch.

Automatic interval scheduling uses the current surviving Character Floor timeline,
not a persisted counter or a message-index difference. Its baseline is the nearest
still-valid successful Character/Event Analysis Floor; User messages never count.
Runtime counter and observed/counted keys may accelerate the forward path, but after
reload, deletion/rollback, active Swipe or version replacement, and successful manual
reanalysis they are rebuilt from the current active Floor/Swipe/version owners.
Reroll, regenerate, and new Swipe identity do not by themselves force automatic AI;
after the final Floor Version settles they enter the ordinary interval path.

Before SillyTavern reads a new generation prompt, `GENERATION_STARTED` may perform
one read-only Projection Context rebuild from the latest fully completed valid
Character Floor. This may update only the transient extension slot; it records no
delivery submission and must not run Analyzer/Projection processing,
Tracking/timeout calculation, automatic recovery, or Floor persistence. The
current request still sees the previous completed Floor; only after the response
completes and its new Story Time is settled can the following request see the new
stage. Once body generation is active, `GENERATION_STARTED` only advances the
Generation Lifecycle and all business work remains gated. `runtime/events.js`
must not run Projection lifecycle, Tracking/timeout calculation, Floor
persistence, or another full Projection Context refresh during that interval;
automatic Chat/message/Swipe triggers are coalesced behind a non-blocking gate.
After the final Character Floor is
confirmed, or generation is explicitly stopped/cancelled, the gate is released,
deferred lifecycle signals are replayed once, and the current Chat, active Swipe,
and complete Floor Version are revalidated before one post-generation handoff.
Signals from an old Chat are dropped. A Chat boundary clears the old Context
slot first; stale old-Chat/Floor work must fail closed.

The gate is an activity lease, not an unbounded boolean. A normal
`GENERATION_STARTED` arms a provisional lease of about 3000 ms. If
`STREAM_TOKEN_RECEIVED` or matching final `CHARACTER_MESSAGE_RENDERED`
confirms real generation activity and disables provisional expiry, while a
separate bounded hard watchdog remains armed; repeated
starts coalesce pending events without dropping them. `GENERATION_ENDED`,
`GENERATION_STOPPED`, `GENERATION_CANCELLED`, and the final settled handoff
release the gate. A matching render may arrive before `GENERATION_ENDED`, so
it confirms activity but does not by itself settle the lifecycle.
Lease timers carry both the gate identity and a generation token, and are
cleared on release or runtime destroy, so an old timer cannot release a newer
Chat or generation. Lease expiry is recovery from an uncorroborated/stale
start only: it may replay a deferred ordinary `CHAT_CHANGED` read-only
restore, but it must drop unsafe message/Swipe/business triggers and must not
authorize analysis, Projection/Tracking lifecycle work, Context recomputation,
or Floor persistence. Expiry snapshots and cancels the stale Generation
Lifecycle pending intent. If the same Chat/epoch later proves real new
Character activity through `MESSAGE_RECEIVED` or a matching
`CHARACTER_MESSAGE_RENDERED`, the Runtime may restore that pending intent and
reopen the deferred gate; it must still wait for both the final Character
Floor and `GENERATION_ENDED` before the one post-generation handoff.
Unconfirmed late renders, orphan terminal signals, and other lifecycle events
remain quarantined. A Chat change, new generation start, or hard-watchdog
expiry clears/fails closed quarantine. Start/renew/expire/release/restore are
recorded as concise diagnostic stages without raw content.

### Generation settle gate contract

#### 1. Scope / Trigger

This contract applies to automatic BioWeave work triggered by a SillyTavern
generation lifecycle. It delays derived reads, Projection/Tracking lifecycle
work, timeout evaluation, Floor persistence, and Context refresh until the
generation has a final Character Floor or an explicit stop/cancel outcome.

#### 2. Signatures

```js
handleLifecycleEvent({type, eventType, payload, chatId, deferAutomaticWork?})
setGenerationAutomaticWorkDeferred(trueOrFalse)
```

The Host boundary is `runtime/events.js`; the business lifecycle handler is
`runtime/event-analysis.js`. Deferred event entries retain their original
`type`, `eventType`, `payload`, and captured Chat ID.

#### 3. Contracts

- Before the prompt is read, `GENERATION_STARTED` may perform one read-only
  Context rebuild from the latest fully completed valid Character Floor. It may
  update only the transient extension slot; it records no delivery submission
  and performs no Analyzer/Projection processing, Tracking/timeout calculation,
  automatic recovery, or Floor write. The current request sees the previous
  completed Floor; the completed response affects the following request.
- Once body generation is active, `GENERATION_STARTED` advances only Generation
  Lifecycle state and all business work remains gated.
- During the gate, automatic message, Chat, and Swipe triggers perform no
  business calculation or persistence; the latest event of each type is kept.
- After final Character Floor confirmation or stop/cancel, deferred lifecycle
  events are replayed once, then current Chat, active Swipe, and complete
  six-field Floor Version are checked before one post-generation handoff.
- Deferred events captured from a different Chat are skipped as stale; they
  must not mutate the new Chat or restore the old Context.
- Repeated generation-start signals reuse the current gate and must not erase
  already deferred events.
- A start arms a bounded provisional lease; stream tokens or matching final
  Floor activity disable only provisional expiry. The non-renewed hard
  watchdog still abandons an evidenced run with no terminal signal fail-closed,
  without calculating partial text, and releases the gate safely.
- Lease expiry only replays a deferred `CHAT_CHANGED` read-only restore. Other
  deferred event classes fail closed. A later same-Chat/epoch
  `MESSAGE_RECEIVED` or matching `CHARACTER_MESSAGE_RENDERED` may restore the
  quarantined intent only when it proves a new Character Floor; the restored
  gate still waits for both final-floor render and `GENERATION_ENDED` before
  the existing guarded handoff. Orphan terminal signals, unconfirmed renders,
  and unrelated lifecycle events remain ignored. A Chat change or new start
  clears the quarantine; hard-watchdog expiry never revives it and expiry
  itself never authorizes business calculation or persistence.
- If the host emits neither terminal signal but the current same-Chat/epoch
  owner already contains a non-empty Character Floor newer than the generation
  baseline, expiry may recover that intent directly after reading the same
  Floor Version twice. The recovered intent is settled once through the normal
  handoff; partial/unstable content, a changed owner, or an incomplete version
  remains quarantined. This recovery is traced as
  `GENERATION_FINAL_FLOOR_RECOVERED` and still uses the normal storyline path.

#### 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Body generation is active | No Projection/Tracking/timeout/Floor save/Context recompute |
| Deferred event belongs to the active Chat | Replay once after the gate releases |
| Deferred `MESSAGE_DELETED` for a regenerated slot | Skip only when its supplied `message_id` also identifies the regenerated Character Floor; a same-index deletion for another message is still replayed |
| Deferred event belongs to an old Chat | Skip with stale-context diagnostic |
| Final Floor or lifecycle owner changed | Existing Floor/Chat/Swipe guard fails closed |
| Duplicate generation or lifecycle event | Coalesce; no duplicate handoff |
| Start has no corroborating activity or terminal event | Expire the lease and replay only safe read-only Chat restore |
| Start has no terminal event but a stable newer final Character Floor exists | Double-read that owner, recover and settle once; otherwise remain quarantined |
| Old lease callback runs after a new gate/Chat exists | Identity/token guard ignores the callback |

#### 5. Good / Base / Bad Cases

- **Good**: `GENERATION_STARTED`, several message edits, and final Character
  Floor occur; edits are coalesced, replayed after finalization, and one
  current-Floor handoff runs.
- **Base**: no deferred event exists; finalization directly performs the
  guarded handoff once.
- **Bad**: run Tracking or save a Projection while the response body is still
  generating, or silently discard a deletion/Swipe event after deferring it.

#### 6. Tests Required

- Generation-time triggers assert zero analyzer calls, Floor saves, lifecycle
  writes, and non-read-only/full business refreshes before the final boundary;
  the pre-prompt boundary may perform at most one read-only Context refresh.
- Message update/edit/delete and Swipe signals assert one post-boundary replay
  with the correct event type; repeated signals remain coalesced.
- Chat switch during generation asserts the old Context is cleared and old-Chat
  events are skipped.
- Final Character Floor plus duplicate end/render signals assert one handoff.

#### 7. Wrong vs Correct

```js
// Wrong: calculate or silently drop the event while ST is generating.
await processProjection();
return; // MESSAGE_DELETED / MESSAGE_SWIPED is lost

// Correct: defer, then replay under the current owner after generation settles.
deferByType({type, eventType, payload, chatId});
await replayDeferredEventsAfterGeneration();
await handoffCurrentCharacterFloor();
```

The active-message `extra` projection that a host may maintain while changing
Swipes is a host mirror. It does not create a second owner. A Chat-level map
such as `chatMetadata.floors[mesId]`, a registry, or an in-memory cache is not
a historical source of Floor facts. BioWeave does not add a permanent Floor ID
database.

### Chat rebind read-only restore contract

#### 1. Scope / Trigger

This contract applies to an ordinary `CHAT_CHANGED` outside the Generation
gate. It changes only the current Chat binding and the transient
`bioweave_projection_context` display; it does not start a new business
execution.

#### 2. Signatures

```js
refreshProjectionContext({chatId?, generation?, businessData?, projectionViews?, readOnly?})
```

`readOnly: true` is used for Chat rebind restoration and the pre-prompt
`GENERATION_STARTED` Context rebuild. The default remains `false` so
generation-settle and ordinary post-analysis paths retain their
delivery-observation behavior.

#### 3. Contracts

- `runtime/events.js` clears the old Context slot before the Chat rebind work.
- Chat rebind may read the current valid Floor, Projection Views, Health
  Guidance, registry, and scheduler state, but it must not call Projection
  processing, lifecycle ticking, automatic recovery, or Analyzer code.
- The pre-prompt `GENERATION_STARTED` rebuild reads only the latest fully
  completed valid Character Floor and may update only the transient extension
  slot. It records no delivery submission and performs no Analyzer/Projection
  processing, Tracking/timeout calculation, automatic recovery, or Floor write.
- A read-only Context refresh may write the transient host injection slot, but
  must not call `recordProjectionSubmission` or append a delivery record.
- The Runtime may keep one last-successful Context read model as a transient
  acceleration hint, keyed by the current Chat/Floor Version, Projection View
  snapshot, and (for non-read-only resolver paths) the supplied business
  snapshot fingerprint. It may skip repeated resolver work and duplicate slot
  or delivery writes only when those inputs are unchanged. This cache is never
  authoritative, is cleared on Context clear/destroy or owner changes, and a
  read-only write must not mark a later non-read-only delivery as completed.
- Chat/active Swipe/Floor Version guards still apply; stale current data fails
  closed and must not restore the old Chat's Context.
- A `CHAT_CHANGED` captured while the Generation gate is active remains a
  deferred signal and is handled only by the existing post-generation handoff.

#### 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Ordinary Chat rebind | Clear old slot, restore current read-only views, no Floor write |
| `readOnly: true` with a visible Projection | Update slot, return no delivery submission |
| Missing/invalid current Floor | Clear or leave the slot in the existing fail-closed state; no delivery write |
| Chat, Swipe, or Floor Version changes during restore | Return stale/clear result; never inject old data |
| Chat change during Generation gate | Defer to settle handoff; do not run ordinary rebind inline |

#### 5. Good / Base / Bad Cases

- **Good**: Chat rebind clears the old slot, reads the current stored view,
  writes it to the transient slot, and leaves `delivery_records` unchanged.
- **Base**: the target Chat has no valid Floor; the slot is cleared and no
  Projection/Tracking/Lifecycle fact is created.
- **Bad**: Chat rebind calls `projectionRuntime.process()` or records a new
  delivery merely because an existing view was displayed again.

#### 6. Tests Required

- Runtime Chat rebind asserts zero Analyzer calls, zero Floor saves, no
  `PROJECTION_PROCESS_STARTED`, no lifecycle tick/recovery trace, and a
  clear-then-restore slot sequence for an existing Projection.
- Projection Context unit coverage asserts `readOnly: true` returns no
  submission and does not invoke the delivery callback.
- Generation-gated Chat changes continue to assert stale old-Chat clearing and
  one post-generation handoff.

#### 7. Wrong vs Correct

```js
// Wrong: displaying an existing view starts business processing or a receipt.
await projectionRuntime.process({reason: "chat-changed"});
await refreshProjectionContext();

// Correct: restore only the current persisted read model.
clearProjectionContext();
await refreshProjectionContext({chatId, readOnly: true});
```

Chat Metadata may still own independent configuration: user choices, role or
plugin settings, current Character Card/Persona context, and other explicitly
authoritative Chat-local values. Historical World Model state is not Chat
configuration: `world_model` and `world_model_meta` are Floor-owned fields. The normalized `world_model.projection_rules[]` collection is part of that same World Model owner, not a runtime-only field or Chat-level fallback.
Floor-derived canonical identity history is Floor-owned cumulative snapshot
state; it is not Chat configuration.
If a Chat-level
`character_registry` is retained, it is only a materialized projection/cache;
it is never an independent historical source for Analyzer API input.
Event-derived profile fields and all
historical biological facts remain subject to the Floor ownership and
provenance rules below.

## 2. Floor lifecycle

The current Character message collection and host-owned message/Swipe slots
determine validity on every read. Lifecycle handlers can trigger a rebuild for
responsiveness, but correctness must be recoverable without trusting a
deletion callback or a stale cache.

| Lifecycle change                           | Required result                                                                                                                                                                                                                                                                               |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| First analysis or successful reanalysis    | Save the complete current Event state, analysis, and cumulative canonical identity snapshot in the existing message/Swipe Floor slot, bound to the current six-field version. The state inherits the nearest valid prior complete state; unchanged Floors do not copy it. |
| Manual regeneration or force reanalysis    | Update the same current-version slot without creating a second history record. Manual supplement preserves valid current-state Events omitted by the new response; matching facts retain their canonical Event/identity IDs. The target is never its own previous historical Floor. |
| Edit or regenerated text                   | Recompute `content_hash` and/or `message_version`. The old result is stale and its Events are inactive until a successful result for the new version is saved. A failed attempt may preserve the old stored result for diagnostics, but it cannot make old Events active for the new version. |
| Character message deletion                 | The message's Floor facts disappear from active reads. Rebuild derived state from the remaining Character messages.                                                                                                                                                                           |
| User message mutation                      | No BioWeave Floor is created, invalidated, or reanalyzed solely because a User message changed.                                                                                                                                                                                                  |
| Multi-Floor deletion or history truncation | Every removed message loses ownership of its facts; no array index, registry, summary, cache, or Chat hint may recreate them.                                                                                                                                                                 |
| Swipe deletion                             | The deleted `swipe_info[swipe_id]` owner contributes no Floor, previous state, Event, or derived reference.                                                                                                                                                                                   |
| Swipe switch                               | Reads select only the newly active Swipe's slot. Facts from another Swipe are inactive even when the message and Floor number are the same.                                                                                                                                                   |
| Chat reload or plugin reload               | Recompute from the current host message collection and valid slots, including Floor-owned canonical identity snapshots. Runtime memory is disposable.                                                                                                                                            |
| Chat switch                                | Chat scope and token checks prevent reads or writes from crossing Chats; pending work must not save facts into the new Chat.                                                                                                                                                                  |

An inactive or missing Floor is represented by the existing empty storage
shape, not by a fallback to another message, Swipe, or Chat-level historical
copy.

### Business-domain separation inside one Floor

The Floor object is a storage container, not a merged business owner. World
Model and Character/Event Analysis share Floor Version, Store, owner slots,
invalidation, and business-neutral traversal only. World Model owns its world
rules/prompt/parser/normalizer/evidence guard and its own persistence/resolver;
Character/Event owns identity, registry, profile/context, participant
resolution, BiologicalEvent, Tracking, and its own validation/persistence.

Saving one domain must preserve the other domain's valid fields. A World Model
save may replace only `world_model` and `world_model_meta`; Character/Event
analysis may replace only `analysis`, `events`, and `character_registry`.
Cross-domain clearing is allowed only when the lifecycle contract explicitly
invalidates the complete Floor Version or owner. Neither domain may place its
resolver or save logic inside the other domain's business helper.

## 3. Per-swipe ownership

For a structured message, `swipe_info[swipe_id].extra.bioweave` is the durable
owner of that Swipe's Floor state. Store callers pass the requested Swipe ID
through the existing Floor storage abstraction; they do not inspect or mutate
host slots themselves.

Reads must not fall through from a missing or stale slot to another Swipe,
the active-message mirror, `chatMetadata`, a registry, or a runtime cache.
The active Swipe is selected from the current host message. A Floor Event
whose `source.swipe_id` differs from that active Swipe is not part of current
state. Switching back to a still-existing Swipe may reveal that Swipe's own
valid slot; deleting it cannot.

This per-Swipe boundary is also the ownership rule for future disease or
exposure facts. A disease fact produced while Swipe 2 is active belongs to
Swipe 2's Floor slot, not to the message as an undifferentiated Chat fact.

## 4. Previous Floor Resolution

For a target Floor, Runtime scans the current Chat's messages from the target
message index minus one toward older messages. It selects the nearest
candidate that satisfies every condition:

1. the candidate message still exists;
2. its current active Swipe is selected;
3. the exact active-Swipe Floor slot is readable through `store`;
4. the candidate's recomputed Floor Version is complete and exactly equals the
   stored analysis version;
5. `analysis.status === "success"`;
6. the candidate Floor is lower than the target Floor; and
7. the candidate Events pass current-version filtering; and
8. the candidate owner contains a complete normalized cumulative
   `character_registry` snapshot with only formal `char_` plus six-digit
   canonical IDs when identity history is requested.

The target's own old analysis and Events are structurally excluded by starting
the scan before the target. A target's old result, Chat Metadata, a runtime
cache, a deleted registry entry, or `last_processed_floor` is never a
previous-state fallback. A stale candidate is skipped so that an older valid
candidate may be selected.

When no candidate passes, the normalized previous value is exactly:

```json
{
  "analysis": null,
  "events": [],
  "character_registry": { "schema_version": 1, "entities": {} }
}
```

The `character_registry` returned for a valid candidate is read from that same
candidate's exact Floor/Swipe owner slot. It is a cumulative snapshot as of
that Floor, not a Chat-global ledger. The target Floor's old snapshot is
excluded by the same scan boundary as its old analysis and Events. A candidate
without a valid snapshot cannot fall back to Chat Metadata. It is skipped; if
no valid candidate remains, the initial empty Registry is used.

The same rule applies during reanalysis, after message or Swipe deletion,
after edit/regeneration, after history truncation, and after reload.

### Pre-confirmation timing owner

`projection_timing_snapshot` is a sibling Floor-owned complete collection root
under the Projection persistence owner. It uses the same active Character
Swipe, complete six-field Floor Version, coordinator transaction, authoritative
readback, and stale-owner guards as `projection_timeline`, but it is not a
Projection, BiologicalEvent, Snapshot, Current State, or Tracking Window.
Timing items may be replaced on a later Floor so the latest complete collection
is authoritative for that Floor; historical roots remain immutable. A read
scans the current Chat toward the target Floor and uses the nearest actual,
valid root. An absent root inherits that older collection, an explicit
`{schema_version: 1, items: []}` root is authoritative and blocks inheritance,
and a schema-invalid root is skipped rather than treated as explicit empty.
Every candidate is revalidated against the active Swipe and recomputed complete
Floor Version; an item whose creation provenance is outside the root/target
Floor, Chat, or active Swipe also invalidates that candidate root. Chat-local
`settings.character_timing_configs` is authoritative
configuration and is not a Floor-derived fact. Timing records never become a
fallback source when their Floor/Swipe/version is inactive. The built-in Human
narrative preset is a Core configuration baseline, not a Floor fact or World
Rule; the formal Characters UI writes only through the Chat-local timing-config
API and never through the debug facade.
An explicit edit of the current Timing Instance may repair a current owner slot
whose stored metadata has the same Chat/message/Floor/Swipe identity as the
live authoritative version, only when the edit-start version exactly matches
that live six-field version. The stored root may have stale `content_hash`
and/or `message_version`; the live six-field version is checked first, the
complete validated collection is written with the repaired version through the
Coordinator, and historical candidates and ordinary writes remain exact-match
only. This read/repair path does not write during diagnostic collection and is
not a historical compatibility reader.

`tracking_window_timeline` is a separate sibling Floor-owned append-only root
under the Tracking owner. It follows the same active Swipe, complete Floor
Version, coordinator transaction, authoritative readback, and historical Floor
immutability rules. It is a derived lifecycle record, not a BiologicalEvent or
Current State fact; active Tracking rebuilds still validate the surviving Event
basis before using an open Window.

`participant_aggregation_snapshot` is another independent sibling complete
collection root. It is owned by the exact Character Floor and active Swipe that
records a successful participant aggregation, carries the complete six-field
Floor Version, and is written/read through the Floor Persistence Coordinator.
Later Floors replace/update/delete the complete collection while historical
roots remain immutable. Its read uses the same nearest-root rule: an absent root
inherits, an explicit empty root blocks inheritance, a schema-invalid root is
skipped, and every candidate is revalidated against active Swipe and the
recomputed complete Floor Version. An explicit current-cycle reevaluation may
use the same bounded current-owner metadata repair described for Timing before
writing the current complete collection; historical candidates and ordinary
writes remain exact-match only. An item whose creation provenance is outside
the root/target Floor, Chat, or active Swipe invalidates that candidate root. It
is not a Timing Instance, Tracking Window, Projection, or Chat-level cache. Its
accepted Exposure IDs are only a boundary for re-deriving the current
participant list from the current complete valid Event snapshot; later Floor
owners never merge Exposure facts across Floors.

`pregnancy_lifecycle_timeline` is an independent sibling root owned by the
exact Character Floor and active Swipe. It stores normalized confirmed
lifecycle facts, independent father candidate records, immutable archive
snapshots, and cycle-scoped release records. A terminal release may submit a
complete replacement of the current Floor `events[]` through the Floor
Persistence Coordinator, removing only accepted Exposure Event IDs for the
target cycle. The resulting `events: []` is authoritative and must not inherit
Events from an older Floor, Chat cache, or registry; historical Floors remain
unchanged. Candidate records needed after Exposure deletion are read from this
root and are never rebuilt from deleted Events.

## 5. Derived State

Current valid Floor facts are the only input for materialized runtime state:

- active tracking subjects and pending candidates;
- exposure/Event references, indexes, summaries, counts, and UI models;
- event-derived portions of character profiles or registries, including the
  canonical identity snapshot owned by each successful Floor;
- current biological state, including a future disease tracker; and
- historical biological context sent to an API.

Health factual roles are part of the same Floor-owned BiologicalEvent payload:
`health_role` does not create a health persistence root. Current observation
presentation, Event-history source navigation, and derived Assessment reads must
therefore disappear together when the owning Event, active Swipe, or complete
Floor Version becomes invalid.

Character Health State v1 production chain is implemented within the current narrow scope. See
[CHARACTER-HEALTH-STATE.md](../../docs/CHARACTER-HEALTH-STATE.md) for the current contract and
deferred advanced features. Phase 1 Health Assessment adds only the narrowly scoped
`health_assessment_timeline` Character Floor derived root; it is not a Chat-level authority
or alternative provenance path.
Phase 2 已提供最小 derived Current Health State read model，Phase 4 增加 observation lifecycle
与 presentation-only grouping；它仍从同一 surviving Floor
Event、active Assessment 与 Story Time 路径派生，不新增 Health State Floor root。符合
short-term natural-recovery 到期条件且没有当前新事实时，Runtime 通过既有 Event owner 在
当前操作 Floor 写回变化后的完整 `floor.events`；历史 Floor 不变，最后一个 Event 使用明确
的 `events: []`。缺少有效 Assessment、恢复时间不可计算或 long-term/permanent Event 不自动
删除。

Health Assessment Phase 1 属于同一 Character Floor owner 下、绑定源 Event、完整六字段
Floor Version 与 observation fingerprint 的 derived assessment record；它不是
BiologicalEvent、Snapshot-only 数据、runtime cache 或新的 Chat-level authority。当前以
`(source_event_id, source_floor_version,
source_observation_fingerprint)` 做 source-observation scoped lookup；这是对当前 Event
editing 在同一版本保留 Event ID 但修改 factual payload 的 binding guard。source Event
不再 surviving 或 fingerprint 不匹配时必须过滤 Assessment，不能依赖物理删除或跨版本
复用。
当前 Assessment schema v3 包含 observation-level `severity`（`unknown`、`mild`、
`moderate`、`severe`），并可为 eligible short-term observation 保存一次性生成的
`recovery_stage_guidance.early`、`.recovering`、`.near_recovery`。severity 与 staged
guidance 都是 Assessment metadata，不是 Event factual payload、Snapshot 或 Projection
authority；缺少 v3 新字段的 v1/v2 legacy Assessment 按现有 lifecycle 消费，不产生 staged
Guidance、不自动回写/backfill，也不因缺字段重新调用 AI。上述行为不改变 source binding、
fingerprint 或 request key。

健康 timeline 可包含 `current_floor_snapshot` 派生元数据。该元数据只绑定当前 Floor 的
完整版本、有效健康 Event fingerprint、Story Time 与 recovery stage 选择；复制完整
timeline 时不得改写 Assessment 的原始来源版本或 fingerprint。阶段不变时沿用最近合法
timeline 且不写当前 Floor；阶段变化或当前 Floor Event 编辑/删除时才通过 health owner
保存当前副本。每条 Assessment 仍须重新验证当前 Event 来源与 fingerprint，历史 Floor
不得被当前副本反向修改。

Health Recovery Guidance Phase 5B 是 derived non-factual guidance：它可将每条 active
observation 的 Assessment 与 Story Time 转换为粗粒度恢复阶段；Current Health State 生成后，
Projection Context 复用其中已选的阶段，只链接对应的 persisted guidance，不在注入端重新选阶段。
但不得把具体 duration、
deadline、百分比或 Assessment 字段当作剧情事实，也不得写回 Floor、关闭 observation 或
成为 Event evidence。它复用现有 `bioweave_projection_context` 槽位，不新增 persistence root
或第二套 Context framework。完整 Health Projection 仍为 DESIGN / PLANNED；recovery-stage UI
已实现为 Character Details 对 `health_observations[].recovery_stage` 的逐 observation
presentation，不改变 Floor ownership 或 Health lifecycle authority。

`core/tracking.js` rebuilds its active projection from the current valid Event
collection. It may retain sanitized historical profile/configuration data when
the existing schema allows it, but such data is not an active subject and
cannot stand in for a deleted Event. Stable references point back to current
Event IDs and their Floor/Swipe provenance; a registry does not duplicate the
complete Event fact.

Chat Metadata must be classified by provenance:

- **A. Authoritative configuration** — user, role, plugin, or explicit current
  Character Card/Persona/World Model configuration. This remains Chat-owned and
  is preserved when a Floor disappears. It is distinct from the historical
  canonical identities learned by BioWeave analysis.
- **B. Derived state** — tracking subjects, candidates, event-derived profile
  fields, registries, indexes, summaries, counts, UI models, and caches. This
  is a materialized view, never a second source of truth.

For B, the only valid model is:

```text
derivedState = derive(currentValidFloorFacts, authoritativeConfiguration)
```

It must not be implemented as `merge(previousDerivedState,
currentValidFloorFacts)` unless every retained fact has explicit, still-valid
Floor provenance and passes current validity checks. A mixed profile or
registry is handled field by field: independent configuration is not deleted
merely because a related Floor was deleted, while Floor-derived evidence is
never allowed to become an independent historical ledger. In particular,
Floor-derived canonical identity history is stored as a cumulative snapshot on
each successful Floor owner. Cumulative does not mean global authoritative
ownership: deleting or invalidating the latest owner removes identities that
only it can prove, and the next valid older Floor snapshot becomes the source
for subsequent history.

For a future disease state tracker, the diagnosis/exposure/medication fact is
a Floor fact; the current disease state, subject index, and UI/API projection
are derived state. Deleting its owning message or Swipe, changing its Floor
Version, or removing it from history removes it from the current projection.
An independent tracking preference remains Chat configuration. Current
Character Card/Persona identity context remains configuration/context; a
canonical identity first established by historical BioWeave analysis remains
Floor-owned snapshot state.

A Character reset boundary excludes existing valid Floor facts at or before
the recorded message/Floor boundary until they are analyzed successfully
again after the reset. A successful reanalysis of the boundary Floor is
therefore a new post-reset projection source, while an older unchanged Floor
at the same boundary remains excluded. This exception changes only derived
projection eligibility; it does not restore the cleared Chat projection or
change Floor/Swipe ownership.

## 6. Provenance

Every persisted Floor Event and every historical biological fact that crosses
an API boundary must be traceable to a still-existing, version-valid Floor
slot. The trace includes the complete Floor Version and, for projections,
the originating Event ID where applicable.

The validity chain is:

```text
message + active Swipe + current text/version
  -> complete Floor Version
  -> Event.source equality
  -> derived reference or API fact
```

An object that only exists in a Chat cache, runtime cache, deleted registry,
old active-message mirror, or `last_processed_floor` has no valid provenance.
Caches may accelerate recomputation, but they cannot repair missing
provenance or resurrect a deleted/stale fact.

## 7. API Input Boundary

`runtime/event-analysis.js` owns previous-Floor resolution and passes the
result into `ai/input-builder.js`. The input builder normalizes the
already checked state; it does not discover historical BioWeave facts in Chat
Metadata, registries, or runtime memory.

`existing_bioweave` and any future disease/medication/exposure history in an
AI request must therefore be one of:

- the nearest successful previous Floor's current-version analysis and active
  Events, with complete provenance; or
- the exact empty shape `{ "analysis": null, "events": [],
  "character_registry": emptyRegistry }` when no legal previous Floor exists.

The API must never receive facts from the target Floor's old result, a
deleted message/Swipe, a stale Floor Version, an orphan registry entry, or a
cache that cannot be traced to a current valid Floor. The target's
`floor_version` and `current_floor` describe the current input; they do not
authorize historical fallback.

### Reanalysis and target-slot comparison boundary

Reanalyzing the current Floor always separates three kinds of input:

1. **Target** — the current active Swipe's current正文, bound to the current
   complete Floor Version.
2. **Previous baseline** — the nearest legal successful BioWeave Floor before
   the target. This is strictly target-external. When no candidate passes the
   previous-state checks, the exact empty previous shape is used.
3. **Target-slot existing data** — the target's own existing Events or
   registry, only on explicitly supported comparison paths such as reroll or
   `manual-refresh`. It is comparison-only for dedupe, manual supplement, or
   same-target continuity; it must never be placed into `existing_bioweave` or
   presented to the AI as a historical previous Floor.

The visible Characters UI action “重新分析当前楼层” currently enters the
`manual-character` path:

```text
manualRefreshEventAnalysis()
  → manualAnalysis.analyzeCurrentCharacterEvents()
  → analysisExecution.run({reason: "manual-character", intent: "manual-character"})
```

That path does not enable `preserveCurrentFloorState`. The separate compatibility
entry `refreshCurrentFloorAnalysis()` calls
`analyzeCurrentFloor({force: true, reason: "manual-refresh"})`; that path enables
`preserveCurrentFloorState`, so target-slot Events may participate only as
comparison-only input. Both paths use the same target-external previous resolver;
`force=true` changes execution eligibility and the manual-refresh World routing,
not the historical baseline rule. Neither path may fall back to the target,
target Snapshot, Chat cache, `last_processed_floor`, or target registry as
previous history.

## 8. `last_processed_floor`

`last_processed_floor` is a Chat index hint for scheduling, interval checks,
performance, or UI status. It is not a Floor owner, cursor for historical
recovery, Event index, or registry validity marker.

It may be absent, reset, lower than a newly rebuilt projection, or higher
than the remaining message collection without changing which Floors are
valid. Recomputing active state must scan current messages and version-valid
slots. A value in this field can skip an automatic request, but it can never
supply `existing_bioweave`, restore a deleted subject, or keep a stale Event
active.

## 9. Mutation Safety

### Known-good persistence boundary (frozen)

The ordinary Floor persistence implementation is frozen at
`storage/floor-persistence-coordinator.js`. `runtime/floor-persistence.js` is
only a compatibility re-export. The frozen behavior includes the owner field
allowlist, same-Floor serialization, dispatch-time Chat/message/Floor/Swipe/
Version and execution checks, latest authoritative merge, sibling preservation,
host synchronization, direct official save/readback, confirmed commit
semantics, host-ahead bootstrap, true-stale fail-closed handling, terminal
supersede, cancellation/supersede protection, and Swipe 0 ownership.

This persistence boundary is `IMPLEMENTED`. Automated tests cover the
mechanism, and real SillyTavern World persistence final-save + F5/reload
durability is `REAL-HOST VERIFIED`. The manual host acceptance is separate from
automated test evidence, and the previously reported World reload persistence
issue is closed rather than a release blocker. The host adapter diagnostics
include `HOST_MEMORY_SLOT_BEFORE_SYNC`, `HOST_MEMORY_SLOT_AFTER_SYNC`, and
`FINAL_FLOOR_SLOT_AUDIT`.

World, Event/Character, Projection, Manual World, and approved Terminal paths
are ordinary writers only when they submit an owner-scoped patch to the
Coordinator. Chat/source clear, lifecycle root invalidation, migration/restore,
Chat metadata/settings, and the Auto prerequisite host lifecycle/save boundary
are explicit special operations or host boundaries, not alternative ordinary
Floor writers. Analysis routing, prompt/input, UI, and Tracking work MUST NOT
change this boundary without a separate persistence root-cause task and a new
real-host durability validation.

Business code uses the existing Floor storage abstraction for every Floor read
and write. The abstraction owns host compatibility, Chat scope checks, cloning
and the ordinary-message/per-Swipe slot distinction. Callers do not
double-write host fields, directly mutate `message.extra` or
`message.swipe_info[swipe_id].extra`, or write a Chat-level Floor history map.

The current feature-to-file map is maintained in
[`docs/ARCHITECTURE.md`](../../../docs/ARCHITECTURE.md). In particular,
`runtime/sillytavern-adapter.js` may expose raw host Floor-slot read/write
primitives, but it does not own Floor Version checks, owner acquisition,
host-ahead classification, sibling merge, or confirmed persistence policy.
Those decisions remain outside the Adapter and ordinary owner-scoped writes
still enter through the Coordinator. Raw host access is therefore not a
second Floor storage abstraction.

Ordinary writes are submitted to the single `FloorPersistenceCoordinator` as
owner-scoped patches. World may patch only `world_model` and
`world_model_meta`; Event/Character may patch only `analysis`, `events`, and
`character_registry`; Projection may patch only `snapshot`,
`projection_timeline`, and `projection_timing_snapshot`; Tracking may patch
only `tracking_window_timeline`; Participant Aggregation may patch only
`participant_aggregation_snapshot`; Lifecycle may patch only
`pregnancy_lifecycle_timeline` and `events`; Health may patch only
`health_assessment_timeline`. The coordinator serializes the same
Chat/message/Floor/Swipe/Version key, reacquires the live owner immediately
before dispatch, merges the latest authoritative slot, and confirms only after
official readback plus sibling audit. `FLOOR_TX_*` traces are diagnostics, not
business events. Clear, restore, migration, and explicit lifecycle
invalidation remain special low-level operations with separate guards.

Terminal failure/cancellation patches are checked again at dispatch time and
cannot overwrite an already confirmed Event `analysis.status=success` from
the same or a later attempt on the same Floor Version. A newer terminal
failure may still record the outcome of a later formal reanalysis, and a later
valid Event success may replace an earlier terminal failure through the normal
latest-slot merge.

Successful analysis replaces the existing owner slot with the complete
current-version result. Failed, cancelled, stale-Chat, or invalid responses
must not commit new Events or derived facts. Preserving a prior successful
result for diagnostics does not make it active when its source version is
stale. Registry rebuilds occur from the current active collection and drop
orphan Event IDs, candidates, subjects, and event-derived references.

Event edits validate the complete affected Event collection before saving.
Event edit/delete is target-Floor-local and must not invalidate independent
downstream Floors; only destructive Host timeline mutations such as an actual
message deletion or rollback may clear affected downstream Floor slots.
Deletion and lifecycle refreshes rebuild from current storage rather than
depending on one handler to erase every projection. Chat configuration and
independent identity/configuration semantics remain intact while
Floor-derived fields are invalidated.

No second historical database, permanent Floor ID ledger, or alternate
business writer is introduced to make lifecycle behavior appear durable.

## 10. Concrete Runtime Guardrails

### 1. Scope / Trigger

This section makes the ownership contract executable at the storage, Runtime,
Tracking, and API boundaries. It is required whenever a change can make a
Floor-derived value survive message deletion, Swipe deletion/switching,
version changes, reload, or an asynchronous analysis completion.

### 2. Signatures

- `store.getFloor(messageId, swipeId)` reads the requested message/Swipe owner;
  `store.getActiveFloor(messageId)` selects the current host active Swipe.
- `store.saveFloor(messageId, swipeId, data)` writes one existing owner slot and
  rejects a missing structured Swipe with `SWIPE_NOT_FOUND`.
- World Model resolution is exposed by the World/Floor boundary (for example,
  `resolveWorldModelAtOrBefore` and `resolveWorldModelStrictlyBefore`). It is
  not a Character Registry helper. A shared traversal primitive, if needed,
  must remain unaware of World Model, Events, analysis, and registry meaning.
- `findPreviousSuccessfulBioWeave(target)` returns either the nearest valid
  `{ analysis, events, character_registry }` from one Floor owner or exactly
  `{ analysis: null, events: [], character_registry: emptyRegistry }`.
- `rebuildTrackingRegistry(activeEvents, chatConfig)` returns the materialized
  `tracking_subjects`, `tracking_candidates`, and event-derived
  `character_profiles` for that `activeEvents` collection. It must not own,
  write, or refresh Floor `world_model` / `world_model_meta`; World Model is
  passed to Event Analysis only as an already resolved input DTO.

### 3. Contracts

- A structured message is readable only through
  `swipe_info[swipe_id].extra.bioweave` for an existing current Swipe. The
  active-message mirror, another Swipe, Chat Metadata, and runtime cache are
  not fallbacks.
- `activeEvents`, Tracking projections, API `existing_bioweave`, and all future
  Floor-derived history are functions of current valid Floor slots and complete
  six-field Versions. A Chat projection may be persisted for speed, but a read
  must be correct when that projection is stale or absent.
- `character_registry` in a successful Floor owner contains the cumulative
  canonical identity snapshot as of that Floor (`character_id`, display name,
  aliases). Its validity is bound to the same successful analysis and complete
  six-field Floor Version. It may only be read from the current valid
  message/per-Swipe owner. Cumulative does not mean global authoritative
  ownership.
- A Chat-level `character_registry`, if retained, is only a materialized
  projection/cache. It is not an
  Analyzer historical source and cannot restore a deleted, stale, or
  Swipe-inactive snapshot. Current Character Card/Persona/World Model data
  remains independent configuration/context; historical World Model data is
  read only from its own valid Floor owner.
- Character/Event analysis, identity resolution, Character Registry updates,
  Tracking rebuilds, and Event CRUD must preserve valid Floor World Model
  fields. World Model AI/manual saves must preserve valid analysis, Events, and
  Character Registry fields. A combined update helper is forbidden.
- `last_processed_floor` is recomputed from current successful valid Floors when
  needed for scheduling. It never supplies historical input or validates a fact.

### 4. Validation & Error Matrix

| Condition | Required result |
|---|---|
| Structured active Swipe or its owner slot is absent | Read the empty Floor shape; do not read a mirror or create a slot; a save fails with `SWIPE_NOT_FOUND`. |
| Stored Floor Version is incomplete, stale, or differs from current text/Swipe | Exclude its analysis and Events from active state and previous/API history. |
| Candidate is the target Floor, not lower, not current active Swipe, or not `success` | Skip it and continue scanning older messages. |
| No candidate passes every previous-state check | Pass `{ analysis: null, events: [], character_registry: emptyRegistry }`; never consult Chat derived state or a cache. |
| Chat invalidation, owner deletion, or Version change happens during analysis | Abort/ignore the old execution and do not save its Events or terminal facts to a different owner. |
| Current valid Floor collection changes | Rebuild subjects, candidates, profiles, references, counts, and API history from that collection. |

### 5. Good / Base / Bad Cases

- **Good**: `3F -> A`, `6F -> B`, `9F -> C`; reanalyzing `9F` sends `B`, then
  deleting `9F` makes a later target use `B` again.
- **Base**: all analyzed owner messages are removed; reload produces empty
  active Events, empty previous, and empty event-derived Tracking state while
  preserving independent identity/configuration values.
- **Bad**: `Math.max(oldLastProcessed, targetFloor)`, merging an old
  `tracking_candidates` map, or falling back from a missing Swipe slot to
  `message.extra` resurrects a fact without current Floor provenance.

### 6. Tests Required

Regression tests must assert both the source and the API sink: target
self-exclusion and nearest previous; deletion/truncation fallback; empty
previous; Swipe isolation/deletion; stale Version invalidation; current-facts-
only Tracking rebuild; in-flight invalidation; hint recomputation; and reload
after deleting all analyzed owners. Request bodies must not contain deleted
Event IDs, profile evidence, or derived candidates.

### 7. Wrong vs Correct

```js
// Wrong: a stale Chat projection authorizes the next analysis.
const profiles = chatData.character_profiles;
const candidates = chatData.tracking_candidates;

// Correct: Chat fields are only the destination of a rebuild.
const activeEvents = collectCurrentValidFloorEvents();
const registry = rebuildTrackingRegistry(activeEvents, {
  world_model: resolveWorldModelStrictlyBefore(target)?.model ?? null,
});
const previous = findPreviousSuccessfulBioWeave(target);
```

## 11. Feature Development Checklist

Before adding any cross-Floor feature, answer all of these questions in the
design and executable tests:

1. Is each value a Floor fact, authoritative configuration, or derived state?
   For a disease tracker, identify the diagnosis/exposure fact and the derived
   current disease state separately.
2. If the Floor that produced the fact is deleted, should the fact continue to
   exist?
3. If it should not continue to exist, does it naturally disappear from every
   derived projection and API input?
4. Are Swipe A and Swipe B completely isolated, including after switching or
   deleting one Swipe?
5. Does a Floor Version change immediately invalidate the old fact and its
   provenance?
6. Does Chat Metadata contain a second copy of a Floor-derived fact, or is it
   only A-configuration or a rebuildable B-projection?
7. Can API input reference a Floor, Swipe, Event, or derived fact that no
   longer exists or is no longer version-valid?
8. Can plugin reload, Chat reload, history truncation, and multi-Floor
   deletion rebuild the correct state using only current valid Floors?

The implementation must also keep `last_processed_floor` as a hint, use the
Floor storage abstraction, and include regression assertions for target
self-exclusion, nearest valid previous, empty previous, active-Swipe
isolation, stale-version invalidation, deleted-owner exclusion, API
provenance, and orphan-free derived state. If any answer is unclear, do not
implement the feature yet.

## 12. Snapshot checkpoint contract

### 12.1 Scope / Trigger

Snapshot is a derived/cache checkpoint of the Current State already reduced
from valid Floor Events. It is not an authoritative fact source, Event
replacement, Chat database, Projection, or probability result. This contract
applies whenever a Floor-owned `snapshot` root is created, validated, cleared,
or restored.

### 12.2 Signatures

- `createSnapshot({checkpoint, state, owner?, expectedChatId?, expectedFloorVersion?})`
  returns a deep-cloned validated Snapshot or throws `SNAPSHOT_INVALID`.
- `validateSnapshot(snapshot, {owner?, expectedChatId?, expectedFloorVersion?, currentFloorVersion?})`
  returns `{ok, errors[]}`.
- `shouldSnapshot({characterFloors, lastSnapshotCheckpoint?, interval?, majorEvent?})`
  counts ordered valid Character Floor checkpoints, ignoring User messages.
- `restoreFromSnapshot({snapshot, events, currentStoryTime?, characterFacts?, reducer?})`
  calls `reduceState({baseState: snapshot.state, events, currentStoryTime,
  characterFacts})`.

### 12.3 Contracts

The Snapshot DTO is `{schema_version: 1, checkpoint: FloorVersion, state:
CurrentState}`. The checkpoint contains exactly the six Floor Version fields.
The owner is `message.extra.bioweave` for a Character/assistant message without
Swipe structure, or `message.swipe_info[swipe_id].extra.bioweave` for every
structured Swipe including `swipe_id = 0`. Chat metadata and User messages can
never own this field. The default checkpoint interval is three valid Character
Floors after the previous checkpoint; it is not based on `floor % interval`.
Missing or rejected Snapshot data leaves full replay available.

### 12.3.1 Current Runtime implementation

The current Runtime uses this contract in production. After successful
Character/Event analysis, the checkpoint bridge may persist a Snapshot at the
configured interval. The current state read path resolves the nearest valid
complete Event state and calls `reduceState()` once with that complete active
Event set. It does not replay `events` from multiple complete Floors on top of
a Snapshot; this prevents unchanged inherited Events from being applied more
than once. The read path does not create or rewrite a Snapshot.

`reduceState()` is a derived-state reducer, not an authoritative fact store. Its
input includes `baseState`, `events`, `currentStoryTime`, and `characterFacts`.
When `currentStoryTime` advances without a new Event, replay can update the
transient timing decision without creating a conception, pregnancy,
confirmation, or other biological Event.

### 12.4 Validation & Error Matrix

| Condition | Required behavior |
| --- | --- |
| Wrong Snapshot or State schema | Return validation failure; do not restore |
| Incomplete or extra checkpoint fields | Return validation failure |
| Wrong Chat, Swipe, content hash, message version, or owner Floor Version | Return validation failure |
| Normalized user/system/other message owner | Return `snapshot_owner_not_character_floor` |
| Checkpoint after current endpoint | Return `snapshot_checkpoint_in_future` |
| Missing/deleted/corrupt Snapshot | Use full replay; never alter Events |

### 12.5 Good / Base / Bad Cases

- Good: Character Floors A/B/C reach interval three, and Swipe 0 validates by
  its exact `swipe_info[0]` owner.

### 12.6 Projection, Contributor, and Eligibility Domain (Phase 2D-2)

The pure Projection domain is separate from Snapshot and StateReducer. A
Projection describes a possible future biological development based on valid
Events, Current State, Story Time, World Model mechanism rules, and Character
Facts; it cannot create or change a BiologicalEvent, factual episode, Current
State, or Snapshot. Its identity is Chat scope + subject + projection rule +
development concern; source Event IDs are provenance only. Later evidence and
lifecycle changes are append-only records and never rewrite the creating Floor.

Factual lifecycle actions are `realized`, `contradicted`, and `expired`. User
`deleted` is a separate visibility dimension. A same-position factual conflict
is reported as a conflict and does not select a status by enum precedence.
Aggregation receives the ordered surviving Character Floor/active-Swipe timeline;
Floor Version identity fields are validation data, not chronology. Phase 2D-1.1
also defines pure `ReproductiveSourceCandidate` and `ContributorAttribution` read
contracts. Candidate is derived and never becomes an attribution Event; only
confirmed/excluded factual attribution Events may establish contributor relations.
StateReducer consumes confirmed attribution Events only when the referenced
Pregnancy Episode already exists, and stores multiple contributor relationships
under that episode. Probable/ambiguous/negated/fictional attribution cannot alter
that factual state; an orphan attribution produces a diagnostic and does not create
an episode. A confirmed/excluded conflict is fail-closed. Phase 2D-2 adds only pure
World Model `projection_rules[]` eligibility/evolution evaluation. It returns
`eligible`/`not_eligible`/`unresolved` and lifecycle decisions without creating
facts, Events, persistence, Runtime, UI, or Context output. Story Time can satisfy
a rule trigger but cannot establish biological occurrence.
- Base: no Snapshot exists; `reduceState({events})` remains the complete path.
- Bad: save `snapshot` in `chatMetadata`, `message.extra` of a structured
  Swipe, or a User message; read a different Swipe; or pass Snapshot as
  `events` instead of `baseState`.

### 12.6 Tests Required

- Full replay and Snapshot-plus-later-Events produce deep-equal Current State.
- Snapshot creation/restore do not share mutable references.
- Invalid schema, Chat, Floor Version, hash, message version, Swipe, and User
  owner are rejected; Swipe 0 is covered explicitly.
- User messages do not advance Character Floor checkpoint progression.
- Restore input contains `baseState` and never a legacy `snapshot` reducer key.

### 12.7 Wrong vs Correct

Wrong:

```js
reducer({ snapshot, events });
```

Correct:

```js
reduceState({ baseState: snapshot.state, events, currentStoryTime, characterFacts });
```

No Wave 1 implementation adds dependency graphs or cascades future Snapshot
invalidation when an old intermediate Floor is deleted.

## 13. Data lifecycle pointer

The detailed clear, Chat-boundary, mutation, async, and persistence contract is
maintained in [BioWeave Data Lifecycle](../../../docs/bioweave-data-lifecycle.md).
This pointer does not replace or alter the Floor ownership rules above.

Lifecycle implementations MUST preserve this contract while applying the
registry-driven rules:

- Manual Character and World clear may invalidate their derived
  Snapshot/Projection state, but retain valid Floor `analysis`, `events[]`,
  and Floor-owned `character_registry` identity snapshots.
- Manual All and verified Start New Chat source cleanup remove the BioWeave
  root from the Chat and from every ordinary message and exact
  `swipe_info[*]` owner, including inactive/history Swipes, while preserving
  text and unrelated fields.
- Ordinary `CHAT_CHANGED` loads the target and preserves the source. A
  destructive source clear requires an immutable source identity, a one-shot
  transition token, official lifecycle evidence, and post-save owner checks;
  a bare `CHAT_CREATED` never supplies that proof.
- Outside the Generation gate, ordinary `CHAT_CHANGED` is a read-only Chat
  rebind: clear the old Projection Context slot first, rebuild current
  read-only registry/scheduler state, and restore existing Projection/Health
  Guidance views without Projection processing, lifecycle ticks, automatic
  recovery, Analyzer work, delivery submission, or any Floor persistence.
  Generation-gated Chat changes remain deferred to the existing settle handoff.
- Edit, deletion, Swipe changes, and async completions continue to use the
  complete six-field Floor Version and reject stale provenance or late writes.

## 13.1 Generation-settled automatic Projection execution

### 13.1.1 Scope / Trigger

This contract applies when automatic Character/Event analysis reaches factual
success while a SillyTavern generation intent is still pending. Factual success
does not authorize Projection processing until the final Character Floor has
passed the Generation settle barrier.

### 13.1.2 Signatures

- `setGenerationAutomaticWorkDeferred(deferred)` marks automatic post-analysis
  work as generation-gated Runtime state.
- `flushDeferredProjectionPostProcessor({target})` releases at most the deferred
  execution whose complete Floor Version exactly matches `target.version`.
- `projectionRuntime.process({..., dedupeCompleted: true})` is used only by
  automatic factual-success and lifecycle-recovery paths.

### 13.1.3 Contracts

The deferred execution is Runtime-transient, keeps only the newest automatic
Floor execution, and is cleared on Chat boundary, stop/cancel without a final
Floor, stale final Floor, or Runtime destroy. After a successful automatic
Projection process, only the latest complete execution identity/result may be
retained for immediate sequential duplicate suppression. The identity includes
Chat, active Swipe, complete Floor Version, Events, source candidates, current
state, Story Time, and World projection rules. It is not persisted and cannot
authorize a write after any of those inputs change.

If a newer Character Floor has already caused the lifecycle intent to be
superseded, the matching deferred postprocessor remains releasable: the later
`GENERATION_ENDED` signal may release the active host gate when no newer
generation intent remains, then flushes only the current exact Floor Version.
Clearing the intent must not silently discard a deferred Projection or create a
second handoff.

### 13.1.4 Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Generation still pending | Defer automatic postprocessor; no Projection process or Floor write |
| Final render already superseded the lifecycle intent, then matching `GENERATION_ENDED` arrives | Release the active gate and flush the exact current deferred Floor once; do not require a stale completed-intent marker |
| Final target is absent or version-mismatched | Clear deferred work and fail closed |
| Same successful automatic execution arrives sequentially | Skip with `PROJECTION_ALREADY_COMPLETED` |
| Prior execution was partial, failed, or stale | Do not cache as complete; permit guarded retry |
| Manual analysis or event edit/delete | Preserve its explicit existing behavior; do not apply automatic completed-input dedupe |
| Chat change or Runtime destroy | Clear deferred and completed Runtime hints |

The explicit Manual Character analysis port waits for its non-deferred
Projection/Storyline postprocessor before resolving. This is only a completion
ordering guarantee for the following current-Floor read; it does not change
Generation gating, scheduler counting, Floor ownership, or the automatic
completed-input dedupe contract.

### 13.1.5 Good / Base / Bad Cases

- Good: factual success arrives before `GENERATION_ENDED`; Projection remains
  idle until the matching final Character Floor settles, then runs once.
- Base: factual success occurs outside generation; the postprocessor runs
  immediately with the normal owner/version guards.
- Bad: run once at factual success and again at `GENERATION_ENDED`, causing two
  Projection lifecycle passes and duplicate Host save opportunities.

### 13.1.6 Tests Required

- Assert generation-active factual success emits a deferred trace and zero
  `PROJECTION_PROCESS_STARTED` records before settle.
- Assert the matching final Floor emits one release and one Projection process
  across both Character-rendered/Generation-ended event orders.
- Assert a sequential duplicate with identical complete inputs performs one
  persistence batch, while a partial result remains retryable.
- Assert Chat/Floor/version change, stop/cancel, lease expiry, Swipe/reroll, and
  destroy cannot release stale deferred work.

### 13.1.7 Wrong vs Correct

Wrong: invoke Projection immediately from factual success and rely only on an
in-flight map; a later terminal event can run the same input again after the
first promise settles.

Correct: defer the automatic postprocessor behind the Generation settle
barrier, release only the exact final Floor once, and use bounded completed-input
dedupe as a secondary guard for automatic lifecycle notifications.

The lifecycle registry is the source of truth for any future persisted field;
new fields require domain, exact owner/location, clear and mutation behavior,
provenance, async guards, and contract-test coverage before acceptance.

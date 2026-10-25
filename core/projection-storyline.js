import { deterministicDigest } from './projection.js'

export const PROJECTION_STORYLINE_SCHEMA_VERSION = 1
export const STORYLINE_STATES = Object.freeze(['candidates', 'selected', 'terminated'])
export const STORYLINE_PROGRESS = Object.freeze(['stay', 'advance', 'awaiting_outcome'])
export const STORYLINE_DELIVERY_KINDS = Object.freeze(['submission', 'response'])

const FLOOR_FIELDS = ['chat_id', 'message_id', 'floor', 'swipe_id', 'content_hash', 'message_version']
const FORBIDDEN = new Set(['prompt', 'raw_prompt', 'raw_response', 'probability', 'cycle_id', 'pregnancy_id', 'outcome', 'fact'])
const clone = value =>
  value == null || typeof value !== 'object'
    ? value
    : typeof structuredClone === 'function'
      ? structuredClone(value)
      : Array.isArray(value)
        ? value.map(clone)
        : Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clone(v)]))
const text = value => (typeof value === 'string' && value.trim() ? value.trim() : null)
const record = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const unique = value => Array.isArray(value) && value.length > 0 && value.every(item => text(item)) && new Set(value).size === value.length
const uniqueOrEmpty = value => Array.isArray(value) && value.every(item => text(item)) && new Set(value).size === value.length
const floorVersion = value =>
  record(value) &&
  FLOOR_FIELDS.every(key => Object.hasOwn(value, key)) &&
  text(String(value.chat_id)) &&
  text(String(value.message_id)) &&
  Number.isFinite(Number(value.floor)) &&
  Number.isFinite(Number(value.swipe_id)) &&
  text(value.content_hash) &&
  text(String(value.message_version))
function unexpected(value, allowed, path, errors) {
  if (!record(value)) return
  for (const key of Object.keys(value)) if (!allowed.has(key) || FORBIDDEN.has(key)) errors.push(`${path}.${key}:unexpected`)
}

export function buildStorylineBranchId({ subjectId, ordinal, sourceFloor } = {}) {
  return `storyline_branch_${deterministicDigest({ schema_version: PROJECTION_STORYLINE_SCHEMA_VERSION, subject_id: subjectId, ordinal, source_floor: sourceFloor })}`
}
export function buildStorylineJudgeAttemptId(value = {}) {
  return `storyline_judge_attempt_${deterministicDigest({
    schema_version: PROJECTION_STORYLINE_SCHEMA_VERSION,
    subject_id: value.subject_id,
    status: value.status,
    branches: value.branches ?? [],
    selected_branch_id: value.selected_branch_id ?? null,
    current_node_index: value.current_node_index ?? 0,
    valid_body_count: value.valid_body_count ?? 0,
    counted_response_ids: value.counted_response_ids ?? [],
  })}`
}
export function buildStorylineDeliveryId(value = {}) {
  return `storyline_delivery_${deterministicDigest({ schema_version: PROJECTION_STORYLINE_SCHEMA_VERSION, kind: value.kind, subject_id: value.subject_id, response_id: value.response_id ?? null, floor_version: value.floor_version, context_fingerprint: value.context_fingerprint ?? null })}`
}

function normalizeNode(node = {}, index = 0, legacyConclusionGoal = '') {
  return {
    node_id: text(node.node_id) || `node_${index + 1}`,
    title: text(node.title) || '',
    objective: text(node.objective) || '',
    completion_signal: text(node.completion_signal) || '',
    conclusion_goal: text(node.conclusion_goal) || legacyConclusionGoal || '',
  }
}
function normalizeBranch(branch = {}, ordinal = 0, { subjectId = null, sourceFloor = null } = {}) {
  const legacyConclusionGoal = text(branch.conclusion_goal) || ''
  const nodes = Array.isArray(branch.nodes) ? branch.nodes.map((node, index) => normalizeNode(node, index, legacyConclusionGoal)) : []
  return {
    branch_id: text(branch.branch_id) || buildStorylineBranchId({ subjectId, ordinal, sourceFloor }),
    title: text(branch.title) || '',
    premise: text(branch.premise) || '',
    nodes,
  }
}

export function normalizeStorylineSnapshot(value = {}) {
  const source = clone(value)
  const branches = Array.isArray(source.branches)
    ? source.branches.map((branch, index) =>
        normalizeBranch(branch, index, { subjectId: source.subject_id, sourceFloor: source.created_at_floor_version?.floor }),
      )
    : []
  return {
    schema_version: PROJECTION_STORYLINE_SCHEMA_VERSION,
    subject_id: text(source.subject_id),
    display_name: text(source.display_name) || null,
    status: source.status || 'candidates',
    branches,
    selected_branch_id: text(source.selected_branch_id),
    current_node_index: Number.isInteger(source.current_node_index) ? source.current_node_index : 0,
    valid_body_count: Number.isInteger(source.valid_body_count) ? source.valid_body_count : 0,
    counted_response_ids: unique(source.counted_response_ids) ? [...source.counted_response_ids] : [],
    due_attempt_id: text(source.due_attempt_id),
    created_at_floor_version: clone(source.created_at_floor_version),
  }
}

export function validateStorylineSnapshot(value, { expectedChatId = null } = {}) {
  const errors = []
  if (!record(value)) return { ok: false, errors: ['storyline_snapshot:invalid'] }
  unexpected(
    value,
    new Set([
      'schema_version',
      'subject_id',
      'display_name',
      'status',
      'branches',
      'selected_branch_id',
      'current_node_index',
      'valid_body_count',
      'counted_response_ids',
      'due_attempt_id',
      'created_at_floor_version',
    ]),
    'storyline_snapshot',
    errors,
  )
  if (value.schema_version !== PROJECTION_STORYLINE_SCHEMA_VERSION) errors.push('storyline_snapshot.schema_version:invalid')
  if (!text(value.subject_id)) errors.push('storyline_snapshot.subject_id:required')
  if (!STORYLINE_STATES.includes(value.status)) errors.push('storyline_snapshot.status:invalid')
  if (!Array.isArray(value.branches)) errors.push('storyline_snapshot.branches:required')
  if (value.status === 'candidates' && value.branches.length !== 3) errors.push('storyline_snapshot.branches:must_be_three')
  if (value.status === 'selected' && value.branches.length !== 1) errors.push('storyline_snapshot.branches:must_be_one')
  if (value.status === 'terminated' && value.branches.length !== 0) errors.push('storyline_snapshot.terminated_not_empty')
  const ids = new Set()
  for (const branch of value.branches) {
    if (!record(branch) || !text(branch.branch_id) || ids.has(branch.branch_id)) errors.push('storyline_snapshot.branch_id:invalid')
    ids.add(branch.branch_id)
    if (!Array.isArray(branch.nodes) || branch.nodes.length < 3 || branch.nodes.length > 5)
      errors.push('storyline_snapshot.nodes:must_be_three_to_five')
    if (!text(branch.title) || !text(branch.premise)) errors.push('storyline_snapshot.branch_fields:required')
    for (const node of Array.isArray(branch.nodes) ? branch.nodes : []) {
      if (!text(node?.title) || !text(node?.objective) || !text(node?.completion_signal) || !text(node?.conclusion_goal))
        errors.push('storyline_snapshot.node_fields:required')
    }
  }
  if (value.status === 'selected' && (!text(value.selected_branch_id) || !ids.has(value.selected_branch_id)))
    errors.push('storyline_snapshot.selected_branch_id:invalid')
  if (!Number.isInteger(value.current_node_index) || value.current_node_index < 0) errors.push('storyline_snapshot.current_node_index:invalid')
  if (!Number.isInteger(value.valid_body_count) || value.valid_body_count < 0 || value.valid_body_count > 2)
    errors.push('storyline_snapshot.valid_body_count:invalid')
  if (!uniqueOrEmpty(value.counted_response_ids) || value.counted_response_ids.length > 2)
    errors.push('storyline_snapshot.counted_response_ids:invalid')
  if (!floorVersion(value.created_at_floor_version)) errors.push('storyline_snapshot.created_at_floor_version:invalid')
  if (expectedChatId !== null && String(value.created_at_floor_version?.chat_id) !== String(expectedChatId))
    errors.push('storyline_snapshot.created_at_floor_version:wrong_chat')
  return { ok: errors.length === 0, errors }
}

export function createStorylineSnapshot(value = {}) {
  const normalized = normalizeStorylineSnapshot(value)
  const result = validateStorylineSnapshot(normalized)
  if (!result.ok) throw new TypeError(result.errors.join(', '))
  return normalized
}
export function createStorylineDelivery(value = {}) {
  const normalized = {
    schema_version: PROJECTION_STORYLINE_SCHEMA_VERSION,
    delivery_record_id: value.delivery_record_id ?? null,
    kind: value.kind ?? null,
    subject_id: text(value.subject_id),
    response_id: text(value.response_id),
    floor_version: clone(value.floor_version),
    context_fingerprint: text(value.context_fingerprint),
    created_at_floor_version: clone(value.created_at_floor_version ?? value.floor_version),
  }
  normalized.delivery_record_id = buildStorylineDeliveryId(normalized)
  const result = validateStorylineDelivery(normalized)
  if (!result.ok) throw new TypeError(result.errors.join(', '))
  return normalized
}
export function validateStorylineDelivery(value, { expectedChatId = null } = {}) {
  const errors = []
  if (!record(value)) return { ok: false, errors: ['storyline_delivery:invalid'] }
  if (value.schema_version !== PROJECTION_STORYLINE_SCHEMA_VERSION) errors.push('storyline_delivery.schema_version:invalid')
  if (!text(value.delivery_record_id) || value.delivery_record_id !== buildStorylineDeliveryId(value)) errors.push('storyline_delivery.id:invalid')
  if (!STORYLINE_DELIVERY_KINDS.includes(value.kind)) errors.push('storyline_delivery.kind:invalid')
  if (!text(value.subject_id)) errors.push('storyline_delivery.subject_id:required')
  if (!text(value.response_id)) errors.push('storyline_delivery.response_id:required')
  if (!floorVersion(value.floor_version) || !floorVersion(value.created_at_floor_version)) errors.push('storyline_delivery.floor_version:invalid')
  if (expectedChatId !== null && String(value.floor_version?.chat_id) !== String(expectedChatId))
    errors.push('storyline_delivery.floor_version:wrong_chat')
  return { ok: errors.length === 0, errors }
}
export function emptyStorylineSnapshot({ subject_id, display_name = null, created_at_floor_version } = {}) {
  return createStorylineSnapshot({ subject_id, display_name, status: 'terminated', branches: [], created_at_floor_version })
}

export function applyStorylineJudge(snapshot, result = {}) {
  const current = normalizeStorylineSnapshot(snapshot)
  if (current.status === 'candidates') {
    if (!result.branch_id) return createStorylineSnapshot({ ...current, valid_body_count: 0, counted_response_ids: [], due_attempt_id: null })
    const branch = current.branches.find(item => item.branch_id === result.branch_id)
    if (!branch) throw new TypeError('storyline_judge:unknown_branch')
    return createStorylineSnapshot({
      ...current,
      status: 'selected',
      branches: [branch],
      selected_branch_id: branch.branch_id,
      current_node_index: 0,
      valid_body_count: 0,
      counted_response_ids: [],
      due_attempt_id: null,
    })
  }
  if (current.status !== 'selected') return current
  if (result.action === 'advance')
    return createStorylineSnapshot({
      ...current,
      current_node_index: Math.min(current.current_node_index + 1, current.branches[0].nodes.length),
      valid_body_count: 0,
      counted_response_ids: [],
      due_attempt_id: null,
    })
  if (result.action === 'stay' || result.action === 'awaiting_outcome')
    return createStorylineSnapshot({ ...current, valid_body_count: 0, counted_response_ids: [], due_attempt_id: null })
  throw new TypeError('storyline_judge:invalid_action')
}

export function recordStorylineBody(snapshot, responseId) {
  const current = normalizeStorylineSnapshot(snapshot)
  // A failed judge intentionally leaves the two-body window due.  Do not
  // accept a third response into that window: the next settled response must
  // retry the same due judge instead of overflowing the snapshot schema.
  if (current.status === 'terminated' || !text(responseId) || current.counted_response_ids.includes(responseId) || current.valid_body_count >= 2)
    return current
  const ids = [...current.counted_response_ids, responseId]
  const nextCount = current.valid_body_count + 1
  const next = { ...current, valid_body_count: nextCount, counted_response_ids: ids }
  if (nextCount >= 2) next.due_attempt_id = buildStorylineJudgeAttemptId(next)
  return createStorylineSnapshot(next)
}
export function storylineJudgeDue(snapshot) {
  const current = normalizeStorylineSnapshot(snapshot)
  return current.status !== 'terminated' && current.valid_body_count >= 2
}
export function storylinePromptPayload(snapshot) {
  const current = normalizeStorylineSnapshot(snapshot)
  if (current.status === 'candidates')
    return {
      subject_name: current.display_name || '相关人物',
      mode: 'select_one',
      branches: current.branches.map(branch => ({
        branch_id: branch.branch_id,
        title: branch.title,
        premise: branch.premise,
        opening_node: branch.nodes[0]?.objective || '',
        nodes: branch.nodes.map(node => ({
          title: node.title,
          objective: node.objective,
          completion_signal: node.completion_signal,
          conclusion_goal: node.conclusion_goal,
        })),
      })),
    }
  if (current.status === 'selected') {
    const branch = current.branches[0]
    const currentNode = branch.nodes[current.current_node_index] || branch.nodes.at(-1) || null
    return {
      subject_name: current.display_name || '相关人物',
      mode: 'continue_selected',
      branch_id: branch.branch_id,
      branch_title: branch.title,
      current_node: currentNode,
      conclusion_goal: currentNode?.conclusion_goal || '',
    }
  }
  return null
}
export function buildStorylineContextPrompt(snapshot) {
  const current = normalizeStorylineSnapshot(snapshot)
  if (current.status === 'terminated') return ''
  const body =
    current.status === 'candidates'
      ? current.branches
          .map((branch, index) => `${index + 1}. ${branch.title}：${branch.premise}；起始目标：${branch.nodes[0]?.objective || ''}`)
          .join('\n')
      : (() => {
          const branch = current.branches[0]
          const completed = current.current_node_index >= branch.nodes.length
          const node = branch.nodes[current.current_node_index] || branch.nodes.at(-1) || null
          return completed
            ? `当前支线：${branch.title}\n当前节点结论目标：${node?.conclusion_goal || ''}`
            : `当前支线：${branch.title}\n当前目标：${node?.objective || ''}\n当前节点结论目标：${node?.conclusion_goal || ''}`
        })()
  return `<bioweave-storyline>
角色：${current.display_name || '相关人物'}

【候选剧情】
${body}

【剧情调度】
- 必须主动创造合理条件推进剧情，不得仅因玩家没有主动接触相关人物而停滞。
- 本轮只能选择一条支线启动，启动后保持该支线连续性，不得擅自切换至其他候选支线。
- 支线的推进不依赖核心人物是否在场。
- 核心人物在场时，可通过直接互动、行动、对话及环境变化推进。
- 核心人物不在场时，必须根据当前场景和信息传播条件，选择合理的间接叙事方式推进。
- 不得为了推进剧情强行让核心人物出现在不合理的位置。

【场外推进】
当核心人物不在场时，可以采用以下方式：

1. 闲聊传播：其他人物自然谈及与支线有关的见闻、异常或消息。
2. 第三方转述：知情人物通过对话、汇报或询问传递事件进展。
3. 环境留痕：通过物品、记录、行动痕迹或环境变化体现事件的发展。
4. 消息传递：通过书信、传讯、公告、委托等符合世界观的渠道传播信息。
5. 关联人物行动：允许相关NPC在场外独立行动，并使其行动结果间接影响当前场景。
6. 延迟揭露：允许事件先在场外发生，在后续合适的场景中通过合理渠道揭示。

【叙事约束】
- 场外推进必须遵守人物位置、时间顺序、信息来源及认知边界。
- 不在场人物可以自主行动，但其行动不代表玩家已经知晓。
- NPC只能传播自己实际知道、亲眼见到或通过合理渠道获悉的信息。
- 传闻、猜测和事实必须区分，不得将未经证实的信息直接写成确定结论。
- 不要求每次推进都由核心人物亲自登场。
- 不得为了制造推进而强行插入与当前场景毫无联系的对话。
- 每次推进应产生合理的新变化，避免重复描述已经发生的事件。
- 不得跳过关键因果过程直接宣布支线完成。

【推进优先级】
- 优先选择与当前场景、在场人物及已有事件关联最自然的推进方式。
- 直接互动不合理时，优先使用间接叙事。
- 当前场景不存在合理的信息传播渠道时，允许支线在场外继续发展，等待合适时机揭露，不得强行让玩家获知。

【事实边界】
- 剧情中的身体异常仅属于待调查线索。
- 不得将症状、传闻、角色猜测或支线目标直接认定为怀孕事实。
- 必须通过符合剧情逻辑的调查和证据逐步揭示真相。
</bioweave-storyline>

`
}

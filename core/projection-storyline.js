import { deterministicDigest } from './projection.js'
import {normalizeFloorOwner} from './floor-owner.js'

export const PROJECTION_STORYLINE_SCHEMA_VERSION = 1
export const STORYLINE_STATES = Object.freeze(['candidates', 'selected', 'terminated'])
export const STORYLINE_PROGRESS = Object.freeze(['stay', 'complete', 'awaiting_outcome'])
export const STORYLINE_NODE_STATES = Object.freeze(['active', 'completed'])
export const STORYLINE_PROGRESSION_STATES = Object.freeze(['active', 'completed', 'awaiting_outcome'])
export const STORYLINE_PHASES = Object.freeze([
  'candidate_selection',
  'node_active',
  'progression_generation',
  'progression_active',
  'awaiting_outcome',
  'terminated',
])
export const STORYLINE_DELIVERY_KINDS = Object.freeze(['submission', 'response'])

const FLOOR_FIELDS = ['chat_id', 'message_id', 'floor', 'swipe_id']
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
  Number.isFinite(Number(value.swipe_id))
function unexpected(value, allowed, path, errors) {
  if (!record(value)) return
  for (const key of Object.keys(value)) if (!allowed.has(key) || FORBIDDEN.has(key)) errors.push(`${path}.${key}:unexpected`)
}

export function buildStorylineBranchId({ subjectId, ordinal, sourceFloor } = {}) {
  return `storyline_branch_${deterministicDigest({ schema_version: PROJECTION_STORYLINE_SCHEMA_VERSION, subject_id: subjectId, ordinal, source_floor: sourceFloor })}`
}
export function buildStorylineProgressionId(value = {}) {
  return `storyline_progression_${deterministicDigest({
    schema_version: PROJECTION_STORYLINE_SCHEMA_VERSION,
    source_node_id: value.source_node_id,
    title: value.title,
    guidance: value.guidance,
    completion_signal: value.completion_signal,
    conclusion_goal: value.conclusion_goal,
    created_at_floor_version: value.created_at_floor_version,
  })}`
}
export function buildStorylineJudgeAttemptId(value = {}) {
  return `storyline_judge_attempt_${deterministicDigest({
    schema_version: PROJECTION_STORYLINE_SCHEMA_VERSION,
    subject_id: value.subject_id,
    status: value.status,
    branches: value.branches ?? [],
    selected_branch_id: value.selected_branch_id ?? null,
    selected_node_id: value.selected_node_id ?? null,
    selected_node_status: value.selected_node_status ?? null,
    current_node_index: value.current_node_index ?? 0,
    valid_body_count: value.valid_body_count ?? 0,
    counted_response_ids: value.counted_response_ids ?? [],
  })}`
}
export function buildStorylineResponseId(value = {}) {
  if (!floorVersion(value)) throw new TypeError('storyline_response.floor_version:invalid')
  return `storyline_response:${String(value.chat_id)}:${String(value.message_id)}:${Number(value.floor)}:${Number(value.swipe_id)}`
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

function normalizeProgressionEvent(event = null) {
  if (!record(event)) return null
  const normalized = {
    progression_id: text(event.progression_id),
    source_node_id: text(event.source_node_id),
    status: text(event.status) || 'active',
    title: text(event.title) || '',
    guidance: text(event.guidance) || '',
    completion_signal: text(event.completion_signal) || '',
    conclusion_goal: text(event.conclusion_goal) || '',
    created_at_floor_version: normalizeFloorOwner(event.created_at_floor_version),
  }
  normalized.progression_id = normalized.progression_id || null
  return normalized
}

export function createStorylineProgressionEvent(value = {}) {
  const normalized = normalizeProgressionEvent(value)
  if (!normalized) throw new TypeError('storyline_progression_event:invalid')
  normalized.progression_id = buildStorylineProgressionId(normalized)
  const result = validateStorylineProgressionEvent(normalized)
  if (!result.ok) throw new TypeError(result.errors.join(', '))
  return normalized
}

export function validateStorylineProgressionEvent(value) {
  const errors = []
  if (!record(value)) return { ok: false, errors: ['storyline_progression_event:invalid'] }
  unexpected(
    value,
    new Set(['progression_id', 'source_node_id', 'status', 'title', 'guidance', 'completion_signal', 'conclusion_goal', 'created_at_floor_version']),
    'storyline_progression_event',
    errors,
  )
  if (!text(value.progression_id) || value.progression_id !== buildStorylineProgressionId(value)) errors.push('storyline_progression_event.progression_id:invalid')
  if (!text(value.source_node_id)) errors.push('storyline_progression_event.source_node_id:required')
  if (!STORYLINE_PROGRESSION_STATES.includes(value.status)) errors.push('storyline_progression_event.status:invalid')
  for (const key of ['title', 'guidance', 'completion_signal', 'conclusion_goal']) if (!text(value[key])) errors.push(`storyline_progression_event.${key}:required`)
  if (!floorVersion(value.created_at_floor_version)) errors.push('storyline_progression_event.created_at_floor_version:invalid')
  return { ok: errors.length === 0, errors }
}

export function normalizeStorylineSnapshot(value = {}) {
  const source = clone(value)
  const branches = Array.isArray(source.branches)
    ? source.branches.map((branch, index) =>
        normalizeBranch(branch, index, { subjectId: source.subject_id, sourceFloor: source.created_at_floor_version?.floor }),
      )
    : []
  const rawCurrentNodeIndex = Number.isInteger(source.current_node_index) ? source.current_node_index : 0
  const selectedBranch = branches.find(branch => branch.branch_id === text(source.selected_branch_id))
  // Older snapshots used current_node_index as a sequential cursor and could
  // legitimately point just past the final node.  Keep those snapshots
  // readable by binding the legacy cursor to its last node; the normalized
  // state still stores one immutable selected node and never advances it.
  const explicitSelectedNodeId = text(source.selected_node_id)
  const explicitSelectedNodeIndex = explicitSelectedNodeId
    ? (selectedBranch?.nodes?.findIndex(node => node.node_id === explicitSelectedNodeId) ?? -1)
    : -1
  const selectedNodeIndex =
    explicitSelectedNodeIndex >= 0
      ? explicitSelectedNodeIndex
      : selectedBranch?.nodes?.length
        ? Math.max(0, Math.min(rawCurrentNodeIndex, selectedBranch.nodes.length - 1))
        : 0
  const selectedNode = selectedBranch?.nodes?.[selectedNodeIndex] || null
  const selectedNodeId = source.status === 'selected' ? explicitSelectedNodeId || selectedNode?.node_id || null : null
  return {
    schema_version: PROJECTION_STORYLINE_SCHEMA_VERSION,
    subject_id: text(source.subject_id),
    display_name: text(source.display_name) || null,
    status: source.status || 'candidates',
    branches,
    selected_branch_id: text(source.selected_branch_id),
    selected_node_id: selectedNodeId,
    selected_node_status: source.status === 'selected' ? text(source.selected_node_status) || 'active' : null,
    current_node_index: source.status === 'selected' ? selectedNodeIndex : rawCurrentNodeIndex,
    valid_body_count: Number.isInteger(source.valid_body_count) ? source.valid_body_count : 0,
    counted_response_ids: unique(source.counted_response_ids) ? [...source.counted_response_ids] : [],
    due_attempt_id: text(source.due_attempt_id),
    progression_event: normalizeProgressionEvent(source.progression_event),
    created_at_floor_version: normalizeFloorOwner(source.created_at_floor_version),
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
      'selected_node_id',
      'selected_node_status',
      'current_node_index',
      'valid_body_count',
      'counted_response_ids',
      'due_attempt_id',
      'progression_event',
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
    const nodeIds = new Set()
    for (const node of Array.isArray(branch.nodes) ? branch.nodes : []) {
      if (!text(node?.node_id) || nodeIds.has(node.node_id)) errors.push('storyline_snapshot.node_id:invalid')
      nodeIds.add(node?.node_id)
      if (!text(node?.title) || !text(node?.objective) || !text(node?.completion_signal) || !text(node?.conclusion_goal))
        errors.push('storyline_snapshot.node_fields:required')
    }
  }
  if (value.status === 'selected' && (!text(value.selected_branch_id) || !ids.has(value.selected_branch_id)))
    errors.push('storyline_snapshot.selected_branch_id:invalid')
  if (!Number.isInteger(value.current_node_index) || value.current_node_index < 0) errors.push('storyline_snapshot.current_node_index:invalid')
  if (value.status === 'selected') {
    const branch = value.branches[0]
    const node = branch?.nodes?.find(item => item.node_id === value.selected_node_id)
    if (!text(value.selected_node_id) || !node) errors.push('storyline_snapshot.selected_node_id:invalid')
    if (!STORYLINE_NODE_STATES.includes(value.selected_node_status)) errors.push('storyline_snapshot.selected_node_status:invalid')
    if (node && value.current_node_index !== branch.nodes.indexOf(node)) errors.push('storyline_snapshot.current_node_index:mismatch')
    if (value.progression_event) {
      const progressionResult = validateStorylineProgressionEvent(value.progression_event)
      if (!progressionResult.ok) errors.push(...progressionResult.errors)
      if (value.progression_event.source_node_id !== value.selected_node_id)
        errors.push('storyline_snapshot.progression_event:wrong_source_node')
      if (value.selected_node_status !== 'completed') errors.push('storyline_snapshot.progression_event:node_not_completed')
    }
  } else if (value.selected_node_id !== null || value.selected_node_status !== null) {
    errors.push('storyline_snapshot.selected_node:unexpected')
  } else if (value.progression_event !== null) {
    errors.push('storyline_snapshot.progression_event:unexpected')
  }
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
    floor_version: normalizeFloorOwner(value.floor_version),
    context_fingerprint: text(value.context_fingerprint),
    created_at_floor_version: normalizeFloorOwner(value.created_at_floor_version ?? value.floor_version),
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
    if (!result.branch_id && !result.node_id)
      return createStorylineSnapshot({ ...current, valid_body_count: 0, counted_response_ids: [], due_attempt_id: null })
    if (!result.branch_id || !result.node_id) throw new TypeError('storyline_judge:partial_selection')
    const branch = current.branches.find(item => item.branch_id === result.branch_id)
    if (!branch) throw new TypeError('storyline_judge:unknown_branch')
    const nodeIndex = branch.nodes.findIndex(item => item.node_id === result.node_id)
    if (nodeIndex < 0) throw new TypeError('storyline_judge:unknown_node')
    return createStorylineSnapshot({
      ...current,
      status: 'selected',
      branches: [branch],
      selected_branch_id: branch.branch_id,
      selected_node_id: branch.nodes[nodeIndex].node_id,
      selected_node_status: 'active',
      current_node_index: nodeIndex,
      valid_body_count: 0,
      counted_response_ids: [],
      due_attempt_id: null,
    })
  }
  if (current.status !== 'selected') return current
  if (result.action === 'complete') {
    if (current.progression_event) {
      return createStorylineSnapshot({
        ...current,
        progression_event: {...current.progression_event, status: 'completed'},
        valid_body_count: 0,
        counted_response_ids: [],
        due_attempt_id: null,
      })
    }
    return createStorylineSnapshot({
      ...current,
      selected_node_status: 'completed',
      valid_body_count: 0,
      counted_response_ids: [],
      due_attempt_id: null,
    })
  }
  if (result.action === 'awaiting_outcome') {
    if (current.progression_event)
      return createStorylineSnapshot({
        ...current,
        progression_event: {...current.progression_event, status: 'awaiting_outcome'},
        valid_body_count: 0,
        counted_response_ids: [],
        due_attempt_id: null,
      })
    return createStorylineSnapshot({ ...current, valid_body_count: 0, counted_response_ids: [], due_attempt_id: null })
  }
  if (result.action === 'stay')
    return createStorylineSnapshot({ ...current, valid_body_count: 0, counted_response_ids: [], due_attempt_id: null })
  throw new TypeError('storyline_judge:invalid_action')
}

export function setStorylineProgressionEvent(snapshot, progressionEvent) {
  const current = normalizeStorylineSnapshot(snapshot)
  if (current.status !== 'selected') throw new TypeError('storyline_progression_snapshot:not_selected')
  if (current.selected_node_status !== 'completed') throw new TypeError('storyline_progression_snapshot:node_not_completed')
  const event = createStorylineProgressionEvent({
    ...progressionEvent,
    source_node_id: current.selected_node_id,
  })
  return createStorylineSnapshot({
    ...current,
    progression_event: event,
    valid_body_count: 0,
    counted_response_ids: [],
    due_attempt_id: null,
  })
}

export function recordStorylineBody(snapshot, responseId) {
  const current = normalizeStorylineSnapshot(snapshot)
  // A failed judge intentionally leaves the two-body window due.  Do not
  // accept a third response into that window: the next settled response must
  // retry the same due judge instead of overflowing the snapshot schema.
  if (
    current.status === 'terminated' ||
    (current.selected_node_status === 'completed' && !current.progression_event) ||
    current.progression_event?.status === 'completed' ||
    current.progression_event?.status === 'awaiting_outcome' ||
    !text(responseId) ||
    current.counted_response_ids.includes(responseId) ||
    current.valid_body_count >= 2
  )
    return current
  const ids = [...current.counted_response_ids, responseId]
  const nextCount = current.valid_body_count + 1
  const next = { ...current, valid_body_count: nextCount, counted_response_ids: ids }
  if (nextCount >= 2) next.due_attempt_id = buildStorylineJudgeAttemptId(next)
  return createStorylineSnapshot(next)
}
export function storylineJudgeDue(snapshot) {
  const current = normalizeStorylineSnapshot(snapshot)
  return current.status !== 'terminated' && !(current.selected_node_status === 'completed' && !current.progression_event) && current.progression_event?.status !== 'completed' && current.progression_event?.status !== 'awaiting_outcome' && current.valid_body_count >= 2
}
export function storylinePhase(snapshot) {
  const current = normalizeStorylineSnapshot(snapshot)
  if (current.status === 'terminated') return 'terminated'
  if (current.status === 'candidates') return 'candidate_selection'
  if (current.progression_event?.status === 'awaiting_outcome') return 'awaiting_outcome'
  if (current.progression_event?.status === 'active') return 'progression_active'
  if (current.progression_event?.status === 'completed' || current.selected_node_status === 'completed') return 'progression_generation'
  return 'node_active'
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
          node_id: node.node_id,
          title: node.title,
          objective: node.objective,
          completion_signal: node.completion_signal,
          conclusion_goal: node.conclusion_goal,
        })),
      })),
    }
  if (current.status === 'selected') {
    const branch = current.branches[0]
    const currentNode = branch.nodes.find(node => node.node_id === current.selected_node_id) || branch.nodes[current.current_node_index] || null
    return {
      subject_name: current.display_name || '相关人物',
      mode: 'continue_selected',
      branch_id: branch.branch_id,
      branch_title: branch.title,
      current_node: currentNode,
      selected_node_id: current.selected_node_id,
      selected_node_status: current.selected_node_status,
      progression_event: current.progression_event,
      progression_phase: storylinePhase(current),
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
          .map((branch, index) =>
            [
              `${index + 1}. ${branch.title}：${branch.premise}`,
              '候选节点（互相独立，正文只选其中一个）：',
              ...branch.nodes.map((node, nodeIndex) =>
                [
                  `  节点${nodeIndex + 1}：${node.title}`,
                  `    当前目标：${node.objective}`,
                  `    完成信号：${node.completion_signal}`,
                  `    结论目标：${node.conclusion_goal}`,
                ].join('\n'),
              ),
            ].join('\n'),
          )
          .join('\n')
      : (() => {
          const branch = current.branches[0]
          const node = branch.nodes.find(item => item.node_id === current.selected_node_id) || branch.nodes[current.current_node_index] || null
          if (current.progression_event?.status === 'active') {
            const event = current.progression_event
            return `当前支线：${branch.title}\n已完成入口：${node?.title || ''}\n当前推进事件：${event.title}\n推进引导：${event.guidance}\n完成信号：${event.completion_signal}\n当前推进事件结论目标：${event.conclusion_goal}\n推进事件状态：进行中`
          }
          if (current.progression_event?.status === 'awaiting_outcome') {
            const event = current.progression_event
            return `当前支线：${branch.title}\n已完成入口：${node?.title || ''}\n当前阶段：${event.title}\n阶段结论目标：${event.conclusion_goal}\n推进事件状态：等待事实结论`
          }
          if (current.progression_event?.status === 'completed')
            return `当前支线：${branch.title}\n已完成入口：${node?.title || ''}\n当前阶段：正在生成下一阶段推进事件\n推进事件状态：已完成`
          if (current.selected_node_status === 'completed')
            return `当前支线：${branch.title}\n已完成入口：${node?.title || ''}\n当前阶段：正在生成后续推进事件\n节点状态：已完成`
          return `当前支线：${branch.title}\n已选节点：${node?.title || ''}\n当前目标：${node?.objective || ''}\n完成信号：${node?.completion_signal || ''}\n当前节点结论目标：${node?.conclusion_goal || ''}\n节点状态：进行中`
        })()
  return `<bioweave-storyline>
角色：${current.display_name || '相关人物'}

【候选剧情】
${body}

【剧情调度】
- 必须主动创造合理条件推进剧情，不得仅因玩家没有主动接触相关人物而停滞。
- 本轮只能选择一条支线启动，启动后保持该支线连续性，不得擅自切换至其他候选支线。
- 每次推进都必须以当前世界观、人物关系、组织规则、资源条件、时间地点、信息流和近期正文为依据，形成可理解的因果链。
- 核心人物在场或不在场都可以推进；是否采用直接互动、间接影响、信息延迟、第三方行动、环境变化或其它方式，由当前上下文决定，不得预设固定机制。
- 不得为了推进剧情强行让核心人物或任何特定 NPC 出现在不合理的位置，不得凭空增加未被世界观支持的机构、身份、能力、渠道或关系。

【场外推进】
- 核心人物不在场时，允许事件在场外沿符合世界观的因果链发展；具体载体由当前上下文决定，不预设固定的信息传播、人物介入或环境变化方式。
- 场外发生的行动、信息和变化，只有在人物通过合理渠道获知后，才可以进入正文认知；不得把玩家未知内容直接写成已知事实。

【叙事约束】
- 推进必须遵守人物位置、时间顺序、信息来源、世界规则及认知边界。
- 不在场人物可以自主行动，但其行动不代表玩家已经知晓。
- 任何人物只能使用自己亲历、观察、听闻或依据合理渠道获悉的信息。
- 传闻、猜测和事实必须区分，不得将未经证实的信息直接写成确定结论。
- 不要求每次推进都由核心人物亲自登场，也不得强行插入与当前场景毫无联系的事件、对话或线索。
- 每次推进应产生合理的新变化，避免重复描述已经发生的事件。
- 不得跳过关键因果过程直接宣布支线完成。

【推进优先级】
- 优先选择与当前场景、在场人物、既有事件和世界规则关联最自然的推进方式。
- 如果当前场景无法承载推进，应让事件在符合世界观的时间、地点或因果条件下继续发展，待合理时机再揭示，不得强行让玩家获知。

【事实边界】
- 剧情中的身体异常仅属于待调查线索。
- 不得将症状、传闻、角色猜测或支线目标直接认定为怀孕事实。
- 必须通过符合剧情逻辑的调查和证据逐步揭示真相。
</bioweave-storyline>

`
}

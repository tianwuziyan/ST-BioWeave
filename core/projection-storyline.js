import { deterministicDigest } from './projection.js'
import { normalizeFloorOwner } from './floor-owner.js'
import { differenceStoryTime } from '../story/time.js'

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

function timingCandidate(value = {}) {
  const evidence = record(value?.aggregation_evidence) ? value.aggregation_evidence : {}
  const timing = record(value?.timing) ? value.timing : value
  return {
    subject_id: text(value?.subject_id),
    cycle_id: text(value?.cycle_id) || text(evidence.cycle_id),
    reference_story_time: timing?.reference_story_time ?? value?.reference_story_time ?? null,
  }
}

/**
 * Resolve the current subject's cycle start for model-facing storyline text.
 * The aggregation reference (the first qualifying exposure) is the anchor;
 * aggregation_story_time is deliberately never used as a cycle start.
 */
export function buildStorylineTimingContext({
  currentStoryTime = null,
  subjectId = '',
  participantAggregations = [],
  trackingWindows = [],
  referenceCandidates = [],
} = {}) {
  const subject = text(subjectId)
  if (!subject || !currentStoryTime) return null
  const aggregations = (Array.isArray(participantAggregations) ? participantAggregations : [])
    .filter(item => item?.status === 'succeeded')
    .map(timingCandidate)
    .filter(item => item.subject_id === subject && item.reference_story_time)
  const subjectWindows = (Array.isArray(trackingWindows) ? trackingWindows : []).filter(item => item?.subject_id === subject)
  const openCycles = new Set(
    subjectWindows
      .filter(item => item?.status === 'open')
      .map(item => text(item?.cycle_id))
      .filter(Boolean),
  )
  if (subjectWindows.length && openCycles.size !== 1) return null
  let candidates = aggregations
  if (openCycles.size === 1) candidates = candidates.filter(item => openCycles.has(item.cycle_id))
  if (!candidates.length) {
    candidates = (Array.isArray(referenceCandidates) ? referenceCandidates : [])
      .map(timingCandidate)
      .filter(item => item.subject_id === subject && item.reference_story_time)
    if (openCycles.size === 1) candidates = candidates.filter(item => !item.cycle_id || openCycles.has(item.cycle_id))
  }
  candidates = [...new Map(candidates.map(item => [`${item.cycle_id || ''}\u001f${JSON.stringify(item.reference_story_time)}`, item])).values()]
  if (candidates.length !== 1) return null
  const elapsed = differenceStoryTime(currentStoryTime, candidates[0].reference_story_time)
  if (!elapsed || !Number.isFinite(Number(elapsed.value))) return null
  const days = elapsed.unit === 'minute' ? Number(elapsed.value) / 1440 : Number(elapsed.value)
  if (!Number.isFinite(days) || days < 0) return null
  return {
    elapsed_display: formatStorylineElapsedDuration(days),
  }
}

export function formatStorylineElapsedDuration(days) {
  const value = Number(days)
  if (!Number.isFinite(value) || value < 0) return ''
  if (value < 7) return '约不到1周'
  const roundedDays = Math.max(7, Math.round(value))
  if (roundedDays < 30) {
    const weeks = Math.floor(roundedDays / 7)
    return `约${weeks}周（尚未满1个月）`
  }
  const months = Math.floor(roundedDays / 30)
  return `约${months}个月`
}

export function buildStorylineTimingPrompt(timing = null) {
  const elapsed = text(timing?.elapsed_display)
  if (!elapsed) return ''
  return `【本轮时间参考】\n本段用途：说明当前观察轮次从本轮起点到当前正文时间已经经过多久，用于约束剧情时间跨度。该时间仅是剧情时间参考，不是孕周或怀孕时长，不得把它改写成怀孕时长或医学结论。\n本轮已过去：${elapsed}\n`
}
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
  if (!text(value.progression_id) || value.progression_id !== buildStorylineProgressionId(value))
    errors.push('storyline_progression_event.progression_id:invalid')
  if (!text(value.source_node_id)) errors.push('storyline_progression_event.source_node_id:required')
  if (!STORYLINE_PROGRESSION_STATES.includes(value.status)) errors.push('storyline_progression_event.status:invalid')
  for (const key of ['title', 'guidance', 'completion_signal', 'conclusion_goal'])
    if (!text(value[key])) errors.push(`storyline_progression_event.${key}:required`)
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
      if (value.progression_event.source_node_id !== value.selected_node_id) errors.push('storyline_snapshot.progression_event:wrong_source_node')
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
        progression_event: { ...current.progression_event, status: 'completed' },
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
        progression_event: { ...current.progression_event, status: 'awaiting_outcome' },
        valid_body_count: 0,
        counted_response_ids: [],
        due_attempt_id: null,
      })
    return createStorylineSnapshot({ ...current, valid_body_count: 0, counted_response_ids: [], due_attempt_id: null })
  }
  if (result.action === 'stay') return createStorylineSnapshot({ ...current, valid_body_count: 0, counted_response_ids: [], due_attempt_id: null })
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
  return (
    current.status !== 'terminated' &&
    !(current.selected_node_status === 'completed' && !current.progression_event) &&
    current.progression_event?.status !== 'completed' &&
    current.progression_event?.status !== 'awaiting_outcome' &&
    current.valid_body_count >= 2
  )
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
export function buildStorylineContextPrompt(snapshot, { storylineTiming = null } = {}) {
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
  const timingPrompt = buildStorylineTimingPrompt(storylineTiming)
  return `<bioweave-storyline>
角色：${current.display_name || '相关人物'}

【候选剧情】
${body}${timingPrompt ? `\n\n${timingPrompt}` : ''}

【剧情调度】
- 必须根据当前候选或已选支线及其推进事件，主动创造合理条件推动剧情，不得仅因玩家没有主动接触相关人物而停滞。
- 候选阶段只能从候选支线中启动一条；一旦选定，就保持该支线的连续性，不得擅自切换至其他候选支线，也不得脱离既定推进目标另造无关事件。
- 每次推进必须依据当前世界观、人物关系、组织规则、资源条件、时间地点、信息来源及近期正文，形成合理的因果发展。
- 玩家、目标人物及当前场景中的人物都不是支线唯一的行动者。其他人物可以根据自身经历、认知、关系、职责和利益独立行动，不必等待玩家或目标人物主动接触。
- 不得默认支线必须围绕玩家展开，也不得默认目标人物必须亲自推动、亲自登场或立即得知事件进展。
- 可以通过直接互动、第三方行动、独立分镜、背景变化、时间经过、职业或组织流程、记录往来、消息传递等方式推进，具体方式由既有条件和事件需要决定。
- 不得为了执行支线而强行安排玩家、目标人物或特定 NPC 相遇、到场、突然知情或出现在不合理的位置。
- 不得凭空增加缺乏世界观依据的机构、身份、能力、渠道、关系或关键证据。

【场外独立执行】
- 支线可以在玩家和目标人物的视线之外真实发展。即使双方都没有参与、没有在场或不知道相关情况，其他人物、组织及既有条件仍可沿合理因果推动事件。
- 场外推进不要求玩家或目标人物作出响应。只要事件符合人物行动逻辑，并使原支线达到既定推进条件，就可以在场外完成。
- 场外事件可以发生在其他地点、其他时间或其他人物的日常活动中，不必为了连接当前场景而安排巧合相遇、突然来信、紧急通报或秘密暴露。
- 已有相关人物可以主动行动，但必须符合其信息来源、人物关系、职责、利益及现实处境。不得把曾经偶然接触过目标人物，直接当作持续关注或主动介入的充分理由。
- 场外事件可以直接产生重要变化，也可以通过符合因果的发展跨过不必要的中间过程，不必逐步展示所有调查、交流或准备动作。
- 允许省略不影响理解的过程，但不得跳过决定结果是否成立的关键原因，也不得为了达到预设答案而编造证据。
- 场外事件完成后，不要求立即将结果传达给玩家或目标人物；后续人物是否知情，应由正常的信息传播与剧情发展决定。

【场外事件的叙事呈现】
- 场外事件实际发生、正文如何呈现、玩家何时知情、目标人物何时知情，是相互独立的层次，不得混为一谈。
- 场外事件可以通过独立分镜、短暂视角切换、背景叙述、时间跳跃、人物闲谈、传闻、书信、记录、报告或事后转述等方式呈现。
- 不要求每次都为场外事件安排完整场景。对于不需要正面展开的支线进展，可以用简短背景交代、几句自然对话或一段短分镜呈现。
- 独立分镜和客观背景叙述可以直接展示其他人物真实发生的事件，不必先让玩家或目标人物获得相关消息。
- 闲谈、传闻、转述、书信、记录和报告等信息载体必须具有合理来源、传播路径与出现时机。信息可以不完整、失真或错误，不得把未经证实的说法直接当成客观事实。
- 不得为了让玩家知道场外进展而强行安排路人议论、巧合偷听、突然通报或无端泄密。
- 不得因为事件与当前场景距离较远，就禁止其在背景中发展；也不得为了展示支线而生硬打断当前正在进行的重要剧情。
- 应根据事件的重要程度和当前叙事节奏选择呈现篇幅。重要转折可以独立成段，次要但有效的进展可以简短带过。
- 如果当前时机不适合展示，可以让场外事件继续发生，并在之后合适的叙事节点自然揭示；不得因此停止事件本身的发展。

【人物行动与认知边界】
- 任何人物只能依据自己亲历、观察、听闻或通过合理渠道获得的信息行动。
- 人物可以根据不完整信息作出判断或选择，但判断不等于事实，猜测不等于真相。
- 玩家不知道的场外事件，不得直接写成玩家已经知道、理解或作出反应的事情。
- 目标人物没有获得相关信息时，也不得直接让其依据场外结果采取行动。
- 其他人物可以先于玩家或目标人物获得信息、采取行动或改变自身处境，不要求所有人的认知进度保持一致。
- 信息可以通过符合人物关系和现实处境的正常往来传播，但不得默认消息必然扩散，也不得让人物无缘无故掌握秘密。
- 第三方的作用不局限于救助、调查或揭露秘密，也可以是提供信息、改变决定、履行职责、调整关系或采取符合自身利益的行动。
- 不得为了让第三方发挥作用而制造突发危机、公开失控、巧合偷听或无关冲突。

【事件推进与完成】
- 执行时应围绕已生成推进事件的核心问题、guidance 和 completion_signal 展开，不得擅自改写支线目标。
- 推进事件是后续剧情的方向指引，不是已经发生的事实记录。执行时必须通过合理剧情使事件成立，不得直接把尚未确认的结果写成既定事实。
- 允许事件通过场外行动、独立分镜或背景叙述完成，不要求玩家参与、目标人物亲自行动或任何一方立即知情。
- 判断事件是否完成，应看原支线是否实际达到 completion_signal 所描述的关键变化，而不是看事件是否在玩家面前发生、是否被玩家听说或是否引发公开冲突。
- 场外事件可以改变人物关系、现实处境、可用资源、关键判断、行动条件或原支线的其他重要状态。
- 如果事件本身已经发生并产生有效变化，即使正文只用简短背景描写呈现，也可以视为完成。
- 如果只是增加闲谈、传闻、关注或消息传播，而原支线没有实际变化，则不能仅凭这些叙事表现认定事件完成。
- 不得重复已经发生的问诊、调查、争执或选择，也不得通过制造新症状、新危机或无关障碍代替真正的支线推进。
- 允许通过合理过程直接取得明确结果、完成重要选择或结束支线，但不得预先编造缺乏依据的答案、证据或事实。
- 不得跳过必要因果直接宣布事件完成，也不得为了维持悬念而阻止已经具备条件的结果出现。

【推进与呈现优先级】
- 优先选择最符合既有事实、人物动机和事件目标的推进方式，而不是默认当前场景、玩家互动或目标人物主动行动具有最高优先级。
- 如果当前场景能够自然承载推进，可以直接展开。
- 如果其他人物独立行动更合理，可以让事件在场外发展，不必强行转回玩家或目标人物身边。
- 如果事件适合简短交代，可以通过背景、闲谈、记录或短分镜呈现，不必扩写成完整冲突。
- 如果事件暂时不适合出现在当前正文中，可以让其在符合时间线的场外继续发展，待合理时机再揭示。
- 始终区分事件是否实际发生、正文是否呈现、玩家是否知情和目标人物是否知情，不得让其中一个条件成为其他条件的强制前提。

【事实边界】
- 必须区分已确认事实、人物认知和未确认结论。
- 剧情中的身体异常仅属于待判断的线索，不得直接认定为怀孕或其他特定原因。
- 不得将症状、传闻、角色猜测或支线目标直接当成已经成立的事实。
- 可以通过符合世界观与现有条件的合理过程确认、排除或推翻某种可能性，但不得为了得到预设结论而凭空制造证据、特殊能力或身体机制。
- 不得因当前尚未确认真相，就强制后续剧情继续保持不确定；条件充分时允许明确结果自然成立。
</bioweave-storyline>

`
}

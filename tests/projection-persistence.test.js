import test from 'node:test'
import assert from 'node:assert/strict'
import {createProjection, createProjectionEvidenceRecord, createProjectionLifecycleRecord} from '../core/projection.js'
import {emptyProjectionTimeline, appendProjectionCreation, appendProjectionEvidence, appendProjectionLifecycle, evolutionDecisionToLifecycleRecord, resolveProjectionTimeline} from '../core/projection-persistence.js'
import {createProjectionPersistence} from '../storage/projection.js'

function version(floor, swipe_id = 0, chat_id = 'chat-a') { return {chat_id, message_id: `message-${floor}`, floor, swipe_id, content_hash: `hash-${floor}-${swipe_id}`, message_version: `v${floor}-${swipe_id}`} }
function projection(floor = 10, chat_id = 'chat-a') {
  const floorVersion = version(floor, 0, chat_id)
  return createProjection({
    subject_id: 'char_000001', projection_rule_id: 'rule:change-v1', development_concern_key: 'concern:change',
    mechanism: {key: 'mechanism:implant', world_model_rule_refs: ['projection-rule:rule:change-v1']}, source_event_ids: ['event-1'],
    development: {kind: 'possible_biological_change', current_basis: {event_ids: ['event-1'], state_refs: ['state:char_000001'], mechanism_rule_refs: ['projection-rule:rule:change-v1']}, next_signal: '未来可能出现变化。'},
    timing: {trigger_kind: 'immediate_after_event', reference_event_id: 'event-1', reference_story_time: null, current_story_time: null, elapsed_story_days: null},
    created_at_floor_version: floorVersion, evidence_refs: ['event:event-1'],
  })
}

function fakeStore({messages, floors, activeSwipes = {}, chatId = 'chat-a', saveError = null}) {
  const state = {messages, floors, activeSwipes, chatId}
  return {
    state,
    getCurrentChatOwnerSnapshot(requestedChatId) { if (requestedChatId !== state.chatId) throw new Error('STALE_CHAT'); return {messages: state.messages} },
    getFloorOwner(selector, swipeId) {
      const message = state.messages[selector]
      if (!message) return null
      return {owner_type: message.role === 'user' ? 'user' : 'character', active_swipe_id: state.activeSwipes[selector] ?? 0, swipe_id: swipeId}
    },
    getActiveSwipeId(selector) { return state.activeSwipes[selector] ?? 0 },
    getFloor(selector, swipeId) { return structuredClone(state.floors[`${selector}:${swipeId}`] ?? {}) },
    async saveFloor(selector, swipeId, data) { if (saveError) throw new Error(saveError); state.floors[`${selector}:${swipeId}`] = structuredClone(data) },
  }
}

function setup({chatId = 'chat-a', ownerRole = 'assistant', swipe = 0, floors = {}, saveError = null} = {}) {
  const messages = [{message_id: 'message-10', role: ownerRole}, {message_id: 'message-13', role: 'assistant'}]
  const activeSwipes = {0: swipe, 1: 0}
  const store = fakeStore({messages, floors, activeSwipes, chatId, saveError})
  return {store, persistence: createProjectionPersistence({store, resolveCurrentFloorVersion: async ({floorVersion}) => floorVersion})}
}

test('Projection timeline separates creation, evidence, and lifecycle records', () => {
  const created = projection()
  const evidence = createProjectionEvidenceRecord({projection_id: created.projection_id, source_event_ids: ['event-2'], created_at_floor_version: version(13), evidence_refs: ['event:event-2']})
  const lifecycle = createProjectionLifecycleRecord({projection_id: created.projection_id, action: 'realized', created_at_floor_version: version(16), evidence_refs: ['event:event-3']})
  let timeline = emptyProjectionTimeline()
  timeline = appendProjectionCreation(created, {timeline, expectedChatId: 'chat-a'}).timeline
  timeline = appendProjectionEvidence(evidence, {timeline, expectedChatId: 'chat-a'}).timeline
  timeline = appendProjectionLifecycle(lifecycle, {timeline, expectedChatId: 'chat-a'}).timeline
  assert.equal(timeline.creations.length, 1)
  assert.equal(timeline.evidence_records.length, 1)
  assert.equal(timeline.lifecycle_records.length, 1)
  assert.equal(resolveProjectionTimeline([{floor_version: version(10), ...timeline}]).all[0].factual_status, 'realized')
})

test('Character Floor creation persists only in its active Swipe, including Swipe 0', async () => {
  const created = projection()
  const setupState = setup({floors: {'0:0': {floor_version: version(10), projection_timeline: emptyProjectionTimeline()}}})
  const result = await setupState.persistence.saveGeneratedProjection({chatId: 'chat-a', ownerFloor: {message_index: 0, swipe_id: 0}, floorVersion: version(10), projectionCandidate: created})
  assert.equal(result.status, 'appended')
  assert.equal(setupState.store.state.floors['0:0'].projection_timeline.creations.length, 1)
})

test('User Floor ownership is rejected and cannot create an empty payload', async () => {
  const created = projection()
  const {persistence, store} = setup({ownerRole: 'user', floors: {'0:0': {floor_version: version(10), projection_timeline: emptyProjectionTimeline()}}})
  await assert.rejects(() => persistence.saveGeneratedProjection({chatId: 'chat-a', ownerFloor: {message_index: 0, swipe_id: 0}, floorVersion: version(10), projectionCandidate: created}), /BIOWEAVE_USER_FLOOR_WRITE_FORBIDDEN/)
  assert.deepEqual(store.state.floors['0:0'].projection_timeline, emptyProjectionTimeline())
})

test('non-active Swipe payload is hidden and active Swipe 1 is isolated', async () => {
  const created = projection(10)
  const other = createProjection({...created, created_at_floor_version: version(10, 1), evidence_refs: ['event:swipe-1']})
  const {persistence, store} = setup({swipe: 0, floors: {
    '0:0': {floor_version: version(10, 0), projection_timeline: emptyProjectionTimeline()},
    '0:1': {floor_version: version(10, 1), projection_timeline: {schema_version: 1, creations: [other], evidence_records: [], lifecycle_records: []}},
  }})
  const views = await persistence.getProjectionViews({chatId: 'chat-a'})
  assert.equal(views.all.length, 0)
  store.state.messages[0].swipe_info = [{}, {}]
  store.state.activeSwipes[0] = 1
  const activeViews = await persistence.getProjectionViews({chatId: 'chat-a'})
  assert.equal(activeViews.all.length, 1)
  assert.equal(activeViews.all[0].projection_id, other.projection_id)
})

test('stale Floor Version and stale generation context reject before save', async () => {
  const created = projection()
  const {persistence, store} = setup({floors: {'0:0': {floor_version: version(10), projection_timeline: emptyProjectionTimeline()}}})
  await assert.rejects(() => persistence.saveGeneratedProjection({chatId: 'chat-a', ownerFloor: {message_index: 0, swipe_id: 0}, floorVersion: {...version(10), content_hash: 'edited'}, projectionCandidate: created}), /FLOOR_VERSION_STALE/)
  const {store: staleStore} = setup({floors: {'0:0': {floor_version: version(10), projection_timeline: emptyProjectionTimeline()}}})
  const guarded = createProjectionPersistence({store: staleStore, resolveCurrentFloorVersion: async () => ({...version(10), content_hash: 'edited'})})
  await assert.rejects(() => guarded.saveGeneratedProjection({chatId: 'chat-a', ownerFloor: {message_index: 0, swipe_id: 0}, floorVersion: version(10), projectionCandidate: created}), /FLOOR_VERSION_STALE/)
  assert.deepEqual(store.state.floors['0:0'].projection_timeline, emptyProjectionTimeline())
})

test('exact duplicate creation is idempotent and same identity with different payload conflicts', async () => {
  const created = projection()
  const {persistence, store} = setup({floors: {'0:0': {floor_version: version(10), projection_timeline: emptyProjectionTimeline()}}})
  const input = {chatId: 'chat-a', ownerFloor: {message_index: 0, swipe_id: 0}, floorVersion: version(10), projectionCandidate: created}
  assert.equal((await persistence.saveGeneratedProjection(input)).status, 'appended')
  assert.equal((await persistence.saveGeneratedProjection(input)).status, 'deduped')
  const changed = {...created, development: {...created.development, next_signal: '另一种可能方向。'}}
  await assert.rejects(() => persistence.saveGeneratedProjection({...input, projectionCandidate: changed}), /projection_id_conflict/)
  assert.equal(store.state.floors['0:0'].projection_timeline.creations.length, 1)
})

test('later evidence is append-only and removing its owner Floor rolls the view back', async () => {
  const created = projection(10)
  const evidence = createProjectionEvidenceRecord({projection_id: created.projection_id, source_event_ids: ['event-4'], created_at_floor_version: version(13), evidence_refs: ['event:event-4']})
  const {persistence, store} = setup({floors: {
    '0:0': {floor_version: version(10), projection_timeline: {schema_version: 1, creations: [created], evidence_records: [], lifecycle_records: []}},
    '1:0': {floor_version: version(13), projection_timeline: {schema_version: 1, creations: [], evidence_records: [], lifecycle_records: []}},
  }})
  await persistence.saveProjectionEvidence({chatId: 'chat-a', ownerFloor: {message_index: 1, swipe_id: 0}, floorVersion: version(13), evidenceRecord: evidence})
  const withEvidence = await persistence.getProjectionViews({chatId: 'chat-a'})
  assert.deepEqual(withEvidence.all[0].source_event_ids, ['event-1', 'event-4'])
  assert.equal(store.state.floors['0:0'].projection_timeline.creations[0].source_event_ids.includes('event-4'), false)
  delete store.state.floors['1:0']
  store.state.messages.splice(1, 1)
  assert.deepEqual((await persistence.getProjectionViews({chatId: 'chat-a'})).all[0].source_event_ids, ['event-1'])
})

test('evolution decisions persist only factual lifecycle actions', async () => {
  const created = projection(10)
  const {persistence, store} = setup({floors: {
    '0:0': {floor_version: version(10), projection_timeline: {schema_version: 1, creations: [created], evidence_records: [], lifecycle_records: []}},
    '1:0': {floor_version: version(13), projection_timeline: emptyProjectionTimeline()},
  }})
  assert.equal((await persistence.saveEvolutionDecision({chatId: 'chat-a', ownerFloor: {message_index: 1, swipe_id: 0}, floorVersion: version(13), projectionId: created.projection_id, decision: 'keep_active'})).status, 'skipped')
  assert.equal((await persistence.saveEvolutionDecision({chatId: 'chat-a', ownerFloor: {message_index: 1, swipe_id: 0}, floorVersion: version(13), projectionId: created.projection_id, decision: 'unresolved'})).status, 'skipped')
  assert.equal((await persistence.saveEvolutionDecision({chatId: 'chat-a', ownerFloor: {message_index: 1, swipe_id: 0}, floorVersion: version(13), projectionId: created.projection_id, decision: 'realized', evidenceRefs: ['event:realized']})).status, 'appended')
  assert.equal((await persistence.getProjectionViews({chatId: 'chat-a'})).all[0].factual_status, 'realized')
  assert.equal(store.state.floors['1:0'].projection_timeline.creations.length, 0)
})

test('Delete appends a lifecycle record, preserves creation, and is idempotent', async () => {
  const created = projection(10)
  const {persistence, store} = setup({floors: {
    '0:0': {floor_version: version(10), projection_timeline: {schema_version: 1, creations: [created], evidence_records: [], lifecycle_records: []}},
    '1:0': {floor_version: version(13), projection_timeline: emptyProjectionTimeline()},
  }})
  const first = await persistence.deleteProjection({chatId: 'chat-a', ownerFloor: {message_index: 1, swipe_id: 0}, floorVersion: version(13), projectionId: created.projection_id})
  assert.equal(first.status, 'appended')
  assert.equal((await persistence.getProjectionViews({chatId: 'chat-a'})).all[0].deleted, true)
  assert.equal((await persistence.getProjectionViews({chatId: 'chat-a'})).all[0].context_visible, false)
  assert.equal(store.state.floors['0:0'].projection_timeline.creations.length, 1)
  assert.equal((await persistence.deleteProjection({chatId: 'chat-a', ownerFloor: {message_index: 1, swipe_id: 0}, floorVersion: version(13), projectionId: created.projection_id})).status, 'deduped')
})

test('realized and deleted remain separate, and deleting later owners rolls the view back', async () => {
  const created = projection(10)
  const {persistence, store} = setup({floors: {
    '0:0': {floor_version: version(10), projection_timeline: {schema_version: 1, creations: [created], evidence_records: [], lifecycle_records: []}},
    '1:0': {floor_version: version(13), projection_timeline: emptyProjectionTimeline()},
  }})
  await persistence.saveEvolutionDecision({chatId: 'chat-a', ownerFloor: {message_index: 1, swipe_id: 0}, floorVersion: version(13), projectionId: created.projection_id, decision: 'realized'})
  store.state.messages.push({message_id: 'message-16', role: 'assistant'})
  store.state.floors['2:0'] = {floor_version: version(16), projection_timeline: emptyProjectionTimeline()}
  await persistence.deleteProjection({chatId: 'chat-a', ownerFloor: {message_index: 2, swipe_id: 0}, floorVersion: version(16), projectionId: created.projection_id})
  let view = (await persistence.getProjectionViews({chatId: 'chat-a'})).all[0]
  assert.equal(view.factual_status, 'realized')
  assert.equal(view.deleted, true)
  delete store.state.floors['2:0']
  store.state.messages.pop()
  view = (await persistence.getProjectionViews({chatId: 'chat-a'})).all[0]
  assert.equal(view.factual_status, 'realized')
  assert.equal(view.deleted, false)
  delete store.state.floors['1:0']
  store.state.messages.splice(1, 1)
  view = (await persistence.getProjectionViews({chatId: 'chat-a'})).all[0]
  assert.equal(view.factual_status, 'active')
})

test('timeline chronology uses Character Floor order, not hash or message version', () => {
  const created = projection(10)
  const realized = createProjectionLifecycleRecord({projection_id: created.projection_id, action: 'realized', created_at_floor_version: {...version(13), content_hash: 'a', message_version: 'v1'}, evidence_refs: ['event:r']})
  const view = resolveProjectionTimeline([
    {floor_version: {...version(13), content_hash: 'a', message_version: 'v1'}, creations: [], evidence_records: [], lifecycle_records: [realized]},
    {floor_version: {...version(10), content_hash: 'z', message_version: 'v99'}, creations: [created], evidence_records: [], lifecycle_records: []},
  ])
  assert.equal(view.all[0].factual_status, 'realized')
})

test('persistence failure leaves the Floor payload unchanged and Projection never enters Snapshot or State', async () => {
  const created = projection()
  const {persistence, store} = setup({floors: {'0:0': {floor_version: version(10), projection_timeline: emptyProjectionTimeline(), snapshot: {state: {}}, events: []}}, saveError: 'SAVE_FAILED'})
  const before = structuredClone(store.state.floors['0:0'])
  await assert.rejects(() => persistence.saveGeneratedProjection({chatId: 'chat-a', ownerFloor: {message_index: 0, swipe_id: 0}, floorVersion: version(10), projectionCandidate: created}), /SAVE_FAILED/)
  assert.deepEqual(store.state.floors['0:0'], before)
  assert.equal(store.state.floors['0:0'].snapshot.state.projections, undefined)
  assert.equal(store.state.floors['0:0'].events.some(event => event.projection), false)
})

test('Chat scope is explicit and identical character names do not cross chats', async () => {
  const created = projection(10, 'chat-a')
  const first = setup({chatId: 'chat-a', floors: {'0:0': {floor_version: version(10, 0, 'chat-a'), projection_timeline: emptyProjectionTimeline()}}})
  await first.persistence.saveGeneratedProjection({chatId: 'chat-a', ownerFloor: {message_index: 0, swipe_id: 0}, floorVersion: version(10, 0, 'chat-a'), projectionCandidate: created})
  const second = setup({chatId: 'chat-b', floors: {'0:0': {floor_version: version(10, 0, 'chat-b'), projection_timeline: emptyProjectionTimeline()}}})
  assert.equal((await second.persistence.getProjectionViews({chatId: 'chat-b'})).all.length, 0)
  await assert.rejects(() => second.persistence.saveGeneratedProjection({chatId: 'chat-b', ownerFloor: {message_index: 0, swipe_id: 0}, floorVersion: version(10, 0, 'chat-a'), projectionCandidate: created}), /wrong_chat/)
})

test('input records remain immutable', async () => {
  const created = projection()
  const evidence = createProjectionEvidenceRecord({projection_id: created.projection_id, source_event_ids: ['event-4'], created_at_floor_version: version(13), evidence_refs: ['event:event-4']})
  const {persistence} = setup({floors: {'0:0': {floor_version: version(10), projection_timeline: {schema_version: 1, creations: [created], evidence_records: [], lifecycle_records: []}}, '1:0': {floor_version: version(13), projection_timeline: emptyProjectionTimeline()}}})
  const before = structuredClone(evidence)
  await persistence.saveProjectionEvidence({chatId: 'chat-a', ownerFloor: {message_index: 1, swipe_id: 0}, floorVersion: version(13), evidenceRecord: evidence})
  assert.deepEqual(evidence, before)
})

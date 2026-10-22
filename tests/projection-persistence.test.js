import test from 'node:test'
import assert from 'node:assert/strict'
import {createProjection, createProjectionDeliveryRecord, createProjectionEvidenceRecord, createProjectionLifecycleRecord, createProjectionObservationRecord, createProjectionTriggeredSnapshot} from '../core/projection.js'
import {emptyProjectionTimeline, appendProjectionCreation, appendProjectionEvidence, appendProjectionLifecycle, appendProjectionObservation, evolutionDecisionToLifecycleRecord, resolveProjectionTimeline} from '../core/projection-persistence.js'
import {createProjectionPersistence} from '../storage/projection.js'

function version(floor, swipe_id = 0, chat_id = 'chat-a') { return {chat_id, message_id: `message-${floor}`, floor, swipe_id, content_hash: `hash-${floor}-${swipe_id}`, message_version: `v${floor}-${swipe_id}`} }
function projection(floor = 10, chat_id = 'chat-a', subject_id = 'char_000001', concern = 'concern:change') {
  const floorVersion = version(floor, 0, chat_id)
  return createProjection({
    subject_id, projection_rule_id: 'rule:change-v1', development_concern_key: concern,
    mechanism: {key: 'mechanism:implant', world_model_rule_refs: ['projection-rule:rule:change-v1']}, source_event_ids: ['event-1'],
    development: {kind: 'possible_biological_change', current_basis: {event_ids: ['event-1'], state_refs: ['state:char_000001'], mechanism_rule_refs: ['projection-rule:rule:change-v1']}, next_signal: '未来可能出现变化。'},
    timing: {trigger_kind: 'immediate_after_event', reference_event_id: 'event-1', reference_story_time: null, current_story_time: null, elapsed_story_days: null},
    created_at_floor_version: floorVersion, evidence_refs: ['event:event-1'],
  })
}

function builtInProjection(floor, branch, subject_id = 'char_000001', cycle_id = 'cycle-a') {
  return createProjection({
    ...projection(floor, 'chat-a', subject_id, `pre_confirmation_observation:${branch}`),
    tracking_scope: 'pre_confirmation',
    tracking_window_id: `window-${cycle_id}`,
    aggregation_path: 'participant_aggregation',
    aggregation_evidence: {
      subject_id,
      aggregation_id: `aggregation-${cycle_id}`,
      pregnancy_id: null,
      cycle_id,
      accepted_exposure_event_ids: ['event-1'],
      participant_exposure_mapping: [{participant_id: 'participant-a', exposure_event_ids: ['event-1']}],
    },
  })
}

function fakeStore({messages, floors, activeSwipes = {}, chatId = 'chat-a', saveError = null}) {
  const state = {messages, floors, activeSwipes, chatId, saveCount: 0}
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
    async saveFloor(selector, swipeId, data) { state.saveCount += 1; if (saveError) throw new Error(saveError); state.floors[`${selector}:${swipeId}`] = structuredClone(data) },
  }
}

function setup({chatId = 'chat-a', ownerRole = 'assistant', swipe = 0, floors = {}, saveError = null, enabledResolver = undefined} = {}) {
  const messages = [{message_id: 'message-10', role: ownerRole}, {message_id: 'message-13', role: 'assistant'}]
  const activeSwipes = {0: swipe, 1: 0}
  const store = fakeStore({messages, floors, activeSwipes, chatId, saveError})
  return {store, persistence: createProjectionPersistence({store, resolveCurrentFloorVersion: async ({floorVersion}) => floorVersion, ...(enabledResolver ? {enabledResolver} : {})})}
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

test('observation records survive source Event recovery cleanup and resolve latest manual correction', () => {
  const created = projection(10)
  const triggered = createProjectionObservationRecord({projection_id: created.projection_id, subject_id: created.subject_id, action: 'triggered', reaction_concept: 'nausea', event_ids: ['event-health'], created_at_floor_version: version(10)})
  let timeline = appendProjectionCreation(created, {timeline: emptyProjectionTimeline(), expectedChatId: 'chat-a'}).timeline
  timeline = appendProjectionObservation(triggered, {timeline, expectedChatId: 'chat-a'}).timeline
  const afterRecovery = resolveProjectionTimeline([{floor_version: version(10), ...timeline}, {floor_version: version(11), creations: [], evidence_records: [], lifecycle_records: [], delivery_records: [], observation_records: []}])
  assert.equal(afterRecovery.all[0].observation_records[0].action, 'triggered')
  const revoked = createProjectionObservationRecord({projection_id: created.projection_id, subject_id: created.subject_id, action: 'revoked', reaction_concept: 'nausea', event_ids: ['event-health'], created_at_floor_version: version(12)})
  const corrected = resolveProjectionTimeline([{floor_version: version(10), ...timeline}, {floor_version: version(12), creations: [], evidence_records: [], lifecycle_records: [], delivery_records: [], observation_records: [revoked]}])
  assert.equal(corrected.all[0].observation_records.at(-1).action, 'revoked')
})

test('Projection triggered snapshot carries stage A trigger into stage B without untriggered A candidates', async () => {
  const stageA = builtInProjection(10, 'fatigue')
  const stageAUntriggered = builtInProjection(10, 'breast_sensitivity')
  const stageB = builtInProjection(13, 'nausea')
  const state = setup({floors: {
    '0:0': {floor_version: version(10), projection_timeline: {
      schema_version: 1,
      creations: [stageA, stageAUntriggered],
      evidence_records: [], lifecycle_records: [], delivery_records: [], observation_records: [],
    }},
    '1:0': {floor_version: version(13), projection_timeline: {
      schema_version: 1,
      creations: [stageB],
      evidence_records: [], lifecycle_records: [], delivery_records: [], observation_records: [],
    }},
  }})
  await state.persistence.saveProjectionTriggeredSnapshot({
    chatId: 'chat-a', ownerFloor: {message_index: 1, swipe_id: 0}, floorVersion: version(13),
    subjectId: 'char_000001', triggered: [{projection_id: stageA.projection_id, reaction_concept: 'fatigue', event_ids: ['event-fatigue']}],
  })
  const readback = await state.persistence.getProjectionViews({chatId: 'chat-a', endpointFloor: 13, endpointIndex: 1})
  assert.deepEqual(readback.triggered_snapshots.map(item => item.triggered.map(entry => entry.reaction_concept)), [['fatigue']])
  assert.equal(readback.triggered_snapshots[0].triggered.some(item => item.projection_id === stageAUntriggered.projection_id), false)
})

test('legacy triggered snapshot stage code is resolved from historical creation metadata', () => {
  const stageA = builtInProjection(10, 'fatigue')
  const resolved = resolveProjectionTimeline([{
    floor_version: version(10),
    creations: [stageA],
    evidence_records: [], lifecycle_records: [], delivery_records: [], observation_records: [],
    triggered_snapshots: [{
      schema_version: 1,
      snapshot_id: 'legacy-snapshot',
      subject_id: stageA.subject_id,
      status: 'active',
      triggered: [{projection_id: stageA.projection_id, reaction_concept: 'fatigue', event_ids: ['event-fatigue']}],
      created_at_floor_version: version(10),
    }],
    triggered_snapshot_complete: true,
  }])
  assert.equal(resolved.triggered_snapshots[0].stage_code, '1-1')
})

test('legacy snapshots without a complete marker retain the latest entry for each subject', () => {
  const first = builtInProjection(10, 'fatigue', 'char_000001')
  const second = builtInProjection(13, 'nausea', 'char_000002')
  const resolved = resolveProjectionTimeline([
    {
      floor_version: version(10),
      creations: [first],
      evidence_records: [], lifecycle_records: [], delivery_records: [], observation_records: [],
      triggered_snapshots: [{
        schema_version: 1,
        snapshot_id: 'legacy-first',
        subject_id: first.subject_id,
        status: 'active',
        triggered: [{projection_id: first.projection_id, reaction_concept: 'fatigue', event_ids: ['event-first']}],
        created_at_floor_version: version(10),
      }],
    },
    {
      floor_version: version(13),
      creations: [second],
      evidence_records: [], lifecycle_records: [], delivery_records: [], observation_records: [],
      triggered_snapshots: [{
        schema_version: 1,
        snapshot_id: 'legacy-second',
        subject_id: second.subject_id,
        status: 'active',
        triggered: [{projection_id: second.projection_id, reaction_concept: 'nausea', event_ids: ['event-second']}],
        created_at_floor_version: version(13),
      }],
    },
  ])
  assert.deepEqual(resolved.triggered_snapshots.map(snapshot => snapshot.subject_id), ['char_000001', 'char_000002'])
})

test('triggered snapshot identity changes when only the stage code changes', () => {
  const base = {subject_id: 'char_000001', status: 'active', triggered: [], created_at_floor_version: version(10)}
  const early = createProjectionTriggeredSnapshot({...base, stage_code: '1-1'})
  const later = createProjectionTriggeredSnapshot({...base, stage_code: '1-2'})
  assert.notEqual(early.snapshot_id, later.snapshot_id)
})

test('Projection triggered snapshots isolate people, terminate explicitly, and roll back with the Floor', async () => {
  const first = builtInProjection(10, 'fatigue', 'char_000001')
  const second = builtInProjection(10, 'nausea', 'char_000002')
  const state = setup({floors: {
    '0:0': {floor_version: version(10), projection_timeline: {...emptyProjectionTimeline(), creations: [first, second]}},
    '1:0': {floor_version: version(13), projection_timeline: emptyProjectionTimeline()},
  }})
  await state.persistence.saveProjectionTriggeredSnapshotBatch({
    chatId: 'chat-a', ownerFloor: {message_index: 0, swipe_id: 0}, floorVersion: version(10),
    snapshots: [
      {subject_id: 'char_000001', triggered: [{projection_id: first.projection_id, reaction_concept: 'fatigue', event_ids: ['event-a']}]},
      {subject_id: 'char_000002', triggered: [{projection_id: second.projection_id, reaction_concept: 'nausea', event_ids: ['event-b']}]},
    ],
  })
  await state.persistence.saveProjectionTriggeredSnapshot({
    chatId: 'chat-a', ownerFloor: {message_index: 1, swipe_id: 0}, floorVersion: version(13),
    subjectId: 'char_000001', status: 'terminated', triggered: [],
  })
  const current = await state.persistence.getProjectionViews({chatId: 'chat-a', endpointFloor: 13, endpointIndex: 1})
  assert.deepEqual(current.triggered_snapshots.map(item => [item.subject_id, item.status, item.triggered.length]), [
    ['char_000001', 'terminated', 0], ['char_000002', 'active', 1],
  ])
  const rollback = await state.persistence.getProjectionViews({chatId: 'chat-a', endpointFloor: 10, endpointIndex: 0})
  assert.deepEqual(rollback.triggered_snapshots.map(item => [item.subject_id, item.status, item.triggered.length]), [
    ['char_000001', 'active', 1], ['char_000002', 'active', 1],
  ])
})

test('Projection triggered snapshots are complete per-Floor snapshots and rollback selects one nearest snapshot', async () => {
  const subjectA = 'char-a'
  const subjectB = 'char-b'
  const a20 = projection(20, 'chat-a', subjectA, 'concern:a20')
  const b20 = projection(20, 'chat-a', subjectB, 'concern:b20')
  const a26 = projection(26, 'chat-a', subjectA, 'concern:a26')
  const a30 = projection(30, 'chat-a', subjectA, 'concern:a26')
  const messages = [20, 26, 30].map(floor => ({message_id: `message-${floor}`, role: 'assistant'}))
  const store = fakeStore({
    messages,
    floors: {
      '0:0': {floor_version: version(20), projection_timeline: {...emptyProjectionTimeline(), creations: [a20, b20]}},
      '1:0': {floor_version: version(26), projection_timeline: {...emptyProjectionTimeline(), creations: [a26]}},
      '2:0': {floor_version: version(30), projection_timeline: {...emptyProjectionTimeline(), creations: [a30]}},
    },
    activeSwipes: {0: 0, 1: 0, 2: 0},
  })
  const persistence = createProjectionPersistence({store, resolveCurrentFloorVersion: async ({floorVersion}) => floorVersion})
  const itemA20 = {projection_id: a20.projection_id, reaction_concept: 'fatigue', event_ids: ['event-a20']}
  const itemB20 = {projection_id: b20.projection_id, reaction_concept: 'nausea', event_ids: ['event-b20']}
  const itemA26 = {projection_id: a26.projection_id, reaction_concept: 'fatigue', event_ids: ['event-a26']}

  await persistence.saveProjectionTriggeredSnapshotBatch({
    chatId: 'chat-a', ownerFloor: {message_index: 0, swipe_id: 0}, floorVersion: version(20),
    snapshots: [{subject_id: subjectA, triggered: [itemA20]}, {subject_id: subjectB, triggered: [itemB20]}],
  })
  const floor20Before = structuredClone(store.state.floors['0:0'])
  await persistence.saveProjectionTriggeredSnapshot({
    chatId: 'chat-a', ownerFloor: {message_index: 1, swipe_id: 0}, floorVersion: version(26),
    subjectId: subjectA, triggered: [itemA26],
  })
  const at26 = await persistence.getProjectionViews({chatId: 'chat-a', endpointIndex: 1, endpointFloor: 26})
  assert.deepEqual(at26.triggered_snapshots.map(snapshot => [snapshot.subject_id, snapshot.triggered.map(item => item.projection_id)]), [
    [subjectA, [a26.projection_id]], [subjectB, [b20.projection_id]],
  ])

  await persistence.saveProjectionTriggeredSnapshotBatch({
    chatId: 'chat-a', ownerFloor: {message_index: 2, swipe_id: 0}, floorVersion: version(30),
    snapshots: [
      {subject_id: subjectA, triggered: [itemA26]},
      {subject_id: subjectB, status: 'terminated', triggered: []},
    ],
  })
  const at30 = await persistence.getProjectionViews({chatId: 'chat-a', endpointIndex: 2, endpointFloor: 30})
  assert.deepEqual(at30.triggered_snapshots.map(snapshot => [snapshot.subject_id, snapshot.status, snapshot.triggered.map(item => item.projection_id)]), [
    [subjectA, 'active', [a26.projection_id]], [subjectB, 'terminated', []],
  ])
  const rollback23 = await persistence.getProjectionViews({chatId: 'chat-a', endpointIndex: 0, endpointFloor: 23})
  assert.deepEqual(rollback23.triggered_snapshots.map(snapshot => [snapshot.subject_id, snapshot.triggered.map(item => item.projection_id)]), [
    [subjectA, [a20.projection_id]], [subjectB, [b20.projection_id]],
  ])
  assert.deepEqual(store.state.floors['0:0'], floor20Before)
  assert.equal(store.state.floors['1:0'].projection_timeline.triggered_snapshots.length, 2)
  assert.equal(store.state.floors['2:0'].projection_timeline.triggered_snapshots.length, 2)
})

test('Projection reads preserve a complete empty snapshot and do not revive an older Floor', async () => {
  const subject = 'char-empty'
  const created = projection(10, 'chat-a', subject, 'concern:empty')
  const state = setup({floors: {
    '0:0': {floor_version: version(10), projection_timeline: {...emptyProjectionTimeline(), creations: [created]}},
    '1:0': {floor_version: version(13), projection_timeline: emptyProjectionTimeline()},
  }})

  await state.persistence.saveProjectionTriggeredSnapshot({
    chatId: 'chat-a', ownerFloor: {message_index: 0, swipe_id: 0}, floorVersion: version(10),
    subjectId: subject, triggered: [{projection_id: created.projection_id, reaction_concept: 'nausea', event_ids: ['event-old']}],
  })
  await state.persistence.saveProjectionTriggeredSnapshot({
    chatId: 'chat-a', ownerFloor: {message_index: 1, swipe_id: 0}, floorVersion: version(13),
    subjectId: subject, status: 'terminated', triggered: [],
  })

  const current = await state.persistence.getProjectionViews({chatId: 'chat-a', endpointIndex: 1, endpointFloor: 13})
  assert.deepEqual(current.triggered_snapshots.map(snapshot => [snapshot.subject_id, snapshot.status, snapshot.triggered.length]), [
    [subject, 'terminated', 0],
  ])
})

test('Projection triggered snapshot failure or stale ownership leaves the Floor unchanged', async () => {
  const created = projection(10)
  const failed = setup({saveError: 'SNAPSHOT_SAVE_FAILED', floors: {'0:0': {floor_version: version(10), projection_timeline: {...emptyProjectionTimeline(), creations: [created]}}}})
  await assert.rejects(() => failed.persistence.saveProjectionTriggeredSnapshot({
    chatId: 'chat-a', ownerFloor: {message_index: 0, swipe_id: 0}, floorVersion: version(10),
    subjectId: created.subject_id, triggered: [{projection_id: created.projection_id, reaction_concept: 'fatigue', event_ids: ['event-1']}],
  }), /SNAPSHOT_SAVE_FAILED/)
  assert.deepEqual(failed.store.state.floors['0:0'].projection_timeline.triggered_snapshots ?? [], [])
  const stale = setup({floors: {'0:0': {floor_version: version(10), projection_timeline: {...emptyProjectionTimeline(), creations: [created]}}}})
  await assert.rejects(() => stale.persistence.saveProjectionTriggeredSnapshot({
    chatId: 'chat-a', ownerFloor: {message_index: 0, swipe_id: 0}, floorVersion: {...version(10), content_hash: 'stale'},
    subjectId: created.subject_id, triggered: [{projection_id: created.projection_id, reaction_concept: 'fatigue', event_ids: ['event-1']}],
  }), /FLOOR_VERSION_STALE/)
  assert.deepEqual(stale.store.state.floors['0:0'].projection_timeline.triggered_snapshots ?? [], [])
})

test('built-in stage snapshots replace only the latest complete stage at the endpoint', () => {
  const branchesA = ['fatigue', 'breast_sensitivity', 'scent_food_change', 'no_reaction_early']
  const branchesB = ['nausea', 'odor_discomfort', 'mood_change', 'appetite_change']
  const stageA = branchesA.map(branch => builtInProjection(20, branch))
  const stageB = branchesB.map(branch => builtInProjection(26, branch))
  const at26 = resolveProjectionTimeline([
    {floor_version: version(20), creations: stageA, evidence_records: [], lifecycle_records: [], delivery_records: []},
    {floor_version: version(26), creations: stageB, evidence_records: [], lifecycle_records: [], delivery_records: []},
  ])
  assert.deepEqual(at26.all.map(item => item.development_concern_key).sort(), branchesB.map(branch => `pre_confirmation_observation:${branch}`).sort())
  assert.equal(at26.all.some(item => item.projection_id === stageA[0].projection_id), false)
  assert.deepEqual(at26.all.flatMap(item => item.lifecycle_records), [])

  const at23 = resolveProjectionTimeline([{floor_version: version(20), creations: stageA, evidence_records: [], lifecycle_records: [], delivery_records: []}])
  assert.deepEqual(at23.all.map(item => item.development_concern_key).sort(), branchesA.map(branch => `pre_confirmation_observation:${branch}`).sort())
})

test('built-in stage snapshots rebuild a legacy split stage per subject without mixing identities', () => {
  const oldBranches = ['fatigue', 'breast_sensitivity', 'scent_food_change', 'no_reaction_early']
  const currentBranches = ['nausea', 'odor_discomfort', 'mood_change', 'appetite_change']
  const splitOld = oldBranches.map((branch, index) => builtInProjection(20 + index, branch, 'char-old', 'cycle-old'))
  const current = currentBranches.map(branch => builtInProjection(26, branch, 'char-current', 'cycle-current'))
  const incompleteNew = currentBranches.slice(0, 2).map(branch => builtInProjection(26, branch, 'char-old', 'cycle-old'))

  const resolved = resolveProjectionTimeline([
    ...splitOld.map((creation, index) => ({floor_version: version(20 + index), creations: [creation], evidence_records: [], lifecycle_records: [], delivery_records: []})),
    {floor_version: version(26), creations: [...current, ...incompleteNew], evidence_records: [], lifecycle_records: [], delivery_records: []},
  ])
  const at23 = resolveProjectionTimeline(splitOld.map((creation, index) => ({floor_version: version(20 + index), creations: [creation], evidence_records: [], lifecycle_records: [], delivery_records: []})))

  assert.deepEqual(resolved.all.map(item => item.projection_id).sort(), [...splitOld, ...current].map(item => item.projection_id).sort())
  assert.equal(resolved.all.some(item => incompleteNew.some(candidate => candidate.projection_id === item.projection_id)), false)
  assert.deepEqual(at23.all.map(item => item.projection_id).sort(), splitOld.map(item => item.projection_id).sort())
})

test('built-in stage snapshot keeps one subject together when branch mechanisms differ', () => {
  const branches = ['fatigue', 'breast_sensitivity', 'scent_food_change', 'no_reaction_early']
  const stage = branches.map((branch, index) => createProjection({
    ...builtInProjection(20, branch, 'char_000003', 'cycle-mixed'),
    mechanism: {key: index % 2 === 0 ? 'mechanism-a' : 'mechanism-b'},
  }))
  const unrelatedCompleteStage = branches.map(branch => builtInProjection(20, branch, 'char_000001', 'cycle-complete'))

  const resolved = resolveProjectionTimeline([{
    floor_version: version(20),
    creations: [...stage, ...unrelatedCompleteStage],
    evidence_records: [],
    lifecycle_records: [],
    delivery_records: [],
  }])

  assert.deepEqual(resolved.all.map(item => item.projection_id).sort(), [...stage, ...unrelatedCompleteStage].map(item => item.projection_id).sort())
})

test('a late branch from an older stage cannot replace a newer complete stage', () => {
  const stageA = ['fatigue', 'breast_sensitivity', 'scent_food_change', 'no_reaction_early']
    .map(branch => builtInProjection(20, branch, 'char-late-old', 'cycle-late-old'))
  const stageB = ['nausea', 'odor_discomfort', 'mood_change', 'appetite_change']
    .map(branch => builtInProjection(26, branch, 'char-late-old', 'cycle-late-old'))
  const lateOldBranch = builtInProjection(30, 'no_reaction_early', 'char-late-old', 'cycle-late-old')

  const resolved = resolveProjectionTimeline([
    {floor_version: version(20), creations: stageA, evidence_records: [], lifecycle_records: [], delivery_records: []},
    {floor_version: version(26), creations: stageB, evidence_records: [], lifecycle_records: [], delivery_records: []},
    {floor_version: version(30), creations: [lateOldBranch], evidence_records: [], lifecycle_records: [], delivery_records: []},
  ])

  assert.deepEqual(resolved.all.map(item => item.development_concern_key).sort(), stageB.map(item => item.development_concern_key).sort())
})

test('stage snapshot filtering preserves later evidence and lifecycle for current and generic projections', () => {
  const branchesA = ['fatigue', 'breast_sensitivity', 'scent_food_change', 'no_reaction_early']
  const branchesB = ['nausea', 'odor_discomfort', 'mood_change', 'appetite_change']
  const stageA = branchesA.map(branch => builtInProjection(20, branch))
  const stageB = branchesB.map(branch => builtInProjection(26, branch))
  const generic = projection(20)
  const laterVersion = version(30)
  const stageBEvidence = createProjectionEvidenceRecord({
    projection_id: stageB[0].projection_id,
    source_event_ids: ['event-stage-b-later'],
    created_at_floor_version: laterVersion,
    evidence_refs: ['event:event-stage-b-later'],
  })
  const stageBLifecycle = createProjectionLifecycleRecord({
    projection_id: stageB[0].projection_id,
    action: 'realized',
    created_at_floor_version: laterVersion,
    evidence_refs: ['event:event-stage-b-later'],
  })
  const genericLifecycle = createProjectionLifecycleRecord({
    projection_id: generic.projection_id,
    action: 'realized',
    created_at_floor_version: laterVersion,
    evidence_refs: ['event:event-generic-later'],
  })

  const resolved = resolveProjectionTimeline([
    {floor_version: version(20), creations: [...stageA, generic], evidence_records: [], lifecycle_records: [], delivery_records: []},
    {floor_version: version(26), creations: stageB, evidence_records: [], lifecycle_records: [], delivery_records: []},
    {floor_version: laterVersion, creations: [], evidence_records: [stageBEvidence], lifecycle_records: [stageBLifecycle, genericLifecycle], delivery_records: []},
  ])

  const currentStage = resolved.all.filter(item => item.tracking_scope === 'pre_confirmation')
  const resolvedGeneric = resolved.all.find(item => item.projection_id === generic.projection_id)
  assert.deepEqual(currentStage.map(item => item.projection_id).sort(), stageB.map(item => item.projection_id).sort())
  assert.equal(resolved.all.some(item => stageA.some(previous => previous.projection_id === item.projection_id)), false)
  assert.equal(resolved.all.find(item => item.projection_id === stageB[0].projection_id)?.evidence_records.some(record => record.evidence_record_id === stageBEvidence.evidence_record_id), true)
  assert.equal(resolved.all.find(item => item.projection_id === stageB[0].projection_id)?.factual_status, 'realized')
  assert.equal(resolvedGeneric?.factual_status, 'realized')
})

test('historical Delivery records remain readable after product views replace an earlier built-in stage', async () => {
  const branchesA = ['fatigue', 'breast_sensitivity', 'scent_food_change', 'no_reaction_early']
  const branchesB = ['nausea', 'odor_discomfort', 'mood_change', 'appetite_change']
  const stageA = branchesA.map(branch => builtInProjection(20, branch))
  const stageB = branchesB.map(branch => builtInProjection(26, branch))
  const submission = createProjectionDeliveryRecord({
    delivery_id: 'delivery-stage-a', projection_id: stageA[0].projection_id, aggregation_id: 'aggregation-cycle-a',
    subject_id: 'char_000001', pregnancy_id: null, cycle_id: 'cycle-a', submitted_floor_version: version(20),
    created_at_floor_version: version(20), context_fingerprint: 'fingerprint-a', status: 'readback_verified',
  })
  const response = createProjectionDeliveryRecord({
    ...submission, status: 'response_observed', response_id: 'response-stage-a', response_floor_version: version(20),
    analysis_status: 'success', analysis_execution_id: 'analysis-stage-a', explicit_lifecycle_fact_ids: [],
  })
  const messages = [{message_id: 'message-20', role: 'assistant'}, {message_id: 'message-26', role: 'assistant'}]
  const store = fakeStore({
    messages,
    activeSwipes: {0: 0, 1: 0},
    floors: {
      '0:0': {floor_version: version(20), projection_timeline: {schema_version: 1, creations: stageA, evidence_records: [], lifecycle_records: [], delivery_records: [submission, response]}},
      '1:0': {floor_version: version(26), projection_timeline: {schema_version: 1, creations: stageB, evidence_records: [], lifecycle_records: [], delivery_records: []}},
    },
  })
  const persistence = createProjectionPersistence({store, resolveCurrentFloorVersion: async ({floorVersion}) => floorVersion})

  const views = await persistence.getProjectionViews({chatId: 'chat-a', endpointFloor: 26})
  assert.deepEqual(views.all.map(item => item.development_concern_key).sort(), branchesB.map(branch => `pre_confirmation_observation:${branch}`).sort())
  const deliveries = await persistence.getProjectionDeliveryRecords({chatId: 'chat-a', endpointFloor: 26})
  assert.deepEqual(deliveries.map(item => item.projection_id), [stageA[0].projection_id, stageA[0].projection_id])
  assert.deepEqual(deliveries.map(item => item.status).sort(), ['readback_verified', 'response_observed'])

  const responseAfterStageReplacement = createProjectionDeliveryRecord({
    ...submission,
    status: 'response_observed',
    response_id: 'response-stage-a-after-stage-b',
    response_floor_version: version(26),
    created_at_floor_version: version(26),
    analysis_execution_id: 'analysis-stage-a-after-stage-b',
    analysis_status: 'success',
    explicit_lifecycle_fact_ids: [],
  })
  assert.equal((await persistence.saveProjectionDeliveryResponse({
    chatId: 'chat-a',
    ownerFloor: {message_index: 1, swipe_id: 0},
    floorVersion: version(26),
    deliveryRecord: responseAfterStageReplacement,
  })).status, 'appended')
  assert.equal(store.state.floors['1:0'].projection_timeline.delivery_records.length, 1)
  assert.deepEqual((await persistence.getProjectionViews({chatId: 'chat-a', endpointFloor: 26})).all.map(item => item.development_concern_key).sort(), branchesB.map(branch => `pre_confirmation_observation:${branch}`).sort())
})

test('Character Floor creation persists only in its active Swipe, including Swipe 0', async () => {
  const created = projection()
  const setupState = setup({floors: {'0:0': {floor_version: version(10), projection_timeline: emptyProjectionTimeline()}}})
  const result = await setupState.persistence.saveGeneratedProjection({chatId: 'chat-a', ownerFloor: {message_index: 0, message_id: version(10).message_id, swipe_id: 0}, floorVersion: version(10), projectionCandidate: created})
  assert.equal(result.status, 'appended')
  assert.equal(setupState.store.state.floors['0:0'].projection_timeline.creations.length, 1)
})

test('Projection batch appends all creations and evidence with one Floor save', async () => {
  const records = Array.from({length: 8}, (_, index) => {
    const created = projection(10, 'chat-a', `char_${String(index + 1).padStart(6, '0')}`, `concern:change-${index}`)
    return {
      projectionCandidate: created,
      evidenceRecord: createProjectionEvidenceRecord({
        projection_id: created.projection_id,
        source_event_ids: [`event-${index + 1}`],
        created_at_floor_version: version(10),
        evidence_refs: [`event:event-${index + 1}`],
      }),
    }
  })
  const setupState = setup({floors: {'0:0': {floor_version: version(10), projection_timeline: emptyProjectionTimeline()}}})
  const result = await setupState.persistence.saveProjectionBatch({
    chatId: 'chat-a',
    ownerFloor: {message_index: 0, swipe_id: 0},
    floorVersion: version(10),
    records,
  })
  assert.equal(result.status, 'appended')
  assert.equal(setupState.store.state.saveCount, 1)
  const timeline = setupState.store.state.floors['0:0'].projection_timeline
  assert.equal(timeline.creations.length, 8)
  assert.equal(timeline.evidence_records.length, 8)
  assert.equal((await setupState.persistence.saveProjectionBatch({
    chatId: 'chat-a', ownerFloor: {message_index: 0, swipe_id: 0}, floorVersion: version(10), records,
  })).status, 'deduped')
  assert.equal(setupState.store.state.saveCount, 1)
})

test('Projection batch rejects atomically before Floor save on invalid records and append conflicts', async () => {
  const first = projection(10, 'chat-a', 'char_000001', 'concern:batch-first')
  const second = projection(10, 'chat-a', 'char_000002', 'concern:batch-second')
  const setupState = setup({floors: {'0:0': {floor_version: version(10), projection_timeline: emptyProjectionTimeline()}}})
  await assert.rejects(() => setupState.persistence.saveProjectionBatch({
    chatId: 'chat-a', ownerFloor: {message_index: 0, swipe_id: 0}, floorVersion: version(10), records: [
      {projectionCandidate: first},
      {projectionCandidate: second, evidenceRecord: {projection_id: second.projection_id, source_event_ids: [], created_at_floor_version: version(10)}},
    ],
  }), /source_event_ids:invalid/)
  assert.equal(setupState.store.state.saveCount, 0)
  assert.equal(setupState.store.state.floors['0:0'].projection_timeline.creations.length, 0)

  const conflictState = setup({floors: {'0:0': {floor_version: version(10), projection_timeline: emptyProjectionTimeline()}}})
  const changed = {...first, development: {...first.development, next_signal: '冲突内容。'}}
  await assert.rejects(() => conflictState.persistence.saveProjectionBatch({
    chatId: 'chat-a', ownerFloor: {message_index: 0, swipe_id: 0}, floorVersion: version(10), records: [
      {projectionCandidate: first}, {projectionCandidate: changed},
    ],
  }), /projection_id_conflict/)
  assert.equal(conflictState.store.state.saveCount, 0)
  assert.equal(conflictState.store.state.floors['0:0'].projection_timeline.creations.length, 0)
})

test('Projection batch rejects empty or unsupported record shapes without reading or writing a Floor', async () => {
  const setupState = setup({floors: {'0:0': {floor_version: version(10), projection_timeline: emptyProjectionTimeline()}}})
  const input = {chatId: 'chat-a', ownerFloor: {message_index: 0, swipe_id: 0}, floorVersion: version(10)}
  await assert.rejects(() => setupState.persistence.saveProjectionBatch({...input, records: []}), /PROJECTION_BATCH_RECORDS_REQUIRED/)
  await assert.rejects(() => setupState.persistence.saveProjectionBatch({...input, records: [{projection: projection()}]}), /PROJECTION_BATCH_RECORD_REQUIRED/)
  assert.equal(setupState.store.state.saveCount, 0)
})

test('Projection lifecycle batch appends multiple records with one Floor save and is idempotent', async () => {
  const first = projection(10, 'chat-a', 'char_000001', 'concern:lifecycle-first')
  const second = projection(10, 'chat-a', 'char_000002', 'concern:lifecycle-second')
  const timeline = emptyProjectionTimeline()
  timeline.creations.push(first, second)
  const setupState = setup({floors: {'0:0': {floor_version: version(10), projection_timeline: timeline}}})
  const records = [
    {projection_id: first.projection_id, action: 'expired', created_at_floor_version: version(10), evidence_refs: ['event:expire-first']},
    {projection_id: second.projection_id, action: 'deleted', created_at_floor_version: version(10), evidence_refs: ['system:upgrade']},
  ]
  const input = {chatId: 'chat-a', ownerFloor: {message_index: 0, swipe_id: 0}, floorVersion: version(10), records}
  assert.equal((await setupState.persistence.saveProjectionLifecycleBatch(input)).status, 'appended')
  assert.equal(setupState.store.state.saveCount, 1)
  assert.equal(setupState.store.state.floors['0:0'].projection_timeline.lifecycle_records.length, 2)
  assert.equal((await setupState.persistence.saveProjectionLifecycleBatch(input)).status, 'deduped')
  assert.equal(setupState.store.state.saveCount, 1)
})

test('Projection observation batch is Floor-owned, idempotent, and preserves triggered history after Event removal', async () => {
  const created = projection(10)
  const timeline = emptyProjectionTimeline()
  timeline.creations.push(created)
  const setupState = setup({floors: {'0:0': {floor_version: version(10), projection_timeline: timeline}}})
  const input = {chatId: 'chat-a', ownerFloor: {message_index: 0, swipe_id: 0}, floorVersion: version(10), records: [{projection_id: created.projection_id, subject_id: created.subject_id, action: 'triggered', reaction_concept: 'nausea', event_ids: ['event-health'], created_at_floor_version: version(10)}]}
  assert.equal((await setupState.persistence.saveProjectionObservationBatch(input)).status, 'appended')
  assert.equal(setupState.store.state.saveCount, 1)
  assert.equal((await setupState.persistence.saveProjectionObservationBatch(input)).status, 'deduped')
  assert.equal(setupState.store.state.saveCount, 1)
  assert.equal(setupState.store.state.floors['0:0'].projection_timeline.observation_records.length, 1)
})

test('Projection lifecycle batch rejects invalid and conflicting records atomically', async () => {
  const first = projection(10, 'chat-a', 'char_000001', 'concern:lifecycle-atomic')
  const timeline = emptyProjectionTimeline()
  timeline.creations.push(first)
  const setupState = setup({floors: {'0:0': {floor_version: version(10), projection_timeline: timeline}}})
  const input = {chatId: 'chat-a', ownerFloor: {message_index: 0, swipe_id: 0}, floorVersion: version(10)}
  await assert.rejects(() => setupState.persistence.saveProjectionLifecycleBatch({...input, records: [
    {projection_id: first.projection_id, action: 'expired', created_at_floor_version: version(10), evidence_refs: ['event:valid']},
    {projection_id: 'projection-missing', action: 'deleted', created_at_floor_version: version(10), evidence_refs: ['system:invalid']},
  ]}), /projection_id:unknown/)
  assert.equal(setupState.store.state.saveCount, 0)
  assert.equal(setupState.store.state.floors['0:0'].projection_timeline.lifecycle_records.length, 0)
  await assert.rejects(() => setupState.persistence.saveProjectionLifecycleBatch({...input, floorVersion: {...version(10), content_hash: 'stale'}, records: [
    {projection_id: first.projection_id, action: 'expired', created_at_floor_version: version(10), evidence_refs: ['event:stale']},
  ]}), /FLOOR_VERSION_STALE/)
  assert.equal(setupState.store.state.saveCount, 0)

  const conflict = {...first, development: {...first.development, next_signal: '冲突。'}}
  const conflictState = setup({floors: {'0:0': {floor_version: version(10), projection_timeline: {...timeline, creations: [first, conflict]}}}})
  await assert.rejects(() => conflictState.persistence.saveProjectionLifecycleBatch({...input, records: [
    {projection_id: first.projection_id, action: 'expired', created_at_floor_version: version(10), evidence_refs: []},
  ]}), /PROJECTION_TIMELINE_INVALID/)
  assert.equal(conflictState.store.state.saveCount, 0)
})

test('disabled Projection persistence skips generation/evidence/lifecycle writes', async () => {
  const created = projection()
  const setupState = setup({enabledResolver: () => false, floors: {'0:0': {floor_version: version(10), projection_timeline: emptyProjectionTimeline()}}})
  await assert.rejects(() => setupState.persistence.saveGeneratedProjection({chatId: 'chat-a', ownerFloor: {message_index: 0, swipe_id: 0}, floorVersion: version(10), projectionCandidate: created}), /BIOWEAVE_DISABLED/)
  await assert.rejects(() => setupState.persistence.saveProjectionEvidence({chatId: 'chat-a', ownerFloor: {message_index: 0, swipe_id: 0}, floorVersion: version(10), evidenceRecord: {projection_id: created.projection_id, source_event_ids: ['event-1'], created_at_floor_version: version(10)}}), /BIOWEAVE_DISABLED/)
  await assert.rejects(() => setupState.persistence.saveProjectionLifecycle({chatId: 'chat-a', ownerFloor: {message_index: 0, swipe_id: 0}, floorVersion: version(10), lifecycleRecord: {projection_id: created.projection_id, action: 'realized', created_at_floor_version: version(10)}}), /BIOWEAVE_DISABLED/)
  assert.deepEqual(setupState.store.state.floors['0:0'].projection_timeline, emptyProjectionTimeline())
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

test('Projection delivery submission is Floor-owned, readbacked, and idempotent', async () => {
  const created = projection(10)
  const {persistence, store} = setup({floors: {
    '0:0': {floor_version: version(10), projection_timeline: {schema_version: 1, creations: [created], evidence_records: [], lifecycle_records: [], delivery_records: []}},
    '1:0': {floor_version: version(13), projection_timeline: emptyProjectionTimeline()},
  }})
  const delivery = {
    projection_id: created.projection_id,
    aggregation_id: 'aggregation-1',
    subject_id: 'char_000001',
    pregnancy_id: null,
    cycle_id: 'cycle-1',
    submitted_floor_version: version(13),
    created_at_floor_version: version(13),
    context_fingerprint: 'context-1',
  }
  assert.equal((await persistence.saveProjectionDeliverySubmission({chatId: 'chat-a', ownerFloor: {message_index: 1, swipe_id: 0}, floorVersion: version(13), deliveryRecord: delivery})).status, 'appended')
  assert.equal((await persistence.saveProjectionDeliverySubmission({chatId: 'chat-a', ownerFloor: {message_index: 1, swipe_id: 0}, floorVersion: version(13), deliveryRecord: delivery})).status, 'deduped')
  const records = await persistence.getProjectionDeliveryRecords({chatId: 'chat-a'})
  assert.equal(records.length, 1)
  assert.equal(records[0].submitted_floor_version.message_version, 'v13-0')
  assert.equal(store.state.floors['0:0'].projection_timeline.delivery_records?.length ?? 0, 0)
})

test('Projection delivery response is a separate idempotent record and stale Floor versions fail closed', async () => {
  const created = projection(10)
  const {persistence} = setup({floors: {
    '0:0': {floor_version: version(10), projection_timeline: {schema_version: 1, creations: [created], evidence_records: [], lifecycle_records: [], delivery_records: []}},
    '1:0': {floor_version: version(13), projection_timeline: emptyProjectionTimeline()},
  }})
  const base = {
    projection_id: created.projection_id,
    aggregation_id: 'aggregation-1',
    subject_id: 'char_000001',
    pregnancy_id: null,
    cycle_id: 'cycle-1',
    submitted_floor_version: version(10),
    created_at_floor_version: version(10),
    context_fingerprint: 'context-1',
  }
  await persistence.saveProjectionDeliverySubmission({chatId: 'chat-a', ownerFloor: {message_index: 0, swipe_id: 0}, floorVersion: version(10), deliveryRecord: base})
  const submission = (await persistence.getProjectionDeliveryRecords({chatId: 'chat-a'}))[0]
  const response = {...base, delivery_id: submission.delivery_id, response_id: 'response-1', response_floor_version: version(13), created_at_floor_version: version(13), analysis_execution_id: 'analysis-1', analysis_status: 'success', explicit_lifecycle_fact_ids: []}
  assert.equal((await persistence.saveProjectionDeliveryResponse({chatId: 'chat-a', ownerFloor: {message_index: 1, swipe_id: 0}, floorVersion: version(13), deliveryRecord: response})).status, 'appended')
  assert.equal((await persistence.saveProjectionDeliveryResponse({chatId: 'chat-a', ownerFloor: {message_index: 1, swipe_id: 0}, floorVersion: version(13), deliveryRecord: response})).status, 'deduped')
  assert.equal((await persistence.getProjectionDeliveryRecords({chatId: 'chat-a'})).length, 2)
  await assert.rejects(() => persistence.saveProjectionDeliveryResponse({chatId: 'chat-a', ownerFloor: {message_index: 1, swipe_id: 0}, floorVersion: {...version(13), content_hash: 'stale'}, deliveryRecord: response}), /FLOOR_VERSION_STALE/)
})

test('Projection delivery submission and response batches append once and exact repeats are no-ops', async () => {
  const creations = Array.from({length: 23}, (_, index) => projection(10, 'chat-a', `char_${String(index + 1).padStart(6, '0')}`, `concern:delivery-${index}`))
  const {persistence, store} = setup({floors: {
    '0:0': {floor_version: version(10), projection_timeline: {...emptyProjectionTimeline(), creations}},
  }})
  const submissions = creations.map((created, index) => ({
    projection_id: created.projection_id,
    aggregation_id: `aggregation-${index}`,
    subject_id: `char_${String(index + 1).padStart(6, '0')}`,
    pregnancy_id: null,
    cycle_id: `cycle-${index}`,
    submitted_floor_version: version(10),
    created_at_floor_version: version(10),
    context_fingerprint: 'context-batch',
  }))
  assert.equal((await persistence.saveProjectionDeliverySubmissionBatch({chatId: 'chat-a', ownerFloor: {message_index: 0, swipe_id: 0}, floorVersion: version(10), records: submissions})).status, 'appended')
  assert.equal(store.state.saveCount, 1)
  assert.equal((await persistence.saveProjectionDeliverySubmissionBatch({chatId: 'chat-a', ownerFloor: {message_index: 0, swipe_id: 0}, floorVersion: version(10), records: submissions})).status, 'deduped')
  assert.equal(store.state.saveCount, 1)

  const savedSubmissions = (await persistence.getProjectionDeliveryRecords({chatId: 'chat-a'})).filter(item => item.status === 'readback_verified')
  const responses = savedSubmissions.map((submission, index) => ({
    ...submissions[index],
    delivery_id: submission.delivery_id,
    response_id: `response-${index}`,
    response_floor_version: version(10),
    created_at_floor_version: version(10),
    analysis_execution_id: `analysis-${index}`,
    analysis_status: 'success',
    explicit_lifecycle_fact_ids: [],
  }))
  assert.equal((await persistence.saveProjectionDeliveryResponseBatch({chatId: 'chat-a', ownerFloor: {message_index: 0, swipe_id: 0}, floorVersion: version(10), records: responses})).status, 'appended')
  assert.equal(store.state.saveCount, 2)
  assert.equal((await persistence.saveProjectionDeliveryResponseBatch({chatId: 'chat-a', ownerFloor: {message_index: 0, swipe_id: 0}, floorVersion: version(10), records: responses})).status, 'deduped')
  assert.equal(store.state.saveCount, 2)
  assert.equal((await persistence.getProjectionDeliveryRecords({chatId: 'chat-a'})).length, 46)
})

test('Projection delivery batches reject invalid or stale records before any Floor save', async () => {
  const created = projection(10)
  const input = {chatId: 'chat-a', ownerFloor: {message_index: 0, swipe_id: 0}, floorVersion: version(10)}
  const {persistence, store} = setup({floors: {'0:0': {floor_version: version(10), projection_timeline: {...emptyProjectionTimeline(), creations: [created]}}}})
  const valid = {
    projection_id: created.projection_id,
    aggregation_id: 'aggregation-valid', subject_id: 'char_000001', pregnancy_id: null, cycle_id: 'cycle-valid',
    submitted_floor_version: version(10), created_at_floor_version: version(10), context_fingerprint: 'context-valid',
  }
  await assert.rejects(() => persistence.saveProjectionDeliverySubmissionBatch({...input, records: [valid, {...valid, context_fingerprint: null}]}), /delivery.context_fingerprint:required/)
  await assert.rejects(() => persistence.saveProjectionDeliverySubmissionBatch({...input, records: [{...valid, created_at_floor_version: {...version(10), content_hash: 'stale'}}]}), /FLOOR_VERSION_STALE/)
  assert.equal(store.state.saveCount, 0)
  await assert.rejects(() => persistence.saveProjectionDeliveryResponseBatch({...input, records: [{...valid, response_id: 'response-invalid', response_floor_version: version(10), analysis_execution_id: 'analysis-1', analysis_status: 'success', explicit_lifecycle_fact_ids: []}, {...valid, response_id: 'response-invalid-2', response_floor_version: {...version(10), content_hash: 'stale'}, analysis_execution_id: 'analysis-2', analysis_status: 'success', explicit_lifecycle_fact_ids: []}]}), /FLOOR_VERSION_STALE/)
  assert.equal(store.state.saveCount, 0)
})

test('Projection views and deliveries respect an optional endpoint index while preserving the unbounded default', async () => {
  const created = projection(10)
  const {persistence, store} = setup({floors: {
    '0:0': {floor_version: version(10), projection_timeline: {schema_version: 1, creations: [created], evidence_records: [], lifecycle_records: [], delivery_records: []}},
    '1:0': {floor_version: version(13), projection_timeline: emptyProjectionTimeline()},
  }})
  const delivery = {
    projection_id: created.projection_id,
    aggregation_id: 'aggregation-endpoint',
    subject_id: 'char_000001',
    pregnancy_id: null,
    cycle_id: 'cycle-endpoint',
    submitted_floor_version: version(13),
    created_at_floor_version: version(13),
    context_fingerprint: 'context-endpoint',
  }
  await persistence.saveProjectionDeliverySubmission({chatId: 'chat-a', ownerFloor: {message_index: 1, swipe_id: 0}, floorVersion: version(13), deliveryRecord: delivery})
  assert.equal((await persistence.getProjectionViews({chatId: 'chat-a', endpointIndex: 0, endpointFloor: 13})).all.length, 1)
  assert.equal((await persistence.getProjectionDeliveryRecords({chatId: 'chat-a', endpointIndex: 0, endpointFloor: 13})).length, 0)
  assert.equal((await persistence.getProjectionDeliveryRecords({chatId: 'chat-a', endpointFloor: 13})).length, 1)
  assert.equal(store.state.floors['1:0'].projection_timeline.delivery_records.length, 1)
})

import test from 'node:test';
import assert from 'node:assert/strict';
import {applyStorylineJudge, createStorylineSnapshot, setStorylineProgressionEvent} from '../core/projection-storyline.js';
import {createProjectionStorylineRuntime} from '../runtime/projection-storyline-runtime.js';

const floor = {chat_id: 'chat', message_id: 'm20', floor: 20, swipe_id: 0, content_hash: 'hash', message_version: '1'};
const candidateBranch = ordinal => ({
  title: `支线${ordinal}`,
  premise: '当前世界中的阶段性前提。',
  nodes: [1, 2, 3].map(index => ({
    title: `入口${index}`,
    objective: `入口${index}的目标。`,
    completion_signal: `入口${index}的完成信号。`,
    conclusion_goal: `入口${index}的结论目标。`,
  })),
});

function completedEntrySnapshot() {
  const candidates = createStorylineSnapshot({
    subject_id: 'char_1',
    display_name: '目标人物',
    branches: [candidateBranch(1), candidateBranch(2), candidateBranch(3)],
    created_at_floor_version: floor,
  });
  const selected = applyStorylineJudge(candidates, {
    branch_id: candidates.branches[0].branch_id,
    node_id: candidates.branches[0].nodes[0].node_id,
  });
  return applyStorylineJudge(selected, {action: 'complete'});
}

test('completed entry generates one same-branch progression event and does not regenerate while active', async () => {
  const snapshot = completedEntrySnapshot();
  const views = {
    storyline_snapshots: [snapshot],
    triggered_snapshots: [{subject_id: 'char_1', status: 'active', triggered: [{reaction_concept: 'nausea', event_ids: []}]}],
    storyline_delivery_records: [],
  };
  const previousSnapshot = applyStorylineJudge(snapshot, {action: 'stay'});
  let calls = 0;
  const requests = [];
  const runtime = createProjectionStorylineRuntime({
    analyzer: {
      generateStoryline: async ({messages}) => {
        calls += 1;
        requests.push(messages);
        if (calls === 3) throw new Error('PROGRESSION_REANALYSIS_FAILED');
        return JSON.stringify({
          title: calls === 1 ? '下一阶段目标' : '重新分析后的阶段目标',
          guidance: '结合当前世界条件，让线索跨越一段剧情自然进入下一阶段。',
          completion_signal: '正文出现新的阶段性转折。',
          conclusion_goal: '为后续检查或确认留下入口。',
        });
      },
    },
    getProjectionViews: async options => Number(options?.endpointIndex) === 0
      ? {storyline_snapshots: [previousSnapshot], triggered_snapshots: [], storyline_delivery_records: []}
      : views,
    saveProjectionStorylineSnapshotBatch: async ({snapshots}) => {
      views.storyline_snapshots = snapshots;
      return {status: 'appended'};
    },
    resolveCurrentFloor: async () => ({index: 1, version: floor}),
    getChatId: () => 'chat',
  });
  const inputs = {
    floor: {index: 1, version: floor},
    trackingSubjects: {char_1: {character_id: 'char_1', display_name: '目标人物'}},
    storyContext: [{floor: 19, role: 'assistant', content: '最近发生的正文。'}],
    events: [],
  };
  await runtime.settled({settled: true, inputs, generation: 'g1'});
  assert.equal(calls, 1);
  assert.equal(views.storyline_snapshots[0].progression_event.status, 'active');
  assert.equal(views.storyline_snapshots[0].progression_event.title, '下一阶段目标');
  assert.equal(views.storyline_snapshots[0].selected_branch_id, snapshot.selected_branch_id);
  await runtime.settled({settled: true, inputs, generation: 'g2'});
  assert.equal(calls, 1);
  await runtime.settled({settled: true, inputs, generation: 'projection-refresh', forceStorylineReanalysis: true});
  assert.equal(calls, 2);
  assert.equal(views.storyline_snapshots[0].progression_event.title, '重新分析后的阶段目标');
  assert.equal(views.storyline_snapshots[0].selected_branch_id, snapshot.selected_branch_id);
  assert.equal(requests[1].some(message => message.content.includes('下一阶段目标')), false);
  views.storyline_snapshots[0] = applyStorylineJudge(views.storyline_snapshots[0], {action: 'awaiting_outcome'});
  await runtime.settled({settled: true, inputs, generation: 'projection-refresh-awaiting', forceStorylineReanalysis: true});
  assert.equal(calls, 2);
  views.storyline_snapshots[0] = {
    ...views.storyline_snapshots[0],
    progression_event: {...views.storyline_snapshots[0].progression_event, status: 'active'},
  };
  await runtime.settled({settled: true, inputs, generation: 'projection-refresh-failed', forceStorylineReanalysis: true});
  assert.equal(calls, 3);
  assert.equal(views.storyline_snapshots[0].progression_event.title, '重新分析后的阶段目标');
});

test('progression snapshot persistence failure is reported for a read-only context refresh', async () => {
  const snapshot = completedEntrySnapshot();
  const views = {
    storyline_snapshots: [snapshot],
    triggered_snapshots: [{subject_id: 'char_1', status: 'active', triggered: [{reaction_concept: 'nausea', event_ids: []}]}],
    storyline_delivery_records: [],
  };
  const previousSnapshot = applyStorylineJudge(snapshot, {action: 'stay'});
  const runtime = createProjectionStorylineRuntime({
    analyzer: {
      generateStoryline: async () => JSON.stringify({
        title: '无法确认写回的阶段',
        guidance: '让当前线索按照世界规则继续发展。',
        completion_signal: '正文出现新的阶段变化。',
        conclusion_goal: '留下后续事实入口。',
      }),
    },
    getProjectionViews: async options => Number(options?.endpointIndex) === 0
      ? {storyline_snapshots: [previousSnapshot], triggered_snapshots: [], storyline_delivery_records: []}
      : views,
    saveProjectionStorylineSnapshotBatch: async () => {
      const error = new Error('STORYLINE_READBACK_MISMATCH');
      error.code = 'STORYLINE_READBACK_MISMATCH';
      throw error;
    },
    resolveCurrentFloor: async () => ({index: 1, version: floor}),
    getChatId: () => 'chat',
  });
  const result = await runtime.settled({
    settled: true,
    inputs: {
      floor: {index: 1, version: floor},
      trackingSubjects: {char_1: {character_id: 'char_1', display_name: '目标人物'}},
      storyContext: [{floor: 19, role: 'assistant', content: '最近发生的正文。'}],
      events: [],
    },
    generation: 'persistence-failure',
  });

  assert.equal(result.status, 'partial');
  assert.equal(result.progression_persistence_failed, true);
  assert.equal(result.errors[0].error_code, 'STORYLINE_READBACK_MISMATCH');
  assert.equal(views.storyline_snapshots[0].progression_event, null);
});

test('concurrent settles share one in-flight progression generation request', async () => {
  const snapshot = completedEntrySnapshot();
  const views = {
    storyline_snapshots: [snapshot],
    triggered_snapshots: [{subject_id: 'char_1', status: 'active', triggered: [{reaction_concept: 'nausea', event_ids: []}]}],
    storyline_delivery_records: [],
  };
  const previousSnapshot = applyStorylineJudge(snapshot, {action: 'stay'});
  let calls = 0;
  let resolveApi;
  let apiStartedResolve;
  const apiStarted = new Promise(resolve => { apiStartedResolve = resolve; });
  const runtime = createProjectionStorylineRuntime({
    analyzer: {
      generateStoryline: async () => {
        calls += 1;
        apiStartedResolve();
        return new Promise(resolve => {
          resolveApi = () => resolve(JSON.stringify({
            title: '并发安全阶段',
            guidance: '让当前线索按照世界规则继续发展。',
            completion_signal: '正文出现新的阶段变化。',
            conclusion_goal: '留下后续确认入口。',
          }));
        });
      },
    },
    getProjectionViews: async options => Number(options?.endpointIndex) === 0
      ? {storyline_snapshots: [previousSnapshot], triggered_snapshots: [], storyline_delivery_records: []}
      : views,
    saveProjectionStorylineSnapshotBatch: async ({snapshots}) => {
      views.storyline_snapshots = snapshots;
      return {status: 'appended'};
    },
    resolveCurrentFloor: async () => ({index: 1, version: floor}),
    getChatId: () => 'chat',
  });
  const inputs = {
    floor: {index: 1, version: floor},
    trackingSubjects: {char_1: {character_id: 'char_1', display_name: '目标人物'}},
    storyContext: [{floor: 19, role: 'assistant', content: '最近发生的正文。'}],
    events: [],
  };
  const first = runtime.settled({settled: true, inputs, generation: 'g1'});
  await apiStarted;
  const second = runtime.settled({settled: true, inputs, generation: 'g2'});
  await second;
  assert.equal(calls, 1);
  resolveApi();
  await first;
  assert.equal(calls, 1);
  assert.equal(views.storyline_snapshots[0].progression_event.title, '并发安全阶段');
});

test('projection reanalysis skips design when current Floor already has a selected progression', async () => {
  const selected = completedEntrySnapshot();
  const active = setStorylineProgressionEvent(selected, {
    title: '旧推进阶段',
    guidance: '旧阶段引导。',
    completion_signal: '旧阶段完成信号。',
    conclusion_goal: '旧阶段结论目标。',
    created_at_floor_version: floor,
  });
  const views = {
    storyline_snapshots: [active],
    triggered_snapshots: [{subject_id: 'char_1', status: 'active', triggered: [{reaction_concept: 'nausea', event_ids: []}]}],
    storyline_delivery_records: [],
  };
  let calls = 0;
  const runtime = createProjectionStorylineRuntime({
    analyzer: {
      generateStoryline: async () => {
        calls += 1;
        return JSON.stringify({
          title: '重分析后的推进阶段',
          guidance: '从已选支线继续创造新的阶段性条件。',
          completion_signal: '正文出现新的阶段变化。',
          conclusion_goal: '留下后续事实入口。',
        });
      },
    },
    getProjectionViews: async options => Number(options?.endpointIndex) === 0
      ? {storyline_snapshots: [], triggered_snapshots: [], storyline_delivery_records: []}
      : views,
    saveProjectionStorylineSnapshotBatch: async ({snapshots}) => {
      views.storyline_snapshots = snapshots;
      return {status: 'appended'};
    },
    resolveCurrentFloor: async () => ({index: 1, version: floor}),
    getChatId: () => 'chat',
  });
  const inputs = {
    floor: {index: 1, version: floor},
    trackingSubjects: {char_1: {character_id: 'char_1', display_name: '目标人物'}},
    storyContext: [{floor: 19, role: 'assistant', content: '最近发生的正文。'}],
    events: [],
  };
  await runtime.settled({settled: true, inputs, generation: 'projection-refresh', forceStorylineReanalysis: true});
  assert.equal(calls, 1);
  assert.equal(views.storyline_snapshots[0].progression_event.title, '重分析后的推进阶段');
  assert.equal(views.storyline_snapshots[0].selected_branch_id, active.selected_branch_id);
  assert.equal(views.storyline_snapshots[0].selected_node_id, active.selected_node_id);
});

test('forced active progression reanalysis skips response receipt persistence before its API request', async () => {
  const selected = completedEntrySnapshot();
  const active = setStorylineProgressionEvent(selected, {
    title: '旧推进阶段',
    guidance: '旧阶段引导。',
    completion_signal: '旧阶段完成信号。',
    conclusion_goal: '旧阶段结论目标。',
    created_at_floor_version: floor,
  });
  const views = {
    storyline_snapshots: [active],
    triggered_snapshots: [{subject_id: 'char_1', status: 'active', triggered: [{reaction_concept: 'nausea', event_ids: []}]}],
    storyline_delivery_records: [{
      kind: 'submission',
      subject_id: 'char_1',
      context_fingerprint: 'prior-context',
      created_at_floor_version: {...floor, floor: 19, message_id: 'm19'},
    }],
  };
  const order = [];
  const saveReasons = [];
  const runtime = createProjectionStorylineRuntime({
    analyzer: {
      generateStoryline: async () => {
        order.push('progression-api');
        return JSON.stringify({
          title: '重分析后的推进阶段',
          guidance: '从已选支线继续创造新的阶段性条件。',
          completion_signal: '正文出现新的阶段变化。',
          conclusion_goal: '留下后续事实入口。',
        });
      },
    },
    getProjectionViews: async options => Number(options?.endpointIndex) === 0
      ? {storyline_snapshots: [], triggered_snapshots: [], storyline_delivery_records: []}
      : views,
    saveProjectionStorylineSnapshotBatch: async ({snapshots, traceContext}) => {
      saveReasons.push(traceContext?.reason ?? null);
      views.storyline_snapshots = snapshots;
      return {status: 'appended'};
    },
    saveProjectionStorylineDelivery: async () => {
      order.push('response-receipt-save');
      throw Object.assign(new Error('FLOOR_HOST_SAVE_BARRIER_TIMEOUT'), {code: 'FLOOR_HOST_SAVE_BARRIER_TIMEOUT'});
    },
    resolveCurrentFloor: async () => ({index: 1, version: floor}),
    getChatId: () => 'chat',
  });
  await runtime.settled({settled: true, inputs: {
    floor: {index: 1, version: floor},
    trackingSubjects: {char_1: {character_id: 'char_1', display_name: '目标人物'}},
    storyContext: [{floor: 19, role: 'assistant', content: '最近发生的正文。'}],
    events: [],
  }, responseId: 'body-refresh', generation: 'projection-refresh', forceStorylineReanalysis: true});

  assert.deepEqual(order, ['progression-api']);
  assert.deepEqual(saveReasons, ['progression-generation']);
  assert.equal(views.storyline_snapshots[0].progression_event.title, '重分析后的推进阶段');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PROJECTION_CONTEXT_INJECTION_KEY,
  buildProjectionContext,
  buildProjectionContextDTO,
} from '../core/projection-context.js';
import {createCurrentStateAttributionResolver, createProjectionContextCoordinator} from '../runtime/projection-context.js';
import {createSillyTavernAdapter} from '../runtime/sillytavern-adapter.js';
import {EVENT_ANALYZER_CORE_CONTRACT} from '../ai/prompts.js';

function view(overrides = {}) {
  return {
    projection_id: 'projection-a',
    subject_id: 'char_000002',
    projection_rule_id: 'rule-a',
    development_concern_key: 'concern-a',
    mechanism: {key: 'mechanism-a'},
    development: {kind: 'possible_detection', next_signal: '可能出现可观察的检测迹象。'},
    created_at_floor_version: {message_id: 'message-2'},
    factual_status: 'active',
    deleted: false,
    context_visible: true,
    ...overrides,
  };
}

test('context DTO only contains visible projections and strips storage metadata', () => {
  const views = [
    view(),
    view({projection_id: 'projection-deleted', deleted: true, context_visible: false}),
  ];
  const context = buildProjectionContextDTO(views, {
    attributionBySubject: {
      char_000002: {
        unresolved: true,
        candidates: [{source_character_id: 'char_000003', contribution_kind: 'genetic'}],
      },
    },
  });
  assert.deepEqual(context, [{
    subject_id: 'char_000002',
    development_kind: 'possible_detection',
    description: '可能出现可观察的检测迹象。',
    mechanism: {key: 'mechanism-a'},
    attribution: {
      status: 'unresolved',
      conflict: false,
      confirmed: [],
      candidates: [{source_character_id: 'char_000003', contribution_kind: 'genetic'}],
    },
  }]);
  assert.equal(JSON.stringify(context).includes('projection-a'), false);
  assert.equal(JSON.stringify(context).includes('message-2'), false);
});

test('context ordering is stable and input views remain unchanged', () => {
  const views = [
    view({projection_id: 'projection-b', subject_id: 'char_000002', development_concern_key: 'concern-b'}),
    view({projection_id: 'projection-a', subject_id: 'char_000001'}),
  ];
  const original = structuredClone(views);
  const result = buildProjectionContext(views);
  assert.deepEqual(views, original);
  assert.deepEqual(result.dto.map(item => item.subject_id), ['char_000001', 'char_000002']);
  assert.equal(result.prompt.startsWith('\n<bioweave>\n'), true);
  assert.equal(result.prompt.endsWith('\n</bioweave>\n'), true);
  assert.equal(result.prompt.trim().startsWith('<bioweave>\n'), true);
  assert.equal(result.prompt.trim().endsWith('\n</bioweave>'), true);
  assert.match(result.prompt, /不是已经发生的事实/);
  assert.match(result.prompt, /本模块属于间歇性主动推演参考，与既有伤势及恢复状态独立处理/);
  assert.match(result.prompt, /可能出现可观察的检测迹象/);
});

test('context keeps a triggered prior-stage reaction separate from current candidates', () => {
  const result = buildProjectionContext([view({projection_id: 'current-projection', development_concern_key: 'pre_confirmation_observation:nausea'})], {
    historicalObservations: [{projection_id: 'old-projection', subject_id: 'char_000002', action: 'triggered', reaction_concept: 'nausea'}],
  });
  assert.match(result.prompt, /此前出现过的推演反应（不代表当前仍持续）/);
  assert.match(result.prompt, /恶心/);
  assert.doesNotMatch(result.prompt, /nausea/);
  assert.equal(result.dto.some(item => item.context_type === 'historical_observed_reaction'), true);
});

test('Projection Context drops observation history after the 42-day scope ends', () => {
  const result = buildProjectionContext([view({
    projection_id: 'current-late-projection',
    development_concern_key: 'pre_confirmation_observation:nausea',
    timing: {reference_story_time: {day_index: 0}, current_story_time: {day_index: 50}},
  })], {
    currentStoryTime: {day_index: 50},
    historicalObservations: [{
      projection_id: 'old-projection', subject_id: 'char_000002', action: 'triggered',
      reaction_concept: 'nausea', created_at_floor_version: {floor: 10, message_id: 'm10', swipe_id: 0, message_version: 'v1'},
    }],
  });
  assert.equal(result.dto.some(item => item.context_type === 'historical_observed_reaction'), false);
  assert.doesNotMatch(result.prompt, /此前出现过/);
});

test('Projection Context resolves observation history by Floor order and honors revocation', () => {
  const result = buildProjectionContext([view({
    projection_id: 'current-projection',
    development_concern_key: 'pre_confirmation_observation:nausea',
    timing: {reference_story_time: {day_index: 0}, current_story_time: {day_index: 23}},
  })], {
    currentStoryTime: {day_index: 23},
    historicalObservations: [
      {projection_id: 'old-projection', subject_id: 'char_000002', action: 'revoked', reaction_concept: 'nausea', created_at_floor_version: {floor: 12, message_id: 'm12', swipe_id: 0, message_version: 'v1'}},
      {projection_id: 'old-projection', subject_id: 'char_000002', action: 'triggered', reaction_concept: 'nausea', created_at_floor_version: {floor: 10, message_id: 'm10', swipe_id: 0, message_version: 'v1'}},
    ],
  });
  assert.equal(result.dto.some(item => item.context_type === 'historical_observed_reaction'), false);
  assert.doesNotMatch(result.prompt, /恶心/);
});

test('Projection Context renders the exact built-in direction format without changing the DTO', () => {
  const result = buildProjectionContext([
    view({
      projection_id: 'built-in-fatigue',
      development_concern_key: 'pre_confirmation_observation:fatigue',
      development: {
        kind: 'possible_symptom',
        next_signal: '比平时更早想休息，白天注意力下降；这只是备选剧情方向，不是已确认怀孕事实。',
      },
    }),
  ], {displayNameBySubject: {char_000002: '林月'}});

  assert.deepEqual(result.dto, [{
    subject_id: 'char_000002',
    development_kind: 'possible_symptom',
    description: '比平时更早想休息，白天注意力下降；这只是备选剧情方向，不是已确认怀孕事实。',
    mechanism: {key: 'mechanism-a'},
  }]);
  assert.equal(result.prompt.startsWith('\n<bioweave>\n'), true);
  assert.equal(result.prompt.endsWith('\n</bioweave>\n'), true);
  assert.equal(result.prompt.trim().startsWith('<bioweave>\n'), true);
  assert.equal(result.prompt.trim().endsWith('\n</bioweave>'), true);
  assert.match(result.prompt, /本模块属于间歇性主动推演参考，与既有伤势及恢复状态独立处理。以下内容为各角色可能出现的身体状态。/);
  assert.match(result.prompt, /- 角色 林月：\n  - 生理反应1：嗜睡或疲倦；比平时更早想休息，白天注意力下降/);
  assert.doesNotMatch(result.prompt, /这只是备选剧情方向，不是已确认怀孕事实。/);
  assert.match(result.prompt, /生理反应应作为偶发的生活细节融入剧情，不必每次都成为情节焦点。/);
  assert.doesNotMatch(result.prompt, /发展类型|机制背景|Context 中的 Projection/);
});

test('Projection Context keeps custom content readable without exposing an internal key as title', () => {
  const {prompt} = buildProjectionContext([view({
    development_concern_key: 'custom_internal_key',
    development: {kind: 'possible_change', next_signal: '自定义内容保持原样。'},
  })]);
  assert.match(prompt, /生理反应1：自定义内容保持原样。/);
  assert.doesNotMatch(prompt, /custom_internal_key|；自定义内容/);
});

test('Projection Context prompt uses current display names without changing the DTO contract', () => {
  const result = buildProjectionContext([view()], {
    displayNameBySubject: {char_000002: '林月'},
  });
  assert.deepEqual(result.dto, [{
    subject_id: 'char_000002',
    development_kind: 'possible_detection',
    description: '可能出现可观察的检测迹象。',
    mechanism: {key: 'mechanism-a'},
  }]);
  assert.match(result.prompt, /角色 林月：/);
  assert.doesNotMatch(result.prompt, /char_000002/);
});

test('Projection Context groups directions by subject and keeps the DTO contract', () => {
  const result = buildProjectionContext([
    view({
      projection_id: 'projection-b',
      development_concern_key: 'concern-b',
      development: {kind: 'possible_symptom', next_signal: '可能出现轻微恶心。'},
    }),
    view({
      projection_id: 'projection-c',
      subject_id: 'char_000003',
      development: {kind: 'possible_change', next_signal: '可能出现情绪变化。'},
    }),
    view({
      projection_id: 'projection-a',
      development: {kind: 'possible_detection', next_signal: '可能出现可观察的检测迹象。'},
    }),
  ], {
    displayNameBySubject: {char_000002: '祁鸢', char_000003: '沈微'},
  });

  assert.deepEqual(result.dto.map(({subject_id, development_kind, description, mechanism}) => ({
    subject_id, development_kind, description, mechanism,
  })), [
    {
      subject_id: 'char_000002',
      development_kind: 'possible_detection',
      description: '可能出现可观察的检测迹象。',
      mechanism: {key: 'mechanism-a'},
    },
    {
      subject_id: 'char_000002',
      development_kind: 'possible_symptom',
      description: '可能出现轻微恶心。',
      mechanism: {key: 'mechanism-a'},
    },
    {
      subject_id: 'char_000003',
      development_kind: 'possible_change',
      description: '可能出现情绪变化。',
      mechanism: {key: 'mechanism-a'},
    },
  ]);
  assert.equal((result.prompt.match(/- 角色 祁鸢：/g) ?? []).length, 1);
  assert.equal((result.prompt.match(/- 角色 沈微：/g) ?? []).length, 1);
  assert.match(result.prompt, /角色 祁鸢：\n  - 生理反应1：可能出现可观察的检测迹象。\n  - 生理反应2：可能出现轻微恶心。/);
  assert.match(result.prompt, /角色 沈微：\n  - 生理反应1：可能出现情绪变化。/);
  assert.doesNotMatch(result.prompt, /发展类型|机制背景/);
});

test('Projection Context includes only the current built-in observation stage', async () => {
  const floorVersion = {chat_id: 'chat-stage', floor: 25, message_id: 'message-stage', swipe_id: 0, content_hash: 'hash-stage', message_version: 1};
  const subjectIds = ['char_000002', 'char_000003'];
  const oldViews = subjectIds.flatMap(subjectId => [
    'fatigue', 'breast_sensitivity', 'scent_food_change', 'no_reaction_early',
  ].map(key => view({
    projection_id: `old-${subjectId}-${key}`,
    subject_id: subjectId,
    development_concern_key: `pre_confirmation_observation:${key}`,
    development: {kind: 'possible_symptom', next_signal: `old-${key}`},
    timing: {reference_story_time: {day_index: 1}, elapsed_story_days: 19},
  })));
  const currentViews = subjectIds.flatMap(subjectId => [
    'nausea', 'odor_discomfort', 'mood_change', 'appetite_change',
  ].map(key => view({
    projection_id: `current-${subjectId}-${key}`,
    subject_id: subjectId,
    development_concern_key: `pre_confirmation_observation:${key}`,
    development: {kind: 'possible_symptom', next_signal: `current-${key}`},
    timing: {reference_story_time: {day_index: 1}, elapsed_story_days: 24},
  })));
  const promptWrites = [];
  const coordinator = createProjectionContextCoordinator({
    getProjectionViews: async () => ({all: [...oldViews, ...currentViews]}),
    resolveCurrentFloor: async () => ({version: floorVersion}),
    getChatId: () => 'chat-stage',
    setExtensionPrompt: payload => {
      promptWrites.push(payload.content);
      return true;
    },
  });

  const result = await coordinator.refreshProjectionContext({
    chatId: 'chat-stage',
    businessData: {
      current_floor: {version: floorVersion},
      current_story_time: {day_index: 25},
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.dto.length, 8);
  assert.equal(result.dto.every(item => item.description.startsWith('current-')), true);
  assert.equal(result.dto.filter(item => item.subject_id === 'char_000002').length, 4);
  assert.equal(result.dto.filter(item => item.subject_id === 'char_000003').length, 4);
  assert.deepEqual(result.context_visible_projection_ids, currentViews.map(item => item.projection_id));
  assert.equal(result.prompt.includes('第 14–20 天'), false);
  assert.equal(result.prompt.includes('恶心'), true);
  assert.equal(promptWrites.at(-1).includes('嗜睡或疲倦'), false);
  coordinator.destroy();
});

test('Projection Context keeps the complete previous built-in stage until the current stage is generated', async () => {
  const floorVersion = {chat_id: 'chat-stage-fallback', floor: 25, message_id: 'message-stage-fallback', swipe_id: 0, content_hash: 'hash-stage-fallback', message_version: 1};
  const oldViews = ['fatigue', 'breast_sensitivity', 'scent_food_change', 'no_reaction_early'].map(key => view({
    projection_id: `old-${key}`,
    development_concern_key: `pre_confirmation_observation:${key}`,
    development: {kind: 'possible_symptom', next_signal: `old-${key}`},
    timing: {reference_story_time: {day_index: 1}, elapsed_story_days: 19},
  }));
  const writes = [];
  const coordinator = createProjectionContextCoordinator({
    getProjectionViews: async () => ({all: oldViews}),
    resolveCurrentFloor: async () => ({version: floorVersion}),
    getChatId: () => 'chat-stage-fallback',
    setExtensionPrompt: payload => {
      writes.push(payload);
      return true;
    },
  });

  const result = await coordinator.refreshProjectionContext({
    chatId: 'chat-stage-fallback',
    businessData: {
      current_floor: {version: floorVersion},
      current_story_time: {day_index: 25},
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 'updated');
  assert.equal(result.dto.length, 4);
  assert.deepEqual(result.context_visible_projection_ids, oldViews.map(item => item.projection_id));
  assert.equal(writes.at(-1).content.includes('old-fatigue'), true);
  coordinator.destroy();
});

test('Projection Context resolves built-in stage fallback independently per subject', () => {
  const oldKeys = ['fatigue', 'breast_sensitivity', 'scent_food_change', 'no_reaction_early'];
  const currentKeys = ['nausea', 'odor_discomfort', 'mood_change', 'appetite_change'];
  const oldViews = oldKeys.map(key => view({
    projection_id: `old-subject-a-${key}`,
    subject_id: 'char_000002',
    development_concern_key: `pre_confirmation_observation:${key}`,
    development: {kind: 'possible_symptom', next_signal: `old-a-${key}`},
    timing: {reference_story_time: {day_index: 1}, elapsed_story_days: 19},
  })).concat(oldKeys.map(key => view({
    projection_id: `old-subject-b-${key}`,
    subject_id: 'char_000003',
    development_concern_key: `pre_confirmation_observation:${key}`,
    development: {kind: 'possible_symptom', next_signal: `old-b-${key}`},
    timing: {reference_story_time: {day_index: 1}, elapsed_story_days: 19},
  })));
  const currentViews = currentKeys.map(key => view({
    projection_id: `current-subject-a-${key}`,
    subject_id: 'char_000002',
    development_concern_key: `pre_confirmation_observation:${key}`,
    development: {kind: 'possible_symptom', next_signal: `current-a-${key}`},
    timing: {reference_story_time: {day_index: 1}, elapsed_story_days: 24},
  }));

  const result = buildProjectionContext([...oldViews, ...currentViews], {currentStoryTime: {day_index: 25}});

  assert.equal(result.dto.length, 8);
  assert.deepEqual(result.contextVisibleProjectionIds.sort(), [
    ...currentViews.map(item => item.projection_id),
    ...oldViews.filter(item => item.subject_id === 'char_000003').map(item => item.projection_id),
  ].sort());
  assert.equal(result.dto.filter(item => item.description.startsWith('current-a-')).length, 4);
  assert.equal(result.dto.filter(item => item.description.startsWith('old-b-')).length, 4);
  assert.equal(result.dto.some(item => item.description.startsWith('old-a-')), false);
});

test('Projection Context keeps a split historical stage for a subject while another subject uses its new stage', () => {
  const oldKeys = ['fatigue', 'breast_sensitivity', 'scent_food_change', 'no_reaction_early'];
  const currentKeys = ['nausea', 'odor_discomfort', 'mood_change', 'appetite_change'];
  const currentViews = currentKeys.map(key => view({
    projection_id: `current-a-${key}`,
    subject_id: 'char_000002',
    development_concern_key: `pre_confirmation_observation:${key}`,
    development: {kind: 'possible_symptom', next_signal: `current-a-${key}`},
    timing: {reference_story_time: {day_index: 1}, elapsed_story_days: 24},
  }));
  const splitHistoricalViews = oldKeys.map(key => view({
    projection_id: `old-b-${key}`,
    subject_id: 'char_000003',
    development_concern_key: `pre_confirmation_observation:${key}`,
    development: {kind: 'possible_symptom', next_signal: `old-b-${key}`},
    timing: {reference_story_time: {day_index: 1}, elapsed_story_days: 19},
  }));

  const result = buildProjectionContext([...currentViews, ...splitHistoricalViews], {currentStoryTime: {day_index: 25}});

  assert.equal(result.dto.filter(item => item.subject_id === 'char_000002').length, 4);
  assert.equal(result.dto.filter(item => item.subject_id === 'char_000003').length, 4);
  assert.equal(result.dto.filter(item => item.description.startsWith('current-a-')).length, 4);
  assert.equal(result.dto.filter(item => item.description.startsWith('old-b-')).length, 4);
});

test('Projection Context keeps one subject together when stage branches have different mechanism metadata', () => {
  const oldKeys = ['fatigue', 'breast_sensitivity', 'scent_food_change', 'no_reaction_early'];
  const oldViews = oldKeys.map((key, index) => view({
    projection_id: `old-subject-b-mixed-${key}`,
    subject_id: 'char_000003',
    development_concern_key: `pre_confirmation_observation:${key}`,
    mechanism: {key: index % 2 === 0 ? 'mechanism-a' : 'mechanism-b'},
    development: {kind: 'possible_symptom', next_signal: `old-b-${key}`},
    timing: {reference_story_time: {day_index: 1}, elapsed_story_days: 19},
  }));

  const result = buildProjectionContext(oldViews, {currentStoryTime: {day_index: 25}});

  assert.equal(result.dto.length, 4);
  assert.deepEqual(result.contextVisibleProjectionIds.sort(), oldViews.map(item => item.projection_id).sort());
  assert.equal(result.dto.every(item => item.description.startsWith('old-b-')), true);
});

test('Projection Context keeps distinct pregnancy identities isolated for one subject', () => {
  const oldKeys = ['fatigue', 'breast_sensitivity', 'scent_food_change', 'no_reaction_early'];
  const currentKeys = ['nausea', 'odor_discomfort', 'mood_change', 'appetite_change'];
  const oldViews = oldKeys.map(key => view({
    projection_id: `old-cycle-a-${key}`,
    development_concern_key: `pre_confirmation_observation:${key}`,
    aggregation_evidence: {pregnancy_id: null, cycle_id: 'cycle-a'},
    mechanism: {key: 'mechanism-a'},
    development: {kind: 'possible_symptom', next_signal: `old-cycle-a-${key}`},
    timing: {reference_story_time: {day_index: 1}, elapsed_story_days: 19},
  }));
  const currentViews = currentKeys.map(key => view({
    projection_id: `current-cycle-b-${key}`,
    development_concern_key: `pre_confirmation_observation:${key}`,
    aggregation_evidence: {pregnancy_id: 'pregnancy-b', cycle_id: 'cycle-b'},
    mechanism: {key: 'mechanism-b'},
    development: {kind: 'possible_symptom', next_signal: `current-cycle-b-${key}`},
    timing: {reference_story_time: {day_index: 1}, elapsed_story_days: 24},
  }));

  const result = buildProjectionContext([...oldViews, ...currentViews], {currentStoryTime: {day_index: 25}});

  assert.equal(result.dto.length, 8);
  assert.equal(result.dto.filter(item => item.description.startsWith('old-cycle-a-')).length, 4);
  assert.equal(result.dto.filter(item => item.description.startsWith('current-cycle-b-')).length, 4);
});

test('Projection Context does not retain a previous built-in stage after the observation window', () => {
  const oldViews = ['fatigue', 'breast_sensitivity', 'scent_food_change', 'no_reaction_early'].map(key => view({
    projection_id: `expired-${key}`,
    development_concern_key: `pre_confirmation_observation:${key}`,
    development: {kind: 'possible_symptom', next_signal: `expired-${key}`},
    timing: {reference_story_time: {day_index: 1}, elapsed_story_days: 19},
  }));

  const result = buildProjectionContext(oldViews, {currentStoryTime: {day_index: 44}});

  assert.deepEqual(result.dto, []);
  assert.deepEqual(result.contextVisibleProjectionIds, []);
});

test('health recovery guidance shares the projection context slot without exposing timing internals', () => {
  const result = buildProjectionContext([], {
    healthGuidance: [{
      subject_id: 'char_000002',
      body_site: '左手腕',
      stage: 'recovering',
      guidance: '疼痛已比早期减轻，日常活动有所恢复，但用力时仍可能引起不适。',
    }],
  });
  assert.equal(result.dto.length, 1);
  assert.equal(result.dto[0].context_type, 'health_recovery_guidance');
  assert.equal(result.prompt.startsWith('\n<bioweave>\n'), true);
  assert.equal(result.prompt.endsWith('\n</bioweave>\n'), true);
  assert.equal(result.prompt.trim().startsWith('<bioweave>\n'), true);
  assert.equal(result.prompt.trim().endsWith('\n</bioweave>'), true);
  assert.match(result.prompt, /恢复阶段身体表现指导/);
  assert.match(result.prompt, /无关场景无需主动提及/);
  assert.match(result.prompt, /不要机械重复健康问题/);
  assert.doesNotMatch(result.prompt, /remaining_days\s*=|deadline\s*=|story_days\s*=|assessment_id\s*=|event_id\s*=|recovering/);
});

test('health recovery guidance uses the current display name and safely falls back when absent', () => {
  const named = buildProjectionContext([], {
    displayNameBySubject: {char_000002: '林月'},
    healthGuidance: [{
      subject_id: 'char_000002',
      body_site: '左手腕',
      stage: 'recovering',
      guidance: '仍可能引起不适。',
    }],
  });
  assert.match(named.prompt, /角色 林月 的左手腕/);
  assert.doesNotMatch(named.prompt, /char_000002/);

  const unnamed = buildProjectionContext([view({subject_id: 'char_000003'})], {
    healthGuidance: [{
      subject_id: 'char_000004',
      body_site: '右肩',
      stage: 'early',
      guidance: '可能出现明显身体反应。',
    }],
  });
  assert.match(unnamed.prompt, /角色 相关人物：/);
  assert.match(unnamed.prompt, /角色 相关人物 的右肩/);
  assert.doesNotMatch(unnamed.prompt, /char_000003|char_000004/);
});

test('health recovery guidance prompt does not duplicate a factual body-site direction', () => {
  const result = buildProjectionContext([], {
    displayNameBySubject: {char_000002: '林月'},
    healthGuidance: [{
      subject_id: 'char_000002',
      body_site: '右手食指',
      stage: 'early',
      guidance: '受到刺激时可能出现不适。',
    }],
  });

  assert.match(result.prompt, /角色 林月 的右手食指：受到刺激时可能出现不适。/);
  assert.doesNotMatch(result.prompt, /右右手食指/);
});

test('multiple unresolved source candidates are not selected or ranked', () => {
  const {prompt} = buildProjectionContext([view()], {
    attributionBySubject: {
      char_000002: {
        unresolved: true,
        candidates: [
          {source_character_id: 'char_000003', contribution_kind: 'genetic'},
          {source_character_id: 'char_000004', contribution_kind: 'magical'},
        ],
      },
    },
  });
  assert.match(prompt, /多个尚未确认的来源候选/);
  assert.doesNotMatch(prompt, /char_000003|char_000004/);
});

test('coordinator updates one injection slot and clears when no visible projection exists', async () => {
  const writes = [];
  let views = {all: [view()]};
  const coordinator = createProjectionContextCoordinator({
    getProjectionViews: async () => views,
    resolveCurrentFloor: async () => ({version: {chat_id: 'chat-a', floor: 2}}),
    getChatId: () => 'chat-a',
    setExtensionPrompt: payload => writes.push(payload),
  });
  const updated = await coordinator.refreshProjectionContext();
  assert.equal(updated.status, 'updated');
  assert.equal(writes.at(-1).key, PROJECTION_CONTEXT_INJECTION_KEY);
  assert.equal(writes.at(-1).position, 'IN_CHAT');
  assert.equal(writes.at(-1).depth, 4);
  assert.equal(writes.at(-1).role, 'SYSTEM');
  views = {all: []};
  const cleared = await coordinator.refreshProjectionContext();
  assert.equal(cleared.status, 'cleared');
  assert.equal(writes.at(-1).content, '');
});

test('coordinator diagnostics report the subjects and projections actually written to ST', async () => {
  const writes = [];
  const diagnostics = [];
  const floorVersion = {
    chat_id: 'chat-debug', message_id: 'message-debug', floor: 2, swipe_id: 0,
    content_hash: 'hash-debug', message_version: 1,
  };
  const coordinator = createProjectionContextCoordinator({
    getProjectionViews: async () => ({all: [
      view({projection_id: 'projection-a', subject_id: 'char_000002'}),
      view({projection_id: 'projection-b', subject_id: 'char_000003'}),
      view({projection_id: 'projection-hidden', subject_id: 'char_000003', context_visible: false}),
    ]}),
    resolveCurrentFloor: async () => ({version: floorVersion}),
    getChatId: () => 'chat-debug',
    setExtensionPrompt: payload => writes.push(payload),
    trace: item => diagnostics.push(item),
  });

  const result = await coordinator.refreshProjectionContext({
    businessData: {
      current_floor: {version: floorVersion},
      tracking_subjects: {
        char_000002: {character_id: 'char_000002', display_name: '甲'},
        char_000003: {character_id: 'char_000003', display_name: '乙'},
      },
    },
  });

  const slot = diagnostics.find(item => item.stage === 'PROJECTION_CONTEXT_SLOT_WRITTEN');
  assert.equal(result.status, 'updated');
  assert.equal(writes.at(-1).content, result.prompt);
  assert.deepEqual(slot.st_written_subject_ids, ['char_000002', 'char_000003']);
  assert.equal(slot.st_written_subject_count, 2);
  assert.deepEqual(slot.st_written_subjects, [
    {subject_id: 'char_000002', display_name: '甲', projection_count: 1},
    {subject_id: 'char_000003', display_name: '乙', projection_count: 1},
  ]);
  assert.deepEqual(slot.st_written_projection_ids, ['projection-a', 'projection-b']);
  assert.equal(slot.st_written_projection_count, 2);
  coordinator.destroy();
});

test('coordinator reuses a caller-provided Projection snapshot without rereading it', async () => {
  let reads = 0;
  const snapshot = {all: [view()]};
  const coordinator = createProjectionContextCoordinator({
    getProjectionViews: async () => { reads += 1; return {all: []}; },
    resolveCurrentFloor: async () => ({version: {chat_id: 'chat-a', floor: 2}}),
    getChatId: () => 'chat-a',
    setExtensionPrompt: () => {},
  });
  const result = await coordinator.refreshProjectionContext({projectionViews: snapshot});
  assert.equal(result.status, 'updated');
  assert.equal(reads, 0);
  assert.equal(result.dto.length, 1);
});

test('coordinator read-only restore refreshes the slot without recording delivery', async () => {
  const submissions = [];
  const coordinator = createProjectionContextCoordinator({
    getProjectionViews: async () => ({all: [view()]}),
    resolveCurrentFloor: async () => ({version: {
      chat_id: 'chat-a', message_id: 'message-a', floor: 2, swipe_id: 0,
      content_hash: 'hash-a', message_version: 'v1',
    }}),
    getChatId: () => 'chat-a',
    setExtensionPrompt: () => {},
    recordProjectionSubmission: async payload => {
      submissions.push(payload);
      return {status: 'readback_verified'};
    },
  });

  const result = await coordinator.refreshProjectionContext({readOnly: true});

  assert.equal(result.status, 'updated');
  assert.equal(result.submission, null);
  assert.equal(submissions.length, 0);
});

test('coordinator reads Projection data only through the current Floor endpoint', async () => {
  const floorVersion = {
    chat_id: 'chat-endpoint', message_id: 'message-endpoint', floor: 23, swipe_id: 0,
    content_hash: 'hash-endpoint', message_version: 'v1',
  };
  let endpoint = null;
  const coordinator = createProjectionContextCoordinator({
    getProjectionViews: async args => { endpoint = args; return {all: []}; },
    resolveCurrentFloor: async () => ({index: 9, version: floorVersion}),
    getChatId: () => 'chat-endpoint',
    setExtensionPrompt: () => {},
  });

  await coordinator.refreshProjectionContext();

  assert.deepEqual(endpoint, {chatId: 'chat-endpoint', endpointFloor: 23, endpointIndex: 9});
  coordinator.destroy();
});

test('coordinator reuses an unchanged Floor context without repeating resolvers or delivery writes', async () => {
  const floorVersion = {
    chat_id: 'chat-a', message_id: 'message-a', floor: 2, swipe_id: 0,
    content_hash: 'hash-a', message_version: 'v1',
  };
  const snapshot = {all: [view()]};
  const businessData = {current_floor: {version: floorVersion}, current_story_time: {day_index: 2}};
  const writes = [];
  let evidenceReads = 0;
  let attributionReads = 0;
  let guidanceReads = 0;
  let submissions = 0;
  const coordinator = createProjectionContextCoordinator({
    getProjectionViews: async () => { throw new Error('UNCHANGED_CONTEXT_MUST_USE_SNAPSHOT'); },
    resolveCurrentFloor: async () => ({version: floorVersion}),
    getChatId: () => 'chat-a',
    setExtensionPrompt: payload => writes.push(payload),
    projectionEvidenceResolver: async ({views}) => { evidenceReads += 1; return views; },
    attributionResolver: async () => { attributionReads += 1; return {}; },
    healthGuidanceResolver: async () => { guidanceReads += 1; return []; },
    recordProjectionSubmission: async () => { submissions += 1; return {status: 'readback_verified'}; },
  });

  const first = await coordinator.refreshProjectionContext({projectionViews: snapshot, businessData});
  const second = await coordinator.refreshProjectionContext({
    projectionViews: structuredClone(snapshot),
    businessData: structuredClone(businessData),
  });

  assert.equal(first.status, 'updated');
  assert.equal(second.status, 'unchanged');
  assert.equal(writes.length, 1);
  assert.equal(evidenceReads, 1);
  assert.equal(attributionReads, 1);
  assert.equal(guidanceReads, 1);
  assert.equal(submissions, 1);
  coordinator.destroy();
});

test('read-only context reuse leaves the later delivery submission pending', async () => {
  const floorVersion = {
    chat_id: 'chat-a', message_id: 'message-a', floor: 2, swipe_id: 0,
    content_hash: 'hash-a', message_version: 'v1',
  };
  const snapshot = {all: [view()]};
  let submissions = 0;
  const coordinator = createProjectionContextCoordinator({
    getProjectionViews: async () => snapshot,
    resolveCurrentFloor: async () => ({version: floorVersion}),
    getChatId: () => 'chat-a',
    setExtensionPrompt: () => true,
    recordProjectionSubmission: async () => { submissions += 1; return {status: 'readback_verified'}; },
  });

  const readOnly = await coordinator.refreshProjectionContext({projectionViews: snapshot, readOnly: true});
  const delivered = await coordinator.refreshProjectionContext({projectionViews: structuredClone(snapshot)});

  assert.equal(readOnly.status, 'updated');
  assert.equal(delivered.status, 'unchanged');
  assert.equal(submissions, 1);
  coordinator.destroy();
});

test('read-only context does not reuse stale Health Guidance on the same Floor', async () => {
  const floorVersion = {
    chat_id: 'chat-a', message_id: 'message-a', floor: 2, swipe_id: 0,
    content_hash: 'hash-a', message_version: 'v1',
  };
  let guidance = 'HEALTH_EARLY';
  let reads = 0;
  const coordinator = createProjectionContextCoordinator({
    getProjectionViews: async () => ({all: []}),
    resolveCurrentFloor: async () => ({version: floorVersion}),
    getChatId: () => 'chat-a',
    setExtensionPrompt: () => true,
    healthGuidanceResolver: async () => {
      reads += 1;
      return [{subject_id: 'char_000002', body_site: '右肩', stage: 'early', guidance}];
    },
  });
  const first = await coordinator.refreshProjectionContext({readOnly: true});
  guidance = 'HEALTH_RECOVERING';
  const second = await coordinator.refreshProjectionContext({readOnly: true});
  assert.match(first.prompt, /HEALTH_EARLY/);
  assert.match(second.prompt, /HEALTH_RECOVERING/);
  assert.equal(reads, 2);
  coordinator.destroy();
});

test('coordinator combines Health Guidance with projections and clears both from the same slot', async () => {
  const writes = [];
  let guidance = [{
    subject_id: 'char_000002',
    body_site: '左手腕',
    stage: 'near_recovery',
    guidance: '大部分普通活动不再明显受影响。',
  }];
  const coordinator = createProjectionContextCoordinator({
    getProjectionViews: async () => ({all: [view()]}),
    healthGuidanceResolver: async () => guidance,
    resolveCurrentFloor: async () => ({version: {
      chat_id: 'chat-a', message_id: 'message-a', floor: 2, swipe_id: 0,
      content_hash: 'hash-a', message_version: 'v1',
    }}),
    getChatId: () => 'chat-a',
    setExtensionPrompt: payload => writes.push(payload),
  });
  const result = await coordinator.refreshProjectionContext();
  assert.equal(result.status, 'updated');
  assert.equal(result.dto.length, 2);
  assert.match(result.prompt, /生物发展方向/);
  assert.match(result.prompt, /恢复阶段身体表现指导/);
  guidance = [];
  const clearedHealth = await coordinator.refreshProjectionContext();
  assert.equal(clearedHealth.dto.length, 1);
  assert.doesNotMatch(clearedHealth.prompt, /左手腕/);
});

test('coordinator derives prompt display names from the current business snapshot', async () => {
  const writes = [];
  const floorVersion = {
    chat_id: 'chat-a', message_id: 'message-a', floor: 2, swipe_id: 0,
    content_hash: 'hash-a', message_version: 'v1',
  };
  const coordinator = createProjectionContextCoordinator({
    getProjectionViews: async () => ({all: [view()]}),
    resolveCurrentFloor: async () => ({version: floorVersion}),
    getChatId: () => 'chat-a',
    setExtensionPrompt: payload => writes.push(payload),
    healthGuidanceResolver: async () => [],
    collectActiveBusinessData: async () => ({
      current_floor: {version: floorVersion},
      current_state_status: 'ready',
      tracking_subjects: {char_000002: {character_id: 'char_000002', display_name: '林月'}},
    }),
  });

  const result = await coordinator.refreshProjectionContext();

  assert.equal(result.status, 'updated');
  assert.match(writes.at(-1).content, /角色 林月：/);
  assert.doesNotMatch(writes.at(-1).content, /char_000002/);
});

test('coordinator keeps Health Guidance when Projection views are empty', async () => {
  const writes = [];
  const diagnostics = [];
  const coordinator = createProjectionContextCoordinator({
    getProjectionViews: async () => ({all: []}),
    healthGuidanceResolver: async () => [{
      subject_id: 'char_000002',
      body_site: '右肩',
      stage: 'early',
      guidance: '右肩在受到刺激时可能出现明显身体反应。',
    }],
    resolveCurrentFloor: async () => ({version: {chat_id: 'chat-a', floor: 2}}),
    getChatId: () => 'chat-a',
    setExtensionPrompt: payload => writes.push(payload),
    trace: item => diagnostics.push(item),
  });

  const result = await coordinator.refreshProjectionContext();

  assert.equal(result.status, 'updated');
  assert.equal(result.dto.length, 1);
  assert.match(writes.at(-1).content, /右肩/);
  assert.equal(diagnostics.some(item => item.stage === 'PROJECTION_CONTEXT_HEALTH_INPUT' && item.health_guidance_count === 1), true);
  assert.equal(diagnostics.some(item => item.stage === 'PROJECTION_CONTEXT_SLOT_WRITTEN' && item.health_guidance_count === 1), true);
  assert.equal(diagnostics.some(item => item.stage === 'PROJECTION_CONTEXT_SLOT_CLEARED'), false);
});

test('Health-only context writes through the SillyTavern adapter without exported constants on context', async () => {
  const calls = [];
  const previous = globalThis.SillyTavern;
  globalThis.SillyTavern = {getContext: () => ({
    chatId: 'chat-a',
    setExtensionPrompt: (...args) => calls.push(args),
  })};
  try {
    const adapter = createSillyTavernAdapter();
    const coordinator = createProjectionContextCoordinator({
      getProjectionViews: async () => ({all: []}),
      healthGuidanceResolver: async () => [{
        subject_id: 'char_000002', body_site: '右肩', stage: 'early', guidance: 'HEALTH_ONLY',
      }],
      resolveCurrentFloor: async () => ({version: {chat_id: 'chat-a', floor: 2}}),
      getChatId: () => 'chat-a',
      setExtensionPrompt: adapter.setExtensionPrompt,
    });
    const result = await coordinator.refreshProjectionContext();
    assert.equal(result.status, 'updated');
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].slice(0, 1), ['bioweave_projection_context']);
    assert.equal(calls[0][2], 1);
    assert.equal(calls[0][5], 0);
    coordinator.destroy();
  } finally {
    if (previous === undefined) delete globalThis.SillyTavern;
    else globalThis.SillyTavern = previous;
  }
});

test('coordinator clears the shared slot only when Projection and Health Guidance are both empty', async () => {
  const writes = [];
  const diagnostics = [];
  const coordinator = createProjectionContextCoordinator({
    getProjectionViews: async () => ({all: []}),
    healthGuidanceResolver: async () => [],
    resolveCurrentFloor: async () => ({version: {chat_id: 'chat-a', floor: 2}}),
    getChatId: () => 'chat-a',
    setExtensionPrompt: payload => writes.push(payload),
    trace: item => diagnostics.push(item),
  });

  const result = await coordinator.refreshProjectionContext();

  assert.equal(result.status, 'cleared');
  assert.equal(writes.at(-1).content, '');
  assert.equal(diagnostics.some(item => item.stage === 'PROJECTION_CONTEXT_SLOT_CLEARED' && item.clear_reason === 'both_context_inputs_empty'), true);
});

test('serialized refreshes prevent an older empty result from clearing newer Health Guidance', async () => {
  const writes = [];
  let releaseFirstRead;
  const firstRead = new Promise(resolve => { releaseFirstRead = resolve; });
  let reads = 0;
  let guidanceReads = 0;
  const coordinator = createProjectionContextCoordinator({
    getProjectionViews: async () => {
      reads += 1;
      if (reads === 1) await firstRead;
      return {all: []};
    },
    healthGuidanceResolver: async () => {
      guidanceReads += 1;
      return guidanceReads === 1 ? [] : [{
        subject_id: 'char_000002',
        body_site: '右肩',
        stage: 'early',
        guidance: '右肩在受到刺激时可能出现明显身体反应。',
      }];
    },
    resolveCurrentFloor: async () => ({version: {chat_id: 'chat-a', floor: 2}}),
    getChatId: () => 'chat-a',
    setExtensionPrompt: payload => writes.push(payload),
  });

  const first = coordinator.refreshProjectionContext();
  const second = coordinator.refreshProjectionContext();
  releaseFirstRead();
  await Promise.all([first, second]);

  assert.equal(reads, 2);
  assert.equal(guidanceReads, 2);
  assert.match(writes.at(-1).content, /右肩/);
});

test('Health Guidance read failure does not clear a valid Projection Context', async () => {
  const coordinator = createProjectionContextCoordinator({
    getProjectionViews: async () => ({all: [view()]}),
    healthGuidanceResolver: async () => { throw new Error('HEALTH_READ_FAILED'); },
    resolveCurrentFloor: async () => ({version: {
      chat_id: 'chat-a', message_id: 'message-a', floor: 2, swipe_id: 0,
      content_hash: 'hash-a', message_version: 'v1',
    }}),
    getChatId: () => 'chat-a',
    setExtensionPrompt: () => true,
  });
  const result = await coordinator.refreshProjectionContext();
  assert.equal(result.status, 'updated');
  assert.equal(result.dto.length, 1);
  assert.match(result.prompt, /生物发展方向/);
});

test('coordinator refresh reads attribution through the resolver and updates the context summary', async () => {
  const writes = [];
  let attribution = {
    char_000002: {
      confirmed: [{source_character_id: 'char_000003', contribution_kind: 'genetic'}],
    },
  };
  const coordinator = createProjectionContextCoordinator({
    getProjectionViews: async () => ({all: [view()]}),
    resolveCurrentFloor: async () => ({version: {chat_id: 'chat-a', floor: 2}}),
    getChatId: () => 'chat-a',
    attributionResolver: async ({chatId, floor}) => {
      assert.equal(chatId, 'chat-a');
      assert.equal(floor.version.floor, 2);
      return attribution;
    },
    setExtensionPrompt: payload => writes.push(payload),
  });
  const first = await coordinator.refreshProjectionContext();
  assert.match(first.prompt, /已确认的生殖贡献者/);
  attribution = {char_000002: {unresolved: true, conflicts: [{relationship_key: 'conflict'}]}};
  const second = await coordinator.refreshProjectionContext();
  assert.match(second.prompt, /存在冲突/);
  assert.equal(writes.length, 2);
});

test('coordinator shares one local business snapshot across Projection resolvers', async () => {
  const writes = [];
  const floorVersions = [
    {chat_id: 'chat-a', message_id: 'message-a', floor: 2, swipe_id: 0, content_hash: 'hash-a', message_version: 'v1'},
    {chat_id: 'chat-a', message_id: 'message-b', floor: 3, swipe_id: 0, content_hash: 'hash-b', message_version: 'v1'},
  ];
  const businessSnapshots = [
    {marker: 'BUSINESS_A', current_floor: {version: floorVersions[0]}, current_state: {marker: 'STATE_A'}},
    {marker: 'BUSINESS_B', current_floor: {version: floorVersions[1]}, current_state: {marker: 'STATE_B'}},
  ];
  let refreshIndex = 0;
  let reads = 0;
  const seen = [];
  const coordinator = createProjectionContextCoordinator({
    getProjectionViews: async () => ({all: [view()]}),
    resolveCurrentFloor: async () => ({version: floorVersions[refreshIndex]}),
    getChatId: () => 'chat-a',
    setExtensionPrompt: payload => writes.push(payload),
    collectActiveBusinessData: async () => businessSnapshots[reads++],
    projectionEvidenceResolver: async ({views, businessData}) => {
      seen.push(['evidence', businessData]);
      return {
        all: views.all.map(item => ({
          ...item,
          development: {...item.development, next_signal: businessData.marker},
        })),
      };
    },
    attributionResolver: async ({businessData}) => {
      seen.push(['attribution', businessData]);
      return {
        char_000002: {
          confirmed: [{source_character_id: businessData.current_state.marker, contribution_kind: 'genetic'}],
        },
      };
    },
    healthGuidanceResolver: async ({businessData}) => {
      seen.push(['health', businessData]);
      return [{
        subject_id: 'char_000002',
        body_site: '左手腕',
        stage: 'early',
        guidance: businessData.marker,
      }];
    },
  });

  const first = await coordinator.refreshProjectionContext();
  assert.equal(reads, 1);
  assert.equal(seen.length, 3);
  assert.equal(new Set(seen.map(([, business]) => business)).size, 1);
  assert.match(first.prompt, /BUSINESS_A/);
  assert.deepEqual(first.dto[0].attribution.confirmed[0].source_character_id, 'STATE_A');

  refreshIndex = 1;
  seen.length = 0;
  const second = await coordinator.refreshProjectionContext();
  assert.equal(reads, 2);
  assert.equal(new Set(seen.map(([, business]) => business)).size, 1);
  assert.match(second.prompt, /BUSINESS_B/);
  assert.deepEqual(second.dto[0].attribution.confirmed[0].source_character_id, 'STATE_B');
  assert.equal(writes.length, 2);
});

test('coordinator performs one business read when only a subset of resolvers is configured', async () => {
  let reads = 0;
  let received = null;
  const coordinator = createProjectionContextCoordinator({
    getProjectionViews: async () => ({all: []}),
    resolveCurrentFloor: async () => ({version: {chat_id: 'chat-a', floor: 2}}),
    getChatId: () => 'chat-a',
    setExtensionPrompt: () => true,
    collectActiveBusinessData: async () => {
      reads += 1;
      return {marker: 'BUSINESS_ONLY'};
    },
    healthGuidanceResolver: async ({businessData, businessDataResolved}) => {
      received = {businessData, businessDataResolved};
      return [];
    },
  });

  const result = await coordinator.refreshProjectionContext();
  assert.equal(result.status, 'cleared');
  assert.equal(reads, 1);
  assert.deepEqual(received, {businessData: {marker: 'BUSINESS_ONLY'}, businessDataResolved: true});
});

test('coordinator reuses a caller-provided business snapshot for the same Floor', async () => {
  const floorVersion = {
    chat_id: 'chat-a',
    message_id: 'message-a',
    floor: 2,
    swipe_id: 0,
    content_hash: 'hash-a',
    message_version: 'v1',
  };
  const businessData = {
    marker: 'CALLER_SNAPSHOT',
    current_floor: {version: floorVersion},
    current_state_status: 'ready',
    current_state: {marker: 'state-a'},
  };
  let fallbackReads = 0;
  const coordinator = createProjectionContextCoordinator({
    getProjectionViews: async () => ({all: []}),
    resolveCurrentFloor: async () => ({version: floorVersion}),
    getChatId: () => 'chat-a',
    setExtensionPrompt: () => true,
    collectActiveBusinessData: async () => {
      fallbackReads += 1;
      throw new Error('UNEXPECTED_CANONICAL_REBUILD');
    },
    healthGuidanceResolver: async ({businessData: received}) => [{
      subject_id: 'char_000002',
      body_site: '右肩',
      stage: 'early',
      guidance: received?.marker ?? 'MISSING_SNAPSHOT',
    }],
  });

  const result = await coordinator.refreshProjectionContext({chatId: 'chat-a', businessData});

  assert.equal(result.status, 'updated');
  assert.match(result.prompt, /CALLER_SNAPSHOT/);
  assert.equal(fallbackReads, 0);
});

test('coordinator rejects a caller-provided business snapshot from another Floor', async () => {
  const currentVersion = {
    chat_id: 'chat-a',
    message_id: 'message-current',
    floor: 3,
    swipe_id: 0,
    content_hash: 'hash-current',
    message_version: 'v2',
  };
  const staleBusiness = {
    marker: 'STALE_CALLER_SNAPSHOT',
    current_floor: {version: {
      ...currentVersion,
      message_id: 'message-old',
      floor: 2,
      content_hash: 'hash-old',
      message_version: 'v1',
    }},
    current_state_status: 'ready',
    current_state: {marker: 'state-old'},
  };
  let fallbackReads = 0;
  const coordinator = createProjectionContextCoordinator({
    getProjectionViews: async () => ({all: []}),
    resolveCurrentFloor: async () => ({version: currentVersion}),
    getChatId: () => 'chat-a',
    setExtensionPrompt: () => true,
    collectActiveBusinessData: async () => {
      fallbackReads += 1;
      return {
        marker: 'CURRENT_FALLBACK_SNAPSHOT',
        current_floor: {version: currentVersion},
        current_state_status: 'ready',
        current_state: {marker: 'state-current'},
      };
    },
    healthGuidanceResolver: async ({businessData: received}) => [{
      subject_id: 'char_000002',
      body_site: '右肩',
      stage: 'early',
      guidance: received?.marker ?? 'MISSING_SNAPSHOT',
    }],
  });

  const result = await coordinator.refreshProjectionContext({chatId: 'chat-a', businessData: staleBusiness});

  assert.equal(result.status, 'updated');
  assert.match(result.prompt, /CURRENT_FALLBACK_SNAPSHOT/);
  assert.doesNotMatch(result.prompt, /STALE_CALLER_SNAPSHOT/);
  assert.equal(fallbackReads, 1);
});

test('coordinator does not use display names from a business snapshot from another Floor', async () => {
  const currentVersion = {
    chat_id: 'chat-a', message_id: 'message-current', floor: 3, swipe_id: 0,
    content_hash: 'hash-current', message_version: 'v2',
  };
  const writes = [];
  const coordinator = createProjectionContextCoordinator({
    getProjectionViews: async () => ({all: [view()]}),
    resolveCurrentFloor: async () => ({version: currentVersion}),
    getChatId: () => 'chat-a',
    setExtensionPrompt: payload => writes.push(payload),
    collectActiveBusinessData: async () => ({
      current_floor: {version: currentVersion},
      tracking_subjects: {},
    }),
    healthGuidanceResolver: async () => [],
  });

  await coordinator.refreshProjectionContext({
    chatId: 'chat-a',
    businessData: {
      current_floor: {version: {...currentVersion, floor: 2, message_id: 'message-old'}},
      tracking_subjects: {char_000002: {character_id: 'char_000002', display_name: '旧名字'}},
    },
  });

  assert.match(writes.at(-1).content, /角色 相关人物：/);
  assert.doesNotMatch(writes.at(-1).content, /旧名字|char_000002/);
});

test('current State attribution resolver fails closed for chat, Floor, Swipe, and state mismatches', async () => {
  const version = {chat_id: 'chat-a', message_id: 'message-a', floor: 2, swipe_id: 1, content_hash: 'hash-a', message_version: 'v1'};
  let business = {
    current_state_status: 'ready',
    current_floor: {version},
    current_state: {characters: {}},
  };
  let reads = 0;
  const resolver = createCurrentStateAttributionResolver({
    collectActiveBusinessData: async () => {
      reads += 1;
      return business;
    },
  });
  assert.deepEqual(await resolver({chatId: 'chat-b', floor: {version}}), {});
  assert.equal(reads, 0);
  assert.deepEqual(await resolver({chatId: 'chat-a', floor: {version: {...version, swipe_id: 0}}}), {});
  assert.equal(reads, 1);
  business = {...business, current_floor: {version: {...version, message_version: 'v2'}}};
  assert.deepEqual(await resolver({chatId: 'chat-a', floor: {version}}), {});
  business = {...business, current_floor: {version}, current_state_status: 'STATE_ERROR'};
  assert.deepEqual(await resolver({chatId: 'chat-a', floor: {version}}), {});
});

test('disabled coordinator clears immediately and never reinjects on refresh', async () => {
  const writes = [];
  let enabled = true;
  const coordinator = createProjectionContextCoordinator({
    getProjectionViews: async () => ({all: [view()]}),
    resolveCurrentFloor: async () => ({version: {chat_id: 'chat-a', floor: 2}}),
    getChatId: () => 'chat-a',
    enabledResolver: () => enabled,
    setExtensionPrompt: payload => writes.push(payload),
  });
  assert.equal((await coordinator.refreshProjectionContext()).status, 'updated');
  enabled = false;
  assert.equal(coordinator.clearProjectionContext().status, 'cleared');
  assert.equal(writes.at(-1).content, '');
  const refreshed = await coordinator.refreshProjectionContext();
  assert.equal(refreshed.status, 'cleared');
  assert.equal(writes.at(-1).content, '');
  enabled = true;
  assert.equal((await coordinator.refreshProjectionContext()).status, 'updated');
});

test('coordinator clears for missing Character Floor and isolates chat scope', async () => {
  const writes = [];
  const coordinator = createProjectionContextCoordinator({
    getProjectionViews: async ({chatId}) => chatId === 'chat-a' ? {all: [view()]} : {all: []},
    resolveCurrentFloor: async () => { throw new Error('NO_CHARACTER_FLOOR'); },
    getChatId: () => 'chat-b',
    setExtensionPrompt: payload => writes.push(payload),
  });
  const result = await coordinator.refreshProjectionContext();
  assert.equal(result.status, 'cleared');
  assert.equal(writes.at(-1).content, '');
});

test('coordinator fails closed when extension prompt injection is unavailable', async () => {
  const coordinator = createProjectionContextCoordinator({
    getProjectionViews: async () => ({all: []}),
    resolveCurrentFloor: async () => { throw new Error('NO_CHARACTER_FLOOR'); },
    getChatId: () => 'chat-a',
  });
  const result = await coordinator.refreshProjectionContext();
  assert.equal(result.ok, false);
  assert.equal(result.status, 'unavailable');
  assert.equal(result.reason, 'ST_EXTENSION_PROMPT_UNAVAILABLE');
  assert.deepEqual(result.dto, []);
  assert.equal(result.prompt, '');
  assert.doesNotThrow(() => coordinator.destroy());
});

test('coordinator converts a throwing extension prompt setter into unavailable', async () => {
  const diagnostics = [];
  const coordinator = createProjectionContextCoordinator({
    getProjectionViews: async () => ({all: []}),
    resolveCurrentFloor: async () => ({version: {chat_id: 'chat-a', floor: 2}}),
    getChatId: () => 'chat-a',
    setExtensionPrompt: () => {
      const error = new Error('prompt unavailable');
      error.code = 'ST_EXTENSION_PROMPT_UNAVAILABLE';
      throw error;
    },
    trace: item => diagnostics.push(item),
  });
  const result = await coordinator.refreshProjectionContext();
  assert.equal(result.ok, false);
  assert.equal(result.status, 'unavailable');
  assert.equal(result.reason, 'ST_EXTENSION_PROMPT_UNAVAILABLE');
  assert.deepEqual(result.dto, []);
  assert.equal(result.prompt, '');
  const failure = diagnostics.find(item => item.stage === 'PROJECTION_CONTEXT_SLOT_WRITE_FAILED');
  assert.equal(failure.reason, 'ST_EXTENSION_PROMPT_UNAVAILABLE');
  assert.equal(failure.error_name, 'Error');
  assert.equal(failure.error_code, 'ST_EXTENSION_PROMPT_UNAVAILABLE');
  assert.equal(failure.error_message, 'prompt unavailable');
  assert.doesNotThrow(() => coordinator.destroy());
});

test('Event Analysis contract treats injected Projection text as non-factual context', () => {
  assert.match(EVENT_ANALYZER_CORE_CONTRACT, /Projection Context/);
  assert.match(EVENT_ANALYZER_CORE_CONTRACT, /只有 narrative discovery window 中明确写出的历史或当前事实/);
});

test('coordinator destroy clears and refuses future writes', async () => {
  const writes = [];
  const coordinator = createProjectionContextCoordinator({
    getProjectionViews: async () => ({all: [view()]}),
    resolveCurrentFloor: async () => ({version: {chat_id: 'chat-a', floor: 2}}),
    getChatId: () => 'chat-a',
    setExtensionPrompt: payload => writes.push(payload),
  });
  coordinator.destroy();
  assert.equal(writes.at(-1).content, '');
  assert.equal((await coordinator.refreshProjectionContext()).status, 'destroyed');
  assert.equal(writes.length, 1);
});

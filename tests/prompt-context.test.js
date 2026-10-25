import test from 'node:test';
import assert from 'node:assert/strict';
import {composePromptMessages, formatPromptContextContent} from '../ai/prompt-context.js';

test('prompt context renders canonical Chinese blocks and filters internal ids', () => {
  const block = formatPromptContextContent({
    kind: 'plugin_world_model',
    variant: 'storyline_design',
    value: {species: [{name: '人类', biological_types: [{name: '女性', subject_id: 'secret'}]}], source_id: 'secret'},
  });
  assert.match(block, /物种:/);
  assert.match(block, /- 名称: 人类/);
  assert.doesNotMatch(block, /source_id|subject_id|secret/);
});

test('content port returns only normalized body without scenario title or purpose', () => {
  const content = formatPromptContextContent({
    kind: 'character_profile',
    variant: 'storyline_design',
    value: {display_name: '柳如烟', species: '人类'},
    empty: '',
  });
  assert.equal(content, '显示名称: 柳如烟\n物种: 人类');
  assert.doesNotMatch(content, /【人物资料】|本段用途/u);
});

test('known characters omit nickname-less entries and keep YAML-like list formatting', () => {
  const block = formatPromptContextContent({kind: 'other_reference_data', value: {known_characters: [
    {display_name: '甲', aliases: []}, {display_name: '乙', aliases: ['小乙']},
  ]}, variant: 'storyline_design'});
  assert.match(block, /已知人物:\n  - 角色名: 乙\n    昵称: 小乙/);
  assert.doesNotMatch(block, /角色名：甲/);

  const objectBlock = formatPromptContextContent({kind: 'other_reference_data', value: {
    known_characters: [{display_name: '乙', aliases: ['小乙']}],
    data: {value: '普通对象属性'},
  }, variant: 'storyline_design'});
  assert.match(objectBlock, /^已知人物:\n\s+- 角色名: 乙/m);
  assert.match(objectBlock, /^data:\n\s+内容: 普通对象属性/m);
  assert.doesNotMatch(objectBlock, /^- 已知人物:/m);
  assert.doesNotMatch(objectBlock, /^- data:/m);
});

test('external memory filters unavailable providers', () => {
  const block = formatPromptContextContent({kind: 'external_memory', value: [
    {enabled: true, available: true, content_available: true, items: [{label: '可用', content: '历史'}]},
    {enabled: true, available: false, content_available: true, items: [{content: '不应发送'}]},
  ]});
  assert.match(block, /可用/);
  assert.doesNotMatch(block, /不应发送/);
});

test('message composer enforces roles, grouping and system boundaries', () => {
  const messages = composePromptMessages({systemTop: 'TOP', groups: [
    {role: 'system', blocks: ['RULE', 'DATA']},
    {role: 'assistant', blocks: ['正文']},
    {role: 'user', blocks: ['任务']},
  ], systemBottom: 'BOTTOM'});
  assert.deepEqual(messages, [
    {role: 'system', content: 'TOP'},
    {role: 'system', content: 'RULE\n\nDATA'},
    {role: 'assistant', content: '正文'},
    {role: 'user', content: '任务'},
    {role: 'system', content: 'BOTTOM'},
  ]);
  assert.throws(() => composePromptMessages({groups: [{role: 'invalid', blocks: ['x']}]}), /PROMPT_CONTEXT_LAYOUT_INVALID/);
  assert.deepEqual(composePromptMessages({groups: [{role: 'system', blocks: ['RULE']}], user: 'TASK'}).at(-1), {role: 'user', content: 'TASK'});
});

test('prompt context keeps source kinds and variants explicit', () => {
  assert.match(formatPromptContextContent({kind: 'worldbooks', value: [{entries: [{label: '规则', content: '医院可检查。'}]}]}), /医院可检查/);
  assert.match(formatPromptContextContent({kind: 'character_profile', variant: 'storyline_design', value: {display_name: '柳如烟', species: '人类'}}), /显示名称: 柳如烟[\s\S]*物种: 人类/);
  assert.match(formatPromptContextContent({kind: 'recent_story', variant: 'storyline_design', value: [{content: '近期剧情。'}]}), /近期剧情/);
  assert.throws(() => formatPromptContextContent({kind: 'worldbooks', variant: 'storyline_design', value: []}), /PROMPT_CONTEXT_VARIANT_UNSUPPORTED/);
});

test('event reference presents a readable semantic projection without Floor or event ids', () => {
  const block = formatPromptContextContent({
    kind: 'event_reference',
    variant: 'event',
    value: {
      event_id: 'event-secret',
      type: 'physical_symptom',
      status: 'confirmed',
      story_time: {display: '第 1 天', normalized: 'day-1', calendar_id: 'calendar-secret', precision: 'day', confidence: 1},
      location: '洗玉水榭',
      participants: [{
        character_id: 'character-secret',
        display_name: '柳如烟',
        biological_context: {species: '人类', biological_type: '女性'},
      }],
      source_evidence: [{kind: 'symptom_evidence', text: '闻到荤腥时恶心。'}],
      state_fact: {
        subject_id: 'character-secret',
        payload: {symptom: {kind: 'nausea', description: '恶心', health_role: 'observation'}},
      },
      source: {floor: 104, swipe_id: 0, content_hash: 'hash-secret'},
    },
  });
  assert.match(block, /事件类型: physical_symptom/);
  assert.match(block, /观察对象: 柳如烟/);
  assert.match(block, /显示名称: 柳如烟/);
  assert.match(block, /观察事实:[\s\S]*描述: 恶心/);
  assert.match(block, /事实证据:[\s\S]*闻到荤腥时恶心/);
  assert.equal((block.match(/闻到荤腥时恶心。/g) ?? []).length, 1);
  assert.doesNotMatch(block, /event-secret|character-secret|calendar-secret|hash-secret|Floor|source|event_id|subject_id/);
});

test('existing Event prompt projection keeps continuation ids but excludes raw Event internals', () => {
  const block = formatPromptContextContent({
    kind: 'event_existing_events',
    variant: 'event',
    value: [{
      event_id: 'event-existing',
      type: 'physical_symptom',
      status: 'confirmed',
      story_time: {display: '第 1 天', normalized: 'day-1', calendar_id: 'calendar-secret', day_index: 1, precision: 'day', confidence: 1},
      location: '医馆',
      participants: [{
        character_id: 'character-secret',
        display_name: '柳如烟',
        biological_context: {species: '人类', biological_type: '女性', evidence: [{kind: 'profile', text: '稳定资料'}]},
      }],
      state_fact: {subject_id: 'character-secret', payload: {symptom: {kind: 'nausea', description: '恶心'}}},
      pregnancy_relevance: {relevant: false, gestational_subject_ids: ['character-secret'], counterpart_ids: ['other-secret'], confidence: 0.8},
      source_evidence: [{kind: 'symptom_evidence', text: '闻到荤腥时恶心。'}, {kind: 'duplicate', text: '闻到荤腥时恶心。'}],
      continuation_of_event_id: 'event-parent',
      continuation_update: true,
      source: {floor: 104, swipe_id: 0, content_hash: 'hash-secret'},
      raw_host_payload: {secret: 'must-not-pass'},
    }],
  });
  assert.match(block, /事件编号: event-existing/);
  assert.match(block, /延续事件编号: event-parent/);
  assert.match(block, /显示名称: 柳如烟/);
  assert.match(block, /观察:|观察事实:/);
  assert.doesNotMatch(block, /calendar-secret|character-secret|other-secret|hash-secret|raw_host_payload|must-not-pass|source：|floor：/);
});

test('storyline Event projection keeps narrative references compact', () => {
  const block = formatPromptContextContent({
    kind: 'event_existing_events',
    variant: 'storyline_design',
    value: [{
      event_id: 'event-storyline-secret',
      type: 'physical_symptom',
      status: 'confirmed',
      story_time: {display: '羲和1年3月4日 巳时中', normalized: 'day-1', day_index: 1, precision: 'hour', confidence: 1},
      location: '医馆',
      participants: [{
        character_id: 'character-secret',
        display_name: '柳如烟',
        biological_context: {
          species: '人类',
          biological_type: '女性',
          reproductive_capabilities_used: {can_carry_pregnancy: true},
          evidence: [{kind: 'profile', text: '内部资料，不应发送'}],
        },
      }],
      state_fact: {subject_id: 'character-secret', payload: {symptom: {kind: 'nausea', description: '恶心', health_role: 'observation'}}},
      physical_effect: {gestational_substance_intake: false},
      pregnancy_relevance: {relevant: false, possible_conception: false, confidence: 0.2, reproductive_mechanism: {kind: 'internal', label: '常规问诊', pathway: '问诊后建议检查'}},
      source_evidence: [{kind: 'symptom_evidence', text: '闻到荤腥时恶心。'}],
      continuation_of_event_id: 'event-parent-secret',
      continuation_update: true,
      source: {content_hash: 'hash-secret'},
    }],
  });
  assert.match(block, /事件类型: physical_symptom/);
  assert.match(block, /状态: confirmed/);
  assert.match(block, /时间: 羲和1年3月4日 巳时中/);
  assert.match(block, /地点: 医馆/);
  assert.match(block, /显示名称: 柳如烟/);
  assert.match(block, /物种: 人类/);
  assert.match(block, /生物类型: 女性/);
  assert.match(block, /观察事实:[\s\S]*恶心/);
  assert.match(block, /事实证据:[\s\S]*闻到荤腥时恶心/);
  assert.equal((block.match(/闻到荤腥时恶心。/g) ?? []).length, 1);
  assert.doesNotMatch(block, /event-storyline-secret|event-parent-secret|character-secret|hash-secret|event_id|subject_id/);
  assert.doesNotMatch(block, /标准化时间|连续日索引|时间精度|置信度|妊娠相关性|可能受孕|生殖机制|常规问诊|问诊后建议检查|延续更新|使用的生殖能力|内部资料|身体影响|妊娠相关物质摄入/);
});

test('storyline Event projection only includes events related to the target subject', () => {
  const block = formatPromptContextContent({
    kind: 'event_existing_events',
    variant: 'storyline_design',
    targetSubjectId: 'subject-a',
    value: [
      {
        type: 'physical_symptom',
        status: 'confirmed',
        participants: [{character_id: 'subject-a', display_name: '甲'}],
        state_fact: {subject_id: 'subject-a', payload: {symptom: {description: '甲的恶心'}}},
        source_evidence: [{text: '甲的证据'}],
      },
      {
        type: 'physical_symptom',
        status: 'confirmed',
        participants: [{character_id: 'subject-b', display_name: '乙'}],
        state_fact: {subject_id: 'subject-b', payload: {symptom: {description: '乙的恶心'}}},
        pregnancy_relevance: {gestational_subject_ids: ['subject-b'], counterpart_ids: []},
        source_evidence: [{text: '乙的证据'}],
      },
    ],
  });
  assert.match(block, /甲的恶心/);
  assert.match(block, /甲的证据/);
  assert.doesNotMatch(block, /乙的恶心|乙的证据|subject-a|subject-b/);
});

test('prompt context omits empty nested values without losing false or zero', () => {
  const block = formatPromptContextContent({kind: 'plugin_world_model', variant: 'storyline_design', value: {
    projection_rules: [],
    health: {status: '', details: {}, active: false, count: 0, note: '仍然保留'},
    empty_list: [],
  }, empty: ''});
  assert.doesNotMatch(block, /推演规则|状态：\s*（无）|empty_list|details/);
  assert.match(block, /健康:[\s\S]*否/);
  assert.match(block, /count: 0/);
  assert.match(block, /note: 仍然保留/);
});

test('empty other reference data produces no block', () => {
  assert.equal(formatPromptContextContent({kind: 'other_reference_data', variant: 'storyline_design', value: {}, empty: ''}), '');
  assert.equal(formatPromptContextContent({kind: 'other_reference_data', variant: 'storyline_design', value: [], empty: ''}), '');
});

test('supplement and projection input ports return readable body-only content', () => {
  const supplement = formatPromptContextContent({
    kind: 'world_model_supplement',
    variant: 'comparison',
    value: {
      request: {mode: 'INITIAL'},
      existing_reference: {schema_version: 1, source_id: 'hidden', species: [{name: '人类'}]},
      coverage_targets: [{target_id: 'coverage-1', scope: 'world', field: 'Unknown', cardinality: 'collection'}],
      existing_unknowns: [{unknown_id: 'unknown-1', value: '孕期长度未知'}],
    },
  });
  assert.match(supplement, /模式: INITIAL/);
  assert.match(supplement, /目标编号: coverage-1/);
  assert.match(supplement, /未知事项编号: unknown-1/);
  assert.match(supplement, /名称: 人类/);
  assert.doesNotMatch(supplement, /[{}]|"(?:request|existing_reference|coverage_targets|unknown_id)"/);
  assert.doesNotMatch(supplement, /hidden/);

  const projection = formatPromptContextContent({
    kind: 'projection_generation_input',
    variant: 'generation',
    value: {eligible_decision: {development_kind: 'possible_detection'}, rule: {mechanism_key: 'medical'}, story_context: [{content: '近期正文'}]},
  });
  assert.match(projection, /发展类型: possible_detection/);
  assert.match(projection, /机制键: medical/);
  assert.match(projection, /近期正文/);
  assert.doesNotMatch(projection, /[{}]|"eligible_decision"/);
});

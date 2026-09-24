import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAnalysisInput,
  buildEventAnalysisInput,
  collectAnalysisContext,
  collectRecentStory,
  estimateAnalysisTokens,
  processNarrativeFloor,
} from '../ai/input-builder.js';
import {buildEventAnalysisMessages, buildWorldModelMessages} from '../ai/prompts.js';
import {renderAnalysisDebugPopupContent} from '../ui/settings.js';

function decodeHtml(value) {
  return String(value ?? '')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

function extractRawMessages(html) {
  const match = String(html).match(/<pre[^>]*class="[^"]*bioweave-analysis-message-raw[^\"]*"[^>]*>([\s\S]*?)<\/pre>/);
  assert.ok(match, 'Event Preview should render the raw messages used by the request');
  return JSON.parse(decodeHtml(match[1]));
}

function analysisSources() {
  return [
    {
      source_id: 'character_card_fixture',
      source_type: 'character_card',
      fields: [
        {field_key: 'description', label: '角色描述', content: 'CHARACTER_SELECTED'},
        {field_key: 'opening:main', label: '主开场白', content: 'CHARACTER_OPENING_SELECTED'},
        {field_key: 'opening:alternate:0', label: '备用开场白', content: 'CHARACTER_NOT_SELECTED'},
      ],
    },
    {
      source_id: 'worldbook_fixture',
      source_type: 'worldbook',
      label: '内部来源标签',
      entries: [
        {entry_id: 'entry_alpha', label: '条目 Alpha', content: 'WORLDBOOK_SELECTED', metadata: {comment: '普通规则', keys: ['alpha']}},
        {entry_id: 'entry_beta', label: '条目 Beta', content: 'WORLDBOOK_NOT_SELECTED'},
      ],
    },
  ];
}

function selectedSourceItems() {
  return [
    {source_id: 'character_card_fixture', field_key: 'description', enabled: true},
    {source_id: 'character_card_fixture', field_key: 'opening:main', enabled: true},
    {source_id: 'worldbook_fixture', entry_id: 'entry_alpha', enabled: true},
  ];
}

function fixtureContext() {
  return {
    chatId: 'chat_fixture',
    name1: 'persona_display',
    name2: 'character_display',
    powerUserSettings: {
      persona_name: 'persona_display',
      persona_description: 'PERSONA_SELECTED',
    },
    chat: [
      {floor: 1, message_id: 'message_old', role: 'assistant', content: 'OLD_STORY'},
      {floor: 2, message_id: 'message_recent', role: 'assistant', content: 'RECENT_STORY'},
    ],
  };
}

function eventInput(input) {
  return buildEventAnalysisInput({
    ...input,
    chatId: 'chat_fixture',
    floorVersion: {
      chat_id: 'chat_fixture',
      message_id: 'message_target',
      floor: 3,
      swipe_id: 1,
      content_hash: 'hash_fixture',
      message_version: 'v1:hash_fixture',
    },
    currentFloor: {
      floor: 3,
      message_id: 'message_target',
      swipe_id: 1,
      narrative: 'TARGET_FLOOR_EVENT',
    },
    storyTime: {
      display: 'story day fixture',
      normalized: null,
      calendar_id: null,
      day_index: null,
      precision: 'day',
      confidence: null,
    },
    worldModel: {baseline_marker: 'WORLD_MODEL_SELECTED'},
    existingBioWeave: {fact_marker: 'EXISTING_BIOWEAVE_SELECTED'},
  });
}

const promptSettings = {
  system_top: 'COMMON_TOP_MARKER',
  task: 'COMMON_TASK_MARKER',
  input_prefix: 'COMMON_PREFIX_MARKER',
  input_suffix: 'COMMON_SUFFIX_MARKER',
  system_bottom: 'COMMON_BOTTOM_MARKER',
};

test('shared context collection applies configured floor count and global/chat regex rules', async () => {
  const items = [
    {floor: 1, message_id: 'message_old', role: 'assistant', content: '<global>OLD_GLOBAL</global><chat>OLD_CHAT</chat>'},
    {floor: 2, message_id: 'message_user', role: 'user', content: '<global>USER_GLOBAL</global><chat>USER_CHAT</chat>'},
    {floor: 3, message_id: 'message_recent', role: 'assistant', content: '<global>RECENT_GLOBAL</global><chat>RECENT_CHAT</chat>'},
  ];
  const settings = {
    recent_story: {
      enabled: true,
      floor_count: 2,
      regex_user_enabled: false,
      regex_rules: [{pattern: '/<chat>(.*?)<\\/chat>/', type: 'extract', enabled: true}],
    },
  };
  const globalRecentStory = {
    regex_rules: [{pattern: '/<global>(.*?)<\\/global>/', type: 'extract', enabled: true}],
  };

  const userRegexDisabled = await collectAnalysisContext({
    context: {...fixtureContext(), chat: items},
    chatId: 'chat_fixture',
    chatSettings: settings,
    globalRecentStory,
    recentStoryItems: items,
  });
  assert.equal(userRegexDisabled.recent_story.floor_count, 2);
  assert.deepEqual(userRegexDisabled.recent_story.items.map(item => item.floor), [2, 3]);
  assert.equal(userRegexDisabled.recent_story.items[0].content, '<global>USER_GLOBAL</global><chat>USER_CHAT</chat>');
  assert.equal(userRegexDisabled.recent_story.items[1].content, 'RECENT_GLOBAL\nRECENT_CHAT');
  assert.equal(userRegexDisabled.recent_story.items.some(item => item.floor === 1), false);

  const userRegexEnabled = await collectAnalysisContext({
    context: {...fixtureContext(), chat: items},
    chatId: 'chat_fixture',
    chatSettings: {...settings, recent_story: {...settings.recent_story, regex_user_enabled: true}},
    globalRecentStory,
    recentStoryItems: items,
  });
  assert.equal(userRegexEnabled.recent_story.items[0].content, 'USER_GLOBAL\nUSER_CHAT');
});

test('shared collector loads only selected source IDs and keeps the bounded target in Recent Story', async () => {
  const requestedSourceIds = [];
  const sources = analysisSources();
  const targetItems = [
    {floor: 1, message_id: 'message_old', swipe_id: 0, role: 'assistant', content: 'OLD_STORY'},
    {floor: 3, message_id: 'message_target', swipe_id: 1, role: 'assistant', content: 'TARGET_FLOOR_EVENT'},
  ];
  const input = await collectAnalysisContext({
    context: fixtureContext(),
    chatId: 'chat_fixture',
    selected: selectedSourceItems(),
    chatSettings: {
      worldbooks: {selected: selectedSourceItems()},
      recent_story: {enabled: true, floor_count: 2},
    },
    sourceLoader: async options => {
      requestedSourceIds.push(options.loadContentForSourceIds);
      return sources;
    },
    recentStoryItems: targetItems,
  });

  assert.deepEqual(requestedSourceIds, [['character_card_fixture', 'worldbook_fixture']]);
  assert.equal(input.character.description, 'CHARACTER_SELECTED');
  assert.deepEqual(input.character.greetings.map(item => item.content), ['CHARACTER_OPENING_SELECTED']);
  assert.deepEqual(input.worldbooks[0].entries.map(item => item.entry_id), ['entry_alpha']);
  assert.deepEqual(input.recent_story.items.map(item => item.content), ['OLD_STORY', 'TARGET_FLOOR_EVENT']);
  assert.equal(JSON.stringify(input).includes('CHARACTER_NOT_SELECTED'), false);
  assert.equal(JSON.stringify(input).includes('WORLDBOOK_NOT_SELECTED'), false);
  assert.equal(JSON.stringify(input).includes('TARGET_FLOOR_EVENT'), true);
});

test('selected-only prompt input excludes default-filtered entries until the user re-enables them', async () => {
  const sources = analysisSources().map(source => source.source_type === 'worldbook'
    ? {...source, entries: [
      {...source.entries[0], metadata: {comment: '状态规则'}},
      {...source.entries[1], metadata: {comment: '普通规则'}},
    ]}
    : source);
  const excludedByDefault = await collectAnalysisContext({
    sources,
    context: fixtureContext(),
    chatId: 'chat_fixture',
    selected: [{source_id: 'worldbook_fixture', entry_id: 'entry_beta', enabled: true}],
    chatSettings: {worldbooks: {mode: 'selected_only', selected: [{source_id: 'worldbook_fixture', entry_id: 'entry_beta', enabled: true}]}},
  });
  assert.deepEqual(excludedByDefault.worldbooks[0].entries.map(item => item.entry_id), ['entry_beta']);
  assert.doesNotMatch(JSON.stringify(excludedByDefault), /comment|metadata|状态规则/u);
  const manuallyReenabled = await collectAnalysisContext({
    sources,
    context: fixtureContext(),
    chatId: 'chat_fixture',
    selected: [{source_id: 'worldbook_fixture', entry_id: 'entry_alpha', enabled: true}],
    chatSettings: {worldbooks: {mode: 'selected_only', selected: [{source_id: 'worldbook_fixture', entry_id: 'entry_alpha', enabled: true}]}},
  });
  assert.deepEqual(manuallyReenabled.worldbooks[0].entries.map(item => item.entry_id), ['entry_alpha']);
  assert.equal(manuallyReenabled.worldbooks[0].entries[0].content, 'WORLDBOOK_SELECTED');
  assert.doesNotMatch(JSON.stringify(manuallyReenabled), /"metadata"|"comment"/u);
});

test('eagerly loaded character_card entries stay out of selected-only input until selected', async () => {
  const primarySource = {
    source_id: 'st-worldbook:primary-book',
    source_type: 'worldbook',
    worldbook_group: 'character_card',
    content_loaded: true,
    entries: [{entry_id: 'primary-entry', label: '主书条目', content: 'PRIMARY_CONTENT'}],
  };
  const unselected = await collectAnalysisContext({
    sources: [primarySource],
    context: fixtureContext(),
    chatId: 'chat_fixture',
    selected: [],
    chatSettings: {worldbooks: {mode: 'selected_only', selected: []}},
  });
  assert.deepEqual(unselected.worldbooks, []);

  const selected = await collectAnalysisContext({
    sources: [primarySource],
    context: fixtureContext(),
    chatId: 'chat_fixture',
    selected: [{source_id: 'st-worldbook:primary-book', entry_id: 'primary-entry', enabled: true}],
    chatSettings: {worldbooks: {mode: 'selected_only', selected: [{source_id: 'st-worldbook:primary-book', entry_id: 'primary-entry', enabled: true}]}},
  });
  assert.deepEqual(selected.worldbooks[0].entries.map(entry => entry.entry_id), ['primary-entry']);
  assert.equal(selected.worldbooks[0].entries[0].content, 'PRIMARY_CONTENT');
});

test('Recent Story upper bound stops at the current Character Floor', async () => {
  const input = await collectAnalysisContext({
    context: {
      chat: [
        {floor: 4, role: 'user', content: '历史用户叙事'},
        {floor: 5, role: 'assistant', content: '当前角色正文'},
        {floor: 6, role: 'user', content: '尾部用户消息'},
      ],
    },
    chatId: 'chat-upper-bound',
    chatSettings: {recent_story: {enabled: true, floor_count: 5}},
    upperBoundIndex: 1,
  });
  assert.deepEqual(input.recent_story.items.map(item => item.floor), [4, 5]);
  assert.equal(input.recent_story.items.some(item => item.floor === 6), false);
});

test('Recent Story takes the configured number of raw messages through the Character upper bound', () => {
  const message = (floor, role) => ({
    floor,
    role,
    content: `${role}-${floor}`,
  });
  const collect = (messages, floorCount, upperBoundIndex) =>
    collectRecentStory({
      context: {chat: messages},
      settings: {enabled: true, floor_count: floorCount},
      upperBoundIndex,
    }).items.map(item => item.floor);

  const caseA = [
    message(4, 'user'),
    message(5, 'assistant'),
    message(6, 'user'),
    message(7, 'assistant'),
    message(8, 'user'),
  ];
  assert.deepEqual(collect(caseA, 4, 3), [4, 5, 6, 7]);
  assert.deepEqual(collect(caseA, 2, 3), [6, 7]);
  assert.deepEqual(collect(caseA, 10, 3), [4, 5, 6, 7]);

  const caseB = [
    message(4, 'user'),
    message(5, 'assistant'),
    message(6, 'user'),
    message(7, 'assistant'),
  ];
  assert.deepEqual(collect(caseB, 4, 3), [4, 5, 6, 7]);

  const caseD = [
    message(1, 'user'),
    message(2, 'assistant'),
    message(3, 'user'),
    message(4, 'assistant'),
    message(5, 'user'),
  ];
  assert.deepEqual(collect(caseD, 3, 3), [2, 3, 4]);
});

test('shared collector enforces Worldbook mode before Prompt formatting', async () => {
  let loaderOptions = null;
  const all = await collectAnalysisContext({
    context: fixtureContext(),
    chatId: 'chat_fixture',
    selected: [],
    chatSettings: {worldbooks: {mode: 'all', selected: []}},
    sourceLoader: async options => {
      loaderOptions = options;
      return analysisSources();
    },
  });
  assert.equal(loaderOptions.deferWorldbookContent, false);
  assert.deepEqual(all.worldbooks[0].entries.map(item => item.entry_id), ['entry_alpha', 'entry_beta']);

  const none = await collectAnalysisContext({
    context: fixtureContext(),
    chatId: 'chat_fixture',
    selected: selectedSourceItems(),
    chatSettings: {worldbooks: {mode: 'none', selected: selectedSourceItems()}},
    sources: analysisSources(),
  });
  assert.deepEqual(none.worldbooks, []);
});

test('shared Recent Story keeps supplied causal-prefix indexes instead of Chat-length offsets', () => {
  const context = {
    chat: [
      {message_id: 'message_0', role: 'assistant', content: 'STORY_0'},
      {message_id: 'message_1', role: 'assistant', content: 'STORY_1'},
      {message_id: 'message_2', role: 'assistant', content: 'STORY_2'},
      {message_id: 'message_3', role: 'assistant', content: 'STORY_3'},
      {message_id: 'message_4', role: 'assistant', content: 'STORY_4'},
    ],
  };
  const prefix = context.chat.slice(0, 3).map(message => ({...message}));
  const recent = collectRecentStory({
    context,
    settings: {enabled: true, floor_count: 4},
    items: prefix,
  });
  assert.deepEqual(recent.items.map(item => item.floor), [0, 1, 2]);
});

test('Recent Story applies regex independently per floor and keeps user floors when disabled', () => {
  const crossFloor = {
    pattern: '/\\[start\\]([\\s\\S]*?)\\[end\\]/',
    type: 'extract',
    enabled: true,
  };
  const result = collectRecentStory({
    settings: {enabled: true, floor_count: 3, regex_rules: [crossFloor], regex_user_enabled: false},
    items: [
      {floor: 1, role: 'assistant', content: '[start]part-a'},
      {floor: 2, role: 'user', content: 'user-raw'},
      {floor: 3, role: 'assistant', content: 'part-b[end]'},
    ],
  });

  assert.deepEqual(result.items.map(item => item.floor), [2]);
  assert.equal(result.items[0].content, 'user-raw');
  assert.equal(result.items.some(item => item.content === 'part-a\npart-b'), false);
});

test('shared floor processing resolves the active swipe before regex and applies user-floor policy', () => {
  const settings = {
    floor_count: 4,
    regex_rules: [{pattern: '/<value>(.*?)<\\/value>/', type: 'extract', enabled: true}],
    regex_user_enabled: false,
  };
  const activeSwipe = processNarrativeFloor({
    message: {
      floor: 3,
      message_id: 'message-swipe',
      role: 'assistant',
      swipes: ['<value>INACTIVE</value>', '<value>ACTIVE</value>'],
    },
    swipeId: 1,
    settings,
  });
  assert.equal(activeSwipe.content, 'ACTIVE');

  const activeObjectSwipe = processNarrativeFloor({
    message: {
      floor: 3,
      message_id: 'message-object-swipe',
      role: 'assistant',
      swipes: {0: '<value>INACTIVE_OBJECT</value>', 1: '<value>ACTIVE_OBJECT</value>'},
    },
    swipeId: 1,
    settings,
  });
  assert.equal(activeObjectSwipe.content, 'ACTIVE_OBJECT');

  const userRaw = processNarrativeFloor({
    message: {floor: 4, role: 'user', content: '<value>USER_RAW</value>'},
    settings,
  });
  assert.equal(userRaw.content, '<value>USER_RAW</value>');
  assert.equal(processNarrativeFloor({
    message: {floor: 4, role: 'user', content: '<value>USER_PROCESSED</value>'},
    settings: {...settings, regex_user_enabled: true},
  }).content, 'USER_PROCESSED');
});

test('Event narrative formatter removes a target floor even when only one side has a message id', () => {
  const input = buildEventAnalysisInput({
    chatId: 'chat_fixture',
    floorVersion: {
      chat_id: 'chat_fixture',
      message_id: null,
      floor: 3,
      swipe_id: 1,
      content_hash: 'hash_fixture',
      message_version: 'v1:hash_fixture',
    },
    recent_story: {
      items: [{floor: 3, message_id: 'message_target', swipe_id: 1, role: 'assistant', content: 'TARGET_DUPLICATE'}],
    },
    current_floor: {floor: 3, message_id: null, swipe_id: 1, narrative: 'TARGET_CANONICAL', role: 'assistant'},
  });
  const messages = buildEventAnalysisMessages(input);
  const narrative = messages.find(message => message.role === 'assistant')?.content ?? '';
  assert.equal(narrative.match(/TARGET_DUPLICATE/g)?.length ?? 0, 0);
  assert.equal(narrative.match(/TARGET_CANONICAL/g)?.length ?? 0, 1);
});

test('Event narrative presents processed floors as one clean assistant message', () => {
  const input = buildEventAnalysisInput({
    chatId: 'chat_fixture',
    floorVersion: {
      chat_id: 'chat_fixture',
      message_id: 'message_target',
      floor: 3,
      swipe_id: 1,
      content_hash: 'hash_fixture',
      message_version: 'v1:hash_fixture',
    },
    recent_story: {
      items: [
        {floor: 1, message_id: 'message_history_a', swipe_id: 0, role: 'assistant', content: 'HISTORY_A'},
        {floor: 2, message_id: 'message_history_b', swipe_id: 0, role: 'user', content: 'HISTORY_B'},
      ],
    },
    current_floor: {
      floor: 3,
      message_id: 'message_target',
      swipe_id: 1,
      role: 'assistant',
      narrative: 'TARGET_FLOOR',
    },
  });
  const narrative = buildEventAnalysisMessages(input)
    .find(message => message.role === 'assistant')?.content ?? '';

  assert.equal(narrative, [
    '【剧情上下文】',
    '',
    'HISTORY_A',
    '',
    'HISTORY_B',
    '',
    '【本次分析内容】',
    '',
    'TARGET_FLOOR',
  ].join('\n'));
  assert.doesNotMatch(narrative, /【楼层|正文：|role=|message_id|swipe_id|content_hash|message_version/u);
  assert.equal(narrative.match(/TARGET_FLOOR/g)?.length ?? 0, 1);
});

test('Event narrative omits empty history and does not create an empty target section', () => {
  const input = buildEventAnalysisInput({
    chatId: 'chat_fixture',
    floorVersion: {
      chat_id: 'chat_fixture',
      message_id: 'message_target',
      floor: 3,
      swipe_id: 1,
      content_hash: 'hash_fixture',
      message_version: 'v1:hash_fixture',
    },
    recent_story: {
      items: [
        {floor: 1, role: 'assistant', content: ''},
        {floor: 2, role: 'assistant', content: 'HISTORY_ONLY'},
      ],
    },
    current_floor: {
      floor: 3,
      message_id: 'message_target',
      swipe_id: 1,
      role: 'assistant',
      narrative: '',
    },
  });
  const narrative = buildEventAnalysisMessages(input)
    .find(message => message.role === 'assistant')?.content ?? '';

  assert.equal(narrative, '【剧情上下文】\n\nHISTORY_ONLY');
  assert.doesNotMatch(narrative, /【本次分析内容】|无|【楼层|正文：/u);
});

test('Event narrative with only a target omits the empty history section', () => {
  const input = buildEventAnalysisInput({
    chatId: 'chat_fixture',
    floorVersion: {
      chat_id: 'chat_fixture',
      message_id: 'message_target',
      floor: 3,
      swipe_id: 1,
      content_hash: 'hash_fixture',
      message_version: 'v1:hash_fixture',
    },
    recent_story: {items: []},
    current_floor: {
      floor: 3,
      message_id: 'message_target',
      swipe_id: 1,
      role: 'assistant',
      narrative: 'TARGET_ONLY',
    },
  });
  const narrative = buildEventAnalysisMessages(input)
    .find(message => message.role === 'assistant')?.content ?? '';

  assert.equal(narrative, '【本次分析内容】\n\nTARGET_ONLY');
  assert.doesNotMatch(narrative, /【剧情上下文】|【前文】|无/u);
});

test('World Model presents Recent Story as one clean assistant message', () => {
  const messages = buildWorldModelMessages({
    recent_story: {
      items: [
        {floor: 1, role: 'assistant', content: 'WORLD_HISTORY_A'},
        {floor: 2, role: 'user', content: 'WORLD_HISTORY_B'},
      ],
    },
  });
  const narrativeMessages = messages.filter(message => message.role === 'assistant');

  assert.equal(narrativeMessages.length, 1);
  assert.equal(narrativeMessages[0].content, '【近期剧情参考】\n\nWORLD_HISTORY_A\n\nWORLD_HISTORY_B');
  assert.doesNotMatch(narrativeMessages[0].content, /【楼层|正文：|role=|message_id|swipe_id/u);
});

test('selected context, readable external memory, and token estimate are shared by World/Event', async () => {
  const selected = selectedSourceItems();
  const input = await collectAnalysisContext({
    sources: analysisSources(),
    selected,
    context: fixtureContext(),
    chatId: 'chat_fixture',
    chatSettings: {
      worldbooks: {selected},
      recent_story: {enabled: true, floor_count: 1},
      external_memory: {anima: true, baobaoshu: false, database_memory: true},
    },
    externalMemoryProviderLoader: async () => [
      {
        key: 'anima',
        available: true,
        content_available: true,
        items: [{label: '外部来源一', content: 'EXTERNAL_ENABLED'}],
      },
      {
        key: 'baobaoshu',
        available: true,
        content_available: true,
        items: [{label: '外部来源二', content: 'EXTERNAL_DISABLED'}],
      },
      {
        key: 'database_memory',
        available: true,
        content_available: true,
        status: '读取失败',
        items: [{label: '错误响应', content: 'EXTERNAL_ERROR_RESPONSE'}],
      },
    ],
    includePersonaInTokenEstimate: true,
  });

  assert.equal(input.token_estimate, estimateAnalysisTokens(input, {includePersona: true}));
  assert.match(JSON.stringify(input), /EXTERNAL_ENABLED/);
  assert.doesNotMatch(JSON.stringify(input), /EXTERNAL_DISABLED|EXTERNAL_ERROR_RESPONSE/);

  const event = eventInput(input);
  const eventMessages = buildEventAnalysisMessages(event, promptSettings);
  const worldMessages = buildWorldModelMessages(input, promptSettings);
  const eventPrompt = eventMessages.map(message => message.content).join('\n');
  const worldPrompt = worldMessages.map(message => message.content).join('\n');

  assert.doesNotMatch(eventPrompt, /【角色卡：|【persona_display 的人物设定】|【世界书参考资料】|【外部历史参考信息】/);
  assert.match(eventPrompt, /【当前 World Model 参考】/);
  assert.doesNotMatch(eventPrompt, /【现有 BioWeave 事实参考】/);
  assert.match(eventPrompt, /【剧情上下文】/);
  assert.match(eventPrompt, /【本次分析内容】/);
  assert.doesNotMatch(eventPrompt, /CHARACTER_SELECTED|WORLDBOOK_SELECTED|EXTERNAL_ENABLED|CHARACTER_NOT_SELECTED|WORLDBOOK_NOT_SELECTED|EXTERNAL_DISABLED|EXTERNAL_ERROR_RESPONSE/);
  assert.doesNotMatch(eventPrompt, /CHARACTER_OPENING_SELECTED|【开场白】/);
  assert.doesNotMatch(eventPrompt, /(?:^|\n)(?:persona|description|persona_description|user_persona)\s*:/iu);
  assert.doesNotMatch(eventPrompt, /"(?:character|persona|worldbooks|external_memory)"\s*:/u);

  assert.match(worldPrompt, /CHARACTER_SELECTED|WORLDBOOK_SELECTED|EXTERNAL_ENABLED/);
  assert.match(worldPrompt, /【开场白】\nCHARACTER_OPENING_SELECTED/);
  assert.doesNotMatch(worldPrompt, /CHARACTER_NOT_SELECTED/);
  const worldReferenceMessage = worldMessages.find(
    message => message.role === 'system' && message.content.includes('CHARACTER_OPENING_SELECTED'),
  );
  assert.ok(worldReferenceMessage);
  assert.equal(worldReferenceMessage.role, 'system');
  assert.match(worldReferenceMessage.content, /【开场白】\nCHARACTER_OPENING_SELECTED/);
  assert.equal(worldReferenceMessage.content.trimEnd().endsWith('CHARACTER_OPENING_SELECTED'), true);
  assert.doesNotMatch(worldPrompt, /PERSONA_SELECTED|【persona_display 的人物设定】/);
});

test('Event prompt removes raw world sources while World prompt retains them', () => {
  const rawInput = {
    chatId: 'chat_fixture',
    floorVersion: {
      chat_id: 'chat_fixture',
      message_id: 'message_target',
      floor: 3,
      swipe_id: 1,
      content_hash: 'hash_fixture',
      message_version: 'v1:hash_fixture',
    },
    currentFloor: {floor: 3, message_id: 'message_target', narrative: 'TARGET_FLOOR_SENTINEL'},
    recentContext: [{floor: 2, role: 'assistant', content: 'RECENT_STORY_SENTINEL'}],
    storyTime: {display: 'Story Time Sentinel'},
    worldModel: {species: [{name: 'WORLD_MODEL_SENTINEL'}]},
    character: {description: 'CHARACTER_RAW_SENTINEL'},
    persona: {description: 'PERSONA_RAW_SENTINEL'},
    worldbooks: [{entries: [{label: 'raw', content: 'WORLDBOOK_RAW_SENTINEL'}]}],
    external_memory: [{
      enabled: true,
      available: true,
      content_available: true,
      read_status: 'ok',
      items: [{label: 'memory', content: 'EXTERNAL_MEMORY_RAW_SENTINEL'}],
    }],
  };
  const eventPrompt = buildEventAnalysisMessages(buildEventAnalysisInput(rawInput))
    .map(message => message.content)
    .join('\n');
  for (const marker of [
    'CHARACTER_RAW_SENTINEL',
    'PERSONA_RAW_SENTINEL',
    'WORLDBOOK_RAW_SENTINEL',
    'EXTERNAL_MEMORY_RAW_SENTINEL',
  ]) {
    assert.doesNotMatch(eventPrompt, new RegExp(marker));
  }
  assert.match(eventPrompt, /WORLD_MODEL_SENTINEL|TARGET_FLOOR_SENTINEL|RECENT_STORY_SENTINEL/u);

  const worldInput = buildAnalysisInput({
    context: {...fixtureContext(), powerUserSettings: {
      ...fixtureContext().powerUserSettings,
      persona_description: 'PERSONA_RAW_SENTINEL',
    }},
    chatId: 'chat_fixture',
    selected: [
      {source_id: 'character_card', field_key: 'description', enabled: true},
      {source_id: 'worldbook', entry_id: 'entry', enabled: true},
    ],
    sources: [
      {source_id: 'character_card', source_type: 'character_card', fields: [
        {field_key: 'description', label: 'description', content: 'CHARACTER_RAW_SENTINEL'},
      ]},
      {source_id: 'worldbook', source_type: 'worldbook', entries: [
        {entry_id: 'entry', label: 'entry', content: 'WORLDBOOK_RAW_SENTINEL'},
      ]},
    ],
    externalMemory: {anima: true},
    externalMemoryProviders: [{
      key: 'anima',
      available: true,
      content_available: true,
      status: 'ok',
      items: [{label: 'memory', content: 'EXTERNAL_MEMORY_RAW_SENTINEL'}],
    }],
  });
  const worldPrompt = buildWorldModelMessages(worldInput)
    .map(message => message.content)
    .join('\n');
  assert.match(worldPrompt, /CHARACTER_RAW_SENTINEL/u);
  assert.match(worldPrompt, /WORLDBOOK_RAW_SENTINEL/u);
  assert.match(worldPrompt, /EXTERNAL_MEMORY_RAW_SENTINEL/u);
  assert.equal(worldInput.persona.description, 'PERSONA_RAW_SENTINEL');
});

test('empty character greetings do not create a greeting section or message', () => {
  const messages = buildWorldModelMessages({
    character: {description: 'CHARACTER_BACKGROUND', greetings: []},
    worldbooks: [],
    external_memory: [],
  });
  const prompt = messages.map(message => message.content).join('\n');
  assert.doesNotMatch(prompt, /【开场白】/);
  assert.equal(messages.some(message => message.content === ''), false);
  assert.deepEqual(messages.map(message => message.role), ['system', 'system', 'user']);
});

test('Event formats normalized character profiles as a bounded reference block', () => {
  const input = eventInput({
    characterContext: {
      current_character: 'character_subject',
      profiles: {
        character_subject: {
          character_id: 'character_subject',
          display_name: 'subject_display',
          species: 'species_fixture',
          biological_type: 'type_fixture',
          reproductive_capabilities: {
            can_produce_sperm: false,
            can_produce_ova: true,
            can_be_fertilized: true,
            can_fertilize: false,
            can_carry_pregnancy: true,
          },
          evidence: [{kind: 'profile', text: 'PROFILE_CAPABILITY_EVIDENCE'}],
        },
      },
    },
  });
  const messages = buildEventAnalysisMessages(input);
  const prompt = messages.map(message => message.content).join('\n');
  const characterContextMessage = messages.find(message => message.content.includes('【事件相关角色参考】'));
  assert.equal(characterContextMessage?.role, 'system');
  assert.match(prompt, /角色标识：character_subject/);
  assert.match(prompt, /显示名称：subject_display/);
  assert.match(prompt, /物种：species_fixture/);
  assert.match(prompt, /可承载妊娠：是/);
  assert.match(prompt, /PROFILE_CAPABILITY_EVIDENCE/);
  assert.doesNotMatch(prompt, /(?:^|\n)character_context\s*:/u);
  assert.doesNotMatch(prompt, /character_card|CHARACTER_RAW|PERSONA_RAW|WORLDBOOK_RAW|EXTERNAL_MEMORY_RAW/u);
});

test('A: Initial Registry Bootstrap keeps Character Card biological evidence without a canonical ID', () => {
  const input = eventInput({
    meta: {character_name: 'bootstrap_character'},
    character: {description: '当前角色具有明确的女性生理性别。'},
    characterRegistry: {schema_version: 1, entities: {}},
    worldModel: {
      species: [{
        name: 'Human',
        biological_types: [{
          name: '女性',
          capabilities: {can_carry_pregnancy: true},
        }],
      }],
    },
  });
  const messages = buildEventAnalysisMessages(input);
  const prompt = messages.map(message => message.content).join('\n');
  assert.equal(input.individual_evidence.length, 1);
  assert.equal(input.individual_evidence[0].character_id, null);
  assert.equal(input.individual_evidence[0].subject_kind, 'current_character');
  assert.equal(input.individual_evidence[0].stable_biological_evidence[0].kind, 'biological_sex');
  assert.match(prompt, /稳定人物生理证据（不是当前 Floor Event）/u);
  assert.match(prompt, /biological_sex：当前角色具有明确的女性生理性别/u);
  assert.match(prompt, /未分配 canonical character_id/u);
  assert.doesNotMatch(prompt, /character_id：bootstrap_character/u);
});

test('B: Persona evidence is projected to the Persona subject and old experiences remain non-Event context', () => {
  const input = eventInput({
    meta: {user_name: 'persona_subject'},
    persona: {
      name: 'persona_subject',
      description: 'Persona 对应人物具有男性生理性别，曾经经历过旧事件。',
    },
    currentFloor: {
      floor: 3,
      message_id: 'message_target',
      swipe_id: 1,
      narrative: 'CURRENT_FLOOR_ONLY',
    },
  });
  const messages = buildEventAnalysisMessages(input);
  const prompt = messages.map(message => message.content).join('\n');
  const narrative = messages.find(message => message.role === 'assistant')?.content ?? '';
  assert.equal(input.individual_evidence[0].subject_kind, 'persona');
  assert.equal(input.individual_evidence[0].provenance.source_kind, 'persona');
  assert.match(prompt, /证据对象：persona/u);
  assert.match(prompt, /biological_sex：Persona 对应人物具有男性生理性别/u);
  assert.doesNotMatch(prompt, /曾经经历过旧事件/u);
  assert.match(narrative, /TARGET_FLOOR_EVENT/u);
  assert.doesNotMatch(narrative, /曾经经历过旧事件/u);
});

test('C: Existing canonical profile remains individual evidence with capabilities and evidence', () => {
  const input = eventInput({
    characterContext: {
      profiles: {
        canonical_subject: {
          character_id: 'canonical_subject',
          display_name: 'canonical_display',
          species: 'Human',
          biological_type: '女性',
          reproductive_capabilities: {can_carry_pregnancy: true},
          evidence: [{kind: 'profile', text: 'CANONICAL_PROFILE_EVIDENCE'}],
        },
      },
    },
  });
  const prompt = buildEventAnalysisMessages(input)
    .map(message => message.content)
    .join('\n');
  assert.match(prompt, /角色标识：canonical_subject/u);
  assert.match(prompt, /可承载妊娠：是/u);
  assert.match(prompt, /CANONICAL_PROFILE_EVIDENCE/u);
  assert.equal(input.individual_evidence[0].provenance.source_kind, 'existing_profile');
});

test('D: Nonhuman Character Evidence does not create or borrow a Human capability baseline', () => {
  const input = eventInput({
    character: {description: '该非人类角色具有女性生理性别。'},
    worldModel: {
      species: [{
        name: 'Nonhuman',
        biological_types: [{
          name: '女性',
          capabilities: {can_carry_pregnancy: null},
        }],
      }],
    },
  });
  const prompt = buildEventAnalysisMessages(input)
    .map(message => message.content)
    .join('\n');
  assert.match(prompt, /biological_sex：该非人类角色具有女性生理性别/u);
  assert.doesNotMatch(prompt, /已知生殖能力：[\s\S]*可承载妊娠：是/u);
  assert.equal(input.individual_evidence[0].capabilities.can_carry_pregnancy, undefined);
});

test('E: Unknown Character data does not create a guessed Character Evidence record', () => {
  const input = eventInput({
    character: {description: '该角色喜欢蓝色，今天阅读了一本书。'},
  });
  const messages = buildEventAnalysisMessages(input);
  const prompt = messages.map(message => message.content).join('\n');
  assert.deepEqual(input.individual_evidence, []);
  assert.doesNotMatch(prompt, /【事件相关角色参考】/u);
  assert.doesNotMatch(prompt, /可承载妊娠：是|生物类型：/u);
});

test('F: Unbound Worldbook and External Memory facts are not borrowed across characters', () => {
  const input = eventInput({
    character: {description: '当前人物没有稳定生理资料。'},
    worldbooks: [{
      source_id: 'worldbook_unbound',
      entries: [{entry_id: 'other-person', content: '其他人物具有明确女性生理性别。'}],
    }],
    external_memory: [{
      key: 'anima',
      items: [{label: 'other-person-memory', content: '其他人物可承载妊娠。'}],
    }],
  });
  const prompt = buildEventAnalysisMessages(input)
    .map(message => message.content)
    .join('\n');
  assert.equal(input.individual_evidence.some(item => item.provenance.source_kind === 'worldbook'), false);
  assert.equal(input.individual_evidence.some(item => item.provenance.source_kind === 'external_memory'), false);
  assert.doesNotMatch(prompt, /其他人物具有明确女性生理性别|其他人物可承载妊娠/u);
});

test('G: Event messages contain semantic Character Evidence but never raw host source DTOs', () => {
  const input = eventInput({
    character: {description: '当前角色具有女性生理性别。', host_only: 'CARD_HOST_OBJECT'},
    persona: {name: 'persona_raw', description: 'PERSONA_RAW_DESCRIPTION 女性生理性别。', host_only: 'PERSONA_HOST_OBJECT'},
    worldbooks: [{entries: [{content: 'WORLDBOOK_RAW_OTHER 女性生理性别。'}]}],
    external_memory: [{items: [{content: 'EXTERNAL_RAW_OTHER 女性生理性别。'}]}],
  });
  const prompt = buildEventAnalysisMessages(input)
    .map(message => message.content)
    .join('\n');
  assert.match(prompt, /稳定人物生理证据（不是当前 Floor Event）/u);
  assert.match(prompt, /biological_sex：当前角色具有女性生理性别/u);
  for (const marker of [
    'CARD_HOST_OBJECT',
    'PERSONA_HOST_OBJECT',
    'WORLDBOOK_RAW_OTHER',
    'EXTERNAL_RAW_OTHER',
  ]) {
    assert.doesNotMatch(prompt, new RegExp(marker, 'u'));
  }
  assert.doesNotMatch(prompt, /"(?:character|persona|worldbooks|external_memory)"\s*:/u);
});

test('Event message roles and ordered blocks are stable, with narrative only in ASSISTANT', async () => {
  const input = eventInput(await collectAnalysisContext({
    sources: analysisSources(),
    selected: selectedSourceItems(),
    context: fixtureContext(),
    chatId: 'chat_fixture',
    chatSettings: {
      worldbooks: {selected: selectedSourceItems()},
      recent_story: {enabled: true, floor_count: 1},
      external_memory: {anima: true},
    },
    externalMemoryProviders: [{
      key: 'anima',
      available: true,
      content_available: true,
      items: [{label: '外部来源', content: 'EXTERNAL_ENABLED'}],
    }],
    recentStoryItems: [{floor: 2, message_id: 'message_recent', role: 'assistant', content: 'RECENT_STORY'}],
    includePersonaInTokenEstimate: true,
  }));
  const messages = buildEventAnalysisMessages(input, promptSettings);
  assert.deepEqual(messages.map(message => message.role), [
    'system', 'system', 'system', 'assistant', 'user', 'system',
  ]);
  assert.equal(messages[0].content, 'COMMON_TOP_MARKER');
  assert.equal(messages.filter(message => message.role === 'assistant').length, 1);
  assert.equal(messages.filter(message => message.role === 'system').length <= 4, true);
  assert.equal(messages.at(-3).content.includes('【剧情上下文】'), true);
  assert.equal(messages.at(-3).content.includes('【本次分析内容】'), true);
  assert.equal(messages.at(-2).role, 'user');
  assert.deepEqual(messages.at(-1), {role: 'system', content: 'COMMON_BOTTOM_MARKER'});

  const markerOrder = [
    'COMMON_TOP_MARKER',
    '你是 BioWeave 的 BiologicalEvent 事实提取器',
    '【公共分析提示词】',
    '【Event Analysis 任务】',
    '【本次分析边界】',
    '【Event 输出契约】',
    '【当前 World Model 参考】',
    '【剧情上下文】',
    '【本次分析内容】',
    '请根据以上资料分析 narrative discovery window（Current Target Floor 与 Recent Story）',
  ];
  const combinedPrompt = messages.map(message => message.content).join('\n');
  let previous = -1;
  for (const marker of markerOrder) {
    const index = combinedPrompt.indexOf(marker);
    assert.ok(index > previous, `expected ordered Event block: ${marker}`);
    previous = index;
  }
  assert.equal(messages.slice(0, 3).every(message => message.role === 'system'), true);
  assert.doesNotMatch(messages[2].content, /角色卡|世界书|外部历史|人物设定/u);
  assert.equal(messages.at(-3).role, 'assistant');
  assert.doesNotMatch(messages.at(-3).content, /【楼层|正文：|role=|message_id|swipe_id|content_hash|message_version/u);
  assert.doesNotMatch(messages.map(message => message.content).join('\n'), /JSON\.stringify\(analysisInput\)|"recent_story"\s*:/u);
});

test('Event and World Model keep configured SYSTEM boundaries absolute and aggregate blocks', () => {
  const input = eventInput({
    recent_story: {items: [{floor: 2, role: 'assistant', content: 'REFERENCE_FLOOR'}]},
    character: {description: 'CHARACTER_REFERENCE'},
    worldbooks: [{entries: [{label: 'ENTRY', content: 'WORLDBOOK_REFERENCE'}]}],
    persona: {name: 'persona_display', description: 'PERSONA_REFERENCE'},
    meta: {user_name: 'persona_display', character_name: 'character_display'},
  });
  const settings = {
    system_top: 'FIRST_SYSTEM',
    task: 'COMMON_TASK',
    input_prefix: 'COMMON_PREFIX',
    input_suffix: 'COMMON_SUFFIX',
    system_bottom: 'LAST_SYSTEM',
  };
  for (const messages of [
    buildEventAnalysisMessages(input, settings),
    buildWorldModelMessages(input, settings),
  ]) {
    const systems = messages.filter(message => message.role === 'system');
    assert.equal(systems[0].content, 'FIRST_SYSTEM');
    assert.equal(systems.at(-1).content, 'LAST_SYSTEM');
    assert.equal(systems.length <= 4, true);
    assert.equal(messages.filter(message => message.role === 'assistant').length, 1);
    assert.equal(messages.at(-3).role, 'assistant');
    assert.equal(messages.at(-2).role, 'user');
    assert.deepEqual(messages.at(-1), {role: 'system', content: 'LAST_SYSTEM'});
  }

  const eventMessages = buildEventAnalysisMessages(input, settings);
  const referenceMessages = eventMessages.filter(message => (
    message.role === 'system' && message.content.includes('【当前 World Model 参考】')
  ));
  assert.equal(referenceMessages.length, 1);
  assert.doesNotMatch(referenceMessages[0].content, /角色卡|世界书|人物设定/u);
  assert.match(eventMessages.find(message => message.role === 'assistant').content, /REFERENCE_FLOOR/);
  assert.match(eventMessages.find(message => message.role === 'assistant').content, /【本次分析内容】/);
});

test('Event Prompt Preview is generated from the exact Event message builder', async () => {
  const input = eventInput(await collectAnalysisContext({
    sources: analysisSources(),
    selected: selectedSourceItems(),
    context: fixtureContext(),
    chatId: 'chat_fixture',
    chatSettings: {worldbooks: {selected: selectedSourceItems()}, recent_story: {enabled: false, floor_count: 0}},
    externalMemoryProviders: [],
    includePersonaInTokenEstimate: true,
  }));
  const expected = buildEventAnalysisMessages(input, promptSettings);
  const html = renderAnalysisDebugPopupContent({
    analysisPrompt: promptSettings,
    analysisPreview: {analysisType: 'event', eventInput: input, mode: 'raw'},
    documentRef: null,
  });
  assert.deepEqual(extractRawMessages(html), expected);
});

test('World Model uses the selected shared context but never formats User Persona', () => {
  const input = buildAnalysisInput({
    sources: analysisSources(),
    selected: selectedSourceItems(),
    context: fixtureContext(),
    chatId: 'chat_fixture',
    recentStory: {enabled: true, floor_count: 1},
  });
  const messages = buildWorldModelMessages(input, promptSettings);
  const roles = messages.map(message => message.role);
  assert.equal(roles.filter(role => role === 'system').length >= 1, true);
  assert.equal(roles.at(-3), 'assistant');
  assert.equal(roles.at(-2), 'user');
  assert.equal(roles.at(-1), 'system');
  assert.match(messages.map(message => message.content).join('\n'), /CHARACTER_SELECTED|WORLDBOOK_SELECTED/);
  assert.doesNotMatch(messages.map(message => message.content).join('\n'), /PERSONA_SELECTED|persona_description|user_persona/iu);
});

test('Event formatting keeps structured Story Time and redacts credential-shaped fields', () => {
  const input = buildEventAnalysisInput({
    chatId: 'chat_fixture',
    floorVersion: {
      chat_id: 'chat_fixture',
      message_id: 'message_target',
      floor: 3,
      swipe_id: 0,
      content_hash: 'hash_fixture',
      message_version: 'v1:hash_fixture',
    },
    currentFloor: {floor: 3, narrative: 'TARGET_FLOOR_EVENT'},
    storyTime: {
      display: 'calendar display fixture',
      normalized: 'canonical-time-fixture',
      calendar_id: 'calendar_fixture',
      day_index: 18342,
      precision: 'day',
      confidence: 1,
    },
    worldModel: {
      safe_marker: 'WORLD_MODEL_SAFE',
      token: 'LEAK_TOKEN',
      bearer: 'LEAK_BEARER',
      credential: 'LEAK_CREDENTIAL',
      nested: {access_token: 'LEAK_ACCESS_TOKEN'},
    },
    existingBioWeave: {
      safe_marker: 'EXISTING_SAFE',
      token: 'LEAK_EXISTING_TOKEN',
    },
  });
  const prompt = buildEventAnalysisMessages(input).map(message => message.content).join('\n');
  assert.match(prompt, /标准化时间：canonical-time-fixture/);
  assert.match(prompt, /日历：calendar_fixture/);
  assert.match(prompt, /连续日索引：18342/);
  assert.match(prompt, /WORLD_MODEL_SAFE|EXISTING_SAFE/);
  assert.doesNotMatch(prompt, /LEAK_TOKEN|LEAK_BEARER|LEAK_CREDENTIAL|LEAK_ACCESS_TOKEN|LEAK_EXISTING_TOKEN/);
});

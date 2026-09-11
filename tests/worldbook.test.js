import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  createWorldbookCache,
  loadAnalysisSources,
  loadWorldbookSource,
  mergeAnalysisSources,
  normalizeAnalysisSource,
  normalizeCharacterCardFields,
  detectCurrentCharacterGreetingField,
  normalizeWorldbookEntries,
  normalizeWorldbookList,
  searchAnalysisSources,
  selectAllSources,
  selectNoneSources,
  sourceSelectionStats,
  characterOpeningSelectionState,
  setCharacterCardOpeningsSelection,
  setWorldbookEntriesSelection,
  updateSourceSelection,
  worldbookSelectionState,
} from '../ai/worldbook.js';
import {
  normalizeExternalMemorySettings,
  normalizeExtensionSettings,
  normalizeRecentStorySettings,
  normalizeWorldbookSettings,
} from '../storage/schema.js';
import {createChatBoundary} from '../runtime/chat.js';
import {createApiProfileStore, createStore} from '../storage/store.js';
import {detectExternalMemoryProviders, probeExternalMemoryProviders} from '../story/seven-days-cal.js';
import {renderAnalysisDebugPopupContent, settingsPage} from '../ui/settings.js';
import {applyRecentStoryRegex, buildAnalysisInput, mergeRecentStorySettings} from '../ai/input-builder.js';

const STYLE_SOURCE = readFileSync(new URL('../style.css', import.meta.url), 'utf8');

function jsonResponse(value, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return value;
    },
  };
}

test('Worldbook source_id uses file_id instead of duplicate display names', () => {
  const sources = normalizeWorldbookList([
    {file_id: 'book-alpha', name: '共同名称'},
    {file_id: 'book-beta', name: '共同名称'},
  ]);
  assert.equal(sources.length, 2);
  assert.notEqual(sources[0].source_id, sources[1].source_id);
  assert.equal(sources[0].source_type, 'worldbook');
  assert.equal(sources[0].label, sources[1].label);
  assert.match(sources[0].source_id, /book-alpha/);
  assert.equal(normalizeWorldbookList([{name: '只有显示名称'}]).length, 0);
  assert.equal(normalizeAnalysisSource({source_type: 'unknown'}), null);
  assert.equal(normalizeAnalysisSource({source_type: 'sevendayscal', source_id: 'old-story-clock'}), null);
});

test('worldbooks with the same stable file_id are merged once', () => {
  const sources = normalizeWorldbookList([
    {file_id: 'same-file', source_id: 'source-a', name: '第一来源'},
    {file_id: 'same-file', source_id: 'source-b', name: '第二来源'},
  ]);
  const merged = mergeAnalysisSources(sources);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].host_key, 'same-file');
});

test('same normalized worldbook entries are reused when a mounted alias is merged', () => {
  const source = normalizeWorldbookList([{
    file_id: 'reuse-file',
    name: '复用世界书',
    entries: [
      {uid: 'reuse-entry-1', comment: '条目一', content: '内容一'},
      {uid: 'reuse-entry-2', comment: '条目二', content: '内容二'},
    ],
  }])[0];
  const mountedAlias = normalizeAnalysisSource(source, {
    source_id: source.source_id,
    source_type: 'worldbook',
    scopes: [...source.scopes, 'character_worldbook'],
  });
  const merged = mergeAnalysisSources([source, mountedAlias])[0];

  assert.strictEqual(mountedAlias.entries, source.entries);
  assert.strictEqual(merged.entries, source.entries);
  assert.equal(merged.token_estimate, source.token_estimate);
  assert.deepEqual(new Set(merged.scopes), new Set(['worldbook', 'global_worldbook', 'character_worldbook']));
});

test('analysis sources expose character fields and worldbook entries only', async () => {
  const context = {
    characterId: 0,
    characters: [{
      avatar: 'alice-card.png',
      data: {
        name: '爱丽丝',
        description: '角色描述',
        personality: '温柔',
        scenario: '森林',
        first_mes: '当前主开场白',
        alternate_greetings: ['备用开场白一', '备用开场白二'],
        mes_example: '示例对话',
        character_book: {entries: [{uid: 21, comment: '卡内规则', content: '卡内规则内容'}]},
        extensions: {world: 'shared-book'},
      },
    }],
    extensionPrompts: {sdc_story_clock: '第 3 天，夜晚'},
    async loadWorldInfo(name) {
      assert.equal(name, 'shared-book');
      return {entries: [
        {uid: 'entry-a', comment: '条目 A', content: '角色世界书内容 A'},
        {uid: 'entry-b', comment: '条目 B', content: '角色世界书内容 B'},
      ]};
    },
  };
  const requests = [];
  const result = await loadAnalysisSources({
    context,
    fetchRef: async (url, options) => {
      requests.push({url, options});
      return jsonResponse([{file_id: 'shared-book', name: '共享世界书'}]);
    },
    getRequestHeaders: () => ({'X-Test': 'yes'}),
  });
  const sources = result.sources;

  assert.equal(requests[0].url, '/api/worldinfo/list');
  assert.equal(result.warning, null);
  assert.deepEqual(new Set(sources.map(source => source.source_type)), new Set(['character_card', 'worldbook']));
  const loadedWorldbooks = sources.filter(source => source.source_type === 'worldbook');
  assert.equal(loadedWorldbooks.length, 1);
  assert.equal(loadedWorldbooks.some(source => source.label === '角色卡内嵌世界书'), false);
  const worldbook = sources.find(source => source.source_id === 'st-worldbook:shared-book');
  assert.deepEqual(new Set(worldbook.scopes), new Set(['global_worldbook', 'worldbook', 'character_card_worldbook']));
  assert.equal(worldbook.content_available, true);
  assert.deepEqual(worldbook.entries.map(entry => entry.entry_id), ['entry-a', 'entry-b']);
  const card = sources.find(source => source.source_type === 'character_card');
  assert.deepEqual(card.fields.map(field => field.field_key), ['description', 'opening:main', 'opening:alternate:0', 'opening:alternate:1']);
  assert.deepEqual(card.fields.map(field => field.label), ['角色描述', '主开场白', '其他开场白 1', '其他开场白 2']);
  assert.equal(card.fields.find(field => field.field_key === 'opening:main').content, '当前主开场白');
  assert.equal(card.fields.find(field => field.field_key === 'opening:alternate:0').content, '备用开场白一');
  assert.equal(card.fields.find(field => field.field_key === 'opening:alternate:1').content, '备用开场白二');
  assert.equal(card.fields.some(field => field.field_key === 'personality'), false);
  assert.equal(card.fields.some(field => field.field_key === 'scenario'), false);
  assert.equal(card.fields.some(field => field.field_key === 'mes_example'), false);
  assert.equal(card.fields.some(field => field.field_key === 'name'), false);
  assert.equal(sources.some(source => source.source_type === 'recent_story'), false);
  assert.equal(sources.some(source => source.source_type === 'sevendayscal'), false);
});

test('current greeting is identified from the first chat message swipe', async () => {
  const context = {
    characterId: 0,
    characters: [{
      name: '爱丽丝',
      avatar: 'greeting-card.png',
      data: {
        description: '角色描述',
        first_mes: '主开场白',
        alternate_greetings: ['备用开场白一', '备用开场白二'],
      },
    }],
    chat: [{
      name: '爱丽丝',
      is_user: false,
      is_system: false,
      swipe_id: 2,
      swipes: ['主开场白', '备用开场白一', '备用开场白二'],
    }],
  };

  assert.equal(detectCurrentCharacterGreetingField(context.characters[0], context), 'opening:alternate:1');
  const result = await loadAnalysisSources({
    context,
    fetchRef: async () => jsonResponse([]),
  });
  const card = result.sources.find(source => source.source_type === 'character_card');
  assert.equal(card.fields.find(field => field.field_key === 'opening:alternate:1').is_current, true);
  assert.equal(card.fields.find(field => field.field_key === 'opening:main').is_current, false);
});

test('runtime worldbook groups prioritize enabled global, merge character books, and hide chat books', async () => {
  const loadedNames = [];
  const context = {
    characterId: 0,
    characters: [{
      avatar: 'grouped-card.png',
      data: {description: '角色描述', extensions: {world: 'role-primary'}},
    }],
    chatMetadata: {world_info: [{file_id: 'chat-only'}]},
    async loadWorldInfo(name) {
      loadedNames.push(name);
      return {entries: [{uid: `${name}-entry`, comment: name, content: `${name} 内容`}]};
    },
  };
  const globalRef = {
    TavernHelper: {
      getLorebookSettings() {
        return {
          selected_global_lorebooks: [
            {source_id: 'canonical-global'},
            '按名称匹配',
            '重名世界书',
          ],
        };
      },
      getCharLorebooks() {
        return {
          primary: {host_key: 'role-primary'},
          additional: [{file_id: 'role-additional'}, {source_id: 'canonical-global'}],
        };
      },
    },
  };
  const result = await loadAnalysisSources({
    context,
    globalRef,
    fetchRef: async () => jsonResponse([
      {file_id: 'global-file', source_id: 'canonical-global', name: '全局稳定书'},
      {file_id: 'role-primary', name: '角色主书'},
      {file_id: 'role-additional', name: '角色附加书'},
      {file_id: 'name-backed', name: '按名称匹配'},
      {file_id: 'duplicate-a', name: '重名世界书'},
      {file_id: 'duplicate-b', name: '重名世界书'},
      {file_id: 'chat-only', name: '聊天书'},
      {file_id: 'other-book', name: '其他书'},
    ]),
  });

  const worldbooks = result.sources.filter(source => source.source_type === 'worldbook');
  const byId = id => worldbooks.find(source => source.source_id === id);
  assert.equal(worldbooks.some(source => source.label === '聊天书'), false);
  assert.equal(byId('canonical-global').worldbook_group, 'selected_global');
  assert.equal(byId('st-worldbook:role-primary').worldbook_group, 'character_card');
  assert.equal(byId('st-worldbook:role-additional').worldbook_group, 'character');
  assert.equal(byId('st-worldbook:name-backed').worldbook_group, 'selected_global');
  assert.equal(byId('st-worldbook:other-book').worldbook_group, 'other');
  assert.equal(byId('st-worldbook:duplicate-a').worldbook_group, 'other');
  assert.equal(byId('st-worldbook:duplicate-b').worldbook_group, 'other');
  assert.equal(worldbooks.filter(source => source.source_id === 'st-worldbook:role-primary').length, 1);
  assert.equal(loadedNames.includes('chat-only'), false);
  assert.ok(loadedNames.includes('global-file'));
  assert.ok(loadedNames.includes('role-primary'));
  assert.ok(loadedNames.includes('role-additional'));
});

test('runtime grouping does not use private world_info fallbacks', async () => {
  const result = await loadAnalysisSources({
    context: {
      characterId: 0,
      characters: [{avatar: 'private-fallback-card.png', data: {description: '角色描述'}}],
    },
    globalRef: {
      world_info: {
        globalSelect: ['private-global'],
        charLore: [{avatar: 'private-fallback-card.png', extraBooks: ['private-character']}],
      },
      selected_world_info: ['private-global'],
    },
    fetchRef: async (url, options) => url === '/api/worldinfo/list'
      ? jsonResponse([
        {file_id: 'private-global', name: '私有全局书'},
        {file_id: 'private-character', name: '私有角色书'},
      ])
      : jsonResponse({entries: [{uid: 'entry-1', comment: '条目', content: '内容'}]}),
  });

  const worldbooks = result.sources.filter(source => source.source_type === 'worldbook');
  assert.equal(worldbooks.find(source => source.source_id === 'st-worldbook:private-global').worldbook_group, 'other');
  assert.equal(worldbooks.find(source => source.source_id === 'st-worldbook:private-character').worldbook_group, 'other');
});

test('worldbook cache survives time advancing and force refresh fetches new data', async () => {
  const cache = createWorldbookCache();
  let listCalls = 0;
  let contentCalls = 0;
  let contentVersion = 1;
  const context = {
    characterId: 0,
    characters: [{avatar: 'cache-card.png', data: {description: '描述'}}],
    async loadWorldInfo(name) {
      contentCalls += 1;
      return {entries: [{uid: `${name}-entry`, comment: name, content: `${name} 内容 v${contentVersion}`}]};
    },
  };
  const fetchRef = async url => {
    assert.equal(url, '/api/worldinfo/list');
    listCalls += 1;
    return jsonResponse([
      {file_id: 'cache-book-a', name: '缓存书 A'},
      {file_id: 'cache-book-b', name: '缓存书 B'},
    ]);
  };
  const timings = [];

  await loadAnalysisSources({context, fetchRef, cache, onTiming: event => timings.push(event)});
  const firstStages = new Set(timings.map(event => event.stage));
  assert.ok(firstStages.has('list'));
  assert.ok(firstStages.has('normalize_list'));
  assert.ok(firstStages.has('normalize_content'));
  assert.ok(firstStages.has('content_fetch'));
  assert.ok(firstStages.has('merge'));

  contentVersion = 2;
  const originalDateNow = Date.now;
  Date.now = () => originalDateNow() + 60_000;
  try {
    timings.length = 0;
    const cached = await loadAnalysisSources({context, fetchRef, cache, onTiming: event => timings.push(event)});
    assert.ok(timings.some(event => event.stage === 'content_cache' && event.cache_hit === true));
    assert.ok(timings.some(event => event.stage === 'list' && event.cache_hit === true));
    assert.equal(cached.sources.find(source => source.source_id === 'st-worldbook:cache-book-a').entries[0].content, 'cache-book-a 内容 v1');
    assert.equal(listCalls, 1);
    assert.equal(contentCalls, 2);
  } finally {
    Date.now = originalDateNow;
  }

  const refreshed = await loadAnalysisSources({context, fetchRef, cache, forceRefresh: true});
  assert.equal(listCalls, 2);
  assert.equal(contentCalls, 4);
  assert.equal(refreshed.sources.find(source => source.source_id === 'st-worldbook:cache-book-a').entries[0].content, 'cache-book-a 内容 v2');
});

test('deferred worldbook content loads only when the selected book is requested', async () => {
  const cache = createWorldbookCache();
  let contentCalls = 0;
  const context = {
    characterId: 0,
    characters: [],
    async loadWorldInfo(name) {
      contentCalls += 1;
      return {entries: [{uid: `${name}-entry`, comment: name, content: `${name} 内容`}]};
    },
  };
  const fetchRef = async url => url === '/api/worldinfo/list'
    ? jsonResponse([
      {file_id: 'deferred-book-a', name: '延迟书 A'},
      {file_id: 'deferred-book-b', name: '延迟书 B'},
    ])
    : jsonResponse({entries: []});

  const catalog = await loadAnalysisSources({
    context,
    fetchRef,
    cache,
    deferWorldbookContent: true,
    loadContentForSourceIds: ['st-worldbook:deferred-book-b'],
  });
  assert.equal(contentCalls, 1);
  assert.equal(catalog.sources.find(source => source.source_id === 'st-worldbook:deferred-book-a').content_loaded, false);
  assert.equal(catalog.sources.find(source => source.source_id === 'st-worldbook:deferred-book-b').content_loaded, true);

  const loaded = await loadWorldbookSource(
    catalog.sources.find(source => source.source_id === 'st-worldbook:deferred-book-a'),
    {context, fetchRef, cache},
  );
  assert.equal(contentCalls, 2);
  assert.equal(loaded.entries.length, 1);

  const refreshed = await loadWorldbookSource(loaded, {context, fetchRef, cache, forceRefresh: true});
  assert.equal(contentCalls, 3);
  assert.equal(refreshed.content_loaded, true);
});

test('public worldbook names and concurrent reads avoid duplicate work', async () => {
  const cache = createWorldbookCache();
  let contentCalls = 0;
  const context = {
    characterId: 0,
    characters: [],
    async getWorldInfoNames() {
      return [{file_id: 'public-book', name: '公共世界书'}];
    },
  };
  const fetchRef = async url => {
    assert.equal(url, '/api/worldinfo/list');
    throw new Error('公共名称列表可用时不应访问 endpoint');
  };

  const options = {context, fetchRef, cache, deferWorldbookContent: true};
  const firstLoad = loadAnalysisSources(options);
  const secondLoad = loadAnalysisSources(options);
  const [first, second] = await Promise.all([firstLoad, secondLoad]);
  assert.equal(first.sources.length, 1);
  assert.equal(second.sources.length, 1);

  const listCache = createWorldbookCache();
  let listCalls = 0;
  let resolveList;
  const listPromise = new Promise(resolve => {
    resolveList = resolve;
  });
  const listContext = {characterId: 0, characters: []};
  const listFetch = async url => {
    assert.equal(url, '/api/worldinfo/list');
    listCalls += 1;
    return listPromise;
  };
  const listOptions = {
    context: listContext,
    fetchRef: listFetch,
    cache: listCache,
    deferWorldbookContent: true,
  };
  const firstCatalog = loadAnalysisSources(listOptions);
  const secondCatalog = loadAnalysisSources(listOptions);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(listCalls, 1);
  resolveList([{file_id: 'public-book', name: '公共世界书'}]);
  await Promise.all([firstCatalog, secondCatalog]);

  const contentCache = createWorldbookCache();
  let resolveContent;
  const contentPromise = new Promise(resolve => {
    resolveContent = resolve;
  });
  const contentContext = {
    async loadWorldInfo() {
      contentCalls += 1;
      return contentPromise;
    },
  };
  const source = normalizeWorldbookList([{file_id: 'public-book', name: '公共世界书'}])[0];
  const contentOptions = {context: contentContext, fetchRef, cache: contentCache};
  const firstContent = loadWorldbookSource(source, contentOptions);
  const secondContent = loadWorldbookSource(source, contentOptions);
  resolveContent({entries: [{uid: 'public-entry', comment: '公共条目', content: '内容'}]});
  const [loadedFirst, loadedSecond] = await Promise.all([firstContent, secondContent]);
  assert.equal(contentCalls, 1);
  assert.equal(loadedFirst.entries[0].entry_id, 'public-entry');
  assert.equal(loadedSecond.entries[0].entry_id, 'public-entry');
});

test('independent embedded character worldbook remains available without a mounted worldbook', async () => {
  const result = await loadAnalysisSources({
    context: {
      characterId: 0,
      characters: [{
        avatar: 'embedded-card.png',
        data: {
          name: '内嵌角色',
          description: '角色描述',
          character_book: {
            entries: [{uid: 'embedded-entry', comment: '内嵌条目', content: '独立内嵌内容'}],
          },
        },
      }],
    },
    fetchRef: async () => jsonResponse([]),
  });
  const embedded = result.sources.filter(source => source.source_type === 'worldbook');
  assert.equal(embedded.length, 1);
  assert.equal(embedded[0].label, '角色卡内嵌世界书');
  assert.equal(embedded[0].worldbook_group, 'character_card');
  assert.equal(embedded[0].entries[0].entry_id, 'embedded-entry');
});

test('entry and character field selection keep stable IDs and estimate selected tokens', () => {
  const card = {
    source_id: 'st-character-card:alice',
    source_type: 'character_card',
    label: '角色卡',
    fields: [
      {field_key: 'description', label: '角色描述', content: '描述内容', token_estimate: 2},
      {field_key: 'opening:main', label: '主开场白', content: '主开场白内容', token_estimate: 3},
      {field_key: 'opening:alternate:0', label: '其他开场白 1', content: '备用开场白内容', token_estimate: 3},
    ],
  };
  const sources = normalizeWorldbookList([
    {file_id: 'alpha', name: '森林', entries: [
      {uid: 'entry-1', comment: '条目 A', content: '森林内容'},
      {uid: 'entry-2', comment: '条目 B', content: '其他内容'},
    ]},
    {file_id: 'beta', name: '海岸', entries: [
      {uid: 'entry-3', comment: '条目 C', content: '海岸内容'},
    ]},
  ]);
  const all = [card, ...sources];
  assert.deepEqual(normalizeWorldbookEntries([{uid: 0, comment: '零号条目'}, {uid: 'same', comment: '相同标题'}, {uid: 'same', comment: '重复标题'}, {comment: '没有稳定 ID'}]).map(entry => entry.entry_id), ['0', 'same']);
  assert.deepEqual(normalizeCharacterCardFields({data: {description: '描述', personality: '人格', first_mes: '开场白', alternate_greetings: ['备用开场白'], character_book: {entries: []}}}).map(field => field.field_key), ['description', 'opening:main', 'opening:alternate:0']);
  assert.deepEqual(normalizeCharacterCardFields({name: '顶层角色名', data: {description: '描述'}}).map(field => field.field_key), ['description']);
  assert.equal(searchAnalysisSources(all, '条目 C')[0].entries[0].entry_id, 'entry-3');
  let selected = updateSourceSelection([], {source_id: card.source_id, field_key: 'description'}, true);
  selected = updateSourceSelection(selected, {source_id: sources[0].source_id, entry_id: 'entry-1'}, true);
  selected = updateSourceSelection(selected, {source_id: sources[1].source_id, entry_id: 'entry-3'}, true);
  const stats = sourceSelectionStats(all, selected);
  assert.equal(stats.count, 3);
  assert.equal(stats.worldbook_count, 2);
  assert.equal(stats.token_estimate, 2 + sources[0].entries[0].token_estimate + sources[1].entries[0].token_estimate);
  assert.equal(selectAllSources(all).length, 6);
  assert.deepEqual(selectNoneSources(), []);
  assert.deepEqual(updateSourceSelection(selected, {source_id: sources[0].source_id, entry_id: 'entry-1'}, false), [
    {source_id: card.source_id, field_key: 'description', enabled: true},
    {source_id: sources[1].source_id, entry_id: 'entry-3', enabled: true},
  ]);
});

test('worldbook parent selection derives checked and indeterminate state from entries', () => {
  const source = {
    source_id: 'st-worldbook:alpha',
    source_type: 'worldbook',
    entries: [
      {entry_id: 'entry-1', token_estimate: 2},
      {entry_id: 'entry-2', token_estimate: 3},
      {entry_id: 'entry-3', token_estimate: 5},
    ],
  };
  assert.deepEqual(worldbookSelectionState(source, []), {
    total_count: 3,
    selected_count: 0,
    checked: false,
    indeterminate: false,
  });

  const selectedAll = setWorldbookEntriesSelection([
    {source_id: 'st-character-card:alice', field_key: 'description', enabled: true},
    {source_id: 'st-worldbook:alpha', enabled: true},
  ], source, true);
  assert.deepEqual(selectedAll, [
    {source_id: 'st-character-card:alice', field_key: 'description', enabled: true},
    {source_id: 'st-worldbook:alpha', entry_id: 'entry-1', enabled: true},
    {source_id: 'st-worldbook:alpha', entry_id: 'entry-2', enabled: true},
    {source_id: 'st-worldbook:alpha', entry_id: 'entry-3', enabled: true},
  ]);
  assert.deepEqual(worldbookSelectionState(source, selectedAll), {
    total_count: 3,
    selected_count: 3,
    checked: true,
    indeterminate: false,
  });

  const selectedPartial = setWorldbookEntriesSelection(selectedAll, source, false);
  assert.deepEqual(selectedPartial, [
    {source_id: 'st-character-card:alice', field_key: 'description', enabled: true},
  ]);
  assert.deepEqual(worldbookSelectionState(source, selectedPartial), {
    total_count: 3,
    selected_count: 0,
    checked: false,
    indeterminate: false,
  });
  const selectedOne = setWorldbookEntriesSelection(selectedPartial, source, true)
    .filter(item => item.entry_id === 'entry-1');
  assert.deepEqual(worldbookSelectionState(source, selectedOne), {
    total_count: 3,
    selected_count: 1,
    checked: false,
    indeterminate: true,
  });
});

test('character opening parent selection keeps main and alternate greetings independent', () => {
  const source = {
    source_id: 'st-character-card:alice',
    source_type: 'character_card',
    fields: [
      {field_key: 'description', content: '描述'},
      {field_key: 'opening:main', content: '主开场白'},
      {field_key: 'opening:alternate:0', content: '备用开场白一'},
      {field_key: 'opening:alternate:1', content: '备用开场白二'},
    ],
  };
  assert.deepEqual(characterOpeningSelectionState(source, []), {
    total_count: 3,
    selected_count: 0,
    checked: false,
    indeterminate: false,
  });

  const selectedAll = setCharacterCardOpeningsSelection([
    {source_id: source.source_id, field_key: 'description', enabled: true},
    {source_id: source.source_id, field_key: 'opening', enabled: true},
    {source_id: 'st-worldbook:other', entry_id: 'entry-1', enabled: true},
  ], source, true);
  assert.deepEqual(selectedAll, [
    {source_id: source.source_id, field_key: 'description', enabled: true},
    {source_id: 'st-worldbook:other', entry_id: 'entry-1', enabled: true},
    {source_id: source.source_id, field_key: 'opening:main', enabled: true},
    {source_id: source.source_id, field_key: 'opening:alternate:0', enabled: true},
    {source_id: source.source_id, field_key: 'opening:alternate:1', enabled: true},
  ]);
  assert.deepEqual(characterOpeningSelectionState(source, selectedAll), {
    total_count: 3,
    selected_count: 3,
    checked: true,
    indeterminate: false,
  });

  const selectedNone = setCharacterCardOpeningsSelection(selectedAll, source, false);
  assert.deepEqual(selectedNone, [
    {source_id: source.source_id, field_key: 'description', enabled: true},
    {source_id: 'st-worldbook:other', entry_id: 'entry-1', enabled: true},
  ]);
  assert.deepEqual(characterOpeningSelectionState(source, selectedNone), {
    total_count: 3,
    selected_count: 0,
    checked: false,
    indeterminate: false,
  });

  const selectedPartial = setCharacterCardOpeningsSelection(selectedNone, source, true)
    .filter(item => item.field_key !== 'opening:alternate:0' && item.field_key !== 'opening:alternate:1');
  assert.deepEqual(characterOpeningSelectionState(source, selectedPartial), {
    total_count: 3,
    selected_count: 1,
    checked: false,
    indeterminate: true,
  });
});

test('worldbook selection is normalized and remains Chat-local', async () => {
  assert.deepEqual(normalizeWorldbookSettings({
    mode: 'invalid',
    selected: [
      {source_id: 'book-a', enabled: true, label: '不应保存的名称'},
      {source_id: 'book-a', enabled: true},
      {source_id: 'book-b', enabled: false},
    ],
  }), {
    mode: 'selected_only',
    selected: [{source_id: 'book-a', enabled: true}],
  });

  let chatId = 'chat-a';
  const metadata = {};
  const adapter = {
    getChatId: () => chatId,
    getChatMetadata: () => metadata,
    async saveChatMetadata(key, value, expectedChatId) {
      assert.equal(expectedChatId, chatId);
      metadata[key] = value;
    },
  };
  const store = createStore(adapter, createChatBoundary(adapter));
  const chatA = store.getChat('chat-a');
  chatA.settings.worldbooks = normalizeWorldbookSettings({selected: ['book-a']});
  await store.saveChat('chat-a', chatA);
  assert.deepEqual(store.getChat('chat-a').settings.worldbooks.selected, [{source_id: 'book-a', enabled: true}]);

  chatId = 'chat-b';
  assert.deepEqual(store.getChat('chat-b').settings.worldbooks.selected, []);
});

test('Chat A and Chat B keep independent entry and greeting selections across a return to A', async () => {
  let activeChatId = 'chat-a';
  const metadataByChat = {
    'chat-a': {},
    'chat-b': {},
  };
  const adapter = {
    getChatId: () => activeChatId,
    getChatMetadata: () => metadataByChat[activeChatId],
    async saveChatMetadata(key, value, expectedChatId) {
      assert.equal(expectedChatId, activeChatId);
      metadataByChat[activeChatId][key] = value;
    },
  };
  const store = createStore(adapter, createChatBoundary(adapter));

  async function saveSelection(chatId, selected) {
    activeChatId = chatId;
    const chat = store.getChat(chatId);
    chat.settings.worldbooks = normalizeWorldbookSettings({selected});
    await store.saveChat(chatId, chat);
  }

  await saveSelection('chat-a', [
    {source_id: 'st-worldbook:wb-1', entry_id: 'entry-1', enabled: true},
    {source_id: 'st-worldbook:wb-2', entry_id: 'entry-3', enabled: true},
    {source_id: 'st-character-card:alice', field_key: 'opening:main', enabled: true},
    {source_id: 'st-character-card:alice', field_key: 'opening:alternate:0', enabled: true},
  ]);
  await saveSelection('chat-b', [
    {source_id: 'st-worldbook:wb-3', entry_id: 'entry-2', enabled: true},
    {source_id: 'st-character-card:alice', field_key: 'opening:alternate:1', enabled: true},
  ]);

  activeChatId = 'chat-a';
  const restoredA = store.getChat('chat-a').settings.worldbooks.selected;
  assert.deepEqual(restoredA, [
    {source_id: 'st-worldbook:wb-1', entry_id: 'entry-1', enabled: true},
    {source_id: 'st-worldbook:wb-2', entry_id: 'entry-3', enabled: true},
    {source_id: 'st-character-card:alice', field_key: 'opening:main', enabled: true},
    {source_id: 'st-character-card:alice', field_key: 'opening:alternate:0', enabled: true},
  ]);
  activeChatId = 'chat-b';
  assert.deepEqual(store.getChat('chat-b').settings.worldbooks.selected, [
    {source_id: 'st-worldbook:wb-3', entry_id: 'entry-2', enabled: true},
    {source_id: 'st-character-card:alice', field_key: 'opening:alternate:1', enabled: true},
  ]);
  activeChatId = 'chat-a';
  assert.equal(metadataByChat['chat-a'].bioweave.settings.worldbooks.selected[0].label, undefined);
});

test('settings page separates worldbook sources, recent story, and external memory', () => {
  const html = settingsPage({
    worldbookSources: {
      sources: [{
        source_id: 'st-character-card:alice',
        source_type: 'character_card',
        label: '角色卡',
        available: true,
        fields: [
          {field_key: 'description', label: '角色描述', content: '描述', token_estimate: 1},
          {field_key: 'opening:main', label: '主开场白', content: '主开场白', token_estimate: 1},
          {field_key: 'opening:alternate:0', label: '其他开场白 1', content: '备用开场白一', token_estimate: 1},
          {field_key: 'opening:alternate:1', label: '其他开场白 2', content: '备用开场白二', token_estimate: 1, is_current: true},
          {field_key: 'personality', label: '人格', content: '旧版内部字段', token_estimate: 2},
        ],
      }, {
        source_id: 'st-worldbook:linked',
        source_type: 'worldbook',
        scopes: ['character_worldbook'],
        label: '角色书',
        available: true,
        entries: [
          {entry_id: 'linked-entry-1', label: '角色条目 A', token_estimate: 12},
          {entry_id: 'linked-entry-2', label: '角色条目 B', token_estimate: 5},
        ],
      }, {
        source_id: 'st-worldbook:alpha',
        source_type: 'worldbook',
        scopes: ['global_worldbook'],
        label: '森林',
        available: true,
        entries: [
          {entry_id: 'entry-1', label: '条目 A', token_estimate: 12},
          {entry_id: 'entry-2', label: '条目 B', token_estimate: 5},
        ],
      }],
      visibleSources: [{
        source_id: 'st-character-card:alice',
        source_type: 'character_card',
        label: '角色卡',
        available: true,
        fields: [
          {field_key: 'description', label: '角色描述', content: '描述', token_estimate: 1},
          {field_key: 'opening:main', label: '主开场白', content: '主开场白', token_estimate: 1},
          {field_key: 'opening:alternate:0', label: '其他开场白 1', content: '备用开场白一', token_estimate: 1},
          {field_key: 'opening:alternate:1', label: '其他开场白 2', content: '备用开场白二', token_estimate: 1, is_current: true},
          {field_key: 'personality', label: '人格', content: '旧版内部字段', token_estimate: 2},
        ],
      }, {
        source_id: 'st-worldbook:linked',
        source_type: 'worldbook',
        scopes: ['character_worldbook'],
        label: '角色书',
        available: true,
        entries: [
          {entry_id: 'linked-entry-1', label: '角色条目 A', token_estimate: 12},
          {entry_id: 'linked-entry-2', label: '角色条目 B', token_estimate: 5},
        ],
      }, {
        source_id: 'st-worldbook:alpha',
        source_type: 'worldbook',
        scopes: ['global_worldbook'],
        label: '森林',
        available: true,
        entries: [
          {entry_id: 'entry-1', label: '条目 A', token_estimate: 12},
          {entry_id: 'entry-2', label: '条目 B', token_estimate: 5},
        ],
      }],
      selected: [
        {source_id: 'st-character-card:alice', field_key: 'description', enabled: true},
        {source_id: 'st-character-card:alice', field_key: 'opening:main', enabled: true},
        {source_id: 'st-worldbook:linked', entry_id: 'linked-entry-1', enabled: true},
        {source_id: 'st-worldbook:alpha', entry_id: 'entry-1', enabled: true},
      ],
      selectedCount: 4,
      selectedWorldbookCount: 1,
      selectedTokenEstimate: 26,
      recentStory: {enabled: true, floor_count: 20},
      externalMemory: {},
      externalMemoryProviders: [
        {key: 'anima', available: false, status: '未检测到公开世界书读取接口'},
        {key: 'baobaoshu', available: false, status: '未检测到柏宝书只读接口'},
        {key: 'database_memory', available: false, status: '未检测到可依赖的公开接口'},
      ],
      openWorldbooks: ['st-worldbook:alpha'],
      openCharacterGroups: ['st-character-card:alice:opening'],
      openAnalysisSections: ['character_card', 'worldbook'],
    },
  });
  assert.match(html, /世界书来源/);
  assert.match(html, /data-bioweave-analysis-section="character_card" open/);
  assert.match(html, /data-bioweave-analysis-section="worldbook" open/);
  assert.match(html, /附加角色世界书/);
  assert.match(html, /当前开启的全局世界书/);
  assert.match(html, /角色描述/);
  assert.match(html, /data-bioweave-analysis-character-group="opening"[^>]* open/);
  assert.match(html, /data-bioweave-analysis-character-opening-toggle="st-character-card:alice"/);
  assert.match(html, /data-bioweave-analysis-field="opening:main"/);
  assert.match(html, /data-bioweave-analysis-field="opening:alternate:0"/);
  assert.match(html, /data-bioweave-analysis-field="opening:alternate:1"/);
  assert.match(html, /主开场白/);
  assert.match(html, /其他开场白 1/);
  assert.match(html, /其他开场白 2/);
  assert.match(html, /当前开场白/);
  assert.equal(html.includes('人格'), false);
  assert.equal(html.includes('场景'), false);
  assert.equal(html.includes('示例对话'), false);
  assert.equal(html.includes('personality'), false);
  assert.equal(html.includes('scenario'), false);
  assert.equal(html.includes('alternate_greetings'), false);
  assert.match(html, /data-bioweave-analysis-worldbook-toggle="st-worldbook:linked"/);
  assert.match(html, /data-bioweave-analysis-worldbook-toggle="st-worldbook:alpha"/);
  assert.match(html, /aria-checked="mixed"/);
  const characterGroupIndex = html.indexOf('data-bioweave-analysis-character-group="opening"');
  const characterMarkerIndex = html.indexOf('class="bioweave-analysis-disclosure-marker"', characterGroupIndex);
  const characterToggleIndex = html.indexOf('data-bioweave-analysis-character-opening-toggle="st-character-card:alice"', characterGroupIndex);
  const characterNameIndex = html.indexOf('<strong>开场白</strong>', characterGroupIndex);
  assert.ok(characterMarkerIndex < characterToggleIndex);
  assert.ok(characterToggleIndex < characterNameIndex);
  const characterSectionStart = html.indexOf('<details class="bioweave-analysis-section" data-bioweave-analysis-section="character_card"');
  const worldbookSectionStart = html.indexOf('<details class="bioweave-analysis-section" data-bioweave-analysis-section="worldbook"');
  const characterSectionHtml = html.slice(characterSectionStart, worldbookSectionStart);
  assert.doesNotMatch(characterSectionHtml, /bioweave-analysis-source-card-heading/);
  const worldbookIndex = html.indexOf('data-bioweave-analysis-source-row="st-worldbook:alpha"');
  const worldbookSummaryStart = html.indexOf('<summary class="bioweave-analysis-worldbook-summary">', worldbookIndex);
  const worldbookSummaryEnd = html.indexOf('</summary>', worldbookSummaryStart);
  const worldbookHeader = html.slice(worldbookSummaryStart, worldbookSummaryEnd);
  const expandButtonIndex = worldbookHeader.indexOf('data-bioweave-analysis-worldbook-expand');
  const worldbookToggleIndex = worldbookHeader.indexOf('data-bioweave-analysis-worldbook-toggle="st-worldbook:alpha"');
  const worldbookTitleIndex = worldbookHeader.indexOf('class="bioweave-analysis-worldbook-title"');
  assert.ok(expandButtonIndex >= 0);
  assert.ok(worldbookToggleIndex >= 0);
  assert.ok(worldbookTitleIndex >= 0);
  assert.ok(expandButtonIndex < worldbookToggleIndex);
  assert.ok(worldbookToggleIndex < worldbookTitleIndex);
  const worldbookMetaStart = html.indexOf('<div class="bioweave-analysis-worldbook-meta">', worldbookIndex);
  const worldbookMetaEnd = html.indexOf('</div>', worldbookMetaStart);
  const worldbookMeta = html.slice(worldbookMetaStart, worldbookMetaEnd);
  assert.ok(worldbookSummaryEnd < worldbookMetaStart);
  assert.doesNotMatch(worldbookMeta, /<input|data-bioweave-analysis-worldbook-toggle/);
  const worldbookMarkerIndex = html.indexOf('class="bioweave-analysis-disclosure-marker"', worldbookIndex);
  const worldbookNameIndex = html.indexOf('<strong>森林</strong>', worldbookIndex);
  assert.ok(worldbookMarkerIndex >= 0);
  assert.ok(worldbookMarkerIndex < worldbookNameIndex);
  assert.ok(worldbookToggleIndex < worldbookNameIndex);
  const linkedGroupIndex = html.indexOf('附加角色世界书');
  const globalGroupIndex = html.indexOf('当前开启的全局世界书');
  assert.ok(globalGroupIndex < html.indexOf('森林'));
  assert.ok(html.indexOf('森林') < linkedGroupIndex);
  assert.ok(linkedGroupIndex < html.indexOf('角色书'));
  assert.match(html, /data-bioweave-analysis-source-row="st-worldbook:alpha" open/);
  assert.match(html, /条目 A/);
  assert.match(html, /data-bioweave-analysis-entry="entry-1"/);
  assert.match(html, /data-bioweave-analysis-entry="entry-2"/);
  assert.match(html, /data-bioweave-analysis-source-row="st-worldbook:alpha" open/);
  const searchedHtml = settingsPage({
    worldbookSources: {
      sources: [{
        source_id: 'st-worldbook:alpha',
        source_type: 'worldbook',
        scopes: ['global_worldbook'],
        label: '森林',
        entries: [
          {entry_id: 'entry-1', label: '条目 A', token_estimate: 12},
          {entry_id: 'entry-2', label: '条目 B', token_estimate: 5},
        ],
      }],
      visibleSources: [{
        source_id: 'st-worldbook:alpha',
        source_type: 'worldbook',
        scopes: ['global_worldbook'],
        label: '森林',
        entries: [{entry_id: 'entry-1', label: '条目 A', token_estimate: 12}],
      }],
      selected: [{source_id: 'st-worldbook:alpha', entry_id: 'entry-1', enabled: true}],
      search: '条目 A',
      openAnalysisSections: ['worldbook'],
      openWorldbooks: ['st-worldbook:alpha'],
    },
  });
  assert.match(searchedHtml, /data-bioweave-analysis-worldbook-toggle="st-worldbook:alpha"[^>]*aria-checked="mixed"/);
  assert.match(searchedHtml, /class="bioweave-analysis-worldbook-meta">当前开启的全局世界书 · 2 个条目/);
  assert.equal(html.includes('data-bioweave-recent-story-enabled'), false);
  assert.match(html, /data-bioweave-recent-story-floor-count[^>]*value="20"/);
  assert.match(html, /外部记忆来源/);
  assert.equal(html.includes('读取构画数据'), false);
  assert.match(html, /读取 Anima/);
  assert.match(html, /读取柏宝书/);
  assert.match(html, /读取数据库记忆/);
  assert.match(html, /refresh-analysis-sources/);
  assert.match(html, /select-all-analysis-sources/);
  assert.match(html, /select-none-analysis-sources/);
  assert.match(html, /<details class="bioweave-settings-disclosure bioweave-worldbook-source-disclosure"[^>]*data-bioweave-settings-disclosure="worldbook">/);
  assert.match(html, /<summary class="bioweave-settings-summary">[\s\S]*?<strong>世界书来源<\/strong>[\s\S]*?bioweave-settings-summary-arrow/);
  assert.match(html, /data-bioweave-analysis-prompt-settings/);
  assert.match(html, /正则提取与清洗/);
  assert.match(html, /data-bioweave-action="add-recent-story-regex"/);
  assert.equal((html.match(/安全边界/g) || []).length, 0);
  assert.equal(html.includes('Character Card'), false);
  assert.equal(html.includes('Recent Story Context'), false);
  assert.equal(html.includes('SevenDaysCal Context'), false);
  assert.equal(html.includes('Worldbook'), false);
});

test('settings source operations do not render a page notice, while preview errors stay visible', () => {
  const html = settingsPage({
    notice: '设置页顶部瞬时提示。',
    worldbookSources: {
      notice: '世界书来源保存成功。',
      sources: [{
        source_id: 'st-worldbook:toast-check',
        source_type: 'worldbook',
        label: 'Toast 检查书',
        scopes: ['global_worldbook'],
        entries: [{entry_id: 'entry-1', label: '条目一', content: '内容一'}],
      }],
      selected: [],
    },
  });
  const previewHtml = renderAnalysisDebugPopupContent({
    analysisPreview: {error: '分析输入预览读取失败。'},
    documentRef: null,
  });

  assert.match(html, /data-bioweave-analysis-worldbook-toggle="st-worldbook:toast-check"/);
  assert.doesNotMatch(html, /设置页顶部瞬时提示。/);
  assert.doesNotMatch(html, /世界书来源保存成功。/);
  assert.match(previewHtml, /class="bioweave-settings-notice" role="status">分析输入预览读取失败。/);
});

test('settings categories reuse the recent story disclosure shell and right-side arrows', () => {
  const html = settingsPage({
    worldbookSources: {
      openSettingsSections: ['worldbook', 'recent_story', 'external_memory', 'analysis_preview', 'analysis_prompt', 'api', 'assignments'],
    },
  });
  for (const key of ['worldbook', 'recent_story', 'external_memory', 'analysis_prompt', 'api', 'assignments']) {
    assert.match(html, new RegExp('data-bioweave-settings-disclosure="' + key + '"[^>]* open'));
  }
  assert.doesNotMatch(html, /data-bioweave-settings-disclosure="analysis_preview"/);
  assert.match(html, /data-bioweave-action="open-analysis-debug"/);
  for (const label of ['世界书来源', '最近剧情', '外部记忆来源', '高级 / 调试', '分析提示词', 'API 来源', '任务分配']) {
    assert.match(html, new RegExp(label));
  }
  assert.equal((html.match(/class="bioweave-settings-summary-arrow"/g) ?? []).length, 5);
  assert.equal((html.match(/class="bioweave-recent-story-summary-arrow"/g) ?? []).length, 1);
  assert.match(STYLE_SOURCE, /\.bioweave-settings-summary-arrow/);
  assert.match(STYLE_SOURCE, /\.bioweave-settings-disclosure > \.bioweave-card > header/);
});

test('character-card-owned worldbook stays inside the character card section', () => {
  const sources = [{
    source_id: 'st-character-card:alice',
    source_type: 'character_card',
    label: '角色卡',
    fields: [{field_key: 'description', label: '角色描述', content: '描述', token_estimate: 1}],
  }, {
    source_id: 'st-worldbook:card-owned',
    source_type: 'worldbook',
    worldbook_group: 'character_card',
    scopes: ['character_card_worldbook'],
    label: '角色卡内嵌世界书',
    content_loaded: true,
    entries: [{entry_id: 'card-entry', label: '卡内条目', token_estimate: 2}],
  }, {
    source_id: 'st-worldbook:additional',
    source_type: 'worldbook',
    worldbook_group: 'character',
    scopes: ['character_worldbook'],
    label: '附加世界书',
    content_loaded: true,
    entries: [{entry_id: 'additional-entry', label: '附加条目', token_estimate: 2}],
  }];
  const html = settingsPage({
    worldbookSources: {
      sources,
      visibleSources: sources,
      openAnalysisSections: ['character_card', 'worldbook'],
    },
  });
  const characterSectionIndex = html.indexOf('data-bioweave-analysis-section="character_card"');
  const worldbookSectionIndex = html.indexOf('data-bioweave-analysis-section="worldbook"');
  const ownedWorldbookIndex = html.indexOf('data-bioweave-analysis-source-row="st-worldbook:card-owned"');
  const additionalWorldbookIndex = html.indexOf('data-bioweave-analysis-source-row="st-worldbook:additional"');
  const additionalGroupIndex = html.indexOf('附加角色世界书');

  assert.ok(characterSectionIndex >= 0);
  assert.ok(worldbookSectionIndex > characterSectionIndex);
  assert.ok(ownedWorldbookIndex > characterSectionIndex);
  assert.ok(ownedWorldbookIndex < worldbookSectionIndex);
  assert.ok(additionalGroupIndex < additionalWorldbookIndex);
  assert.ok(additionalWorldbookIndex > worldbookSectionIndex);
  assert.match(html, /<strong>角色卡内嵌世界书<\/strong>/);
  assert.match(html, /<strong>附加世界书<\/strong>/);
});

test('settings page renders exactly the three runtime worldbook groups and omits chat-only books', () => {
  const source = (sourceId, label, worldbookGroup) => ({
    source_id: sourceId,
    source_type: 'worldbook',
    worldbook_group: worldbookGroup,
    label,
    available: true,
    content_loaded: true,
    entries: [{entry_id: `${sourceId}-entry`, label: `${label}条目`, token_estimate: 1}],
  });
  const sources = [
    source('st-worldbook:global', '当前全局书', 'selected_global'),
    source('st-worldbook:character', '附加角色书', 'character'),
    source('st-worldbook:other', '其他书', 'other'),
    source('st-worldbook:chat', '聊天书', 'chat'),
    source('st-worldbook:shared', '重叠书', 'selected_global'),
  ];
  const html = settingsPage({
    worldbookSources: {
      sources,
      visibleSources: sources,
      openAnalysisSections: ['worldbook'],
    },
  });
  const globalGroupIndex = html.indexOf('当前开启的全局世界书');
  const characterGroupIndex = html.indexOf('附加角色世界书');
  const otherGroupIndex = html.indexOf('其他世界书');
  assert.ok(globalGroupIndex >= 0);
  assert.ok(characterGroupIndex > globalGroupIndex);
  assert.ok(otherGroupIndex > characterGroupIndex);
  assert.equal(html.includes('角色卡挂载世界书'), false);
  assert.equal(html.includes('聊天书'), false);
  assert.match(html, /<strong>当前全局书<\/strong>/);
  assert.match(html, /<strong>附加角色书<\/strong>/);
  assert.match(html, /<strong>其他书<\/strong>/);
  assert.equal((html.match(/<details class="bioweave-analysis-worldbook" data-bioweave-analysis-source-row="st-worldbook:shared"/g) || []).length, 1);
});

test('external memory settings only report confirmed public provider capabilities', () => {
  const providers = detectExternalMemoryProviders({
    context: {extensionPrompts: {sdc_story_clock: '第 3 天'}},
    globalRef: {
      TavernHelper: {
        getChatWorldbookName() {},
        getWorldbook() {},
      },
      STBaiBaiBook: {
        getInjectedHistory() {},
      },
    },
  });
  assert.deepEqual(providers.map(provider => provider.key), [
    'anima',
    'baobaoshu',
    'database_memory',
  ]);
  assert.equal(providers.find(provider => provider.key === 'anima').available, true);
  assert.equal(providers.find(provider => provider.key === 'baobaoshu').available, true);
  assert.equal(providers.find(provider => provider.key === 'database_memory').available, false);
  assert.equal(providers.find(provider => provider.key === 'anima').content_available, false);
  assert.equal(providers.find(provider => provider.key === 'baobaoshu').content_available, false);
});

test('external memory checkboxes preserve saved unavailable selections and block new ones', () => {
  const html = settingsPage({
    worldbookSources: {
      externalMemory: {anima: true, baobaoshu: false, database_memory: false},
      externalMemoryProviders: [
        {key: 'anima', available: false, status: '未检测到公开世界书读取接口'},
        {key: 'baobaoshu', available: false, status: '未检测到柏宝书公开只读接口'},
        {key: 'database_memory', available: false, status: '未检测到可依赖的公开接口'},
      ],
    },
  });

  const externalMemoryInputs = new Map([...html.matchAll(/<input type="checkbox" data-bioweave-external-memory="([^"]+)"[^>]*>/g)]
    .map(match => [match[1], match[0]]));
  assert.equal(externalMemoryInputs.size, 3);
  assert.match(externalMemoryInputs.get('anima'), / checked>/);
  assert.doesNotMatch(externalMemoryInputs.get('anima'), / disabled/);
  assert.match(externalMemoryInputs.get('baobaoshu'), / disabled>/);
  assert.doesNotMatch(externalMemoryInputs.get('baobaoshu'), / checked/);
  assert.match(externalMemoryInputs.get('database_memory'), / disabled>/);
  assert.doesNotMatch(externalMemoryInputs.get('database_memory'), / checked/);
  assert.match(html, /bioweave-external-memory-option is-unavailable/);
  assert.match(html, /未检测到公开世界书读取接口/);
  assert.match(html, /未检测到柏宝书公开只读接口/);
  assert.match(html, /未检测到可依赖的公开接口/);
});

test('external memory settings keep the undetected prompt for all unavailable sources', () => {
  const html = settingsPage({
    worldbookSources: {
      externalMemoryProviders: [],
    },
  });

  const externalMemoryOptions = html.match(/<label class="bioweave-external-memory-option is-unavailable">[\s\S]*?<\/label>/g) || [];
  assert.equal(externalMemoryOptions.length, 3);
  assert.ok(externalMemoryOptions.every(option => option.includes('未检测到公开接口')));
});

test('external memory checkboxes stay enabled when a public provider has no current content', () => {
  const html = settingsPage({
    worldbookSources: {
      externalMemoryProviders: [
        {key: 'anima', available: true, content_available: false, status: '公开接口存在，但当前 Chat 没有关联世界书来源'},
        {key: 'baobaoshu', available: true, content_available: false, status: '已检测到公开接口，但当前没有可用记录'},
        {key: 'database_memory', available: false, status: '未检测到可依赖的公开接口'},
      ],
    },
  });

  const externalMemoryInputs = new Map([...html.matchAll(/<input type="checkbox" data-bioweave-external-memory="([^"]+)"[^>]*>/g)]
    .map(match => [match[1], match[0]]));
  assert.doesNotMatch(externalMemoryInputs.get('anima'), / disabled/);
  assert.doesNotMatch(externalMemoryInputs.get('baobaoshu'), / disabled/);
  assert.match(externalMemoryInputs.get('database_memory'), / disabled>/);
  assert.match(html, /公开接口存在，但当前 Chat 没有关联世界书来源/);
  assert.match(html, /当前没有可用记录/);
});

test('external memory status reports confirmed public source details without storing content', async () => {
  const providers = await probeExternalMemoryProviders({
    context: {},
    globalRef: {
      TavernHelper: {
        async getChatWorldbookName() {
          return {name: 'Anima 记忆', file_id: 'anima-memory.json'};
        },
        async getWorldbook() {
          return {entries: {
            first: {uid: 'anima-1', content: '不应显示在状态里的正文', extra: {createdBy: 'anima_summary', history: 'history-1'}},
            second: {uid: 'ordinary-2', content: '普通世界书条目'},
          }};
        },
      },
      STBaiBaiBook: {
        getInjectedHistory() {
          return {nodes: [{id: 'node-1'}, {id: 'node-2'}], relativeText: '不应进入状态'};
        },
      },
    },
  });
  const anima = providers.find(provider => provider.key === 'anima');
  const baobaoshu = providers.find(provider => provider.key === 'baobaoshu');
  assert.equal(anima.available, true);
  assert.equal(anima.content_available, true);
  assert.match(anima.status, /Anima 记忆/);
  assert.match(anima.status, /1 个 Anima 摘要条目/);
  assert.doesNotMatch(anima.status, /不应显示在状态里的正文/);
  assert.equal(baobaoshu.available, true);
  assert.equal(baobaoshu.content_available, true);
  assert.match(baobaoshu.status, /STBaiBaiBook\.getInjectedHistory\(\)/);
  assert.match(baobaoshu.status, /未提供文件名/);
  assert.match(baobaoshu.status, /2 条记录/);
  assert.doesNotMatch(baobaoshu.status, /不应进入状态/);
});

test('Anima keeps its public API available when the current memory is missing or unreadable', async () => {
  const cases = [
    {
      name: 'current Chat has no associated worldbook',
      getChatWorldbookName: async () => null,
      getWorldbook: async () => ({entries: []}),
      status: /没有关联世界书来源/,
    },
    {
      name: 'current worldbook is empty',
      getChatWorldbookName: async () => 'empty-worldbook',
      getWorldbook: async () => ({entries: []}),
      status: /未发现 Anima 摘要条目/,
    },
    {
      name: 'current worldbook has no Anima entries',
      getChatWorldbookName: async () => 'ordinary-worldbook',
      getWorldbook: async () => ({entries: [{uid: 'ordinary-1', content: '普通条目'}]}),
      status: /未发现 Anima 摘要条目/,
    },
    {
      name: 'current worldbook read fails',
      getChatWorldbookName: async () => 'unreadable-worldbook',
      getWorldbook: async () => { throw new Error('read failed'); },
      status: /公开接口读取失败/,
    },
    {
      name: 'current worldbook source read fails',
      getChatWorldbookName: async () => { throw new Error('source failed'); },
      getWorldbook: async () => ({entries: []}),
      status: /无法读取当前 Chat 的世界书来源/,
    },
  ];

  for (const scenario of cases) {
    const providers = await probeExternalMemoryProviders({
      context: {},
      globalRef: {
        TavernHelper: {
          getChatWorldbookName: scenario.getChatWorldbookName,
          getWorldbook: scenario.getWorldbook,
        },
      },
    });
    const anima = providers.find(provider => provider.key === 'anima');
    assert.equal(anima.available, true, scenario.name);
    assert.equal(anima.content_available, false, scenario.name);
    assert.match(anima.status, scenario.status, scenario.name);
  }
});

test('BaiBaiBook keeps its public API available when the history is empty or unreadable', async () => {
  const cases = [
    {
      name: 'history is empty',
      getInjectedHistory: async () => [],
      status: /当前没有可用记录/,
    },
    {
      name: 'history is absent',
      getInjectedHistory: async () => undefined,
      status: /当前没有可用记录/,
    },
    {
      name: 'history read fails',
      getInjectedHistory: async () => { throw new Error('read failed'); },
      status: /读取失败/,
    },
  ];

  for (const scenario of cases) {
    const providers = await probeExternalMemoryProviders({
      context: {},
      globalRef: {
        STBaiBaiBook: {getInjectedHistory: scenario.getInjectedHistory},
      },
    });
    const baobaoshu = providers.find(provider => provider.key === 'baobaoshu');
    assert.equal(baobaoshu.available, true, scenario.name);
    assert.equal(baobaoshu.content_available, false, scenario.name);
    assert.match(baobaoshu.status, scenario.status, scenario.name);
  }
});

test('external memory preview adapters expose only public readable content', async () => {
  const providers = await probeExternalMemoryProviders({
    context: {},
    globalRef: {
      TavernHelper: {
        async getChatWorldbookName() {
          return {file_id: 'anima-book', name: 'Anima 记忆'};
        },
        async getWorldbook() {
          return {
            entries: [
              {uid: 1, comment: '摘要一', content: 'Anima 正文', extra: {createdBy: 'anima_summary', history: '不应复制内部对象'}},
              {uid: 2, comment: '普通条目', content: '普通正文', extra: {createdBy: 'other'}},
            ],
          };
        },
      },
      STBaiBaiBook: {
        async getInjectedHistory() {
          return {file_name: '柏宝书记忆', items: [{title: '记录一', content: '柏宝书正文', private_state: '不应出现'}]};
        },
      },
    },
  });
  const anima = providers.find(provider => provider.key === 'anima');
  const baobaoshu = providers.find(provider => provider.key === 'baobaoshu');
  assert.equal(anima.content_available, true);
  assert.deepEqual(anima.items.map(item => item.content), ['Anima 正文']);
  assert.equal(JSON.stringify(anima.items).includes('createdBy'), false);
  assert.equal(baobaoshu.content_available, true);
  assert.deepEqual(baobaoshu.items.map(item => item.content), ['柏宝书正文']);
  assert.equal(JSON.stringify(baobaoshu.items).includes('private_state'), false);
});

test('ordinary current worldbook is not reported as Anima memory', async () => {
  const providers = await probeExternalMemoryProviders({
    context: {},
    globalRef: {
      TavernHelper: {
        async getChatWorldbookName() {
          return 'ordinary-worldbook';
        },
        async getWorldbook() {
          return [{uid: 'ordinary-1', content: '普通条目'}];
        },
      },
    },
  });
  const anima = providers.find(provider => provider.key === 'anima');
  assert.equal(anima.available, true);
  assert.equal(anima.content_available, false);
  assert.match(anima.status, /未发现 Anima 摘要条目/);
});

test('recent story and external memory settings normalize to small Chat-local values', () => {
  assert.equal(normalizeRecentStorySettings({}).floor_count, 4);
  assert.match(settingsPage({worldbookSources: {recentStory: {}}}), /data-bioweave-recent-story-floor-count[^>]*value="4"/);
  assert.deepEqual(normalizeRecentStorySettings({enabled: true, floor_count: 20}), {
    enabled: true,
    floor_count: 20,
    regex_rules: [],
    regex_user_enabled: false,
  });
  assert.deepEqual(normalizeRecentStorySettings({enabled: 'yes', floor_count: 9999}), {
    enabled: true,
    floor_count: 1000,
    regex_rules: [],
    regex_user_enabled: false,
  });
  assert.deepEqual(normalizeRecentStorySettings({enabled: false, floor_count: 0}), {
    enabled: false,
    floor_count: 0,
    regex_rules: [],
    regex_user_enabled: false,
  });
  assert.equal(normalizeRecentStorySettings({enabled: false, floor_count: 20}).enabled, true);
  assert.equal(normalizeRecentStorySettings({regex_user_enabled: true}).regex_user_enabled, true);
  assert.deepEqual(normalizeExtensionSettings({
    recent_story_global: {
      regex_rules: [
        {pattern: '/全局/', type: 'extract', enabled: true},
        {pattern: '', type: 'extract', enabled: true},
      ],
      api_key: 'must-not-enter',
    },
  }).recent_story_global, {
    regex_rules: [{pattern: '/全局/', type: 'extract', enabled: true}],
  });
  assert.deepEqual(normalizeExternalMemorySettings({
    anima: true,
    database_memory: true,
    api_key: 'must-not-enter',
  }), {
    anima: true,
    baobaoshu: false,
    database_memory: true,
  });
});

test('global recent story storage keeps only normalized rules outside Chat data', async () => {
  let extensionSettings = {};
  const profileStore = createApiProfileStore({
    getGlobalSettings: () => extensionSettings,
    saveGlobalSettings: async value => {
      extensionSettings = structuredClone(value);
    },
  }, {secretStore: {}});

  await profileStore.saveRecentStoryGlobal({
    regex_rules: [
      {pattern: '/全局/', type: 'extract', enabled: true},
      {pattern: '', type: 'extract', enabled: true},
    ],
    api_key: 'must-not-enter',
  });

  assert.deepEqual(profileStore.getRecentStoryGlobal(), {
    regex_rules: [{pattern: '/全局/', type: 'extract', enabled: true}],
  });
  assert.equal(JSON.stringify(extensionSettings).includes('must-not-enter'), false);
  assert.deepEqual(Object.keys(extensionSettings.recent_story_global), ['regex_rules']);
});

test('recent story regex rules preserve order and support extraction and cleaning', () => {
  assert.equal(applyRecentStoryRegex('  未配置规则的原文  ', []), '  未配置规则的原文  ');
  assert.equal(
    applyRecentStoryRegex('  已停用规则的原文  ', [{pattern: '/原文/', type: 'extract', enabled: false}]),
    '  已停用规则的原文  ',
  );
  assert.deepEqual(normalizeRecentStorySettings({
    enabled: true,
    regex_rules: [
      {pattern: '/<meta>[\\s\\S]*?<\\/meta>/g', type: 'exclude', enabled: true},
      {pattern: '/<event>(.*?)<\\/event>/g', type: 'extract', enabled: true},
    ],
  }).regex_rules, [
    {pattern: '/<meta>[\\s\\S]*?<\\/meta>/g', type: 'exclude', enabled: true},
    {pattern: '/<event>(.*?)<\\/event>/g', type: 'extract', enabled: true},
  ]);
  assert.equal(
    applyRecentStoryRegex(
      '<meta>内部标记</meta><event>事件一</event>其它<event>事件二</event>',
      [
        {pattern: '/<meta>[\\s\\S]*?<\\/meta>/g', type: 'exclude', enabled: true},
        {pattern: '/<event>(.*?)<\\/event>/g', type: 'extract', enabled: true},
      ],
    ),
    '事件一\n事件二',
  );
  assert.equal(
    applyRecentStoryRegex('事件一 事件二', [{pattern: '/事件\\S+/', type: 'exclude', enabled: true}]),
    '',
  );
  assert.equal(
    applyRecentStoryRegex(
      '日期：2026-09-07\n正文：发生事件\n<debug>内部标记</debug>',
      [
        {pattern: '/日期：([^\\n]+)/', type: 'extract', enabled: true},
        {pattern: '/<debug>[\\s\\S]*?<\\/debug>/', type: 'exclude', enabled: true},
        {pattern: '/正文：([^\\n]+)/', type: 'extract', enabled: true},
      ],
    ),
    '2026-09-07\n发生事件',
  );
});

test('recent story regex processes each floor independently', () => {
  const input = buildAnalysisInput({
    context: {
      chatId: 'chat-regex-floor',
      chat: [
        {floor: 12, role: 'assistant', content: '日期：第一天\n正文：第一楼'},
        {floor: 13, role: 'assistant', content: '日期：第二天\n正文：第二楼'},
      ],
    },
    chatId: 'chat-regex-floor',
    recentStory: {
      enabled: true,
      floor_count: 20,
      regex_rules: [
        {pattern: '/日期：([^\\n]+)/', type: 'extract', enabled: true},
        {pattern: '/正文：([^\\n]+)/', type: 'extract', enabled: true},
      ],
    },
  });
  assert.deepEqual(input.recent_story.items.map(item => item.content), [
    '第一天\n第一楼',
    '第二天\n第二楼',
  ]);
});

test('recent story floor count zero disables reading without an enable switch', () => {
  const input = buildAnalysisInput({
    context: {
      chatId: 'chat-recent-story-disabled-by-count',
      chat: [{floor: 4, role: 'assistant', content: '不应读取的正文'}],
    },
    recentStory: {
      enabled: false,
      floor_count: 0,
    },
  });
  assert.equal(input.recent_story.enabled, false);
  assert.equal(input.recent_story.floor_count, 0);
  assert.deepEqual(input.recent_story.items, []);
});

test('global recent story rules run before current character-card rules', () => {
  const merged = mergeRecentStorySettings(
    {regex_rules: [{pattern: '/<global>(.*?)<\\/global>/', type: 'extract', enabled: true}]},
    {regex_rules: [{pattern: '/<card>(.*?)<\\/card>/', type: 'extract', enabled: true}]},
  );
  assert.deepEqual(merged.regex_rules.map(rule => rule.pattern), [
    '/<global>(.*?)<\\/global>/',
    '/<card>(.*?)<\\/card>/',
  ]);

  const input = buildAnalysisInput({
    context: {
      chatId: 'chat-regex-scope-merge',
      chat: [{floor: 1, role: 'assistant', content: '<global>全局规则</global><card>角色卡规则</card>'}],
    },
    recentStory: {
      enabled: true,
      floor_count: 20,
      regex_rules: [{pattern: '/<card>(.*?)<\\/card>/', type: 'extract', enabled: true}],
    },
    globalRecentStory: {
      regex_rules: [{pattern: '/<global>(.*?)<\\/global>/', type: 'extract', enabled: true}],
    },
  });
  assert.equal(input.recent_story.items[0].content, '全局规则\n角色卡规则');
});

test('recent story regex keeps opening floor raw and skips user floors by default', () => {
  const input = buildAnalysisInput({
    context: {
      chatId: 'chat-regex-scope',
      chat: [
        {floor: 0, role: 'assistant', content: '日期：开场白\n正文：原始开场白'},
        {floor: 1, role: 'user', content: '日期：用户楼\n正文：用户原文'},
        {floor: 2, role: 'assistant', content: '日期：助手楼\n正文：助手正文'},
      ],
    },
    chatId: 'chat-regex-scope',
    recentStory: {
      enabled: true,
      floor_count: 20,
      regex_user_enabled: false,
      regex_rules: [
        {pattern: '/日期：([^\\n]+)/', type: 'extract', enabled: true},
        {pattern: '/正文：([^\\n]+)/', type: 'extract', enabled: true},
      ],
    },
  });
  assert.deepEqual(input.recent_story.items.map(item => item.content), [
    '日期：开场白\n正文：原始开场白',
    '日期：用户楼\n正文：用户原文',
    '助手楼\n助手正文',
  ]);

  const enabledForUser = buildAnalysisInput({
    context: {
      chatId: 'chat-regex-scope-user',
      chat: [{floor: 1, role: 'user', content: '日期：用户楼\n正文：用户原文'}],
    },
    recentStory: {
      enabled: true,
      floor_count: 20,
      regex_user_enabled: true,
      regex_rules: [
        {pattern: '/日期：([^\\n]+)/', type: 'extract', enabled: true},
        {pattern: '/正文：([^\\n]+)/', type: 'extract', enabled: true},
      ],
    },
  });
  assert.deepEqual(enabledForUser.recent_story.items.map(item => item.content), ['用户楼\n用户原文']);
});

test('recent story settings exposes ordered regex rule controls', () => {
  const html = settingsPage({
    worldbookSources: {
      globalRecentStory: {
        regex_rules: [
          {pattern: '/<global>(.*?)<\\/global>/g', type: 'extract', enabled: true},
        ],
      },
      recentStory: {
        enabled: true,
        floor_count: 20,
        regex_rules: [
          {pattern: '/<event>(.*?)<\\/event>/g', type: 'extract', enabled: true},
          {pattern: '/<debug>[\\s\\S]*?<\\/debug>/g', type: 'exclude', enabled: false},
        ],
      },
    },
  });
  assert.equal((html.match(/data-bioweave-recent-story-regex-row/g) ?? []).length, 2);
  assert.match(html, /data-bioweave-recent-story-regex-scope="global"/);
  assert.match(html, /data-bioweave-recent-story-regex-scope="character"/);
  assert.match(html, /全局正则/);
  assert.match(html, /当前角色卡正则/);
  assert.match(html, /&lt;global&gt;/);
  assert.match(html, /&lt;event&gt;/);
  assert.match(html, /<details class="bioweave-settings-disclosure bioweave-recent-story-disclosure"[^>]*data-bioweave-settings-disclosure="recent_story"/);
  assert.match(html, /data-bioweave-recent-story-user-regex/);
  assert.equal((html.match(/role="switch"/g) ?? []).length, 4);
  assert.equal((html.match(/class="bioweave-switch-track"/g) ?? []).length, 4);
  assert.equal((html.match(/class="bioweave-switch-thumb"/g) ?? []).length, 4);
  assert.equal(html.includes('data-bioweave-recent-story-enabled'), false);
  assert.match(html, /class="bioweave-switch-input" type="checkbox"[^>]*data-bioweave-recent-story-user-regex/);
  assert.match(html, /data-bioweave-recent-story-floor-count value="20"/);
  assert.match(html, /type="number" min="0" max="1000"[^>]*data-bioweave-recent-story-floor-count/);
  assert.equal(html.includes('bioweave-recent-story-summary-icon'), false);
  assert.equal(html.includes('bioweave-recent-story-card-icon'), false);
  assert.match(html, /bioweave-recent-story-regex-table-head/);
  assert.equal((html.match(/>#</g) ?? []).length, 2);
  assert.match(html, /bioweave-recent-story-regex-index[^>]*data-label="#">1<\/div>/);
  assert.equal((html.match(/>类型</g) ?? []).length, 2);
  assert.match(html, /data-bioweave-action="move-recent-story-regex-up"/);
  assert.match(html, /data-bioweave-action="move-recent-story-regex-down"/);
  assert.match(html, /data-bioweave-action="remove-recent-story-regex"/);
});

test('recent story regex table keeps a centered header and one-line mobile rows', () => {
  assert.match(STYLE_SOURCE, /\.bioweave-recent-story-regex-table\s*\{[^}]*overflow-x:\s*auto/);
  assert.match(STYLE_SOURCE, /\.bioweave-recent-story-regex-table-head\s*\{[^}]*font-weight:\s*600[^}]*text-align:\s*center/);
  assert.match(STYLE_SOURCE, /\/\* 手机端保持规则表格单行/);
  assert.match(STYLE_SOURCE, /\.bioweave-recent-story-regex-table-head,\s*\.bioweave-recent-story-regex-row\s*\{[^}]*width:\s*100%[^}]*min-width:\s*0[^}]*grid-template-columns:/s);
  assert.match(STYLE_SOURCE, /\.bioweave-recent-story-regex-pattern \.bioweave-input\s*\{[^}]*min-height:\s*32px/);
  assert.match(STYLE_SOURCE, /\.bioweave-recent-story-count\s*\{[^}]*grid-template-columns:\s*auto\s+minmax\(64px,\s*76px\)\s+auto/);
  assert.match(STYLE_SOURCE, /\.bioweave-recent-story-order-action span,\s*\.bioweave-recent-story-delete-action span\s*\{[^}]*display:\s*none/s);
  assert.match(STYLE_SOURCE, /\.bioweave-recent-story-regex-type,\s*\.bioweave-recent-story-regex-pattern,\s*\.bioweave-recent-story-regex-order\s*\{[^}]*align-self:\s*stretch[^}]*min-height:\s*32px/s);
  assert.match(STYLE_SOURCE, /\.bioweave-recent-story-regex-type \.bioweave-select,\s*\.bioweave-recent-story-regex-pattern \.bioweave-input\s*\{[^}]*height:\s*32px[^}]*min-height:\s*32px/s);
  assert.match(STYLE_SOURCE, /\.bioweave-recent-story-regex-type,\s*\.bioweave-recent-story-regex-pattern\s*\{[^}]*display:\s*block[^}]*align-self:\s*stretch[^}]*height:\s*32px/s);
  assert.match(STYLE_SOURCE, /\.bioweave-recent-story-regex-order\s*\{[^}]*flex-direction:\s*column[^}]*gap:\s*0[^}]*height:\s*32px/s);
  assert.match(STYLE_SOURCE, /\.bioweave-recent-story-regex-order \.bioweave-recent-story-order-action\s*\{[^}]*flex:\s*1 1 50%[^}]*width:\s*32px[^}]*align-self:\s*center[^}]*height:\s*auto[^}]*min-height:\s*0/s);
  assert.match(STYLE_SOURCE, /\.bioweave-recent-story-regex-enabled \.bioweave-switch\s*\{[^}]*width:\s*30px/);
  assert.match(STYLE_SOURCE, /\.bioweave-recent-story-regex-enabled \.bioweave-switch\s*\{[^}]*flex:\s*0 0 30px[^}]*margin:\s*0 auto/s);
  assert.match(STYLE_SOURCE, /\.bioweave-recent-story-regex-enabled \.bioweave-switch\s*\{[^}]*position:\s*relative[^}]*left:\s*-4px/s);
  assert.match(STYLE_SOURCE, /\.bioweave-recent-story-regex-enabled \.bioweave-switch-track\s*\{[^}]*flex-basis:\s*30px[^}]*width:\s*30px/);
  assert.match(STYLE_SOURCE, /\.bioweave-recent-story-regex-enabled \.bioweave-switch-track\s*\{[^}]*box-sizing:\s*border-box/);
  assert.match(STYLE_SOURCE, /\.bioweave-recent-story-regex-order \.bioweave-recent-story-order-action,\s*\.bioweave-recent-story-regex-operation \.bioweave-recent-story-delete-action\s*\{[^}]*box-sizing:\s*border-box/s);
  assert.match(STYLE_SOURCE, /@media\s*\(max-width:\s*480px\)[\s\S]*grid-template-columns:\s*20px\s+48px\s+minmax\(44px,\s*1fr\)\s+30px\s+44px\s+30px/);
});

test('recent story regex scopes do not add a second table card layer', () => {
  assert.match(STYLE_SOURCE, /\.bioweave-recent-story-regex-scope\s*\{[^}]*padding:\s*0[^}]*border:\s*0[^}]*background:\s*transparent/s);
  assert.match(STYLE_SOURCE, /\.bioweave-recent-story-regex-table\s*\{[^}]*border:\s*0[^}]*border-radius:\s*0[^}]*background:\s*transparent/s);
  assert.match(STYLE_SOURCE, /\.bioweave-recent-story-regex-list\s*\{[^}]*padding:\s*6px\s+0\s+0/s);
  assert.match(STYLE_SOURCE, /\.bioweave-external-memory-list\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
});

test('analysis input preview keeps only selected character and worldbook content', () => {
  const sources = [
    {
      source_id: 'st-character-card:alice',
      source_type: 'character_card',
      fields: [
        {field_key: 'description', label: '角色描述', content: '角色描述正文'},
        {field_key: 'opening:main', label: '主开场白', content: '主开场白正文', is_current: true},
        {field_key: 'opening:alternate:0', label: '其他开场白 1', content: '备用开场白正文'},
      ],
    },
    {
      source_id: 'st-worldbook:alpha',
      source_type: 'worldbook',
      label: '世界书 Alpha',
      entries: [
        {entry_id: 'entry-1', label: '条目 1', content: '条目一正文'},
        {entry_id: 'entry-2', label: '条目 2', content: '条目二不应出现'},
      ],
    },
  ];
  const input = buildAnalysisInput({
    sources,
    selected: [
      {source_id: 'st-character-card:alice', field_key: 'description', enabled: true},
      {source_id: 'st-character-card:alice', field_key: 'opening:main', enabled: true},
      {source_id: 'st-worldbook:alpha', entry_id: 'entry-1', enabled: true},
    ],
    context: {
      chat: [
        {mes: '旧楼层'},
        {mes: '当前楼层', is_user: true},
      ],
    },
    chatId: 'chat-preview',
    recentStory: {enabled: true, floor_count: 1},
    externalMemory: {},
    externalMemoryProviders: [],
  });

  assert.equal(input.character.description, '角色描述正文');
  assert.deepEqual(input.character.greetings.map(item => item.field_key), ['opening:main']);
  assert.deepEqual(input.worldbooks[0].entries.map(item => item.entry_id), ['entry-1']);
  assert.equal(input.recent_story.items.length, 1);
  assert.equal(input.recent_story.items[0].content, '当前楼层');
  assert.equal(JSON.stringify(input).includes('备用开场白正文'), false);
  assert.equal(JSON.stringify(input).includes('条目二不应出现'), false);
  assert.equal(input.meta.chat_id, 'chat-preview');
  assert.equal(input.token_estimate > 0, true);
});

test('analysis input preview external statuses distinguish disabled, unavailable, and readable content', () => {
  const input = buildAnalysisInput({
    chatId: 'chat-safe',
    externalMemory: {
      anima: true,
      baobaoshu: true,
      database_memory: true,
    },
    externalMemoryProviders: [
      {key: 'anima', label: 'Anima', available: false, content_available: false, status: '未检测到公开接口'},
      {key: 'baobaoshu', label: '柏宝书', available: true, content_available: false, items: [], status: '当前没有记录'},
      {key: 'database_memory', label: '数据库记忆', available: false, content_available: false, status: '未检测到公开接口'},
    ],
  });
  const byKey = new Map(input.external_memory.map(item => [item.key, item]));
  assert.equal(byKey.get('anima').read_status, 'unavailable');
  assert.equal(byKey.get('baobaoshu').read_status, 'empty');
  assert.equal(byKey.get('database_memory').read_status, 'unavailable');
  assert.equal(byKey.get('database_memory').status, '未检测到');
});

test('debug Popup content exposes a temporary analysis input preview without storing raw content', () => {
  const html = renderAnalysisDebugPopupContent({
    analysisPreview: {
      mode: 'structure',
      input: {
        character: {description: '安全正文', greetings: []},
        worldbooks: [],
        recent_story: {enabled: false, items: []},
        external_memory: [],
        meta: {chat_id: 'chat-preview'},
        token_estimate: 3,
      },
    },
    worldbookSources: {openSettingsSections: []},
    documentRef: null,
  });
  assert.match(html, /高级 \/ 调试/);
  assert.match(html, /分析输入预览/);
  assert.match(html, /结构预览/);
  assert.match(html, /原始内容/);
  assert.match(html, /安全正文/);
  assert.equal(html.includes('data-bioweave-settings-disclosure="analysis_preview" open'), false);
});

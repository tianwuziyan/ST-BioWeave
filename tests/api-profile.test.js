import test from 'node:test';
import assert from 'node:assert/strict';
import {callOpenAICompatible, fetchModels, safeErrorSummary, testProfile} from '../ai/client.js';
import {
  BIOWEAVE_INDEPENDENT_API,
  FOLLOW_DEFAULT_API,
  SILLYTAVERN_CURRENT_API,
  emptyChat,
  normalizeExtensionSettings,
} from '../storage/schema.js';
import {createApiProfileStore, createSecretStore} from '../storage/store.js';
import {closeModelPicker} from '../ui/app.js';
import {settingsPage} from '../ui/settings.js';

test('global profile normalization removes API key values and emptyChat stays chat-local', () => {
  const settings = normalizeExtensionSettings({
    api_profiles: {
      stable: {
        profile_id: 'stable',
        name: 'Stable',
        provider: 'OpenAI-compatible',
        api_url: 'https://api.example/v1',
        model: 'model-a',
        api_key: 'DO-NOT-PERSIST',
        nested: {apiKey: 'ALSO-DO-NOT-PERSIST'},
        secret_ref: 'secret-id-1',
      },
    },
    assignments: {world_analysis: 'stable'},
  });

  assert.equal(settings.api_profiles.stable.api_key, undefined);
  assert.equal(settings.api_profiles.stable.nested, undefined);
  assert.equal(settings.api_profiles.stable.secret_ref, 'secret-id-1');
  assert.equal(settings.assignments.world_analysis, 'stable');
  assert.equal(JSON.stringify(settings).includes('DO-NOT-PERSIST'), false);
  assert.equal('api_profiles' in emptyChat('chat-a'), false);
});

test('profile URL normalization strips completion suffixes and rejects URL credentials', () => {
  const normalized = normalizeExtensionSettings({
    api_profiles: {
      safe: {api_url: 'https://api.example/v1/chat/completions/', model: 'model-a'},
      unsafe: {api_url: 'https://user:password@api.example/v1', model: 'model-b'},
      query: {api_url: 'https://api.example/v1?api_key=DO-NOT-PERSIST', model: 'model-c'},
      nestedQuery: {api_url: 'https://api.example/v1?redirect=Bearer%20DO-NOT-PERSIST', model: 'model-d'},
      ordinaryQuery: {api_url: 'https://api.example/v1?region=global', model: 'model-e'},
      malformed: {api_url: 'not a URL', model: 'model-e'},
    },
  });
  assert.equal(normalized.api_profiles.safe.api_url, 'https://api.example/v1');
  assert.equal(normalized.api_profiles.unsafe.api_url, '');
  assert.equal(normalized.api_profiles.query.api_url, '');
  assert.equal(normalized.api_profiles.nestedQuery.api_url, '');
  assert.equal(normalized.api_profiles.ordinaryQuery.api_url, '');
  assert.equal(normalized.api_profiles.malformed.api_url, '');
  assert.equal(JSON.stringify(normalized).includes('DO-NOT-PERSIST'), false);
});

test('profile secret lifecycle preserves, replaces, clears, and deletes references safely', async () => {
  let globalSettings = {};
  let nextSecret = 0;
  const secretCalls = [];
  const profileStore = createApiProfileStore({
    getGlobalSettings: () => globalSettings,
    saveGlobalSettings: async value => {
      globalSettings = structuredClone(value);
    },
  }, {
    secretStore: {
      async write(value, ...labelArgs) {
        secretCalls.push(['write', value, ...labelArgs]);
        nextSecret += 1;
        return `secret-${nextSecret}`;
      },
      async remove(reference) {
        secretCalls.push(['remove', reference]);
      },
    },
  });

  const first = await profileStore.saveProfile({
    profile_id: 'profile-a',
    name: 'Primary',
    provider: 'custom',
    api_url: 'https://api.example/v1',
    model: 'model-a',
    api_key: 'FIRST-KEY',
  });
  assert.equal(first.secret_ref, 'secret-1');
  assert.equal(JSON.stringify(globalSettings).includes('FIRST-KEY'), false);

  const retained = await profileStore.saveProfile({
    ...first,
    api_key: '',
  });
  assert.equal(retained.secret_ref, 'secret-1');
  assert.deepEqual(secretCalls, [['write', 'FIRST-KEY']]);

  const replaced = await profileStore.saveProfile({
    ...first,
    api_key: 'SECOND-KEY',
  });
  assert.equal(replaced.secret_ref, 'secret-2');
  assert.equal(JSON.stringify(globalSettings).includes('SECOND-KEY'), false);
  assert.deepEqual(secretCalls.at(-1), ['remove', 'secret-1']);

  await profileStore.setAssignment('world_analysis', 'profile-a');
  assert.equal(profileStore.getAssignment('world_analysis'), 'profile-a');
  await profileStore.saveProfile({...replaced, clear_secret: true});
  assert.equal(profileStore.getProfile('profile-a').secret_ref, null);
  assert.deepEqual(secretCalls.at(-1), ['remove', 'secret-2']);

  await profileStore.deleteProfile('profile-a');
  assert.equal(profileStore.getProfile('profile-a'), null);
  assert.equal(profileStore.getAssignment('world_analysis'), null);
});

test('profile test uses a temporary secret and source settings stay global', async () => {
  let globalSettings = {
    api_profiles: {
      stable: {
        profile_id: 'stable',
        name: 'Stable',
        api_url: 'https://api.example/v1',
        model: 'model-a',
      },
    },
  };
  const secretCalls = [];
  const profileStore = createApiProfileStore({
    getGlobalSettings: () => globalSettings,
    saveGlobalSettings: async value => {
      globalSettings = structuredClone(value);
    },
  }, {
    secretStore: {
      async write(value) {
        secretCalls.push(['write', value]);
        return 'temporary-secret';
      },
      async remove(reference) {
        secretCalls.push(['remove', reference]);
      },
    },
  });

  let testedProfile;
  await profileStore.withTestProfile({
    profile_id: 'stable',
    api_url: 'https://api.example/v1',
    model: 'draft-model',
    api_key: 'TEMPORARY-KEY',
  }, async profile => {
    testedProfile = profile;
    assert.equal(profile.secret_ref, 'temporary-secret');
    assert.equal('api_key' in profile, false);
  });

  assert.deepEqual(secretCalls, [['write', 'TEMPORARY-KEY'], ['remove', 'temporary-secret']]);
  assert.equal(JSON.stringify(globalSettings).includes('TEMPORARY-KEY'), false);
  assert.equal(globalSettings.api_profiles.stable.model, 'model-a');

  assert.equal(await profileStore.setApiSource(BIOWEAVE_INDEPENDENT_API), BIOWEAVE_INDEPENDENT_API);
  assert.equal(await profileStore.setDefaultProfile('stable'), 'stable');
  assert.equal(await profileStore.setAssignment('world_analysis', FOLLOW_DEFAULT_API), FOLLOW_DEFAULT_API);
  assert.equal(profileStore.getSettings().api_source, BIOWEAVE_INDEPENDENT_API);
  assert.equal(profileStore.getSettings().default_profile_id, 'stable');
  assert.equal(profileStore.getAssignment('world_analysis'), FOLLOW_DEFAULT_API);
  assert.equal(testedProfile.model, 'draft-model');
});

test('model discovery can use a temporary secret before a model is selected', async () => {
  const secretCalls = [];
  const profileStore = createApiProfileStore({
    getGlobalSettings: () => ({}),
    saveGlobalSettings: async () => {},
  }, {
    secretStore: {
      async write(value) {
        secretCalls.push(['write', value]);
        return 'temporary-model-secret';
      },
      async remove(reference) {
        secretCalls.push(['remove', reference]);
      },
    },
  });

  await profileStore.withTestProfile({
    api_url: 'https://api.example/v1',
    api_key: 'MODEL-LIST-KEY',
  }, profile => {
    assert.equal(profile.model, '');
    assert.equal(profile.secret_ref, 'temporary-model-secret');
  }, {requireModel: false});

  assert.deepEqual(secretCalls, [
    ['write', 'MODEL-LIST-KEY'],
    ['remove', 'temporary-model-secret'],
  ]);
});

test('secret cleanup failures are surfaced without restoring a stale profile reference', async () => {
  let globalSettings = {};
  let nextSecret = 0;
  const profileStore = createApiProfileStore({
    getGlobalSettings: () => globalSettings,
    saveGlobalSettings: async value => {
      globalSettings = structuredClone(value);
    },
  }, {
    secretStore: {
      async write() {
        nextSecret += 1;
        return `secret-${nextSecret}`;
      },
      async remove() {
        throw new Error('raw secret-store failure');
      },
    },
  });

  const first = await profileStore.saveProfile({
    profile_id: 'profile-a',
    api_url: 'https://api.example/v1',
    model: 'model-a',
    api_key: 'FIRST-KEY',
  });
  await assert.rejects(
    profileStore.saveProfile({...first, api_key: 'SECOND-KEY'}),
    /ST_SECRET_DELETE_FAILED/,
  );
  assert.equal(profileStore.getProfile('profile-a').secret_ref, 'secret-2');

  await assert.rejects(profileStore.deleteProfile('profile-a'), /ST_SECRET_DELETE_FAILED/);
  assert.equal(profileStore.getProfile('profile-a'), null);
});

test('invalid profiles do not write a new secret or global settings', async () => {
  let saved = 0;
  let globalSettings = {};
  const profileStore = createApiProfileStore({
    getGlobalSettings: () => globalSettings,
    saveGlobalSettings: async value => {
      saved += 1;
      globalSettings = value;
    },
  }, {
    secretStore: {
      async write() {
        throw new Error('secret write must not happen');
      },
    },
  });

  await assert.rejects(
    profileStore.saveProfile({name: 'Incomplete', api_key: 'DO-NOT-WRITE'}),
    /API_PROFILE_INVALID/,
  );
  assert.equal(saved, 0);
  assert.deepEqual(globalSettings, {});
});

test('secret HTTP boundary only writes/deletes and never reads secret values', async () => {
  const requests = [];
  const secretStore = createSecretStore({
    fetchRef: async (url, options) => {
      requests.push({url, options});
      return {
        ok: true,
        async json() {
          return {id: 'opaque-secret-id'};
        },
      };
    },
  });

  assert.equal(await secretStore.write('KEY-VALUE', 'BioWeave'), 'opaque-secret-id');
  assert.equal(await secretStore.remove('opaque-secret-id'), true);
  assert.deepEqual(requests.map(request => request.url), ['/api/secrets/write', '/api/secrets/delete']);
  assert.equal(JSON.parse(requests[0].options.body).key, 'api_key_custom');
  assert.equal(JSON.parse(requests[1].options.body).key, 'api_key_custom');
  assert.equal(JSON.parse(requests[0].options.body).value, 'KEY-VALUE');
  assert.equal(JSON.parse(requests[1].options.body).id, 'opaque-secret-id');
  assert.throws(() => secretStore.get(), /ST_SECRET_READ_DISABLED/);
});

test('client uses SillyTavern host APIs and returns safe connection failures', async () => {
  const calls = [];
  const context = {
    ChatCompletionService: {
      async processRequest(payload, options, extractData, signal) {
        calls.push({payload, options, extractData, signal});
        return {content: 'OK'};
      },
    },
  };
  const result = await testProfile({
    profile_id: 'profile-a',
    api_url: 'https://api.example/v1/chat/completions',
    model: 'model-a',
    secret_ref: 'opaque-secret-id',
    api_key: 'SHOULD-NOT-REACH-CLIENT-RESULT',
  }, {context, retryCount: 0});

  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].payload.chat_completion_source, 'custom');
  assert.equal(calls[0].payload.custom_url, 'https://api.example/v1');
  assert.equal(calls[0].payload.secret_id, 'opaque-secret-id');
  assert.equal('api_key' in calls[0].payload, false);

  await testProfile({
    api_url: 'https://api.example/v1',
    model: 'model-a',
  }, {
    retryCount: 0,
    context: {
      ChatCompletionService: {
        async processRequest(payload) {
          calls.push({payload});
          return {content: 'OK'};
        },
      },
    },
  });
  assert.equal(calls.at(-1).payload.secret_id, '__bioweave_no_secret__');

  const failingResult = await testProfile({
    api_url: 'https://api.example/v1',
    model: 'model-a',
    secret_ref: 'opaque-secret-id',
  }, {
    retryCount: 0,
    context: {
      ChatCompletionService: {
        async processRequest() {
          const error = new Error('Bearer SHOULD-NOT-BE-SHOWN');
          error.status = 401;
          throw error;
        },
      },
    },
  });
  assert.equal(failingResult.ok, false);
  assert.equal(failingResult.http_status, 401);
  assert.equal(failingResult.error.includes('SHOULD-NOT-BE-SHOWN'), false);
});

test('current API connection test uses generateRaw without copying a host key', async () => {
  let rawOptions;
  const result = await testProfile(SILLYTAVERN_CURRENT_API, {
    retryCount: 0,
    context: {
      async generateRaw(options) {
        rawOptions = options;
        return 'OK';
      },
      getChatCompletionModel: () => 'current-model',
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.model, 'current-model');
  assert.equal(Array.isArray(rawOptions.prompt), true);
  assert.equal('api_key' in rawOptions, false);
});

test('current API world analysis does not pass an unsupported abort signal to generateRaw', async () => {
  let rawOptions;
  const result = await callOpenAICompatible(SILLYTAVERN_CURRENT_API, [{role: 'user', content: '测试'}], {
    retryCount: 0,
    context: {
      async generateRaw(options) {
        rawOptions = options;
        return 'OK';
      },
    },
  });
  assert.equal(result, 'OK');
  assert.equal('signal' in rawOptions, false);
});

test('host abort variants are normalized without exposing the raw aborted message', async () => {
  await assert.rejects(
    callOpenAICompatible(SILLYTAVERN_CURRENT_API, [{role: 'user', content: '测试'}], {
      retryCount: 0,
      context: {
        async generateRaw() {
          throw new Error('aborted');
        },
      },
    }),
    error => error?.code === 'REQUEST_ABORTED',
  );
  assert.equal(safeErrorSummary(new Error('aborted')), '请求已取消');
});

test('model refresh uses the SillyTavern custom status endpoint with only an opaque secret reference', async () => {
  let request;
  const models = await fetchModels({
    api_url: 'https://api.example/v1/chat/completions',
    secret_ref: 'opaque-secret-id',
    retry_count: 0,
  }, {
    context: {
      getRequestHeaders: () => ({'X-CSRF-Token': 'csrf-token'}),
    },
    fetchRef: async (url, options) => {
      request = {url, options};
      return {
        ok: true,
        status: 200,
        async json() {
          return {data: [{id: 'model-b'}, {id: 'model-a'}, {id: 'model-a'}]};
        },
      };
    },
  });

  assert.deepEqual(models, ['model-a', 'model-b']);
  assert.equal(request.url, '/api/backends/chat-completions/status');
  assert.equal(request.options.headers['X-CSRF-Token'], 'csrf-token');
  const body = JSON.parse(request.options.body);
  assert.deepEqual(body, {
    chat_completion_source: 'custom',
    custom_url: 'https://api.example/v1',
    secret_id: 'opaque-secret-id',
  });
  assert.equal(JSON.stringify(body).includes('api_key'), false);
});

test('model refresh failures are safe and do not expose upstream error text', async () => {
  await assert.rejects(
    fetchModels({
      api_url: 'https://api.example/v1',
      secret_ref: 'opaque-secret-id',
      retry_count: 0,
    }, {
      fetchRef: async () => ({
        ok: false,
        status: 401,
        statusText: 'Bearer DO-NOT-SHOW',
        async json() {
          return {error: 'Bearer DO-NOT-SHOW'};
        },
      }),
    }),
    error => {
      assert.equal(error.code, 'API_MODELS_HTTP_ERROR');
      assert.equal(error.message.includes('DO-NOT-SHOW'), false);
      return true;
    },
  );
});

test('settings markup exposes basic API fields, assignments, password input, and safe result text', () => {
  const html = settingsPage({
    profiles: {
      stable: {
        profile_id: 'stable',
        name: 'Stable',
        provider: 'custom',
        api_url: 'https://api.example/v1',
        model: 'model-a',
        secret_ref: 'opaque-secret-id',
      },
    },
    assignments: {world_analysis: 'stable'},
    editingProfile: {
      profile_id: 'stable',
      name: 'Stable',
      provider: 'custom',
      api_url: 'https://api.example/v1',
      model: 'model-a',
      secret_ref: 'opaque-secret-id',
      api_key: 'NOT-IN-MARKUP',
    },
    testResult: {ok: false, error: '认证失败（HTTP 401）'},
  });

  for (const field of ['name', 'provider', 'api_url', 'model']) {
    assert.match(html, new RegExp(`name="${field}"`));
  }
  for (const field of ['context_size', 'max_output_tokens', 'temperature', 'timeout', 'retry_count']) {
    assert.doesNotMatch(html, new RegExp(`name="${field}"`));
  }
  assert.equal(html.includes('bioweave-settings-advanced'), false);
  assert.match(html, /name="api_key" type="password" value=""/);
  for (const slot of ['world_analysis', 'event_analysis', 'projection', 'history_scan']) {
    assert.match(html, new RegExp(`data-bioweave-assignment="${slot}"`));
  }
  assert.match(html, /使用 SillyTavern 当前 API/);
  assert.equal(html.includes('NOT-IN-MARKUP'), false);
});

test('settings markup renders the current draft without advanced API controls', () => {
  const html = settingsPage({
    apiSource: BIOWEAVE_INDEPENDENT_API,
    defaultProfileId: 'stable',
    profiles: {
      stable: {
        profile_id: 'stable',
        name: 'Stable',
        api_url: 'https://api.example/v1',
        model: 'saved-model',
        secret_ref: 'opaque-secret-id',
      },
    },
    assignments: {world_analysis: FOLLOW_DEFAULT_API},
    editingProfile: {profile_id: 'stable', secret_ref: 'opaque-secret-id'},
    editingDraft: {
      profile_id: 'stable',
      name: 'Draft Name',
      provider: 'Draft Provider',
      api_url: 'https://draft.example/v1',
      model: 'draft-model',
      context_size: '12345',
      max_output_tokens: '678',
      temperature: '0.7',
      timeout: '45000',
      retry_count: '2',
      api_key: 'DRAFT-KEY',
    },
  });

  assert.match(html, /value="Draft Name"/);
  assert.match(html, /value="https:\/\/draft\.example\/v1"/);
  assert.match(html, /value="draft-model"/);
  assert.match(html, /name="api_key" type="password" value="DRAFT-KEY"/);
  assert.match(html, /value="default" selected/);
  assert.match(html, /value="bioweave"[^>]*checked/);
  assert.equal(html.includes('bioweave-settings-advanced'), false);
  assert.equal(html.includes('Context Size'), false);
  assert.equal(html.includes('Max Output Tokens'), false);
  assert.equal(html.includes('Retry Count'), false);
});

test('independent API configuration is a Chinese disclosure nested inside API source', () => {
  const html = settingsPage({
    profiles: {
      stable: {
        profile_id: 'stable',
        name: 'Stable',
        api_url: 'https://api.example/v1',
        model: 'model-a',
        secret_ref: 'opaque-secret-id',
      },
    },
  });
  const apiDisclosureIndex = html.indexOf('<details class="bioweave-settings-disclosure bioweave-api-source-disclosure"');
  const apiSourceIndex = html.indexOf('<section class="bioweave-card bioweave-api-source">');
  const profilesIndex = html.indexOf('<details class="bioweave-api-profiles">');
  const assignmentsIndex = html.indexOf('<section class="bioweave-card bioweave-assignments">');

  assert.ok(apiDisclosureIndex >= 0);
  assert.ok(apiSourceIndex > apiDisclosureIndex);
  assert.ok(profilesIndex > apiSourceIndex);
  assert.ok(assignmentsIndex > profilesIndex);
  assert.match(html, /<summary>独立 API 配置<\/summary>/);
  assert.match(html, /data-bioweave-action="new-profile"[^>]*>新建 API 配置<\/button>/);
  assert.match(html, /bioweave-api-security-note/);
  assert.equal(html.includes('安全边界'), false);
  assert.equal(html.includes('<details class="bioweave-settings-disclosure bioweave-api-source-disclosure" data-bioweave-settings-disclosure="api" open>'), false);
  assert.equal(html.includes('独立 API Profiles'), false);
});

test('world analysis prompt settings expose editable blocks without segment-name controls or secrets', () => {
  const html = settingsPage({
    worldAnalysisPrompt: {
      task: '只检查能力证据',
      input_prefix: '这是可编辑前言',
      input_suffix: '这是可编辑后记',
      labels: {character: '角色资料'},
    },
  });
  assert.match(html, /世界分析提示词/);
  assert.doesNotMatch(html, /世界分析提示词与标签/);
  assert.match(html, /data-bioweave-world-analysis-prompt-field="task"[^>]*>只检查能力证据/);
  assert.equal(html.includes('输入分段名称'), false);
  assert.equal(html.includes('data-bioweave-world-analysis-label'), false);
  assert.match(html, /data-bioweave-action="save-world-analysis-prompt"/);
  assert.equal(html.includes('api_key'), false);
});

test('world analysis prompt draft remains visible after a failed save render', () => {
  const html = settingsPage({
    worldAnalysisPrompt: {task: '已保存内容'},
    worldAnalysisPromptDraft: {task: '当前编辑内容'},
  });
  assert.match(html, /data-bioweave-world-analysis-prompt-field="task"[^>]*>当前编辑内容/);
  assert.doesNotMatch(html, /data-bioweave-world-analysis-prompt-field="task"[^>]*>已保存内容/);
});

test('world analysis prompt settings persist as global editable text only', async () => {
  let globalSettings = {};
  const profileStore = createApiProfileStore({
    getGlobalSettings: () => globalSettings,
    async saveGlobalSettings(value) {
      globalSettings = value;
    },
  });
  const saved = await profileStore.saveWorldAnalysisPrompt({
    task: '只分析输入证据',
    input_prefix: '自定义前言',
    input_suffix: '',
    labels: {character: '角色资料'},
    api_key: 'NEVER-PERSIST',
  });
  assert.equal(saved.task, '只分析输入证据');
  assert.equal(saved.input_prefix, '自定义前言');
  assert.equal(saved.labels.character, '角色资料');
  assert.equal(JSON.stringify(globalSettings).includes('NEVER-PERSIST'), false);
  assert.equal(profileStore.getWorldAnalysisPrompt().task, '只分析输入证据');
});

test('model picker keeps its list temporary and closes after selection', () => {
  const html = settingsPage({
    editingProfile: {profile_id: 'stable'},
    editingDraft: {profile_id: 'stable', model: 'model-a'},
    modelList: ['model-a', 'model-b'],
    modelListProfileKey: 'stable',
  });
  assert.equal(html.includes('data-bioweave-model-details'), false);
  assert.match(html, /模型.*data-bioweave-model-trigger/);
  assert.match(html, /data-bioweave-model-trigger[^>]*aria-expanded="false"/);
  assert.match(html, /data-bioweave-model-trigger[^>]*aria-controls="bioweave-model-dropdown"/);
  assert.match(html, /data-bioweave-model-dropdown[^>]* hidden/);
  assert.match(html, /data-bioweave-action="refresh-models"/);
  assert.ok(html.indexOf('data-bioweave-action="refresh-models"') < html.indexOf('data-bioweave-model-dropdown'));
  assert.match(html, />刷新模型</);
  assert.match(html, /data-bioweave-model-search/);
  assert.match(html, /搜索模型/);
  assert.match(html, /data-bioweave-model-item/);
  assert.match(html, /model-b/);

  const dropdown = {hidden: false};
  const trigger = {
    ariaExpanded: null,
    setAttribute(name, value) {
      if (name === 'aria-expanded') this.ariaExpanded = value;
    },
  };
  const picker = {
    querySelector(selector) {
      if (selector === '[data-bioweave-model-dropdown]') return dropdown;
      if (selector === '[data-bioweave-model-trigger]') return trigger;
      return null;
    },
  };
  const modelItem = {
    closest(selector) {
      assert.equal(selector, '[data-bioweave-model-picker]');
      return picker;
    },
  };

  assert.equal(closeModelPicker(modelItem), true);
  assert.equal(dropdown.hidden, true);
  assert.equal(trigger.ariaExpanded, 'false');
});

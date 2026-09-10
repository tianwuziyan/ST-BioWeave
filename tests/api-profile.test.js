import test from 'node:test';
import assert from 'node:assert/strict';
import {callOpenAICompatible, fetchModels, safeErrorSummary, testProfile} from '../ai/client.js';
import {createAnalyzer} from '../ai/analyzer.js';
import {
  BIOWEAVE_INDEPENDENT_API,
  DEFAULT_API_REQUEST_SETTINGS,
  FOLLOW_DEFAULT_API,
  SILLYTAVERN_CURRENT_API,
  emptyChat,
  normalizeExtensionSettings,
  normalizeApiRequestSettings,
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
        timeout: 30000,
        retry_count: 0,
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
  assert.equal('timeout' in settings.api_profiles.stable, false);
  assert.equal('retry_count' in settings.api_profiles.stable, false);
  assert.deepEqual(settings.api_request_settings, DEFAULT_API_REQUEST_SETTINGS);
  assert.equal(settings.assignments.world_analysis, 'stable');
  assert.equal(JSON.stringify(settings).includes('DO-NOT-PERSIST'), false);
  assert.equal('api_profiles' in emptyChat('chat-a'), false);
});

test('global API request settings normalize and round-trip without Chat storage', async () => {
  assert.deepEqual(normalizeApiRequestSettings(), DEFAULT_API_REQUEST_SETTINGS);
  assert.deepEqual(normalizeApiRequestSettings({timeout: 45000, retry_count: 2}), {
    timeout: 45000,
    retry_count: 2,
  });

  let globalSettings = {};
  let chatWrites = 0;
  const profileStore = createApiProfileStore({
    getGlobalSettings: () => globalSettings,
    saveGlobalSettings: async value => {
      globalSettings = structuredClone(value);
    },
    saveChatMetadata: async () => {
      chatWrites += 1;
    },
  });

  assert.deepEqual(profileStore.getApiRequestSettings(), DEFAULT_API_REQUEST_SETTINGS);
  const saved = await profileStore.saveApiRequestSettings({timeout: 45000, retry_count: 2});
  assert.deepEqual(saved, {timeout: 45000, retry_count: 2});
  assert.deepEqual(profileStore.getApiRequestSettings(), saved);
  assert.deepEqual(globalSettings.api_request_settings, saved);
  assert.equal(chatWrites, 0);
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
  }, {context, requestSettings: {retry_count: 0}});

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
    requestSettings: {retry_count: 0},
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
    requestSettings: {retry_count: 0},
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

test('client request settings override legacy Profile timeout and retry fields', async () => {
  let requestCalls = 0;
  await assert.rejects(
    callOpenAICompatible({
      api_url: 'https://api.example/v1',
      model: 'model-a',
      timeout: 30000,
      retry_count: 0,
    }, [{role: 'user', content: '测试'}], {
      requestSettings: {timeout: 250, retry_count: 1},
      context: {
        ChatCompletionService: {
          async processRequest(_payload, _options, _extractData, signal) {
            requestCalls += 1;
            await new Promise((_resolve, reject) => {
              signal.addEventListener('abort', () => reject(new TypeError('Failed to fetch')), {once: true});
            });
          },
        },
      },
    }),
    error => error?.code === 'REQUEST_TIMEOUT',
  );
  // 超时不是可重试错误；旧 Profile 的 30000 也不应成为请求来源。
  assert.equal(requestCalls, 1);
});

test('World Model analyzer forwards request settings from its resolver', async () => {
  let requestCalls = 0;
  const analyzer = createAnalyzer({
    profileResolver: () => ({
      api_url: 'https://api.example/v1',
      model: 'model-a',
      timeout: 30000,
      retry_count: 1,
    }),
    requestSettingsResolver: () => ({timeout: 180000, retry_count: 0}),
    contextResolver: () => ({
      ChatCompletionService: {
        async processRequest() {
          requestCalls += 1;
          const error = new Error('temporary server failure');
          error.status = 503;
          throw error;
        },
      },
    }),
  });

  await assert.rejects(analyzer.analyzeWorldModel({analysisInput: {}}), error => error?.status === 503);
  assert.equal(requestCalls, 1);
});

test('current API connection test uses generateRaw without copying a host key', async () => {
  let rawOptions;
  const result = await testProfile(SILLYTAVERN_CURRENT_API, {
    requestSettings: {retry_count: 0},
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
    requestSettings: {retry_count: 0},
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

test('current API prefers the host chat completion service over generateRaw lifecycle hooks', async () => {
  let generateRawCalls = 0;
  let requestCalls = 0;
  let request;
  const result = await callOpenAICompatible(SILLYTAVERN_CURRENT_API, [
    {role: 'system', content: '系统约束'},
    {role: 'assistant', content: '楼层资料'},
    {role: 'user', content: '开始分析'},
  ], {
    requestSettings: {retry_count: 0},
    context: {
      chatCompletionSettings: {
        chat_completion_source: 'openai',
        openai_max_tokens: 1200,
        temp_openai: 0.2,
      },
      getChatCompletionModel: () => 'current-model',
      async generateRaw() {
        generateRawCalls += 1;
        throw new DOMException('The operation was aborted.', 'AbortError');
      },
      ChatCompletionService: {
        async processRequest(payload, _options, extractData, signal) {
          requestCalls += 1;
          request = {payload, extractData, signal};
          return {content: 'OK'};
        },
      },
    },
  });

  assert.deepEqual(result, {content: 'OK'});
  assert.equal(generateRawCalls, 0);
  assert.equal(requestCalls, 1);
  assert.equal(request.payload.stream, false);
  assert.equal(request.payload.model, 'current-model');
  assert.equal(request.payload.chat_completion_source, 'openai');
  assert.equal(request.payload.max_tokens, 1200);
  assert.deepEqual(request.payload.messages, [
    {role: 'system', content: '系统约束'},
    {role: 'assistant', content: '楼层资料'},
    {role: 'user', content: '开始分析'},
  ]);
  assert.equal(request.extractData, true);
  assert.equal(request.signal?.aborted, false);
});

test('current API abort does not trigger an automatic second request', async () => {
  let requestCalls = 0;
  await assert.rejects(
    callOpenAICompatible(SILLYTAVERN_CURRENT_API, [{role: 'user', content: '测试'}], {
      requestSettings: {retry_count: 1},
      context: {
        chatCompletionSettings: {chat_completion_source: 'openai', openai_max_tokens: 1200},
        getChatCompletionModel: () => 'current-model',
        ChatCompletionService: {
          async processRequest() {
            requestCalls += 1;
            throw new DOMException('The operation was aborted.', 'AbortError');
          },
        },
      },
    }),
    error => error?.code === 'REQUEST_ABORTED',
  );
  assert.equal(requestCalls, 1);
});

test('current API caller abort does not trigger an automatic second request', async () => {
  const controller = new AbortController();
  let requestCalls = 0;
  const request = callOpenAICompatible(SILLYTAVERN_CURRENT_API, [{role: 'user', content: '测试'}], {
    requestSettings: {retry_count: 1},
    signal: controller.signal,
    context: {
      chatCompletionSettings: {chat_completion_source: 'openai', openai_max_tokens: 1200},
      getChatCompletionModel: () => 'current-model',
      ChatCompletionService: {
        async processRequest(_payload, _options, _extractData, signal) {
          requestCalls += 1;
          await new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')), {once: true});
          });
        },
      },
    },
  });
  await new Promise(resolve => setImmediate(resolve));
  controller.abort();

  await assert.rejects(request, error => error?.code === 'REQUEST_ABORTED');
  assert.equal(requestCalls, 1);
});

test('current API timeout-induced internal abort does not trigger an automatic second request', async () => {
  let requestCalls = 0;
  await assert.rejects(
    callOpenAICompatible(SILLYTAVERN_CURRENT_API, [{role: 'user', content: '测试'}], {
      requestSettings: {timeout: 250, retry_count: 1},
      context: {
        chatCompletionSettings: {chat_completion_source: 'openai', openai_max_tokens: 1200},
        getChatCompletionModel: () => 'current-model',
        ChatCompletionService: {
          async processRequest(_payload, _options, _extractData, signal) {
            requestCalls += 1;
            await new Promise((_resolve, reject) => {
              signal.addEventListener('abort', () => reject(new TypeError('Failed to fetch')), {once: true});
            });
          },
        },
      },
    }),
    error => error?.code === 'REQUEST_TIMEOUT',
  );
  assert.equal(requestCalls, 1);
});

test('transient 5xx and network errors retain one retry', async () => {
  for (const firstError of [
    Object.assign(new Error('temporary server failure'), {status: 503}),
    new TypeError('Failed to fetch'),
  ]) {
    let requestCalls = 0;
    const result = await callOpenAICompatible(SILLYTAVERN_CURRENT_API, [{role: 'user', content: '测试'}], {
      requestSettings: {retry_count: 1},
      context: {
        chatCompletionSettings: {chat_completion_source: 'openai', openai_max_tokens: 1200},
        getChatCompletionModel: () => 'current-model',
        ChatCompletionService: {
          async processRequest() {
            requestCalls += 1;
            if (requestCalls === 1) throw firstError;
            return {content: 'OK'};
          },
        },
      },
    });
    assert.deepEqual(result, {content: 'OK'});
    assert.equal(requestCalls, 2);
  }
});

test('global request settings override legacy Profile timeout and retry fields', async () => {
  let requestCalls = 0;
  const result = await callOpenAICompatible({
    api_url: 'https://api.example/v1',
    model: 'model-a',
    timeout: 10,
    retry_count: 0,
  }, [{role: 'user', content: '测试'}], {
    requestSettings: {timeout: 250, retry_count: 1},
    context: {
      ChatCompletionService: {
        async processRequest() {
          requestCalls += 1;
          if (requestCalls === 1) throw Object.assign(new Error('temporary'), {status: 503});
          await new Promise(resolve => setTimeout(resolve, 30));
          return {content: 'OK'};
        },
      },
    },
  });

  assert.deepEqual(result, {content: 'OK'});
  assert.equal(requestCalls, 2);
});

test('timeout-induced internal abort does not trigger an automatic second request', async () => {
  for (const abortError of [
    new TypeError('Failed to fetch'),
    new DOMException('The operation was aborted.', 'AbortError'),
  ]) {
    let requestCalls = 0;
    await assert.rejects(
      callOpenAICompatible({
        api_url: 'https://api.example/v1',
        model: 'model-a',
        timeout: 10,
        retry_count: 1,
      }, [{role: 'user', content: '测试'}], {
        requestSettings: {timeout: 250, retry_count: 1},
        context: {
          ChatCompletionService: {
            async processRequest(_payload, _options, _extractData, signal) {
              requestCalls += 1;
              await new Promise((_resolve, reject) => {
                signal.addEventListener('abort', () => reject(abortError), {once: true});
              });
            },
          },
        },
      }),
      error => error?.code === 'REQUEST_TIMEOUT',
    );
    assert.equal(requestCalls, 1);
  }
});

test('host abort variants are normalized without exposing the raw aborted message', async () => {
  await assert.rejects(
    callOpenAICompatible(SILLYTAVERN_CURRENT_API, [{role: 'user', content: '测试'}], {
      requestSettings: {retry_count: 0},
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
  }, {
    requestSettings: {retry_count: 0},
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
    }, {
      requestSettings: {retry_count: 0},
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
  for (const field of ['context_size', 'max_output_tokens', 'temperature']) {
    assert.doesNotMatch(html, new RegExp(`name="${field}"`));
  }
  assert.match(html, /<input class="bioweave-input" name="timeout" type="number" value="180"/);
  assert.match(html, /<input class="bioweave-input" name="retry_count" type="number" value="1"/);
  assert.match(html, /超时（秒）/);
  assert.match(html, /重试次数/);
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
      api_key: 'DRAFT-KEY',
    },
    apiRequestSettings: {timeout: 45000, retry_count: 2},
  });

  assert.match(html, /value="Draft Name"/);
  assert.match(html, /value="https:\/\/draft\.example\/v1"/);
  assert.match(html, /value="draft-model"/);
  assert.match(html, /name="timeout" type="number" value="45"/);
  assert.match(html, /name="retry_count" type="number" value="2"/);
  assert.match(html, /name="api_key" type="password" value="DRAFT-KEY"/);
  assert.match(html, /value="default" selected/);
  assert.match(html, /value="bioweave"[^>]*checked/);
  const apiSourceIndex = html.indexOf('<section class="bioweave-card bioweave-api-source">');
  const requestSettingsIndex = html.indexOf('data-bioweave-api-request-settings');
  const requestModuleTitleIndex = html.indexOf('<h3>请求设置</h3>');
  const connectionSettingsIndex = html.indexOf('<header class="bioweave-api-module-header"><div><h3>连接设置</h3>');
  const connectionModuleIndex = html.indexOf('<section class="bioweave-api-source-module bioweave-api-connection-settings">');
  const profileFormIndex = html.indexOf('<form data-bioweave-settings-form');
  assert.ok(requestSettingsIndex > apiSourceIndex);
  assert.ok(requestModuleTitleIndex > requestSettingsIndex);
  assert.ok(requestSettingsIndex < connectionSettingsIndex);
  assert.ok(connectionModuleIndex > requestSettingsIndex);
  assert.ok(profileFormIndex > connectionSettingsIndex);
  assert.equal(html.slice(profileFormIndex).includes('data-bioweave-api-timeout'), false);
  assert.equal(html.slice(profileFormIndex).includes('data-bioweave-api-retry-count'), false);
  assert.equal(html.includes('bioweave-settings-advanced'), false);
  assert.equal(html.includes('Context Size'), false);
  assert.equal(html.includes('Max Output Tokens'), false);
  assert.equal(html.includes('Temperature'), false);
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
  assert.match(html, /data-bioweave-api-request-settings/);
  assert.match(html, /name="timeout" type="number" value="180"/);
  assert.match(html, /data-bioweave-action="new-profile"[^>]*>新建 API 配置<\/button>/);
  assert.match(html, /bioweave-api-security-note/);
  assert.equal(html.includes('安全边界'), false);
  assert.equal(html.includes('<details class="bioweave-settings-disclosure bioweave-api-source-disclosure" data-bioweave-settings-disclosure="api" open>'), false);
  assert.equal(html.includes('独立 API Profiles'), false);
});

test('world analysis prompt settings expose editable blocks without segment-name controls or secrets', () => {
  const html = settingsPage({
    worldAnalysisPrompt: {
      system_top: '顶部内容',
      task: '只检查能力证据',
      input_prefix: '这是可编辑前言',
      input_suffix: '这是可编辑后记',
      system_bottom: '尾部内容',
      labels: {character: '角色资料'},
    },
  });
  assert.match(html, /世界分析提示词/);
  assert.doesNotMatch(html, /世界分析提示词与标签/);
  assert.match(html, /data-bioweave-world-analysis-prompt-field="system_top"[^>]*>顶部内容/);
  assert.match(html, /顶部 SYSTEM<small>发送给 API 时作为 messages\[0\]。<\/small>/);
  assert.match(html, /data-bioweave-world-analysis-prompt-field="task"[^>]*>只检查能力证据/);
  assert.match(html, /data-bioweave-world-analysis-prompt-field="system_bottom"[^>]*>尾部内容/);
  assert.match(html, /尾部 SYSTEM<small>发送给 API 时作为 messages 最后一项。<\/small>/);
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
    system_top: '顶部补充',
    task: '只分析输入证据',
    input_prefix: '自定义前言',
    input_suffix: '',
    system_bottom: '尾部补充',
    labels: {character: '角色资料'},
    api_key: 'NEVER-PERSIST',
  });
  assert.equal(saved.task, '只分析输入证据');
  assert.equal(saved.input_prefix, '自定义前言');
  assert.equal(saved.system_top, '顶部补充');
  assert.equal(saved.system_bottom, '尾部补充');
  assert.equal(saved.labels.character, '角色资料');
  assert.equal(JSON.stringify(globalSettings).includes('NEVER-PERSIST'), false);
  assert.equal(profileStore.getWorldAnalysisPrompt().task, '只分析输入证据');
});

test('partial World Analysis prompt saves preserve existing editable blocks', async () => {
  let globalSettings = {
    world_analysis_prompt: {
      task: '旧任务',
      input_prefix: '旧前言',
      input_suffix: '旧后记',
      labels: {character: '旧角色标签'},
    },
  };
  const profileStore = createApiProfileStore({
    getGlobalSettings: () => globalSettings,
    async saveGlobalSettings(value) {
      globalSettings = value;
    },
  });

  const legacyPrompt = profileStore.getWorldAnalysisPrompt();
  assert.equal(legacyPrompt.system_top, '');
  assert.equal(legacyPrompt.system_bottom, '');
  assert.equal(globalSettings.world_analysis_prompt.system_top, undefined);
  assert.equal(globalSettings.world_analysis_prompt.system_bottom, undefined);

  const saved = await profileStore.saveWorldAnalysisPrompt({
    system_top: 'TOP',
    system_bottom: 'BOTTOM',
    task: undefined,
    input_prefix: undefined,
    input_suffix: undefined,
    labels: undefined,
  });

  assert.deepEqual(saved, {
    system_top: 'TOP',
    task: '旧任务',
    input_prefix: '旧前言',
    input_suffix: '旧后记',
    system_bottom: 'BOTTOM',
    labels: {
      character: '旧角色标签',
      worldbooks: '世界书',
      recent_story: '最近剧情',
      external_memory: '外部记忆',
    },
  });
  assert.equal(profileStore.getWorldAnalysisPrompt().task, '旧任务');
  assert.equal(profileStore.getWorldAnalysisPrompt().input_prefix, '旧前言');
  assert.equal(profileStore.getWorldAnalysisPrompt().input_suffix, '旧后记');
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

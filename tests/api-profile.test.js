import test from 'node:test'
import assert from 'node:assert/strict'
import {
  callOpenAICompatible,
  classifyGenerationError,
  diagnosticMessage,
  fetchModels,
  isUpstreamTimeoutTemplate,
  makeDiagnosticError,
  safeErrorSummary,
  testProfile,
} from '../ai/client.js'
import { createAnalyzer } from '../ai/analyzer.js'
import {
  BIOWEAVE_INDEPENDENT_API,
  DEFAULT_API_REQUEST_SETTINGS,
  FOLLOW_DEFAULT_API,
  SILLYTAVERN_CURRENT_API,
  emptyChat,
  normalizeExtensionSettings,
  normalizeApiProfile,
  normalizeApiRequestSettings,
} from '../storage/schema.js'
import { createApiProfileStore, createSecretStore } from '../storage/store.js'
import { closeModelPicker } from '../ui/app.js'
import { settingsPage } from '../ui/settings.js'
const UPSTREAM_TIMEOUT_BODY = [
  '[req_test] [custom]',
  '**Request exceeded 15s limit**',
  '- Your prompt took too long to process, likely due to a large context window or heavy reasoning required by the AI provider.',
  'How to fix:',
  '- **Send "continue"** to resume from where the model stopped (works for most timeouts).',
  '- **Start a new session/chat** to clear accumulated context and reset the timer.',
  '- Shorten your prompt or split it into smaller parts.',
  '- Avoid repeatedly retrying the exact same request to prevent continuous timeouts.',
  '**Billing:**',
  '- This request still counts as a request and is billed based on its input (minimum 1,000 prompt / 1,000 completion / 1,000 cached tokens).',
  '- Do not resend the same request — it will keep failing and keep consuming your quota.',
  '**Recommended tools:**',
  '- These responses are optimized for opencode, Claude Code, and Codex.',
  '- If you are using a non-standard client and keep hitting errors, switch to one of the supported tools above.',
].join('\n')
function currentApiContext(result) {
  return {
    requestSettings: { retry_count: 0 },
    context: {
      chatCompletionSettings: {
        chat_completion_source: 'openai',
        openai_max_tokens: 1200,
      },
      getChatCompletionModel: () => 'current-model',
      ChatCompletionService: {
        async processRequest() {
          return typeof result === 'function' ? result() : result
        },
      },
    },
  }
}
function independentApiProfile(overrides = {}) {
  return {
    api_url: 'https://api.example/v1',
    model: 'model-a',
    secret_ref: 'opaque-secret-id',
    max_output_tokens: 1200,
    temperature: 0.4,
    ...overrides,
  }
}
function independentApiOptions(fetchRef, overrides = {}) {
  const { context = {}, requestSettings = {}, ...rest } = overrides
  return {
    ...rest,
    requestSettings: { retry_count: 0, ...requestSettings },
    fetchRef,
    context: {
      getRequestHeaders: () => ({ 'X-CSRF-Token': 'csrf-token' }),
      ...context,
    },
  }
}
function responseLikeSse(body, { contentType = 'text/event-stream' } = {}) {
  let consumed = false
  return {
    ok: true,
    status: 200,
    headers: {
      get: name => (name.toLowerCase() === 'content-type' ? contentType : null),
    },
    body: {
      getReader() {
        return {
          async read() {
            if (consumed) return { done: true, value: undefined }
            consumed = true
            return { done: false, value: new TextEncoder().encode(body) }
          },
          releaseLock() {},
        }
      },
    },
  }
}
async function captureApiTrace(enabled, run) {
  const previousFlag = globalThis.__BIOWEAVE_API_TRACE__
  const previousDebug = globalThis.console?.debug
  const entries = []
  globalThis.__BIOWEAVE_API_TRACE__ = enabled
  if (globalThis.console) {
    globalThis.console.debug = (...args) => entries.push(args)
  }
  try {
    return { result: await run(), entries }
  } finally {
    if (previousFlag === undefined) delete globalThis.__BIOWEAVE_API_TRACE__
    else globalThis.__BIOWEAVE_API_TRACE__ = previousFlag
    if (globalThis.console) globalThis.console.debug = previousDebug
  }
}
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
        nested: { apiKey: 'ALSO-DO-NOT-PERSIST' },
        secret_ref: 'secret-id-1',
      },
    },
    assignments: { world_analysis: 'stable' },
  })
  assert.equal(settings.api_profiles.stable.api_key, undefined)
  assert.equal(settings.api_profiles.stable.nested, undefined)
  assert.equal(settings.api_profiles.stable.provider, 'OpenAI-compatible')
  assert.equal(settings.api_profiles.stable.secret_ref, 'secret-id-1')
  assert.equal('timeout' in settings.api_profiles.stable, false)
  assert.equal('retry_count' in settings.api_profiles.stable, false)
  assert.deepEqual(settings.api_request_settings, DEFAULT_API_REQUEST_SETTINGS)
  assert.equal(settings.assignments.world_analysis, 'stable')
  assert.equal(JSON.stringify(settings).includes('DO-NOT-PERSIST'), false)
  assert.equal('api_profiles' in emptyChat('chat-a'), false)
  assert.deepEqual(emptyChat('chat-a').tracking_subjects, {})
  assert.deepEqual(emptyChat('chat-a').tracking_candidates, {})
})
test('providerless profile normalization uses a stable display fallback', () => {
  assert.equal(normalizeApiProfile({ api_url: 'https://api.example/v1', model: 'model-a' }).name, 'model-a')
  assert.equal(normalizeApiProfile({ api_url: 'https://api.example/v1' }).name, 'API 配置')
})
test('global API request settings normalize and round-trip without Chat storage', async () => {
  assert.deepEqual(normalizeApiRequestSettings(), DEFAULT_API_REQUEST_SETTINGS)
  assert.deepEqual(normalizeApiRequestSettings({ timeout: 45000, retry_count: 2 }), {
    timeout: 45000,
    retry_count: 2,
  })
  let globalSettings = {}
  let chatWrites = 0
  const profileStore = createApiProfileStore({
    getGlobalSettings: () => globalSettings,
    saveGlobalSettings: async value => {
      globalSettings = structuredClone(value)
    },
    saveChatMetadata: async () => {
      chatWrites += 1
    },
  })
  assert.deepEqual(profileStore.getApiRequestSettings(), DEFAULT_API_REQUEST_SETTINGS)
  const saved = await profileStore.saveApiRequestSettings({
    timeout: 45000,
    retry_count: 2,
  })
  assert.deepEqual(saved, { timeout: 45000, retry_count: 2 })
  assert.deepEqual(profileStore.getApiRequestSettings(), saved)
  assert.deepEqual(globalSettings.api_request_settings, saved)
  assert.equal(chatWrites, 0)
})
test('providerless profiles save and legacy provider values survive edits', async () => {
  let globalSettings = {
    api_profiles: {
      legacy: {
        profile_id: 'legacy',
        name: '旧配置',
        provider: 'Legacy Provider',
        api_url: 'https://legacy.example/v1',
        model: 'legacy-model',
      },
    },
  }
  const profileStore = createApiProfileStore({
    getGlobalSettings: () => globalSettings,
    saveGlobalSettings: async value => {
      globalSettings = structuredClone(value)
    },
  })
  const created = await profileStore.saveProfile({
    name: '无服务商配置',
    api_url: 'https://api.example/v1',
    model: 'model-a',
  })
  assert.equal(created.provider, 'OpenAI-compatible')
  assert.equal(created.name, '无服务商配置')
  const edited = await profileStore.saveProfile({
    profile_id: 'legacy',
    name: '旧配置已编辑',
    api_url: 'https://legacy.example/v1',
    model: 'legacy-model',
  })
  assert.equal(edited.provider, 'Legacy Provider')
  assert.equal(profileStore.getProfile('legacy').provider, 'Legacy Provider')
})
test('profile URL normalization strips completion suffixes and rejects URL credentials', () => {
  const normalized = normalizeExtensionSettings({
    api_profiles: {
      safe: {
        api_url: 'https://api.example/v1/chat/completions/',
        model: 'model-a',
      },
      unsafe: {
        api_url: 'https://user:password@api.example/v1',
        model: 'model-b',
      },
      query: {
        api_url: 'https://api.example/v1?api_key=DO-NOT-PERSIST',
        model: 'model-c',
      },
      nestedQuery: {
        api_url: 'https://api.example/v1?redirect=Bearer%20DO-NOT-PERSIST',
        model: 'model-d',
      },
      ordinaryQuery: {
        api_url: 'https://api.example/v1?region=global',
        model: 'model-e',
      },
      malformed: { api_url: 'not a URL', model: 'model-e' },
    },
  })
  assert.equal(normalized.api_profiles.safe.api_url, 'https://api.example/v1')
  assert.equal(normalized.api_profiles.unsafe.api_url, '')
  assert.equal(normalized.api_profiles.query.api_url, '')
  assert.equal(normalized.api_profiles.nestedQuery.api_url, '')
  assert.equal(normalized.api_profiles.ordinaryQuery.api_url, '')
  assert.equal(normalized.api_profiles.malformed.api_url, '')
  assert.equal(JSON.stringify(normalized).includes('DO-NOT-PERSIST'), false)
})
test('profile secret lifecycle preserves, replaces, clears, and deletes references safely', async () => {
  let globalSettings = {}
  let nextSecret = 0
  const secretCalls = []
  const profileStore = createApiProfileStore(
    {
      getGlobalSettings: () => globalSettings,
      saveGlobalSettings: async value => {
        globalSettings = structuredClone(value)
      },
    },
    {
      secretStore: {
        async write(value, ...labelArgs) {
          secretCalls.push(['write', value, ...labelArgs])
          nextSecret += 1
          return `secret-${nextSecret}`
        },
        async remove(reference) {
          secretCalls.push(['remove', reference])
        },
      },
    },
  )
  const first = await profileStore.saveProfile({
    profile_id: 'profile-a',
    name: 'Primary',
    provider: 'custom',
    api_url: 'https://api.example/v1',
    model: 'model-a',
    api_key: 'FIRST-KEY',
  })
  assert.equal(first.secret_ref, 'secret-1')
  assert.equal(JSON.stringify(globalSettings).includes('FIRST-KEY'), false)
  const retained = await profileStore.saveProfile({
    ...first,
    api_key: '',
  })
  assert.equal(retained.secret_ref, 'secret-1')
  assert.deepEqual(secretCalls, [['write', 'FIRST-KEY']])
  const replaced = await profileStore.saveProfile({
    ...first,
    api_key: 'SECOND-KEY',
  })
  assert.equal(replaced.secret_ref, 'secret-2')
  assert.equal(JSON.stringify(globalSettings).includes('SECOND-KEY'), false)
  assert.deepEqual(secretCalls.at(-1), ['remove', 'secret-1'])
  await profileStore.setAssignment('world_analysis', 'profile-a')
  assert.equal(profileStore.getAssignment('world_analysis'), 'profile-a')
  await profileStore.saveProfile({ ...replaced, clear_secret: true })
  assert.equal(profileStore.getProfile('profile-a').secret_ref, null)
  assert.deepEqual(secretCalls.at(-1), ['remove', 'secret-2'])
  await profileStore.deleteProfile('profile-a')
  assert.equal(profileStore.getProfile('profile-a'), null)
  assert.equal(profileStore.getAssignment('world_analysis'), null)
})
test('model list cache is profile-scoped, replaces atomically, and is deleted with its profile', async () => {
  let globalSettings = {}
  const profileStore = createApiProfileStore({
    getGlobalSettings: () => globalSettings,
    saveGlobalSettings: async value => {
      globalSettings = structuredClone(value)
    },
  })
  await profileStore.saveProfile({
    profile_id: 'profile-a',
    ...independentApiProfile({ model: 'model-a' }),
  })
  await profileStore.saveProfile({
    profile_id: 'profile-b',
    ...independentApiProfile({ model: 'model-b' }),
  })

  await profileStore.saveModelListCache('profile-a', {
    profile_id: 'profile-a',
    models: [' model-a ', 'model-a', '', 42],
    refreshed_at: 100,
    api_key: 'MUST-NOT-PERSIST',
    secret_ref: 'MUST-NOT-PERSIST',
  })
  await profileStore.saveModelListCache('profile-b', {
    models: ['model-b'],
    refreshed_at: 200,
    secret: 'MUST-NOT-PERSIST',
  })
  assert.deepEqual(profileStore.getModelListCache('profile-a'), {
    profile_id: 'profile-a',
    models: ['model-a'],
    refreshed_at: 100,
  })
  assert.deepEqual(profileStore.getModelListCache('profile-b'), {
    profile_id: 'profile-b',
    models: ['model-b'],
    refreshed_at: 200,
  })
  assert.equal(JSON.stringify(globalSettings).includes('MUST-NOT-PERSIST'), false)

  await profileStore.saveModelListCache('profile-a', {
    models: ['model-a-new', 'model-a-new-2'],
    refreshed_at: 300,
  })
  assert.deepEqual(profileStore.getModelListCache('profile-a'), {
    profile_id: 'profile-a',
    models: ['model-a-new', 'model-a-new-2'],
    refreshed_at: 300,
  })
  assert.deepEqual(profileStore.getModelListCache('profile-b')?.models, ['model-b'])

  await profileStore.deleteProfile('profile-a')
  assert.equal(profileStore.getModelListCache('profile-a'), null)
  assert.equal(globalSettings.api_model_caches['profile-a'], undefined)
  assert.deepEqual(profileStore.getModelListCache('profile-b')?.models, ['model-b'])
})
test('model list cache normalizer drops orphan and new keys and never carries secrets', async () => {
  const normalized = normalizeExtensionSettings({
    api_profiles: {
      stable: independentApiProfile({ profile_id: 'stable' }),
    },
    api_model_caches: {
      stable: {
        models: ['model-a'],
        refreshed_at: 123,
        secret: 'MUST-NOT-PERSIST',
      },
      orphan: { models: ['orphan'], refreshed_at: 456 },
      new: { models: ['temporary'], refreshed_at: 789 },
      __new__: { models: ['temporary-2'], refreshed_at: 790 },
    },
  })
  assert.deepEqual(normalized.api_model_caches, {
    stable: {
      profile_id: 'stable',
      models: ['model-a'],
      refreshed_at: 123,
    },
  })
  assert.equal(JSON.stringify(normalized).includes('MUST-NOT-PERSIST'), false)

  let globalSettings = {}
  const profileStore = createApiProfileStore({
    getGlobalSettings: () => globalSettings,
    saveGlobalSettings: async value => {
      globalSettings = structuredClone(value)
    },
  })
  await assert.rejects(() => profileStore.saveModelListCache('new', { models: ['temporary'] }), {
    message: 'API_PROFILE_NOT_FOUND',
  })
  assert.equal(globalSettings.api_model_caches, undefined)
})
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
  }
  const secretCalls = []
  const profileStore = createApiProfileStore(
    {
      getGlobalSettings: () => globalSettings,
      saveGlobalSettings: async value => {
        globalSettings = structuredClone(value)
      },
    },
    {
      secretStore: {
        async write(value) {
          secretCalls.push(['write', value])
          return 'temporary-secret'
        },
        async remove(reference) {
          secretCalls.push(['remove', reference])
        },
      },
    },
  )
  let testedProfile
  await profileStore.withTestProfile(
    {
      profile_id: 'stable',
      api_url: 'https://api.example/v1',
      model: 'draft-model',
      api_key: 'TEMPORARY-KEY',
    },
    async profile => {
      testedProfile = profile
      assert.equal(profile.secret_ref, 'temporary-secret')
      assert.equal('api_key' in profile, false)
    },
  )
  assert.deepEqual(secretCalls, [
    ['write', 'TEMPORARY-KEY'],
    ['remove', 'temporary-secret'],
  ])
  assert.equal(JSON.stringify(globalSettings).includes('TEMPORARY-KEY'), false)
  assert.equal(globalSettings.api_profiles.stable.model, 'model-a')
  assert.equal(await profileStore.setApiSource(BIOWEAVE_INDEPENDENT_API), BIOWEAVE_INDEPENDENT_API)
  assert.equal(await profileStore.setDefaultProfile('stable'), 'stable')
  assert.equal(await profileStore.setAssignment('world_analysis', FOLLOW_DEFAULT_API), FOLLOW_DEFAULT_API)
  assert.equal(profileStore.getSettings().api_source, BIOWEAVE_INDEPENDENT_API)
  assert.equal(profileStore.getSettings().default_profile_id, 'stable')
  assert.equal(profileStore.getAssignment('world_analysis'), FOLLOW_DEFAULT_API)
  assert.equal(testedProfile.model, 'draft-model')
})
test('model discovery can use a temporary secret before a model is selected', async () => {
  const secretCalls = []
  const profileStore = createApiProfileStore(
    {
      getGlobalSettings: () => ({}),
      saveGlobalSettings: async () => {},
    },
    {
      secretStore: {
        async write(value) {
          secretCalls.push(['write', value])
          return 'temporary-model-secret'
        },
        async remove(reference) {
          secretCalls.push(['remove', reference])
        },
      },
    },
  )
  await profileStore.withTestProfile(
    {
      api_url: 'https://api.example/v1',
      api_key: 'MODEL-LIST-KEY',
    },
    profile => {
      assert.equal(profile.model, '')
      assert.equal(profile.secret_ref, 'temporary-model-secret')
    },
    { requireModel: false },
  )
  assert.deepEqual(secretCalls, [
    ['write', 'MODEL-LIST-KEY'],
    ['remove', 'temporary-model-secret'],
  ])
})
test('secret cleanup failures are surfaced without restoring a stale profile reference', async () => {
  let globalSettings = {}
  let nextSecret = 0
  const profileStore = createApiProfileStore(
    {
      getGlobalSettings: () => globalSettings,
      saveGlobalSettings: async value => {
        globalSettings = structuredClone(value)
      },
    },
    {
      secretStore: {
        async write() {
          nextSecret += 1
          return `secret-${nextSecret}`
        },
        async remove() {
          throw new Error('raw secret-store failure')
        },
      },
    },
  )
  const first = await profileStore.saveProfile({
    profile_id: 'profile-a',
    api_url: 'https://api.example/v1',
    model: 'model-a',
    api_key: 'FIRST-KEY',
  })
  await assert.rejects(profileStore.saveProfile({ ...first, api_key: 'SECOND-KEY' }), /ST_SECRET_DELETE_FAILED/)
  assert.equal(profileStore.getProfile('profile-a').secret_ref, 'secret-2')
  await assert.rejects(profileStore.deleteProfile('profile-a'), /ST_SECRET_DELETE_FAILED/)
  assert.equal(profileStore.getProfile('profile-a'), null)
})
test('invalid profiles do not write a new secret or global settings', async () => {
  let saved = 0
  let globalSettings = {}
  const profileStore = createApiProfileStore(
    {
      getGlobalSettings: () => globalSettings,
      saveGlobalSettings: async value => {
        saved += 1
        globalSettings = value
      },
    },
    {
      secretStore: {
        async write() {
          throw new Error('secret write must not happen')
        },
      },
    },
  )
  await assert.rejects(profileStore.saveProfile({ name: 'Incomplete', api_key: 'DO-NOT-WRITE' }), /API_PROFILE_INVALID/)
  assert.equal(saved, 0)
  assert.deepEqual(globalSettings, {})
})
test('secret HTTP boundary only writes/deletes and never reads secret values', async () => {
  const requests = []
  const secretStore = createSecretStore({
    fetchRef: async (url, options) => {
      requests.push({ url, options })
      return {
        ok: true,
        async json() {
          return { id: 'opaque-secret-id' }
        },
      }
    },
  })
  assert.equal(await secretStore.write('KEY-VALUE', 'BioWeave'), 'opaque-secret-id')
  assert.equal(await secretStore.remove('opaque-secret-id'), true)
  assert.deepEqual(
    requests.map(request => request.url),
    ['/api/secrets/write', '/api/secrets/delete'],
  )
  assert.equal(JSON.parse(requests[0].options.body).key, 'api_key_custom')
  assert.equal(JSON.parse(requests[1].options.body).key, 'api_key_custom')
  assert.equal(JSON.parse(requests[0].options.body).value, 'KEY-VALUE')
  assert.equal(JSON.parse(requests[1].options.body).id, 'opaque-secret-id')
  assert.throws(() => secretStore.get(), /ST_SECRET_READ_DISABLED/)
})
test('independent API uses raw fetch with an opaque secret and returns safe failures', async () => {
  const requests = []
  let processRequestCalls = 0
  const context = {
    ChatCompletionService: {
      async processRequest() {
        processRequestCalls += 1
        throw new Error('independent path must not use ChatCompletionService')
      },
      getRequestHeaders: () => ({ 'X-CSRF-Token': 'csrf-token' }),
    },
  }
  const fetchRef = async (url, options) => {
    requests.push({ url, options })
    return new Response(JSON.stringify({ content: 'OK' }), { status: 200 })
  }
  const result = await testProfile(independentApiProfile({ api_key: 'SHOULD-NOT-REACH-CLIENT-RESULT' }), independentApiOptions(fetchRef, { context }))
  assert.equal(result.ok, true)
  assert.equal(processRequestCalls, 0)
  assert.equal(requests.length, 1)
  assert.equal(requests[0].url, '/api/backends/chat-completions/generate')
  assert.equal(requests[0].options.method, 'POST')
  assert.equal(requests[0].options.headers['X-CSRF-Token'], 'csrf-token')
  const body = JSON.parse(requests[0].options.body)
  assert.deepEqual(body, {
    stream: false,
    messages: [{ role: 'user', content: 'Reply OK.' }],
    model: 'model-a',
    chat_completion_source: 'custom',
    custom_url: 'https://api.example/v1',
    secret_id: 'opaque-secret-id',
    max_tokens: 1200,
    temperature: 0.4,
  })
  assert.equal('proxy_password' in body, false)
  assert.equal('api_key' in body, false)

  await testProfile(independentApiProfile({ secret_ref: null }), independentApiOptions(fetchRef, { context }))
  assert.equal(JSON.parse(requests.at(-1).options.body).secret_id, '__bioweave_no_secret__')

  const failingResult = await testProfile(
    independentApiProfile(),
    independentApiOptions(
      async () =>
        new Response(JSON.stringify({ error: 'Bearer SHOULD-NOT-BE-SHOWN' }), {
          status: 401,
        }),
    ),
  )
  assert.equal(failingResult.ok, false)
  assert.equal(failingResult.http_status, 401)
  assert.equal(failingResult.error.includes('SHOULD-NOT-BE-SHOWN'), false)
})
test('independent raw fetch preserves HTTP status classification without guessing from body text', async () => {
  const expected = new Map([
    [400, 'http-400'],
    [401, 'auth'],
    [403, 'auth'],
    [404, 'not-found'],
    [429, 'rate-limit'],
    [500, 'server'],
    [502, 'server'],
    [503, 'server'],
  ])
  for (const [status, diagnostic] of expected) {
    await assert.rejects(
      callOpenAICompatible(
        independentApiProfile(),
        [{ role: 'user', content: '测试' }],
        independentApiOptions(async url => {
          assert.equal(url, '/api/backends/chat-completions/generate')
          return new Response(JSON.stringify({ error: 'Bearer DO-NOT-SHOW' }), {
            status,
          })
        }),
      ),
      error => {
        assert.equal(error.status, status)
        assert.equal(error.diagnosticCode, diagnostic)
        assert.equal(error.diagnostic_code, diagnostic)
        assert.equal(error.error_code, diagnostic)
        assert.match(safeErrorSummary(error), new RegExp(`HTTP ${status}`))
        assert.doesNotMatch(safeErrorSummary(error), /超时/)
        assert.doesNotMatch(error.message, /DO-NOT-SHOW/)
        return true
      },
    )
  }

  await assert.rejects(
    callOpenAICompatible(
      independentApiProfile(),
      [{ role: 'user', content: '测试' }],
      independentApiOptions(async () => {
        throw new Error('Unauthorized')
      }),
    ),
    error => {
      assert.equal(error.status, undefined)
      assert.doesNotMatch(safeErrorSummary(error), /HTTP 401|HTTP 503/)
      return true
    },
  )
})
test('independent raw response classifies HTTP 200 error, invalid JSON, and upstream timeout', async () => {
  const scenarios = [
    {
      name: 'response error',
      response: new Response(JSON.stringify({ error: 'Bearer DO-NOT-SHOW' }), {
        status: 200,
      }),
      diagnostic: 'response-error',
    },
    {
      name: 'invalid JSON',
      response: new Response('not-json DO-NOT-SHOW', { status: 200 }),
      diagnostic: 'invalid-json',
    },
    {
      name: 'upstream timeout',
      response: new Response(JSON.stringify(UPSTREAM_TIMEOUT_BODY), {
        status: 200,
      }),
      diagnostic: 'upstream-timeout',
    },
  ]
  for (const scenario of scenarios) {
    await assert.rejects(
      callOpenAICompatible(
        independentApiProfile(),
        [{ role: 'user', content: '测试' }],
        independentApiOptions(async () => scenario.response),
      ),
      error => {
        assert.equal(error.status, 200, scenario.name)
        assert.equal(error.diagnosticCode, scenario.diagnostic, scenario.name)
        assert.equal(error.diagnostic_code, scenario.diagnostic, scenario.name)
        assert.equal(error.error_code, scenario.diagnostic, scenario.name)
        assert.equal(error.phase, 'response', scenario.name)
        assert.match(safeErrorSummary(error), /HTTP 200/, scenario.name)
        assert.doesNotMatch(safeErrorSummary(error), /DO-NOT-SHOW/, scenario.name)
        return true
      },
    )
  }
})
test('successful response shapes remain available to the client normalization boundary', async () => {
  const currentShapes = [{ content: '{"schema_version":"test"}' }, { choices: [{ message: { content: '{"schema_version":"test"}' } }] }]
  for (const shape of currentShapes) {
    const result = await callOpenAICompatible(SILLYTAVERN_CURRENT_API, [{ role: 'user', content: '测试' }], currentApiContext(shape))
    assert.deepEqual(result, shape)
  }

  const jsonResult = await callOpenAICompatible(
    independentApiProfile(),
    [{ role: 'user', content: '测试' }],
    independentApiOptions(
      async () =>
        new Response(JSON.stringify({ content: '{"schema_version":"test"}' }), {
          status: 200,
        }),
    ),
  )
  assert.deepEqual(jsonResult, { content: '{"schema_version":"test"}' })

  const sseResult = await callOpenAICompatible(
    independentApiProfile(),
    [{ role: 'user', content: '测试' }],
    independentApiOptions(async () =>
      responseLikeSse(
        [
          `data: ${JSON.stringify({ choices: [{ delta: { content: '{' } }] })}`,
          `data: ${JSON.stringify({ choices: [{ delta: { content: '}' } }] })}`,
          'data: [DONE]',
          '',
        ].join('\n'),
      ),
    ),
  )
  assert.deepEqual(sseResult, { content: '{}' })
})
test('standard native Response SSE remains an explicit json-first diagnostic', async () => {
  await assert.rejects(
    callOpenAICompatible(
      independentApiProfile(),
      [{ role: 'user', content: '测试' }],
      independentApiOptions(
        async () =>
          new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\ndata: [DONE]\n', {
            status: 200,
            headers: { 'content-type': 'text/event-stream' },
          }),
      ),
    ),
    error => {
      assert.equal(error.status, 200)
      assert.equal(error.diagnosticCode, 'invalid-json')
      assert.equal(error.phase, 'response')
      return true
    },
  )
})
test('a delayed HTTP 200 body reader completes before the local timeout', async () => {
  const result = await callOpenAICompatible(
    independentApiProfile(),
    [{ role: 'user', content: '测试' }],
    independentApiOptions(
      async () => {
        let read = false
        return {
          ok: true,
          status: 200,
          body: {
            getReader() {
              return {
                async read() {
                  if (read) return { done: true, value: undefined }
                  await new Promise(resolve => setTimeout(resolve, 25))
                  read = true
                  return {
                    done: false,
                    value: new TextEncoder().encode('{"content":"delayed"}'),
                  }
                },
                releaseLock() {},
              }
            },
          },
        }
      },
      { requestSettings: { timeout: 250 } },
    ),
  )
  assert.deepEqual(result, { content: 'delayed' })
})
test('API TRACE is disabled by default and enabled TRACE contains only safe metadata', async () => {
  const disabled = await captureApiTrace(false, async () =>
    callOpenAICompatible(
      independentApiProfile({
        model: 'trace-model',
        secret_ref: 'opaque-secret-id',
      }),
      [{ role: 'user', content: 'PRIVATE PROMPT SHOULD NOT BE LOGGED' }],
      independentApiOptions(async () =>
        responseLikeSse('data: {"choices":[{"delta":{"content":"PRIVATE RESPONSE SHOULD NOT BE LOGGED"}}]}\ndata: [DONE]\n'),
      ),
    ),
  )
  assert.equal(disabled.entries.length, 0)

  const enabled = await captureApiTrace(true, async () =>
    callOpenAICompatible(
      independentApiProfile({
        model: 'trace-model',
        secret_ref: 'opaque-secret-id',
      }),
      [{ role: 'user', content: 'PRIVATE PROMPT SHOULD NOT BE LOGGED' }],
      independentApiOptions(async () =>
        responseLikeSse('data: {"choices":[{"delta":{"content":"PRIVATE RESPONSE SHOULD NOT BE LOGGED"}}]}\ndata: [DONE]\n'),
      ),
    ),
  )
  const logText = JSON.stringify(enabled.entries)
  assert.match(logText, /\[BioWeave API TRACE\]/)
  for (const checkpoint of [
    'request-start',
    'transport-resolved',
    'normalize-start',
    'reader-start',
    'reader-complete',
    'response-json-from-text-start',
    'response-json-from-text-complete',
    'normalize-complete',
  ]) {
    assert.match(logText, new RegExp(checkpoint))
  }
  assert.match(logText, /dataLineCount/)
  assert.match(logText, /deltaContentExtracted/)
  assert.doesNotMatch(logText, /PRIVATE PROMPT SHOULD NOT BE LOGGED/)
  assert.doesNotMatch(logText, /PRIVATE RESPONSE SHOULD NOT BE LOGGED/)
  assert.doesNotMatch(logText, /opaque-secret-id/)

  const invalidJsonTrace = await captureApiTrace(true, async () =>
    assert.rejects(
      callOpenAICompatible(
        independentApiProfile(),
        [{ role: 'user', content: '测试' }],
        independentApiOptions(async () => responseLikeSse('not-json')),
      ),
      error => error?.diagnosticCode === 'invalid-json',
    ),
  )
  const invalidJsonLogText = JSON.stringify(invalidJsonTrace.entries)
  assert.match(invalidJsonLogText, /response-json-from-text-start/)
  assert.match(invalidJsonLogText, /response-json-from-text-error/)
  assert.match(invalidJsonLogText, /"diagnosticCode":"invalid-json"/)
  assert.match(invalidJsonLogText, /"code":"invalid-json"/)
})
test('response-json-from-text TRACE starts before empty-body and upstream-timeout checks', async () => {
  const captured = await captureApiTrace(true, async () => {
    for (const [body, diagnostic] of [
      ['', 'invalid-json'],
      [UPSTREAM_TIMEOUT_BODY, 'upstream-timeout'],
    ]) {
      await assert.rejects(
        callOpenAICompatible(
          independentApiProfile(),
          [{ role: 'user', content: '测试' }],
          independentApiOptions(async () => responseLikeSse(body)),
        ),
        error => error?.diagnosticCode === diagnostic,
      )
    }
  })
  const logText = JSON.stringify(captured.entries)
  assert.match(logText, /response-json-from-text-start/)
  assert.match(logText, /response-json-from-text-error/)
  assert.match(logText, /"emptyBody":true/)
  assert.match(logText, /"diagnosticCode":"invalid-json"/)
  assert.match(logText, /"diagnosticCode":"upstream-timeout"/)
})
test('API TRACE distinguishes JSON body completion from JSON body failure', async () => {
  const success = await captureApiTrace(true, async () =>
    callOpenAICompatible(
      independentApiProfile(),
      [{ role: 'user', content: '测试' }],
      independentApiOptions(
        async () =>
          new Response(JSON.stringify({ content: 'ok' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    ),
  )
  const jsonStart = success.entries.find(entry => entry[1] === 'json-start')
  const jsonComplete = success.entries.find(entry => entry[1] === 'json-complete')
  assert.ok(jsonStart)
  assert.ok(jsonComplete)
  assert.equal(jsonStart[2].status, 200)
  assert.equal(jsonStart[2].contentType, 'application/json')
  assert.equal(jsonStart[2].bodyUsedBefore, false)
  assert.equal(jsonComplete[2].status, 200)
  assert.equal(jsonComplete[2].contentType, 'application/json')
  assert.equal(jsonComplete[2].bodyUsedAfter, true)

  const failure = await captureApiTrace(true, async () =>
    assert.rejects(
      callOpenAICompatible(
        independentApiProfile(),
        [{ role: 'user', content: '测试' }],
        independentApiOptions(
          async () =>
            new Response('not-json', {
              status: 200,
              headers: { 'content-type': 'application/json' },
            }),
        ),
      ),
      error => error?.diagnosticCode === 'invalid-json',
    ),
  )
  const jsonError = failure.entries.find(entry => entry[1] === 'json-error')
  assert.ok(jsonError)
  assert.equal(jsonError[2].status, 200)
  assert.equal(jsonError[2].contentType, 'application/json')
  assert.equal(jsonError[2].bodyUsedAfter, true)
  assert.equal(jsonError[2].diagnosticCode, 'invalid-json')
})
test('SSE TRACE records each supported content extraction branch', async () => {
  const captured = await captureApiTrace(true, async () =>
    callOpenAICompatible(
      independentApiProfile(),
      [{ role: 'user', content: '测试' }],
      independentApiOptions(async () =>
        responseLikeSse(
          [
            `data: ${JSON.stringify({ choices: [{ delta: { content: '{' } }] })}`,
            `data: ${JSON.stringify({ choices: [{ message: { content: '"schema_version"' } }] })}`,
            `data: ${JSON.stringify({ choices: [{ text: ':"test"}' }] })}`,
            'data: [DONE]',
            '',
          ].join('\n'),
        ),
      ),
    ),
  )
  const complete = captured.entries.find(entry => entry[1] === 'response-json-from-text-complete')
  assert.ok(complete)
  assert.equal(complete[2].status, 200)
  assert.equal(complete[2].contentType, 'text/event-stream')
  assert.equal(complete[2].dataLineCount, 4)
  assert.equal(complete[2].deltaContentExtracted, true)
  assert.equal(complete[2].messageContentExtracted, true)
  assert.equal(complete[2].textContentExtracted, true)
})
test('API TRACE marks a 200 response timeout during body consumption', async () => {
  const captured = await captureApiTrace(true, async () =>
    assert.rejects(
      callOpenAICompatible(
        independentApiProfile(),
        [{ role: 'user', content: '测试' }],
        independentApiOptions(
          async () => ({
            ok: true,
            status: 200,
            headers: { get: () => 'text/event-stream' },
            body: {
              getReader() {
                return { read: () => new Promise(() => {}), releaseLock() {} }
              },
            },
          }),
          { requestSettings: { timeout: 250 } },
        ),
      ),
      error => error?.diagnosticCode === 'timeout' && error?.status === 200 && error?.phase === 'response',
    ),
  )
  const timeout = captured.entries.find(entry => entry[1] === 'timeout-abort')
  assert.ok(timeout)
  assert.equal(timeout[2].status, 200)
  assert.equal(timeout[2].phase, 'response')
  assert.equal(timeout[2].responseReceived, true)
  assert.equal(timeout[2].bodyReadStarted, true)
  assert.equal(timeout[2].bodyReadCompleted, false)
})
test('independent raw fetch keeps local request, body, and SSE timeouts distinct from network errors', async () => {
  const timeoutScenarios = [
    {
      name: 'request timeout',
      fetchRef: async () => new Promise(() => {}),
      status: undefined,
      phase: 'request',
    },
    {
      name: 'body timeout',
      fetchRef: async () => ({
        ok: true,
        status: 200,
        async json() {
          return new Promise(() => {})
        },
      }),
      status: 200,
      phase: 'response',
    },
    {
      name: 'SSE timeout',
      fetchRef: async () => ({
        ok: true,
        status: 200,
        body: {
          getReader() {
            return {
              read: () => new Promise(() => {}),
              releaseLock() {},
            }
          },
        },
      }),
      status: 200,
      phase: 'response',
    },
  ]
  for (const scenario of timeoutScenarios) {
    await assert.rejects(
      callOpenAICompatible(
        independentApiProfile(),
        [{ role: 'user', content: '测试' }],
        independentApiOptions(scenario.fetchRef, {
          requestSettings: { timeout: 250 },
        }),
      ),
      error => {
        assert.equal(error.code, 'REQUEST_TIMEOUT', scenario.name)
        assert.equal(error.diagnosticCode, 'timeout', scenario.name)
        assert.equal(error.status, scenario.status, scenario.name)
        assert.equal(error.phase, scenario.phase, scenario.name)
        assert.equal(error.timedOut, true, scenario.name)
        assert.match(safeErrorSummary(error), /超时/, scenario.name)
        return true
      },
    )
  }

  await assert.rejects(
    callOpenAICompatible(
      independentApiProfile(),
      [{ role: 'user', content: '测试' }],
      independentApiOptions(async () => {
        throw new TypeError('Failed to fetch')
      }),
    ),
    error => {
      assert.equal(error.diagnosticCode, 'network')
      assert.equal(error.diagnostic_code, 'network')
      assert.doesNotMatch(safeErrorSummary(error), /超时/)
      return true
    },
  )
})
test('independent raw fetch forwards external abort without retry', async () => {
  const controller = new AbortController()
  let fetchCalls = 0
  const request = callOpenAICompatible(
    independentApiProfile(),
    [{ role: 'user', content: '测试' }],
    independentApiOptions(
      async (_url, { signal }) => {
        fetchCalls += 1
        await new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')), {
            once: true,
          })
        })
      },
      { requestSettings: { retry_count: 1 }, signal: controller.signal },
    ),
  )
  await new Promise(resolve => setImmediate(resolve))
  controller.abort()
  await assert.rejects(request, error => error?.code === 'REQUEST_ABORTED' && error?.diagnosticCode === 'aborted')
  assert.equal(fetchCalls, 1)
})
test('client request settings override legacy Profile timeout and retry fields', async () => {
  let requestCalls = 0
  await assert.rejects(
    callOpenAICompatible(
      {
        api_url: 'https://api.example/v1',
        model: 'model-a',
        timeout: 30000,
        retry_count: 0,
      },
      [{ role: 'user', content: '测试' }],
      {
        requestSettings: { timeout: 250, retry_count: 1 },
        fetchRef: async (_url, { signal }) => {
          requestCalls += 1
          await new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(new TypeError('Failed to fetch')), { once: true })
          })
        },
      },
    ),
    error => error?.code === 'REQUEST_TIMEOUT',
  )
  // 超时不是可重试错误；旧 Profile 的 30000 也不应成为请求来源。
  assert.equal(requestCalls, 1)
})
test('World Model analyzer forwards request settings from its resolver', async () => {
  let requestCalls = 0
  const analyzer = createAnalyzer({
    profileResolver: () => SILLYTAVERN_CURRENT_API,
    requestSettingsResolver: () => ({ timeout: 180000, retry_count: 0 }),
    contextResolver: () => ({
      chatCompletionSettings: {
        chat_completion_source: 'openai',
        openai_max_tokens: 1200,
      },
      getChatCompletionModel: () => 'current-model',
      ChatCompletionService: {
        async processRequest() {
          requestCalls += 1
          const error = new Error('temporary server failure')
          error.status = 503
          throw error
        },
      },
    }),
  })
  await assert.rejects(analyzer.analyzeWorldModel({ analysisInput: {} }), error => error?.status === 503)
  assert.equal(requestCalls, 1)
})
test('current API connection test uses generateRaw without copying a host key', async () => {
  let rawOptions
  const result = await testProfile(SILLYTAVERN_CURRENT_API, {
    requestSettings: { retry_count: 0 },
    context: {
      async generateRaw(options) {
        rawOptions = options
        return 'OK'
      },
      getChatCompletionModel: () => 'current-model',
    },
  })
  assert.equal(result.ok, true)
  assert.equal(result.model, 'current-model')
  assert.equal(Array.isArray(rawOptions.prompt), true)
  assert.equal('api_key' in rawOptions, false)
})
test('current API world analysis does not pass an unsupported abort signal to generateRaw', async () => {
  let rawOptions
  const result = await callOpenAICompatible(SILLYTAVERN_CURRENT_API, [{ role: 'user', content: '测试' }], {
    requestSettings: { retry_count: 0 },
    context: {
      async generateRaw(options) {
        rawOptions = options
        return 'OK'
      },
    },
  })
  assert.equal(result, 'OK')
  assert.equal('signal' in rawOptions, false)
})
test('current API prefers the host chat completion service over generateRaw lifecycle hooks', async () => {
  let generateRawCalls = 0
  let requestCalls = 0
  let fetchCalls = 0
  let request
  const result = await callOpenAICompatible(
    SILLYTAVERN_CURRENT_API,
    [
      { role: 'system', content: '系统约束' },
      { role: 'assistant', content: '楼层资料' },
      { role: 'user', content: '开始分析' },
    ],
    {
      requestSettings: { retry_count: 0 },
      fetchRef: async () => {
        fetchCalls += 1
        throw new Error('current path must not use raw fetch')
      },
      context: {
        chatCompletionSettings: {
          chat_completion_source: 'openai',
          openai_max_tokens: 1200,
          temp_openai: 0.2,
        },
        getChatCompletionModel: () => 'current-model',
        async generateRaw() {
          generateRawCalls += 1
          throw new DOMException('The operation was aborted.', 'AbortError')
        },
        ChatCompletionService: {
          async processRequest(payload, _options, extractData, signal) {
            requestCalls += 1
            request = { payload, extractData, signal }
            return { content: 'OK' }
          },
        },
      },
    },
  )
  assert.deepEqual(result, { content: 'OK' })
  assert.equal(generateRawCalls, 0)
  assert.equal(fetchCalls, 0)
  assert.equal(requestCalls, 1)
  assert.equal(request.payload.stream, false)
  assert.equal(request.payload.model, 'current-model')
  assert.equal(request.payload.chat_completion_source, 'openai')
  assert.equal(request.payload.max_tokens, 1200)
  assert.deepEqual(request.payload.messages, [
    { role: 'system', content: '系统约束' },
    { role: 'assistant', content: '楼层资料' },
    { role: 'user', content: '开始分析' },
  ])
  assert.equal(request.extractData, true)
  assert.equal(request.signal?.aborted, false)
})
test('current API abort does not trigger an automatic second request', async () => {
  let requestCalls = 0
  await assert.rejects(
    callOpenAICompatible(SILLYTAVERN_CURRENT_API, [{ role: 'user', content: '测试' }], {
      requestSettings: { retry_count: 1 },
      context: {
        chatCompletionSettings: {
          chat_completion_source: 'openai',
          openai_max_tokens: 1200,
        },
        getChatCompletionModel: () => 'current-model',
        ChatCompletionService: {
          async processRequest() {
            requestCalls += 1
            throw new DOMException('The operation was aborted.', 'AbortError')
          },
        },
      },
    }),
    error => error?.code === 'REQUEST_ABORTED',
  )
  assert.equal(requestCalls, 1)
})
test('current API caller abort does not trigger an automatic second request', async () => {
  const controller = new AbortController()
  let requestCalls = 0
  const request = callOpenAICompatible(SILLYTAVERN_CURRENT_API, [{ role: 'user', content: '测试' }], {
    requestSettings: { retry_count: 1 },
    signal: controller.signal,
    context: {
      chatCompletionSettings: {
        chat_completion_source: 'openai',
        openai_max_tokens: 1200,
      },
      getChatCompletionModel: () => 'current-model',
      ChatCompletionService: {
        async processRequest(_payload, _options, _extractData, signal) {
          requestCalls += 1
          await new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')), { once: true })
          })
        },
      },
    },
  })
  await new Promise(resolve => setImmediate(resolve))
  controller.abort()
  await assert.rejects(request, error => error?.code === 'REQUEST_ABORTED')
  assert.equal(requestCalls, 1)
})
test('current API timeout-induced internal abort does not trigger an automatic second request', async () => {
  let requestCalls = 0
  await assert.rejects(
    callOpenAICompatible(SILLYTAVERN_CURRENT_API, [{ role: 'user', content: '测试' }], {
      requestSettings: { timeout: 250, retry_count: 1 },
      context: {
        chatCompletionSettings: {
          chat_completion_source: 'openai',
          openai_max_tokens: 1200,
        },
        getChatCompletionModel: () => 'current-model',
        ChatCompletionService: {
          async processRequest(_payload, _options, _extractData, signal) {
            requestCalls += 1
            await new Promise((_resolve, reject) => {
              signal.addEventListener('abort', () => reject(new TypeError('Failed to fetch')), { once: true })
            })
          },
        },
      },
    }),
    error => error?.code === 'REQUEST_TIMEOUT',
  )
  assert.equal(requestCalls, 1)
})
test('transient 5xx and network errors retain one retry', async () => {
  for (const firstError of [Object.assign(new Error('temporary server failure'), { status: 503 }), new TypeError('Failed to fetch')]) {
    let requestCalls = 0
    const result = await callOpenAICompatible(SILLYTAVERN_CURRENT_API, [{ role: 'user', content: '测试' }], {
      requestSettings: { retry_count: 1 },
      context: {
        chatCompletionSettings: {
          chat_completion_source: 'openai',
          openai_max_tokens: 1200,
        },
        getChatCompletionModel: () => 'current-model',
        ChatCompletionService: {
          async processRequest() {
            requestCalls += 1
            if (requestCalls === 1) throw firstError
            return { content: 'OK' }
          },
        },
      },
    })
    assert.deepEqual(result, { content: 'OK' })
    assert.equal(requestCalls, 2)
  }
})
test('global request settings override legacy Profile timeout and retry fields', async () => {
  let requestCalls = 0
  const result = await callOpenAICompatible(
    {
      api_url: 'https://api.example/v1',
      model: 'model-a',
      timeout: 10,
      retry_count: 0,
    },
    [{ role: 'user', content: '测试' }],
    {
      requestSettings: { timeout: 250, retry_count: 1 },
      fetchRef: async (_url, { signal }) => {
        requestCalls += 1
        if (requestCalls === 1) {
          return {
            ok: false,
            status: 503,
            async json() {
              return { error: 'temporary' }
            },
          }
        }
        await new Promise(resolve => setTimeout(resolve, 30))
        return {
          ok: true,
          status: 200,
          async json() {
            return { content: 'OK' }
          },
        }
      },
    },
  )
  assert.deepEqual(result, { content: 'OK' })
  assert.equal(requestCalls, 2)
})
test('timeout-induced internal abort does not trigger an automatic second request', async () => {
  for (const abortError of [new TypeError('Failed to fetch'), new DOMException('The operation was aborted.', 'AbortError')]) {
    let requestCalls = 0
    await assert.rejects(
      callOpenAICompatible(
        {
          api_url: 'https://api.example/v1',
          model: 'model-a',
          timeout: 10,
          retry_count: 1,
        },
        [{ role: 'user', content: '测试' }],
        {
          requestSettings: { timeout: 250, retry_count: 1 },
          fetchRef: async (_url, { signal }) => {
            requestCalls += 1
            await new Promise((_resolve, reject) => {
              signal.addEventListener('abort', () => reject(abortError), {
                once: true,
              })
            })
          },
        },
      ),
      error => error?.code === 'REQUEST_TIMEOUT',
    )
    assert.equal(requestCalls, 1)
  }
})
test('host abort variants are normalized without exposing the raw aborted message', async () => {
  await assert.rejects(
    callOpenAICompatible(SILLYTAVERN_CURRENT_API, [{ role: 'user', content: '测试' }], {
      requestSettings: { retry_count: 0 },
      context: {
        async generateRaw() {
          throw new Error('aborted')
        },
      },
    }),
    error => error?.code === 'REQUEST_ABORTED',
  )
  assert.equal(safeErrorSummary(new Error('aborted')), '请求已取消')
})
test('generation diagnostics classify HTTP statuses before timeout-like host errors', async () => {
  const expected = new Map([
    [400, 'http-400'],
    [401, 'auth'],
    [403, 'auth'],
    [404, 'not-found'],
    [429, 'rate-limit'],
    [500, 'server'],
    [502, 'server'],
    [503, 'server'],
  ])
  for (const [status, diagnostic] of expected) {
    const error = Object.assign(new Error('REQUEST_TIMEOUT / aborted'), {
      code: 'REQUEST_TIMEOUT',
      status,
    })
    assert.equal(classifyGenerationError(error), diagnostic)
    assert.match(diagnosticMessage(error), new RegExp(`HTTP ${status}`))
    assert.doesNotMatch(safeErrorSummary(error), /超时/)
    await assert.rejects(
      callOpenAICompatible(
        SILLYTAVERN_CURRENT_API,
        [{ role: 'user', content: '测试' }],
        currentApiContext({
          ok: false,
          status,
          async json() {
            return { error: 'Bearer DO-NOT-SHOW' }
          },
        }),
      ),
      error => {
        assert.equal(error.status, status)
        assert.equal(error.diagnosticCode, diagnostic)
        assert.equal(error.diagnostic_code, diagnostic)
        assert.equal(error.error_code, diagnostic)
        assert.match(safeErrorSummary(error), new RegExp(`HTTP ${status}`))
        assert.doesNotMatch(error.message, /DO-NOT-SHOW/)
        return true
      },
    )
  }
})
test('response-like generation results reject error envelopes, invalid JSON, and upstream timeout templates', async () => {
  assert.equal(isUpstreamTimeoutTemplate(UPSTREAM_TIMEOUT_BODY), true)
  assert.equal(isUpstreamTimeoutTemplate(`${UPSTREAM_TIMEOUT_BODY}\nquoted tail`), false)
  const scenarios = [
    {
      name: 'response error',
      result: {
        ok: true,
        status: 200,
        async json() {
          return { error: 'Bearer DO-NOT-SHOW' }
        },
      },
      diagnostic: 'response-error',
    },
    {
      name: 'response error with an inconsistent ok flag',
      result: {
        ok: false,
        status: 200,
        async json() {
          return { error: 'Bearer DO-NOT-SHOW' }
        },
      },
      diagnostic: 'response-error',
    },
    {
      name: 'invalid JSON',
      result: {
        ok: true,
        status: 200,
        async json() {
          throw new SyntaxError('unexpected token DO-NOT-SHOW')
        },
      },
      diagnostic: 'invalid-json',
    },
    {
      name: 'upstream timeout',
      result: {
        ok: true,
        status: 200,
        async json() {
          return UPSTREAM_TIMEOUT_BODY
        },
      },
      diagnostic: 'upstream-timeout',
    },
    {
      name: 'response read network failure',
      result: {
        ok: true,
        status: 200,
        async json() {
          throw new TypeError('Failed to fetch')
        },
      },
      diagnostic: 'network',
    },
  ]
  for (const scenario of scenarios) {
    await assert.rejects(
      callOpenAICompatible(SILLYTAVERN_CURRENT_API, [{ role: 'user', content: '测试' }], currentApiContext(scenario.result)),
      error => {
        assert.equal(error.status, 200)
        assert.equal(error.diagnosticCode, scenario.diagnostic, scenario.name)
        assert.equal(error.diagnostic_code, scenario.diagnostic, scenario.name)
        assert.equal(error.error_code, scenario.diagnostic, scenario.name)
        assert.match(safeErrorSummary(error), /HTTP 200/)
        assert.doesNotMatch(safeErrorSummary(error), /DO-NOT-SHOW/)
        return true
      },
    )
  }
})
test('local timeout remains timeout while reading an HTTP 200 response', async () => {
  let processCalls = 0
  await assert.rejects(
    callOpenAICompatible(SILLYTAVERN_CURRENT_API, [{ role: 'user', content: '测试' }], {
      requestSettings: { timeout: 250, retry_count: 0 },
      context: {
        chatCompletionSettings: {
          chat_completion_source: 'openai',
          openai_max_tokens: 1200,
        },
        getChatCompletionModel: () => 'current-model',
        ChatCompletionService: {
          async processRequest() {
            processCalls += 1
            return {
              ok: true,
              status: 200,
              json: () => new Promise(() => {}),
            }
          },
        },
      },
    }),
    error => {
      assert.equal(error.code, 'REQUEST_TIMEOUT')
      assert.equal(error.diagnosticCode, 'timeout')
      assert.equal(error.diagnostic_code, 'timeout')
      assert.equal(error.status, 200)
      assert.equal(error.phase, 'response')
      assert.equal(error.timedOut, true)
      assert.equal(error.timeout_ms, 250)
      assert.match(safeErrorSummary(error), /HTTP 200/)
      assert.match(safeErrorSummary(error), /超时/)
      return true
    },
  )
  assert.equal(processCalls, 1)
})
test('local timeout remains timeout while reading an HTTP 200 SSE stream', async () => {
  await assert.rejects(
    callOpenAICompatible(SILLYTAVERN_CURRENT_API, [{ role: 'user', content: '测试' }], {
      requestSettings: { timeout: 250, retry_count: 0 },
      context: {
        chatCompletionSettings: {
          chat_completion_source: 'openai',
          openai_max_tokens: 1200,
        },
        getChatCompletionModel: () => 'current-model',
        ChatCompletionService: {
          async processRequest() {
            return {
              ok: true,
              status: 200,
              body: {
                getReader() {
                  return {
                    read: () => new Promise(() => {}),
                    releaseLock() {},
                  }
                },
              },
            }
          },
        },
      },
    }),
    error => {
      assert.equal(error.code, 'REQUEST_TIMEOUT')
      assert.equal(error.diagnosticCode, 'timeout')
      assert.equal(error.status, 200)
      assert.equal(error.phase, 'response')
      assert.equal(error.timedOut, true)
      assert.match(safeErrorSummary(error), /HTTP 200/)
      assert.match(safeErrorSummary(error), /超时/)
      return true
    },
  )
})
test('status-bearing abort-like host errors keep their original name, code, and cause', async () => {
  const cause = new TypeError('socket detail must remain internal')
  await assert.rejects(
    callOpenAICompatible(
      SILLYTAVERN_CURRENT_API,
      [{ role: 'user', content: '测试' }],
      currentApiContext(() => {
        const error = Object.assign(new Error('timeout-like host failure'), {
          name: 'AbortError',
          code: 'ABORT_ERR',
          status: 503,
          cause,
        })
        throw error
      }),
    ),
    error => {
      assert.equal(error.name, 'AbortError')
      assert.equal(error.code, 'ABORT_ERR')
      assert.equal(error.status, 503)
      assert.equal(error.cause, cause)
      assert.equal(error.diagnosticCode, 'server')
      assert.match(safeErrorSummary(error), /HTTP 503/)
      assert.doesNotMatch(safeErrorSummary(error), /超时/)
      return true
    },
  )
})
test('network failures stay network and retryable HTTP statuses retain existing retry behavior', async () => {
  await assert.rejects(
    callOpenAICompatible(
      SILLYTAVERN_CURRENT_API,
      [{ role: 'user', content: '测试' }],
      currentApiContext(async () => {
        throw new TypeError('Failed to fetch')
      }),
    ),
    error => {
      assert.equal(error.diagnosticCode, 'network')
      assert.equal(error.diagnostic_code, 'network')
      assert.equal(classifyGenerationError(error), 'network')
      assert.doesNotMatch(safeErrorSummary(error), /超时/)
      return true
    },
  )
  for (const status of [429, 500]) {
    let calls = 0
    const result = await callOpenAICompatible(SILLYTAVERN_CURRENT_API, [{ role: 'user', content: '测试' }], {
      requestSettings: { retry_count: 1 },
      context: {
        chatCompletionSettings: {
          chat_completion_source: 'openai',
          openai_max_tokens: 1200,
        },
        getChatCompletionModel: () => 'current-model',
        ChatCompletionService: {
          async processRequest() {
            calls += 1
            if (calls === 1)
              return {
                ok: false,
                status,
                async json() {
                  return { error: 'temporary' }
                },
              }
            return { content: 'OK' }
          },
        },
      },
    })
    assert.deepEqual(result, { content: 'OK' })
    assert.equal(calls, 2)
  }
})
test('diagnostic error construction keeps safe metadata without exposing a response body', () => {
  const cause = new SyntaxError('Bearer DO-NOT-SHOW')
  const error = makeDiagnosticError('invalid-json', {
    status: 200,
    phase: 'response',
    attempt: 2,
    cause,
  })
  assert.equal(error.diagnosticCode, 'invalid-json')
  assert.equal(error.diagnostic_code, 'invalid-json')
  assert.equal(error.error_code, 'invalid-json')
  assert.equal(error.status, 200)
  assert.equal(error.phase, 'response')
  assert.equal(error.attempt, 2)
  assert.equal(error.cause, cause)
  assert.doesNotMatch(error.message, /DO-NOT-SHOW/)
})
test('model refresh uses the SillyTavern custom status endpoint with only an opaque secret reference', async () => {
  let request
  const models = await fetchModels(
    {
      api_url: 'https://api.example/v1/chat/completions',
      secret_ref: 'opaque-secret-id',
    },
    {
      requestSettings: { retry_count: 0 },
      context: {
        getRequestHeaders: () => ({ 'X-CSRF-Token': 'csrf-token' }),
      },
      fetchRef: async (url, options) => {
        request = { url, options }
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              data: [{ id: 'model-b' }, { id: 'model-a' }, { id: 'model-a' }],
            }
          },
        }
      },
    },
  )
  assert.deepEqual(models, ['model-a', 'model-b'])
  assert.equal(request.url, '/api/backends/chat-completions/status')
  assert.equal(request.options.headers['X-CSRF-Token'], 'csrf-token')
  const body = JSON.parse(request.options.body)
  assert.deepEqual(body, {
    chat_completion_source: 'custom',
    custom_url: 'https://api.example/v1',
    secret_id: 'opaque-secret-id',
  })
  assert.equal(JSON.stringify(body).includes('api_key'), false)
})
test('model refresh failures are safe and do not expose upstream error text', async () => {
  await assert.rejects(
    fetchModels(
      {
        api_url: 'https://api.example/v1',
        secret_ref: 'opaque-secret-id',
      },
      {
        requestSettings: { retry_count: 0 },
        fetchRef: async () => ({
          ok: false,
          status: 401,
          statusText: 'Bearer DO-NOT-SHOW',
          async json() {
            return { error: 'Bearer DO-NOT-SHOW' }
          },
        }),
      },
    ),
    error => {
      assert.equal(error.code, 'API_MODELS_HTTP_ERROR')
      assert.equal(error.status, 401)
      assert.equal(error.diagnosticCode, 'auth')
      assert.equal(error.cause?.status, 401)
      assert.equal(error.cause?.code, 'API_MODELS_HTTP_ERROR')
      assert.equal(error.message.includes('DO-NOT-SHOW'), false)
      assert.doesNotMatch(error.message, /超时/)
      return true
    },
  )
})
test('settings markup exposes basic API fields, assignments, password input, and safe result text', () => {
  const html = settingsPage({
    apiSource: BIOWEAVE_INDEPENDENT_API,
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
    assignments: { world_analysis: 'stable' },
    editingProfile: {
      profile_id: 'stable',
      name: 'Stable',
      provider: 'custom',
      api_url: 'https://api.example/v1',
      model: 'model-a',
      secret_ref: 'opaque-secret-id',
      api_key: 'NOT-IN-MARKUP',
    },
    testResult: { ok: false, error: '认证失败（HTTP 401）' },
  })
  for (const field of ['name', 'api_url', 'model']) {
    assert.match(html, new RegExp(`name="${field}"`))
  }
  assert.doesNotMatch(html, /name="provider"/)
  for (const field of ['context_size', 'max_output_tokens', 'temperature']) {
    assert.doesNotMatch(html, new RegExp(`name="${field}"`))
  }
  assert.match(html, /<input class="bioweave-input" name="timeout" type="number" value="180"/)
  assert.match(html, /<input class="bioweave-input" name="retry_count" type="number" value="1"/)
  assert.match(html, /超时（秒）/)
  assert.match(html, /重试次数/)
  assert.equal(html.includes('bioweave-settings-advanced'), false)
  assert.match(html, /name="api_key" type="password" value=""/)
  assert.match(html, /bioweave-api-profile-summary/)
  assert.match(html, /连接模式.*独立 API/)
  assert.match(html, /密钥状态.*已保存/)
  for (const slot of ['world_analysis', 'event_analysis', 'projection', 'history_scan']) {
    assert.match(html, new RegExp(`data-bioweave-assignment="${slot}"`))
  }
  assert.match(html, /使用 SillyTavern 当前 API/)
  assert.equal(html.includes('NOT-IN-MARKUP'), false)
  const profileListStart = html.indexOf('<section class="bioweave-card bioweave-profile-list">')
  const profileEditorStart = html.indexOf('<section class="bioweave-card bioweave-settings-editor">')
  const profileListMarkup = html.slice(profileListStart, profileEditorStart)
  assert.match(profileListMarkup, /<strong>Stable<\/strong>/)
  assert.doesNotMatch(profileListMarkup, /custom|model-a|api\.example|API 密钥|Secret Store/)
})
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
    assignments: { world_analysis: FOLLOW_DEFAULT_API },
    editingProfile: { profile_id: 'stable', secret_ref: 'opaque-secret-id' },
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
    apiRequestSettings: { timeout: 45000, retry_count: 2 },
  })
  assert.match(html, /value="Draft Name"/)
  assert.match(html, /value="https:\/\/draft\.example\/v1"/)
  assert.match(html, /value="draft-model"/)
  assert.match(html, /name="timeout" type="number" value="45"/)
  assert.match(html, /name="retry_count" type="number" value="2"/)
  assert.match(html, /name="api_key" type="password" value="DRAFT-KEY"/)
  assert.match(html, /value="default" selected/)
  assert.match(html, /value="bioweave"[^>]*checked/)
  const apiSourceIndex = html.indexOf('<section class="bioweave-card bioweave-api-source">')
  const sourceOptionsIndex = html.indexOf('<div class="bioweave-source-options">')
  const requestSettingsIndex = html.indexOf('data-bioweave-api-request-settings')
  const requestModuleTitleIndex = html.indexOf('<h3>请求设置</h3>')
  const connectionSettingsIndex = html.indexOf('<h3>连接设置</h3>')
  const connectionModuleIndex = html.indexOf('bioweave-api-source-module bioweave-api-connection-settings')
  const profileFormIndex = html.indexOf('<form data-bioweave-settings-form')
  assert.ok(requestSettingsIndex > apiSourceIndex)
  assert.ok(sourceOptionsIndex > apiSourceIndex)
  assert.ok(requestSettingsIndex > sourceOptionsIndex)
  assert.equal(requestModuleTitleIndex, -1)
  assert.equal(connectionSettingsIndex, -1)
  assert.equal(connectionModuleIndex, -1)
  assert.ok(profileFormIndex > requestSettingsIndex)
  assert.equal(html.slice(profileFormIndex).includes('data-bioweave-api-timeout'), false)
  assert.equal(html.slice(profileFormIndex).includes('data-bioweave-api-retry-count'), false)
  assert.equal(html.includes('bioweave-settings-advanced'), false)
  assert.equal(html.includes('Context Size'), false)
  assert.equal(html.includes('Max Output Tokens'), false)
  assert.equal(html.includes('Temperature'), false)
})
test('independent API configuration is a flat panel inside API source', () => {
  const html = settingsPage({
    apiSource: BIOWEAVE_INDEPENDENT_API,
    profiles: {
      stable: {
        profile_id: 'stable',
        name: 'Stable',
        api_url: 'https://api.example/v1',
        model: 'model-a',
        secret_ref: 'opaque-secret-id',
      },
    },
  })
  const apiDisclosureIndex = html.search(/<details class="bioweave-settings-disclosure(?: bioweave-settings-group)? bioweave-api-source-disclosure"/)
  const apiSourceIndex = html.indexOf('<section class="bioweave-card bioweave-api-source">')
  const profilesIndex = html.indexOf('<section class="bioweave-api-profiles">')
  const assignmentsIndex = html.indexOf('<section class="bioweave-card bioweave-assignments">')
  assert.ok(apiDisclosureIndex >= 0)
  assert.ok(apiSourceIndex > apiDisclosureIndex)
  assert.ok(profilesIndex > apiSourceIndex)
  assert.ok(assignmentsIndex > profilesIndex)
  assert.match(html, /<h3>独立 API 配置<\/h3>/)
  assert.match(html, /data-bioweave-api-request-settings/)
  assert.match(html, /name="timeout" type="number" value="180"/)
  assert.match(html, /data-bioweave-action="new-profile"[^>]*>新建 API 配置<\/button>/)
  assert.match(html, /bioweave-api-security-note/)
  assert.equal(html.includes('安全边界'), false)
  assert.equal(
    html.includes('<details class="bioweave-settings-disclosure bioweave-api-source-disclosure" data-bioweave-settings-disclosure="api" open>'),
    false,
  )
  assert.equal(html.includes('<details class="bioweave-api-profiles"'), false)
  assert.equal(html.includes('独立 API Profiles'), false)
})
test('analysis prompt settings expose reference labels without duplicate headings or secrets', () => {
  const html = settingsPage({
    analysisPrompt: {
      system_top: '顶部内容',
      task: '只检查能力证据',
      input_prefix: '这是可编辑前言',
      input_suffix: '这是可编辑后记',
      system_bottom: '尾部内容',
      labels: { character: '角色资料' },
    },
  })
  assert.match(html, /分析提示词/)
  assert.match(html, /顶部 SYSTEM/)
  assert.match(html, /分析任务补充/)
  assert.doesNotMatch(html, /世界分析提示词与标签/)
  assert.doesNotMatch(html, /第一个 SYSTEM/)
  assert.doesNotMatch(html, /最后一个 SYSTEM/)
  assert.equal((html.match(/<h3>分析提示词<\/h3>/g) ?? []).length, 0)
  assert.match(html, /data-bioweave-analysis-prompt-field="system_top"[^>]*>顶部内容/)
  assert.match(html, /data-bioweave-analysis-prompt-field="task"[^>]*>只检查能力证据/)
  assert.match(html, /data-bioweave-analysis-prompt-field="system_bottom"[^>]*>尾部内容/)
  assert.equal(html.includes('输入分段名称'), false)
  assert.equal(html.includes('data-bioweave-analysis-label'), false)
  assert.match(html, /data-bioweave-action="save-analysis-prompt"/)
  assert.equal(html.includes('api_key'), false)
})
test('analysis prompt draft remains visible after a failed save render', () => {
  const html = settingsPage({
    analysisPrompt: { task: '已保存内容' },
    analysisPromptDraft: { task: '当前编辑内容' },
  })
  assert.match(html, /data-bioweave-analysis-prompt-field="task"[^>]*>当前编辑内容/)
  assert.doesNotMatch(html, /data-bioweave-analysis-prompt-field="task"[^>]*>已保存内容/)
})
test('analysis prompt settings persist as global editable text only', async () => {
  let globalSettings = {}
  const profileStore = createApiProfileStore({
    getGlobalSettings: () => globalSettings,
    async saveGlobalSettings(value) {
      globalSettings = value
    },
  })
  const saved = await profileStore.saveAnalysisPrompt({
    system_top: '顶部补充',
    task: '只分析输入证据',
    input_prefix: '自定义前言',
    input_suffix: '',
    system_bottom: '尾部补充',
    labels: { character: '角色资料' },
    api_key: 'NEVER-PERSIST',
  })
  assert.equal(saved.task, '只分析输入证据')
  assert.equal(saved.input_prefix, '自定义前言')
  assert.equal(saved.system_top, '顶部补充')
  assert.equal(saved.system_bottom, '尾部补充')
  assert.equal(saved.labels.character, '角色资料')
  assert.equal(JSON.stringify(globalSettings).includes('NEVER-PERSIST'), false)
  assert.equal(profileStore.getAnalysisPrompt().task, '只分析输入证据')
  assert.ok(globalSettings.analysis_prompt)
  assert.equal('world_analysis_prompt' in globalSettings, false)
})
test('legacy World Analysis prompt migrates to canonical analysis prompt storage', async () => {
  let globalSettings = {
    world_analysis_prompt: {
      task: '旧任务',
      input_prefix: '旧前言',
      input_suffix: '旧后记',
      labels: { character: '旧角色标签' },
    },
  }
  const profileStore = createApiProfileStore({
    getGlobalSettings: () => globalSettings,
    async saveGlobalSettings(value) {
      globalSettings = value
    },
  })
  const legacyPrompt = profileStore.getAnalysisPrompt()
  assert.equal(legacyPrompt.system_top, '')
  assert.equal(legacyPrompt.system_bottom, '')
  assert.equal(globalSettings.world_analysis_prompt.system_top, undefined)
  assert.equal(globalSettings.world_analysis_prompt.system_bottom, undefined)
  const saved = await profileStore.saveAnalysisPrompt({
    system_top: 'TOP',
    system_bottom: 'BOTTOM',
    task: undefined,
    input_prefix: undefined,
    input_suffix: undefined,
    labels: undefined,
  })
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
  })
  assert.equal(profileStore.getAnalysisPrompt().task, '旧任务')
  assert.equal(profileStore.getAnalysisPrompt().input_prefix, '旧前言')
  assert.equal(profileStore.getAnalysisPrompt().input_suffix, '旧后记')
  assert.ok(globalSettings.analysis_prompt)
  assert.equal('world_analysis_prompt' in globalSettings, false)
})
test('model picker renders its current list and closes after selection', () => {
  const html = settingsPage({
    apiSource: BIOWEAVE_INDEPENDENT_API,
    editingProfile: { profile_id: 'stable' },
    editingDraft: { profile_id: 'stable', model: 'model-a' },
    modelList: ['model-a', 'model-b'],
    modelListProfileKey: 'stable',
  })
  assert.equal(html.includes('data-bioweave-model-details'), false)
  assert.match(html, /模型.*data-bioweave-model-trigger/)
  assert.match(html, /data-bioweave-model-trigger[^>]*aria-expanded="false"/)
  assert.match(html, /data-bioweave-model-trigger[^>]*aria-controls="bioweave-model-dropdown"/)
  assert.match(html, /data-bioweave-model-dropdown[^>]* hidden/)
  assert.match(html, /data-bioweave-action="refresh-models"/)
  assert.ok(html.indexOf('data-bioweave-action="refresh-models"') < html.indexOf('data-bioweave-model-dropdown'))
  assert.match(html, />刷新模型</)
  assert.match(html, /data-bioweave-model-search/)
  assert.match(html, /搜索模型/)
  assert.match(html, /data-bioweave-model-item/)
  assert.match(html, /model-b/)
  const dropdown = { hidden: false }
  const trigger = {
    ariaExpanded: null,
    setAttribute(name, value) {
      if (name === 'aria-expanded') this.ariaExpanded = value
    },
  }
  const picker = {
    querySelector(selector) {
      if (selector === '[data-bioweave-model-dropdown]') return dropdown
      if (selector === '[data-bioweave-model-trigger]') return trigger
      return null
    },
  }
  const modelItem = {
    closest(selector) {
      assert.equal(selector, '[data-bioweave-model-picker]')
      return picker
    },
  }
  assert.equal(closeModelPicker(modelItem), true)
  assert.equal(dropdown.hidden, true)
  assert.equal(trigger.ariaExpanded, 'false')
})

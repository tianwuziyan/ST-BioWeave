import {
  DEFAULT_API_REQUEST_SETTINGS,
  SILLYTAVERN_CURRENT_API,
  normalizeApiProfile,
  normalizeApiRequestSettings,
} from '../storage/schema.js';

const NO_SECRET_ID = '__bioweave_no_secret__';
const MODELS_STATUS_ENDPOINT = '/api/backends/chat-completions/status';
const SAFE_MODEL_ERROR_CODES = new Set([
  'API_MODELS_EMPTY',
  'API_MODELS_RESPONSE_INVALID',
  'API_MODELS_FETCH_UNAVAILABLE',
  'API_MODELS_HTTP_ERROR',
  'API_PROFILE_INVALID',
  'REQUEST_TIMEOUT',
  'REQUEST_ABORTED',
]);

function now() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function hostContext(context) {
  return context ?? globalThis.SillyTavern?.getContext?.() ?? null;
}

function isCurrentApi(profile) {
  if (profile === SILLYTAVERN_CURRENT_API || profile === 'current' || profile === 'current_api') return true;
  return profile?.mode === SILLYTAVERN_CURRENT_API
    || profile?.mode === 'current'
    || profile?.use_sillytavern === true;
}

function numeric(value, fallback, min, max, integer = false) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const bounded = Math.min(max, Math.max(min, parsed));
  return integer ? Math.round(bounded) : bounded;
}

function requestTimeout(requestSettings) {
  return numeric(requestSettings.timeout, DEFAULT_API_REQUEST_SETTINGS.timeout, 250, 600000, true);
}

function retryCount(requestSettings) {
  return numeric(requestSettings.retry_count, DEFAULT_API_REQUEST_SETTINGS.retry_count, 0, 3, true);
}

function statusFromError(error) {
  const value = Number(error?.status ?? error?.statusCode ?? error?.response?.status);
  if (Number.isInteger(value) && value >= 100 && value <= 599) return value;
  const match = String(error?.code ?? '').match(/(?:HTTP|STATUS)[_ -]?(\d{3})/i)
    ?? String(error?.message ?? '').match(/(?:HTTP|STATUS)[_ -]?(\d{3})/i);
  return match ? Number(match[1]) : null;
}

function isAbortError(error) {
  const code = String(error?.code ?? '').trim().toUpperCase();
  const message = String(error?.message ?? error?.reason ?? '').trim();
  return error?.name === 'AbortError'
    || ['REQUEST_ABORTED', 'ABORTED', 'ERR_ABORTED', 'ABORT_ERR', 'ERR_CANCELED', 'ERR_CANCELLED'].includes(code)
    || /\b(?:abort(?:ed|ing)?|canceled|cancelled)\b/i.test(message);
}

function isTimeoutError(error) {
  return error?.code === 'REQUEST_TIMEOUT' || error?.bioweaveTimeout === true;
}

function isRetryable(error) {
  if (isAbortError(error) || isTimeoutError(error)) return false;
  const status = statusFromError(error);
  if (status != null) return status >= 500;
  if (error?.code === 'ECONNRESET' || error?.code === 'ECONNREFUSED' || error?.code === 'ETIMEDOUT') return true;
  return error?.name === 'TypeError' || /network|fetch failed|connection/i.test(String(error?.message ?? ''));
}

function timeoutError() {
  const error = new Error('REQUEST_TIMEOUT');
  error.code = 'REQUEST_TIMEOUT';
  error.bioweaveTimeout = true;
  return error;
}

function abortedError() {
  const error = new Error('REQUEST_ABORTED');
  error.code = 'REQUEST_ABORTED';
  return error;
}

async function waitBeforeRetry(attempt, signal) {
  const delay = Math.min(1000, 150 * (2 ** attempt));
  if (signal?.aborted) throw abortedError();
  await new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, delay);
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', abort);
      reject(abortedError());
    };
    signal?.addEventListener?.('abort', abort, {once: true});
  });
}

async function runWithTimeout(operation, {signal, timeout}) {
  const controller = new AbortController();
  let timedOut = false;
  let timer = null;
  const abort = () => controller.abort();
  signal?.addEventListener?.('abort', abort, {once: true});
  if (signal?.aborted) throw abortedError();
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(timeoutError());
    }, timeout);
  });
  const operationPromise = Promise.resolve().then(() => operation(controller.signal));
  try {
    return await Promise.race([operationPromise, timeoutPromise]);
  } catch (error) {
    if (timedOut) throw timeoutError();
    if (signal?.aborted) throw abortedError();
    // fetch 在内部 controller.abort() 后可能返回原生 TypeError，而不是 AbortError；按超时归类。
    if (controller.signal.aborted) throw timeoutError();
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
    signal?.removeEventListener?.('abort', abort);
  }
}

async function requestWithRetry(operation, options = {}) {
  const signal = options.signal;
  const requestSettings = normalizeApiRequestSettings(options.requestSettings);
  const attempts = retryCount(requestSettings) + 1;
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await runWithTimeout(operation, {
        signal,
        timeout: requestTimeout(requestSettings),
      });
    } catch (error) {
      lastError = error;
      if (attempt >= attempts - 1 || !isRetryable(error)) throw error;
      await waitBeforeRetry(attempt, signal);
    }
  }
  throw lastError ?? new Error('API_REQUEST_FAILED');
}

function safeModel(model, fallback = 'configured model') {
  const value = String(model ?? '').trim();
  if (!value) return fallback;
  return redactSecrets(value).slice(0, 160);
}

export function redactSecrets(value) {
  return String(value ?? '')
    .replace(/(bearer\s+)[^\s,;"'}]+/gi, '$1[redacted]')
    .replace(/([?&](?:api[_-]?key|authorization|access[_-]?token|refresh[_-]?token|secret|token)=)[^&\s]+/gi, '$1[redacted]')
    .replace(/(["']?(?:api[_-]?key|authorization|secret|token)["']?\s*[:=]\s*["']?)[^\s,"'}]+/gi, '$1[redacted]');
}

export function safeErrorSummary(error) {
  if (isTimeoutError(error)) return '请求超时，请检查地址或延长超时设置';
  if (isAbortError(error)) return '请求已取消';
  const status = statusFromError(error);
  if (status != null) {
    if (status === 401 || status === 403) return `认证失败（HTTP ${status}）`;
    if (status === 400 || status === 404) return `配置或地址错误（HTTP ${status}）`;
    if (status >= 500) return `服务暂时不可用（HTTP ${status}）`;
    return `连接失败（HTTP ${status}）`;
  }
  const code = String(error?.code ?? '').toUpperCase();
  if (code === 'ST_CHAT_COMPLETION_UNAVAILABLE') return 'SillyTavern ChatCompletionService 不可用';
  if (code === 'ST_CURRENT_API_UNAVAILABLE') return 'SillyTavern 当前 API 不可用';
  if (code === 'API_PROFILE_INVALID') return 'API Profile 配置不完整';
  if (code === 'API_MODELS_EMPTY') return '未找到可用模型';
  if (code === 'API_MODELS_RESPONSE_INVALID') return '模型列表响应无效';
  if (code === 'API_MODELS_FETCH_UNAVAILABLE') return '模型列表请求不可用';
  return redactSecrets('连接失败，请检查 API 地址、模型和权限').slice(0, 180);
}

export const redactError = safeErrorSummary;

function messagesForRequest(messages) {
  if (Array.isArray(messages) && messages.length) return messages;
  return [{role: 'user', content: 'Reply OK.'}];
}

function apiUrlFrom(profile) {
  return String(profile?.api_url ?? profile?.base_url ?? profile?.custom_url ?? '').trim();
}

function setDefinedRequestField(target, key, value) {
  if (value === undefined || value === null || value === '') return;
  target[key] = value;
}

async function currentApiRequest(profile, messages, context) {
  const settings = context?.chatCompletionSettings;
  if (!settings || typeof settings !== 'object') return null;
  const service = context?.ChatCompletionService;
  if (typeof service?.processRequest !== 'function') return null;
  const source = String(settings.chat_completion_source ?? settings.chatCompletionSource ?? 'openai').trim() || 'openai';
  const model = typeof context?.getChatCompletionModel === 'function'
    ? await context.getChatCompletionModel()
    : settings.openai_model ?? settings.custom_model ?? settings.model;
  if (!String(model ?? '').trim()) return null;

  const outputTokens = profile && typeof profile === 'object'
    ? profile.max_output_tokens ?? settings.openai_max_tokens
    : settings.openai_max_tokens;
  const request = {
    stream: false,
    messages: messagesForRequest(messages),
    model: String(model).trim(),
    chat_completion_source: source,
    max_tokens: numeric(outputTokens, 4096, 1, 10000000, true),
    temperature: numeric(settings.temp_openai ?? settings.temperature, 0.2, 0, 2),
  };

  const settingFields = {
    frequency_penalty: settings.freq_openai,
    presence_penalty: settings.pres_openai,
    top_p: settings.top_p_openai,
    top_k: settings.top_k_openai,
    min_p: settings.min_p_openai,
    top_a: settings.top_a_openai,
    repetition_penalty: settings.repetition_penalty_openai,
    reasoning_effort: settings.reasoning_effort,
    verbosity: settings.verbosity,
    include_reasoning: settings.show_thoughts,
    enable_web_search: settings.enable_web_search,
    request_images: settings.request_images,
    request_image_resolution: settings.request_image_resolution,
    request_image_aspect_ratio: settings.request_image_aspect_ratio,
    use_sysprompt: settings.use_sysprompt,
    custom_prompt_post_processing: settings.custom_prompt_post_processing,
  };
  for (const [key, value] of Object.entries(settingFields)) setDefinedRequestField(request, key, value);

  // 只复制当前 SillyTavern 请求所需的连接参数；不把整份宿主设置或密钥写入消息、Chat 数据或调试预览。
  const connectionFields = [
    'reverse_proxy',
    'proxy_password',
    'custom_url',
    'custom_include_body',
    'custom_exclude_body',
    'custom_include_headers',
    'azure_base_url',
    'azure_deployment_name',
    'azure_api_version',
    'vertexai_auth_mode',
    'vertexai_region',
    'vertexai_express_project_id',
    'siliconflow_endpoint',
    'minimax_endpoint',
    'zai_endpoint',
    'workers_ai_account_id',
  ];
  for (const key of connectionFields) setDefinedRequestField(request, key, settings[key]);

  if (Array.isArray(settings.openrouter_providers) && settings.openrouter_providers.length) {
    request.provider = settings.openrouter_providers;
  }
  if (Array.isArray(settings.openrouter_quantizations) && settings.openrouter_quantizations.length) {
    request.quantizations = settings.openrouter_quantizations;
  }
  setDefinedRequestField(request, 'allow_fallbacks', settings.openrouter_allow_fallbacks);
  setDefinedRequestField(request, 'use_fallback', settings.openrouter_use_fallback);
  setDefinedRequestField(request, 'middleout', settings.openrouter_middleout);
  return {service, request};
}

async function runCurrentApi(profile, messages, context, signal) {
  const currentRequest = await currentApiRequest(profile, messages, context);
  if (currentRequest) {
    // ChatCompletionService 不挂接 GENERATION_STOPPED，避免宿主结束主楼生成时取消本次分析。
    return currentRequest.service.processRequest(currentRequest.request, {}, true, signal);
  }
  if (typeof context?.generateRaw !== 'function') throw new Error('ST_CURRENT_API_UNAVAILABLE');
  // 兼容没有公开 ChatCompletionService 的旧版 SillyTavern；取消仍由宿主自身管理。
  return context.generateRaw({
    prompt: messagesForRequest(messages),
    responseLength: numeric(profile?.max_output_tokens, 4096, 1, 10000000, true),
  });
}

async function runIndependentApi(profile, messages, context, signal) {
  const apiUrl = apiUrlFrom(profile);
  if (!apiUrl || !profile.model) {
    const error = new Error('API_PROFILE_INVALID');
    error.code = 'API_PROFILE_INVALID';
    throw error;
  }
  const service = context?.ChatCompletionService;
  if (typeof service?.processRequest !== 'function') {
    const error = new Error('ST_CHAT_COMPLETION_UNAVAILABLE');
    error.code = 'ST_CHAT_COMPLETION_UNAVAILABLE';
    throw error;
  }
  return service.processRequest({
    stream: false,
    messages: messagesForRequest(messages),
    model: profile.model,
    chat_completion_source: 'custom',
    custom_url: apiUrl,
    // SillyTavern 的 custom backend 在省略 secret_id 时会使用当前
    // api_key_custom；sentinel 可以阻止无 Key Profile 意外落到宿主当前 Key。
    secret_id: profile.secret_ref || NO_SECRET_ID,
    max_tokens: numeric(profile.max_output_tokens, 4096, 1, 10000000, true),
    temperature: numeric(profile.temperature, 0.2, 0, 2),
  }, {}, true, signal);
}

function modelName(item) {
  if (typeof item === 'string') return item.trim();
  if (!item || typeof item !== 'object') return '';
  for (const field of ['id', 'model', 'name']) {
    if (typeof item[field] !== 'string') continue;
    const value = item[field].trim();
    if (value) return value;
  }
  return '';
}

function modelList(payload) {
  const items = [];
  if (Array.isArray(payload)) {
    items.push(...payload);
  } else if (payload && typeof payload === 'object') {
    for (const field of ['data', 'models']) {
      const value = payload[field];
      if (Array.isArray(value)) items.push(...value);
      else if (typeof value === 'string') items.push(value);
    }
  }

  const unique = new Set();
  for (const item of items) {
    const name = modelName(item);
    if (name) unique.add(name);
  }
  return [...unique].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

function modelRequestError(code, status = null) {
  const error = new Error(code);
  error.code = code;
  if (status != null) error.status = status;
  return error;
}

function safeModelsError(error) {
  const safe = new Error(safeErrorSummary(error));
  const status = statusFromError(error);
  if (status != null) safe.status = status;
  const code = String(error?.code ?? '');
  safe.code = SAFE_MODEL_ERROR_CODES.has(code)
    ? code
    : 'API_MODELS_FETCH_FAILED';
  return safe;
}

export async function callOpenAICompatible(profile, messages, options = {}) {
  const context = hostContext(options.context);
  const normalized = isCurrentApi(profile) ? profile : normalizeApiProfile(profile);
  try {
    return await requestWithRetry(
      signal => isCurrentApi(profile)
        ? runCurrentApi(profile, messages, context, signal)
        : runIndependentApi(normalized, messages, context, signal),
      options,
    );
  } catch (error) {
    // 统一宿主不同版本返回的取消错误，避免把 aborted 原文泄漏到 UI。
    if (isAbortError(error)) throw abortedError();
    throw error;
  }
}

export async function testCurrentApi(options = {}) {
  const context = hostContext(options.context);
  const started = now();
  try {
    await callOpenAICompatible(SILLYTAVERN_CURRENT_API, [{role: 'user', content: 'Reply OK.'}], {
      ...options,
      context,
    });
    let model = typeof context?.getChatCompletionModel === 'function'
      ? await context.getChatCompletionModel()
      : context?.getChatCompletionModel;
    return {
      ok: true,
      status: 'success',
      model: safeModel(model, 'SillyTavern 当前 API'),
      latency_ms: Math.max(0, Math.round(now() - started)),
    };
  } catch (error) {
    return {ok: false, status: 'error', error: safeErrorSummary(error)};
  }
}

export async function testProfile(profile, options = {}) {
  if (isCurrentApi(profile)) return testCurrentApi({ ...options, context: hostContext(options.context) });
  const normalized = normalizeApiProfile(profile);
  const started = now();
  try {
    await callOpenAICompatible(normalized, [{role: 'user', content: 'Reply OK.'}], options);
    return {
      ok: true,
      status: 'success',
      model: safeModel(normalized.model),
      latency_ms: Math.max(0, Math.round(now() - started)),
    };
  } catch (error) {
    const result = {
      ok: false,
      status: 'error',
      error: safeErrorSummary(error),
    };
    const responseStatus = statusFromError(error);
    if (responseStatus != null) result.http_status = responseStatus;
    return result;
  }
}

export async function fetchModels(profile, options = {}) {
  const requestOptions = options && typeof options === 'object' ? options : {};
  const context = hostContext(requestOptions.context);

  try {
    const secretRef = profile && typeof profile === 'object' && typeof profile.secret_ref === 'string'
      ? profile.secret_ref
      : null;
    const normalized = normalizeApiProfile(profile, {secretRef});
    const fetchRef = requestOptions.fetchRef ?? globalThis.fetch;
    if (typeof fetchRef !== 'function') throw modelRequestError('API_MODELS_FETCH_UNAVAILABLE');
    const customUrl = apiUrlFrom(normalized);
    if (!customUrl) throw modelRequestError('API_PROFILE_INVALID');

    const payload = await requestWithRetry(async signal => {
      const hostHeaders = typeof context?.getRequestHeaders === 'function'
        ? await context.getRequestHeaders()
        : {};
      const response = await fetchRef(MODELS_STATUS_ENDPOINT, {
        method: 'POST',
        headers: {...hostHeaders, 'Content-Type': 'application/json'},
        // 只发送不透明引用，让 SillyTavern 服务端从 Secret Store 读取实际密钥。
        body: JSON.stringify({
          chat_completion_source: 'custom',
          custom_url: customUrl,
          secret_id: normalized.secret_ref || NO_SECRET_ID,
        }),
        signal,
        cache: 'no-cache',
      });
      const status = Number(response?.status);
      const hasStatus = Number.isInteger(status) && status >= 100 && status <= 599;
      if (!response || response.ok === false || (hasStatus && (status < 200 || status >= 300))) {
        throw modelRequestError('API_MODELS_HTTP_ERROR', hasStatus ? status : null);
      }
      if (typeof response.json !== 'function') {
        throw modelRequestError('API_MODELS_RESPONSE_INVALID');
      }
      return modelList(await response.json());
    }, requestOptions);

    if (!payload.length) throw modelRequestError('API_MODELS_EMPTY');
    return payload;
  } catch (error) {
    throw safeModelsError(error);
  }
}

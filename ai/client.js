import { DEFAULT_API_REQUEST_SETTINGS, SILLYTAVERN_CURRENT_API, normalizeApiProfile, normalizeApiRequestSettings } from '../storage/schema.js'
const NO_SECRET_ID = '__bioweave_no_secret__'
const MODELS_STATUS_ENDPOINT = '/api/backends/chat-completions/status'
const GENERATE_ENDPOINT = '/api/backends/chat-completions/generate'
const SAFE_MODEL_ERROR_CODES = new Set([
  'API_MODELS_EMPTY',
  'API_MODELS_RESPONSE_INVALID',
  'API_MODELS_FETCH_UNAVAILABLE',
  'API_MODELS_HTTP_ERROR',
  'API_PROFILE_INVALID',
  'REQUEST_TIMEOUT',
  'REQUEST_ABORTED',
])
const DIAGNOSTIC_CODES = new Set([
  'config-missing',
  'auth',
  'not-found',
  'rate-limit',
  'server',
  'timeout',
  'upstream-timeout',
  'network',
  'invalid-json',
  'response-error',
  'empty-output',
  'truncated',
  'sse-invalid',
  'parse',
  'invalid-structure',
  'invalid-fields',
  'save',
  'recoverable-fallback',
  'memory-stale',
  'aborted',
  'unknown',
])
const UPSTREAM_TIMEOUT_TEMPLATE_TAIL = [
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
const DIAGNOSTIC_ALIASES = Object.freeze({
  REQUEST_TIMEOUT: 'timeout',
  REQUEST_ABORTED: 'aborted',
  ABORTED: 'aborted',
  ERR_ABORTED: 'aborted',
  ABORT_ERR: 'aborted',
  ERR_CANCELED: 'aborted',
  ERR_CANCELLED: 'aborted',
  HTTP_400: 'http-400',
  INVALID_JSON: 'invalid-json',
  ERR_INVALID_JSON: 'invalid-json',
  RESPONSE_ERROR: 'response-error',
})
const TRANSPORT_DIAGNOSTIC_CODES = new Set([
  'auth',
  'not-found',
  'rate-limit',
  'server',
  'timeout',
  'upstream-timeout',
  'network',
  'invalid-json',
  'response-error',
  'aborted',
])
function now() {
  return globalThis.performance?.now?.() ?? Date.now()
}
function hostContext(context) {
  return context ?? globalThis.SillyTavern?.getContext?.() ?? null
}
function isCurrentApi(profile) {
  if (profile === SILLYTAVERN_CURRENT_API || profile === 'current' || profile === 'current_api') return true
  return profile?.mode === SILLYTAVERN_CURRENT_API || profile?.mode === 'current' || profile?.use_sillytavern === true
}
function numeric(value, fallback, min, max, integer = false) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  const bounded = Math.min(max, Math.max(min, parsed))
  return integer ? Math.round(bounded) : bounded
}
function requestTimeout(requestSettings) {
  return numeric(requestSettings.timeout, DEFAULT_API_REQUEST_SETTINGS.timeout, 250, 600000, true)
}
function retryCount(requestSettings) {
  return numeric(requestSettings.retry_count, DEFAULT_API_REQUEST_SETTINGS.retry_count, 0, 3, true)
}
function validStatus(value) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 100 && parsed <= 599 ? parsed : null
}
function statusProperty(error) {
  for (const value of [
    error?.status,
    error?.statusCode,
    error?.http_status,
    error?.httpStatus,
    error?.status_code,
    error?.response?.status,
    error?.response?.statusCode,
    error?.response?.status_code,
    error?.res?.status,
  ]) {
    const status = validStatus(value)
    if (status !== null) return status
  }
  return null
}
export function statusFromError(error) {
  const propertyStatus = statusProperty(error)
  if (propertyStatus !== null) return propertyStatus
  const match =
    String(error?.code ?? '').match(/(?:HTTP|STATUS)[_ -]?(\d{3})/i) ?? String(error?.message ?? '').match(/(?:HTTP|STATUS)[_ -]?(\d{3})/i)
  return validStatus(match?.[1])
}
function isAbortError(error) {
  const code = String(error?.code ?? '')
    .trim()
    .toUpperCase()
  const message = String(error?.message ?? error?.reason ?? '').trim()
  return (
    error?.name === 'AbortError' ||
    ['REQUEST_ABORTED', 'ABORTED', 'ERR_ABORTED', 'ABORT_ERR', 'ERR_CANCELED', 'ERR_CANCELLED'].includes(code) ||
    /\b(?:abort(?:ed|ing)?|canceled|cancelled)\b/i.test(message)
  )
}
function isTimeoutError(error) {
  return error?.code === 'REQUEST_TIMEOUT' || error?.bioweaveTimeout === true || error?.timedOut === true || error?.localTimeout === true
}
function networkError(error) {
  const code = String(error?.code ?? '')
    .trim()
    .toUpperCase()
  const message = String(error?.message ?? error?.reason ?? '').trim()
  return (
    ['ECONNRESET', 'ECONNREFUSED', 'ENETDOWN', 'ENETUNREACH', 'EHOSTUNREACH', 'ETIMEDOUT'].includes(code) ||
    error?.name === 'TypeError' ||
    /network|fetch failed|socket hang up|connection|连接中断|网络/i.test(message)
  )
}
function canonicalDiagnosticCode(value) {
  const raw = String(value ?? '').trim()
  if (!raw) return null
  const alias = DIAGNOSTIC_ALIASES[raw.toUpperCase()]
  if (alias) return alias
  const normalized = raw.toLowerCase().replace(/[_\s]+/g, '-')
  if (/^http-\d{3}$/.test(normalized)) return normalized
  return DIAGNOSTIC_CODES.has(normalized) ? normalized : null
}
function explicitDiagnosticCode(error) {
  for (const value of [error?.diagnosticCode, error?.diagnostic_code, error?.error_code, error?.code]) {
    const code = canonicalDiagnosticCode(value)
    if (code) return code
  }
  return null
}
function httpDiagnosticCode(status) {
  if (status === 400) return 'http-400'
  if (status === 401 || status === 403) return 'auth'
  if (status === 404) return 'not-found'
  if (status === 429) return 'rate-limit'
  if (status >= 500) return 'server'
  return `http-${status}`
}
function localTimeoutMarker(error, options = {}) {
  return (
    options.timedOut === true ||
    error?.timedOut === true ||
    error?.bioweaveTimeout === true ||
    error?.localTimeout === true ||
    error?.code === 'REQUEST_TIMEOUT'
  )
}
export function classifyGenerationError(error, options = {}) {
  const status = validStatus(options.status) ?? statusFromError(error)
  // A real HTTP failure is authoritative. In particular, a host error whose
  // name/message happens to mention timeout or abort must not hide 4xx/5xx.
  if (status !== null && (status < 200 || status >= 300)) return httpDiagnosticCode(status)
  const explicit = explicitDiagnosticCode(error)
  if (explicit && explicit !== 'unknown') return explicit
  if (localTimeoutMarker(error, options)) return 'timeout'
  if (isAbortError(error) || error?.aborted === true || options.aborted === true) return 'aborted'
  if (error?.phase === 'empty-output' || options.phase === 'empty-output') return 'empty-output'
  if (error?.phase === 'truncated' || options.phase === 'truncated') return 'truncated'
  if (error?.phase === 'parse' || options.phase === 'parse') return 'parse'
  if (error?.phase === 'invalid-structure' || options.phase === 'invalid-structure') return 'invalid-structure'
  if (error?.phase === 'invalid-fields' || options.phase === 'invalid-fields') return 'invalid-fields'
  if (error?.phase === 'save' || options.phase === 'save') return 'save'
  if (error?.responseError === true || error?.response_error === true) return 'response-error'
  if (error?.name === 'SyntaxError' || error?.code === 'ERR_INVALID_JSON') return 'invalid-json'
  if (networkError(error)) return 'network'
  return 'unknown'
}
export function isTransportDiagnostic(error, options = {}) {
  const status = validStatus(options.status) ?? statusFromError(error)
  const diagnostic = classifyGenerationError(error, { ...options, status })
  return TRANSPORT_DIAGNOSTIC_CODES.has(diagnostic) || /^http-\d{3}$/u.test(diagnostic)
}
function safeTimeoutSeconds(value) {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) return null
  return Math.max(1, Math.min(600, Math.round(number)))
}
export function diagnosticMessage(error, options = {}) {
  const status = validStatus(options.status) ?? statusFromError(error)
  const code = classifyGenerationError(error, { ...options, status })
  const codeStatus = validStatus(String(code).match(/^http-(\d{3})$/)?.[1])
  const resolvedStatus = status ?? codeStatus
  const statusSuffix = resolvedStatus === null ? '' : `（HTTP ${resolvedStatus}）`
  if (code === 'http-400') return `请求参数错误${statusSuffix}，请检查模型配置或接口兼容性。`
  if (code === 'auth') return `认证失败${statusSuffix}，请检查 API Key 和模型权限。`
  if (code === 'not-found') return `配置或地址错误${statusSuffix}，请检查 API Base URL。`
  if (code === 'rate-limit') return `请求触发限流${statusSuffix}，请稍后重试或检查额度。`
  if (code === 'server') {
    const attempt = Number(error?.attempt ?? options.attempt)
    if (resolvedStatus !== null) {
      return Number.isInteger(attempt) && attempt > 0
        ? `服务暂时不可用（HTTP ${resolvedStatus}）；本次已尝试 ${attempt} 次仍失败，请稍后重试。`
        : `服务暂时不可用（HTTP ${resolvedStatus}），请稍后重试。`
    }
    return '服务暂时不可用，请稍后重试。'
  }
  if (code === 'timeout') {
    const seconds = safeTimeoutSeconds(error?.timeoutSec ?? options.timeoutSec)
    if (resolvedStatus !== null && resolvedStatus >= 200 && resolvedStatus < 300) {
      return seconds === null
        ? `请求超时：已收到 HTTP ${resolvedStatus} 响应，但正文或响应流未完成，已在本地终止。本次未自动重试。`
        : `请求超时：已收到 HTTP ${resolvedStatus} 响应，但正文或响应流在 ${seconds} 秒内未完成，已在本地终止。本次未自动重试。`
    }
    if (seconds === null) return '请求超时，请检查地址或延长超时设置'
    return `请求超时：等待 ${seconds} 秒后已在本地终止。本次未自动重试。`
  }
  if (code === 'upstream-timeout') return `上游服务返回超时说明${statusSuffix}，本次未自动重试；请稍后重试或缩短发送给模型的上下文。`
  if (code === 'network')
    return resolvedStatus === null ? '网络连接中断，请检查网络后重试。' : `网络连接中断（HTTP ${resolvedStatus} 响应读取期间），请检查网络后重试。`
  if (code === 'invalid-json') return `接口已响应${statusSuffix}，但响应不是有效 JSON；请重试或检查接口兼容性。`
  if (code === 'response-error') return `接口已响应${statusSuffix}，但返回的是错误包而非正文；请检查接口状态、额度或模型权限。`
  if (code === 'empty-output') return 'AI 没有返回可用正文，请调整模型或提示词后重试。'
  if (code === 'truncated') return 'AI 输出达到上限，未保存完整结果；请提高输出上限或缩短提示词。'
  if (code === 'sse-invalid') return 'AI 流式响应损坏，未保存不完整结果；请重试。'
  if (code === 'aborted') return '请求已取消'
  if (resolvedStatus !== null) return `连接失败（HTTP ${resolvedStatus}），请检查 API 地址、模型和权限。`
  return '连接失败，请检查 API 地址、模型和权限。'
}
function annotateDiagnosticError(error, code, options = {}) {
  const normalizedCode = canonicalDiagnosticCode(code) ?? 'unknown'
  const target = error && (typeof error === 'object' || typeof error === 'function') ? error : new Error(String(error ?? normalizedCode))
  const status = validStatus(options.status) ?? statusFromError(target)
  try {
    target.diagnosticCode = normalizedCode
    target.diagnostic_code = normalizedCode
    target.error_code = normalizedCode
    if (status !== null && statusProperty(target) === null) target.status = status
    if (options.phase !== undefined) target.phase = String(options.phase)
    if (options.retryable !== undefined) target.retryable = !!options.retryable
    if (Number.isInteger(options.attempt) && options.attempt > 0) target.attempt = options.attempt
    const timeoutSecValue = Number(options.timeoutSec ?? target.timeoutSec)
    const timeoutMsValue = Number(options.timeoutMs ?? options.timeout_ms ?? target.timeout_ms)
    const timeoutSec =
      Number.isFinite(timeoutSecValue) && timeoutSecValue > 0
        ? timeoutSecValue
        : Number.isFinite(timeoutMsValue) && timeoutMsValue > 0
          ? timeoutMsValue / 1000
          : null
    const timeoutMs = Number.isFinite(timeoutMsValue) && timeoutMsValue > 0 ? timeoutMsValue : timeoutSec === null ? null : timeoutSec * 1000
    if (timeoutSec !== null) target.timeoutSec = timeoutSec
    if (timeoutMs !== null) target.timeout_ms = timeoutMs
    if (normalizedCode === 'timeout') {
      target.bioweaveTimeout = true
      if (options.timedOut === true) target.timedOut = true
    }
    if (options.cause && options.cause !== target && !target.cause) target.cause = options.cause
    if (!target.code) {
      if (normalizedCode === 'timeout') target.code = 'REQUEST_TIMEOUT'
      else if (normalizedCode === 'aborted') target.code = 'REQUEST_ABORTED'
      else target.code = normalizedCode
    }
  } catch {
    // A frozen host error cannot be annotated in place; the caller may use the
    // returned object only for safe formatting, while normal host errors remain mutable.
  }
  return target
}
export function makeDiagnosticError(code, options = {}) {
  const normalizedCode = canonicalDiagnosticCode(code) ?? 'unknown'
  const error = new Error(diagnosticMessage({ diagnosticCode: normalizedCode }, options))
  return annotateDiagnosticError(error, normalizedCode, options)
}
export function isUpstreamTimeoutTemplate(value) {
  const normalized = String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .trim()
  const lines = normalized.split('\n')
  if (!/^\[req_[^\]\s]+\] \[[^\]\r\n]+\]$/.test(lines[0] || '')) return false
  if (!/^\*\*Request exceeded \d+(?:\.\d+)?s limit\*\*$/.test(lines[1] || '')) return false
  return lines.slice(2).join('\n') === UPSTREAM_TIMEOUT_TEMPLATE_TAIL
}
function isRetryable(error) {
  const status = statusFromError(error)
  if (status != null && (status === 429 || status >= 500)) return true
  if (isAbortError(error) || isTimeoutError(error)) return false
  return networkError(error)
}
function timeoutError(options = {}) {
  const error = new Error('REQUEST_TIMEOUT')
  return annotateDiagnosticError(error, 'timeout', options)
}
function abortedError(options = {}) {
  const error = new Error('REQUEST_ABORTED')
  return annotateDiagnosticError(error, 'aborted', options)
}
async function waitBeforeRetry(attempt, signal) {
  const delay = Math.min(1000, 150 * 2 ** attempt)
  if (signal?.aborted) throw abortedError()
  await new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, delay)
    const abort = () => {
      clearTimeout(timer)
      signal?.removeEventListener?.('abort', abort)
      reject(abortedError())
    }
    signal?.addEventListener?.('abort', abort, { once: true })
  })
}
async function runWithTimeout(operation, { signal, timeout, attempt = 1 }) {
  const controller = new AbortController()
  const requestState = { status: null, phase: 'request', attempt }
  let timedOut = false
  let timer = null
  const abort = () => controller.abort()
  signal?.addEventListener?.('abort', abort, { once: true })
  if (signal?.aborted) throw abortedError()
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true
      controller.abort()
      reject(
        timeoutError({
          timedOut: true,
          status: requestState.status,
          phase: requestState.phase,
          timeoutSec: timeout / 1000,
          timeoutMs: timeout,
          attempt,
        }),
      )
    }, timeout)
  })
  const operationPromise = Promise.resolve().then(() => operation(controller.signal, requestState))
  try {
    return await Promise.race([operationPromise, timeoutPromise])
  } catch (error) {
    const status = statusFromError(error) ?? validStatus(requestState.status)
    if (!timedOut && status !== null && statusFromError(error) === null) {
      const diagnostic = classifyGenerationError(error, { status })
      if (diagnostic !== 'unknown') {
        annotateDiagnosticError(error, diagnostic, {
          status,
          phase: error?.phase ?? 'response',
          attempt,
        })
      }
    }
    if (timedOut) {
      // A status observed before body/SSE consumption is still authoritative
      // for non-2xx responses. A 2xx response that times out while being read
      // remains a local timeout and keeps the successful status as context.
      if (status !== null && (status < 200 || status >= 300)) {
        throw annotateDiagnosticError(error, httpDiagnosticCode(status), {
          status,
          phase: requestState.phase,
          attempt,
        })
      }
      throw timeoutError({
        timedOut: true,
        status,
        phase: requestState.phase,
        timeoutSec: timeout / 1000,
        timeoutMs: timeout,
        attempt,
        cause: error,
      })
    }
    if (signal?.aborted) {
      if (status !== null && (status < 200 || status >= 300)) {
        throw annotateDiagnosticError(error, httpDiagnosticCode(status), {
          status,
          phase: requestState.phase,
          attempt,
        })
      }
      throw abortedError({ status, phase: requestState.phase, attempt, cause: error })
    }
    throw error
  } finally {
    if (timer) clearTimeout(timer)
    signal?.removeEventListener?.('abort', abort)
  }
}
async function requestWithRetry(operation, options = {}) {
  const signal = options.signal
  const requestSettings = normalizeApiRequestSettings(options.requestSettings)
  const attempts = retryCount(requestSettings) + 1
  let lastError
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await runWithTimeout(operation, {
        signal,
        timeout: requestTimeout(requestSettings),
        attempt: attempt + 1,
      })
    } catch (error) {
      lastError = error
      if (attempt >= attempts - 1 || !isRetryable(error)) throw error
      await waitBeforeRetry(attempt, signal)
    }
  }
  throw lastError ?? new Error('API_REQUEST_FAILED')
}
function safeModel(model, fallback = 'configured model') {
  const value = String(model ?? '').trim()
  if (!value) return fallback
  return redactSecrets(value).slice(0, 160)
}
export function redactSecrets(value) {
  return String(value ?? '')
    .replace(/(bearer\s+)[^\s,;"'}]+/gi, '$1[redacted]')
    .replace(
      /([?&](?:api[_-]?key|api[_-]?secret|authorization|access[_-]?token|refresh[_-]?token|secret|token|credential)=)[^&\s]+/gi,
      '$1[redacted]',
    )
    .replace(/(["']?(?:api[_-]?key|api[_-]?secret|authorization|secret|token|credential)["']?\s*[:=]\s*["']?)[^\s,"'}]+/gi, '$1[redacted]')
}
export function safeErrorSummary(error) {
  const status = statusFromError(error)
  const diagnostic = classifyGenerationError(error, { status })
  const hasTransportDiagnostic =
    status !== null ||
    canonicalDiagnosticCode(error?.diagnosticCode) ||
    canonicalDiagnosticCode(error?.diagnostic_code) ||
    canonicalDiagnosticCode(error?.error_code) ||
    canonicalDiagnosticCode(error?.code) ||
    isTimeoutError(error) ||
    isAbortError(error) ||
    networkError(error) ||
    error?.name === 'SyntaxError'
  if (hasTransportDiagnostic && diagnostic !== 'unknown') {
    return diagnosticMessage(error, { status })
  }
  const code = String(error?.code ?? '').toUpperCase()
  if (code === 'ST_CHAT_COMPLETION_UNAVAILABLE') return 'SillyTavern ChatCompletionService 不可用'
  if (code === 'ST_CURRENT_API_UNAVAILABLE') return 'SillyTavern 当前 API 不可用'
  if (code === 'API_PROFILE_INVALID') return 'API Profile 配置不完整'
  if (code === 'API_MODELS_EMPTY') return '未找到可用模型'
  if (code === 'API_MODELS_RESPONSE_INVALID') return '模型列表响应无效'
  if (code === 'API_MODELS_FETCH_UNAVAILABLE') return '模型列表请求不可用'
  return redactSecrets('连接失败，请检查 API 地址、模型和权限').slice(0, 180)
}
export const redactError = safeErrorSummary
function messagesForRequest(messages) {
  if (Array.isArray(messages) && messages.length) return messages
  return [{ role: 'user', content: 'Reply OK.' }]
}
function apiUrlFrom(profile) {
  return String(profile?.api_url ?? profile?.base_url ?? profile?.custom_url ?? '').trim()
}
function setDefinedRequestField(target, key, value) {
  if (value === undefined || value === null || value === '') return
  target[key] = value
}
async function currentApiRequest(profile, messages, context) {
  const settings = context?.chatCompletionSettings
  if (!settings || typeof settings !== 'object') return null
  const service = context?.ChatCompletionService
  if (typeof service?.processRequest !== 'function') return null
  const source = String(settings.chat_completion_source ?? settings.chatCompletionSource ?? 'openai').trim() || 'openai'
  const model =
    typeof context?.getChatCompletionModel === 'function'
      ? await context.getChatCompletionModel()
      : (settings.openai_model ?? settings.custom_model ?? settings.model)
  if (!String(model ?? '').trim()) return null
  const outputTokens = profile && typeof profile === 'object' ? (profile.max_output_tokens ?? settings.openai_max_tokens) : settings.openai_max_tokens
  const request = {
    stream: false,
    messages: messagesForRequest(messages),
    model: String(model).trim(),
    chat_completion_source: source,
    max_tokens: numeric(outputTokens, 4096, 1, 10000000, true),
    temperature: numeric(settings.temp_openai ?? settings.temperature, 0.2, 0, 2),
  }
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
  }
  for (const [key, value] of Object.entries(settingFields)) setDefinedRequestField(request, key, value)
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
  ]
  for (const key of connectionFields) setDefinedRequestField(request, key, settings[key])
  if (Array.isArray(settings.openrouter_providers) && settings.openrouter_providers.length) {
    request.provider = settings.openrouter_providers
  }
  if (Array.isArray(settings.openrouter_quantizations) && settings.openrouter_quantizations.length) {
    request.quantizations = settings.openrouter_quantizations
  }
  setDefinedRequestField(request, 'allow_fallbacks', settings.openrouter_allow_fallbacks)
  setDefinedRequestField(request, 'use_fallback', settings.openrouter_use_fallback)
  setDefinedRequestField(request, 'middleout', settings.openrouter_middleout)
  return { service, request }
}
function hasOwn(value, key) {
  return Boolean(value && Object.prototype.hasOwnProperty.call(value, key))
}
function isResponseLike(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return (
    typeof value.json === 'function' ||
    typeof value.text === 'function' ||
    ['ok', 'status', 'statusCode', 'http_status', 'body'].some(key => hasOwn(value, key)) ||
    statusProperty(value) !== null
  )
}
function responsePayloadText(value) {
  if (typeof value === 'string') return value
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ''
  if (typeof value.text === 'string') return value.text
  if (typeof value.content === 'string') return value.content
  if (Array.isArray(value.content)) {
    return value.content.map(item => (typeof item === 'string' ? item : (item?.text ?? ''))).join('')
  }
  const choice = Array.isArray(value.choices) ? value.choices[0] : null
  if (typeof choice?.message?.content === 'string') return choice.message.content
  if (typeof choice?.text === 'string') return choice.text
  if (value.data && typeof value.data === 'object') return responsePayloadText(value.data)
  return ''
}
function responseHasError(value) {
  return Boolean(
    value && typeof value === 'object' && !Array.isArray(value) && hasOwn(value, 'error') && value.error !== undefined && value.error !== null,
  )
}
async function consumeResponseBody(response) {
  try {
    if (typeof response?.text === 'function') {
      await response.text()
      return
    }
    if (typeof response?.json === 'function') {
      await response.json()
      return
    }
    if (typeof response?.body === 'string') return
    const reader = response?.body?.getReader?.()
    if (!reader) return
    try {
      while (!(await reader.read()).done) {}
    } finally {
      try {
        reader.releaseLock?.()
      } catch {}
    }
  } catch {
    // The status-bearing diagnostic remains authoritative; response bodies are
    // deliberately consumed only as a best-effort drain and never exposed.
  }
}
async function responseBodyText(response) {
  if (typeof response?.text === 'function') return response.text()
  if (typeof response?.body === 'string') return response.body
  const reader = response?.body?.getReader?.()
  if (!reader) return null
  const decoder = new TextDecoder()
  let text = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) {
        text += decoder.decode()
        break
      }
      text += decoder.decode(value, { stream: true })
    }
  } finally {
    try {
      reader.releaseLock?.()
    } catch {}
  }
  return text
}
function responseJsonFromText(text, status, attempt) {
  const normalized = String(text ?? '').trim()
  if (isUpstreamTimeoutTemplate(normalized)) {
    throw makeDiagnosticError('upstream-timeout', { status, phase: 'response', attempt })
  }
  if (!normalized) throw makeDiagnosticError('invalid-json', { status, phase: 'response', attempt })
  // A response body can be a complete SSE stream when the host returns a raw
  // Response-like object. Parse every data frame so an error envelope cannot
  // accidentally enter the success path.
  const dataLines = normalized
    .split('\n')
    .map(line => line.replace(/\r$/, ''))
    .filter(line => line.startsWith('data:'))
    .map(line => line.slice(5).replace(/^\s/, ''))
  if (dataLines.length) {
    const contents = []
    let lastPayload = null
    for (const line of dataLines) {
      if (line === '[DONE]') continue
      let payload
      try {
        payload = JSON.parse(line)
      } catch (error) {
        throw makeDiagnosticError('invalid-json', { status, phase: 'response', attempt, cause: error })
      }
      if (responseHasError(payload)) {
        throw makeDiagnosticError('response-error', { status, phase: 'response', attempt })
      }
      lastPayload = payload
      const choice = payload?.choices?.[0]
      const content = choice?.delta?.content ?? choice?.message?.content ?? choice?.text ?? payload?.content
      if (typeof content === 'string') contents.push(content)
    }
    if (contents.length) return { content: contents.join('') }
    if (lastPayload !== null) return lastPayload
    throw makeDiagnosticError('invalid-json', { status, phase: 'response', attempt })
  }
  let payload
  try {
    payload = JSON.parse(normalized)
  } catch (error) {
    throw makeDiagnosticError('invalid-json', { status, phase: 'response', attempt, cause: error })
  }
  if (isUpstreamTimeoutTemplate(payload)) {
    throw makeDiagnosticError('upstream-timeout', { status, phase: 'response', attempt })
  }
  if (responseHasError(payload)) {
    throw makeDiagnosticError('response-error', { status, phase: 'response', attempt })
  }
  return payload
}
function normalizedResponsePayload(payload, status, attempt) {
  if (isUpstreamTimeoutTemplate(responsePayloadText(payload))) {
    throw makeDiagnosticError('upstream-timeout', { status, phase: 'response', attempt })
  }
  if (responseHasError(payload)) {
    throw makeDiagnosticError('response-error', { status, phase: 'response', attempt })
  }
  return payload
}
async function normalizeResponseLike(value, requestState = {}, { attempt = requestState.attempt ?? 1 } = {}) {
  if (value instanceof Error) throw value
  const status = statusFromError(value)
  if (status !== null) requestState.status = status
  const responseLike = isResponseLike(value)
  if (!responseLike) return normalizedResponsePayload(value, status, attempt)
  requestState.phase = 'response'
  const failedStatus = status !== null && (status < 200 || status >= 300)
  if (value.ok === false || failedStatus) {
    await consumeResponseBody(value)
    if (failedStatus && status !== null) {
      throw makeDiagnosticError(httpDiagnosticCode(status), {
        status,
        phase: 'request',
        retryable: status === 429 || status >= 500,
        attempt,
      })
    }
    throw makeDiagnosticError('response-error', { status, phase: 'request', attempt })
  }
  if (typeof value.json === 'function') {
    let payload
    try {
      payload = await value.json()
    } catch (error) {
      if (isAbortError(error) || networkError(error)) throw error
      throw makeDiagnosticError('invalid-json', { status, phase: 'response', attempt, cause: error })
    }
    return normalizedResponsePayload(payload, status, attempt)
  }
  const body = await responseBodyText(value)
  if (body !== null) return responseJsonFromText(body, status, attempt)
  return normalizedResponsePayload(value, status, attempt)
}
async function runCurrentApi(profile, messages, context, signal, requestState) {
  const currentRequest = await currentApiRequest(profile, messages, context)
  if (currentRequest) {
    // ChatCompletionService 不挂接 GENERATION_STOPPED，避免宿主结束主楼生成时取消本次分析。
    const result = await currentRequest.service.processRequest(currentRequest.request, {}, true, signal)
    return normalizeResponseLike(result, requestState)
  }
  if (typeof context?.generateRaw !== 'function') throw new Error('ST_CURRENT_API_UNAVAILABLE')
  // 兼容没有公开 ChatCompletionService 的旧版 SillyTavern；取消仍由宿主自身管理。
  const result = await context.generateRaw({
    prompt: messagesForRequest(messages),
    responseLength: numeric(profile?.max_output_tokens, 4096, 1, 10000000, true),
  })
  return normalizeResponseLike(result, requestState)
}
async function runIndependentApi(profile, messages, context, signal, requestState, fetchRef) {
  const apiUrl = apiUrlFrom(profile)
  if (!apiUrl || !profile.model) {
    const error = new Error('API_PROFILE_INVALID')
    error.code = 'API_PROFILE_INVALID'
    throw error
  }
  if (typeof fetchRef !== 'function') {
    throw makeDiagnosticError('network', { phase: 'request' })
  }
  const hostHeaders = typeof context?.getRequestHeaders === 'function' ? await context.getRequestHeaders() : {}
  const response = await fetchRef(GENERATE_ENDPOINT, {
    method: 'POST',
    headers: { ...hostHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      stream: false,
      messages: messagesForRequest(messages),
      model: profile.model,
      chat_completion_source: 'custom',
      custom_url: apiUrl,
      // 只发送不透明引用，让 SillyTavern 服务端从 Secret Store 读取实际密钥。
      secret_id: profile.secret_ref || NO_SECRET_ID,
      max_tokens: numeric(profile.max_output_tokens, 4096, 1, 10000000, true),
      temperature: numeric(profile.temperature, 0.2, 0, 2),
    }),
    signal,
  })
  return normalizeResponseLike(response, requestState)
}
function modelName(item) {
  if (typeof item === 'string') return item.trim()
  if (!item || typeof item !== 'object') return ''
  for (const field of ['id', 'model', 'name']) {
    if (typeof item[field] !== 'string') continue
    const value = item[field].trim()
    if (value) return value
  }
  return ''
}
function modelList(payload) {
  const items = []
  if (Array.isArray(payload)) {
    items.push(...payload)
  } else if (payload && typeof payload === 'object') {
    for (const field of ['data', 'models']) {
      const value = payload[field]
      if (Array.isArray(value)) items.push(...value)
      else if (typeof value === 'string') items.push(value)
    }
  }
  const unique = new Set()
  for (const item of items) {
    const name = modelName(item)
    if (name) unique.add(name)
  }
  return [...unique].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
}
function modelRequestError(code, status = null, options = {}) {
  const error = new Error(code)
  error.code = code
  const diagnostic = canonicalDiagnosticCode(options.diagnosticCode) ?? (status != null ? httpDiagnosticCode(status) : null)
  if (diagnostic && diagnostic !== 'unknown') {
    annotateDiagnosticError(error, diagnostic, {
      ...options,
      status,
    })
  } else if (status != null) {
    error.status = status
  }
  return error
}
function safeModelsError(error) {
  const safe = new Error(safeErrorSummary(error))
  const status = statusFromError(error)
  if (status != null) safe.status = status
  const sourceCode = String(error?.code ?? '')
  safe.code = SAFE_MODEL_ERROR_CODES.has(sourceCode) ? sourceCode : 'API_MODELS_FETCH_FAILED'
  if (typeof error?.name === 'string' && error.name) safe.name = error.name
  const diagnostic = classifyGenerationError(error, { status })
  if (diagnostic !== 'unknown') {
    annotateDiagnosticError(safe, diagnostic, {
      status,
      phase: error?.phase,
      retryable: error?.retryable,
      attempt: error?.attempt,
      timeoutSec: error?.timeoutSec,
      timeoutMs: error?.timeout_ms,
      cause: error,
    })
  } else if (error?.cause && !safe.cause) {
    safe.cause = error.cause
  } else if (error && !safe.cause) {
    safe.cause = error
  }
  return safe
}
export async function callOpenAICompatible(profile, messages, options = {}) {
  const context = hostContext(options.context)
  const normalized = isCurrentApi(profile) ? profile : normalizeApiProfile(profile)
  const fetchRef = options.fetchRef ?? globalThis.fetch
  try {
    return await requestWithRetry(
      (signal, requestState) =>
        isCurrentApi(profile)
          ? runCurrentApi(profile, messages, context, signal, requestState)
          : runIndependentApi(normalized, messages, context, signal, requestState, fetchRef),
      options,
    )
  } catch (error) {
    const status = statusFromError(error)
    const diagnostic = classifyGenerationError(error, { status })
    if (diagnostic !== 'unknown' || status !== null) {
      // Keep the host Error object and its name/code/status where possible;
      // only add the single client-owned diagnostic projection.
      const normalizedError = annotateDiagnosticError(error, diagnostic, {
        status,
        phase: error?.phase ?? 'request',
        retryable: status === 429 || status >= 500 || diagnostic === 'network',
      })
      // Keep the long-standing BioWeave cancellation contract while retaining
      // the host's original code for diagnostics and debugging.
      if (diagnostic === 'aborted' && status === null && normalizedError.code !== 'REQUEST_ABORTED') {
        try {
          normalizedError.original_code ??= normalizedError.code
          normalizedError.code = 'REQUEST_ABORTED'
        } catch {
          throw abortedError({ cause: normalizedError })
        }
      }
      throw normalizedError
    }
    throw error
  }
}
export async function testCurrentApi(options = {}) {
  const context = hostContext(options.context)
  const started = now()
  try {
    await callOpenAICompatible(SILLYTAVERN_CURRENT_API, [{ role: 'user', content: 'Reply OK.' }], {
      ...options,
      context,
    })
    let model = typeof context?.getChatCompletionModel === 'function' ? await context.getChatCompletionModel() : context?.getChatCompletionModel
    return {
      ok: true,
      status: 'success',
      model: safeModel(model, 'SillyTavern 当前 API'),
      latency_ms: Math.max(0, Math.round(now() - started)),
    }
  } catch (error) {
    const result = { ok: false, status: 'error', error: safeErrorSummary(error) }
    const responseStatus = statusFromError(error)
    if (responseStatus !== null) result.http_status = responseStatus
    const diagnostic = classifyGenerationError(error, { status: responseStatus })
    if (diagnostic !== 'unknown') result.diagnostic_code = diagnostic
    return result
  }
}
export async function testProfile(profile, options = {}) {
  if (isCurrentApi(profile)) return testCurrentApi({ ...options, context: hostContext(options.context) })
  const normalized = normalizeApiProfile(profile)
  const started = now()
  try {
    await callOpenAICompatible(normalized, [{ role: 'user', content: 'Reply OK.' }], options)
    return {
      ok: true,
      status: 'success',
      model: safeModel(normalized.model),
      latency_ms: Math.max(0, Math.round(now() - started)),
    }
  } catch (error) {
    const result = {
      ok: false,
      status: 'error',
      error: safeErrorSummary(error),
    }
    const responseStatus = statusFromError(error)
    if (responseStatus !== null) result.http_status = responseStatus
    const diagnostic = classifyGenerationError(error, { status: responseStatus })
    if (diagnostic !== 'unknown') result.diagnostic_code = diagnostic
    return result
  }
}
export async function fetchModels(profile, options = {}) {
  const requestOptions = options && typeof options === 'object' ? options : {}
  const context = hostContext(requestOptions.context)
  try {
    const secretRef = profile && typeof profile === 'object' && typeof profile.secret_ref === 'string' ? profile.secret_ref : null
    const normalized = normalizeApiProfile(profile, { secretRef })
    const fetchRef = requestOptions.fetchRef ?? globalThis.fetch
    if (typeof fetchRef !== 'function') throw modelRequestError('API_MODELS_FETCH_UNAVAILABLE')
    const customUrl = apiUrlFrom(normalized)
    if (!customUrl) throw modelRequestError('API_PROFILE_INVALID')
    const payload = await requestWithRetry(async (signal, requestState) => {
      const hostHeaders = typeof context?.getRequestHeaders === 'function' ? await context.getRequestHeaders() : {}
      const response = await fetchRef(MODELS_STATUS_ENDPOINT, {
        method: 'POST',
        headers: { ...hostHeaders, 'Content-Type': 'application/json' },
        // 只发送不透明引用，让 SillyTavern 服务端从 Secret Store 读取实际密钥。
        body: JSON.stringify({
          chat_completion_source: 'custom',
          custom_url: customUrl,
          secret_id: normalized.secret_ref || NO_SECRET_ID,
        }),
        signal,
        cache: 'no-cache',
      })
      const status = statusFromError(response)
      if (status !== null) requestState.status = status
      if (!response || response.ok === false || (status !== null && (status < 200 || status >= 300))) {
        await consumeResponseBody(response)
        throw modelRequestError('API_MODELS_HTTP_ERROR', status, { attempt: requestState.attempt })
      }
      let responsePayload
      try {
        responsePayload = await normalizeResponseLike(response, requestState)
      } catch (error) {
        const diagnostic = classifyGenerationError(error, {
          status: statusFromError(error) ?? requestState.status,
        })
        throw modelRequestError(
          diagnostic === 'network' ? 'API_MODELS_FETCH_FAILED' : 'API_MODELS_RESPONSE_INVALID',
          statusFromError(error) ?? requestState.status,
          {
            diagnosticCode: diagnostic,
            phase: error?.phase ?? 'response',
            cause: error,
            attempt: requestState.attempt,
          },
        )
      }
      return modelList(responsePayload)
    }, requestOptions)
    if (!payload.length) throw modelRequestError('API_MODELS_EMPTY')
    return payload
  } catch (error) {
    throw safeModelsError(error)
  }
}

# API Error Propagation

## 1. Scope / Trigger

This contract applies to API calls entering BioWeave through
`ai/client.js`, including SillyTavern `ChatCompletionService`, the legacy
`generateRaw` path, and model-list requests. It also covers the Runtime and UI
boundaries that carry the resulting diagnostic.

## 2. Signatures

- `classifyGenerationError(error, options?) -> diagnostic code`
- `diagnosticMessage(error, options?) -> safe user-facing string`
- `makeDiagnosticError(code, options?) -> Error with diagnostic metadata`
- `isUpstreamTimeoutTemplate(value) -> boolean`
- `callOpenAICompatible(profile, messages, options?) -> host response`
- `statusFromError(error) -> HTTP status | null`
- `traceApi(checkpoint, metadata?) -> void`, enabled only when
  `globalThis.__BIOWEAVE_API_TRACE__ === true`

## 3. Contracts

`ai/client.js` is the single transport-classification boundary. It preserves
the host error's `status`, `name`, and `code` where possible and adds
`diagnosticCode`/`diagnostic_code`, `error_code`, `phase`, `retryable`,
`attempt`, `timeoutSec`, `timeout_ms`, and `cause` when applicable. Runtime
persists only the safe diagnostic projection; raw response bodies and causes
must not enter Chat data or ordinary UI.

Classification rules:

- HTTP non-2xx status wins over timeout/abort-like names or codes.
- A local timer marked `timedOut` is `timeout`; a known 2xx response status is
  retained as context and does not replace the timeout classification when
  body/SSE reading stalls.
- Fetch, socket, and network failures are `network`.
- A complete HTTP 200 upstream timeout template is `upstream-timeout`.
- A response-body JSON reader/parsing failure is `invalid-json`.
- A response JSON object containing `error` is `response-error`.
- Runtime and UI consume the diagnostic projection and shared formatter; they
  do not infer a transport category from the raw message.

## 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| HTTP 400/401/403/404/429/5xx | Preserve the exact status and show `HTTP <status>`; never show timeout |
| Local AbortController timer | `timeout` / `REQUEST_TIMEOUT`; no implicit retry |
| Status 200, body or SSE read stalls until local timer | `timeout`, `status=200`, `phase=response`, and timeout text |
| Fetch/socket/network failure | `network`; never convert to timeout |
| Complete upstream timeout template in a 2xx body | `upstream-timeout` |
| Non-JSON response body | `invalid-json` |
| JSON response with an `error` field | `response-error` |
| Response-like error object | Throw a classified error; never return it as a successful model payload |

## 5. Good / Base / Bad Cases

- Good: classify once at the client boundary, annotate the original Error, and
  pass the safe projection through Runtime to the UI formatter.
- Base: keep the existing successful host response shape and retry only the
  existing 429/5xx/network categories.
- Bad: catch a status-bearing error and replace it with
  `new Error('API request timed out')`, or classify transport errors again in a
  page handler.

## 6. Tests Required

- Client regression tests cover HTTP 400, 401, 403, 404, 429, 500, 502, and
  503, asserting status, category, safe text, and no timeout wording.
- Client tests cover local response/body and SSE timeouts with status 200,
  network failure, upstream timeout template, invalid JSON, and `{error: ...}`.
- Wrapper tests assert original `name`, `code`, `cause`, and status survive.
- Runtime tests assert `diagnostic_code`, `http_status`, `phase`, timeout
  metadata, and safe summary survive persistence and status reads.
- UI tests assert HTTP numbers and category-specific text while excluding raw
  response content.

## 7. Wrong vs Correct

### Wrong

```js
try {
  await request();
} catch (error) {
  throw new Error('API request timed out');
}
```

### Correct

```js
catch (error) {
  // callOpenAICompatible already classified and annotated the Error.
  throw error;
}
```

The correct path must keep the original error metadata, distinguish a local
timer from a 2xx body-read timeout, and let callers display the shared safe
diagnostic without reclassifying it.

## 8. Metadata TRACE Contract

### 1. Scope / Trigger

This contract applies only to temporary developer diagnosis of a successful
third-party API response that does not reach BioWeave's Analyzer, Runtime, or
UI. TRACE is opt-in and must remain disabled unless the developer explicitly
sets `globalThis.__BIOWEAVE_API_TRACE__` to `true` in the host console.

### 2. Signatures

- `globalThis.__BIOWEAVE_API_TRACE__ -> boolean` — runtime-only opt-in flag.
- `traceApi(checkpoint, metadata?) -> void` — safe metadata logger with the
  `[BioWeave API TRACE]` prefix.
- Body checkpoints may report `status`, `contentType`, `bodyUsed`, method,
  body length, chunk/data-line counts, and diagnostic codes; they must not
  report body text.

### 3. Contracts

- With the flag unset or false, TRACE produces no console entry and must not
  consume a response body.
- `transport-resolved` records the resolved value's type, constructor,
  Response-like shape, status, `ok`, available body methods, `bodyUsed`, and
  top-level keys only.
- `json-start`/`json-complete`/`json-error`, `text-*`, and `reader-*` identify
  the existing body method selected by `normalizeResponseLike()`; TRACE must
  not add a fallback read.
- `response-json-from-text-*` records SSE `data:` line counts and whether
  `choice.delta.content`, `message.content`, `choice.text`, or top-level
  `content` was structurally extracted.
- Prompt text, user chat text, response text, API keys, Authorization values,
  secrets, and error messages are never logged.

### 4. Validation & Error Matrix

| Condition | Required TRACE evidence |
| --- | --- |
| Transport resolves | `transport-resolved` with status/content type/body shape |
| `json()` starts and succeeds | `json-start` then `json-complete`, including `bodyUsed` before/after |
| `json()` throws | `json-error` and `normalize-error` with `invalid-json` when classified |
| Body reader completes | `reader-start` then `reader-complete` with body length |
| HTTP 200 body read stalls | `timeout-abort` with `status=200`, `phase=response`, and incomplete body flags |
| Caller aborts after headers | `caller-abort` with response/body state |
| Analyzer receives a result | `analyzer-received` with `responseTextLength`, never response text |
| Parser or Runtime fails | `parser-error` or `runtime-error` with code/diagnostic code only |

### 5. Good / Base / Bad Cases

- Good: enable TRACE for one reproduction, preserve checkpoint order, and
  inspect only structural metadata and lengths.
- Base: keep the existing `json()`-first versus text/reader selection and
  record which branch was selected.
- Bad: call `response.text()` after `response.json()` merely to improve a log,
  or serialize a complete payload into the console.

### 6. Tests Required

- Assert TRACE is silent by default.
- Assert current API `{content}` and OpenAI `choices.message.content` reach
  Analyzer parsing.
- Assert standard JSON `Response`, body-only SSE, and delayed HTTP 200 body
  readers preserve the existing behavior.
- Assert JSON success/error, SSE extraction counters, and 200-body timeout
  checkpoints without logging response text.

### 7. Wrong vs Correct

#### Wrong

```js
console.debug('[BioWeave API TRACE]', await response.text())
```

#### Correct

```js
traceApi('json-complete', {
  status: response.status,
  contentType,
  bodyUsedAfter: response.bodyUsed,
  payloadType,
  bodyLength,
})
```

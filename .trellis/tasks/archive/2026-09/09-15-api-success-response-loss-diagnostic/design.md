# Technical Design

## Boundary and objective

This task observes the existing API-to-runtime path without changing its
transport selection, body parser, timeout values, retry policy, schema
validation, or persistence behavior. The diagnostic path must be removable as
one narrow diff after the failure point is identified.

The existing code has no repository-wide development-environment switch. The
TRACE gate will therefore use an explicit developer-only runtime opt-in (a
global flag documented in the final report) and remain disabled by default.
Tests will enable the flag only around individual cases and restore the global
state afterwards.

## Existing data flow and boundaries

1. `ai/client.js:482-550` builds the current SillyTavern request and awaits
   `getChatCompletionModel()` when available. `ai/client.js:725-738` awaits
   `ChatCompletionService.processRequest()` or the legacy `generateRaw()` path.
2. `ai/client.js:740-767` awaits independent `fetch()` for
   `/api/backends/chat-completions/generate`, then hands the returned value to
   `normalizeResponseLike()`.
3. `ai/client.js:691-723` classifies Response-like values, consumes either
   `json()`, `text()`, or a `body.getReader()`, and returns a parsed object or
   string. `ai/client.js:564-576` only projects already-materialized values;
   it does not consume a Response.
4. `ai/client.js:335-409` races the complete operation, including response-body
   consumption, against the local timer. The timeout calls the internal
   controller's `abort()` before rejecting.
5. `ai/analyzer.js:895-910` extracts text from string, top-level `text` or
   `content`, OpenAI choices, and nested `data`; parser entry points at
   `ai/analyzer.js:1534-1568` and `1584-1595` then validate the extracted JSON.
6. `ai/analyzer.js:1663-1707` awaits the client, parses World/Event output, and
   annotates Event failures with an analysis stage.
7. Event Runtime awaits the analyzer at `runtime/event-analysis.js:759-775`,
   persists normalized Events and rebuilds the Registry at
   `runtime/event-analysis.js:777-834`, then reports terminal state at
   `runtime/event-analysis.js:835-875`. World Model UI awaits the analyzer and
   saves the model at `ui/app.js:1620-1694`.

These are audit anchors, not new contracts. The implementation must re-check
the current line locations before editing.

## TRACE design

Use one small metadata logger owned by the client boundary, with the exact
prefix `[BioWeave API TRACE]`. It accepts a checkpoint name and a plain
metadata object, returns immediately unless the explicit developer flag is
enabled, and catches console failures so tracing cannot alter the request.

The logger must project values rather than serialize them wholesale:

- strings become type/length or safe labels, never contents;
- objects expose only top-level keys and structural booleans;
- errors expose status, phase, attempt, and diagnostic/error codes only;
- model names pass through the existing redaction/length limiter;
- content/body lengths are measured without logging content.

Insertion points:

- `request-start` immediately before the retry-wrapped operation.
- `transport-resolved` after `processRequest()`/`fetch()` resolves and before
  normalization. It includes status, ok, Content-Type, bodyUsed, method
  existence, constructor, and safe top-level keys.
- `normalize-start`, then method-specific `json-start`/`json-complete`/
  `json-error`, `text-start`/`text-complete`/`text-error`, and
  `reader-start`/`reader-complete`/`reader-error` around each actual body
  operation. Each record includes bodyUsed before/after and Content-Type.
- `normalize-complete` or `normalize-error` immediately at the final return or
  throw boundary. Error metadata includes only status, phase, and diagnostic
  code; `invalid-json` must be directly visible.
- `timeout-abort` / `caller-abort` when the existing controller is aborted,
  including whether status was already known and whether body reading had
  started/completed. This observes the current Promise.race without changing
  it.
- `response-json-from-text-start` and `response-json-from-text-complete` (or
  `...-error`) around the existing SSE/text parser, including body length,
  `data:` line count, content type, and counts/booleans for extracted
  `choice.delta.content`, `message.content`, and `text`.
- `analyzer-received` after the client promise resolves and after calculating
  the private `responseText()` length.
- `parser-start`, `parser-success`, and `parser-error` around the two existing
  parser calls; parser errors only expose safe diagnostic codes.
- `runtime-success`/`runtime-error` at Event Runtime terminal boundaries and
  the corresponding World Model UI success/error boundary.

No TRACE call may be placed inside a branch that consumes a response twice.
For a standard `Response`, the log must observe which existing method is
chosen; it must not add a fallback read that changes behavior.

## Test design

Keep client-shape tests in `tests/api-profile.test.js`, where current and
independent API fixtures already exist. Keep full Analyzer-to-parser tests in
`tests/world-model.test.js` and/or `tests/event-analysis.test.js`, reusing the
existing valid fixtures rather than weakening schema expectations.

Cover:

- current `processRequest()` returning `{content: string}` and OpenAI
  `choices[0].message.content`;
- independent standard JSON `Response`;
- a body-only Response-like SSE reader, which exercises the existing reader
  parser without introducing a transport change;
- a standard `Response` whose body is SSE, recorded as a diagnostic regression
  if the current json-first branch rejects it, so the task reports the exact
  current failure rather than silently changing production behavior;
- a 200 response whose body reader/json promise completes after a short delay
  but before timeout, plus the existing delayed-until-timeout coverage;
- full Analyzer response extraction for top-level `content`, OpenAI choices,
  and string results using existing valid World Model/Event fixtures;
- enabled TRACE metadata and disabled-by-default behavior, including an
  assertion that secrets and response text never reach captured logs.

## Compatibility and rollback

- No exported business DTO, parser contract, storage record, or host API call
  changes.
- No API Profile or Secret Store changes.
- If a checkpoint causes a test or host issue, remove only the logger calls and
  its tests; the existing request/normalization code remains unchanged.
- The final report will distinguish passing Node tests from pending real
  SillyTavern reproduction and browser acceptance.

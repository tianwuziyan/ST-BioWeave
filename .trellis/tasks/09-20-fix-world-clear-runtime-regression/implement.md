# Implementation Plan

1. Capture the exact UI, Runtime, Clear Service, adapter, token, and abort call
   chains with file/line evidence.
2. Compare Character and World clear plans, field mutation, save invocation,
   commit-state normalization, and post-clear Runtime completion.
3. Reproduce host adapter behavior with `saveChat()` returning undefined and
   with explicit failed/unknown responses; identify the real failing branch.
4. Implement the smallest storage/adapter/runtime fix. Preserve Floor
   ownership, exact allowlists, and persistence safety.
5. Add regression tests for successful World clear and immediate re-analysis,
   real adapter void return, explicit failure, unknown commit recovery, and
   Character clear.
6. Run focused tests, then `npm test`, `npm run check`, `node --check` on all
   modified JS, and `git diff --check`.
7. Review the final diff for forbidden Chat persistence, legacy fallback,
   Floor-root deletion, or swallowed errors. Do not commit or push.

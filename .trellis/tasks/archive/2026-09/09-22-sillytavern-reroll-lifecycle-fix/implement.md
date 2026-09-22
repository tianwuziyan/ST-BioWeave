# Implementation Plan

1. Inspect current runtime generation parsing, pending matching/cleanup, adapter event bindings, and existing scheduler tests.
2. Add a failing regression for the official ST positional `GENERATION_STARTED("regenerate")` payload and `GENERATION_ENDED -> CMR` order.
3. Make the smallest runtime change: normalize scalar generation type separately from owner ids, defer normal-ended cleanup until render, and preserve explicit stop/cancel cleanup.
4. Add regression coverage for cancelled/stopped generation, stale pending protection, existing Swipe reuse, and ordinary edit/update.
5. Run focused tests, then `npm test`, `npm run check`, `node --check`, and `git diff --check`.
6. Audit the diff and search for accidental changes to edit/swipe/interval/retry semantics.

## Out of scope

- No scheduler redesign, counter change, retry policy change, World resolution change, dedupe redesign, documentation architecture change, commit, or host-side code unrelated to reroll lifecycle.

## Final status

- implementation complete
- automated verification complete
- real SillyTavern host acceptance pending

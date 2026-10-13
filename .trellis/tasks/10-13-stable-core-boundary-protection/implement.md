# ST-BioWeave 稳定核心模块边界保护执行计划

1. Confirm applicable specs, current tests, and protected-file status.
2. Update the existing Event Pipeline domain contract only; cross-reference the existing Floor State contract.
3. Add the import-boundary static gate as a test covered by `npm run check`.
4. Add public Story Time/Tracking Window characterization tests without exporting or editing private helpers.
5. Run focused tests, `npm run check`, `git diff --check`, and protected-file diff/status checks.
6. Report evidence, known fast-path differences, Event coverage, behavior-change risk, and remaining real-host verification.

## Stop conditions

- Do not edit `story/time.js`, `core/events.js`, `core/tracking-window.js`, `runtime/character-event-analysis.js`, or `runtime/event-analysis.js`.
- If a requested characterization requires changing a private helper or business semantics, leave that case as a documented testability limitation rather than adding a seam.
- Do not commit, publish, reset, stash, or switch branches.

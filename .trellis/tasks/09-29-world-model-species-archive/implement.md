# Implementation Plan

1. Add pure archive module and generic fixture tests for archive/restore/reference/filter/gate primitives.
2. Wire World UI delete/add/restore/archive-list actions through the module and existing `runtime.saveWorldModel({model, meta})`; add UI tests and minimal style hooks if needed.
3. Add lifecycle registry/schema documentation entries for nested archive metadata without changing canonical model schema.
4. Add runtime Full/Supplement archive reference construction and deterministic Full filtering.
5. Add production Supplement prompt section and Full prompt exclusion section; add Host archived gate at Fact Delta safety boundary.
6. Add integration/lifecycle tests and production prompt proof that invokes real builders and prints final roles/messages.
7. Run syntax checks, relevant tests, full baseline comparison, `npm test`, and `git diff --check`.
8. Review scope against frozen architecture and update task journal/spec docs before finish; do not commit/push without separate authorization.

## Validation commands

```bash
node --check core/world-species-archive.js
node --check ui/world.js
node --check ui/app.js
node --check runtime/world-analysis.js
node --check ai/analyzer.js
node --check ai/prompts.js
npm test
git diff --check
```

## Review gates

- Before implementation: user approves this planning summary and task is started.
- Before completion: inspect actual diff, compare failure identities with baseline, verify no direct Floor writer, and run production prompt proof.
- Publication/commit remains separately authorized.

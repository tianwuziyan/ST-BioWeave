# 归因 npm run check 的 15 项 Event Analysis 与 Reroll 失败

## Goal

独立排查当前工作树中 npm run check 的 15 项失败。先按 Event Analysis 共同入口、Event canonicalization、Floor persistence/readback、Registry rebuild、Candidate re-evaluation 聚类并建立最小复现；Reroll scheduler 单独归因。不得混入 Story Time/Tracking/Timing 修复，不得批量修改生产代码。

## Requirements

- Re-run `npm run check` and preserve the complete 15-failure inventory with test
  file, line, assertion/error, first relevant production frame, and failure cluster.
- Establish whether the Event Analysis failures share a common upstream boundary:
  Event entry, canonicalization, Floor persistence/readback, Registry rebuild, or
  candidate re-evaluation.
- Establish a separate diagnosis for the Reroll scheduler failure; do not mix it
  with Event Analysis fixes.
- Use isolated test-name runs and read-only source inspection before changing
  production code. A clean pre-task baseline is unavailable, so unproven causal
  claims must remain explicitly unconfirmed.
- Do not modify Story Time, Tracking Window, Timing Instance, Settings Debug, or
  lifecycle contracts as part of this task.
- Do not delete tests, broaden skips, weaken Floor/Swipe/version checks, change
  production NSFW behavior, reset/stash/commit/push, or operate real ST Chat.

## Acceptance Criteria

- [ ] All 15 current failures are listed with reproducible command and evidence.
- [ ] Failure clusters identify shared upstream causes where supported and mark
  unresolved attribution where evidence is insufficient.
- [ ] At least one minimal reproduction exists for each confirmed cluster.
- [ ] No production code is changed unless a confirmed single root cause and a
  minimal regression test justify it.
- [ ] `npm run check` and `git diff --check` results are reported honestly; this
  task is not complete merely because unrelated tests are skipped.

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.

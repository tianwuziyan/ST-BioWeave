# 修复真实 SillyTavern World clear 回归

## Goal

修复真实 SillyTavern 环境中“清除世界数据”被报告失败、随后 World
Model 分析持续显示取消的问题，同时保持 Floor single source of truth 和
现有 persistence safety。不得恢复 Chat-level World Model、旧 projection、
`character_reset` 或整根 Floor 删除。

## Background and confirmed evidence

- 当前用户已确认：Character clear 在真实环境正常，World clear 失败。
- UI 清除失败文案来自 `ui/app.js:dataClearErrorMessage()` 的默认分支；其
  上游是 `dataClearFailureFromResult()` 对 `result.ok`、`result.error` 和
  persistence commit state 的判定。
- Runtime 清除链是：`runtime/events.js:runClear()` →
  `storage/clear.js:createClearService().run/execute()` →
  `buildClearPlan()` / `commitCurrent()` → `eventAnalysis.completeClear()` →
  UI refresh/toast。
- 当前普通 Chat 清除在提交前通过 `eventAnalysis.invalidateForClear()` 和
  Chat epoch invalidation；失败后 `completeClear()` 仍会再次 invalidate，
  但没有保证从 authoritative Floor reload/rebuild Runtime。此处是“存储未
  确认 + Runtime 失活”半失败风险点。
- 当前 `storage/clear.js` 的 World allowlist 仅为
  `world_model`、`world_model_meta`；`applyFloorClear()` 保留 Floor root、
  `v` 和 `floor_version`。
- 当前 `runtime/events.js` SillyTavern adapter 的 `saveChat()` 将 host
  `context.saveChat()` 的 `undefined` 包装为 `{commitState: "confirmed"}`；
  `storage/clear.js:commitStateFrom()` 对显式 failed/unknown 与成功/无状态
  需要继续分开验证。
- 当前 World Model UI 使用独立 `worldModelAbortController`；清除入口会
  调用 `abortUiWorldModelRequest()`，World Model 分析还会检查 Chat token。
- 当前 Floor Version 由 owner/input identity 计算，不应因删除
  `world_model` 输出而变化。

## Requirements

1. 精确记录两个用户提示的来源和完整调用链，确认 Character / World clear
   的实际分叉点，不通过吞错修复。
2. 修复真实 SillyTavern adapter 的保存结果解释和/或 post-write verification，
   使 host 正常的 void/undefined save 不被误判为失败；明确 failed、unknown、
   source verification failure 的边界。
3. 清除失败时必须 rollback 或重新从当前 authoritative Floor reload/rebuild
   Runtime，不能留下永久 aborted/stale 的 World Model 状态。
4. 清除成功后必须允许同一合法 Floor 立即再次进行 World Model 分析并保存
   新的 `world_model` / `world_model_meta`。
5. 保持 `v`、`floor_version`、人物域事实和未知未来字段不变；不触碰 Chat
   settings、global/API/Prompt/worldbook/角色卡/正文/其它插件数据。
6. 补充真实 SillyTavern adapter 返回值语义测试，以及 World clear → reload /
   re-analysis、明确失败、unknown commit、Character clear 不回归测试。

## Out of scope

- 不重构 Data Management UI 其它功能。
- 不恢复任何 Chat-level Floor projection 或 legacy fallback。
- 不放宽 owner/chat/epoch/revision safety。
- 不修改 Prompt、API 配置、世界书、角色卡或数据模型 ownership。
- 不 commit/push。

## Acceptance criteria

- AC1：两个提示均有 file/symbol 级来源和可复现调用链说明。
- AC2：真实 adapter 的 void/undefined successful save 不会产生 clear failure；
  明确 failure/unknown 仍不会报告 success。
- AC3：World clear 成功后只清除 world 字段，Floor root、`v`、
  `floor_version`、人物事实和配置保持正确。
- AC4：World clear 后重新分析能发起请求并保存新的 World Model，不被 stale
  token 或永久 abort 阻断。
- AC5：失败/unknown clear 后 Runtime 可恢复，下一次 World Model 分析不会因
  上一次 clear 永久取消。
- AC6：Character clear 现有行为继续通过。
- AC7：`npm test`、`npm run check`、修改 JS 的 `node --check` 和
  `git diff --check` 全部通过。

## Open questions

无。adapter contract、post-write verification 的具体实现以当前代码与可读的
SillyTavern adapter/test evidence 为准；不改变产品范围。

## Goal

诊断并修复 World clear persistence/runtime lifecycle 回归，补充真实 adapter 语义与重分析回归测试

## Requirements

- TBD

## Acceptance Criteria

- [ ] TBD

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.

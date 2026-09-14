# 事件分析最终失败增加 SillyTavern toastr 提示

## Goal

在手动事件分析最终失败路径调用现有 `notify(eventAnalysisError(error), 'error', documentRef)`，让 SillyTavern 顶部 toastr 告知用户最终失败原因，同时保留原错误继续向上抛出。

## Requirements

- 先检查 `manualRefreshEventAnalysis()` 的直接和间接调用方，确保最终用户可见的失败路径只产生一次 error toast；如果外层已经提示，则不新增重复出口。
- 保留现有成功提示，只产生一次 success toast；保留 `finally` 中的业务状态刷新。
- 失败路径使用现有 `notify()` 和 `eventAnalysisError()`，不重新实现通知系统，不重新分类错误。
- 失败路径必须 `throw error`，不能吞掉或替换 Runtime 抛出的原始错误对象。
- 只修改手动用户触发的事件分析路径。自动/后台分析只写状态、不弹顶部提示的行为本轮保持不变，除非代码审查发现它实际复用了手动用户出口。
- 不修改 `ai/client.js`、timeout/AbortError/diagnostic 分类或 Runtime 错误语义。
- 增加 UI 回归测试，覆盖 timeout diagnostic、成功、原错误传播和重复 toast 防护。

## Acceptance Criteria

- [ ] Runtime 抛出 timeout diagnostic 时，`eventAnalysisError(error)` 的返回文案被传给 `notify(message, 'error', documentRef)` 一次。
- [ ] 手动分析失败继续抛出同一个原始 error 对象。
- [ ] 手动分析成功仍只调用一次 success `notify()`，不会调用 error `notify()`。
- [ ] 不存在重复 error toast；测试能证明最终用户可见出口只有一个。
- [ ] 自动/后台分析行为未被扩展为频繁顶部提示。
- [ ] `npm test` 和 `npm run check` 通过，且变更 JavaScript 通过 `node --check`。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.

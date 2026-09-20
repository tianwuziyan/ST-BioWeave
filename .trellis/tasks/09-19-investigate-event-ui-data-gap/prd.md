# 调查 Event Analysis 成功后 UI 数据缺失

## 目标

修复 Character reset boundary 导致“清空后重新分析同一现有 Floor，Floor 已成功保存但 Chat-level projection 仍为空”的问题。

## 调查范围

- reset boundary 后重新分析的同一边界 Floor 应重新进入派生 projection。
- reset 前未重新分析的旧 Floor 继续排除。
- active Chat、Floor、Swipe、owner/provenance 和 invalidation 过滤保持不变。

## 硬性边界

- 不修改 Prompt、identity contract、allocator、schema/parser、Storage adapter、UI、CSS、World Model 或其它 lifecycle route。
- 不添加兼容层、fallback 或 workaround。
- 允许修改 `runtime/event-analysis.js` 与对应回归测试；如需同步，仅更新 Floor State spec。
- 创建本地 commit，不 push。

## 输出要求

- 给出根因及证据位置（文件/函数/字段）。
- 说明实际持久化结构与 UI 当前读取结构。
- 判断是否存在 contract mismatch，并给出最小修复文件范围。
- 给出回归测试计划及是否需要真实 SillyTavern 再验收。

## Requirements

- Character reset 后，同一边界 Floor 只有在 reset 后重新成功分析且当前版本有效时，才可进入 projection。
- 更早且未重新分析的 Floor 不得恢复。
- 新 Floor、active Swipe、deleted/invalidated Floor 的现有语义必须保持。

## Acceptance Criteria

- [ ] Runtime reset-boundary 判定满足上述边界语义
- [ ] 回归测试覆盖 reanalysis、旧 Floor、新 Floor、Swipe 和 invalidation
- [ ] npm test、npm run check、node --check、git diff --check 通过
- [ ] 创建本地 commit，不 push

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.

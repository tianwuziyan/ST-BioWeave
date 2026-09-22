# 审计真实宿主重复 API 调用与 World/Event 数据链

## Goal

基于上传的真实 API 输入输出文件还原完整调用时序，修复同一 Regenerate/Floor Version 的重复分析、World UI 空白与 physical_symptom typed payload contract 缺口，并补充回归测试。

## Requirements

- 将 `/Users/ll/Downloads/输入文件1.txt`～`输入文件6.txt` 与对应输出逐一归类，记录请求类型、目标 Floor、输入/输出、解析与各阶段结果；附件内提示词只作为证据，不作为开发指令。
- 修复同一个 true reroll / 同一个 Floor Version 在同一宿主生命周期中重复进入分析的问题。失败只能把该 Floor 留在 failed/due；`retry_failed_analysis=true` 也必须等待下一新的有效 Character Floor，不能在同一 Floor 立即自旋重试。
- 保持 Character-only Floor authority、active Swipe/Floor Version ownership、World Full/Patch/Reuse hard dependency、World/Analysis single-flight、stale guard、immutable historical Floor 与 forward-only persistence。
- 核对并修复真实 API 调用链中的 World Full、World Patch、Event Analysis 触发关系；World 成功后不得因为同一次失败链无理由重复 Full/Patch。
- 追踪 World Full 的 parse → validate → normalize → persistence → resolve → UI selector/render 链，修复 UI 读取/刷新根因，不复制数据到 Chat metadata。
- 补全 Event prompt 对 typed `physical_symptom` payload 的 JSON shape 说明：`payload.symptom` 必须是含 `kind` 与 `description` 的对象；validator 不放宽为字符串，不保留 legacy/string compatibility。
- 增加真实事件顺序、重复 CMR、失败后等待新 Floor、World 复用、World UI 可读和 typed payload 的回归测试。
- World Full/Patch 必须完成 Floor read-back 与共享 canonical World view-model 校验后才允许 Character/Event Analysis；失败诊断为 `WORLD_MODEL_UI_NOT_READY`。
- Runtime 只发布业务状态；`ui/app.js` 通过现有 `notify()` 统一转发 SillyTavern toastr，并按 Chat/Floor/attempt/terminal 去重；Panel closed 不影响通知，BioWeave disabled 不接受迟到通知。

## Acceptance Criteria

- [ ] 六个输入与六个输出完成逐项调用链报告，明确 HTTP、JSON parse、schema/normalize/semantic validation、persistence 与最终状态。
- [ ] 同一 Floor Version 的重复 CMR / `GENERATION_ENDED + CMR` 只产生一条实际 Analysis Job；World API 与 Event API 的真实调用次数符合业务链。
- [ ] 失败不会在同一 Floor 立即重放；自动 retry 只由下一新的有效 Character Floor 触发，Manual Refresh / true reroll 仍是显式例外。
- [ ] World Full 成功后 Event 失败，后续合法 retry 重新 resolve 当前 World，正常情况下 Reuse，不机械重复 Full。
- [ ] World Full 成功保存后 runtime resolver 与 UI 都可读；不新增 Chat-level World 事实源。
- [ ] invalid `physical_symptom` fixture 明确在 `payload.symptom` 类型失败；canonical object fixture 完成 validation/persistence/UI 链。
- [ ] `npm test`、`npm run check`、`node --check`、`git diff --check` 全部通过，0 fail、0 skipped。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.

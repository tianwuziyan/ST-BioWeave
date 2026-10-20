# 修复推演阶段替换与重复计算

## Goal

让内置受孕观察推演按人物、周期和当前 Story Time 阶段稳定复用：同一阶段不重复生成或保存；进入下一阶段时，当前合法 Character Floor 只保存新阶段快照，读取时由后楼覆盖前楼，回退楼层后自然恢复当时最近的旧阶段快照。

## Background

- 当前 `runtime/projection-runtime.js:538-652` 先读取 Projection，再把旧版或过期内置 Projection 作为删除/到期 lifecycle 记录写到新楼层；这与“新楼层只保存新阶段快照”的需求不符。
- 当前 `runtime/projection-runtime.js:841-890` 随后又把新候选作为第二次保存写入，并在 lifecycle 或生成发生变化后额外读取。
- 真实 Debug 已出现一次正文生成后由 `MESSAGE_RECEIVED`、`CHARACTER_MESSAGE_RENDERED`、`GENERATION_ENDED` 触发多次完整 Projection 执行；每次都在旧候选 lifecycle 保存阶段因 `FLOOR_VERSION_STALE` 终止，未进入新阶段候选生成。
- `storage/projection.js:218-249` 当前会聚合终点之前所有合法 Floor 的 Projection 记录；读取器尚未表达“同人物同周期的后楼阶段快照覆盖前楼阶段快照”。
- 当前工作树已有上一轮已接受但未提交的 Generation gate、批量保存、当前阶段 Context 过滤和 Debug 改动；本任务必须保留并在其上做最小增量修改。
- 当前 scheduler 的 interval gate 只应限制外部 World/Event/Projection API 分析；如果它把每楼都应执行的插件内置阶段同步一起跳过，阶段推进会停在旧阶段。这条内部路线必须与外部 API 路线分开。

## Requirements

1. 同一人物、`pregnancy_id|null`、周期和内置观察阶段已有完整有效候选时，后续 Character Floor 直接复用最近合法结果：不得再次生成候选，不得追加重复 creation、evidence 或阶段退出记录；机制元数据不能把同一人物的四条阶段分支拆开。
2. Story Time 进入下一内置观察阶段时，先在内存中准备完整的新阶段候选；准备成功后，当前 Character Floor 只保存新阶段 creation/evidence，不保存上一阶段候选，也不为阶段切换追加上一阶段的 `deleted`/`expired` 记录。
3. 阶段替换失败、Floor/Swipe/Chat/六字段 Floor Version 失效或新候选未准备完整时，当前 Floor 不保存任何新阶段记录；旧阶段仍只存在于原来的历史 Floor，不会被改写。
4. 内置阶段读取采用 Floor 快照覆盖语义：对同一人物、`pregnancy_id|null` 和周期，只返回终点之前最近一个含完整内置阶段快照的 Floor。比如 20 楼 `[A]`、26 楼 `[B]`，读到 26 楼为 `[B]`；回退到 23 楼后读到 20 楼的 `[A]`。
5. 实际 SillyTavern 正文生成尚未稳定结束时，不运行 Projection lifecycle、候选生成或 Floor 写入。一个生成过程的宿主尾部事件必须合并为一次最终处理；安静打开角色卡且没有正文生成时仍保留已有的安全只读重绑/恢复能力。
6. 每个已经 settled 的有效 Character Floor 都可运行插件内部的内置阶段判断；同阶段复用，跨阶段只保存新阶段。`analysis_interval` 不得阻止这条内部路线，也不得因此增加外部 API 调用次数。
7. factual lifecycle（已实现、矛盾、观察周期真正结束）、用户删除、Delivery 和 World Model Projection 的既有语义保持不变；Story Time 阶段切换本身不再伪装成事实到期或删除。
8. Debug/性能诊断必须能区分“同阶段复用”“阶段替换成功”“因 stale 取消”，不得把未发生的 AI 请求或成功保存写成已发生。

## Acceptance Criteria

- [ ] Projection Runtime 公共 seam：同阶段已有四条当前分支时，`process()` 返回成功/复用结果，生成调用为 0，Floor 写入为 0，最终 Context 仍取得原四条。
- [ ] Projection Runtime 公共 seam：从一个阶段跨到下一阶段时，为每个人物只生成当前阶段四条，不重新生成上一阶段；只调用一次现有 creation/evidence batch 保存，当前 Floor 的 lifecycle 集合不出现上一阶段的删除/到期记录，随后只做一次最终 readback。
- [ ] Projection Storage/Resolver 公共 seam：20 楼 `[A]`、26 楼 `[B]` 时，终点 26 只解析出 `[B]`，终点 23 只解析出 `[A]`；26 楼本地 timeline 只含 `[B]`，旧 `[A]` 仍只位于 20 楼。
- [ ] Runtime lifecycle 公共 seam：真实生成开始后，即使 provisional lease 曾超时，后续属于该生成的正文/渲染/结束信号也不会提前触发 Projection 写入；最终合法 Character Floor 只处理一次。
- [ ] 两个人物同时跨阶段时产生八条当前候选；每个人物按自己的周期独立选择最近阶段快照，旧阶段不出现在当前解析视图，也不会在每个后续 Floor 重复复制或追加删除记录。
- [ ] 现有 Projection、Delivery、Generation gate、Floor persistence、pregnancy lifecycle 测试全部通过；新增回归测试先能复现旧行为，再验证修复。
- [ ] `docs/ARCHITECTURE.md`、`docs/bioweave-data-lifecycle.md` 与 `.trellis/spec/domain/floor-state.md` 同步描述最终行为；不新增第二份持久化字段清单。

## Out of Scope

- 不修改推演页面、字体、按钮、人物显示或其他 UI。
- 不修改发给 SillyTavern 的 `<bioweave>` 内容格式和文案。
- 不更改 14–20、21–27、28–42 天的分支内容、人数识别、Aggregation 或 Timing 业务规则。
- 不物理删除或改写历史 Floor，不迁移 timeline schema，不修改已冻结的 `FloorPersistenceCoordinator` 主线。
- 不提交、不推送 GitHub；发布仍需用户单独授权。

## Test Seams

- `createProjectionRuntime().process()`：验证复用、阶段替换、生成次数和保存次数。
- `resolveProjectionTimeline()` / `createProjectionPersistence().getProjectionViews()`：验证后楼阶段快照覆盖、endpoint 回退和历史 Floor 不被改写。
- `createRuntime()` 的宿主 lifecycle 订阅：验证生成尾部事件只在 settled Character Floor 后触发一次处理。

## Blocking Questions

无。用户已经明确：同阶段复用；跨阶段的新 Floor 只保存新阶段快照，不保存旧阶段或旧阶段删除记录；回退后按 endpoint 自然读回前一快照。

# 完善 World Model Full Analysis 主按钮确认行为

## Goal

根据 active World Model 数据动态显示 Full Analysis CTA，并在重新分析前复用现有确认弹窗；保持 Supplement 不变。

## Confirmed Audit Facts

- Full Analysis render 位于 `ui/world.js` 的 `worldPage()`；当前 Full 文案固定为“开始分析”，Supplement 独立显示“补充分析”。
- Full click 由 `ui/app.js` 的 action delegation 处理，进入现有 `analyzeWorldModel('full')`；Supplement 使用同一分流入口但保持 patch 语义。
- 现有确认入口是 `confirmWithPopup(title, message)`，严格只有宿主 `POPUP_RESULT.AFFIRMATIVE` 才继续。
- Full Runtime 链由 `runtime.analyzeCurrentWorldModelFull` → `runWorldAnalysisJob(mode: "full")` → Full analyzer → archive filter → candidate/Floor persistence/readback/UI ingress 组成；UI 不负责清理旧 World Model。
- 未发现现成 `hasWorldModelData` / `isWorldModelEmpty` CTA helper。`buildWorldModelViewModel()` 是 species 非空的 UI-ready gate，不直接代表本需求的 active-data existence。
- `world_model_meta.archived_species[]` 是 archive metadata，不属于 active `world_model`；archive-only 不应触发“重新分析”。
- baseline focused tests：320 tests，288 pass，32 fail；失败集中在既有 prompt/debug/fixture identity，本任务尚未修改产品代码。

## Requirements

- Full CTA 从 active canonical World Model 派生：empty 显示“开始分析”，non-empty 显示“重新分析”。不得增加 `worldAnalysisHasRun` 等持久化状态。
- Full click 必须重新读取当前 `worldModelState.model`，使用与 render 相同的 pure helper，避免 stale DOM 文案绕过确认。
- empty 时直接调用现有 Full flow，不弹重新分析确认。
- non-empty 时先调用 `confirmWithPopup('重新分析世界资料', '重新分析会清理当前已有的全部世界分析数据，并根据当前资料重新进行完整分析。此操作会替换现有分析结果，是否继续？')`；取消立即 no-op，确认后只调用现有 Full flow。
- UI 不新增 clear/reset/save/AI 调用，不修改 Floor、World Model、meta、busy 状态；现有 cleanup/persistence 继续由 Full Runtime flow 所有。
- Supplement 的文案、disabled/busy 语义和 handler 不变。
- active-data semantics 必须覆盖 canonical World Model 的有效 world-level outlets（`species[]`、`medical_context`、`exceptions[]`、`unknowns[]`、`projection_rules[]`），同时忽略 `world_model_meta.archived_species[]`；具体空值判定以现有 schema normalization 结果为准，并通过 pure helper 集中实现。
- `hasWorldModelData` 必须是 pure helper：输入 raw/normalized model，先得到 normalized active canonical World Model，再只检查实际资料。不得把 canonical 默认 shape、debug/meta、analysis bookkeeping、timestamp/version 计入数据。
- empty semantics 固化为：`species[]` 有条目即有 active species 资料；`medical_context` 只有至少一个 normalized 字段为非空实际文本才算有资料；`exceptions[]` 只有至少一个条目的 `statement`、`applies_to` 或 `evidence` 非空才算有资料；`unknowns[]` 或 `projection_rules[]` 有实际条目才算有资料。默认空数组、null、空字符串、默认 medical context 不算资料。
- Confirmation 必须在调用 `analyzeWorldModel('full')` 之前完成；取消路径不能进入 busy、cleanup、AI、save 或 persistence。

## Acceptance Criteria

- [ ] empty canonical model render 为“开始分析”；Full click 不弹 reanalysis confirm 且调用 Full flow。
- [ ] non-empty active model render 为“重新分析”；Full click 先弹精确确认，取消不调用 Full flow、不改变 state/meta、不产生 persistence mutation，确认只调用 Full flow 一次。
- [ ] render 后 active model 改变时，click 以当前 state 重新判断并正确 gate。
- [ ] 首次 Full 成功后依靠重新 render 自然显示“重新分析”；清空 active model 后自然恢复“开始分析”。
- [ ] species-only、world-level outlet、archive-only、active+archive、busy empty、busy existing 均符合语义；Supplement 仍为“补充分析”且行为未变。
- [ ] focused/UI/full/npm tests 与 baseline failure identities 对比无新增失败；变更 JS 通过 `node --check`，变更通过 `git diff --check`。
- [ ] 无真实 SillyTavern 环境时明确标记 smoke 未运行，不将 mock test 作为 real-host 验证。

## Out of Scope

- 不修改 Supplement pipeline、AI prompts、Fact Delta/Patch V2、archive domain semantics、Floor persistence coordinator 或 SillyTavern adapter。
- 不创建第二套 `reanalyzeWorldModel()` 或手工清理逻辑。
- 不 commit、push、reset、clean。

## Planning Status

- Requirements and audit decisions are converged; no blocking product question remains.

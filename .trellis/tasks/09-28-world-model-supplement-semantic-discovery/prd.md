# 恢复 World Model Supplement 完整语义发现

## Goal

恢复旧 Full World Model 分析中“先扫描完整 semantic surface，再序列化”的发现强度，解决当前 Supplement 只产生少量 Facts、随后大量 `NO_EVIDENCE` 的问题；最终仍以当前独立 Fact Delta 逐条安全进入 canonical mutation。

## Confirmed Current Contract

- 当前分支为 `fix/world-model-prompt-baseline`；工作区已有前序未提交修改，必须保留。
- Supplement 已有独立 `[Fact]`、per-Fact parser/resolver、Evidence Guard、Coverage Targets/Review、Identity Discovery Review、retry/continuation 和 dynamic coverage fixed point。
- `Existing` 是 canonical target、comparison baseline 和 address reference，不是 evidence。
- Coverage Targets 是 completeness audit checklist，不是 output whitelist；Fact Discovery 可产生非-target Facts。
- Fact Delta parser 的 malformed Fact isolation、Evidence Guard threshold/scope binding、Resolver semantics、Runtime-owned persistence、Floor Coordinator、UI projection 和 Full World Model path 均冻结。
- 历史节点 `ce1d09517ed516bfa8a2c0ecf1b0444f0d59350c` 只作为旧 Full Discovery Contract 参考，不恢复旧 JSON schema、旧 Runtime 或旧输出机制。

## Requirements

1. 将 Supplement discovery 明确为三个内部 pass：
   - PASS 1 Identity Discovery：对 evidence-supported Species 发现全部 stable open-string Biological Types，持续 sibling search 至 evidence exhausted；不设数量下限、不假设二元。
   - PASS 2 Type Semantic Discovery：对每个已发现或 Existing 已知的 Species/Type，按完整矩阵逐字段扫描 `Type_Description`、六项 capability、六项 reproduction rule、`Maturation`、`Aging`、`Special_Rule`、`Reproductive_Mechanism`。
   - PASS 3 World Semantic Discovery：独立重新扫描全部 permitted evidence，发现 `Childbirth_Difficulty`、`Care_Level`、`Medical_Evidence`、`Exception`、`Unknown`、`Projection_Rule`。
2. 明确 discovery 顺序为 permitted evidence → PASS 1 → PASS 2 → PASS 3 → internal claim inventory → Existing comparison → Fact Delta serialization → Coverage Review → Identity Review。
3. Internal Claim Inventory 只作为模型内部任务，不新增输出 block、不进入 parser、canonical、Floor、Evidence Guard 或 diagnostics 大对象。
4. 强化 `NO_EVIDENCE` 语义：只有完整 semantic discovery 后，针对 canonical address + field 主动搜索全部 permitted evidence 仍无合法 claim 时才能使用。
5. 增加 generic field semantic guidance，解释字段分类边界，不加入故事专用关键词、species/type registry 或额外推断规则。
6. 调整 request topology，使 deterministic targets 出现在 discovery task 之后；retry/continuation 保持完整 base semantic contract，只附加 bounded directive。
7. 保持最终单一 root 与独立 `[Fact]` blocks；malformed Fact 只丢弃自身，合法 sibling Facts 继续保留。
8. 只修改 discovery prompt、必要的轻量 request-contract diagnostics/test 文案与 `tests/world-model.test.js`；不得改变 parser、resolver、guard、persistence 或 UI 行为。

## Out of Scope

- 不恢复整块 canonical JSON、旧 Full 输出格式或 hierarchical Candidate。
- 不修改 `parseWorldModelFactDeltaText()`、`validateWorldModelFactDelta()`、root framing 或 per-Fact fail-soft 实现。
- 不降低 Evidence Guard threshold，不绕过 scope binding，不把 Existing、模型输出或 `NO_EVIDENCE` 当 evidence。
- 不修改 `runtime/world-analysis.js` persistence ownership、`saveWorldModel()`、Floor Coordinator、`WORLD_PERSISTENCE_CONFIRMED`、UI ingress/renderer 或任何 UI ACK/adoption gate。
- 不顺手修复 `Reproductive_Mechanism` coverage mapping；若仍复现，记录为 `SEPARATE FOLLOW-UP REQUIRED`。
- 不 commit、push、reset、clean 或整理前序工作区修改。

## Acceptance Criteria

- [ ] Prompt 明确包含 PASS 1/2/3、完整 Type semantic matrix、独立 World pass、internal inventory、post-discovery `NO_EVIDENCE` 和 targets-after-discovery 顺序。
- [ ] T1–T5、T7–T11、T13–T16 generic regression coverage passes；T6 malformed Fact isolation remains passing；T12 guard behavior remains unchanged；T17 coordinator diff is empty。
- [ ] `node --test tests/world-model.test.js` passes。
- [ ] `npm run check` passes。
- [ ] `node --check` passes for all modified JavaScript files。
- [ ] `git diff --check` passes。
- [ ] `git diff -- storage/floor-persistence-coordinator.js` is empty。
- [ ] Final report covers Root Cause, Historical Comparison, Before/After topology, Output Contract, Files Changed, Frozen Layers, Tests, and Remaining Risk.

## Open Questions

无阻塞产品决策；技术实现必须先完成当前代码/历史节点对照审计，再进入实现。

# World Model Raw 到 Canonical 实施计划

本文件记录已批准实施阶段的执行顺序与验证结果。

## 1. 先建立回归与管线断点

1. 在 tests/world-model.test.js 增加全新抽象 fixture，直接区分：
   - raw response；
   - parseWorldModelResponse() 结果；
   - createAnalyzer.analyzeWorldModel() 最终 canonical；
   - worldPage() 对 canonical 值的展示。
2. 覆盖 "null" → JS null、canonical "无"、普通非空字符串和 UI “未知/无/原文”。
3. 增加 legal fertilization（不依赖现有关键词字面）与 ordinary interaction 的对照；同时保留一个 capability/role conflict 的 deterministic rejection。
4. 增加 stable unfamiliar biological type 的保留、identity/route/status/temporary candidate 的删除，以及 no-evidence candidate 的删除。

## 2. 最小 Analyzer 修正

1. 按测试确认 normalizeRuleText()、normalizeWorldModel() 和 sanitizeNonHumanType() 不需改变。
2. 移除或缩小 applyWorldModelFinalConsistencyGuard() 中 hasFertilizationMechanism() 的正向关键词准入；不添加新词典或更长 regex。
3. 保留 fertilization role flags 与 capability contradiction guard。
4. 如 Problem B 的正向回归失败，只修改 hasTypeSubtreeEvidence() 的通用证据边界；先确认不是输入 fixture 本身缺少 type-local evidence。
5. 不修改 species-specific 分支、UI renderer、schema 或下游模块。

## 3. 最小 Raw/Canonical trace seam

1. 为 createAnalyzer 增加可选开发/测试 trace sink，默认关闭；app 只把它接入现有高级/调试预览状态。
2. 在 parse 后和 final guard 后分别发送可复制的 trace 数据；不保存、不写日志、不进入普通 World UI。
3. 在 ui/settings.js 的高级/调试预览中显示 Raw response 与 Final canonical model；这是纯展示，不参与恢复或判断。
4. 测试 trace 能明确显示同一字段的 raw、parsed/canonical intermediate 和 final canonical 值；切换 Chat/刷新时 trace 清空。
5. 不把 raw 放入 world_model_meta、Chat metadata 或 World Model v1 schema。

## 4. 文档同步

- 在 docs/DATA-MODEL.md 明确：Chat 只保存 canonical World Model，当前 AnalysisInput 与 AI raw 不持久化；开发 trace 是临时观察 seam。
- 不修改 schema、storage schema、UI 规则字段或 special_rules 文案。

## 5. 验证顺序

1. node --test tests/world-model.test.js
2. npm test
3. npm run check
4. node --check ai/analyzer.js
5. 若修改 ai/prompts.js / ui/app.js / ui/settings.js，分别执行对应 node --check。
6. git diff --check
7. 检查 git diff --stat 和完整 diff，确认没有触及任务外已有 dirty changes；实现已按批准范围完成，提交前再次执行全部检查。

## 风险检查点

- final guard 变宽后不能让 false capability 与 fertilization 角色描述共存。
- type evidence guard 不能因为陌生名称而放行，也不能回到 single-type/species-wide fallback。
- raw trace 不能被误存进 Chat metadata，也不能让普通 UI 读取 raw 做恢复。
- 现有 special_rules、Human baseline、三态规则和 fixture-pollution regression 必须保持通过。

## 6. 实际实现结果

- `ai/analyzer.js` 删除了基于 `REPRODUCTION_RULE_EVIDENCE_PATTERNS.fertilization` 的非空文本准入；保留 fertilization role 与 capability 的确定性冲突校验。
- `applyWorldModelEvidenceGuard()` 未修改，继续负责 biological_type 的局部证据边界。
- `ui/app.js`、`ui/settings.js` 增加仅存在于当前页面内存的 Raw/Canonical trace；普通 World Model 页面和 Chat storage 不读取 trace。
- `tests/world-model.test.js` 增加陌生 fertilization 表述、type evidence 边界、trace 与中文设置预览回归。
- 已通过 World Model 117 项测试、全项目 217 项测试、`npm run check`、指定 `node --check` 与 `git diff --check`。

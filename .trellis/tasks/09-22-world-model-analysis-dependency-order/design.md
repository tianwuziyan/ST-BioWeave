# 技术设计

## 边界

只在现有 World/Floor 边界与 Event Analysis coordinator 内串联依赖，不创建第二套 World Analyzer，不改变 Floor storage abstraction。World domain 负责首次完整分析、patch 分析、patch 校验/合并和 World 保存；Character/Event domain 只消费最终 World Model DTO。

## 调用链

```text
resolveFloor(target)
  -> resolveWorldModelAtOrBefore(target)
  -> [missing or explicit world-dirty]
       analyzeWorldModel(initial) OR analyzeWorldModelUpdate(existing, current evidence)
       -> parse/schema validate
       -> merge patch with existing model
       -> normalize + validate merged model
       -> saveWorldModel(current target, Floor Version guarded)
  -> assert current owner / resolve final model again
  -> buildFloorAnalysisInput({ worldModel: finalModel })
  -> assertWorldModelAvailable(finalModel)
  -> analyzer.analyzeFloor({ analysisInput, worldModel: finalModel, ... })
  -> existing Event validation/persistence/downstream
```

World Analysis 的 save 只写当前 Floor 的 `world_model` / `world_model_meta`；Event save 保持现有字段隔离。最终 World Model 必须通过同一 normalized/validated boundary，不能把原始 AI response 传给 Event Analyzer。

## DTO 与 patch

- 首次分析复用现有完整 `WorldModelV1` 输出和 `analyzeWorldModel()`。
- 更新分析新增独立的 `WorldModelPatchV1`，只允许 AI 返回当前 Floor 的新增/明确修正 facts；AI 不接收“旧模型 + 新证据并返回完整模型”的任务。
- Patch DTO 第一版采用 `{schema_version: 1, add: {species: [], ...}, update: {species: [], ...}}`，缺少字段等同空，永远不等同删除；`remove` / `invalidate` 本轮不支持自动语义，因此不能借省略字段删除旧规则。
- BioWeave 程序在 `runtime/event-analysis.js`（或抽出的纯 World merge helper）按稳定 species/type/rule identity deterministic merge `validated A + validated Patch`，再对完整 B 做 normalize/validate。未命中的旧条目保留。
- patch parser/schema 错误、冲突未获正文明确修正证据、或 merged model normalization 失败均 fail-closed；保留 A 作为历史事实但本轮不进入 Event Analysis，不把失败 patch 当 B，也不保存 B。
- patch 为空时返回 A 的 clone，并可记录复用元数据；不触发空模型保存。

## World-dirty gate

在当前目标 Floor 的已处理正文和已有输入收集链中增加最小、可解释的 world-relevant evidence 判定，只把明确世界级规则词/结构证据作为自动更新信号（物种规则、biological type、reproductive mechanism/capability、妊娠成立规则、projection rule 等）。若 signal 不明确则 false。手动 refresh 传入强制更新标志；首次缺失永远强制完整生成。

## 硬前置

在 `runAnalysis()` 调用 analyzer 前增加 Runtime 断言；`buildFloorAnalysisInput()` 也不再构建 null World Model 作为可分析输入。`analyzer.analyzeFloor()` 增加低层 defensive guard，拒绝缺失/未验证 World Model，防止未来其他调用点绕过 coordinator。错误统一携带 `code = WORLD_MODEL_UNAVAILABLE`、stage 和 target Floor Version。

## 异步与历史

World execution 使用与 Event execution 相同的 Chat token、AbortController、Floor Version 和 current-owner assertion。World save 前后重新确认 owner；save 失败不破坏旧 A。Event execution 只有在 World execution 成功并确认最终 DTO 后才能开始。resolver 继续从 surviving Character Floors 反向查找，因此删除 B 自动恢复 A。

## 兼容性与风险

现有手动 World Model UI/API `saveWorldModel()` 保持签名和字段隔离；现有完整 World Analyzer 保持首次生成语义。主要风险是 world-relevant gate 过宽导致额外请求或过窄导致延迟更新，因此采用保守 gate + 手动 refresh，并用调用次数测试锁定默认复用行为。

# 技术设计：World Model Supplement 共享 UI ingress

## 历史对照结论（planning evidence）

LAST KNOWN GOOD（`89a76da`）核心路径：

```text
World analyzer / patch merge
  -> runtime/event-analysis.js:runWorldAnalysisJob()
  -> normalizeStoredWorldModel()
  -> saveWorldModel() -> existing Floor Coordinator -> readback
  -> result.model / result.view_model
  -> ui/app.js:analyzeWorldModel()
  -> worldModelState = { loaded, busy:false, operation:null, model, meta,
                         selection/editor reset, notice:null }
  -> render() when route === 'world'
  -> worldPage()
  -> renderWorldModelView()
  -> canonical field render helpers / DOM
```

旧路径在 tab 未打开时仍保留 `worldModelState`，不依赖 DOM；打开 World route 后 `render()` 使用已保留的 application state。打开 tab 的分析操作在开始时 render busy 状态，成功后再次 render；automatic path 通过 Runtime status/lifecycle refresh 读取 authoritative Floor。

CURRENT SUPPLEMENT 路径：

```text
Supplement Fact Delta
  -> parser / semantic resolver / accepted Patch v2 operations
  -> deterministic merge + canonical validation
  -> runtime/world-analysis.js:publishWorldModelCandidate()
  -> WORLD_ANALYSIS_CANDIDATE_READY
  -> ui/app.js:handleRuntimeEvent()
  -> adoptWorldModelCandidate()
  -> normalizeStoredWorldModel()
  -> buildWorldModelViewModel()
  -> worldModelState.model assignment
  -> confirmWorldModelCandidateAdoption()
  -> render() only when route === 'world'
  -> later save/readback/reload
```

审计重点是 Candidate adoption 当前是否完整继承旧 path 的 state metadata、refresh scheduling、render ordering和 request ownership。现有实现已显式用 load/adoption sequence 抑制旧 resolver result，但 ACK 当前位于 render 之前，且 Runtime 的成功 diagnostic 在 persistence/readback 后不能单独证明 UI state 已进入旧 ingress。

## 目标设计

提取或复用一个窄的 shared application helper（命名以现有代码审计结果为准），其唯一职责是把已验证 canonical model 应用到 `worldModelState`，构建既有 view-model，并返回 canonical/UI fingerprints 与可观测 state metadata。Manual analyze、Automatic Candidate Adoption 和必要的 historical-equivalence test 都调用同一 helper；不新增 renderer 或第二个 state model。

```text
Manual / Automatic
       -> canonical candidate
       -> sharedWorldModelUiIngress(candidate, metadata)
       -> worldModelState.model + state metadata
       -> existing render() / worldPage() / renderWorldModelView()
       -> ACK (Candidate path only)
       -> existing Runtime persistence path
```

Candidate path 的顺序必须是：接收 → chat/execution/fingerprint validation → canonical normalization → application-state assignment及必要 metadata → render request（open tab 时立即 render，closed tab 保留 state）→ ingress complete diagnostic → ACK。若已有 render 失败或 application state 未完整提交，不发送成功 ACK。

## State/generation 规则

- Candidate adoption 提升 `worldModelCandidateAdoptionSequence`，必要时使旧 `worldModelLoadGeneration`/refresh result 失效；不得通过 generic `worldModelState.loading` gate 丢弃合法 Candidate。
- authoritative reload 捕获 generation + candidate sequence；返回时若任一显示 Candidate 更新较新，则只记录 suppression，不覆盖 state。
- newer authoritative Floor readback 在其版本/owner/execution 合法且不再 stale 时，允许正常 reconciliation；不把 Candidate sequence 永久锁死。
- closed tab 不渲染，但 application state 和 fingerprint 必须完成；下次 route/open 的现有 `render()`/`loadWorldModelState()` 不得以空 state 覆盖 Candidate。

## Diagnostic contract

每次真实 Candidate adoption 记录安全摘要：`execution_id`、`candidate_revision`、candidate/UI before/after fingerprints、ingress started/completed、load generation before/after、render requested/completed、rendered revision/model fingerprint、stale reload suppression count、ACK sent/fingerprint。只记录计数和 fingerprint，不记录完整 model。

## Compatibility / rollback

保持 `WORLD_ANALYSIS_CANDIDATE_READY`、`confirmWorldModelCandidateAdoption()`、`saveWorldModel()`、`commitFloorPatch(owner="world")` 及现有 renderer 签名。失败时恢复 adoption 前 state，不写 Floor；可以按单文件/单测试 patch 回滚。禁止修改 `storage/floor-persistence-coordinator.js`。

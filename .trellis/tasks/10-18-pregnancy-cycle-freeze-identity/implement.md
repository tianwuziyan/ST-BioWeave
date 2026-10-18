# 实施计划：观察轮次冻结与身份转换

本文件记录实施顺序与当前验收进度。实现不包含 Host 注入、生产 Lock/Gate 或真实 ST 数据；本阶段代码随当前工作流提交并推送，真实宿主验收仍单独进行。

## Phase A：先写失败测试并确认业务前提

1. 增加聚合后新 Exposure 的 Runtime/fake-store 回归测试，先确认生产 Lock 关闭时当前路径的真实行为。
2. 增加聚合前 horizon 与 effective_min 不一致的测试：验证 Exposure 是否被提前拆散。
3. 增加观察阶段 `pregnancy_id=null` → ST 确认后具体 ID 的 Lifecycle/Projection matching 测试。
4. 增加不同具体 pregnancy ID、`not_pregnant` 和同 subject/cycle 的冲突隔离测试。
5. 增加删除来源后的历史快照、当前证据和诊断测试。
6. 增加无 cycle ID Lock 的 fail-closed、明确其他 cycle 的精确放行测试。
7. 增加观察周期结束仍未确认怀孕时的收尾测试：当前轮次结束，本轮 NSFW 事件被清掉，下一轮不会继续使用。

## Phase B：最小实现调整

1. 根据 Phase A 的实际结果，决定是否需要防御性冻结 Timing 来源；若业务 Lock 已足够，避免无必要修改正常写入路径。
2. 让 Tracking horizon 不再在正式聚合前拆散同一观察轮次，并同步 domain spec/test 语义。
3. 抽取或统一 nullable pregnancy identity 的 matching/transition 规则。
4. 为删除/编辑来源补充 `SOURCE_INVALIDATED` 或等价安全诊断，保持历史 Aggregation 不变。
5. 实现“超过观察周期且没有怀孕确认”收尾：结束当前轮次，清掉本轮 NSFW 事件，并确保下一轮从新事件开始。
6. 保持 Lock 未启用；只修正明确的 cycle identity 处理，不扩大普通 NSFW 禁止范围。

## Phase C：验证与文档

1. 运行受影响的 Tracking、Participant Aggregation、Pregnancy Lifecycle、Projection Runtime 和 Event Analysis 测试。
2. 运行 `npm run check`。
3. 检查 `docs/bioweave-data-lifecycle.md`、`docs/ARCHITECTURE.md`、`docs/DATA-MODEL.md` 和 `.trellis/spec/domain/pregnancy-tracking.md` 是否与最终实现一致。
4. 明确报告：历史 Aggregation、当前来源、Lifecycle identity、未怀孕后的清理结果和 Gate 状态。

## Phase D：ST Debug / 导出可观测性补充

1. 在现有 `debug.lifecycle_runtime` 中增加 `observation_boundary`，明确当前 Floor/Swipe、冻结状态、accepted Exposure、聚合后被排除的 Exposure、effective max、elapsed、timeout、release 和删除数量。
2. 让 Lifecycle、Projection delivery/view 的调试读取带当前 `endpointIndex`，避免把后续消息的状态混入当前 debug。
3. Settings 继续只展示 Runtime DTO；TXT 导出继续原样携带 `business_debug`，并用 UI/Runtime 回归测试确认字段没有丢失。
4. elapsed 以本轮第一次 Exposure 的 reference Story Time 为起点；只有超过 effective max 才显示 `due/overdue_not_released`，正常终止显示 `released/terminal_lifecycle`。

## Phase E：空 World Rule 时的内置受孕前候选

当 `projection_rules[]` 为空时，不能因此阻断已经具备有效 Timing、Tracking Window
和成功 Participant Aggregation 的观察轮次。Runtime 使用内置
`pre_confirmation_observation` 路径生成确定性的中性 Projection，不调用 Projection AI，
也不创建 BiologicalEvent、怀孕事实或 `pregnancy_id`。ST 正文与 Event Analysis 仍是确认怀孕的边界。
Debug 需要同时显示候选来源和是否实际调用 AI；缺少有效观察依据时必须显示无候选。
候选按每个人自己的经过天数分段：第 14–20 天为“嗜睡或疲倦 / 乳房敏感 /
对气味或食物产生轻微变化 / 暂时没有明显反应”；第 21–27 天为“恶心 /
闻到气味不舒服 / 情绪变化 / 食欲变化”；第 28–42 天为“恶心加重 /
可能出现孕吐 / 持续疲倦 / 一直没有明显反应”。进入下一段后，上一段不再作为当前候选重复生成。

## 当前验收记录

- 观察轮次业务修复与身份隔离实现已在工作区完成；本轮 debug/export 补充也已完成。
- 受影响的 Projection eligibility/runtime/UI 测试：130 pass、0 fail、5 skipped；完整 `npm run check`：1626 tests，1610 pass、0 fail、16 skipped。
- 相关 Runtime/UI/Storage JavaScript 已通过 `node --check`，`git diff --check` 通过。
- 真实 SillyTavern Desktop/Tablet/Mobile 宿主验收仍待进行；本阶段提交/推送不等同于宿主验收完成。

## 后续受当前证据影响的推演

- 历史 Aggregation 的 accepted Exposure 不会被改写。
- 当前快照只缺少部分 accepted Exposure 时，新 Projection 使用仍有效的当前子集，
  并在 Debug 的 `aggregation_evidence_invalid_event_ids` 中列出缺失 ID。
- 当前快照已经没有任何 accepted Exposure 时，Projection fail-closed；旧 Projection
  不会继续把失效来源带入正文。

## 风险点

- `core/tracking-window.js` 与现行测试目前把 horizon 拆轮当成有效行为，修改前必须完成契约确认。
- `runtime/projection-runtime.js` 需要同时支持观察阶段 null identity 和确认后的具体 pregnancy identity，不能简单使用全局严格相等。
- 生产 Lock 当前关闭，不能把测试能力开启误当成 H-14 已解决。

## 回滚点

- 先回滚新增测试以外的单一 domain/runtime 改动；不删除历史 Floor-owned 数据。
- 不修改或重写历史 Aggregation、Lifecycle archive/release 记录。

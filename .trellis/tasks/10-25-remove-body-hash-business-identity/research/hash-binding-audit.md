# Research：正文哈希业务绑定全仓审计

- 日期：2026-10-25
- 范围：`ai/`、`core/`、`runtime/`、`storage/`、`story/`、`ui/`、`tests/`、
  `.trellis/spec/` 与 `docs/`
- 结论：用户提供的旧审计抓到了主要症状，但边界结论不再正确，覆盖也不完整。

## 1. 对旧审计的核对

旧审计正确指出了 Event、Health、World、Projection/Storyline、scheduler 和部分
persistence 路径把 `content_hash`/`message_version` 当成业务身份的问题。

旧审计需要纠正两点：

1. 不能继续把六字段 Floor Version 作为异步 stale 和 persistence readback 的最终
   安全边界。正文编辑正是造成合法资料失活的根因；异步安全应迁移到明确的
   request/run/generation/operation identity 与 logical owner。
2. 不能保留 domain schema 中的正文哈希并仅声明“它不是业务身份”。这些字段已被大量
   通用 helper、ID builder、cache key 和 validator 自动传播，继续保留会再次被误用。
   新写入应移除，旧数据只做宽松兼容读取并忽略额外字段。

## 2. 根节点

`runtime/floor.js` 是当前传播源：

- `FLOOR_VERSION_FIELDS` 定义六字段；
- `floorVersion()` 对正文求哈希，并默认生成 `v1:${contentHash}`；
- `hasCompleteFloorVersion()`、`sameFloorVersion()`、`shouldAnalyze()` 把正文变化解释为
  owner/事实变化；
- `eventSourceMatchesFloorVersion()` 与完整 Event state 校验继续向下传播该语义。

目标模型应拆成：

```text
LogicalFloorOwner = chat_id + message_id + floor + swipe_id
AsyncOperationIdentity = request/run/generation/operation/transaction identity + owner/epoch
```

正文内容可以进入本次 API 输入或非权威诊断摘要，但不能进入上述第一种身份，也不能替代
第二种显式运行身份。

## 3. 生产代码完整清单

直接命中 `content_hash`、`message_version`、`sameFloorVersion()`、
`floorExecutionKey()` 或六字段常量的文件共 32 个：

### AI / Core schema 与确定性 ID

- `ai/analyzer.js`
- `ai/input-builder.js`
- `ai/prompts.js`
- `core/events.js`
- `core/health-assessment.js`
- `core/participant-aggregation.js`
- `core/projection-generation.js`
- `core/projection-persistence.js`
- `core/projection-storyline.js`
- `core/projection-timing.js`
- `core/projection.js`
- `core/snapshot.js`

问题包括：AI 合同继续声明六字段；Event source validator 要求正文哈希；Assessment
request key、Projection/Observation/Snapshot/Delivery ID 把完整 Floor Version 纳入摘要；
checkpoint/schema 因正文修改而失效。

### Runtime 识别、调度、读取和异步提交

- `runtime/activity.js`
- `runtime/character-event-analysis.js`
- `runtime/diagnostics.js`
- `runtime/event-analysis.js`
- `runtime/events.js`
- `runtime/floor.js`
- `runtime/generation-lifecycle.js`
- `runtime/health-assessment.js`
- `runtime/projection-context.js`
- `runtime/projection-runtime.js`
- `runtime/projection-storyline-runtime.js`
- `runtime/world-analysis.js`

问题包括：

- Event ID 和 pregnancy/fact ID 含正文哈希；
- current-floor、continuation、existing-event、health assessment、World Model 和 Storyline
  可见性依赖六字段相等；
- `floorExecutionKey()` 同时承担 scheduler、in-flight、invalidated、canonical cache、
  request key 和 health recovery key，正文编辑会制造“新任务/新 Floor”；
- `readStoryBodyByFloorVersion()` 因旧哈希拒绝读取当前同楼正文；
- Generation lifecycle 已有 `intent_id`/`generation_id`/Chat owner，却仍把正文哈希作为
  `pendingIsNewFloor` 和 current-owner 判断；
- Storyline submission/response fallback 直接使用 `content_hash`；
- UI/runtime activity completion key 因正文变化无法与启动记录配对。

### Storage / Floor 事务与派生集合

- `storage/floor-persistence-coordinator.js`
- `storage/participant-aggregation.js`
- `storage/pregnancy-lifecycle.js`
- `storage/projection-timing.js`
- `storage/projection.js`
- `storage/tracking-window.js`

问题包括：事务 owner/readback、current/stored/edit-start 比较和历史候选过滤都复用六字段。
`storage/participant-aggregation.js` 已存在只比较四字段的局部
`sameFloorOwnerIdentity()`，说明代码已被迫为手动编辑绕过六字段语义；应提升为唯一公共
owner helper，并删除局部双轨。

### 间接绑定与 UI

- `story/coordinator.js` 的 `versionKey()` 间接序列化六字段；旧审计遗漏。
- `ui/app.js` 的 runtime notification、business debug stale、World refresh、Event edit
  target 等 key 比较六字段；旧审计只笼统提到 Debug，未覆盖实际 UI 行为。
- `ui/settings.js`、`ui/state.js` 与 `runtime/diagnostics.js` 仍输出六字段/哈希语义。

### 需要分类而不是删除的 hash

`runtime/sillytavern-adapter.js` 的 `sourceRevision()` 对完整宿主 source owner 状态求摘要；
observation fingerprint、World candidate/full hash、prompt/request digest 等也不是单条正文
Floor hash。这些可以保留，但调用链必须证明它们只用于 source revision、内容缓存、语义
去重或诊断，不参与 Floor/domain 事实身份。

## 4. 测试覆盖影响

直接引用六字段或相关 helper 的测试至少 38 个，覆盖 Floor、Event、scheduler、generation、
World、Health、Projection、Storyline、Snapshot、Tracking、Participant、Pregnancy、UI、
Diagnostics 和 lifecycle。不能只改 Storyline 聚焦测试。

实施必须同时增加以下回归：

- 同一 logical owner 编辑正文后，各 domain 资料仍可读且 ID 稳定；
- 重新分析只重写当前 Floor 完整集合；
- Floor 删除、Swipe 切换/删除仍使原 owner 数据退出；
- 迟到 API 结果由显式 request/run/generation/operation token 拒绝；
- legacy 六字段数据能读取，但新写入不再带正文哈希；
- 非正文 observation/source revision hash 仍正常工作。

## 5. 文档与规格旧语义

至少需要同步检查：

- `.trellis/spec/domain/floor-state.md`
- `.trellis/spec/domain/event-pipeline.md`
- `.trellis/spec/frontend/state-management.md`
- `docs/ARCHITECTURE.md`
- `docs/bioweave-data-lifecycle.md`
- `docs/DATA-MODEL.md`
- `docs/DEVELOPMENT.md`
- `docs/AUTO-ANALYSIS-SCHEDULER.md`
- `docs/CHARACTER-HEALTH-STATE.md`
- `docs/UI.md`

这些文档仍包含“完整六字段 Floor Version”“编辑正文令旧结果失活”“按 hash 过滤历史
候选”等明确合同。仅改代码会让后续开发重新引入旧实现。

## 6. 最终审计结论

旧审计“不全”，且其“保留正文哈希作为异步/写入安全边界”的建议应废弃。迁移不能是
机械替换 `sameFloorVersion()`：每个调用点需归入以下三类后改造：

1. **逻辑 owner/业务读取**：使用四字段 logical owner；
2. **异步提交/并发事务**：使用 logical owner + 显式 operation identity/epoch；
3. **纯内容/语义指纹**：允许 hash，但与 Floor/domain identity 隔离并命名清楚。

生产代码、测试和文档全部迁移后，再用负向搜索确认正文哈希没有通过通用 DTO、fallback、
debug key 或 legacy helper 回流。

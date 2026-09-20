# Character Registry 与 Floor Snapshot 最小实施记录

本文件记录用户确认后的最小实施边界与验证计划。实施不兼容开发期旧
character_id；不做旧 ID read、migration、tombstone 或 legacy allocator。

## 实施顺序

### 阶段 0：确认与基线

1. 用户确认 `char_000001` sequential contract、response-global mention map 语义，以及
   中间 Floor 删除采用下游 invalidation；同时明确开发期旧数据不需要兼容。
2. 重新读取当时的 `floor-state.md`、`event-pipeline.md`、
   `bioweave-data-lifecycle.md`，确认当前 HEAD 与本规划基线一致。
3. 保留当前工作区 dirty 边界；实现前后只允许任务批准的文件出现差异。

### 阶段 1：Core identity

预计修改 `core/identity.js`：

- 增加严格的 sequential ID 识别、max sequence 和 collision-safe allocator；让
  `generatedCharacterId()` 从 working Registry 派生，不再调用 UUID/time/random。
- 当前正式 Runtime 只接受 `^char_[0-9]{6}$`、序号 `1..999999` 的 canonical Registry；
  不保留旧任意 key 的 read/migration 兼容路径。
- 在 unknown existing 分支加入唯一 exact display/alias fallback；0/多候选报现有
  unresolved 错误，禁止 `first-match-wins` 和 name-as-ID。
- 将 response-global mention map/raw reference map 接到
  `resolveEventAnalysisIdentities()` 的 atomic working copy；保证同 mention 只注册
  一次，所有 Event 和 pregnancy refs 使用同一 canonical ID。
- 保持 `new + character_id != null` 的拒绝和 unresolved 全批回滚。

必要时只增加小型纯 helper，不新增跨模块 Registry 层；所有公开旧函数签名尽量保持。

### 阶段 2：Runtime lifecycle/input

预计修改 `runtime/event-analysis.js`：

- previous candidate 缺失/不合格 Registry 时继续向前查找，不从 Chat projection 补齐；
- 将 `MESSAGE_DELETED` 纳入 coordinator 可处理的 lifecycle event 集合，使现有
  `invalidateMutation()` deletion 分支真实可达；确认最早受影响 owner、下游清除、
  projection rebuild 和异常路径；
- 保持 `buildFloorAnalysisInput()` target self-exclusion、active Swipe、reset boundary、
  owner/epoch/version guards 不变；不改变 API DTO 的 Registry 顶层位置；
- 确认失败 reanalysis 调用 `persistTerminalAttempt()` 时不会覆盖 old successful
  events/registry/analysis。

通常无需修改 `storage/store.js`、`runtime/events.js` 或 `ai/input-builder.js`；它们只在
实现时发现当前 abstraction 无法满足已确认 contract 时才进入 diff。`runtime/events.js`
的 binding 已存在，预计只需测试验证。

### 阶段 3：Prompt/文档

- Prompt 最多补一条精确格式示例和“只复制输入 Registry 中的 canonical ID”说明；不以
  堆 Prompt 替代 Runtime authority。
- Event/Registry schema 默认不动；同步 `.trellis/spec/domain/event-pipeline.md`、
  `.trellis/spec/domain/floor-state.md`、`docs/bioweave-data-lifecycle.md` 和 Prompt，
  明确 sequential ID、response-local mention 与不兼容旧开发数据的语义。
- 不修改 UI；不把 raw mention/provenance 暴露到产品页面。

### 阶段 4：测试与验收

优先扩展已有 `tests/character-identity.test.js`、
`tests/event-analysis-runtime.test.js`、`tests/runtime.test.js` 和必要的
`tests/storage-clear.test.js`，不创建重复测试层。完成后执行：

```text
npm test
npm run check
node --check core/identity.js
node --check runtime/event-analysis.js
node --check runtime/events.js
git diff --check
git status --short
```

真实 SillyTavern Desktop/Tablet/Mobile 的 event binding、Swipe owner persistence 和
Chat switch 仍需单独 host acceptance；Node 测试不能替代该验收。

## 最小未来文件集合

必选候选：

- `core/identity.js`
- `runtime/event-analysis.js`
- `tests/character-identity.test.js`
- `tests/event-analysis-runtime.test.js`

按文档同步需要候选：

- `.trellis/spec/domain/event-pipeline.md`
- `.trellis/spec/domain/floor-state.md`
- `docs/bioweave-data-lifecycle.md`

条件性候选：

- `ai/prompts.js`：仅极小文字同步；
- `tests/runtime.test.js` / `tests/storage-clear.test.js`：若补 storage/host lifecycle
  回归；
- `storage/store.js`：仅在现有 owner/snapshot validation 不足且无法在 Runtime 局部
  解决时进入，不预设重构。

明确不进入：独立 Registry 文件/数据库、Chat counter/tombstone、Character Card、UI、
`style.css`、Tracking 业务规则重写。

## 失败与原子性验收

每一次分析都必须遵循：

```text
previous owner snapshot
  -> clone working registry
  -> AI raw response
  -> response-global identity resolution
  -> new ID allocation
  -> participant/reference canonicalization
  -> full Event collection validation
  -> one owner save of analysis + events + full registry
```

任一 identity/reference/validation/owner/version/persistence guard 失败，都不能写半份
新结果；当前 Floor 的上一份 successful owner 数据继续存在，UI 的“上一份有效事件已
保留”必须由 `getCurrentFloorEvents()` 和 owner Registry 真实读回证明。

## 实施前停止条件

- 发现当前 HEAD、测试 fixture 或 dirty work 与本审计基线不一致；
- 同一 mention 的跨 Event display 冲突需要产品选择；
- host deletion payload 无法稳定定位最早受影响 message；
- 任一修复需要改变 Event schema 或 UI 展示。

上述情况需先回到用户确认，不用弱化 identity authority 或引入旁路状态。

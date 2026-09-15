# Floor-owned canonical character registry 实施计划

## 当前阶段与实施门槛

当前任务已获用户明确批准并进入 `in_progress`；已执行
`task.py start`。source-level audit、baseline red reproduction 和规划文档在
实施前完成。本轮允许修改业务代码、测试和 domain spec，但不 commit/push/merge。

实现必须保持上一轮 Floor State Ownership 修复，不以 Chat
Metadata 的旧 registry 作为兼容性理由重新开放历史 fallback。

## 既定测试接缝

依照 TDD 指引，测试固定在可观察的公共边界，不测试私有 helper 的实现细节：

1. `createRuntime()` / `getCurrentFloorAnalysisInput()`：观察 previous 和显式
   `character_registry` 的 provenance。
2. `store.getFloor()` / `store.saveFloor()` 及真实 ordinary/per-Swipe owner
   adapter：观察 snapshot 是否绑定到正确 message/swipe。
3. Analyzer message builder/API stub：观察最终
   `Runtime Canonical Character Registry` 和 request body，不只断言中间 DTO。
4. `refreshTrackingRegistry()` / `getTrackingRegistry()`：观察删除、失效和
   reload 后的 current projection，不把 Chat projection 当作历史事实。

每个切片按“一个 red 回归 → 最小实现 → focused green → 必要重构/审查”执行，
避免一次性先写一批与实现脱节的测试。

## Phase 0：冻结基线并写入 red 证据

- [x] 已用当前实现重现 Case J 的 baseline bug：Chat Metadata 只有
      `shen_qi_yuan`/沈祁鸢、`jue_xin`/觉心、`liu_ru_yan`/柳如烟，没有合法
      analyzed Floor；`previous` 为空，但输入 registry 和最终 Prompt 仍含三者。
- [x] 已确认污染链的最终 transport sink 是 `ai/analyzer.js` 经
      `ai/client.js` 的 request messages，而不是 previous resolver 自己恢复了
      target Floor。
- [x] 在 `tests/event-analysis-runtime.test.js` 的 runtime seam 增加 Case J
      正式回归；保留实施前的 baseline red reproduction，并在修复后确认
      input registry 为空且最终 API Prompt/request body 不含三个人名或 ID。
- [x] 将相关回归 fixture 的 `allowLegacyIdentity` 显式设为 `false`，排除兼容
      开关造成的假 green；未改变生产默认语义。

## Phase 1：逐切片建立 Floor snapshot contract

1. **Storage red/green（Case O 的存储部分，已完成）**

   - 先增加 ordinary message 与同一消息多个 Swipe 的 snapshot 读写测试：
     Swipe 0 的 `[A]`、Swipe 1 的 `[B]` 必须只从各自 exact slot 读到。
   - 在 `storage/schema.js` 增加 empty Floor 的 normalized
     `character_registry` sibling field，并明确其是成功分析 Floor snapshot；
     `storage/store.js` 在已有 owner/Chat scope/epoch abstraction 内读取和写入，
     不增加独立 Chat floor map 或按数组下标的 ID。
   - 运行 focused storage/runtime tests；验证缺失 Swipe、缺失 slot 和跨 Chat
     owner 仍 fail closed。

2. **Previous vertical slice（Cases J、K、L、P，已完成）**

   - 先将现有 previous/target self-exclusion fixture 扩展为 registry snapshot
     断言并确认当前实现不能满足新 contract。
   - 在 `runtime/event-analysis.js` 的既有
     `findPreviousSuccessfulBioWeave(target)` 单一扫描中，candidate 通过现有
     Floor/Swipe/Version/success/Event 校验时，同步返回该 candidate owner 的
     normalized snapshot；无 candidate 返回空 registry。
   - 不建立 identity 专用的第二个历史搜索；target 自身旧 snapshot、stale
     Version、非 active Swipe、删除 slot 和跨 Chat 数据均在同一候选校验处被排除。
   - 逐个使 J、K、L、P focused tests green：首次分析空；5F 继承 2F；重分析
     target 只继承更低 Floor；版本变化后回退到更旧 valid Floor 或空。

3. **Input vertical slice（Case J 的 API sink，已完成）**

   - 把 `previous.character_registry` 作为 `buildFloorAnalysisInput()` 的唯一
     historical registry source。
   - 调用 `characterContextResolver()` 时，Chat-shaped compatibility object
     必须覆盖/隔离原始 Chat registry，避免 custom resolver 读取 stale
     `chatData.character_registry`；角色卡、Persona、World Model、Recent Story
     仍按当前配置/context 契约提供，不把它们移入 Floor。
   - 角色上下文中的 event-derived profiles 只使用目标之前、楼层更低、版本有效且
     成功 Floor 的 causal Events；目标 Floor 的旧 Events 不能通过
     `characterContextResolver()` 作为隐性 previous 输入。
   - 保持 `ai/input-builder.js`、`ai/prompts.js`、`ai/analyzer.js` 的显式 DTO
     和 formatter 边界；除非 focused test 证明 empty shape 或字段名不兼容，不
     重写 AI 层。
   - 运行 Case J，确认 Prompt 和 API stub request 为空 registry；这一步必须
     证明原始三个人名无法经 custom resolver 或 `derivedChatData` 旁路进入。

4. **Identity resolution + atomic owner save（Cases K、L，已完成）**

   - 复用 `core/identity.js` 的 `resolveEventAnalysisIdentities()`，以 previous
     snapshot 为 base；不改变 opaque ID、existing/new/unresolved、alias、原子
     failure 规则。
   - 在 `runAnalysis()` 完成 identity resolution、canonical Event 绑定、严格
     collection validation 后，一次调用目标 Floor owner save，同时提交
     `analysis`、`events`、`identityResult.character_registry`。
   - 成功写入 target Floor 后，才刷新 Chat materialized projection；不得先把
     identity result 写入 Chat。测试 save call 顺序和一次 target payload，覆盖
     Floor save 失败时 Chat 不被新 identity 污染。
   - 5F 得到 `[A,B]`；重新分析 9F 时 input 只能是 5F `[A,B]`，不能读取旧 9F
     `[A,B,C]`；成功后的新 9F snapshot 才能替换旧 target snapshot。

## Phase 2：current projection、CRUD 和生命周期回归（已完成）

- `collectCurrentDerivedState()` 的 canonical projection 改为从当前仍存在、
  active Swipe、Version-valid、success 的 Floor snapshots 计算；没有 snapshot
  时返回 empty registry。Tracking subjects/candidates/profiles 继续使用上一轮
  current-valid Events-only rebuild，不与本任务合并成新的全局 registry。
- `getTrackingRegistry()` 的 preflight error 分支返回当前 valid projection 或
  empty registry，绝不直接 normalize Chat registry。
- `updateEvent()` 的 canonical participant membership 校验使用目标当前
  Floor snapshot；`deleteEvent()`、历史截断和 refresh 仍只从当前 Floor facts
  重建。
- 运行并逐项使下列回归 green：

  - Case M：删除 9F 后继承 5F `[A,B]`，再删 5F 后只继承 2F `[A]`；
  - Case N：删除全部 analyzed Floors、重载 runtime/plugin 后 registry、events、
    previous 和 API historical input 均为空；
  - Case O：Swipe 0/1 隔离，删除 Swipe 1 后 `[B]` 不经 Chat projection/fallback
    恢复；
  - Case P：编辑旧 Floor 改变六字段 Version 后旧 snapshot 不能作为 previous。

## Phase 3：legacy boundary（已完成，采用 fail-closed）

- 已基于当前宿主初始化 seam 验证：本仓库没有可安全确认的一次性 migration
  runner；普通 `refreshTrackingRegistry()` 和 API request 均不承担 migration。
- 若实现 migration：

  1. 仅扫描当前存在、active Swipe、完整且匹配 Version、成功分析但缺 snapshot
     的 legacy Floor；按消息顺序生成 snapshot。
  2. 只从该 Floor 当前有效 Events 能证明的 exact canonical IDs 构建；旧 Chat
     registry 仅作这些 ID 的 display/alias enrichment，不能全量复制。
  3. 写入 Floor owner 后才更新 projection；全部成功后写 Chat-local migration
     marker。任意 owner save 失败不写完成 marker，重试仍不开放普通 fallback。
  4. 若无安全 host hook，则保留 `bootstrapCharacterRegistryFromLegacy()` 为
     显式 migration utility，默认不自动调用；旧 Chat-only identities 按 empty
     处理。这个 fail-closed 选择优先于不安全的兼容恢复。

- [x] 保留 `tests/character-identity.test.js` 的纯函数 bootstrap 显式 migration
      测试；未新增自动 migration，因此 ordinary runtime test 不通过该 helper
      取得 Chat historical registry。

本轮保留 `bootstrapCharacterRegistryFromLegacy()` 作为显式 legacy utility，但
生产 Runtime 没有 caller；旧 Chat-only identities 不自动迁移，按空 registry
处理。现有 identity unit test 继续锁定其 exact-ID、不合并行为。

## Phase 4：规范同步（已完成）

- 更新 `.trellis/spec/domain/floor-state.md`：明确
  “Floor-derived canonical identity history is Floor-owned cumulative snapshot
  state”，并明确 “Cumulative does not mean global authoritative ownership”。
  同时说明 Chat-level `character_registry` 不是 Analyzer historical source，
  以及 snapshot 的 active Swipe/六字段 Version 有效性。
- 更新 `.trellis/spec/domain/event-pipeline.md`：将 identity candidate source、
  previous bundle、resolution output、Chat projection 和 bounded legacy migration
  的职责与新实现同步；删除/改写 lazy Chat bootstrap 作为普通路径的旧条款。
- 复核 `AGENTS.md`：当前 Floor/API/tracking/cache redlines 与新规则一致，规划
  阶段未发现冲突，因此预期不修改；若实施 diff 暴露直接矛盾，只做最小同步并
  在最终报告说明。
- 不修改 `.trellis/spec/domain/world-model.md`，除非实现审查证明存在与当前
  Character Card/Persona/World Model 配置边界直接冲突；本任务不把配置移入 Floor。

## 预期文件边界

预计必须触及：

- `storage/schema.js`
- `storage/store.js`
- `runtime/event-analysis.js`
- `core/identity.js`（仅 legacy boundary 的注释/导出或必要小调整）
- `tests/event-analysis-runtime.test.js`
- `tests/runtime.test.js`
- `tests/character-identity.test.js`（若 migration 需要覆盖）
- `.trellis/spec/domain/floor-state.md`
- `.trellis/spec/domain/event-pipeline.md`

预期保持不变并在检查中证明：

- `runtime/floor.js`
- `runtime/events.js`（除非 generic Floor adapter 无法承载新 sibling field）
- `core/tracking.js`
- `ai/input-builder.js`
- `ai/prompts.js`
- `ai/analyzer.js`
- Event/World Model/API profile schema、生产 UI DTO、无关 migration/config。

## 验证命令与质量门

实施每个切片后先运行最小 focused test；完整实现后运行：

```bash
npm test
npm run check
node --check core/identity.js
node --check runtime/event-analysis.js
node --check storage/schema.js
node --check storage/store.js
git diff --check
python3 ./.trellis/scripts/task.py validate .trellis/tasks/09-16-floor-owned-character-registry
```

按照根 `AGENTS.md`，所有本任务实际修改的 JavaScript 文件必须在继续 Git 操作
前用仓库本地 Prettier 实际格式化，例如：

```bash
npx prettier --write <本任务实际修改的 .js 文件>
```

不得把格式化前版本恢复回来；Prettier 失败则停止质量门。完整结果还要静态确认：

- 普通 API/request builder 中不存在 Chat registry historical fallback；
- `bootstrapCharacterRegistryFromLegacy` 只有明确 migration/legacy adapter caller；
- 任何 historical identity 都带 Floor/Swipe/Version provenance；
- `last_processed_floor`、runtime cache、Tracking、profiles、candidates 不能
  产生 previous identity；
- 删除 Floor/Swipe 后 prompt/request body 不含已删除 identity；
- `npm test` 与 `npm run check` 的既有 A-I 行为不退化。

## 真实宿主验收与风险

Node 测试验证公共 runtime/storage/API stub seam，但不能完全替代真实
SillyTavern 的 Chat reload、plugin reload、active Swipe 切换、Swipe 删除和
宿主 save 时序。实现后应在真实 Desktop/Tablet/Mobile host 分别确认：

1. Chat Metadata 中残留旧 registry 时首次分析不会出现在 Prompt；
2. 2F/5F/9F 重分析、删除和历史截断后的 previous registry 与测试一致；
3. message `extra` 与 `swipe_info[swipe_id].extra` 无交叉污染；
4. Floor save 失败/Chat projection save 失败时没有半成品历史被 API 使用；
5. reload 后只从当前有效 Floor owner 重建。

## 当前验证结果

- `node --test tests/runtime.test.js tests/event-analysis-runtime.test.js`：81/81
  通过。
- `npm test`：533/533 通过。
- `npm run check`：533/533 通过，并通过 `node --check index.js`。
- 已执行目标 JS 的 repository-local Prettier；所有命令成功且没有未格式化的当前
  变更文件。
- `git diff --check` 与 `task.py validate` 作为最终质量门执行；Trellis validate
  仅提示 event-pipeline 与 audit research 文件超过 context 注入大小，不是内容或
  测试错误。

若 legacy migration 入口无法安全确认，实施以 fail-closed 为默认，并在最终兼容
风险中明确旧 Chat-only identity 不自动迁移；不得为消除兼容风险而恢复普通 Chat
fallback。

## 回滚点

回滚只允许针对本任务新增的 Floor snapshot 字段、runtime registry owner 选择、
bounded migration marker/utility、规范同步和 J-P 测试；保留上一轮已经通过的
Floor/Event/Tracking/in-flight/last-processed 修复。任何失败路径都保持空 registry
和 current-valid Floor provenance，不恢复 orphan Chat identities。

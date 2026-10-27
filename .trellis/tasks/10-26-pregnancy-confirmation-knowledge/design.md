# 技术设计：怀孕确认与人物知情边界

## 1. 设计目标

在不改变 `pregnancy_confirmation` 事实合同的前提下，把“已经确认怀孕”和“哪些人物明确知道这件事”拆成两条可独立演进的数据链：

```text
正文事实
  → Character/Event Analysis
  → pregnancy_confirmation BiologicalEvent
  → Pregnancy Episode confirmed

同一次正文分析
  → pregnancy_knowledge_candidates sidecar
  → Host 唯一身份与 Episode 绑定
  → 当前 Floor 的完整 knowledge snapshot
  → 后续 Event Analysis 与正文生成上下文
```

事实 Event 决定怀孕是否成立；knowledge snapshot 只决定人物认知范围。任何一条链失败都不能伪造另一条链的成功。

## 2. 已确认边界

- `pregnancy_confirmation` 继续只使用既有 `pregnancy_id` payload，不加入 `known_by`。
- 知情状态是新的 Character Floor root，不进入 Chat metadata、Runtime cache、World Model、Character Profile 或 Pregnancy Lifecycle append-only timeline。
- 一个知识作用域由 `{subject_id, pregnancy_id}` 唯一确定；Chat/消息/Swipe/Floor 归属由完整 Floor Version 提供。
- 权威身份只存 canonical character ID。姓名与 aliases 仅用于模型输入、正文上下文和 Debug 展示。
- 未列入名单的人默认不知道；目标人物、检查者、在场人物、玩家均不自动知情。
- 第一版只新增明确知情人，不实现自动遗忘、撤销或普通产品 UI 编辑。

## 3. 模块边界

新增一个独立 feature owner，避免把知识规则堆入通用 Event Pipeline：

- `core/pregnancy-knowledge.js`：schema、normalize/validate、候选逐项资格判定所需的纯 DTO、完整集合替换/合并、endpoint read projection。
- `storage/pregnancy-knowledge.js`：最近合法完整快照读取、当前 Floor complete replacement、Coordinator readback。
- `runtime/pregnancy-knowledge-runtime.js`：同一次 Event Analysis 结果后的身份/Episode 绑定、合格候选合并、stale guard、Debug DTO 和上下文 read capability。

现有模块只做窄接线：

- `ai/analyzer.js` 解析 sidecar；`ai/prompts.js` 声明输出规则并展示现有知识参考。
- `runtime/character-event-analysis.js` 在 Event canonical persistence/readback 后，把 sidecar 与当前分析结果交给 pregnancy-knowledge runtime；不在此处实现知识领域规则。
- `runtime/projection-context.js` 把只读知识投影合入已有 `bioweave_projection_context`，不创建第二个 extension prompt slot。
- `runtime/runtime.js` 负责 capability 注入；`runtime/events.js` 与 `runtime/event-analysis.js` 不拥有新状态机。

不新增 Manager/Repository/Factory 层，也不复制 Character Registry 或 Event reconciliation 逻辑。

## 4. 数据合同

### 4.1 Floor root

新增可选 root：

```text
pregnancy_knowledge_snapshot:
  schema_version: 1
  complete: true
  entries: PregnancyKnowledgeEntry[]
  created_at_floor_version: CompleteFloorVersion
```

root 存在且 `complete=true` 时，`entries: []` 也是权威结果，会阻断向前回退。旧 Floor 缺少 root 表示该 Floor 没有保存知识快照，可以继续向前寻找最近合法完整 root。

### 4.2 PregnancyKnowledgeEntry

```text
subject_id: canonical gestational subject id
pregnancy_id: canonical Pregnancy Episode id
knowers:
  - character_id: canonical knower id
    learned_at_floor_version: CompleteFloorVersion
    evidence_fingerprint: bounded deterministic fingerprint
updated_at_floor_version: CompleteFloorVersion
```

约束：

- `subject_id + pregnancy_id` 在一个快照中唯一。
- 同一 entry 内 `character_id` 唯一并稳定排序。
- `learned_at_floor_version` 保留首次形成明确知情事实的来源；把完整集合复制到新 Floor 时不改写它。
- `updated_at_floor_version` 表示该 entry 最近一次集合变化，不代替每个 knower 的证据来源。
- 不持久化 display name、aliases、完整正文、prompt、raw response、模型参数或传闻状态。
- endpoint read 必须验证 subject、pregnancy episode、knower identity 与来源 Floor/Swipe 仍然有效；失效项不进入产品/AI read projection。

## 5. 完整快照读写

### 5.1 读取

给定当前 endpoint：

1. 只查看当前 Chat 中不晚于 endpoint 的合法 Character Floor/active Swipe。
2. 从后向前选择最近一个 schema 合法且 `complete=true` 的 root。
3. 返回该 root 的整个集合；空数组直接返回空，不继续回退。
4. 对 entries 和 knowers 做 provenance、Registry、Episode 存活校验，构建只读有效投影。
5. Runtime cache 只能保存 hint，不能补回失效或未来 Floor 数据。

### 5.2 写入

当至少一个候选合格且产生新知情关系时：

1. 锁定当前 Character Floor、active Swipe 和完整 Floor Version。
2. 读取当前 endpoint 最近合法完整知识集合。
3. 按 `{subject_id, pregnancy_id}` 更新目标 entry；按 `character_id` 去重追加合格 knower。
4. 保留未变化的其它妊娠 entry 和 knower。
5. 把整个有序集合重绑定为当前 Floor root，并通过专用 `pregnancy_knowledge` owner 提交。
6. Coordinator 执行 sibling-preserving merge、Host save 和权威 readback；Runtime 比较完整预期集合。
7. readback 或 stale guard 失败时不报告成功，也不修改历史 Floor。

因此 20/26/30/回退 23 的行为严格是 `[A,B]`、`[A′,B]`、`[A′]`、`[A,B]`。第一版业务运行只追加 knower，但存储合同支持显式完整 replacement 与空 tombstone，供 clear、纠错或未来显式删除使用。

### 5.3 Coordinator 与 lifecycle

- `storage/floor-persistence-coordinator.js` 只增加 declarative owner allowlist：`pregnancy_knowledge → pregnancy_knowledge_snapshot`；不修改队列、merge、save、readback 或 stale 算法。
- `storage/schema.js` 与 `storage/lifecycle.js` 注册 root。
- Character/All clear 删除；World clear 保留。
- ordinary Chat switch 只重绑/读取；Start New Chat、message delete/edit、Swipe switch/delete 和 Floor rollback 按现有生命周期重建。
- 旧数据缺字段时按 absent 处理，不回填历史 Floor，不做 destructive migration。

## 6. Event Analysis sidecar

### 6.1 输出形状

固定 Event envelope 增加可选 sidecar：

```json
{
  "schema_version": 1,
  "events": [],
  "pregnancy_knowledge_candidates": [
    {
      "pregnant_character": {
        "display_name": "柳如烟",
        "aliases": ["如烟"]
      },
      "knower": {
        "display_name": "觉心",
        "aliases": []
      },
      "observation": "正文中的短证据原句"
    }
  ]
}
```

模型不得输出 `subject_id`、`character_id`、`pregnancy_id`、Floor Version 或 Event ID。候选只表示“正文明确让某人物知道某人的已确认怀孕事实”，不表示 Host 已经接受。

### 6.2 Parser 与独立合格原则

- 顶层字段需要显式加入固定 envelope allowlist。
- `pregnancy_knowledge_candidates` 缺失或为空不影响 Event。
- sidecar 不是 Event atomic collection 的成员；每个 candidate 单独 normalize/validate。
- 单个 candidate 字段非法、超长、携带内部 ID 或结构错误时只拒绝该项并产生安全 diagnostic，不使合法 Event 或 sibling candidate 失效。
- Event collection 仍遵守现有整体 canonical validation；Event 失败时不产生新的怀孕事实。Knowledge candidate 只有在 authoritative Event persistence/readback 后才尝试绑定，因此不会基于未保存 Event 写入。

## 7. Host 绑定与资格判定

每个候选按以下顺序 fail closed：

1. `observation` 必须是当前 narrative discovery window 中的短原文片段，不能只来自 World/支线/旧知识提示。
2. `pregnant_character` 的姓名/aliases 必须在当前 authoritative Character Registry 中唯一解析到一个 canonical subject。
3. `knower` 必须唯一解析到一个 canonical character；零匹配、多匹配、匿名或临时称谓直接拒绝。
4. 该 subject 必须恰好有一个当前有效、未结束且已 confirmed 的 Pregnancy Episode。它可以来自本次刚完成 readback 的 `pregnancy_confirmation`，也可以来自先前合法 Floor。
5. observation 必须表达该 knower 已经获得确认结果；仅在场、参与检查、怀疑、传闻、猜测、准备告知或玩家全知都不合格。
6. 如果 `{subject_id,pregnancy_id,knower_id}` 已存在则幂等 dedupe，不写新 Floor。

同一响应中每项独立处理：有效项合并，非法项诊断后跳过。多人怀孕时先按 subject 绑定 Episode，再按 knower 合并，禁止使用一个扁平 Chat 级名单。

## 8. Prompt 与统一资料端口

Event Analysis 保持既有 SYSTEM/SYSTEM/ASSISTANT/USER 结构。新增内容遵守当前统一格式边界：

```text
原始知识快照
→ formatPromptContextContent({kind: 'pregnancy_knowledge', ...})
→ 只返回中文层级正文
→ ai/prompts.js 自己添加标题、用途说明和 SYSTEM/USER 位置
```

统一正文按 pregnancy 分组，只显示 Registry 投影出的名称/必要 aliases，不显示内部 ID：

```text
- 怀孕人物：柳如烟
  - 已知情人物：
    - 柳如烟
    - 觉心
  - 其他人物：默认不知道
```

空知识块直接省略。调用模块拥有标题与说明，公共 formatter 不返回标题、用途说明或消息角色。

Event prompt 额外明确：

- 只有正文新建立的明确知情事实才输出 candidate；
- 已有名单只用于避免重复和维持认知边界，不是新证据；
- 不在名单的人默认不知道；
- 传闻/猜测/准备告知不进入 candidate；
- knowledge candidate 不得反向创建 `pregnancy_confirmation`。

## 9. 正文生成上下文

复用唯一 `bioweave_projection_context` slot。`runtime/projection-context.js` 获取当前合法 pregnancy knowledge read projection，并与 Projection、Storyline、Health Guidance 一起构建一次 prompt：

```text
【已确认怀孕与知情范围】
- 怀孕人物：柳如烟
  - 明确知情：柳如烟、觉心
  - 认知边界：除上述人物外，其他人物默认不知道，不得使用全知视角让其直接掌握结果。
```

- 每个 `{subject_id,pregnancy_id}` 独立成组；多个怀孕人物不可合并名单。
- 只使用当前 endpoint 有效 Registry 名称；无法得到安全显示名时该项不注入，不能退化为裸 ID。
- 该段是已确认事实的认知边界，不是新的 Projection，也不重新启动受孕前 storyline。
- 即使当前没有 Projection/Storyline，只要存在合法知识投影，slot 仍应保持该知识上下文。
- disable、Chat/Swipe/Floor 变化或没有合法数据时，沿用现有 slot clear/stale 规则。

## 10. 并发、失败与恢复

- knowledge 写入使用当前 Event execution 的 owner/epoch/Floor Version，并在 Event readback 后再次校验。
- 同一 Floor 多 subject/candidate 合并为一次完整快照写入，避免并行 candidate 覆盖 sibling。
- 如果其它同 owner 写入可能并发，使用 Coordinator `patchResolver` 在提交点基于 latest authoritative root 重新应用幂等 additions。
- Knowledge persist 失败不回滚已经合法保存的 Event；结果必须标记 partial/knowledge_failed，保留下次 Event Analysis 从正文重新识别的机会。
- 合法 knowledge candidate 不得因另一个 candidate 失败而丢失；但一个 candidate 所需的完整字段和唯一绑定缺一不可。
- 重复 analysis、retry、reload 和相同候选通过 deterministic fingerprint 与三元组去重。
- 不因 API 沉默复制当前状态到每一 Floor；只有集合变化、显式清空或生命周期操作才写当前 Floor。

## 11. Debug、诊断与 UI

- `collectActiveBusinessData({includeDebug:true})` 增加只读知识摘要：每个 pregnancy 的 subject display name、knower display names/count、来源 Floor 摘要、过滤/拒绝计数和当前 root owner。
- bounded diagnostics 区分：sidecar parsed、candidate accepted/rejected、identity/episode binding、snapshot unchanged/write/readback/stale/failed、context included/omitted。
- diagnostics 不保存完整正文、observation 原文、prompt、raw response 或凭据；仅保存 fingerprint、长度、reason code、canonical IDs 和 Floor provenance。
- Settings Debug 复用现有界面/导出，不新增普通产品 UI 或编辑入口。

## 12. 文档与兼容

实现完成时同步：

- `docs/ARCHITECTURE.md`：新增 feature owner、调用路径和唯一 slot 合成。
- `docs/bioweave-data-lifecycle.md`：root location、clear matrix、mutation/stale/readback 行为。
- `.trellis/spec/domain/floor-state.md`：完整快照、previous、统一 prompt content port。
- `.trellis/spec/domain/event-pipeline.md`：sidecar、逐项合格、Event/knowledge 独立成功边界。
- `docs/DATA-MODEL.md` 与 `docs/CONTEXT-AND-PROMPT.md`：仅在最终实现使现有描述不完整时更新。

旧 Floor 和旧响应不含新字段时继续正常工作；没有 migration/backfill。停用新 runtime capability 后，旧代码可忽略可选 root，事实 Event 不受影响。

## 13. 回滚策略

- AI sidecar parser/prompt、knowledge core/storage/runtime、context injection 分阶段接入，任何阶段都可在不改历史 Event 的前提下关闭调用。
- 新 root 是可选 Floor sibling；移除 runtime 接线不会要求重写或删除历史 Floor。
- Coordinator 只新增专用 allowlist owner；回滚时撤销该 owner 与调用方，不触碰冻结的 persistence mechanics。
- 不对既有 `pregnancy_confirmation`、Pregnancy Lifecycle 或受孕前 storyline schema 做兼容性改写。

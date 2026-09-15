# 实施计划

本计划已获用户批准并按阶段执行；当前任务已由 Trellis 标记为
`in_progress`。实施保持本文件的范围、顺序与回滚边界，不提交或推送变更。

## Phase A：建立共享 identity contract

1. 新增 `core/identity.js`，实现 Chat-local registry normalize/clone、opaque Runtime
   ID generator、candidate projection、membership check、exact display/alias candidate
   集合和 raw participant resolution。
2. 在同一模块集中实现三阶段 alias policy：
   `mention resolution`、`alias discovery`、`alias persistence` 必须使用不同的输入和
   输出。稳定 `name_variant`/`nickname` 只有明确 alias-establishment evidence 才能
   成为 candidate；contextual title/relationship/generic/pronoun 和普通 mention
   continuity 只用于当前 resolution，不能写入 aliases。alias collision 返回完整
   candidate 集合，不得 first-match-wins；同时实现 display-name update 和不执行
   destructive merge。
3. 为 legacy Event participant/profile 建立只读 registry bootstrap，保持旧 ID 原样，
   不将历史 Event 重写为新 ID。

验证：先写/运行 `tests/character-identity.test.js` 的纯逻辑测试，覆盖 opaque ID 不含
姓名、同名/同音/同 alias 多 ID、existing membership、unknown existing downgrade、
new/unresolved、以及三阶段 alias policy：普通“display name + 称呼”只解析不学习，
明确“叫我/小名/众人称为”才产生 candidate，candidate 仍需 Runtime 接受后才写入，
collision 返回全部 candidates 且无上下文时 unresolved、rename 和 no-merge。
同名 new 的保守 re-check 也必须覆盖：仅有字符串命中时 unresolved，明确
`explicit_new_entity` 证据才能注册另一个实体。

## Phase B：接通 Storage 与 Analyzer Input

1. `storage/schema.js` 增加可选 `character_registry` 的 empty/default/read normalize；
   `storage/store.js` 在 Chat get/save 边界复用该 normalizer。保持 schema version 1，
   缺字段旧 Chat 读取为空且不做全量 migration。
2. `runtime/event-analysis.js` 在构造 input 前读取当前 Chat registry；必要时从有效旧
   Event/profile 形成兼容 candidate，传给 `buildEventAnalysisInput()`。
3. `ai/input-builder.js` 规范化独立的 `character_registry`，不把它塞进
   `character_context`；`character_context` 原有 profiles/background 语义保持不变。
4. `ai/prompts.js` 新增 canonical identity block、三态 raw contract、alias candidate
   规则和 location 原文规则；删除“首次出现即可有稳定 ID”的矛盾表述，并保留现有
   system/message ordering。

验证：修改 `tests/context-prompt.test.js`、`tests/event-analysis.test.js` 和 storage/
runtime input tests，断言候选 ID 原样出现、profiles 仍是语义上下文、敏感字段不发送、
Chinese location 规则出现在真实 prompt；同时断言 Prompt 要求 mention resolution、
alias discovery、alias persistence 分离，并明确禁止单次 mention 自动学习 alias。

## Phase C：Raw DTO 与 resolution seam

1. `ai/analyzer.js` 接受并规范化 raw participant identity fields：
   `identity_status`、`character_id|null`、`mention_id`、`alias_candidate` 和
   `identity_evidence`；保留旧 response 的结构兼容，但生产 parse 结果把 identity
   视为未授权 advisory data。
2. Parser 在 raw participant handle 级别做安全的字段/引用检查；不要因为
   `new`/`unresolved` 的 null `character_id` 提前触发最终 Event participant closure。
   把 subject cardinality、canonical participant closure 和 duplicate subject Event
   检查留给 canonicalization 后的 Domain validation。
3. 去掉 AI raw participant 的静默 last-record-wins；同一 raw handle 的冲突交给
   identity layer 报错，已 canonicalize 的唯一 participant 才进入最终 Event。
4. 在 `runtime/event-analysis.js` 现有 event-id/source enrichment 前插入 identity
   resolution；它返回 clean canonical Events 和候选 registry。未经 resolution 的
   `character_id` 不可到达 `validateEventCollection()` 或 persistence。
5. identity resolution 成功后再注入现有 authoritative `event_id/source`，然后执行
   `validateEventCollection()` / `normalizeEvent()`；失败时返回安全 identity stage，
   保留上一份 Floor/Tracking 成功结果。

验证：在 `tests/event-analysis.test.js` 增加 raw new/unresolved/null handle、invalid
existing ID、raw duplicate conflict、location 原文和 parser compatibility；在
`tests/event-analysis-runtime.test.js` 验证 Runtime 顺序，而不是只测 DTO 形状。

Alias 集成验证必须至少覆盖：

- `“沈祁鸢坐在窗边。鸢儿随后起身。”`：mention 可以解析到 `char_001`，但无
  `alias_candidate`，registry 不增加 `鸢儿`；
- `“沈祁鸢说，以后叫我鸢儿。”`、`“她名叫沈祁鸢，小名鸢儿。”`、`“众人都称沈祁鸢为鸢儿。”`：
  LLM 才能返回 candidate，Runtime 接受后才写入 alias；
- `char_001` 与 `char_002` 都有 `晚晚`：exact match 返回两个 candidate，缺上下文为
  unresolved；任何注册顺序都不能改变结果；
- contextual title `姐姐`、generic reference `那个女孩` 和 pronoun `她`：可在当前
  context resolution 使用，但绝不进入 aliases；
- alias candidate 即使带高 confidence，但没有 establishment evidence：不得持久化；
- 当前 alias 解析与 alias persistence 分开测试，防止后续实现通过单次推断自动学习。

## Phase D：Event / Tracking / CRUD compatibility

1. `core/events.js` 保持 persisted Event shape 和旧读取 normalize；补充 raw duplicate
   conflict/validated canonical path 的边界，确保 pregnancy validator 看到的 participant
   已经是 canonical unique IDs。不能用放宽最终 schema 的方式解决 new/unresolved。
2. 让 `updateEvent()` 对仍存在的 participant/reference IDs 使用当前 registry membership
   guard；保留 event_id/source，不允许编辑 patch 注入 registry 外 ID。
3. `core/tracking.js` 继续只消费 canonical persisted Event；Tracking profile merge
   不改为按名字/alias 建 key，旧 active Event 的 ID 通过 bootstrap 保持可读。
4. `getTrackingRegistry()` / internal business data 如需返回 identity registry，只增加
   additive internal field；`ui/*` 不新增人物识别或 eligibility 逻辑，普通 UI 不展示
   identity raw/debug/provenance。

验证：`tests/events.test.js`、`tests/tracking.test.js`、`tests/runtime.test.js` 回归旧
Event/Tracking/Chat scope/Swipe 行为；新增 pregnancy ordering test 证明 null raw identity
先 register/resolution，再执行 subject/counterpart closure。

## Phase E：文档、质量门与回归

1. 更新 `.trellis/spec/domain/event-pipeline.md`，记录 Character Registry、identity
   statuses、alias semantics、raw-to-canonical 顺序、error matrix 和 required tests。
2. 同步 `docs/DEVELOPMENT.md` / README 中当前 Chat 数据骨架和 Event pipeline 的简述，
   明确 Tracking Registry 不是 canonical Character Registry。
3. 运行 targeted tests，再运行 `npm test` 和 `npm run check`。
4. 任何源码修改后立即用 repository-local Prettier 对本轮所有修改源码执行格式化；
   先格式化成功，再继续后续测试/审查。
5. 检查 `git diff`、`git status`、未修改的旧任务目录和 task artifacts；不提交、不
   push，除非用户另行授权。

## 回滚点

- Phase A/B 后若 registry shape 不兼容，只撤销新增 registry/input/prompt 代码，旧
  Event/Floor schema 不动。
- Phase C 若 raw parser 与旧响应冲突，保留 parser 的兼容输入但禁止其绕过 Runtime
  identity seam；优先恢复旧分析结果，不写 partial Event/registry。
- 任一 Domain/Tracking regression 只回滚本任务新增的 identity path，保留既有
  event_id/source、pregnancy subject grouping 和 World Model changes。

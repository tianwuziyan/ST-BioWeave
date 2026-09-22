# 实施计划

## 阶段 1：Schema 与纯策略

1. 在 storage/schema.js 为 worldbooks 增加 selection_initialized 的规范化语义，默认读取为 false，保持 mode: selected_only。
2. 在 ai/worldbook.js 扩展 normalized entry 的统一 metadata contract：metadata.comment、metadata.keys[]、metadata.secondary_keys[]。
3. 在 ai/worldbook.js 增加默认排除常量、Unicode 规范化、中文包含匹配和英文 token 边界匹配；只读取 metadata，不读取 content/identity/source id。
4. 在 ai/worldbook.js 增加纯 default selection helper：只选择 character_card 与 is_current === true greeting；character additional Lorebooks 仍可手动选择但首次不自动选择；current greeting 无法确认时不 fallback。

验证：先补纯函数测试，再执行 node --test tests/worldbook.test.js。

## 阶段 2：Chat-local 初始化事务

1. 在 ui/app.js 的 loadAnalysisSourcesState() 完成 sources 加载后接入一次性初始化。
2. 确保 `character_card` source discovery 已完成：若 primary 存在则 entries 已完整 hydrate，若不存在则确认不存在；`character` additional Lorebooks 不阻塞初始化，也不因首次初始化全量 eager。
3. 读取当前 Chat 的 selection_initialized；true 时完全跳过 policy，只保留 saved selection。
4. false/missing 时构造 default selection，执行 owner/token/request sequence 检查。
5. 通过单次 saveChat 同时写入 selected 与 selection_initialized: true；save confirmed 后再更新 UI/runtime 内存状态。
6. 失败、stale、Chat 切换或 owner change 时保留旧状态，禁止半初始化 payload。

验证：增加可控异步 source loader/saveChat fixture，覆盖 A→B 切换、save fail、source fail 和重复 load。

## 阶段 3：DTO 与 Prompt 回归

1. 检查 ai/input-builder.js 的 entry projection，不让 metadata 自动进入 AnalysisInput。
2. 检查 Full/Patch 共用输入路径，确认 selected-only 语义不变。
3. 补 Prompt snapshot 测试：默认排除项不发送，用户重新勾选后发送；metadata 不出现在请求正文。

验证：执行 node --test tests/context-prompt.test.js tests/world-model.test.js tests/worldbook.test.js。

## 阶段 4：生命周期与文档同步

1. 更新 docs/DATA-MODEL.md 的 Chat-local worldbooks schema、selection ownership 和一次性 snapshot 语义。
2. 更新 docs/bioweave-data-lifecycle.md 的字段 ownership、reload/Chat switch/clear/save failure/stale 行为。
3. 检查是否存在把 selected.length === 0 当成未初始化、把 mode: all 当默认选择或在 analyzer/prompt 中重建默认选择的旧分支；删除或替换矛盾测试/逻辑。

## 阶段 5：完整验证

1. npm run check
2. node --check 所有修改的 JavaScript 文件
3. npm test
4. git diff --check
5. 检查最终 diff 只包含本 task 批准范围，确认没有修改 Character Card、World Info 原始数据、Floor、World Model schema、BiologicalEvent、StateReducer、Snapshot、Projection 或 Full/Patch 业务定义。
6. 记录真实 SillyTavern Desktop/Tablet/Mobile host acceptance 为后续验收项；自动化测试不能替代宿主验证。

## 测试矩阵

### Default source

- current greeting selected；alternate non-current 不选。
- current greeting 无法确定时不 fallback main；Lorebook 仍初始化。
- character_card 默认选择符合条件 entry。
- character additional Lorebook、global、Persona、Chat、other 不默认选择，但 character 仍可手动选择。

### Metadata exclusion

- comment 命中；keys 命中；secondary keys 命中。
- 中文直接包含。
- NSFW 大小写不敏感。
- cot 大小写不敏感且有英文 token boundary。
- cotton 等普通单词不误命中。
- content 单独命中时仍默认选择。
- uid/id/source id/entry JSON 不参与匹配。

### One-shot and user override

- initialized 后 reopen、refresh、plugin reinit、World absent、analysis fail、retry、Manual Full、Manual Patch、Auto Full、Auto Patch、Reuse、selected=[] 均不重置。
- 用户取消默认项后保持取消。
- 用户重新勾选默认排除项后保持选择。
- 新增 source/entry 不自动追加。

### Async and persistence

- Chat A/B 独立。
- A 的 stale source load 不写 B。
- source load fail 不 initialized。
- saveChat fail 不 initialized。
- stale/owner change 不 initialized。
- 不产生 selected 已写入而 initialized 未写入的半事务状态。

### Stable identity and prompt

- reorder + same uid 保持 selection。
- comment rename + same uid 保持 selection。
- content change + same uid 保持 selection。
- duplicate labels 不串项。
- Full/Patch 只收到 selected entries。
- 默认排除不进入；手动重新勾选后进入。

## 计划修改文件

- storage/schema.js
- ai/worldbook.js
- ui/app.js
- tests/worldbook.test.js
- tests/context-prompt.test.js 或 tests/world-model.test.js
- docs/DATA-MODEL.md
- docs/bioweave-data-lifecycle.md

## 风险与回滚点

- metadata contract 扩展阶段：确认 metadata 不进入 Prompt；失败时只回滚 normalized DTO 和 policy helper。
- source loading 阶段：确认 `character_card` primary（若存在）的 entries 已加载；additional/global/other 保持 deferred，不作为 completeness gate。
- Chat save 阶段：确认 payload 单次保存且 owner guard 前后完整；失败时保留旧 Chat 设置。
- UI 接入阶段：确认用户操作 handler 与首次 policy 分离；不得复用 handler 产生隐式初始化。
- 文档/测试阶段：确认旧 selected-empty 假设已替换，不保留矛盾默认语义。

本计划不包含提交或推送；实现已按用户批准进入执行阶段，提交与发布仍不在本 task 范围内。

## 执行结果

- 已完成 `selection_initialized` Chat-local schema、character_card-only 默认快照、current greeting 判定、normalized metadata 和默认排除策略。
- 已完成 source completeness、Chat owner/token stale guard、单次 Chat 保存和保存失败回滚语义。
- 已完成 `character_card` Worldbook eager hydration；additional/global/other 继续 deferred，首次初始化不再要求所有 Character-owned source eager。
- 已补充 Worldbook、UI 异步生命周期、Prompt selected-only 和 metadata 边界测试。
- `npm run check`：829/829 通过。
- `npm test`：829/829 通过。
- 修改文件的 `node --check`：通过。
- `git diff --check`：通过。
- `task.py validate`：通过；仅报告既有的大文件 context injection warning。

# 实施计划：怀孕确认与人物知情边界

本文件只定义开发顺序。用户确认规划后才执行 `task.py start` 并修改生产代码。

## 阶段 0：开发门禁与基线

1. 使用 `trellis-before-dev` 重读适用 AGENTS、workflow、Floor State、Event Pipeline、Pregnancy Tracking、架构与生命周期合同。
2. 检查 `git status --short --branch`，保护用户现有未提交内容和当前 storyline 行为。
3. 运行 Event parser/runtime、State/Pregnancy lifecycle、Projection Context、Coordinator 和 lifecycle contract 的现有聚焦测试，记录基线。
4. 再次确认当前 `pregnancy_confirmation`、Character Registry、Current State confirmed episode 与 context slot 的真实调用路径；若实现与本设计前提不同，先更新规划，不在错误前提上编码。

验证：基线测试结果明确，且没有把已有失败误归因于新功能。

## 阶段 1：知识 domain 与完整快照合同

1. 测试先行新增 `core/pregnancy-knowledge.js`：严格 schema、canonical ID、`subject_id + pregnancy_id` 唯一、knower 去重/排序、完整集合 replacement 和 read projection。
2. 定义每个 knower 的原始来源 Floor Version 与 evidence fingerprint；复制 snapshot 时保持来源不变。
3. 覆盖显式空 root、缺失 root、旧 schema、非法/重复 entry、同一人物不同 pregnancy episode 和多人物隔离。
4. 定义 derived read 对失效 subject/episode/knower/provenance 的 fail-closed 过滤。

验证：20/26/30/回退23、空 tombstone、多人多 pregnancy、不读未来 Floor 的纯 domain 测试通过。

## 阶段 2：Schema、Lifecycle 与正式 Floor persistence

1. 在 `storage/schema.js` 注册 `pregnancy_knowledge_snapshot` 可选 root。
2. 在 `storage/lifecycle.js` 登记 Character domain、Character/All clear、World preserve。
3. 在 Coordinator 只添加 `pregnancy_knowledge` 专用 owner allowlist，不修改冻结的事务、merge、save、readback 和 stale mechanics。
4. 新增 `storage/pregnancy-knowledge.js`，实现 endpoint 最近完整 root 读取、当前 Floor complete replacement、commit-point rebase、authoritative readback 比较。
5. 补 lifecycle registry/schema parity、clear matrix、active Swipe、User Floor reject、stale version、persistence failed/unknown 测试。

验证：当前 Floor 只写完整集合并保留全部 sibling；历史 Floor 不变；显式空不复活；Character/All clear 与 World preserve 正确。

## 阶段 3：Event Analysis sidecar 与逐项解析

1. 扩展 Event prompt 固定 envelope，增加 `pregnancy_knowledge_candidates` 规则；使用多行模板而不是逐行 quoted string。
2. 扩展 parser allowlist和 item-level normalizer：模型只输出两个人物的可读名称/aliases 与短 observation，拒绝任何内部 ID。
3. 让 malformed candidate 形成逐项 diagnostic，不污染合法 Event 和其它合法 candidate；保持 Event collection 原有原子校验。
4. 补纯 JSON、缺失/空 sidecar、混合合法非法候选、未知字段、内部 ID、超长文本和 malformed top-level 测试。

验证：合法 Event 在坏 knowledge candidate 存在时仍可正常进入后续 canonical pipeline；候选自身不被误当 Event。

## 阶段 4：Runtime 唯一身份与 Episode 绑定

1. 新增 `runtime/pregnancy-knowledge-runtime.js`，接收 authoritative Event readback、当前 Registry、Current State/有效 Pregnancy Episode 和原始 candidate diagnostics。
2. 为 subject 与 knower 分别执行 zero/one/many canonical match；只接受 one。
3. 验证 observation 属于当前 narrative discovery window，并区分明确知情、怀疑/传闻/在场/准备告知。
4. 将 subject 绑定到恰好一个未结束 confirmed Episode；支持本轮新 confirmation 和后续传播正文。
5. 以 `{subject_id,pregnancy_id,knower_id}` 去重，把同一 Floor 所有合格 additions 一次性合并/写入/readback。
6. 知识写入失败返回结构化 partial 状态，不回滚合法 Event；candidate 之间独立合格。

验证：目标本人不默认知情、检查者不默认知情、匿名/歧义失败关闭、多人/多 pregnancy 不串线、一个坏候选不拖累好候选。

## 阶段 5：Character/Event Analysis 窄接线

1. 在 `runtime/character-event-analysis.js` 保留 sidecar，完成 Event canonical persistence/readback 后调用 knowledge capability。
2. 将知识阶段放在 Event 成功边界之后；Event 失败时不写 knowledge，新 knowledge 失败时不撤销 Event。
3. 沿用同一个 analysis execution、AbortSignal、retry 次数和 owner/epoch/Floor Version guard，不新增独立 API 请求或 scheduler。
4. 在 Runtime composition 中注入窄 capability；不把规则加入 `runtime/events.js` 或 `runtime/event-analysis.js`。

验证：一次 Character/Event API 请求可同时产生 Event 与 knowledge sidecar；调用次数、重试和人物分析既有行为不变。

## 阶段 6：统一资料格式与 Event prompt 参考

1. 在 `ai/prompt-context.js` 增加 `pregnancy_knowledge` 正文 kind，只负责中文标签、嵌套列表、排序、空值省略和 ID 过滤。
2. 由 `ai/prompts.js` 添加场景标题、用途说明与 SYSTEM 位置；不得在 formatter 内封装标题或 role。
3. 按“怀孕人物 → 已知情人物 → 其他默认不知道”逐 pregnancy 分组；显示当前 Registry 名称/必要 aliases，不显示裸 ID。
4. 空参考块省略；Prompt Preview 与真实请求继续共用 `buildEventAnalysisMessages()`。

验证：最终 messages role 顺序保持现状；USER 不出现原始 JSON；多 pregnancy 层级清晰且名单不扁平。

## 阶段 7：正文生成 Context 注入

1. 为现有 Projection Context coordinator 注入只读 pregnancy knowledge resolver。
2. 在唯一 `bioweave_projection_context` slot 合成“已确认怀孕与知情范围”，不创建第二 slot。
3. 即使没有 active Projection/Storyline，只要存在合法 knowledge，仍写入认知边界；没有安全显示名或状态失效时省略。
4. 保持 disable、Chat/Floor/Swipe stale、generation ready 与 slot clear 的现有边界。

验证：名单外人物默认未知；新增知情人后的下一次生成读取最新集合；多人物分别成组；回退旧 Floor 恢复旧名单。

## 阶段 8：Debug、诊断与只读验收面

1. 扩展 `collectActiveBusinessData({includeDebug:true})` 的安全只读 DTO，显示 pregnancy 分组、知情姓名/count、root owner 与有效/拒绝统计。
2. 增加 bounded trace：sidecar parse、candidate qualification、identity/Episode binding、snapshot no-op/write/readback/stale/failure、context include/omit。
3. Settings Debug/TXT 导出复用现有框架；确保不导出 observation 原文、完整 narrative、prompt、raw response 或 Secret。
4. 不新增普通产品页、按钮或手动编辑入口。

验证：可以从 Debug 区分 Event、knowledge candidate、knowledge persistence 和 context injection 四个阶段，且敏感内容不泄漏。

## 阶段 9：文档、回归与真实宿主验收

1. 同步 `docs/ARCHITECTURE.md`、`docs/bioweave-data-lifecycle.md`、`.trellis/spec/domain/floor-state.md`、`.trellis/spec/domain/event-pipeline.md`；按实际影响检查 `docs/DATA-MODEL.md` 与 `docs/CONTEXT-AND-PROMPT.md`。
2. 运行聚焦测试、完整 `npm run check` 和 task validate。
3. 在真实 SillyTavern 验收：
   - 检查结果出现但目标昏迷，确认怀孕成立而目标不在知情名单；
   - 医生明确知情、之后只告诉一人，名单逐次新增且其他人仍未知；
   - 两名人物同时怀孕，名单完全隔离；
   - 编辑/删除正文、Swipe 切换和 Floor 回退后读取正确历史名单；
   - F5/reload 后 root 与 context 仍由 authoritative Floor 恢复。
4. 自动化测试不得代替 real-host persistence/context 验收；未完成的宿主步骤在交付中明确标记。

## 预计修改范围

- 新增：`core/pregnancy-knowledge.js`、`storage/pregnancy-knowledge.js`、`runtime/pregnancy-knowledge-runtime.js` 及对应测试。
- AI：`ai/analyzer.js`、`ai/prompts.js`、`ai/prompt-context.js` 与 parser/prompt 测试。
- Runtime：`runtime/character-event-analysis.js`、`runtime/projection-context.js`、`runtime/runtime.js`、诊断/业务 DTO 的窄接线。
- Persistence：`storage/schema.js`、`storage/lifecycle.js`、Coordinator owner allowlist 与 lifecycle tests。
- 文档：Architecture、Data Lifecycle、Floor State、Event Pipeline；其它文档按实际影响更新。

实际文件以开发开始时的调用链审计为准；不改 `pregnancy_confirmation` payload，不把功能塞进通用 runtime 巨型文件，不修改无关 UI。

## 验证命令

```bash
node --test tests/pregnancy-knowledge.test.js tests/pregnancy-knowledge-storage.test.js tests/pregnancy-knowledge-runtime.test.js
node --test tests/event-analysis-runtime.test.js tests/world-model.test.js tests/prompts.test.js tests/prompt-context.test.js
node --test tests/projection-context.test.js tests/floor-persistence-coordinator.test.js tests/lifecycle-contract.test.js
npm run check
python3 ./.trellis/scripts/task.py validate .trellis/tasks/10-26-pregnancy-confirmation-knowledge
```

测试文件名以仓库实际测试组织为准；优先扩展现有套件，只有独立 feature owner 确实需要时才新增文件。

## 完成条件

- PRD 的每项验收标准都有自动化或明确 real-host evidence。
- Event 与 knowledge 独立成功边界、item-level qualification、完整 Floor 快照、多 pregnancy 隔离、stale/readback 和 context 注入均有回归测试。
- 新持久化字段在 schema、lifecycle registry、clear、docs 和 tests 中回答完整生命周期问题。
- 相关 Markdown 与最终实现一致；普通 UI、自动遗忘和孕后新支线明确保持未实现。
- 不 commit/push，除非用户之后另行明确授权。

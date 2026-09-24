# Character Evidence Input Boundary 执行计划

> 本文件定义并记录本次已批准的 Execute 实施顺序与验证结果。

## 顺序

1. ✅ 在 `ai/input-builder.js` 增加最小、白名单式 Character Evidence projection：合并 current Character Card、Persona、existing profile；对 Worldbook/External Memory 仅接受明确 subject-bound item；保留 source/provenance 与 null canonical ID。
2. ✅ 在 `ai/prompts.js` 让 Event reference 消费该 projection，补齐 Bootstrap 无 canonical ID 的稳定 evidence 展示；保持 raw source 永不进入 Event messages，且不改变 World Model prompt。
3. ✅ 在 `tests/context-prompt.test.js` 增加 A-G 回归，使用最终 `buildEventAnalysisMessages()` 的 message 内容断言。
4. ✅ 检查 existing profile、capabilities/evidence、prompt role 顺序、SYSTEM boundary 与 secret redaction。
5. ✅ Runtime wide DTO 已确认足够，未修改 `runtime/event-analysis.js`。
6. ✅ 同步更新 `.trellis/spec/domain/event-pipeline.md`、`docs/CONTEXT-AND-PROMPT.md`、`docs/ARCHITECTURE.md`、`docs/DEVELOPMENT.md`，建立长期 Character Evidence contract 与 regression guard。

## A-G 验证矩阵

- A Bootstrap：Character Card 明确女性身份；World Model 已有 Human/女性且 `can_carry_pregnancy=true`；无 profile；最终 messages 有 current-character evidence，且没有伪造 canonical ID。
- B Persona：Persona 明确稳定身份；无 profile；最终 messages 有 `source.kind=persona` 的 projection；Persona 中旧事件不进入 Target Floor narrative/Event facts。
- C Existing profile：已有 canonical profile 继续出现在 individual evidence，capabilities/evidence 不回归。
- D Nonhuman：Character evidence 为 Nonhuman，World Model 有对应 type；projection 只携带证据，不能生成 Human baseline 或由“女性”直接赋 capability。
- E Unknown：无稳定 biological evidence；projection 不填猜测，最终 mapping/capability 保持 null/unknown/pending。
- F Source isolation：无 subject binding 的 Worldbook/External Memory 含其他人物事实；最终 Character Evidence 不包含该事实，也不跨人物注入。
- G Prompt boundary：最终 Event messages 含 projection 后的 evidence，但不含 raw Character Card/Persona/Worldbook/External Memory、API/settings/secrets；World Model messages 仍保留其既有 raw source 输入。

## 验证命令

已执行并通过：

```bash
node --check ai/input-builder.js
node --check ai/prompts.js
node --test tests/context-prompt.test.js
node --test tests/context-prompt.test.js tests/event-analysis-runtime.test.js
npm run check
git diff --check
```

实现完成后还需进行真实 SillyTavern Host 的 Character Card/Persona/Worldbook/External Memory 输入预览验收；Node 测试不能替代 Desktop/Tablet/Mobile 或真实 Host 验收。

## 回滚点与门禁

- 本次已按批准规划运行 `task.py start`；不执行 commit/push。
- 每一步保持 `git diff` 只包含 `ai/input-builder.js`、必要的 `ai/prompts.js`、测试与本任务文档；发现 raw source 泄漏或 source isolation 失败立即停止并回到 planning。
- 不提交、不推送；真实 SillyTavern Host 验收仍是交付后的手工步骤。

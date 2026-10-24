# 实施计划：统一 Prompt Context Presentation Port

本计划定义并记录本次执行顺序。用户已批准规划，生产代码已按以下阶段实施并完成验证。

## 阶段 0：基线与门禁

1. 使用 `trellis-before-dev` 重读 AGENTS、Architecture、Context/Prompt contract、Floor ownership 和任务规划。
2. 记录并保护现有未提交的 10-21 session summary，不纳入本任务修改。
3. 运行现有 Prompt/Storyline 聚焦测试，保存 World/Event/Storyline 最终 messages 黄金输出。
4. 搜索所有 formatter、readable label、marker parser 和直接 import，建立迁移清单。

验证：基线测试通过，现有输出和调用方清单可审计。

## 阶段 1：测试先行定义 presentation interface

1. 新增 `tests/prompt-context.test.js`，先覆盖 kind/variant、正文中文字段标签、嵌套列表、空值和内部 ID 过滤，并验证正文入口不返回标题和用途说明。
2. 增加 layout、SYSTEM 首尾、group 合并和非法 kind/variant/role 的失败测试。
3. 增加消费者允许矩阵：Storyline 不读 Worldbook，Event 不读 raw source，World 不误读 Event reference。

验证：新测试在 implementation 前按预期失败，且不依赖私有函数。

## 阶段 2：实现纯 Prompt Context module

1. 新增 `ai/prompt-context.js`，实现 `formatPromptContextContent()` 正文端口与 `composePromptMessages()`。
2. 从既有 formatter 迁移 source-specific implementation；保持 input-builder 单向依赖，不引入 Runtime/Storage/Host/API 依赖。
3. 固定 kind/variant 白名单与 Event semantic guard，不实现 Registry/Factory/自定义 callback。

验证：`tests/prompt-context.test.js` 通过，模块为同步纯函数。

## 阶段 3：迁移 World/Event

1. 保持 `buildWorldModelMessages()`、`buildWorldModelPatchMessagesV2()`、`buildEventAnalysisMessages()` 的公开签名。
2. 将 references、narrative 和 messages grouping 委托给 Prompt Context module；protected rules、retry 和 JSON contract 留在 `ai/prompts.js`。
3. 验证 Preview 仍直接使用真实 message builder，未建立第二份展示路径。

验证：迁移前后最终 `messages[]` 在批准范围内等价；World/Event 聚焦测试通过。

## 阶段 4：迁移 Storyline

1. Runtime 改传结构化人物/世界/参考/记忆资料，移除提前字符串化。
2. Storyline design/judge builder 直接构建 `messages[]`，复用 Prompt Context kind/variant；删除 marker 字符串和拆包重包解析。
3. 保留 triggered signals、branch rendering、业务规则和 parser；继续排除 Worldbook。
4. 迁移 Analyzer 调用并验证设置中“推演”任务 API 路由与取消信号不变。

验证：Storyline 的 SYSTEM 规则、可选 SYSTEM 参考、ASSISTANT 正文、USER 任务顺序，以及所有用户确认格式、停止请求和 parser contract 测试通过；空参考不保留空 SYSTEM。

## 阶段 5：旧 implementation 清理

1. 搜索旧 formatter 和调用方。
2. 删除已被 port 替代且无调用方的 Storyline marker parser、nested formatter、other-reference formatter 和 Runtime readable formatter。
3. 确认无生产调用方后，删除不再需要的兼容 re-export/import；本次已删除完整区块 wrapper，未保留双轨。

验证：不存在双轨 presentation implementation；`git diff` 中每个删除均有迁移后的调用方或测试证据。

## 阶段 6：文档与完整检查

1. 同步 `docs/ARCHITECTURE.md`、`docs/CONTEXT-AND-PROMPT.md` 和 `.trellis/spec/domain/floor-state.md`。
2. 运行聚焦测试、`npm run check`、`git diff --check` 和任务验证。
3. 检查所有相关 Markdown 与最终实现一致；确认无需更新 lifecycle 文档。
4. 在真实 SillyTavern Prompt Debug/Recent Request Log 中分别查看 World、Event、Storyline 最终 messages，确认自动化没有掩盖宿主差异。

执行结果：阶段 0—6 已完成；自动化检查通过。真实 SillyTavern Prompt Debug/Recent Request Log 验收仍需在宿主环境刷新插件后进行。

## 预计修改范围

- 新增：`ai/prompt-context.js`、`tests/prompt-context.test.js`。
- 迁移：`ai/prompts.js`、`ai/projection-storyline.js`、`runtime/projection-storyline-runtime.js`、`ai/analyzer.js` 及对应测试。
- 文档：`docs/ARCHITECTURE.md`、`docs/CONTEXT-AND-PROMPT.md`、`.trellis/spec/domain/floor-state.md`。
- 如审计证明其它 Prompt consumer 直接调用旧 formatter，只做必要 import/委托迁移，不扩大业务范围。

## 验证命令

```bash
node --test tests/prompt-context.test.js tests/context-prompt.test.js tests/event-analysis.test.js tests/projection-storyline.test.js
node --test tests/event-analysis-runtime.test.js tests/api-profile.test.js
npm run check
git diff --check
python3 ./.trellis/scripts/task.py validate .trellis/tasks/10-23-unified-prompt-context-port
```

## 停止条件

- 发现必须改变 AnalysisInput shape、Floor persistence ownership 或 lifecycle 字段时停止，另行说明根因，不在本重构中顺带修改。
- 迁移要求改变既有业务规则、输出 JSON 协议、API task assignment 或 Storyline Worldbook 排除策略时停止并请求用户决策。
- 如后续发现仓库外调用方依赖已删除的内部 wrapper，需单独评估迁移，不恢复“标题+用途+正文”双轨端口。

<!-- TRELLIS:START -->

# Trellis Instructions

These instructions are for AI assistants working in this project.

This project is managed by Trellis. The working knowledge you need lives under `.trellis/`:

- `.trellis/workflow.md` — development phases, when to create tasks, skill routing
- `.trellis/spec/` — package- and layer-scoped coding guidelines (read before writing code in a given layer)
- `.trellis/workspace/` — per-developer journals and session traces
- `.trellis/tasks/` — active and archived tasks (PRDs, research, jsonl context)

If a Trellis command is available on your platform (e.g. `/trellis:finish-work`, `/trellis:continue`), prefer it over manual steps. Not every platform exposes every command.

If you're using Codex or another agent-capable tool, additional project-scoped helpers may live in:

- `.agents/skills/` — reusable Trellis skills
- `.codex/agents/` — optional custom subagents

Managed by Trellis. Edits outside this block are preserved; edits inside may be overwritten by a future `trellis update`.

<!-- TRELLIS:END -->

# AGENTS.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:

- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:

- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:

- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:

- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:

```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

---
# GitHub 更新规范

本规范仅适用于 Codex 执行 GitHub 相关操作时生成的内容，包括：

- Git Commit 提交信息
- GitHub Push 相关更新说明
- Pull Request 标题和描述
- GitHub 上的代码更新总结

不影响 Codex 日常对话、代码编写、代码注释及其他非 GitHub 内容。

## 语言要求

所有提交到 GitHub 的文字说明默认使用**简体中文**。

以下内容可以保留英文：

- 代码
- 文件名
- 函数名
- 变量名
- 类名
- API 名称
- 库和框架名称
- Git 命令
- 无法合理翻译的技术术语

禁止使用过于简单或笼统的英文更新说明，例如：

```text
Update files
Fix bug
Minor changes
Improve code
Refactor
Update
```

## Commit Message 规范

生成 Git Commit Message 前，必须先查看本次实际代码变更，例如：

```bash
git diff
git diff --cached
git status
```

根据真实修改内容生成**具体、准确、详细的中文提交说明**。

不要只写：

```text
更新代码
修复问题
优化代码
调整功能
```

应该明确说明具体修改内容，例如：

```text
修复登录状态过期后无法重新获取用户信息的问题
```

或者：

```text
优化商品列表分页查询逻辑并减少重复 API 请求
```

如果一次提交包含多个修改，优先使用：

```text
优化用户登录与权限验证逻辑

- 修复 Token 过期后用户状态未及时清除的问题
- 增加接口返回 401 时的统一处理
- 优化登录状态恢复逻辑
- 补充权限验证失败时的异常处理
```

提交说明应尽可能包含：

1. 修改了什么
2. 修复了什么问题
3. 新增了什么功能
4. 优化了什么逻辑
5. 是否涉及重要配置或行为变化

## Pull Request 规范

创建或更新 Pull Request 时：

- PR 标题使用简体中文
- PR 描述使用简体中文
- 根据实际代码差异生成内容
- 不要只提供一句简单总结
- 不要编造不存在的修改或测试结果

推荐使用以下格式：

```markdown
## 更新内容

- 修复……
- 新增……
- 优化……
- 调整……

## 涉及文件

- `src/xxx.ts`
  - 修改……
  - 新增……

- `src/xxx.vue`
  - 优化……
  - 修复……

## 修改原因

说明此次修改解决的问题，以及为什么需要进行这些修改。

## 测试情况

- 已执行……
- 已验证……
- 测试结果……

如果没有执行测试，请明确写：

本次未执行自动化测试。

## 注意事项

说明是否涉及：

- 配置文件变化
- 环境变量变化
- 数据库变化
- API 变化
- 兼容性变化
- 部署方式变化

如果没有特殊注意事项，可以省略本部分。
```

## GitHub 更新总结规范

每次向 GitHub 提交较大的代码更新时，应根据本次实际变更生成详细中文总结。

更新总结应优先说明：

1. **做了什么**
2. **为什么修改**
3. **主要涉及哪些文件或模块**
4. **修复或新增了哪些功能**
5. **是否存在需要注意的变化**

不要为了让内容显得详细而重复废话。

不要根据任务描述猜测修改内容。

**必须以实际 Git Diff 为准。**

## 核心原则

所有 GitHub 更新内容必须做到：

**使用中文、描述具体、信息完整、基于实际代码变更。**

优先保证准确性，其次才是详细程度。

如果实际修改很简单，可以保持简洁。

如果修改涉及多个文件、多个模块或多个功能，则必须提供更详细的更新说明。
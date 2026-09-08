# README 执行计划

## 前置条件

- [x] 已获得用户创建 Trellis 任务并进入规划阶段的同意。
- [x] 已完成入口、运行时、存储、领域核心、AI、Worldbook、UI、测试、配置和已有文档的仓库扫描。
- [x] 已确认工作区存在与本任务无关的未提交 World Model 变更，执行期间不得覆盖。
- [x] 用户审阅并批准本规划摘要后，执行 `task.py start`，将任务从 planning 切换为 in_progress。

## 执行步骤

1. **激活任务并加载开发上下文**
   - 验证 `prd.md`、`design.md`、`implement.md` 和 JSONL manifest。
   - 执行 `trellis-before-dev`，确认共享指南和 frontend 目录/质量边界。
   - 验证：`task.py validate generate-project-readme`、`task.py start generate-project-readme`。已通过。

2. **重写根目录 README**
   - 只编辑 `README.md`，按设计结构写入中文生产级文档。
   - 加入安装三路径、快速开始、架构 Mermaid、AI 工作流 Mermaid、技术栈/目录/配置/安全/性能/路线图/FAQ。
   - 把页面占位、未提供 Docker/CI/License 和未完整接线的领域能力写清楚。
   - 验证：检查每个命令、文件链接、配置键、功能状态都有仓库证据。已完成。

3. **子 Agent 实现审查**
   - 使用 `trellis-implement` 在共享工作区完成 README 编辑和初步检查。
   - 使用 `trellis-check` 从规格、事实准确性、Markdown/Mermaid、测试和变更范围审查。
   - 验证：实现 Agent 未在等待窗口内产出，已终止；检查 Agent 完成审查并修正 README 一处安装表述。

4. **本地质量检查**
   - 运行 `npm run check`，确认现有 JavaScript 语法和测试没有被 README 任务影响。
   - 运行 `git diff --check`。
   - 用仓库工具检查 README 标题层级、代码围栏、Mermaid 围栏和相对链接；人工复核“已实现/基础结构/路线图”措辞。
   - 检查 `git status --short`，确认既有 `ai/`、`tests/`、`.trellis/spec/` 变更未被修改。已确认本任务只产生 README 和任务材料。

5. **收尾**
   - 若本任务没有产生新的可复用代码规范，不更新 `.trellis/spec/`，在收尾记录中说明。
   - 按实际 diff 生成简体中文 commit message，只提交 README 和本任务材料。
   - 完成 Trellis session journal，归档任务并向用户交付 README 链接、检查结果和当前工作区注意事项。

## 质量门槛

- README 不出现无证据的 RAG、向量数据库、多智能体、Docker、CI、独立数据库或 MIT/Apache 等许可证声明。
- Mermaid 使用合法代码围栏和简洁节点；命令与文件链接不指向不存在的路径。
- 文档没有密钥、宿主私密设置或未脱敏的 API 内容。
- 运行时安装说明与开发测试说明分开。
- 变更边界只包含根 README 和当前任务工件；已有未提交修改保持原样。

## 回滚点

- README 生成前：只需保留当前任务规划材料，不触碰产品代码。
- README 生成后：若事实或格式审查不通过，使用 `git diff -- README.md` 定位并修正；不使用破坏性 Git 命令，不覆盖其他工作。
- 提交前：只暂存本任务文件，先检查 staged diff，再提交。

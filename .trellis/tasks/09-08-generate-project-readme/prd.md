# 生成项目完整中文 README

## Goal

基于 BioWeave 当前仓库的真实源码、目录结构、运行配置、AI Prompt、测试和已有文档，重写根目录 `README.md`，形成可直接用于 GitHub 的完整中文项目说明，并通过内容准确性、Markdown/Mermaid 结构和项目检查。

## Background and Confirmed Facts

- BioWeave 是一个以原生 JavaScript 实现的 SillyTavern 第三方扩展，入口由 `manifest.json` 指向 `index.js`，样式由 `style.css` 提供。
- 当前版本标识为 `0.2.2-dev`；运行时不依赖 npm 第三方包，Node.js `>=18` 仅用于开发检查和测试脚本。
- 代码已经包含宿主生命周期适配、Chat/Floor 数据边界、API Profile/Secret、Worldbook 与最近剧情输入、World Model 分析和响应式 UI 基础。
- World Model 分析采用 OpenAI-compatible Chat Completions 形态或 SillyTavern 当前 API，输出经过 schema、解析和证据边界校验后才写入当前 Chat。
- 数据以 SillyTavern 扩展设置、`chat_metadata.bioweave` 和楼层消息 extra 为主，不是独立数据库应用。
- 事件、状态归约、Snapshot、Projection、Context 等领域模块和若干页面已有基础结构，但事件自动分析、完整状态推演、持久化投影和 Context 注入等能力仍需按当前实现状态谨慎表述。
- 仓库已有 `docs/DATA-MODEL.md`、`docs/DEVELOPMENT.md`、`docs/UI.md` 及 `docs/references/` 设计资料；README 应链接这些资料，而不是将设计稿中的规划全部写成已完成能力。
- 当前仓库没有 `Dockerfile`、Docker Compose、GitHub Actions、独立数据库迁移文件或 `LICENSE` 文件。

## Requirements

### README 内容

- [x] 使用简体中文，包含项目定位、核心能力、效果/参考界面、适用场景、安装、快速开始、使用说明、架构、AI 工作流、技术栈、目录、配置、性能、安全、当前状态、路线图、贡献、FAQ 和 License 说明。
- [x] 安装章节提供 AI 安装提示词、脚本/命令安装、手动安装三种方式，并明确运行环境、依赖、验证方式、无 Docker 配置和无独立数据库的事实。
- [x] 快速开始覆盖从启用扩展、打开入口、配置 API，到选择输入并执行 World Model 分析的最短路径。
- [x] 架构和分析流程使用 Mermaid；图中节点少而清晰，能区分宿主适配、运行时、存储、领域核心、AI 和 UI 边界。
- [x] AI 章节说明 `AnalysisInput`、四段普通 chat messages、可选外部公开记忆适配器、OpenAI-compatible 调用、JSON 解析、schema/证据校验和 Chat-local 持久化；不得虚构 RAG、向量数据库或多智能体编排。
- [x] 配置章节区分全局扩展设置、API Profile/Secret、当前 Chat 设置和楼层数据，说明密钥只保存引用、不落入 Chat 数据。
- [x] 对当前可用、基础实现、页面壳/占位和未来规划进行明确分层；不得把设计文档的目标状态当成已交付功能。
- [x] 对缺少实际运行截图的情况使用清晰的 TODO 占位，并将已有图片标记为 UI 参考资料而非运行截图。

### 变更约束

- [x] 产品代码只修改根目录 `README.md`；不得覆盖或整理用户已有的 World Model 未提交变更。
- [x] 保留现有 README 中仍然准确的版本、项目定位和开发入口信息，但以源码和文档复核结果为准重写。
- [x] 所有命令、路径、配置键和功能描述必须能在仓库源码、配置或文档中找到依据；不为当前不存在的 CI、Docker、数据库或许可证编造使用方式。
- [x] 参考图、文档链接使用仓库相对路径或真实仓库地址，避免指向不存在的文件。

## Scope

### In Scope

- 深度阅读入口、运行时、存储、领域核心、AI、Worldbook/记忆适配器、UI、样式、测试、配置和已有 Markdown/HTML/图片参考资料。
- 重写根目录 `README.md`，并验证标题层级、代码围栏、Mermaid 围栏、内部链接和 Git diff 空白。
- 在当前任务目录保存规划、执行和子 Agent 上下文材料。

### Out of Scope

- 不修改 `index.js`、`ai/`、`core/`、`runtime/`、`storage/`、`ui/`、`tests/` 或 `.trellis/spec/` 中现有实现。
- 不补写功能代码、测试代码、CI、Docker、独立数据库、许可证文件或实际截图。
- 不为了 README 重构模块、改变 API 请求、迁移数据或清理无关工作区变更。

## Acceptance Criteria

- [x] 根目录 `README.md` 是完整、可读、可发布的中文项目文档，且至少覆盖本 PRD 的全部 README 内容要求。
- [x] README 的技术描述与当前源码/配置/文档一致，明确标注 World Model 已实现边界和事件/推演等仍未完整接通的部分。
- [x] README 至少包含一张架构 Mermaid 图和一张 AI/World Model 工作流 Mermaid 图，语法和节点关系自洽。
- [x] 安装与快速开始不要求不存在的依赖；`npm test`/`npm run check` 的用途和 Node 版本说明准确。
- [x] README 不泄露真实密钥，不宣称有独立数据库、RAG、向量检索、多智能体或 Docker 部署。
- [x] `git diff --check` 通过；项目检查 `npm run check` 通过；除 README 和当前任务材料外，没有本任务引入的文件变更。
- [x] 用户现有的 `.trellis/spec/frontend/state-management.md`、`ai/analyzer.js`、`ai/prompts.js`、`tests/world-model.test.js` 以及另一个未完成任务目录保持不变。

## Key Decisions

- README 以“当前代码事实优先、规划状态透明”为写作原则。
- 采用“安装 → 快速开始 → 能力/架构 → 配置与边界 → 开发贡献”的阅读顺序，减少首次使用时在内部实现细节中迷路。
- 对没有真实运行截图的部分使用 TODO；已有 PNG/HTML 仅作为设计参考链接。
- License 章节如实说明仓库当前未提供 `LICENSE`，不擅自指定许可证。

## Risks and Deferred Items

- README 无法替代真实 SillyTavern 环境验收，因此 UI 效果章节不应冒充运行截图。
- SillyTavern 宿主的菜单入口、Secret Store 和 ChatCompletionService 可能随宿主版本变化；安装说明需保留“按当前宿主版本加载第三方扩展”的提示。
- 事件自动分析、完整状态计算、Projection 生命周期和 Context 注入如果尚未由入口串起，只能列为基础结构/路线图，不应写成现成端到端能力。
- README 变更后是否需要额外截图、补 LICENSE 或补发布渠道，留给后续发布任务处理。

## Open Questions

无阻塞问题。用户已明确要求按 README skill 深度分析并生成当前项目 README。

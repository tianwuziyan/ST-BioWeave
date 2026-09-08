# README 技术设计

## 1. 文档边界

本任务的产品变更只有根目录 `README.md`。任务材料是规划和审查依据，不改变运行时代码。README 需要同时服务三类读者：想安装扩展的 SillyTavern 用户、想理解数据/AI 边界的开发者、想继续实现事件与状态链路的贡献者。

写作采用“事实分层”而不是把所有模块统一称为已完成：

- **当前可用/已有实现**：入口生命周期、响应式 UI 基础、API Profile/Secret、Worldbook 输入选择、World Model 分析与编辑、Chat/Floor 存储边界。
- **基础结构**：事件 schema、状态 reducer、Snapshot、Projection、Genealogy、Context builder 及对应测试/页面骨架。
- **待完善**：事件自动分析链路、完整确定性状态计算、Snapshot 恢复接线、Projection 持久化流程、Tavern Context 注入和真实多人数据总览。

## 2. 证据到章节的映射

| README 章节 | 主要证据 | 写作边界 |
| --- | --- | --- |
| 定位、安装、版本 | `manifest.json`、`package.json`、`index.js`、现有 README | 说明 SillyTavern 扩展，不写成独立服务 |
| 数据与架构 | `docs/DATA-MODEL.md`、`runtime/`、`storage/`、`core/`、`context/` | 强调宿主设置、Chat metadata、楼层 extra 三个边界 |
| AI 工作流 | `ai/input-builder.js`、`ai/prompts.js`、`ai/client.js`、`ai/analyzer.js` | 明确 AnalysisInput、四消息、证据校验；不宣称 RAG/多 Agent |
| Worldbook 与记忆 | `ai/worldbook.js`、`story/seven-days-cal.js`、`docs/UI.md` | 说明稳定选择、延迟加载和公开接口；不把选择器称为向量检索 |
| UI 与效果 | `ui/app.js`、`ui/settings.js`、`ui/world.js`、`style.css`、`docs/UI.md`、`docs/references/` | 参考图标注为参考；页面壳和占位单独说明 |
| 配置与安全 | `storage/schema.js`、`storage/store.js`、`ai/client.js` | 说明 Secret Store 只写/删、只保存引用和 URL 清洗 |
| 开发与测试 | `package.json`、`tests/*.test.js`、`docs/DEVELOPMENT.md` | 只列真实脚本和测试范围 |
| 路线图与 License | 当前源码状态、设计文档、仓库文件清单 | 未实现项和缺少 `LICENSE` 如实披露 |

## 3. 目标 README 结构

1. 标题、版本和一句话定位。
2. 项目简介与核心能力。
3. 效果展示/参考界面和适用场景。
4. 安装：AI 提示词、命令安装、手动安装、环境与验证。
5. 快速开始和主要使用流程。
6. 功能边界与当前状态。
7. 架构图和数据流说明。
8. AI/World Model 工作流图及规则。
9. 技术栈、目录结构、配置说明。
10. 性能、可扩展性、安全与隐私。
11. 路线图、贡献、FAQ、License。

安装放在架构之前；快速开始只描述最短操作路径，不复制整段安装说明。

## 4. Mermaid 设计

### 系统架构图

使用 `flowchart LR`，节点覆盖宿主入口、Runtime/Adapter、Storage、Core/Context、AI、UI 六个边界，控制在约 10 个节点。图中标注数据保存位置，避免把插件误解为拥有后端数据库。

### World Model 工作流图

使用 `flowchart TD`：当前 Chat/角色卡/Worldbook/最近剧情/可选公开记忆 → `AnalysisInput` → 四段消息 → 当前或独立 API → JSON 解析 → schema/证据边界 → Chat-local World Model。另画失败保留旧成功结果、Floor Version 去重和手动重试的简短分支，节点不超过 15 个。

## 5. 使用示例设计

- 安装命令使用真实仓库地址 `https://github.com/tianwuziyan/ST-BioWeave.git`，目标目录使用 `<SillyTavern>/public/scripts/extensions/third-party/` 或当前宿主对应的第三方扩展目录。
- 运行时说明不要求 `npm install`；开发检查使用 `npm install` 可选但不把它当成扩展启用步骤。
- 快速开始按“输入魔法棒 → 扩展菜单 → BioWeave → 设置 API → 选择 Worldbook/最近剧情 → 世界模型 → 分析”描述。
- 配置示例只展示不含密钥的字段名和脱敏占位符，不展示真实 Secret 值。

## 6. 兼容性与回滚

- README 需保留宿主版本差异提示，避免硬编码宿主内部菜单实现为永久 API。
- 若审查发现某项功能表述无法由源码或文档证明，优先降级为“基础结构/路线图”或删除该句，而不是修改代码以配合文档。
- 若 Markdown/Mermaid 检查失败，只修正文档结构和文字；不扩大产品文件变更范围。

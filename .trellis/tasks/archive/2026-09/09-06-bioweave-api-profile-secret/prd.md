# BioWeave API Profile + Secret 安全存储 + 测试连接

## Goal

Implement API Profile CRUD, secret_ref-only persistence, safe connection testing, task-to-profile selection, and responsive settings UI without entering Worldbook, World Model, Event Analyzer, or Projection development.

## Requirements

- 先审查现有 `ai/client.js`、`storage/`、`ui/settings.js`、设置页及所有持久化/导出/日志/Prompt Inspector 路径，再实施；本任务不改变当前轻量模块化结构。
- 支持 API Profile 的新建、编辑、删除，以及 Provider、API URL、Model、Context Size、Max Output Tokens、Temperature、Timeout、Retry Count 字段。
- API Key 可以在设置页输入和更新，但 Profile 持久化对象只能保存不透明的 `secret_ref`，不得保存明文 Key。
- API Key 的实际秘密值必须保存在独立的 secret 存储边界，不得进入 `chat_metadata`、`message.extra`、Event、Snapshot、Projection、Log、Export 或 Prompt Inspector。
- 支持安全的“测试连接”：显示成功/失败、模型和延迟等必要信息；错误信息、请求记录和 Inspector 必须 mask/省略 Secret，不回显 Key。
- 支持选择“BioWeave 独立 API”或“使用 SillyTavern 当前 API”。后者不得要求 BioWeave 复制或保存 SillyTavern 的 Key。
- 为 World Analysis、Event Analysis、Projection、History Scan 分别选择 API Profile；保存稳定 Profile ID，不使用 Profile 名称作为唯一标识。
- 设置 UI 使用现有 BioWeave 设置路由/模块，并在 Desktop、iPad/Tablet、Mobile 可操作；移动端不得产生普通页面横向溢出。
- 本任务只实现 API 配置基础设施和对应设置 UI；不实现 Worldbook、World Model、Event Analyzer、Projection 业务或其它分析流程。

## Acceptance Criteria

- [ ] 设置页可新建、编辑、删除 Profile，并完整编辑九项配置字段。
- [ ] 保存后的 Profile 只包含 `secret_ref` 等安全字段；全工程持久化和序列化路径不存在 API Key 明文。
- [ ] 输入新 Key、更新 Key、保留已有 Key、清除 Key 的行为有明确结果；删除 Profile 会清理其 Secret 引用且不影响其它 Profile。
- [ ] 独立 API 测试连接可用，成功/失败结果只显示安全元数据（至少状态、模型/配置模型、延迟或安全错误摘要）。
- [ ] SillyTavern 当前 API 选项可选且不在 BioWeave 数据中保存其 Secret。
- [ ] 四个任务槽位可以独立选择/清除 Profile，并持久化 Profile ID。
- [ ] 设置页在 Desktop / Tablet / Mobile 可打开、编辑、保存、测试和删除；移动端无普通横向溢出。
- [ ] 现有测试通过；增加少量存储/安全/lifecycle DOM 回归测试，覆盖明文 Key 不落盘和测试结果脱敏，不创建大型测试框架。
- [ ] 本任务完成后停在 API 配置基础设施；Worldbook、World Model、Event Analyzer、Projection 仍为 TODO。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.

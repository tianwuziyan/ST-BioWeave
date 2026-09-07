# BioWeave API Profile / Secret 实施计划

## 顺序

1. 审计现有 API、storage、设置 UI、日志/导出/Prompt Inspector 和测试，记录真实数据路径与当前错误。
2. 对照当前 SillyTavern 官方/实际公开 API，确认“使用 SillyTavern 当前 API”和可用 Secret 能力；若无公开 Secret API，选择最小隔离实现并明确安全边界，不制造假的宿主兼容代码。
3. 在现有 storage 边界增加 Profile/assignment 的规范化、稳定 ID、校验和 CRUD；在独立 Secret 边界增加 set/get/remove，Profile 只留 `secret_ref`。
4. 修正/扩展 `ai/client.js`：不接受或返回会被持久化的明文 Profile，支持独立 API 测试连接、当前 API 模式、超时、受控重试和安全错误结果。
5. 扩展 `ui/settings.js` 与现有 CSS/HTML：Profile CRUD 表单、九项字段、密码输入、测试状态、四个任务选择器和三端可操作布局。
6. 增加少量现有测试：Profile 序列化无明文、Secret 引用生命周期、测试失败结果脱敏、设置 DOM CRUD/assignment；不创建大型 mock 数据库或测试框架。
7. 运行 `npm test`、`npm run check`、所有修改 JS 的 `node --check`，并执行静态 Secret 泄漏检查。
8. 通过 `trellis-check` 做范围/规范/安全复核，完成后停在本任务，交付 Desktop → Tablet → Mobile 的真实设置页验收步骤；不进入 Worldbook。

## 验证命令

```bash
npm test
npm run check
find runtime storage core ai story context ui -name '*.js' -print0 | xargs -0 -n1 node --check
node --check index.js
rg -n -i "api[_-]?key|authorization|secret" --glob '*.js' ai storage ui context core runtime story tests
```

静态搜索结果需要逐项区分：允许存在于输入/Secret Store边界与测试断言中的局部变量，不允许出现在 Chat serializer、Event/Snapshot/Projection、Log、Export、Prompt Inspector 的输出对象中。

## 手工验收顺序

### Desktop

BioWeave → 设置；新建 Profile，保存并刷新页面；确认列表只显示配置摘要与 `secret_ref` 状态，不显示 Key。编辑/更新、测试成功/失败、四个任务槽位、删除后重开逐项验证。

### Tablet / iPad

在真实 iPad 或 768–1199px viewport 重复上述流程，确认编辑器和测试结果区可滚动、按钮可点击、没有横向溢出，Secret 不因旋转或重开回填到 DOM 文本。

### Mobile

在真实手机或 <768px viewport 重复上述流程，确认设置入口可达、表单纵向单列、键盘弹出时测试/保存按钮仍可操作，Profile 删除和任务选择不需要横向滚动。

## 停止点

完成 API 配置基础设施与设置 UI 后停止，等待用户真实 SillyTavern 测试；不自动开始 Worldbook、World Model、Event Analyzer、Projection 或其它分析业务。

## 当前实现记录（2026-09-06）

- [x] Profile 全局设置、稳定 `profile_id`、九项配置字段和四类任务分配已接入现有 `storage/` 与 `settings` 路由。
- [x] API Key 只通过 SillyTavern Secret Store 的写入/删除边界处理；Profile、Chat/Floor serializer 和设置 DOM 只保留 `secret_ref` 或安全状态。
- [x] 独立 API 测试连接使用 SillyTavern `ChatCompletionService.processRequest`；当前 API 使用公开 `generateRaw`，错误结果脱敏并返回延迟/模型等安全信息。
- [x] 替换、清除、删除 Secret 的正常生命周期和清理失败提示已覆盖测试；清理失败不会恢复旧引用。
- [x] 设置 UI 沿用已验收的 BioWeave documentElement 宿主和响应式 UI Foundation，不新增入口或第二套设置容器。
- [x] 自动验证：`npm test`、`npm run check`、修改模块 `node --check` 均通过；当前共 39/39 测试通过。
- [x] 修复设置页 draft 丢失：`ui/app.js` 在 input 阶段保存按 Profile ID 的内存 draft；保存失败、测试成功/失败和 Profile 切换均从 draft 恢复，成功保存后仅清空 API Key 输入并显示已保存状态。
- [x] 测试连接与保存解耦：独立 API 测试使用临时 Secret 引用并在 `finally` 清理，不修改 Profile 或 extension settings；公开设置状态不会暴露 draft Key。
- [x] 简化设置 UI：API 来源、基本设置、默认收起的高级设置、任务分配分成独立区域；补充 draft/高级设置回归断言。
- [x] 重整 BioWeave 日/夜/跟随酒馆 token：显式 surface、text、border、accent、input 和状态色，日/夜使用高对比不透明颜色且不修改 SillyTavern 全局主题。
- [x] 增加模型刷新基础链路：通过 SillyTavern custom status 接口和不透明 `secret_id` 拉取 `/models`，设置页支持刷新、搜索、滚动和点击选择；未选模型时仍可用临时 Secret 测试。
- [x] 清除 BioWeave 自有 UI 的继承式 `transform`、`filter`、`text-shadow`、`opacity` 和 backdrop blur 风险，固定字体族、字重、行高和字体平滑策略，并将日/夜背景调整为中性高对比层次。
- [ ] 待用户在真实 SillyTavern Desktop、iPad/Tablet、Mobile 设置页完成手工验收。

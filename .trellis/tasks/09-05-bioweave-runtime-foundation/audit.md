# BioWeave 工程审计记录

审计范围覆盖本轮要求的 README、开发/数据/UI 文档、v2.0 设计文档与参考 JPEG、manifest、入口、runtime、storage、core、ai、story、context、ui、style、settings 和 tests。参考 JPEG 已视觉检查；其中仍显示旧品牌 `BioState`，本轮只记录风险，不修改资产。

## A. 已经实现

- `manifest.json:11-17` 使用 SillyTavern 支持的 `hooks` 生命周期映射；`index.js:72-115` 导出 `onActivate`、销毁钩子，并保持单一实例。
- `index.js:17-69` 只在宿主 `#extensionsMenu` 内注册 `#bioweave-extensions-menu-entry`，处理菜单延迟创建、重复 ID 清理、事件替换和销毁，不创建顶部常驻按钮。
- `runtime/chat.js:13-97` 提供 Chat ID、epoch、token、订阅、陈旧操作校验和销毁边界。
- `runtime/events.js:15-59,96-140` 每次从公开 `getContext()` 读取当前 Chat，监听官方 `eventTypes`，用 `removeListener` 清理事件；`storage/store.js:57-93` 在异步保存前后验证 Chat Scope。
- `runtime/floor.js:1-109` 计算并比较六字段 Floor Version，支持成功跳过、版本变化重试、手动刷新和失败时保留 `last_success`。
- `storage/schema.js:14-72` 与 `storage/store.js:37-93` 提供默认结构、克隆、递归 secret field 清洗、Chat scope 和普通/per-swipe Floor 存储。
- `ui/app.js:55-253` 提供单一 UI 根节点、打开/关闭/销毁、Chat 事件刷新、`tavern`/`light`/`dark` 主题即时切换和持久化；`style.css:1-295` 使用 token 与 PC/iPad/手机断点。
- 当前测试共 18 项；新增 `tests/runtime.test.js` 覆盖 boundary、scope、secret、普通消息/per-swipe、真实宿主 adapter 和生命周期解绑，`tests/floor.test.js` 覆盖版本与失败保留。

## B. 只有骨架

- `core/state.js:2-5` 仍返回排序后的事件 ID 和基础字段，没有真正的 deterministic biological State Reducer。
- `core/snapshot.js:1-2` 只有间隔判断和直接 reducer 转发，没有“最近存活 Snapshot + surviving Event replay”选择逻辑。
- `ai/analyzer.js:1-3`、`ai/prompts.js:1-2`、`ai/worldbook.js:1-3` 仍缺完整固定 schema、Validator Contract、公开 Worldbook 选择器和 Prompt Inspector。
- `story/seven-days-cal.js:1` 仍是 `null` fallback；`story/time.js:1` 只有 provider wrapper。
- `ui/events.js:1`、`ui/projection.js:1`、`ui/genealogy.js:1`、`ui/world.js:1`、`ui/settings.js:1` 和 `ui/state.js:1` 仍为占位页面；总览/人物页也未接入 Chat 动态数据。

## C. 明显错误及本轮修复

- 原 `index.js` 的 DOM 自启动和长期 MutationObserver 不符合 manifest activation lifecycle；现改为 hook 驱动且 observer 在菜单挂载后断开（`index.js:72-115,24-69`）。
- 原 runtime 使用 `chat_id`/`chat_metadata`/全局事件回退并调用 `off`；现只读公开 camelCase context 字段，解绑使用 `removeListener`（`runtime/events.js:15-22,96-110`）。
- 原 swipe 0 写入 `message.extra.bioweave`；现只要存在 swipe 结构，0/1/2 均写入对应 `message.swipe_info[index].extra.bioweave`（`runtime/events.js:37-59`）。
- 原 `shouldAnalyze` 只看 status；现比较 Floor Version，且多次失败仍从 `last_success` 保留旧结果（`runtime/floor.js:46-103`）。
- 原 UI 的 `bw-*`/`bio-card` 类名和 app 销毁路径不符合命名/生命周期要求；现统一为 `bioweave-*`，并提供 root listener/runtime unsubscribe 清理（`ui/app.js:155-253`、`style.css:60-295`）。
- README 的版本标题原为 `v0.2.0-dev`，与 manifest/package 的 `0.2.2-dev` 不一致；本轮已同步 README 标题。

## D. SillyTavern API 不兼容 / 需要确认

- 已按当前官方 API 修正：`manifest.hooks`、`SillyTavern.getContext().chatId/chatMetadata/chat/eventSource/eventTypes`、`saveMetadata`/`saveChat`、EventEmitter `removeListener`。
- `settings.html` 仍只是静态模板（`settings.html:1-4`）；SillyTavern 不会仅因文件存在就自动插入设置区，后续若需要管理设置，必须通过公开 `renderExtensionTemplateAsync()` 追加到 settings 容器。
- 具体 provider secret 的安全存取接口不在当前 `getContext()` 稳定字段内；后续 AI Profile 任务需要再次按目标 SillyTavern release 确认，不应 import 私有 Store key。

## E. 与 UI v2.0 不一致

- 当前总览仍是多人总览的空状态骨架，但人物卡、事件、推演、家系、世界模型尚未接真实数据；人物详情二级页面、编辑器 Sheet、事件 CRUD、Projection 删除交互尚未实现。
- 现有移动端已提供底部四页 + 更多菜单入口，并保留桌面/Tablet/手机断点；但“功能等价”仍未完成，因为上述业务页面仍是骨架。
- `docs/references/BioWeave_UI_v2.0_reference.jpeg` 的视觉资产文字仍是 `BioState`；正式代码未恢复兼容层，资产修复另列任务。

## F. 安全问题

- 本轮未发现 `ai/client.js:1` 把 API key 直接写入 Profile；它只通过 `secretResolver(profile.secret_ref)` 取 key。但 Profile 的安全持久化、导出/日志/Prompt Inspector mask 尚未实现，不能把当前 client 视为完整 secret 方案。
- `storage/schema.js:14-55` 会递归移除明显的 API key、authorization、bearer/token、password 等字段，并保留 `secret_ref`/`secret_id`；对应 Chat/Floor 写入经过 `storage/store.js:57-93`。
- 后续必须继续验证 Event、Snapshot、Projection、Log、Export 和 Prompt Inspector 的所有序列化出口，确保不会绕过 storage sanitizer 泄露 secret。

## G. 推荐实现顺序

1. 建立独立 API Profile 的安全引用/设置持久化、超时重试和测试连接。
2. 接入公开 Worldbook 来源与稳定 `source_id`，实现选择器和 token estimate。
3. 完成 World Model 固定 schema，再实现 Floor Event Analyzer 和 JSON Validator。
4. 实现 Event ledger CRUD、deterministic State Reducer、Snapshot surviving/replay。
5. 实现 Projection 生成/删除和紧凑 Context Injection；接入公开 SevenDaysCal Story Time，并保留 fallback。
6. 完成 Genealogy Graph 推导/排序、人物详情 focus，以及总览/事件/推演/世界/设置的数据接线。
7. 最后实现完整 v2.0 编辑器、移动端 Sheet、Prompt Inspector、导出脱敏和端到端宿主测试。

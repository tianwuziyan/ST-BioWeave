# BioWeave 基础运行层：工程审计与实现

## Goal

在不改变 BioWeave 轻量模块化结构的前提下，先完成可复核的工程审计，再让扩展能以当前 SillyTavern release 支持的方式加载、从输入区魔法棒的 `#extensionsMenu` 打开主 UI，并安全地围绕当前 Chat 读写 Floor 数据。第一轮不实现 AI 生理分析本身，但要把后续 Event / State / Snapshot / Projection / Context / UI 功能依赖的运行边界固定下来。

## Background and confirmed facts

- 工程是无 Git 元数据的单目录扩展，`package.json` 只有 `node --test` 和 `node --check`，当前 7 个测试全部通过。
- `manifest.json` 已声明 `js` / `css`，但 `author` 与 `homePage` 仍是 `TBD`，也没有使用当前 SillyTavern manifest lifecycle hook。
- `index.js` 当前用 DOMContentLoaded/微任务自启动、直接追加菜单项和长期 `MutationObserver`；它没有可调用的完整销毁路径。
- `runtime/events.js` 当前读取了若干非官方命名回退字段，监听器卸载使用 `off`，而官方 release 的 `EventEmitter` 提供的是 `removeListener`。
- `runtime/events.js` / `storage/store.js` 当前把 swipe 0 写入 `message.extra.bioweave`，只有 `swipeId > 0` 才写 `message.swipe_info[swipeId].extra.bioweave`，因此同一消息的 swipe 0 与其他 swipe 可能互相覆盖。
- `storage/store.js` 当前不验证读取数据的 Chat Scope，也不在异步保存前后防止 Chat 切换造成跨 Chat 写入。
- `runtime/floor.js` 当前的自动分析判断只看 `status`，没有比较已保存结果与目标 Floor Version；`message_version` 默认恒为 `v1`。
- `ui/app.js` 已有三种主题按钮与 localStorage key，但主题保存、DOM 复用、Chat 切换刷新和销毁边界不完整；部分 UI 使用 `bw-*` 或 `bio-card`，与统一的 `bioweave` CSS 前缀要求不一致。
- `ui/*`、`ai/*`、`story/*`、`context/*` 与部分 `core/*` 仍是骨架/TODO；Worldbook、SevenDaysCal、AI Profile、Prompt Pipeline、Event CRUD、State Reducer、Snapshot restore、Projection、Genealogy 和完整 v2.0 页面不属于本轮实现。
- `docs/references/BioWeave_UI_v2.0_reference.jpeg` 的视觉稿仍显示旧产品名 `BioState`，而正式设计文档与工程命名要求均为 `BioWeave`；本轮不重绘/替换参考资产，只记录为审计风险。
- 当前 SillyTavern release 的官方文档/源码确认：扩展使用 `manifest.json`；`hooks.activate` 可以指向入口模块导出的函数；`getContext()` 提供 `chat`、`chatId`、`chatMetadata`、`saveMetadata`、`saveChat`、`eventSource`、`eventTypes`、`getRequestHeaders`；`eventSource` 的卸载方法为 `removeListener`；`ChatMessage` 使用 `swipes`、`swipe_id`、`swipe_info[]`、`extra`。

## Requirements

### R1. 工程审计

审计交付必须覆盖用户指定的 README、开发/数据/UI 文档、v2.0 设计文档与参考图、manifest、index、runtime、storage、core、ai、story、context、ui、style、settings、tests，并按以下 A–G 分类列出：已实现、骨架、明显错误、SillyTavern API 不兼容/待确认、UI v2.0 不一致、安全问题、推荐顺序。每条严重问题应带文件与行号证据。

### R2. SillyTavern 加载与入口

- 使用当前 SillyTavern manifest 语义加载，不创建顶部常驻 BioWeave 按钮。
- 在输入区魔法棒生成的 `#extensionsMenu` 中注册恰好一个 BioWeave 菜单项；菜单延迟创建、重复初始化、模块重载时不能产生重复 DOM 或重复事件监听。
- 主 UI 的打开、关闭、挂载、销毁必须有明确生命周期；同一页面重复触发激活/初始化不得创建第二个根节点。
- `settings.html` 若保留扩展管理入口，不得变成主 UI 的启动路径。

### R3. Chat Scope 与生命周期

- 所有动态 BioWeave 数据以当前 `chatId` 为边界；Chat A 切换到 Chat B 后，UI 与读写不得复用 A 的动态引用。
- 基础运行层要监听官方可用的 Chat/message/swipe/generation 生命周期事件；事件监听可销毁且不会重复绑定。
- 异步保存若在 Chat 切换后完成，必须拒绝陈旧写入，而不是写入新 Chat。
- 不引入 `BioState` 兼容层；代码、命名、DOM ID、CSS class、数据字段使用 `BioWeave` / `bioweave` 约定。

### R4. Floor Version 与 swipe 隔离

- Floor Version 至少包含 `chat_id`、`message_id`、`swipe_id`、`content_hash`、`message_version`，且编辑文本或切换 swipe 会产生不同版本。
- 只有同一 Floor Version 的成功结果可以被自动跳过；不同版本必须重新判断；失败允许重试；手动刷新必须强制执行。
- 手动刷新失败不得清空或覆盖上一次成功结果；成功后才替换当前版本结果。
- 无 swipe 的消息使用 `message.extra.bioweave`；存在 swipe 数据时，每个 `swipe_id`（包含 0）使用对应 `message.swipe_info[swipe_id].extra.bioweave`，不得交叉覆盖。

### R5. Storage 契约

- `chat_metadata["bioweave"]` 仅存 Chat-local 的非 secret 动态数据；`message.extra.bioweave` / per-swipe `extra.bioweave` 仅存对应 Floor 数据。
- 读取缺失数据返回默认结构，但不能把另一个 Chat 的数据当成当前 Chat。
- 写入验证 Chat Scope，并在边界变化时拒绝陈旧写入。
- 存储入口不得把 API key 写入 Chat metadata、message extra 或其下的 Event/Snapshot/Projection/Log/Export/Prompt Inspector 数据；后续需要外部 secret 时只允许使用安全引用。

### R6. 主题基础能力

- 主 UI 提供“跟随酒馆 / 日 / 夜”三个按钮；默认“跟随酒馆”。
- 主题选择持久化、切换无需刷新、只改变 BioWeave token，不改变 SillyTavern 全局主题。
- 跟随酒馆优先消费 SillyTavern Theme Variables；日/夜使用 BioWeave 自己的 CSS variables，不复制三套完整 CSS。
- PC / iPad / 手机不得出现普通页面横向溢出；本轮至少保留现有三种断点契约。

### R7. 测试与边界

- 运行并保持现有测试通过。
- 增加少量针对 Chat Boundary、Floor Version/刷新失败保留旧结果、per-swipe storage 的单元测试；不为覆盖率批量拆测试文件。
- 不在本轮调用 AI，不把未实现功能伪装成已完成。

## Out of scope for this round

- AI Provider/API Profile UI、secret 写入/测试连接、Worldbook 选择器、Prompt Inspector 与完整 JSON schema/validator。
- World Model / Floor Event AI 分析、Event CRUD UI、deterministic State Reducer 的生理计算、Snapshot replay/restore、Projection 生成、Context 注入、SevenDaysCal 公开适配。
- 完整 UI v2.0 多人总览数据接线、人物详情、家系图谱交互、移动端 Sheet 编辑器。
- 修复或替换参考 JPEG 中的旧品牌文字；仅记录审计发现。
- 大型目录重构、Factory/Registry/Repository/Service 等预先抽象层。

## Acceptance criteria

- [ ] A–G 审计结果已写入本轮交付说明/任务记录，并引用关键文件与行号。
- [ ] manifest 使用真实 SillyTavern lifecycle 语义，扩展可通过 activation hook 初始化。
- [ ] `#extensionsMenu` 中最多一个 `bioweave-extensions-menu-entry`；重复激活/DOM 变化不重复挂载/监听。
- [ ] 主 UI 可打开/关闭/重新打开，销毁后根节点与监听器可清理；无顶部常驻 BioWeave 按钮。
- [ ] Chat 切换会推进 boundary epoch、刷新 UI scope，并拒绝陈旧异步保存。
- [ ] 目标 Floor Version 与成功元数据不一致时会重新分析；失败可重试；手动刷新失败保留旧成功结果。
- [ ] 无 swipe 与 swipe 0/1/2 的数据分别读取/保存，互不覆盖；删除 SillyTavern Floor 后不会由 BioWeave 另存孤立 Floor。
- [ ] storage 读写只接受当前 Chat Scope，且保存路径过滤明显的 API key 字段。
- [ ] 三种主题按钮默认/持久化/即时切换工作，使用 token，不影响酒馆主题。
- [ ] `npm test`、`npm run check` 通过；新增测试数量保持少量且覆盖上述基础契约。

## Key constraints and deferred risks

- 当前工程没有 Git 仓库，因此本轮不能提供正常 commit/branch 结果；不对用户已有文件做 destructive git 操作。
- SillyTavern 是持续变化的前端宿主；实现只依赖当前 release 官方 `getContext()` 公共能力，不 import 宿主私有 Store key。
- 客户端扩展不能把 secret 安全地存入自己的明文设置；具体 provider secret 的存储/查找要在后续 AI Profile 任务中使用 SillyTavern secrets 接口或明确安全降级。
- 当前参考 JPEG 与 BioWeave 品牌不一致；若将来作为产品资产发布，需要单独处理视觉资产，不在基础运行层偷偷修改。

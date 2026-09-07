# Research: ST-SevenDaysCal 请求、消息与可编辑设置

- Query: 核对 ST-SevenDaysCal 的 `api/client.js`、`runtime/settings.js`、`index.js`、`style.css`，提取 API 请求、消息组织、可编辑 prompt/标签/label 设置，并映射到 BioWeave 的最小 World Model 改动。
- Scope: external
- Date: 2026-09-07

## Findings

### Files found

- [`api/client.js`](https://raw.githubusercontent.com/atonal519/ST-SevenDaysCal/master/api/client.js) — ST server proxy 请求体、消息预处理、重试与 memory wrapper。
- [`runtime/settings.js`](https://raw.githubusercontent.com/atonal519/ST-SevenDaysCal/master/runtime/settings.js) — API 配置/预设及可编辑设置的默认值、读写。
- [`index.js`](https://raw.githubusercontent.com/atonal519/ST-SevenDaysCal/master/index.js) — `buildMessages`、设置区 markup、标签/prompt 保存事件、worldbook label UI。
- [`style.css`](https://raw.githubusercontent.com/atonal519/ST-SevenDaysCal/master/style.css) — 设置折叠区、textarea/tag input、worldbook source/entry label 的展示样式。

Retrieved from `atonal519/ST-SevenDaysCal`, `master`, on 2026-09-07. 外部仓库的 API key 存储方式不应照搬到 BioWeave。

### API request shape

- 所有 OpenAI-compatible 请求走 ST server-side proxy `/api/backends/chat-completions/generate`，不是浏览器直连第三方 URL：`api/client.js:110-116`。
- 请求体由 `postChatCompletionCore()` 构造：`api/client.js:190-239`。核心字段是：

  ```js
  {
    chat_completion_source: 'openai',
    reverse_proxy: normalizeApiUrl(cfg.url),
    proxy_password: cfg.key,
    model,
    messages,
    stream,
    presence_penalty: 0,
    frequency_penalty: 0,
    max_tokens,
    temperature,
  }
  ```

- 实际 POST 在 `api/client.js:286-318`，body 是 `JSON.stringify(body)`，400/401/403/404 不重试，429/5xx 才按条件重试：`api/client.js:264-304`。因此 ST 的“Bad Request”首先是 body/宿主代理契约错误，而不是响应解析失败。
- 请求消息内容的 `{{user}}`/`{{char}}` 仅在字符串 content 上展开，非字符串 message 原样保留：`api/client.js:67-78`。这适合 BioWeave 只对文本 prompt 做宏处理，不要重写 message object。
- ST 会将机械处理协议注入已有 system 消息，或在前面新建 system：`api/client.js:206-219`。注意这是 ST-SevenDaysCal 的业务层注入；World Model 不应复制它的创作/记忆业务规则。
- `callMemoryApi()` 明确“跳过 chat history/world info，只发送 raw messages array”：`api/client.js:360-371`。这与 BioWeave 当前 World Analysis 使用已经裁剪好的 `AnalysisInput` 是相近的边界。

### Message organization

- `buildMessages()` 在 `index.js:5850-5910` 组装标准 chat messages：system 负责角色/世界书/记忆等背景，历史映射为 `user`/`assistant`（`index.js:5894-5902`），最后追加一条 `user` prompt（`index.js:5910`）。
- 因此对 BioWeave 的最小映射是：固定 World Model 约束/schema 放 system；具体 `AnalysisInput` 放 user。不要复用 `buildMessages()`，因为它会带入 ST-SevenDaysCal 的角色卡、world info、memory、almanac 等业务上下文；只借鉴消息层次。

### Editable prompt / tag / label settings

- `runtime/settings.js:7-20` 保存 flat API 配置和命名预设；`runtime/settings.js:78-86` 保存 `keepTags`、`extraTags`、`customPrompt`、`spacePersona`、theater prompts 等文本设置。
- 配置初始化只补缺失值，不覆盖已有设置：`runtime/settings.js:95-103`；API 读取/保存分别在 `runtime/settings.js:114-150`，预设快照在 `runtime/settings.js:153-180`。
- `index.js:3162-3192` 的“提示词与标签”区把用户可编辑内容按用途分开：
  - `customPrompt` 只追加到创作链，不进入机械任务（`index.js:3166-3169`）。
  - `keepTags`/`extraTags` 是读取 AI 楼层时的标签清洗规则（`index.js:3170-3176`），不是 API message role。
  - story-clock、space persona、theater style 各自单独 textarea（`index.js:3177-3192`）。
- 标签输入在 `index.js:7078-7100` 规范化后随 `input`/`change` 保存；prompt/persona 在 `index.js:7101-7126` 以 input/blur 保存。该模式说明“可编辑”应有明确的 task owner 和保存时机，不应把一个全局 custom prompt 无差别注入 World Analysis。
- worldbook UI 的 source/entry label 与选择 checkbox 分离，相关 markup 在 `index.js:7300-7355`；label 只是显示，稳定 ID 才用于选中/加载。这与 BioWeave 当前 `source_id`/`entry_id` 选择模型一致。

### `style.css` 证据

- 设置 section 使用 `<details>` 折叠标题/body：`style.css:996-1042`；prompt drawer 是连续编辑列表并统一间距：`style.css:1130-1242`。
- worldbook source label/entry label 是展示层样式：`style.css:1415-1511`；不会改变 message 或 API body。
- tag input 和普通 input 只是宽度、字体、边框等样式：`style.css:1651-1659`、`style.css:1791-1804`。
- prompt textarea 使用可垂直 resize 和高度限制：`style.css:4783-4794`；label/hint 的颜色和间距在 `style.css:3326-3351`。结论：`style.css` 没有可移植的请求语义，BioWeave 只需保持现有 UI 风格，不应从这里推导 API 修复。

### Minimum mapping to BioWeave

1. 只借用 `system + user (+ optional history)` 的 message 组织；World Analysis 不需要 ST-SevenDaysCal 的完整业务上下文注入。
2. 只把 `AnalysisInput` 作为一条 user content；不把它拆成 ST 的 worldbook/memory/almanac 业务块。
3. `customPrompt` 的“只用于创作链”原则映射为：World Analysis 属于机械事实分析，不应自动继承创作 prompt。若产品确实要求可编辑 World prompt，优先复用 BioWeave 已存在的 `prompts.task` 容器，作用域只限 `world_analysis`。
4. 只复用现有 BioWeave profile/secret_ref 和 ST 宿主适配；不要复制 ST 的 `apiKey` flat storage 或新增 Provider。
5. label/tag 只作为显示/输入清洗设置，不加入 World Model schema 或 API 请求字段。

## Related specs

- `.trellis/tasks/09-07-world-model-v1/prd.md`、`design.md` — 固定 World Model v1、既有 API profile/assignment、无新 Provider、无 secret 持久化。
- `.trellis/spec/guides/cross-layer-thinking-guide.md` — API/UI/storage 跨层边界。

## Caveats / Not Found

- 外部仓库为滚动 `master`，不是不可变 commit；实现时如需严格复现，应记录实际 commit。
- ST-SevenDaysCal 的 settings 存 `apiKey`，这与 BioWeave 的 secret-ref 约束冲突；这里只采纳消息层和设置分层思想。
- 未修改远端或本地生产文件。

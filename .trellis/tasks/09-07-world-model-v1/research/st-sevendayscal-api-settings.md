# Research: ST-SevenDaysCal API、消息组织与设置边界

- Query: 核对 ST-SevenDaysCal 的 `api/client.js`、`runtime/settings.js`、`index.js`、`style.css`，提取 API 请求、消息组织、可编辑提示词/标签和参数兼容处理，作为 BioWeave World Model 的最小参考。
- Scope: external
- Date: 2026-09-07

## Findings

### Source/version

本次按固定提交阅读 GitHub 源码：

- Repo: [atonal519/ST-SevenDaysCal](https://github.com/atonal519/ST-SevenDaysCal)
- Observed default branch commit: `8ef6e3cc58fd71bdf16bcc3016502b3fae594c2a` (`release: v3.6.8`, 2026-09-06)。以下路径均指向这一提交，避免把可变 `master` 当作证据：[`api/client.js`](https://github.com/atonal519/ST-SevenDaysCal/blob/8ef6e3cc58fd71bdf16bcc3016502b3fae594c2a/api/client.js)、[`runtime/settings.js`](https://github.com/atonal519/ST-SevenDaysCal/blob/8ef6e3cc58fd71bdf16bcc3016502b3fae594c2a/runtime/settings.js)、[`index.js`](https://github.com/atonal519/ST-SevenDaysCal/blob/8ef6e3cc58fd71bdf16bcc3016502b3fae594c2a/index.js)、[`style.css`](https://github.com/atonal519/ST-SevenDaysCal/blob/8ef6e3cc58fd71bdf16bcc3016502b3fae594c2a/style.css)。

### 1. API 请求不是浏览器直连，而是宿主后端代理

- `api/client.js:107-113` 明确说明 OpenAI-compatible 请求统一走 SillyTavern `/api/backends/chat-completions/generate`，目的包括 CORS、HTTPS/HTTP 混合内容和内网地址可达性。
- `api/client.js:185-211` 的 `postChatCompletionCore` 先验证插件、URL、Key 和宿主 request headers，然后对消息内容做 `{{user}}`/`{{char}}` 替换；存在 system 消息时把基础处理层前置到该消息，否则新建 system 消息。
- `api/client.js:212-229` 的实际宿主 body 是：

  ```js
  {
    chat_completion_source: 'openai',
    reverse_proxy: normalizeApiUrl(cfg.url),
    proxy_password: cfg.key,
    model: cfg.model || 'gpt-4o-mini',
    messages,
    stream,
    presence_penalty: 0,
    frequency_penalty: 0,
    max_tokens,       // 有限时才加入
    temperature,      // 有限时才加入
  }
  ```

- `api/client.js:263-294` POST 上述 endpoint 并解析非流式 JSON；`api/client.js:271-280` 对 400/401/403/404 立即失败，只重试 429/5xx。`api/client.js:224-229` 支持按配置删除非 protected 参数，代码注释直接以“不接受某字段导致 400”的兼容端点为例。
- `api/client.js:329-348` 将 `callMemoryApi(messages)` 设计成不带聊天历史的 raw message caller，使用 `loadUtilityCfg()`、低温 `0.3` 和 mechanical prompt mode；这与“机械摘要/分析只发送业务传入消息”的边界相近。

### 2. 消息组织稳定地使用 system + history + user

- `index.js:5789-5827` 的 `buildMessages` 将角色卡、persona、author note、World Info、memory、almanac/calendar 合并到一个 system 字符串。
- `index.js:5828-5849` 再按 `historyLimit` 取最近可见 AI 楼，映射为 `user`/`assistant`；最终固定返回：

  ```js
  [{role: 'system', content: sys}, ...history, {role: 'user', content: prompt}]
  ```

- `index.js:5833-5841` 在历史消息进入请求前统一使用 `keepTags`/`extraTags` 清洗，再替换宿主宏；`api/client.js:64-75` 对所有字符串消息做占位符展开。这个模式说明“规则”与“待处理输入”分成不同消息是该插件的常规做法。
- `callMemoryApi` 是一个重要的反例边界：它不会调用 `buildMessages`，而是直接把业务传入的 `messages` 发给 `postChatCompletion`（`api/client.js:337-348`）。也就是说，机械链要保持消息数组的业务语义，不应复用创作链的角色卡/历史注入。

### 3. 可编辑 prompt、标签与参数设置

- `runtime/settings.js:7-31` 的默认设置保存 `apiUrl`、`apiKey`、`apiModel`，并保存可编辑的 `storyClockPrompt` 与版本号；`runtime/settings.js:68-86` 保存 `useAnima`、`useDatabase`、`keepTags:'content'`、`extraTags:''`、`customPrompt`、theater prompts 等。
- `runtime/settings.js:95-103` 只补缺失默认值；`runtime/settings.js:105-107` 解析剔除参数列表；`runtime/settings.js:114-150` 读写当前配置；`runtime/settings.js:153-180` 将完整配置（包括 Key）做命名预设快照。
- API UI 位于 `index.js:2834-2902`：Base URL、密码型 API Key、模型名、模型列表、超时、流式开关和“剔除参数”。`index.js:2884-2891` 直接说明可从 body 删除字段来规避接口 400。这个能力是通用兼容性开关，不是新增 Provider。
- 提示与标签 UI 集中在 `index.js:3116-3145`：
  - `customPrompt` 只追加到创作链，不进入日期判断、刻度、记忆压缩等 mechanical 链（`index.js:3120-3123`）；支持 `{{char}}`/`{{user}}`。
  - `keepTags`/`extraTags` 是全链路的标签清洗设置（`index.js:3124-3129`）。
  - `storyClockPrompt` 全部可编辑，留空表示内置默认，恢复默认通过清空回到随插件更新的内置版本；UI 明确警告不能删除机器合同（`index.js:3131-3134`）。
- 回填和持久化链路是显式的：`index.js:6689-6707` 在任何来源 early return 前回填标签、custom prompt、story clock；`index.js:6905-6961` 对 tag/custom/story-clock 输入绑定保存，并在 story clock 改动后刷新注入。

### 4. style.css 的 UI 结构信号

- `style.css:1130-1162` 为 prompt drawer 与嵌套 details 统一设置宽度、间距、展开布局；`style.css:1164-1180` 为标签说明和输入成组排版。
- `style.css:1200-1224` 为所有 prompt 子 section 提供 disclosure 箭头和一致的可展开视觉；`style.css:1227-1236` 让 tag row 与 textarea 共享布局。
- `style.css:1651-1659` 将标签输入设为可伸缩、左对齐、等宽字体；`style.css:1791-1804` 定义通用全宽输入、主题背景、边框和 focus 状态；`style.css:3323-3350` 提供 hint、label 和 inline code 的低侵入样式。
- 这套样式支持“少量可编辑 prompt/标签设置 + 明确说明 + 默认恢复”，不要求复制业务页面或引入复杂状态机。

## Files found

- `api/client.js` — API client、system 基础层、messages 预处理、宿主代理请求、400/重试规则和机械 raw caller。
- `runtime/settings.js` — API、预设、prompt、标签、时间戳与 memory 设置的默认值、读写和持久化。
- `index.js` — `buildMessages`、API 设置 UI、prompt/tag UI、字段回填与保存绑定。
- `style.css` — API/prompt/tag 设置区的 disclosure、表单和提示样式。

## Code patterns

- API proxy boundary: `api/client.js:185-229,263-294`。
- Message contract: `index.js:5789-5849`。
- Mechanical raw-message path: `api/client.js:337-348`。
- Exclude-parameter compatibility: `api/client.js:224-229` 与 `index.js:2884-2891`。
- Editable settings separation: `index.js:3116-3145,6689-6707,6905-6961`。

## External references

- 固定提交的源码页面见本文件 “Source/version” 小节；对应 raw URL 也可直接读取：
  - `https://raw.githubusercontent.com/atonal519/ST-SevenDaysCal/8ef6e3cc58fd71bdf16bcc3016502b3fae594c2a/api/client.js`
  - `https://raw.githubusercontent.com/atonal519/ST-SevenDaysCal/8ef6e3cc58fd71bdf16bcc3016502b3fae594c2a/runtime/settings.js`
  - `https://raw.githubusercontent.com/atonal519/ST-SevenDaysCal/8ef6e3cc58fd71bdf16bcc3016502b3fae594c2a/index.js`
  - `https://raw.githubusercontent.com/atonal519/ST-SevenDaysCal/8ef6e3cc58fd71bdf16bcc3016502b3fae594c2a/style.css`

## Related specs

- BioWeave `.trellis/spec/frontend/state-management.md:297-301,342-350,375-378` 已规定 current API / independent host boundary、URL normalization、opaque secret 与请求捕获测试；因此可借鉴消息组织和参数剔除思路，但不能复制该插件的 Key 存储方式。
- 本轮 `.trellis/tasks/09-07-world-model-v1/design.md:5-16,59-61` 冻结 BioWeave API/Secret 和复杂业务模块，只允许复用现有 `ai/client.js` 请求边界。

## Caveats / Not Found

- ST-SevenDaysCal 的 `master` 是可变分支；本记录固定到 v3.6.8 commit，后续源码变更不应无版本核对地覆盖本结论。
- 该插件 `runtime/settings.js:7-10,153-180` 明文保存 `apiKey` 到扩展设置/预设，这是它自己的存储模式；BioWeave 的 Secret Store 规范禁止采用，不能把 `apiKey` 字段复制到 Chat、Profile、Prompt 或调试数据。
- `style.css` 只验证了设置区的结构与表单可读性，没有把它当作 BioWeave UI 的可直接复制资产；本轮未修改任何插件或 BioWeave 生产文件。

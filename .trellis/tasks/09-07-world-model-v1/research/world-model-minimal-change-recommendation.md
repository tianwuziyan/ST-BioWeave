# Research: World Model v1 最小修改建议

- Query: 基于本地请求/测试证据、ST-SevenDaysCal 与 Anima-Memory-System 的源码阅读，给出不改冻结模块、不新增复杂 Provider、不保存 secret、不复制业务代码的最小处理顺序。
- Scope: mixed
- Date: 2026-09-07

## Findings

### 结论先行

当前最明确的本地问题不是 World Model schema、Chat 保存或外部记忆读取，而是请求消息契约没有对齐：`ai/analyzer.js:197-205` 把完整 World Model prompt 作为一条 system 消息发送，但 `tests/world-model.test.js:64-113` 已要求普通的 `system + user` 消息；当前 `npm test` 因此 82 个测试失败 1 个。与此同时，设置页传入的 `worldModelPromptResolver`（`ui/app.js:396-402`）在 `ai/analyzer.js:186-205` 中被忽略，导致可编辑 World Analysis prompt/labels 保存后不生效。

### 建议的最小修改顺序（仅建议，不在本研究中实施）

1. **先修 prompt/message 边界，不动 provider。**

   在现有 `ai/prompts.js` / `ai/analyzer.js` 边界增加一个最小 World Model message builder，返回两条普通消息：

   - `system`：固定 World Model 任务约束、禁止性别/人类默认推断、`null` 规则和固定 schema 合同；
   - `user`：`AnalysisInput` 的实际 JSON 证据，前后允许放可编辑的 input prefix/suffix。

   这样仍然是同一个 `callOpenAICompatible`，仍然复用 `ai/client.js`，不需要直接 fetch、不需要新增 Provider、不需要复制 ST-SevenDaysCal/Anima 的网络层。第二条消息应明确承载输入，以满足 `tests/world-model.test.js:105-112` 的现有契约，并与 ST-SevenDaysCal `index.js:5828-5849`、Anima `scripts/api.js:1499-1506` 的普通消息习惯一致。

2. **接通已存在的可编辑 prompt resolver，但保持核心不可删除。**

   `storage/schema.js:19-50` 已有 `task`、`input_prefix`、`input_suffix`、四个 labels 的安全规范化；`ui/settings.js:591-607` 已明确告诉用户核心约束和结果校验始终保留。因此最小实现应是：

   - 让 `createAnalyzer` 接收 `worldModelPromptResolver`，从 `ui/app.js:399-401` 读取当前已保存/当前草稿设置；
   - 由 prompt builder 将 `task/input_prefix/input_suffix` 作为可编辑附加文本放入固定 core 的允许位置；
   - 若要继续暴露 labels，就只在 AnalysisInput 的四个分段输出处使用 labels，不能把 labels 当作 schema 字段，也不能允许它们覆盖固定 JSON schema 或 capability 约束；
   - 空值回退 `DEFAULT_WORLD_ANALYSIS_PROMPT`，保留现有长度限制和字符串规范化；不把 Chat 正文、URL、Key 或 profile 对象混入设置。

   这复用现有设置/存储/UI，不引入 Anima 那样的角色卡 prompt block 系统。若本轮只追求先解除 Bad Request，第二步可以随后做，但必须把“可编辑设置已保存但未影响请求”记录为明确缺口。

3. **API 选择先用现有宿主边界验证，不扩张兼容层。**

   - 立即验证时优先把 `world_analysis` assignment 设为 SillyTavern current API：`ui/app.js:384-393` 已支持这一分配，`ai/client.js:188-195` 只调用公开 `generateRaw`，且不读取/复制宿主 Key；本地 host source `script.js:3865-3920,3941-3951` 也显示 `generateRaw` 接受 `string | object[]`。
   - 若必须使用独立 Profile，保留现有 `ChatCompletionService.processRequest` contract：`ai/client.js:204-221` 的 `custom_url`/`secret_id`/`max_tokens`/`temperature` 已被本地 spec 固定；先用实际宿主网络日志确认最终 body，再决定是否删减 provider 不接受的可选参数。不要把 ST-SevenDaysCal 的 `reverse_proxy/proxy_password` 或 Anima 的直连 `Authorization` body 复制到 BioWeave。
   - 如果 400 只在某个兼容端点出现，应只在既有 client adapter 中增加受证据支持的参数剔除/映射；不要新增第二套 Provider 抽象。ST-SevenDaysCal 的 `api/client.js:224-229` 与 `index.js:2884-2891` 证明“按配置剔除不受支持字段”是一个小而局部的兼容手段，但不能在没有 upstream error body 时盲删字段。

4. **补最小回归证据。**

   建议在现有测试边界内增加/调整三项断言：

   - current API 与 independent API 都捕获 `messages.map(role)` 为 `['system','user']`，且 `AnalysisInput` 仅在 user content；
   - 自定义 `worldModelPromptResolver` 的 task/prefix/suffix/labels 确实出现在 prompt 的允许位置，核心 schema/禁止推断约束仍存在；
   - independent payload 继续只有 `secret_id` opaque/sentinel，不出现 `api_key`；请求失败继续保持上一份 Chat-local model。

   这些测试可直接覆盖“请求形状”“可编辑设置断线”“secret 安全”和“失败保留”，无需端到端复制第三方插件。

### 冻结边界

不建议修改以下边界：

- `ai/client.js` 的 Secret/host API contract、`storage/schema.js` 的 secret normalization 和 `storage/store.js` 的 Secret Store；规范要求只传 `secret_ref`/`secret_id`（`.trellis/spec/frontend/state-management.md:297-310,349-364`）。
- `ui/app.js:920-953` 的 AnalysisInput 读取/预览语义，以及 `ui/app.js:1182-1227` 的成功替换、失败保留和 Chat-local save。
- Event/Floor/State/Snapshot/Projection/Genealogy/Context、宿主入口和主题；本轮设计已将它们列为冻结项（`design.md:5-16`）。
- ST-SevenDaysCal/Anima 的业务代码、角色卡规则、标签清洗器或网络代理；它们只能提供 message/settings 参考，不能成为 BioWeave 的新依赖。

### 不建议的改法

- 不要把 `AnalysisInput` 再复制进 `world_model_meta` 或 Chat/Floor；`ai/analyzer.js:157-183` 和 `tests/world-model.test.js:131-145` 已把 metadata 限制为摘要计数。
- 不要为了绕过 400 在 BioWeave 内部读取/保存 API Key；`ai/client.js:216-221`、`tests/api-profile.test.js:309-312,328` 已锁定无 Key profile 的 sentinel 语义。
- 不要把整个 ST-SevenDaysCal 的 `buildMessages` 或 Anima 状态/总结业务搬进 World Model；只需在 World Model prompt builder 形成两条消息，并继续由既有 client 发出。
- 不要先改 UI 错误文案来掩盖 400；`ai/client.js:157-174` 的安全摘要可保留，诊断应在不泄漏 secret 的前提下增加可验证的 host status/body 分类，而不是把原始异常写入 Chat 或日志。

## Files found

- `ai/analyzer.js`, `ai/prompts.js`, `ai/client.js` — 当前 World Model prompt 与两条 API 路径。
- `ui/app.js`, `ui/settings.js`, `storage/schema.js`, `storage/store.js` — profile assignment、可编辑 prompt 设置、存储边界。
- `tests/world-model.test.js`, `tests/api-profile.test.js` — 已失败的消息契约和 secret/API stub 回归。
- `.trellis/tasks/09-07-world-model-v1/prd.md`, `design.md`, `implement.md` — 本轮需求、冻结边界、实现步骤。
- `.trellis/spec/frontend/state-management.md` — host API、Secret Store、Chat-local 与测试 contract。
- `research/st-sevendayscal-api-settings.md` — ST-SevenDaysCal 固定提交的 API/message/settings/style 证据。
- `research/anima-memory-system-prompts-and-text.md` — Anima 固定提交的普通文本、提示块和可编辑内容证据。

## Code patterns

- Failing message contract: `tests/world-model.test.js:64-113`。
- Current one-system implementation: `ai/analyzer.js:197-205`、`ai/prompts.js:54-73`。
- Inert resolver: `ui/app.js:396-402` 对比 `ai/analyzer.js:186-205`。
- Safe host boundary: `ai/client.js:188-222,273-282`。
- Existing editable setting normalization/storage: `storage/schema.js:19-50,304-314`、`storage/store.js:377-385`。
- Failure-safe Chat replacement: `ui/app.js:1182-1227`。

## External references

- ST-SevenDaysCal v3.6.8 fixed commit: [api/client.js](https://github.com/atonal519/ST-SevenDaysCal/blob/8ef6e3cc58fd71bdf16bcc3016502b3fae594c2a/api/client.js#L185-L229), [index.js buildMessages](https://github.com/atonal519/ST-SevenDaysCal/blob/8ef6e3cc58fd71bdf16bcc3016502b3fae594c2a/index.js#L5789-L5849), [settings UI](https://github.com/atonal519/ST-SevenDaysCal/blob/8ef6e3cc58fd71bdf16bcc3016502b3fae594c2a/index.js#L3116-L3145)。
- Anima-Memory-System 3.3.6 fixed commit: [api.js](https://github.com/Ellinav/Anima-Memory-System/blob/d92dfc4dc741386962091ac149a7ed4b4b04e95d/scripts/api.js#L1448-L1506), [summary_logic.js](https://github.com/Ellinav/Anima-Memory-System/blob/d92dfc4dc741386962091ac149a7ed4b4b04e95d/scripts/summary_logic.js#L273-L377), [status_logic.js](https://github.com/Ellinav/Anima-Memory-System/blob/d92dfc4dc741386962091ac149a7ed4b4b04e95d/scripts/status_logic.js#L506-L654)。

## Related specs

- `design.md:5-16,53-61`：World Model 只复用 AnalysisInput 和已有 API boundary，冻结 Secret/来源读取与其他业务层。
- `state-management.md:297-301,349-378`：独立/current API contract、opaque/sentinel secret、请求捕获测试和安全错误要求。
- `prd.md:9-27`：只分析 World Model、失败保留、Chat-local metadata、无 Secret/正文持久化、测试必须通过。

## Caveats / Not Found

- “400 的唯一根因”目前不可证实：仓库没有记录实际 upstream response body，且 `ChatCompletionService` 会在宿主内部继续组装请求；本文把 system-only 与测试契约不一致列为最高优先级风险，但不宣称它单独必然触发 400。
- 外部仓库按固定 commit 阅读；它们的 Key 存储、proxy endpoint 和业务提示块不属于 BioWeave 可直接采用的合同。
- 本研究没有修改生产代码、spec、workflow 或外部仓库；只写入本任务 `research/` 目录。

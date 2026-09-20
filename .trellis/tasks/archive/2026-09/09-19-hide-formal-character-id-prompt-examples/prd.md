# 移除空 Registry Prompt 的正式 ID 诱导

## 目标

修复真实 SillyTavern 验收中，空 Character Registry 下模型仍输出
`existing + char_000001/char_000002` 的 Prompt 诱导问题。生产 Event Analysis
Prompt 不应向模型暴露正式 character ID 的格式、起始序号或占位示例；Runtime
仍保持现有 fail-closed 身份权威。

## 已确认事实

- `ai/prompts.js` 的通用 Event identity contract 当前仍包含
  `char_000001`、`char_999999` 形式示例。
- 空 Registry 的 `Initial Registry Bootstrap` 当前仍包含
  `char_000001`、`char_000000`、`char_XXXXXX` 及“从 char_000001 开始”等文本。
- 非空 Registry 的 Prompt 会渲染 Runtime 实际提供的 canonical candidate ID；这些真实候选必须继续保留。
- Runtime 已拒绝空 Registry 下伪造的 existing ID；本轮不修改该 authority，也不增加 existing → new 自动转换。
- 已有测试覆盖空 Registry Runtime 拒绝 placeholder/name-shaped existing，以及非空 Registry 的真实 candidate 渲染；本轮补充 `char_000001/char_000002` 伪造 ID 回归和空 Prompt 不暴露正式 ID 示例的断言。

## 范围内要求

1. 空 Registry Bootstrap 只表达：没有合法 existing participant；新/未解析人物使用 `identity_status=new` 或 `unresolved`、`character_id=null`、response-local 无语义 `mention_N`；Runtime 在响应后分配正式 ID；模型不需要知道、预测或输出正式 ID。
2. 移除 Event Analysis 所有生产 Prompt 中的通用正式 ID 格式示例、起始序号、上限示例和伪造 ID 示例；`character_id` 字段名和 null contract 保留。
3. 非空 Registry 仍展示输入中实际存在的 canonical ID，并要求 existing 原样复制该 ID。
4. 保持 `mention_id` 为 response-local 临时 token；不使用姓名、alias、拼音、canonical ID 或角色称谓。
5. 不修改 Runtime、schema、parser、sequential allocator、response-global mention map、pregnancy remap、Floor lifecycle、UI、CSS、World Model 或 identity authority。
6. 不实现旧 ID 兼容、迁移、随机 fallback 或 existing → new 自动修复。

## 验收标准

- 空 Registry 生成的完整 Event Analysis Prompt 不包含 `char_000001`、`char_000000`、`char_XXXXXX`、`char_999999` 或正式 ID 起始序号说明。
- 空 Registry Prompt 明确要求 new participant 使用 `character_id:null` 和 `mention_N`，并说明 AI 不需知道、预测或输出正式 character ID。
- 非空 Registry Prompt 仍包含实际输入的 `char_000001` 等 candidate，并要求 existing 复制输入 ID、`mention_id=null`。
- Runtime 对空 Registry 下模型伪造 `char_000001` 或 `char_000002` 的 existing response 仍 fail closed，且不注册为 new。
- 同一 response 的 response-global mention map、顺序注册和其它身份行为测试保持通过。
- 通过 `npm test`、`npm run check`、本轮修改 JS 的 `node --check` 和 `git diff --check`。
- 不执行 push；只创建本地提交。

## 范围外

- 不降低 Runtime identity validation。
- 不修改 Event DTO/schema 或 parser。
- 不改 allocator 的正式 `char_000001`…`char_999999` 实现。
- 不执行真实 SillyTavern 主机验收声明；若本轮环境未重新连接宿主，报告为未执行。

## 待实现文件

- `ai/prompts.js`
- `tests/event-analysis.test.js`
- `tests/character-identity.test.js`
- `.trellis/spec/domain/event-pipeline.md`

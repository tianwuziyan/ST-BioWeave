# 修复空 Character Registry 的 Event Prompt 引导

## Goal

修复首次 Event Analysis 只有空 Character Registry 时的 Prompt bootstrap
契约，使模型明确知道当前没有任何合法 existing participant，并按 raw
identity Contract 返回 `new + character_id:null + response-local mention_id`。
Runtime 继续是唯一的 canonical identity authority，现有 fail-closed 行为不变。

## Confirmed Audit Facts

- `ai/input-builder.js:869-979` 会把缺失的 `character_registry` 归一化为
  `{schema_version: 1, entities: {}}`，空 Registry 数据边界正确。
- `ai/prompts.js:415-456` 的 `formatEventCharacterRegistry()` 当前在空 Registry
  只输出“当前没有已登记的 canonical identity candidate”，没有把空 Registry
  定义为 Initial Registry Bootstrap，也没有明确禁止 `existing`、`char_000000`
  或姓名型 `mention_id`。
- `ai/prompts.js:43-44,86` 已有 existing/new 的基础规则，但
  `mention_id` 尚未明确要求无业务语义的 `mention_N` 临时 token，也未明确
  existing 的 `mention_id` 必须为 `null`。
- `runtime/event-analysis.js:1391-1508,1517-1537` 只把已选出的 previous
  Registry 传给 API，并由 Runtime 调用 identity resolution；本轮不需要修改。
- `core/identity.js:1086-1275,1483-1665,1713-1865` 已具备顺序注册、response-global
  mention map、pregnancy reference remap、atomic rollback 和 unknown existing
  fail-closed；本轮不重构。
- `ai/analyzer.js:1508-1555` 对缺失 `identity_status` 保留既有默认 existing
  行为，但真实故障是模型显式返回 invalid existing ID；该 parser/schema
  兼容行为不属于本轮 Prompt bootstrap 最小修复。

## Requirements

### R1. Empty Registry Bootstrap Prompt

当 `character_registry.entities` 为空时，Runtime Canonical Character Registry
区块必须明确说明：

- 当前没有任何 canonical identity candidate；
- 本次响应不存在合法的 `identity_status=existing` participant；
- 当前楼层出现的此前未登记人物必须使用
  `identity_status=new`、`character_id=null`、`mention_id=mention_N`；
- Runtime 会在响应返回后分配正式 `char_000001` 起始 ID。

### R2. Forbidden Model-Owned IDs

空 Registry bootstrap 文案必须明确禁止模型输出 `char_000000`、自行生成任意
`char_XXXXXX`、姓名/拼音/slug/hash 等作为 `character_id`。new/unresolved 即使
模型知道合法格式，也必须返回 `character_id:null`。

### R3. Mention Contract

new/unresolved 的 `mention_id` 必须是当前完整 response 内唯一、无业务语义的
临时 handle，推荐 `mention_1`、`mention_2`；不得使用人物姓名、display_name、
alias、拼音、canonical ID 或角色称谓。existing 的 `mention_id` 必须为 `null`。

### R4. Non-empty Registry Preservation

非空 Registry 仍展示 Runtime 提供的 canonical candidate；existing 必须原样复制
Registry ID，new/unresolved 仍返回 `character_id:null + mention_N`。既有唯一 exact
display/alias fallback、response-global mention map、pregnancy reference remap 和
Runtime authority 不得改变。

### R5. Regression Coverage

补充 Prompt regression，覆盖空/非空 Registry 的 bootstrap、ID/mention 契约，并
补充明确的空 Registry `char_000000` fail-closed identity regression。复用现有
Runtime、global mention、pregnancy、provisional ID 测试，不重写既有架构测试。

## Out of Scope

- 不修改 `core/identity.js`、`runtime/event-analysis.js` 的身份 authority、allocator、
  Floor Snapshot lifecycle、MESSAGE_DELETED 路由或 response-global map 实现。
- 不修改 Event/Character Registry schema、`ai/analyzer.js` parser 兼容默认、World
  Model、Projection、Genealogy、UI 或 CSS。
- 不增加 existing → new 自动转换、姓名 permissive fallback、旧 ID 兼容、counter、
  migration、tombstone 或 Registry database。
- 不执行真实 SillyTavern acceptance，除非当前环境确认加载本地 checkout。

## Acceptance Criteria

- [x] 空 Registry Prompt 明确表达 Initial Registry Bootstrap，且禁止合法
      existing participant。
- [x] Prompt 明确要求 new/unresolved 使用 `character_id:null` 和无语义
      `mention_1` 形式的 response-local handle。
- [x] Prompt 明确禁止 `char_000000`、姓名型 ID、姓名型 mention_id 和模型自造永久 ID。
- [x] 非空 Registry 仍展示 `char_000001` 等 canonical candidate，并要求 existing
      `mention_id:null`。
- [x] 空 Registry + 正确 new 响应仍由现有 Runtime 生成 `char_000001` 起始序列。
- [x] 空 Registry + `existing/char_000000`、姓名型 existing 仍 fail closed；没有
      existing → new 自动转换。
- [x] response-global mention map、跨 Event pregnancy reference canonicalization
      和 atomic rollback 的现有测试继续通过。
- [x] 只修改本任务必要文件，`ui/`、`style.css` 和 unrelated dirty work 保持不变。
- [x] `npm test`、`npm run check`、本轮 JS `node --check`、`git diff --check` 全部通过。

## Open Questions

无。用户已确定本轮为 Prompt bootstrap 最小修复，Runtime identity authority 保持不变。

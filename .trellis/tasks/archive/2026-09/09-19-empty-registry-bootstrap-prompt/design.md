# 技术设计：空 Character Registry Prompt Bootstrap

## 1. 边界与数据流

```text
Floor/Swipe previous snapshot
  -> runtime/event-analysis.js 选择 previous character_registry
  -> ai/input-builder.js 归一化空/非空 Registry
  -> ai/prompts.js 渲染 Runtime Canonical Character Registry
  -> AI raw Event DTO
  -> 现有 core/identity.js response-global resolution
  -> canonical Event / Floor snapshot
```

本轮只修复 `ai/prompts.js` 的模型指导边界与回归断言。上一层 Registry
选择、下一层 Runtime resolution、最终 storage owner 均不变。

## 2. 现状根因

当前空 Registry 的 formatter 仍沿用非空 Registry 的通用说明，然后追加一行
“没有已登记 candidate”。这能表达“列表为空”，但没有把空列表解释为身份决策
边界：模型仍可能把 `existing` 当作默认状态、把 placeholder `char_000000`
当作 ID，或把人物姓名填入 `mention_id`。因此模型响应会在 Runtime 正确拒绝前
产生错误 identity tuple。

现有 Runtime 已验证：

- empty Registry 的 new participant 会从 `char_000001` 顺序注册；
- new 携带非 null `character_id` 返回 `PROVISIONAL_ID_NOT_ALLOWED`；
- unknown existing 只允许 unique exact display/alias fallback，0/多候选 fail closed；
- 一个完整 response 共享 mention map，pregnancy references 最终转换为 canonical ID；
- 任一 identity 失败时 working Registry 不提交。

## 3. 最小实现方案

### 3.1 Registry formatter

在现有 `formatEventCharacterRegistry()` 内根据 `blocks.length` 分出两种文案：

- 非空：保留现有 canonical candidate block，并补充 existing 的
  `mention_id:null` 与 new/unresolved 的 `mention_N`、`character_id:null` 说明。
- 空：输出 Initial Registry Bootstrap 专属说明，明确 0 candidate 意味着没有
 任何合法 existing；新/未解析人物的 raw DTO 形状、临时 token 规则、Runtime
 负责分配正式 ID，以及 `char_000000`/模型自造 ID/语义型 mention 的禁止项。

生产文案使用抽象格式示例 `mention_1` 与 `<当前人物显示名>`，不写具体人物名。

### 3.2 核心与输出契约同步

仅在 `EVENT_ANALYZER_CORE_CONTRACT` 与
`EVENT_ANALYZER_OUTPUT_CONTRACT` 做小幅措辞同步：

- 区分 raw AI response 的 provisional `character_id:null` 与 Runtime 完成后的
  canonical Event；
- 将 mention 定义为 response-local、无业务语义、唯一临时 handle；
- existing 的 mention_id 固定为 null。

不改变 DTO shape、parser、validator 或 schema。

### 3.3 测试策略

- `tests/event-analysis.test.js`：用空 Registry 生成 Prompt，断言 bootstrap、
  no-existing、new/null、`mention_1`、禁用 `char_000000`/姓名型 mention；用非空
  Registry 断言 candidate、existing/null、new/null/mention 规则仍在。
- `tests/character-identity.test.js`：增加空 Registry 显式
  `existing + char_000000` fail-closed 回归，并覆盖空 Registry 多 new 仍按顺序
  生成 canonical IDs（如现有覆盖不足）。
- 现有 response-global mention、pregnancy remap、provisional ID、unique exact
  fallback 和 Runtime empty bootstrap 测试保持原样运行。

## 4. 明确不采用的方案

- 不在 Runtime 中把空 Registry 的 `existing` 改写为 `new`。
- 不把 `char_000000`、姓名或任何模型字符串交给 allocator。
- 不在 parser/schema 中增加 permissive normalization 来“修复”模型输出。
- 不新增 Character Registry manager、counter、migration、legacy layer 或持久化表。

## 5. 风险与回滚

风险仅限模型 Prompt 文案变化可能改变 raw identity 输出；canonical Runtime
validation 仍是最后防线。若 Prompt 回归或全量测试发现非目标行为，回滚范围只需
撤销 `ai/prompts.js` 与本轮测试/规范变更，不涉及 Floor 数据或用户数据迁移。

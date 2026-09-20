# 空 Character Registry Prompt Bootstrap 审计记录

## 当前链路

`runtime/event-analysis.js` 先查找 target Floor 之前最近的合法 successful
Floor Snapshot，再把其中的 `character_registry` 传给
`ai/input-builder.js`。`normalizeEventAnalysisInput()` 缺省使用
`{schema_version: 1, entities: {}}`。`ai/prompts.js` 的
`buildEventAnalysisMessages()` 通过 `formatEventCharacterRegistry()` 渲染
Runtime Canonical Character Registry。

## 当前空 Registry 输出

当前 formatter 输出：

```text
【Runtime Canonical Character Registry】
以下是 Runtime 已登记的 canonical identity candidates……首次出现的新人物使用
identity_status=new、character_id=null 和本次响应内唯一的 mention_id。
当前没有已登记的 canonical identity candidate。
```

缺失点：没有明确把空 Registry定义为 Initial Registry Bootstrap；没有明说
本次不存在合法 `existing` participant；没有禁止 `char_000000`、模型自造
`char_XXXXXX`、姓名型 `character_id` 或姓名型 `mention_id`；没有把
`mention_N` 定义为无业务语义 temporary handle；也没有在 formatter 文案中
明确 existing 的 `mention_id` 必须为 `null`。

## 已确认无需修改的路径

- Runtime 的顺序 allocator 从空 Registry 生成 `char_000001`，并且不会读取姓名、
  UUID、随机值或独立 counter。
- `new` 携带非 null `character_id` 会被 `PROVISIONAL_ID_NOT_ALLOWED` 拒绝。
- 空 Registry 中显式 `existing + char_000000` 或姓名型 ID 无 membership，且无
  unique exact candidate 时继续 fail closed；不会自动转为 new。
- 一个完整 AI response 使用同一 response-global mention map，跨 Event 的
  `gestational_subject_ids[]` / `counterpart_ids[]` 会最终 remap 为 canonical ID。
- identity resolution 失败会丢弃 working Registry 与新 Events，不污染原 Floor。

## 相关冲突审计

`ai/analyzer.js` 对缺失 `identity_status` 保留既有 `existing` 默认。这是 parser
兼容行为，不是本次宿主输出的直接原因；本轮用户明确要求 Prompt bootstrap
最小修复、保持 Runtime authority、不要改 schema/其它系统，因此不在本任务内
修改。Prompt 会要求模型显式返回 `identity_status`，测试保留 Runtime 对显式
invalid existing 的 fail-closed 回归。

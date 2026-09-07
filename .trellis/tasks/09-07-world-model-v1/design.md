# World Model v1 技术设计

## 1. 变更边界

复用 `ai/input-builder.js` 的临时 AnalysisInput、`ai/client.js` 的请求边界、`storage/store.js` 的 Chat-local 保存和现有 `ui/app.js` 的设置/预览状态。World Model 不读取宿主私有 Store，不写入 Floor，不接入 Context。

预期修改文件：

- `ai/prompts.js`：增加最小 World Analysis Prompt 和固定输出 schema 文本。
- `ai/analyzer.js`：增加 World Model 响应提取、JSON 解析、schema 规范化和校验；保留现有分析器入口。
- `storage/schema.js`：让空 Chat 带有 World Model 元数据槽位，并提供轻量规范化默认值。
- `ui/world.js`：实现查看、编辑、重新分析、保存和临时输入预览的页面渲染。
- `ui/app.js`：加载/保存 Chat-local World Model，复用 AnalysisInput 收集流程，接入 World Analysis 任务分配和页面事件。
- `tests/worldbook.test.js` 或独立 World Model 测试：覆盖 schema、解析、失败保留、来源摘要和中文 UI。

不修改：已验收的来源选择和预览语义、API/Secret 存储、入口宿主、主题基础、Event/Floor/State/Snapshot/Projection/Genealogy/Context。

## 2. World Model schema

```json
{
  "schema_version": 1,
  "biological_types": [
    {
      "name": null,
      "description": null,
      "sex_categories": [
        {
          "name": null,
          "description": null,
          "capabilities": {
            "can_produce_sperm": null,
            "can_produce_ova": null,
            "can_be_fertilized": null,
            "can_fertilize": null,
            "can_carry_pregnancy": null
          },
          "reproduction_rules": {
            "fertilization": null,
            "pregnancy_or_carrying": null,
            "cycle": null
          }
        }
      ],
      "lifecycle": {
        "maturation": null,
        "aging": null
      },
      "special_rules": []
    }
  ],
  "exceptions": [],
  "unknowns": []
}
```

`null` 表示当前输入没有足够证据；`unknown` 不作为持久化标量值。规范化器只生成上述字段，AI 多余字段不会进入保存结果。

## 3. 保存边界

`chat_metadata.bioweave.world_model` 只保存规范化模型；`world_model_meta` 只保存 `last_analyzed_at`、`last_saved_at`、`last_saved_by` 和来源数量/token 摘要，不保存 AnalysisInput 正文。重新分析先完整收集输入，只有请求、解析和 schema 校验全部成功后才一次性替换模型；失败保留旧模型。

手动保存使用同一规范化器，保留原分析时间，更新 `last_saved_by=manual`。临时输入预览复用现有 `analysisPreviewState` 和收集函数。

## 4. Prompt 与任务分配

World Analysis 请求拆成四条普通 chat message：第一条 `system` 保留固定约束和字段契约，第二条 `system` 放带固定中文标记的用户人物设定、角色卡、世界书和外部记忆资料，`assistant` 放带 Floor 标记的最近楼层，最后的 `user` 只发起本次分析任务。用户人物设定按 SillyTavern 公开上下文中的 `powerUserSettings.persona_name` 与 `powerUserSettings.persona_description` 临时构造为 `AnalysisInput.persona`，不进入 Chat 摘要；角色卡/资料正文中的 `{{user}}`、`<user>`、`{{char}}`、`<char>` 在临时请求前按当前上下文名称替换；世界书请求正文不带 `source_id`、`name`、`entry_id` 或 `token_estimate` 元字段。发送内容不使用 JSON 代码围栏或完整 schema 代码块；响应仍由本地解析器按固定 schema 校验。设置层提供 `world_analysis_prompt`，只允许用户编辑任务补充、输入前后说明和分段标签，核心约束与校验不受覆盖。调试预览使用原生 `details/summary`，四段消息可以独立折叠。

Profile 解析遵循 `world_analysis` assignment：明确独立 Profile 使用该 Profile；当前 API 使用 SillyTavern 当前 API；跟随默认时按全局默认 API 来源解析；未配置则显示中文错误。可编辑提示只保存到插件级扩展设置，不进入 Chat metadata，也不携带 Secret。

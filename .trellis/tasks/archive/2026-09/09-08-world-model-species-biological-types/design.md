# World Model species biological types hierarchy correction 技术设计

## 1. 设计边界

只修正 World Model 的数据合同和它的 Prompt、校验、中文查看/编辑展示。继续复用现有 `AnalysisInput` 收集、`buildWorldModelMessages` 四段消息、`createAnalyzer`、Chat-local `world_model` 保存和现有任务 assignment；不进入 Event、State、Snapshot、Projection、Context 或新的服务层。

预期修改文件：

- `storage/schema.js`：把固定 schema 模板从顶层 `biological_types` 改为 `species[].biological_types[]`。
- `ai/prompts.js`：更新固定中文约束和输出字段合同，说明 species 优先、开放 biological type、默认人类与 capability 归属。
- `ai/analyzer.js`：规范化/严格校验嵌套 species；把现有仅用于分析响应的双性/间性证据过滤改为嵌套处理；不安全的旧扁平结构不自动迁移。
- `ui/world.js`：按 species → biological type 渲染查看和编辑表单，提供对应中文层级文案及增删动作。
- `ui/app.js`：读取/创建/增删/保存嵌套表单数据，保持已有异步 Chat token 和保存流程。
- `tests/world-model.test.js`：重写 flat fixture 为嵌套 fixture，增加层级、开放分类、默认/非人类和中文 UI 回归。
- `docs/UI.md`、`docs/DATA-MODEL.md`：同步对用户可见的 World Model 数据关系说明，避免文档继续描述顶层 biological types。

不修改：`ai/input-builder.js`、`ai/client.js`、来源选择器、API/Secret 存储、任务分配、World Model 之外的页面和业务数据。

## 2. 数据合同

保留 `schema_version: 1`，仅修正 v1 内部层级，避免把本轮轻量结构变更扩散成版本迁移：

```json
{
  "schema_version": 1,
  "species": [
    {
      "name": null,
      "description": null,
      "biological_types": [
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
            "cycle": null,
            "ovulation": null,
            "gestation": null,
            "labor": null
          },
          "lifecycle": {"maturation": null, "aging": null},
          "special_rules": []
        }
      ]
    }
  ],
  "medical_context": {
    "childbirth_difficulty": null,
    "care_level": null,
    "evidence": null
  },
  "exceptions": [],
  "unknowns": []
}
```

`species` 和每个 `biological_types` 都是资料驱动的数组，没有名称枚举。species 只承载自身名称/说明及其 biological types；capability、reproduction rules、lifecycle 和 special rules 继续承载在 biological type。规范化器只复制已知字段，因此 raw 中的 species 级 capability、顶层 biological_types 和其它额外字段不会进入保存结果；严格解析要求 `species`、`exceptions`、`unknowns` 为数组，旧 flat 模型因没有可证明的 species 归属而返回 `WORLD_MODEL_INVALID`。

## 3. 分析与 Prompt 数据流

`AnalysisInput → buildWorldModelMessages → AI JSON → parseWorldModelResponse → normalizeWorldModel → Chat-local save/UI` 保持不变，只替换 JSON 合同：

1. 固定 Prompt 先要求识别 species，再在每个 species 下列出本次资料实际出现/明确描述的 biological types。
2. 固定 Prompt 明确两步识别不可合并：常规人类性别/身体/生殖证据且没有非人类证据时使用“人类”作为默认 species，但识别出人类本身不创建任何 biological type；只有输入实际出现或规则明确描述存在的类型才能加入。明确非人类证据优先并各自建立 species；类型名开放，支持 ABO 等资料分类。
3. capability 规则明确放在 `species[].biological_types[].capabilities`，每项依据证据或适用的既定人类基线逐项填 `true` / `false` / `null`；species 或 biological type 名称本身不触发能力补全，species 本身不做能力汇总。
4. 保留当前字符串中文化、unknown/null 规范化、医疗/例外/unknowns 和失败保留。
5. 当前的防止 AI 凭空新增双性/间性逻辑只作为响应安全过滤适配到每个 species 的 biological types，并删除没有剩余 type 的空 species；它不构成 biological type 枚举，Alpha/Beta/Omega 等其它分类照常通过 schema。

## 4. UI 数据流

查看页从 `model.species` 逐个渲染 species card，再从 `species.biological_types` 渲染嵌套 type card。编辑页使用 `data-bioweave-world-species` 包含 `data-bioweave-world-type` 的结构；`ui/app.js` 在表单边界一次性解码成嵌套 raw model，然后交给同一 `normalizeWorldModel`。增删动作只更新当前 draft，不新增全局状态或后端计算。

## 5. 兼容性与回滚

- 新结果和手动编辑只保存新嵌套合同。
- 旧 flat `biological_types` 不做猜测性迁移；加载时显示已有“格式无效，请重新分析”提示，用户用当前 `AnalysisInput` 重新生成即可。
- 本轮修改集中在 World Model 代码和测试；若验证失败，回滚本任务文件即可，不触及来源、API 或其它模块。

## 6. 重要取舍

- 不将 species 级 description/capability 设计成复杂共享规则；species 只提供轻量名称和说明，避免把不同 biological types 的能力合并。
- 不用名称枚举或多维矩阵校验 biological type；资料是否出现由 Prompt 与输入证据约束，schema 只负责形状和类型安全。
- 保持 schema version 为 1，避免引入一次只为层级调整服务的迁移分支；无法安全解释的旧结果直接要求重新分析。

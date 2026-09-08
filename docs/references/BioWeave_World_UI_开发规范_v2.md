# BioWeave 世界模型 UI 重构开发规范 v2

> 配套参考图：`BioWeave_World_UI_reference_v2.png`
>
> 本文档只针对 **World Model / 世界模型页面的 UI 与编辑交互**。
> 已验收的 World Model 数据结构、AnalysisInput、Prompt、Analyzer、API、Chat 保存机制等业务基础保持不变，除实现本 UI 所必需的轻量适配外，不允许借机重构。

---

## 1. 本轮核心修正

v1 的问题是把“编辑”理解成了整个世界模型的全局编辑入口。

**v2 明确取消“整个页面进入编辑模式”的设计。**

用户需要的是：

- 每个小模块独立查看；
- 每个小模块独立点击“编辑”；
- 只编辑当前模块；
- 当前模块独立“保存 / 取消”；
- 不影响页面其他模块；
- 不要求用户面对完整 JSON；
- 不因为修改一个字段而进入整个 World Model 的大表单。

例如当前选择：

`人类 → 女性`

页面中的以下模块分别拥有自己的编辑入口：

1. 生殖能力
2. 生殖规则
3. 生命周期
4. 特殊规则
5. 医疗与照护
6. 特殊例外
7. 尚未确定

这些模块之间的编辑状态互相独立。

---

## 2. 设计目标

World Model 页面采用：

`物种概览 → 生物类型 → 当前类型详情 → 世界级规则`

的信息层级。

目标是解决当前页面：

- 内容纵向堆叠过长；
- 一个物种下多个 biological type 连续展开；
- 信息层级不清；
- true / false / null 阅读成本高；
- 世界级信息与物种级信息混在一起；
- 编辑范围过大；
- 手机和平板难以浏览。

新页面必须保持轻量。

不要引入：

- React / Vue 等新框架；
- UI component library；
- 状态管理框架；
- JSON Editor 大型依赖；
- 为 UI 创建大量 Factory / Service / Repository；
- 新的全局编辑状态系统。

优先继续使用现有：

- 原生 JS；
- HTML；
- CSS；
- 当前 `ui/app.js`；
- 当前 World Model 数据。

---

# 3. 页面顶层

页面标题：

`世界模型`

副标题：

`探索并管理当前聊天的世界观设定与生物规则`

顶部状态区显示：

- 最后分析时间；
- 数据来源摘要；
- 当前 World Model 状态。

操作保留：

- `重新分析`
- `查看本次输入`
- 更多菜单（仅确有已有功能时使用）

## 重要

**顶部不再提供“编辑整个世界模型”的按钮。**

World Model 的编辑操作全部下沉到具体模块。

---

# 4. 物种与生物类型

顶部首先展示：

`物种与生物类型`

每个 species 使用轻量物种卡。

示例：

```text
┌────────────────────────┐
│ 人类                   │
│ 灵欲界主要种族……       │
│                        │
│ [男性] [女性] [双性]   │
└────────────────────────┘
```

其他物种：

```text
妖
[男性] [女性]

剑灵
[男性] [女性]

魔
尚未识别出生物类型
```

## 4.1 biological_types 必须完全动态

禁止写死：

- 男性
- 女性
- 双性

未来可能出现：

- Alpha
- Beta
- Omega
- 无性
- 特殊世界自定义分类

UI 必须直接根据：

```js
species[].biological_types[]
```

生成。

---

# 5. 当前生物类型

用户点击：

`人类 → 女性`

后，只显示：

`人类 / 女性`

这一套详情。

不要同时展开：

- 人类男性详情
- 人类女性详情
- 人类双性详情

这样可以显著降低页面高度。

类型切换只更新详情区域，不重新加载整个 World 页面。

---

# 6. 模块化编辑原则

这是 v2 最重要的交互要求。

每个可编辑模块标题右侧显示自己的：

`编辑`

按钮。

例如：

```text
┌──────────────────────────────┐
│ 生殖能力              [编辑] │
├──────────────────────────────┤
│ 可产生精子              否   │
│ 可产生卵子              是   │
│ 可使其受精              否   │
│ 可被受精                是   │
│ 可承担妊娠              是   │
└──────────────────────────────┘
```

点击该模块的 `编辑` 后：

```text
┌──────────────────────────────┐
│ 生殖能力                     │
├──────────────────────────────┤
│ 可产生精子      [否 ▼]       │
│ 可产生卵子      [是 ▼]       │
│ 可使其受精      [否 ▼]       │
│ 可被受精        [是 ▼]       │
│ 可承担妊娠      [是 ▼]       │
│                              │
│              [取消] [保存]   │
└──────────────────────────────┘
```

保存成功后立即恢复只读模式。

---

# 7. 模块编辑状态

推荐只维护轻量状态，例如：

```js
editingSection = null;
```

或者如果现有架构更适合：

```js
editingSections = new Set();
```

但默认推荐 **同一时间只编辑一个模块**。

理由：

- 实现简单；
- 手机端更稳定；
- 避免多个 draft 同时存在；
- 降低保存冲突；
- 更符合轻量插件定位。

点击另一个模块的编辑按钮时：

- 如果当前模块没有改动，可以直接切换；
- 如果当前模块存在未保存改动，应提示：
  `当前修改尚未保存，是否放弃？`

不要静默丢失编辑内容。

---

# 8. 生殖能力模块

内部字段仍使用：

```text
can_produce_sperm
can_produce_ova
can_be_fertilized
can_fertilize
can_carry_pregnancy
```

UI 中文映射：

| 内部字段 | UI |
|---|---|
| can_produce_sperm | 可产生精子 |
| can_produce_ova | 可产生卵子 |
| can_be_fertilized | 可被受精 |
| can_fertilize | 可使其受精 |
| can_carry_pregnancy | 可承担妊娠 |

显示：

```text
true  → 是
false → 否
null  → 未知
```

编辑时使用轻量三态 select：

```text
是
否
未知
```

禁止把：

```text
true
false
null
unknown
undefined
N/A
```

直接显示给用户。

---

# 9. 生殖规则模块

模块标题：

`生殖规则`

独立 `编辑`。

字段映射：

| Schema | 中文 |
|---|---|
| fertilization | 受精方式 |
| pregnancy_or_carrying | 妊娠方式 |
| cycle | 生理周期 |
| ovulation | 排卵机制 |
| gestation | 妊娠周期 |
| labor | 分娩方式 |

查看模式使用紧凑 key/value。

编辑模式允许逐项文本修改。

空值显示：

`未知`

不要显示 null。

---

# 10. 生命周期模块

模块标题：

`生命周期`

独立 `编辑`。

字段：

```text
maturation → 成熟
aging      → 衰老
```

采用简洁双行布局。

---

# 11. 特殊规则模块

模块标题：

`特殊规则`

独立 `编辑`。

查看模式：

```text
• 规则 A
• 规则 B
• 规则 C
```

编辑模式必须支持：

- 修改已有规则；
- 删除单条规则；
- 添加规则。

但不要引入复杂 sortable editor。

v1 只需：

```text
[文本输入] [删除]
[文本输入] [删除]

+ 添加规则

[取消] [保存]
```

即可。

---

# 12. 世界级规则

右侧或详情区域下方显示：

`世界级规则`

包括：

1. 医疗与照护
2. 特殊例外
3. 尚未确定

这些不是当前 biological type 的字段，因此不要塞进“人类 / 女性”的编辑表单。

---

# 13. 医疗与照护

独立卡片：

```text
医疗与照护                         [编辑]

分娩难度      较低
照护水平      极高
判断依据      ……
```

编辑按钮只编辑：

```text
medical_context
```

不要同时编辑 exceptions / unknowns。

---

# 14. 特殊例外

独立卡片：

```text
特殊例外                           [编辑]

• 炉鼎体质……
• 金丹期身体改造……
• 假孕……
```

编辑只针对：

```text
exceptions[]
```

支持：

- 修改；
- 删除；
- 新增。

---

# 15. 尚未确定

独立卡片：

```text
尚未确定                           [编辑]

• 剑灵是否……
• 魔族……
```

编辑只针对：

```text
unknowns[]
```

虽然通常来自 AI，但用户仍可以：

- 修正；
- 删除已确认的问题；
- 添加人工记录的未知项。

---

# 16. species / biological type 本身的编辑

本轮不要做一个“编辑整个 species”的大页面。

如果当前已有必要的名称/描述人工修正需求，可以提供轻量入口：

```text
人类 / 女性               [编辑基本信息]
```

只允许修改：

- 当前 species description；
- 当前 biological type name；
- 当前 biological type description。

不要通过这个入口修改：

- capabilities；
- reproduction_rules；
- lifecycle；
- special_rules。

它们仍由自己的模块编辑。

如果当前项目还没有这项需求，可以暂不实现，避免扩大本轮范围。

---

# 17. 保存策略

每次模块保存：

1. 基于当前 World Model 创建 draft；
2. 只修改当前 section；
3. 执行现有 World Model schema / normalize / validation；
4. 验证成功；
5. 保存到当前 Chat；
6. 更新当前页面；
7. 退出该模块编辑状态。

如果保存失败：

- 不覆盖当前成功 World Model；
- 不清空输入；
- 保留编辑状态；
- 中文显示错误。

例如：

`保存失败，请检查当前内容后重试。`

---

# 18. AI 重新分析与人工编辑的关系

`重新分析` 仍然是整份 World Model 的 AI 重建操作。

这是和模块编辑不同的概念。

必须明确：

### 重新分析

```text
AnalysisInput
→ World Analysis
→ 新 World Model
→ 校验
→ 成功后替换
```

### 模块编辑

```text
现有 World Model
→ 用户修改一个 section
→ 校验
→ 保存
```

不要混淆。

重新分析失败：

- 保留原 World Model。

模块保存失败：

- 保留原 World Model；
- 保留用户 draft。

---

# 19. PC 布局

≥ 1200px：

```text
┌────────────────────────────────────────────────────────┐
│ 世界模型                   重新分析 | 查看本次输入      │
├────────────────────────────────────────────────────────┤
│ 物种与生物类型                                         │
│ [人类] [妖] [剑灵] [魔]                               │
├────────────────────────────────┬───────────────────────┤
│ 当前类型详情                   │ 世界级规则            │
│                                │                       │
│ 人类 / 女性                    │ 医疗与照护 [编辑]     │
│                                │                       │
│ 生殖能力 [编辑] 生殖规则[编辑] │ 特殊例外 [编辑]       │
│                                │                       │
│ 生命周期 [编辑] 特殊规则[编辑] │ 尚未确定 [编辑]       │
└────────────────────────────────┴───────────────────────┘
```

建议：

```text
详情 : 世界级规则 ≈ 2 : 1
```

---

# 20. iPad / Tablet

768–1199px：

顶部物种卡可以：

- 横向紧凑排列；
- 自动换行。

详情模块建议两列：

```text
生殖能力 | 生殖规则
生命周期 | 特殊规则
```

世界级规则放在其下方。

不要强制 PC 右侧栏导致内容过窄。

---

# 21. Mobile

< 768px：

全部单列。

建议：

```text
世界模型
重新分析 | 更多

[人类] [妖] [剑灵] [魔]

人类 / 女性
[切换类型]

生殖能力               [编辑]
生殖规则               [编辑]
生命周期               [编辑]
特殊规则               [编辑]

医疗与照护             [编辑]
特殊例外               [编辑]
尚未确定               [编辑]
```

模块进入编辑状态后仍在原位置编辑。

**不要打开新的全屏 JSON 编辑器。**

按钮点击区域建议至少约 40px 高，保证手机触控。

---

# 22. UI 中文要求

BioWeave 所有用户可见 UI 必须为中文。

包括：

- 标题；
- 导航；
- 编辑；
- 保存；
- 取消；
- 添加；
- 删除；
- 状态；
- 空状态；
- 加载状态；
- 错误；
- 字段名称；
- select；
- checkbox 说明。

内部变量、函数、schema key 继续使用英文。

生产代码新增或修改的注释继续使用中文。

---

# 23. 主题

继续兼容：

- 跟随酒馆；
- 日；
- 夜。

不要因为 World UI 重构再次重写整个主题系统。

本页使用现有 token。

必须保证：

- 日间模式文字清晰；
- 夜间模式层级明确；
- 不使用 text-shadow 制造文字模糊；
- 不滥用 backdrop-filter；
- 卡片边界清晰但不要过度描边；
- 编辑状态可识别，但不要大面积高饱和颜色。

---

# 24. 视觉层级

建议层级：

### Level 1

页面：

`世界模型`

### Level 2

`物种与生物类型`

`当前生物类型`

`世界级规则`

### Level 3

模块：

`生殖能力`

`生殖规则`

`生命周期`

`特殊规则`

`医疗与照护`

`特殊例外`

`尚未确定`

### Level 4

字段和值。

不要所有文字使用同一个字号/粗细。

---

# 25. 编辑按钮视觉

每个模块的编辑按钮应小而明确。

推荐：

```text
✎ 编辑
```

或现有 icon system + `编辑`。

不要只放没有文字含义的铅笔图标，尤其手机端。

编辑模式下：

```text
取消
保存
```

放在模块底部或标题区域，但所有模块保持一致。

---

# 26. 不允许的实现

禁止重新引入：

### 全局编辑

```text
[编辑整个世界模型]
```

然后一次性把所有字段变成 input。

### JSON 编辑

```text
<textarea>
{
  "species": ...
}
</textarea>
```

### 一个保存按钮保存所有模块

这会重新制造 v1 的问题。

---

# 27. 动态数据要求

页面不能假设：

```text
species.length === 4
```

也不能假设：

```text
biological_types = 男/女/双性
```

以下都必须正常：

```text
人类
  男性
```

```text
人类
  男性
  女性
```

```text
人类
  男性
  女性
  双性
```

```text
ABO物种
  Alpha
  Beta
  Omega
```

```text
魔
  biological_types: []
```

最后一种 UI：

`尚未识别出生物类型`

而不是报错。

---

# 28. 推荐实现边界

优先修改已有：

```text
ui/world.js
ui/app.js
style.css
tests/world-model.test.js
```

具体文件以当前仓库实际结构为准。

如果 World 页面目前没有独立 renderer，可以在现有 UI 文件中保持轻量函数拆分，例如：

```js
renderSpeciesSelector()
renderBiologicalTypeDetail()
renderCapabilitiesSection()
renderReproductionSection()
renderLifecycleSection()
renderSpecialRulesSection()
renderMedicalSection()
renderExceptionsSection()
renderUnknownsSection()
```

这是合理拆分。

不要因此创建：

```text
WorldModelController
WorldModelEditManager
WorldModelSectionFactory
WorldModelRepository
WorldModelViewModel
WorldModelEditService
```

BioWeave 必须保持轻量。

---

# 29. 测试

至少补充以下 UI / World Model 回归测试。

## 模块编辑隔离

点击：

`生殖能力 → 编辑`

只允许生殖能力进入编辑状态。

其他模块保持只读。

## 保存隔离

修改：

`can_carry_pregnancy`

保存后不得改变：

- reproduction_rules；
- lifecycle；
- special_rules；
- medical_context；
- exceptions；
- unknowns。

## 取消

编辑后点击取消：

原 World Model 不变。

## 保存失败

模拟保存失败：

- 原 World Model 不变；
- draft 不消失；
- 当前模块仍处于编辑状态。

## 动态 biological type

确保：

`双性`

如果存在于数据中一定显示。

不要用固定 male/female UI 过滤。

## null

所有 null UI 显示：

`未知`

## Responsive

至少验证：

- Desktop
- Tablet
- Mobile

---

# 30. 不修改的数据/业务层

本轮原则上不得修改：

- World Model Prompt；
- Analyzer；
- AnalysisInput；
- API Profile；
- Secret；
- Worldbook selector；
- 最近剧情；
- 外部记忆；
- Event；
- State；
- Snapshot；
- Projection；
- Genealogy；
- Context Injection。

如果 Codex 判断 UI 无法实现而必须修改 World Model schema：

**先停止，不要自行修改。**

说明原因，由用户确认。

---

# 31. 效果图解释

配套：

`BioWeave_World_UI_reference_v2.png`

是 **信息架构与视觉方向参考**，不是像素级实现要求。

必须参考：

- 物种卡；
- biological type 切换；
- 单类型详情；
- 模块卡片；
- 每个模块自己的编辑按钮；
- 世界级规则独立模块；
- PC / Tablet / Mobile 响应式方向。

可以根据 BioWeave 当前实际 DOM 和 SillyTavern 环境微调尺寸。

---

# 32. 本轮验收标准

完成后必须满足：

- [ ] 顶部不存在“编辑整个 World Model”的主编辑入口
- [ ] 生殖能力有自己的编辑按钮
- [ ] 生殖规则有自己的编辑按钮
- [ ] 生命周期有自己的编辑按钮
- [ ] 特殊规则有自己的编辑按钮
- [ ] 医疗与照护有自己的编辑按钮
- [ ] 特殊例外有自己的编辑按钮
- [ ] 尚未确定有自己的编辑按钮
- [ ] 编辑一个模块不会使其他模块进入编辑状态
- [ ] 保存只修改对应 section
- [ ] 取消不会修改 World Model
- [ ] 保存失败不覆盖旧成功数据
- [ ] species 动态生成
- [ ] biological type 动态生成
- [ ] 数据存在“双性”时 UI 必须显示“双性”
- [ ] biological_types 为空时正常显示空状态
- [ ] true / false / null 显示为 是 / 否 / 未知
- [ ] 所有用户可见文字为中文
- [ ] PC 正常
- [ ] iPad / Tablet 正常
- [ ] Mobile 正常
- [ ] 日 / 夜 / 跟随酒馆正常
- [ ] 不新增重型依赖
- [ ] 不建立多余架构层
- [ ] 不修改本轮范围外业务逻辑

---

# 33. 给 Codex 的执行要求

请先阅读：

1. 本文档；
2. `BioWeave_World_UI_reference_v2.png`；
3. 当前仓库 World Model / World UI 实现；
4. 当前测试；
5. 当前项目开发规范。

然后先输出：

1. 当前 World 页面结构审计；
2. v2 与现状差异；
3. 计划修改文件；
4. 是否需要新增文件；
5. 如何实现模块级 draft / save；
6. 如何保证保存隔离；
7. Desktop / Tablet / Mobile 实现方式；
8. 回归测试计划。

**先规划，不要立即大规模改代码。**

规划确认后再实现。

实现完成后停止在 World UI 验收点，不继续开发 Biological Event / State / Projection 等后续功能。

---

## 最终原则

World Model 页面不是数据库管理后台。

它应该让用户快速完成：

`看懂世界 → 选择物种 → 选择生物类型 → 查看一个规则模块 → 必要时只编辑这个模块`

而不是：

`打开整个世界模型 → 面对几十个字段 → 修改一个值 → 保存整页`

BioWeave 的定位仍然是：

**轻量、清晰、可扩展。**

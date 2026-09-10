# 技术设计

## 边界与最小改动

沿用现有轻量数据流，不增加 Factory、Registry、Service 或新的配置迁移层：

`DEFAULT_WORLD_ANALYSIS_PROMPT` → `normalizeWorldAnalysisPrompt()` → 全局设置存储/读取 → 设置页草稿 → `buildWorldModelMessages()` → Analyzer 与请求预览。

每个边界只扩展 `system_top` 和 `system_bottom` 两个字符串字段，既有字段与业务模块保持原样。

## 配置契约

- `DEFAULT_WORLD_ANALYSIS_PROMPT.system_top = ''`
- `DEFAULT_WORLD_ANALYSIS_PROMPT.system_bottom = ''`
- `DEFAULT_EXTENSION_SETTINGS.world_analysis_prompt` 显式包含两个默认字段。
- normalize 对两个字段调用现有 `promptText(value, '')`，因此获得统一的 trim、NUL 处理现状与 20,000 字符上限；缺失/非字符串值回落为空字符串。
- 不增加版本号或迁移代码。旧配置在读取时由 normalize 补全，已有 `task`、`input_prefix`、`input_suffix`、`labels` 继续逐字段保留。
- `saveWorldAnalysisPrompt(raw)` 先将当前已规范化配置与 `raw` 浅合并，再统一 normalize。这样部分保存只更新显式传入字段；显式传入空字符串仍可清空目标字段，缺失字段则保留已有用户值。

## UI 与状态流

- 在现有提示词设置卡内使用相同 `textArea()` helper 渲染两个控件。
- `ui/app.js#readWorldAnalysisPromptForm()` 从相同 data attribute 读取两个值，再一次性调用 normalize。
- `captureWorldAnalysisPromptDraft()`、`saveWorldAnalysisPrompt()`、重新渲染和 store round-trip 无需新增状态机制；对象字段会沿现有路径传递。
- 预览继续调用 `buildWorldModelMessages(input, promptSettings)`，不另写消息拼装逻辑，避免预览与请求漂移。

## 消息构建契约

在 `buildWorldModelMessages()` 内先用现有 `inputNames()` 获取名称，再对两个新增字段调用现有 `expandPlaceholders()`。分别构造可选数组项：

1. 非空 `system_top` 独立放在数组开头。
2. 四条既有消息保持原顺序和原 content 构造逻辑。
3. 非空 `system_bottom` 独立放在数组末尾，位于最终 USER 之后。

normalize 与 `expandPlaceholders()` 都会产生已清洗文本；只在展开结果非空时插入消息，避免空 SYSTEM。不得将新增内容加入 `systemLines`，也不得把尾部 SYSTEM 插到 USER 前面。

## 兼容性与风险

- 空值兼容：默认和旧配置均产生空字符串，因此数组仍为现有四条消息。
- 索引兼容：现有测试对空默认设置继续可使用 `messages[0]` 访问核心 SYSTEM；只有显式配置顶部 SYSTEM 时核心消息索引才后移，这是需求定义的行为。
- 预览一致性：实际 Analyzer 与 UI 预览已经共享构建函数，风险集中在是否把草稿字段完整采集。
- 独立 World 页面也复用预览组件，但当前没有传入任何提示词设置，既有自定义 task/prefix/suffix 已与真实请求不一致。本任务按用户文字只保证设置页预览；不借机扩展 World 页面状态接口。
- 长度限制：复用现有统一上限，不引入字段特例。
- 回滚：改动仅涉及新增对象字段、两个 textarea、消息数组边界项及测试，可按文件级 diff 直接反向恢复，无数据迁移需要回滚。

## 不变项

`WORLD_MODEL_CORE_INSTRUCTIONS`、`WORLD_MODEL_OUTPUT_CONTRACT`、`WORLD_MODEL_SCHEMA`、AnalysisInput 格式、Analyzer guard、API Profile 和请求调用行为均不改动。

## 文档同步

只修正与本功能直接相关的三处说明：配置可编辑字段包含首尾 SYSTEM；消息分层为可选顶部 SYSTEM + 既有四段 + 可选尾部 SYSTEM。不得顺带改写 World Model 其它语义文档。

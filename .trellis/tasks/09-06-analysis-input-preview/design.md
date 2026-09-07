# 分析输入收集器与预览技术设计

## 1. 变更边界

当前来源目录和 Chat-local 设置已经由 `ai/worldbook.js`、`ui/app.js` 与 `story/seven-days-cal.js` 提供。本任务只在这些边界上增加一个临时读取层和设置页展示层，不改变选择存储格式，也不把正文写回 Chat。

预期修改文件：

- `ai/input-builder.js`：新增纯函数，接收已解析来源、选择项、Chat 上下文和外部预览 DTO，生成安全的 `AnalysisInput`。
- `story/seven-days-cal.js`：复用已有公开接口探测，增加仅供预览的短生命周期外部来源 DTO；不暴露私有 Store。
- `ui/app.js`：维护预览临时状态，打开/刷新时加载必要世界书内容和外部公开内容，处理模式切换与折叠状态。
- `ui/settings.js`：渲染预览入口、摘要、结构分组和原始 JSON 文本。
- `style.css`：只增加预览块的紧凑响应式样式。
- `tests/input-builder.test.js` 或现有测试文件：覆盖输入选择、范围、状态、token 和敏感字段边界。

不修改：API Profile/Secret、入口宿主、主题 token、世界书选择 schema、`context/builder.js`、World Model、AI client。

## 2. AnalysisInput DTO

收集器只复制可展示的稳定字段，不返回原始宿主对象：

```js
{
  character: {
    description: string,
    greetings: [{field_key, label, content, is_current}]
  },
  worldbooks: [{
    source_id,
    name,
    entries: [{entry_id, label, content, token_estimate}]
  }],
  recent_story: {
    enabled,
    floor_count,
    floor_start,
    floor_end,
    items: [{floor, role, content}]
  },
  external_memory: [{
    key,
    label,
    status,
    content_available,
    items: [{label, content}]
  }],
  meta: {chat_id, floor_start, floor_end},
  token_estimate: number
}
```

角色卡和世界书的成员由 `source_id + field_key/entry_id` 精确匹配 `selected`。来源存在但未选中的子项不进入 DTO。世界书没有已加载正文时不伪造条目，UI 先加载当前已选来源后再生成预览。

## 3. 外部来源边界

`available` 只代表公开插件/接口存在，`content_available` 只代表本次是否读到内容。预览状态区分：未启用、未检测到、读取成功（可为空）、读取失败。Anima 与柏宝书只使用已有公开接口；数据库记忆没有已确认公开读取接口，不生成正文。SevenDaysCal 不作为外部记忆或故事时间来源读取，时间信息由当前剧情正文处理。

外部 DTO 只保留显示所需的标签和正文，不把原始响应、配置、Secret、Profile 或内部 Store 放入 `AnalysisInput`。

## 4. UI 交互

设置页增加一个默认收起的“高级 / 调试”区域，其中提供“分析输入预览”卡片：

- “刷新预览”按钮每次重新生成临时 DTO；
- “结构预览”和“原始内容”按钮切换同一份 DTO 的两种展示；
- 结构模式按角色卡、世界书、最近剧情、外部记忆分块；正文默认可折叠；
- 显示 token estimate、Chat 和 Floor 摘要；
- 空内容明确显示“本次没有读取到内容”，不填充示例正文。

预览正文只存在运行时 UI state。页面其它设置变化不会自动写入新存储字段；需要刷新时重新从当前 state/Chat 读取。

## 5. 安全与估算

收集器采用白名单 DTO，原始内容使用现有 `redactSecrets` 做字符串安全处理；不接受 Profile 对象作为输入。token estimate 继续按字符数除以 4 向上取整，按实际正文递归统计，不引入 tokenizer。

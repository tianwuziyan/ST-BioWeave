# 世界书来源修正实施计划

## 实施顺序

### 1. 先锁定 Chat-local 回归

用动态 Chat metadata adapter 建立最小 A/B/A harness：

- A 保存 `WB1-entry1`、`WB2-entry3`；
- B 保存 `WB3-entry2`；
- 返回 A 只读出 A 的两项。

同时覆盖缺失稳定 entry ID 被跳过，以及 source/entry 不因显示名称相同而合并。

### 2. 扩展现有 source DTO

只改 `ai/worldbook.js`：

- 删除 Recent Story / SevenDaysCal 对世界书目录的混入；
- worldbook source 归一化 entries；
- character card 归一化 fields；
- 搜索子项、全选/全不选和统计改为条目/字段粒度；
- 保持官方读取 API 和稳定 file_id 边界。

### 3. 扩展 Chat schema 与 app 状态

只改 `storage/schema.js`、`ui/app.js`：

- `worldbooks.selected` 保存 `{source_id, entry_id|field_key, enabled}`；
- 增加 `recent_story` 与 `external_memory` Chat-local 配置归一化；
- 加载/保存三类配置都使用当前 Chat token；
- Chat 切换重新读取 metadata，不从角色名或内存继承。

### 4. 重排设置 UI

只改 `ui/settings.js`、必要的既有 `style.css` 选择器：

- “世界书来源”只含角色卡字段和世界书条目；
- 角色卡只显示“角色描述”和可展开的“开场白”组，主开场白与每条备用开场白逐条选择；两个外层折叠区域彼此独立；
- 世界书按实际 `character_worldbook` scope 与全局 scope 分组；
- 轻量可展开的世界书行；
- 每本书提供只由 entry 状态驱动的 checked/unchecked/indeterminate 父 checkbox；
- 独立“最近剧情”和“外部记忆来源”卡；
- 四个外部选项显示中文与可用/不可用状态；
- 保持触控布局和冻结的主题基础。

### 5. 外部接口检测

扩展现有 `story/seven-days-cal.js` 的纯检测 helper，使用已确认公开能力；不读取数据、不注入 Context。Anima/柏宝书/数据库的边界记录在 `research/external-memory-api.md`。

### 6. 验证与停点

运行 `npm test`、`npm run check` 和必要的 `node --check`。完成后停下来，提供 Desktop、Tablet、Mobile 的真实 SillyTavern 验收步骤；不进入 World Model。

## 不新增生产文件

现有 `ai/worldbook.js`、`story/seven-days-cal.js`、`storage/schema.js`、`ui/app.js`、`ui/settings.js` 和 `style.css` 足以承载本轮明确职责。新增的研究文档和回归测试不形成业务抽象层。

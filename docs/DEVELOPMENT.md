# BioWeave 开发规范（轻量模块版）

## 模块边界

- `core/events.js`：剧情生理事实的 normalize / validate / sort。
- `core/state.js`：纯程序 State Reducer，不调用 AI。
- `core/snapshot.js`：检查点与删除楼层后的局部恢复。
- `core/projection.js`：未来软推演数据；不是事实。
- `core/genealogy.js`：家系查询、世代与排序。
- `ai/client.js`：API Profile 的校验、SillyTavern Secret 引用和宿主代理测试请求；不在浏览器或 Chat 数据中保存明文 API Key。
- `ai/prompts.js`：受保护 Core Prompt + 用户 Prefix/Task/Suffix Pipeline。
- `ai/worldbook.js`：世界书枚举/选择/Token 估算。
- `ai/analyzer.js`：World / Floor / Projection 三类 AI 任务。
- `runtime/chat.js`：ChatBoundary。
- `runtime/floor.js`：Floor Version、分析间隔与重复分析规则。
- `runtime/events.js`：SillyTavern 生命周期事件映射。
- `storage/store.js`：两级存储统一入口。
- `storage/schema.js`：默认结构和版本。
- `story/*`：外部记忆公开接口适配。
- `context/builder.js`：向 Tavern 注入短、稳定、结构化的 BioWeave Context。
- `ui/*`：一个一级页面一个文件。

## 不再继续细拆的规则

只有文件稳定超过约 500–800 行、出现两个独立职责、或独立测试明显更清楚时才拆。不要建立 event-store / event-validator / event-factory / event-interface 这类碎片目录。

## 推荐实施顺序

1. SillyTavern Adapter 与 Chat-local Storage。
2. UI Foundation：魔法棒入口、documentElement-level overlay、响应式壳、主题与生命周期。
3. API Profile、Secret 引用与测试连接。
4. Event CRUD。
5. State Reducer。
6. Snapshot restore。
7. Floor Version / edit / swipe / delete / reroll。
8. Worldbook + Prompt Pipeline。
9. World Analyzer / Event Analyzer / Projection。
10. Tavern Context。

## UI Foundation 手工验收

以下步骤需要在更新后的真实 SillyTavern 页面执行。BioWeave 主窗口使用独立高层级宿主；不把“先手动关闭酒馆 drawer”作为打开主 UI 的前置条件。

### Desktop（>= 1200px）

1. 点击输入区附近的魔法棒。
2. 在 `#extensionsMenu` 点击 BioWeave。
3. 确认出现左侧完整导航和多人总览；关闭后再次从同一菜单打开。
4. 确认总览、人物、事件、推演、家系、世界模型、设置均可进入，并切换跟随酒馆、日、夜主题。

### Tablet（768–1199px）

1. 将窗口或 iPad viewport 调整到约 1024×800。
2. 重复魔法棒 → `#extensionsMenu` → BioWeave。
3. 确认导航变为顶部紧凑布局、内容区保持可滚动，关闭/重开不丢失 overlay。
4. 检查三主题和人物详情壳，没有横向溢出。

### Mobile（< 768px）

1. 将 viewport 调整到约 390×844；无需先手动关闭酒馆 drawer。
2. 重复魔法棒 → `#extensionsMenu` → BioWeave。
3. 确认单列页面和底部“总览 / 人物 / 事件 / 推演 / 更多”导航出现。
4. 点击“更多”，确认真实菜单可进入家系图谱、世界模型、设置、分析状态。
5. 检查底部安全区、关闭/重开、三主题和页面没有普通横向滚动。

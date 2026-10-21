# 实施计划：严格模式推演生理反应语义匹配

## 1. Core 反应概念模块

- [x] 建立受孕前观察反应概念表、时间范围、明确短语与排除组合的单一 owner。
- [x] 实现 Event 多概念提取纯函数，仅消费合格 Event 的 `symptom.kind` 与 `symptom.description`。
- [x] 实现 Projection 单概念解析纯函数，优先 branch key，文本 fallback 必须唯一。
- [x] 将现有只支持 `nausea` 的 matcher 改为基于概念交集、人物和 Story Time 的严格 matcher。
- [x] 保证输入不可变，未知、模糊、多概念和无反应分支失败关闭。

验证：Core 测试覆盖全部十个正向分支、柳如烟实例、否定/未发生/干呕未吐/单次剧烈恶心、泛词和多概念卡片。

## 2. Runtime 与 Debug

- [x] 继续复用 `collectActiveBusinessData()` 的同一次 Event snapshot，不增加 Analyzer/API 或完整业务读取。
- [x] 保留六字段 Floor Version 一致性检查、subject 隔离和当前有效 Floor/Swipe 边界。
- [x] Product DTO 继续只输出 `observed_reaction.matched`。
- [x] 扩展现有有界 Debug 关联记录，输出概念与匹配路径，不输出原始正文和完整 description。
- [x] 覆盖 Event 编辑/删除、Floor/Swipe 失效、阶段替换、回退旧楼和重复读取无写入测试。

## 3. UI 与文档

- [x] 保持“已触发”徽标、删除按钮和卡片布局不变；仅验证多张卡片可以分别显示徽标。
- [x] 同步 `docs/UI.md`、`docs/UI_FRAMEWORK.md`、配置中的严格模式说明；因 DOM、布局与样式未变，示例和完整参考无需产生无意义 diff。
- [x] 更新 Event/Projection 读模型规范，记录标题/内容只用于卡片语义、Event 才是事实来源。
- [x] 检查并同步 `docs/bioweave-data-lifecycle.md`；后续持久化触发记录扩展已补齐生命周期说明。

## 4. 验证

- [x] `node --check` 检查所有变更 JavaScript。
- [x] 运行 Core、Projection Runtime、UI focused tests。
- [x] `npm test`。
- [x] `npm run check`。
- [x] `git diff --check` 与完整差异审查。
- [x] 确认新增记录仍归现有 Floor-owned Projection timeline 所有，没有第二事实源、Projection factual transition 或额外 API 调用。
- [ ] 刷新真实 SillyTavern 后验证柳如烟实例与 Desktop/Tablet/Mobile UI。

## 5. 持久化触发记录与阶段历史

- [x] 在现有 `projection_timeline` 增加 Floor-owned append-only observation records，并补齐 schema、normalize、validation、dedupe、batch persistence 与 readback。
- [x] 当前阶段严格匹配成功后批量保存 `triggered` 记录；重复读取必须去重且不产生额外 Host 写入。
- [x] 健康自然恢复清理 Event 时保留已触发记录，不修改健康识别和恢复逻辑。
- [x] 用户手动编辑/删除 Event 后，只按修改后的事实同步当前阶段触发记录；旧阶段历史不倒改。
- [x] 阶段替换后仅保留新阶段为当前候选，并额外派生人物级“本轮曾经触发”历史；未触发旧卡不进入历史。
- [x] UI 保持当前阶段卡片结构，并以简短区域展示“本轮曾经触发”；历史项目不显示为当前仍在持续。
- [x] Projection Context 分别输出“此前出现过，不代表当前仍持续”和当前阶段可能反应。
- [x] 观察过程结束、Floor/Swipe 失效、回退旧楼和手动纠错的生命周期测试覆盖完整。
- [x] 同步 lifecycle registry、`docs/bioweave-data-lifecycle.md`、Floor State、Event Pipeline、UI 文档与配置；如 UI 增加结构，同步 HTML 示例和完整参考。

## 风险文件与回滚点

- `core/projection-eligibility.js`：现有 matcher 入口；避免继续扩成词表容器。
- 新 Core 纯函数模块：集中拥有概念表与严格解析规则。
- `runtime/projection-runtime.js`、`runtime/events.js`：只连接已有 snapshot 与 Debug，不承担语义解析。
- `tests/projection-eligibility.test.js`、`tests/projection-runtime.test.js`、`tests/ui.test.js`：回归主证据。
- UI 文档与配置：只同步行为说明，不改变已验收布局。

## 6. Debug enhancement（本轮追加）

- [x] 扩展既有 `projection_observed_reaction_links`，区分当前派生识别、持久化记录/最新 action 与 Product/历史/Context 最终使用状态。
- [x] 复用既有 Projection pipeline trace，记录 observation 保存尝试、追加/去重、读回及失败状态；继续限制为安全字段。
- [x] 补充 focused Runtime 测试，确认 TXT 可携带安全 DTO 且不泄漏原始正文。

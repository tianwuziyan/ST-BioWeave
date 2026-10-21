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
- [x] 检查 `docs/bioweave-data-lifecycle.md`；本次无持久化字段变化，无需修改。

## 4. 验证

- [x] `node --check` 检查所有变更 JavaScript。
- [x] 运行 Core、Projection Runtime、UI focused tests。
- [x] `npm test`。
- [x] `npm run check`。
- [x] `git diff --check` 与完整差异审查。
- [x] 确认没有新增持久化字段、第二事实源、Projection factual transition 或额外 API 调用。
- [ ] 刷新真实 SillyTavern 后验证柳如烟实例与 Desktop/Tablet/Mobile UI。

## 风险文件与回滚点

- `core/projection-eligibility.js`：现有 matcher 入口；避免继续扩成词表容器。
- 新 Core 纯函数模块：集中拥有概念表与严格解析规则。
- `runtime/projection-runtime.js`、`runtime/events.js`：只连接已有 snapshot 与 Debug，不承担语义解析。
- `tests/projection-eligibility.test.js`、`tests/projection-runtime.test.js`、`tests/ui.test.js`：回归主证据。
- UI 文档与配置：只同步行为说明，不改变已验收布局。

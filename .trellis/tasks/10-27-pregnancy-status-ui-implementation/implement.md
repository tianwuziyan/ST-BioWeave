# 实施计划

## 阶段 1：只读派生 DTO

1. 新增 `core/pregnancy-status.js`，实现按人物选择 confirmed episode、Story Time 差值和整数孕周；补充 confirmed/suspected/unknown、无锚点、不可比较时间和多人物隔离测试。
2. 在 `runtime/events.js` 的统一 `collectActiveBusinessData` 包装处附加 `pregnancy_status` 与现有知识投影 `pregnancy_knowledge`。debug 与普通读取均使用脱敏投影，不改变持久化。

## 阶段 2：生产 UI

1. 新增窄共享 renderer（状态标签、知情名单按钮、名单弹层），复用既有 editor popover class 和 CSS token。
2. 修改 `ui/character-state.js` / `ui/characters.js` 接收 DTO，在人物页按已确认状态渲染按钮和孕周。
3. 修改 `ui/projection.js`，只替换现有详情 meta 的第一个状态入口；不新增总览栏目或推演顶端区块。
4. 修改 `ui/app.js` 传递 DTO、维护 popup 状态、处理 delegated action、外部点击、Escape、换人和换页清理。
5. 在 `style.css` 增加 scoped 的小按钮、状态格标题行和名单内容样式，保持现有断点与变量。

## 阶段 3：文档与验证

1. 更新 `docs/UI.md`、`docs/ARCHITECTURE.md`、`docs/DATA-MODEL.md`、`docs/DEVELOPMENT.md` 中“UI 不得显示妊娠状态/孕周”的过时说明，改为“UI 不自行推导，消费 Runtime 派生 DTO”；同时说明孕周无可比较锚点时的回退。
2. 运行 `node --check` 相关模块、定向 UI/Core/Runtime 测试和 `npm run check`。
3. 检查实际 diff，确保父任务原型、无关 Floor/Storage 变更未被覆盖；未做 commit/push。

## 回滚点

- 共享 renderer、状态 DTO、app popup 状态和 CSS 均为独立增量；若真实宿主验收发现视觉或数据问题，可只回退本任务文件，不触碰已有 pregnancy knowledge 写入和事件分析。

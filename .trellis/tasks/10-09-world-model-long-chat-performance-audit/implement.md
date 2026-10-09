# Execution Plan: 审计与第一阶段最小修复

## 第一阶段实施边界

用户已批准仅实施 World Model UI 性能修复第一阶段：

- 去掉首次 `initializeRoot()` / `openBioWeave()` 的重复 render，但保留关闭后重开、Chat 切换、World/Status route 和事件绑定生命周期。
- 在同一 UI ingress/render 生命周期复用已构建的 World Model View Model。
- 在同一次 resolver 调用内复用 `resolveFloorAtIndex()` 返回的已验证 `floorData`，不改变 Floor Version、Swipe、Chat、invalidation 或查找顺序。
- 补充 Floor 10/A、Floor 20 Archive/B、Floor 21 继承、删除后回退 Floor 18/A，以及旧快照不被原地修改的回归测试。

明确不做：全局缓存、Floor persistence contract、Full/Supplement、migration、真实聊天数据、无关 UI 重构、commit/push/reset/clean。

## 后续测试补充

在不修改生产代码的前提下，使用 `tests/event-analysis-runtime.test.js` 的现有 fixture 和真实 Runtime 入口补充 World Model 历史演进测试：

- Full 在 Floor 2 保存 A；Floor 4 无快照并继承 A。
- Supplement 在 Floor 6 通过 `ADD_SPECIES` Patch v2 真实合并得到 A+B。
- Archive 在 Floor 8 通过共享 Archive 逻辑和 `saveWorldModel()` 保存 B，并保留 A 的 archive metadata。
- Supplement 在 Floor 10 读取 B 和 archive metadata，通过 `ADD_SPECIES` 真实合并得到 B+C，A 不重新出现。
- 删除后分别回退 Floor 8 和 Floor 6，验证不会读取未来快照。

测试只使用合成消息和 fixture storage，不写真实 Chat；Chat/Swipe isolation 继续复用既有回归测试。

1. 记录 branch、HEAD、worktree 状态；确认除本任务 artifacts 外没有用户修改被覆盖。
2. 阅读并引用 Floor ownership、World Model、lifecycle、architecture 和相关 frontend 规范。
3. 从 UI 打开入口开始建立完整初始化调用图，定位 World Model 自动读取、resolver、Storage、normalize、view-model、clone/JSON、未打开页面预构建和组件 render。
4. 建立事件触发矩阵，覆盖用户指定事件及代码中实际存在的兼容事件；跟踪 queue、in-flight、hidden UI、重复 refresh 和 duplicate render。
5. 建立可控 benchmark 矩阵，分别改变 Floor/message count、current World Model size、historical snapshot count 和 UI lifecycle；禁止读取真实聊天数据。
6. 审计 Full/Supplement、Archive/Restore/Permanent Delete 的写入位置和 historical resolver，验证 Floor 10/A、Floor 20/B、Floor 21/B、删除回退 A、Swipe/Chat isolation 语义。
7. 运行相关现有测试与静态检查，记录基线和历史语义测试覆盖；不修改测试。
8. 运行只读 synthetic measurement；分别记录 CPU、async、Storage/Network、DOM/render 代理和调用次数，不以循环/clone/stringify 单独判定性能根因。
9. 对四个变量分别做复杂度归类，区分一次扫描、重复扫描、数据体积处理和 UI 事件放大；没有证据的项目标记 UNVERIFIED。
10. 生成审计报告（优先写入本任务目录的 `report.md`，不修改生产 Markdown），给出 CONFIRMED/LIKELY/UNVERIFIED 分级、历史语义结论、测试缺口、最小优化方案和 regression tests。
11. 执行最终质量检查：相关 tests/checks、task validate、`git diff --stat`/`git status`；确认无生产代码/数据/Git 历史修改。
12. 在用户明确批准具体修复方案前不实施任何优化；完成审计后停止。

## Validation commands

- `git status --short --branch`
- `git rev-parse HEAD`
- `npm test -- --test-name-pattern='world|floor|event-analysis'`（若项目脚本不支持该参数，改用实际支持的等价命令）
- `node --check` 仅用于临时复制/读取验证时，不能修改生产文件
- `python3 ./.trellis/scripts/task.py validate 10-09-world-model-long-chat-performance-audit`
- `git diff --name-only` 与 `git status --short`

## Review gates

- 规划 review：用户明确批准本摘要后，才可 `task.py start`。
- 证据 review：报告中的根因必须有代码位置或测量数据。
- 安全 review：任何建议不得绕过 Floor ownership/lifecycle/authoritative readback。
- 最终 review：生产目录无变化；仅本任务 artifacts 新增；无 commit/push/reset/clean。

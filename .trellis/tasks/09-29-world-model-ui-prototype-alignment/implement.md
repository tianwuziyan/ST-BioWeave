# 实施清单（待用户确认后执行）

## Preflight

- [ ] 重新检查 `git status`、阅读 `AGENTS.md` 与相关 UI、Floor、World Model 规范；确认没有外部改动或任务范围漂移。
- [ ] 用户明确批准这组三份规划产物后才运行 `task.py start`；此前不改生产文件。

## Ordered changes

1. [ ] 先同步 `docs/ui-framework.config.json` 中世界归档、只读模块、滚动区、断点与 Escape 优先级登记；校验 JSON。
2. [ ] 同步 `docs/UI_FRAMEWORK.md`、`docs/UI_FRAMEWORK_EXAMPLE.html`、`docs/UI_FULL_REFERENCE.html` 的世界页局部结构、钩子和三端示例。检查静态示例不被误认为 Runtime 数据。
3. [ ] 只在 `ui/world.js` 调整归档位置、内容和条件机制模块顺序；维持既有 Runtime DTO、escape 和编辑表单。
4. [ ] 只在 `ui/app.js` 的既有事件委托／根键盘处理处实现点外侧关闭与 Escape“浮层优先、再面板”；保持遮罩与其它点击行为。
5. [ ] 只在 `style.css` 的世界页作用域添加或修订必要规则；检查旧规则最终优先级，避免顺手重排整个样式文件。
6. [ ] 在 `tests/world-model.test.js` 和 `tests/ui.test.js` 添加聚焦回归：归档结构及来源、机制有／无、只读边界、Escape 两阶段与点外侧行为。

## Verification and review gates

- [ ] `node --check ui/world.js`、`node --check ui/app.js`、JSON 解析、聚焦 UI 测试、`npm run check`、`git diff --check`。
- [ ] 比对 `git diff`：确认只有批准范围，所有 `data-bioweave-*` 钩子和七个编辑模块契约均保留。
- [ ] 在真实 SillyTavern 刷新插件，分别按 ≥1200px、768–1199px、≤767px 检查归档浮层、Escape 次序、机制有／无、三个滚动区、编辑器、主题和页面横向溢出；不能执行时明确列为待验收。
- [ ] 报告修改文件、自动检查、真实宿主验收结果／限制。按用户要求不 commit、不 push。

## Rollback boundary

仅回退本任务修改的世界页 UI、局部样式、相关测试和同步文档；不触碰已有 World Model 数据、Runtime、Floor 持久化或其它未提交工作。

## 2026-09-30 执行记录

- 已同步世界页生产 UI、局部样式、两份示例／参考、UI 配置及规范，并补充 World Model 渲染回归。独立检查修正了机制模块顺序、滚动范围、归档浮层点击处理和完整参考脚本注释。
- `node --check ui/app.js`、`node --check ui/world.js`、聚焦 World UI 测试（3/3）、UI 配置解析、完整参考内嵌脚本语法及 `git diff --check` 通过。
- 全量 `npm run check`：1090 项中通过 1055、失败 35；从 `HEAD` 导出的干净基线为 1088 项中通过 1053、失败 35，失败名单一致。另一次全量运行出现一项异步测试偶发失败，单独重跑与再次全量运行均通过该项。
- 真实 SillyTavern Desktop、Tablet、Mobile 验收尚未执行；本机未发现运行中的 SillyTavern 宿主。任务保持 `in_progress`。按用户要求不 commit、不 push。
- 2026-09-30 follow-up：按效果稿复核并修正顶部分析按钮、归档资料按钮及分隔线、世界模型副标题、类型详情／世界规则文字字号与颜色；聚焦 World UI 测试和语法检查再次通过。
- 2026-09-30 detail follow-up：按用户补充验收修正集合操作和模块编辑为 32px 正方形图标按钮、移除物种描述标题、统一归档文字颜色、补齐补充分析按钮样式、能力“是”左对齐，并保留原生三态 checkbox 的未知 indeterminate（“-”）语义；同步更新 UI 规范示例与配置。聚焦 World UI 测试 4/4、语法检查、UI 配置解析和 `git diff --check` 通过。全量检查仍保留基线中的两项失败，真实宿主三端验收待执行。
- 2026-09-30 description follow-up：按效果稿 `.detail-intro` 对齐物种描述，字号调整为 12px、行高 1.5，颜色保持 muted；新增 CSS 回归断言并同步 `speciesDescription` 配置。语法检查、聚焦 World UI 测试 4/4、UI 配置解析和 `git diff --check` 通过。
- 2026-09-30 module edit follow-up：按效果稿将生物类型详情与世界级规则模块标题右侧编辑入口改为 26px 无边框、透明背景的 muted `fa-pen` 图标按钮，悬停仅显示浅色背景；保留现有 hooks 和可访问性属性。新增样式回归断言并同步 UI 配置/规范。语法检查、聚焦 World UI 测试 2/2、UI 配置解析和 `git diff --check` 通过。
- 2026-09-30 module edit size follow-up：根据实测反馈继续缩小模块编辑按钮为 24px、图标 15px；集合操作按钮保持原有 32px，不受影响。
- 2026-09-30 module edit size follow-up 2：根据再次实测反馈缩小模块编辑按钮为 20px、图标 13px；集合操作按钮保持原有 32px，不受影响。
- 2026-09-30 editor field follow-up：编辑态字段列改为 `minmax(92px, max-content) minmax(0, 1fr)`，缩短第一列并让右侧输入区域左移；移动端单列规则保持不变。
- 2026-09-30 editor typography follow-up：编辑态标签与输入统一为 13px / 1.5，输入内边距 6px；世界级规则第一列收窄为 `minmax(92px, max-content)`。
- 2026-09-30 tight editor follow-up：医疗与照护、特殊例外编辑窗口的标签列进一步收窄为 `minmax(72px, max-content)`，右侧内容列扩大并左移。
- 2026-09-30 medical readout follow-up：医疗与照护正常展示态第一列同步收窄为 72px，右侧内容列扩大。
## Latest follow-up

- 桌面端生物类型详情与世界级规则栏调整为 5.5:4.5，左栏略窄、右栏略宽；平板与移动端仍为单列。
- 桌面与平板统一使用 5.5:4.5 两栏，手机（≤767px）保持单列。

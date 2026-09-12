# BioWeave UI 完整替换指令

这是一份给编码助手使用的可复制指令。它要求编码助手使用统一 UI 框架，把旧 UI 替换成新 UI，并在验收后清理旧视觉实现。

## 完整替换指令

~~~text
你现在负责 BioWeave 的生产 UI 完整替换。

先读取并遵守：

1. docs/ui-framework.config.json
2. docs/UI_FRAMEWORK.md
3. docs/UI_FRAMEWORK_EXAMPLE.html
4. docs/UI_FULL_REFERENCE.html
5. docs/UI.md
6. docs/DEVELOPMENT.md
7. ui/app.js
8. ui/overview.js
9. ui/characters.js
10. ui/events.js
11. ui/projection.js
12. ui/genealogy.js
13. ui/world.js
14. ui/settings.js
15. ui/state.js
16. style.css
17. tests/ui.test.js
18. tests/phase2a-ui.test.js

目标：

把 docs/UI_FRAMEWORK_EXAMPLE.html 和 docs/UI_FULL_REFERENCE.html 定义的视觉框架迁移到生产 UI，使桌面、iPad、手机三端的布局、颜色、间距、卡片、表格、折叠栏、下拉框、checkbox、switch、正则行和世界模型卡片保持同一套设计。

这是生产 UI 的视觉和交互结构替换，不是静态原型复制。

视觉必须逐项一致：字体族、字体大小、字重、行高、文字颜色、背景颜色、边框颜色、圆角、阴影、内外边距、按钮尺寸、按钮状态、输入框、下拉框、折叠栏、checkbox、switch、正则行、卡片比例和三端断点，都以 docs/ui-framework.config.json、docs/UI_FRAMEWORK.md、docs/UI_FRAMEWORK_EXAMPLE.html 和 docs/UI_FULL_REFERENCE.html 为准。不要凭感觉重新设计，也不要只做近似颜色。

配置同步是硬性要求：每次调整 UI 时，先同步更新 docs/ui-framework.config.json；若规则、语法或组件说明变化，同时更新 docs/UI_FRAMEWORK.md；若视觉或控件结构变化，同时更新 docs/UI_FRAMEWORK_EXAMPLE.html 和 docs/UI_FULL_REFERENCE.html；然后再修改生产 UI。配置、文档、示例、完整视觉参考和生产实现出现不一致时，先修复同步关系再继续。

执行规则：

1. 生产数据继续来自 Runtime DTO。
2. 保留现有 Runtime、API、世界书、正则、事件分析、世界模型编辑、Chat 保存和数据安全逻辑。
3. 保留现有 data-bioweave-* 事件钩子；如果 HTML 结构变化，必须同步修改事件委托和选择器。
4. 世界模型继续使用生产物种、类型、能力、规则、生命周期、医疗、例外和 unknowns 数据。
5. 世界模型每个模块只有一个编辑入口，保存和取消只作用于当前模块。
6. 设置页面保留多级世界书来源、父子勾选/半选、折叠展开、API 来源、模型下拉框、开关、正则增删/启停/上下移动、外部记忆、提示词和调试预览。
7. 正则上下按钮必须垂直紧挨，顶部和底部与正则行对齐。
8. Desktop、iPad、Mobile 均使用顶部八路由栏；Mobile 使用四列多行平铺路由和单列内容，不使用底部导航、横向导航条或更多弹出菜单。
9. 页面不能出现页面级横向溢出，设置展开后不能被右侧下拉框撑坏。
10. 所有 DTO 文本继续 HTML 转义，不展示 Secret、API Key 或 Raw AI Response。
11. 继续使用原生 JS、HTML、CSS，不引入 React、Vue、UI 组件库或大型状态管理框架。
12. 不改变现有函数签名、Runtime 调用参数、数据结构、事件语义、存储键、API 配置格式和 data-bioweave-* 选择器，除非先证明原接口本身有错误。
13. 修改前先通过调用方、被调用方、测试和现有生产实现核对接口；不凭 HTML 结构猜测业务接口。
14. 每新增一个 UI 控件，必须在 ui-framework.config.json 登记 token、组件、事件钩子、响应式行为和验收项，并在 UI_FRAMEWORK_EXAMPLE.html 和必要时的 UI_FULL_REFERENCE.html 增加对应例子。

允许修改：

- style.css
- ui/app.js
- ui/overview.js
- ui/characters.js
- ui/events.js
- ui/projection.js
- ui/genealogy.js
- ui/world.js
- ui/settings.js
- ui/state.js
- 因结构变化必须调整的 tests/ui.test.js
- 因结构变化必须调整的 tests/phase2a-ui.test.js
- 必要时更新 docs/UI.md
- docs/ui-framework.config.json
- docs/UI_FRAMEWORK.md
- docs/UI_FRAMEWORK_EXAMPLE.html
- docs/UI_FULL_REFERENCE.html

保持不变：

- index.js
- manifest.json
- settings.html
- ai/
- core/
- runtime/
- storage/
- context/
- story/

实施顺序：

第一阶段：列出当前生产 UI 的事件钩子、Runtime 调用、函数签名、数据属性、存储键和测试断言，确认迁移边界。先做只读审计，不删除旧 UI。

第二阶段：先同步 ui-framework.config.json、UI_FRAMEWORK.md、UI_FRAMEWORK_EXAMPLE.html 和 UI_FULL_REFERENCE.html，再迁移 ui/app.js 的面板壳、标题栏、导航和页面容器。

第三阶段：逐页迁移 overview、characters、events、projection、genealogy、world、settings、state 的 HTML 结构。

第四阶段：把框架变量、组件样式、世界卡片、设置折叠栏、来源树、正则行和三端媒体查询写入 style.css。

第五阶段：检查生产实现是否仍与 ui-framework.config.json、UI_FRAMEWORK.md、UI_FRAMEWORK_EXAMPLE.html 和 UI_FULL_REFERENCE.html 一致；运行自动化检查，并修复所有因结构变化导致的测试失败。

第六阶段：在 SillyTavern 中实际打开插件，验证 Desktop、iPad 和 Mobile 的所有路由及控件。

第七阶段：确认新 UI 已稳定后，删除旧 UI 的遗留模板、旧类名、旧 CSS 规则和临时兼容渲染；不要保留两套 UI 并行渲染。生产页面文件本身不能删除，ui/*.js 是新 UI 的正式实现文件。

验证命令：

npm run check
git diff --check

完成后报告：

- 修改的文件和每个文件的具体内容
- ui-framework.config.json、UI_FRAMEWORK.md、UI_FRAMEWORK_EXAMPLE.html、UI_FULL_REFERENCE.html 是否同步更新
- 保留的 data-bioweave-* 事件钩子
- 保留的函数签名、Runtime 接口、存储键和数据结构
- 已删除的旧 UI 模板、类名和 CSS 范围
- Desktop、iPad、Mobile 的验证结果
- 自动化测试结果
- 仍需人工在 SillyTavern 中验证的项目

不要提交 Git，不要推送远程。
~~~

## 以后修改 UI 的短指令

~~~text
请修改 BioWeave 的 UI。开始前先读取 docs/ui-framework.config.json、docs/UI_FRAMEWORK.md、docs/UI_FRAMEWORK_EXAMPLE.html 和 docs/UI_FULL_REFERENCE.html，再读取目标页面模块和 ui/app.js 的相关事件钩子。

本次只修改：[填写页面或控件]

必须保持：

- 当前 UI 框架的颜色、字体、层级、间距和三端断点；
- 现有 data-bioweave-* 事件钩子；
- Runtime DTO 和生产业务逻辑；
- 现有函数签名、Runtime 调用参数、存储键和数据结构；
- Mobile 无页面级横向溢出；
- checkbox、switch、details、select 和按钮的真实可用性。

本次修改过程中同步更新 docs/ui-framework.config.json；如果涉及规则说明或视觉例子，同时更新 docs/UI_FRAMEWORK.md、docs/UI_FRAMEWORK_EXAMPLE.html 和 docs/UI_FULL_REFERENCE.html。完成后运行 npm run check 和 git diff --check，并报告修改文件、配置同步情况、保留的接口/事件钩子、三端验证结果和测试结果。
~~~

# 实施计划：怀孕状态多页面 UI 原型

## 阶段 1：原型准备

1. 只读检查生产 `ui/app.js`、`ui/overview.js`、`ui/characters.js`、`ui/projection.js` 与 `style.css`，确认 shell、八路由、页面 renderer、列表/详情工作区和响应式断点；不修改生产文件或 docs 参考文件。
2. 在任务目录新建 `pregnancy-status-ui-addition-real-ui.html`，直接复用生产 `.bioweave-overlay`、`.bioweave-panel`、`.bioweave-app-header`、`.bioweave-routebar`、`.bioweave-main` 结构，加载生产 `style.css` 并调用三个生产 renderer，不另建一套外壳；另提供 `pregnancy-status-ui-addition-real-ui-standalone.html` 与由真实 renderer 生成的 `production-pages.generated.js`，移除 ES Module 依赖，供直接双击打开时使用。
3. 用固定演示 DTO 渲染总览、人物、推演三页，明确标注“演示数据”；保留旧 `pregnancy-status-ui-prototype.html` 作为被否决草稿，不再作为预览入口。

验证：通过仓库根目录的静态预览打开 HTML 可渲染；页面不依赖构建、API 或 SillyTavern 运行时，但会复用仓库内的生产 `style.css` 与页面 renderer 模块。

## 阶段 2：增量展示

1. 总览保持生产 UI 原有内容，不新增妊娠状态摘要或知情人数模块。
2. 在人物详情现有 `.bioweave-character-state` 的“当前状态”区保留“生殖暴露”“受孕事实”和“妊娠状态”三个 `.bioweave-character-state-cell`；受孕事实使用普通文字显示是否确认，不使用 badge/外框，已确认人物在该格右上角通过带生产边框的 `.bioweave-button`“知情名单”展开知情人轻量 dialog/popover。妊娠状态格在已确认时显示孕周（如“孕 8 周”），疑似或未知时显示观察中/暂无结论，不伪造孕周，不增加第二个入口；详情头部不新增妊娠标识。
3. 在推演详情中复用 `.bioweave-projection-detail-meta` 的第一个状态徽标：疑似/未知保持观察状态，已确认改为“已确认怀孕”并复用同一个知情人弹层，不新增状态栏目。
4. 保留 routebar 页面切换、主题切换和固定演示终点控件，不添加 A/B/C 方案切换器。

验证：人物页与推演页的状态、知情名单均可追踪到同一妊娠人物分组；总览不新增妊娠摘要；且没有新增独立 shell 或方案切换器。

## 阶段 3：尺寸与可访问性检查

1. 检查 `1200x800` Desktop、`1024x800` Tablet、`390x844` Mobile。
2. 检查 Mobile 无页面级横向滚动，列表/详情顺序符合现有页面约定。
3. 检查按钮、徽标、details、aria-label、弹层外部点击关闭和键盘 Escape 关闭。
4. 检查浅色、深色和 Tavern token 下对比度与语义色。

验证：原型在三种尺寸下保持当前 UI 密度和组件层级；没有生产 API 或持久化调用。

## 阶段 4：评审交付

1. 已在任务目录提供 `pregnancy-status-ui-addition-real-ui.html`（项目预览版）、`pregnancy-status-ui-addition-real-ui-standalone.html`（直接打开版）和 `production-pages.generated.js`（由生产 renderer 生成的固定页面输出）；`docs/UI_FULL_REFERENCE.html`、`docs/index.html` 和其它参考 HTML 保持未修改。
2. 已完成 Desktop 默认视口、页面切换、状态终点切换和知情人弹层展开/关闭验证；Mobile 以响应式 CSS 和静态检查为准，待真实宿主安装后再做最终验收。
3. 等用户确认增量展示位置后，记录最终取舍；生产实施另建任务。

当前任务状态：`in_progress`。原型不进入生产 UI，也不调用 API 或写入 Floor；新增文件只用于本任务预览。

## 计划验证命令

```bash
node --check <prototype-script-if-extracted>
git diff --check
```

若脚本全部内嵌 HTML，则以浏览器打开和三种 viewport 目视检查为主，不把原型测试冒充生产测试。

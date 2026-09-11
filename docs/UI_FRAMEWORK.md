# BioWeave UI Framework

状态：当前 UI 替换与后续 UI 修改的唯一视觉实现规范。

本文档描述 BioWeave 的页面框架、HTML 结构、CSS 语法、响应式规则、控件格式和验收方式。它只约束 UI 表现与交互接线，不改变 Runtime、AI、数据模型、世界书、事件分析或 Chat 保存机制。

## 规范优先级

发生冲突时按以下顺序执行：

1. docs/UI.md 与 docs/DEVELOPMENT.md 中的业务契约；
2. 本文档中的 UI 框架规则；
3. docs/UI_FRAMEWORK_EXAMPLE.html 中的结构和视觉示例；
4. work/bioweave-ui-concept/index.html 中的完整视觉原型；
5. docs/references/ 下没有被本文档明确引用的旧参考文件只作历史资料。

生产 UI 不是把静态原型直接复制进去。原型只提供布局、颜色、间距、控件形态和响应式方向；生产页面必须继续消费 Runtime DTO，并继续使用现有的 data-bioweave-* 事件钩子。

## 生产文件边界

| 文件 | 框架职责 |
| --- | --- |
| ui/app.js | 面板壳、路由、导航、事件委托、页面装载和 Runtime 接线 |
| ui/overview.js | 总览页面结构 |
| ui/characters.js | 人物列表和人物详情结构 |
| ui/events.js | 历史事件结构和编辑入口 |
| ui/projection.js | 推演页面或明确空状态 |
| ui/genealogy.js | 家系页面或明确空状态 |
| ui/world.js | 世界模型物种、类型、模块卡片和模块编辑结构 |
| ui/settings.js | 设置分组、来源树、正则、开关、下拉框和提示词结构 |
| ui/state.js | 分析状态页面或明确空状态 |
| style.css | 主题变量、组件样式、布局和三端媒体查询 |

index.js、manifest.json、settings.html 是插件入口和生命周期文件，完整替换 UI 时保持不动。ai/、core/、runtime/、storage/、context/、story/ 不是视觉层，保持不动。

## 视觉基线

BioWeave 使用深色、低装饰、信息密度适中的分析面板。视觉重点是清晰的层级，而不是大面积渐变或装饰性卡片。

### 颜色变量

生产 CSS 使用 --bioweave-* 前缀；独立示例使用 --bw-*，两者含义相同。

~~~css
:root {
  --bioweave-host: #0b1116;
  --bioweave-host-soft: #111a21;
  --bioweave-panel: #171f25;
  --bioweave-panel-raised: #1d272e;
  --bioweave-panel-soft: #202c34;
  --bioweave-text: #edf3f6;
  --bioweave-text-secondary: #c2cdd2;
  --bioweave-muted: #87959d;
  --bioweave-line: #33444e;
  --bioweave-line-soft: #293840;
  --bioweave-accent: #83c7ef;
  --bioweave-accent-soft: #203b4b;
  --bioweave-good: #7bd5ae;
  --bioweave-warn: #f1be72;
  --bioweave-danger: #f08e98;
  --bioweave-radius: 10px;
  --bioweave-radius-small: 7px;
}
~~~

颜色职责固定：正文使用 text，说明使用 muted，选中和聚焦使用 accent，成功/警告/错误分别使用 good/warn/danger。不要为单个页面重新发明一套颜色。

### 字体和尺寸

~~~css
font: 14px/1.5 system-ui, -apple-system, "PingFang SC",
  "Microsoft YaHei", sans-serif;

页面标题：22px；
页面小标题：16px；
卡片标题：14px；
辅助说明：11px–12px；
普通控件最小高度：32px；
触控控件最小命中区域：44px；
常用间距：4px、6px、8px、10px、12px、16px。
~~~

标题、标签、说明和数值默认靠左对齐。表格或行内容只有在数值比较需要时才右对齐。

## 页面结构语法

所有生产页面遵循同一层级：

~~~html
<main class="bioweave-page" data-bioweave-page="world">
  <header class="bioweave-page-head">
    <div class="bioweave-page-head-copy">
      <h1>世界模型</h1>
      <p>探索并管理当前聊天的世界观设定与生物规则</p>
    </div>
    <div class="bioweave-page-actions">
      <button class="bioweave-button primary" type="button">
        重新分析
      </button>
    </div>
  </header>

  <section class="bioweave-section">
    <header class="bioweave-section-head">
      <div>
        <h2>物种与生物类型</h2>
        <p>点击类型查看详细规则。</p>
      </div>
    </header>
    <!-- 页面内容 -->
  </section>
</main>
~~~

页面标题下的正文统一保留一级缩进。直接位于页面下的主要内容使用 bioweave-section、bioweave-surface 或相应页面专用容器，不把内容平铺到页面根节点。

### 通用组件名称

| 组件 | 生产类名 | 用法 |
| --- | --- | --- |
| 普通区块 | bioweave-section | 页面一级内容区 |
| 表面容器 | bioweave-surface | 需要独立边界的卡片 |
| 行 | bioweave-row | 总览、事件、人物等紧凑列表 |
| 主按钮 | bioweave-button primary | 主要动作 |
| 次按钮 | bioweave-button | 辅助动作 |
| 标签 | bioweave-badge | 状态、数量、来源 |
| 空状态 | bioweave-empty | 没有数据或功能尚未接入 |
| 设置分组 | bioweave-settings-group | 可折叠的设置主栏 |
| 世界物种卡 | bioweave-world-card | 物种选择 |
| 生物类型卡 | bioweave-type-card | 类型选择 |
| 世界模块 | bioweave-world-module | 一个独立查看/编辑模块 |
| 正则行 | bioweave-regex-row | 一条正则规则 |

独立 UI 参考例子见 docs/UI_FRAMEWORK_EXAMPLE.html。生产代码可以使用更具体的 bioweave-* 变体，但必须保持同样的层级和职责。

## 世界模型格式

世界模型采用“物种 → 生物类型 → 当前类型模块”的层级。物种卡和类型卡使用按钮语义，不能用普通 div 模拟点击：

~~~html
<button
  class="bioweave-world-card selected"
  type="button"
  data-bioweave-action="select-species"
  data-bioweave-species="人类"
>
  <span class="bioweave-world-card-head">
    <b>人类</b>
    <small>当前选择</small>
  </span>
</button>
~~~

每个模块只有一个编辑入口，进入模块编辑后只显示当前模块的保存和取消：

~~~html
<article class="bioweave-world-module" data-bioweave-world-section="capabilities">
  <header class="bioweave-world-module-head">
    <h3>生殖能力</h3>
    <button
      class="bioweave-button small"
      type="button"
      data-bioweave-action="edit-section"
      data-bioweave-section="capabilities"
    >编辑</button>
  </header>
  <div class="bioweave-world-module-body">
    <!-- 只读字段或当前模块编辑器 -->
  </div>
</article>
~~~

编辑状态使用现有的 data-bioweave-world-section-form、data-bioweave-world-section-field 和 data-bioweave-world-section-row。UI 不根据名称、性别、代词、外貌或类型名称推断生物能力；true、false、null 的显示由 Runtime DTO 决定。

## 设置格式

设置页面的主层级使用可点击标题展开/折叠。上级标题加粗、字号较大；下级来源目录字号更小且不加粗。勾选框本身必须与 label 正确绑定，点击标题区域只展开折叠，不替代勾选：

~~~html
<details class="bioweave-settings-group" open>
  <summary class="bioweave-settings-head">
    <span class="bioweave-settings-chevron" aria-hidden="true">⌄</span>
    <span class="bioweave-settings-title">
      <b>世界书来源</b>
      <small>选择当前分析所使用的资料</small>
    </span>
  </summary>
  <div class="bioweave-settings-body">
    <details class="bioweave-source-branch" open>
      <summary class="bioweave-source-branch-head">
        <span>角色卡字段</span>
      </summary>
      <label class="bioweave-source-child">
        <input type="checkbox" data-bioweave-analysis-source="field:name">
        <span>角色名称</span>
      </label>
    </details>
  </div>
</details>
~~~

设置必须继续支持 API 来源、模型下拉框、开关、世界书多级来源树、正则增删/启停/上下移动、外部记忆、世界分析提示词和调试预览。任何一个控件都不能只做静态外观。

### 正则行

正则行保持紧凑，一行优先展示。左侧提取/清洗列缩短，右侧上下移动按钮垂直紧挨，按钮整体顶部和底部与正则框对齐：

~~~html
<div class="bioweave-regex-row">
  <div class="bioweave-regex-move" aria-label="调整顺序">
    <button type="button" aria-label="上移">↑</button>
    <button type="button" aria-label="下移">↓</button>
  </div>
  <select aria-label="处理阶段">
    <option>提取</option>
    <option>清洗</option>
  </select>
  <input aria-label="查找正则" placeholder="查找表达式">
  <input aria-label="替换内容" placeholder="替换内容">
  <label class="bioweave-switch">
    <input type="checkbox" checked>
    <span aria-hidden="true"></span>
  </label>
  <button class="bioweave-button small" type="button">删除</button>
</div>
~~~

## 三端规则

生产 UI 使用真实媒体查询，不使用原型中的 body[data-device] 作为运行时布局依据：

~~~css
@media (min-width: 1200px) { /* Desktop：左侧完整导航 */ }
@media (min-width: 768px) and (max-width: 1199px) {
  /* Tablet / iPad：顶部紧凑导航，单列内容 */
}
@media (max-width: 767px) {
  /* Mobile：顶部标题栏目，单列卡片，避免横向滚动 */
}
~~~

桌面端使用左侧完整导航；iPad 端使用顶部紧凑导航；手机端标题和栏目在顶部平铺，内容单列，设置展开后不能被右侧下拉框撑变形。横向滚动只允许出现在明确需要横向浏览的卡片组，并且不能让整个页面出现横向溢出。

## 事件和数据规则

页面只展示 Runtime 提供的数据：

1. 页面模块负责渲染 DTO；
2. ui/app.js 负责现有事件委托和 Runtime 调用；
3. UI 不重新实现 Floor Version、Tracking、资格判断、世界模型推断或数据保存；
4. 所有 DTO 文本继续使用现有 HTML 转义函数；
5. API Key、Secret、Raw AI Response 等敏感内容不进入展示、日志或静态例子；
6. 没有真实业务数据时使用明确 Empty State，不使用 demo 人物、demo 事件或假统计。

## 后续修改流程

以后任何 UI 修改都按以下顺序：

1. 先读本文档和 docs/UI_FRAMEWORK_EXAMPLE.html；
2. 再读目标页面模块和 ui/app.js 中对应的事件钩子；
3. 先写出要保留的 data-bioweave-* 接口和三端验收点；
4. 修改对应页面模块和 style.css，不新增第二套并行 UI；
5. 运行 npm run check 和 git diff --check；
6. 在 SillyTavern 中重新加载插件，分别验证 Desktop、iPad、Mobile；
7. 确认新结构稳定后，删除由本次迁移遗留的旧类名、旧模板和未使用 CSS；
8. 最终报告修改文件、保留的事件钩子、测试结果和仍需手动验证的项目。

## 验收清单

- [ ] 八个路由都能打开、关闭并重新打开。
- [ ] Desktop、iPad、Mobile 均无页面级横向溢出。
- [ ] 页面标题下内容有统一缩进，卡片和表格高度紧凑。
- [ ] 世界物种/类型卡可选择，模块只有一个编辑入口，保存/取消有效。
- [ ] 世界书来源支持多级折叠、父子勾选和半选状态。
- [ ] 下拉框、折叠栏、checkbox、switch、正则上下按钮均可操作。
- [ ] 正则上下按钮与正则行顶部/底部对齐并且彼此紧挨。
- [ ] 旧 UI 不再参与渲染，没有两套 UI 同时存在。
- [ ] 生产业务数据、权限边界、敏感信息处理和现有测试契约未被改变。


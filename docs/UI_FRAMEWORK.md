# BioWeave UI Framework

状态：当前 UI 替换与后续 UI 修改的唯一视觉实现规范。

本文档描述 BioWeave 的页面框架、HTML 结构、CSS 语法、响应式规则、控件格式和验收方式。它只约束 UI 表现与交互接线，不改变 Runtime、AI、数据模型、世界书、事件分析或 Chat 保存机制。

## 规范优先级

发生冲突时按以下顺序执行：

1. docs/UI.md 与 docs/DEVELOPMENT.md 中的业务契约；
2. 本文档中的 UI 框架规则；
3. docs/UI_FRAMEWORK_EXAMPLE.html 中的结构和视觉示例；
4. docs/UI_FULL_REFERENCE.html 中的完整八页面视觉原型；
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

生产壳层固定为 `bioweave-panel > bioweave-app-header + bioweave-routebar + bioweave-main`。八个页面路由在 routebar 中平铺，导航标签统一使用两字短标签“总览 / 人物 / 事件 / 推演 / 家系 / 世界 / 设置 / 状态”；页面内部标题仍可使用完整业务名称。不再使用桌面侧栏、手机底部导航或“更多”弹出菜单。

index.js、manifest.json、settings.html 是插件入口和生命周期文件，完整替换 UI 时保持不动。ai/、core/、runtime/、storage/、context/、story/ 不是视觉层，保持不动。

## 视觉基线

BioWeave 使用低装饰、信息密度适中的生物观测面板。默认夜间主题保留深蓝灰基底；日间主题使用低亮度雾灰蓝，不使用刺眼的纯白大面积背景；跟随酒馆主题调用 SillyTavern 的宿主色变量，并用同一套语义色保证控件层级稳定。视觉重点是清晰的层级，而不是大面积渐变或装饰性卡片。

### 颜色变量

生产 CSS 使用 --bioweave-* 前缀；独立示例可以使用 --bw-*，但不得将示例类名或示例数据复制到生产 UI。

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
  --bioweave-panel-border: #42545e;
  --bioweave-header: #19232a;
  --bioweave-routebar: #141d23;
  --bioweave-hover: #1a2830;
  --bioweave-card: #1a252c;
  --bioweave-card-selected: #203744;
  --bioweave-control-surface: #162129;
  --bioweave-primary-border: #5f9cc0;
  --bioweave-danger-border: #774852;
  --bioweave-indent-line: #465862;
  --bioweave-radius: 10px;
  --bioweave-radius-small: 7px;
}
~~~

颜色职责固定：正文使用 text，说明使用 muted，选中和聚焦使用 accent，成功/警告/错误分别使用 good/warn/danger。不要为单个页面重新发明一套颜色。

### 主题和顶部图标控件

主题仍保留三个运行值：`tavern`（跟随酒馆）、`light`（日）和 `dark`（夜），存储键和 `data-bioweave-action="cycle-theme"` 不变，循环顺序为跟随酒馆 → 日 → 夜。顶部只显示当前主题图标，不显示“日 / 夜 / 跟随酒馆”文字；当前值必须通过 `aria-label` 和 `title` 暴露给辅助技术和鼠标提示。图标使用 `fa-circle-half-stroke`、`fa-sun`、`fa-moon`，按钮在 Mobile 也保留，不能隐藏：

~~~html
<button
  class="bioweave-theme-button"
  type="button"
  data-bioweave-action="cycle-theme"
  data-bioweave-theme-button
  title="主题：跟随酒馆（点击切换）"
  aria-label="主题：跟随酒馆，点击切换"
>
  <i class="fa-solid fa-circle-half-stroke" data-bioweave-theme-icon aria-hidden="true"></i>
</button>
~~~

三套主题的核心颜色职责如下，完整 token 和宿主变量映射以 `docs/ui-framework.config.json` 为准：

| 主题 | 基底 | 面板 | 正文 | 交互色 | 设计意图 |
| --- | --- | --- | --- | --- | --- |
| 夜 | `#171f25` | `#1d272e` | `#edf3f6` | `#83c7ef` | 深蓝灰、低装饰、长时间阅读 |
| 日 | `#cbd6db` | `#e5ecef` | `#1b2a33` | `#356f91` | 雾灰蓝、避免纯白和强眩光 |
| 跟随酒馆 | `--SmartThemeBlurTintColor` | 宿主色的受控混合 | `--SmartThemeBodyColor` | `--SmartThemeQuoteColor` | 调用酒馆主题但保持 BioWeave 层级 |

日间主题的 surface、input、card 只使用低亮度灰蓝变体；成功、警告和错误仍分别使用绿色、琥珀色和红色，不能因为切换主题而改变语义。跟随酒馆主题必须使用 `--SmartThemeBlurTintColor`、`--SmartThemeBodyColor` 和 `--SmartThemeQuoteColor`，缺失时才使用配置中的低对比 fallback。调试预览 Popup 与主面板共用这三套 token。

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

应用壳层的结构语法如下；routebar 的按钮由 `ui/app.js` 根据现有 `pages` 映射生成，不能写死业务数据：

~~~html
<section id="bioweave-panel" class="bioweave-panel">
  <header class="bioweave-app-header">...</header>
  <nav class="bioweave-routebar" aria-label="BioWeave 页面导航">
    <div class="bioweave-route-items">
      <button class="bioweave-route-item active" data-route="world">世界</button>
    </div>
  </nav>
  <main class="bioweave-main"></main>
</section>
~~~

Desktop 和 iPad 的 routebar 使用横向 flex，每个路由按钮保持最小 72px 宽度并完整平铺，字号 14px；Mobile 切换为四列网格，八个两字路由分两行显示，字号 13px。路由栏本身不能再套用“父级八列 Grid + 子级八列 Grid”的双重网格写法，否则按钮会被压在同一列发生叠加。

页面标题下的正文统一保留一级缩进。直接位于页面下的主要内容使用 bioweave-section、bioweave-surface 或相应页面专用容器，不把内容平铺到页面根节点。

### 通用组件名称

| 组件 | 生产类名 | 用法 |
| --- | --- | --- |
| 普通区块 | bioweave-section | 页面一级内容区 |
| 表面容器 | bioweave-surface | 需要独立边界的卡片 |
| 行 | bioweave-row | 总览、事件、人物等紧凑列表 |
| 主按钮 | bioweave-button primary | 主要动作；保留 accent-soft 填充 |
| 次按钮 | bioweave-button | 辅助动作；使用 panel-raised 填充 |
| 危险按钮 | bioweave-button danger | 删除等危险动作；只使用 danger 边框和文字 |
| 文本按钮 | bioweave-text-button | 页面内的低强调跳转或辅助入口 |
| 下拉框 | bioweave-select | 使用原生下拉箭头，不隐藏可展开提示 |
| 标签 | bioweave-badge | 状态、数量、来源；使用 `good` / `warn` / `danger` 语义色 |
| 空状态 | bioweave-empty | 没有数据或功能尚未接入 |
| 设置分组 | bioweave-settings-group | 可折叠的设置主栏 |
| 世界物种卡 | bioweave-world-card | 物种选择 |
| 生物类型卡 | bioweave-type-card | 类型选择 |
| 世界模块 | bioweave-world-module | 一个独立查看/编辑模块 |
| 正则行 | bioweave-regex-row | 一条正则规则 |
| 原生勾选框 | bioweave-checkbox | 16px 原生 checkbox；使用 accent-color，保留 indeterminate |
| 外部记忆列表 | bioweave-external-memory-list | 单列来源列表；状态来自 Runtime provider |

控件语法参考见 docs/UI_FRAMEWORK_EXAMPLE.html，完整八页面视觉参考见 docs/UI_FULL_REFERENCE.html。生产代码可以使用更具体的 bioweave-* 变体，但必须保持同样的层级和职责。

状态徽标必须沿用概念页的胶囊形样式：22px 高、`2px 7px` 内边距、999px 圆角、透明背景。成功/已选/有效使用 `good`，处理中/较可能使用 `warn`，失败/否定使用 `danger`；世界书来源的“已选数量”即使处于部分选择也使用绿色 `good`，黄色只表示 checkbox 的 `indeterminate` 状态；没有明确语义时使用中性徽标，不根据文案猜测业务状态。

## 世界模型格式

世界模型采用“物种卡网格 → 当前物种的生物类型卡网格 → 当前类型模块”的层级。物种卡和类型卡使用按钮语义，不能用普通 div 模拟点击；类型卡不能继续嵌套在每张物种卡内部。类型超过三项时不截断、不改名：所有类型保持 Runtime 数组顺序，点击只改变选中样式，不重新排序或交换左右位置，在类型卡网格中自然换行。物种卡显示 Runtime 提供的物种名称，副文案显示 `N 个类型 · 类型 / 类型`；类型卡显示 Runtime 提供的 `species[].biological_types[].name`，副文案显示 `已知数/总能力数 项能力已知 · 妊娠状态`。妊娠状态只读取对应类型的 `capabilities.can_carry_pregnancy`，保留 true / false / null 三态；不再把原始 description 当作这两行摘要，也不根据名称、性别、代词或外貌补造能力。下面的名称只用于演示结构，不是生产枚举：

~~~html
<button
  class="bioweave-world-card selected"
  type="button"
  data-bioweave-action="world-model-select-species"
  data-bioweave-species="潮汐生物"
>
  <span class="bioweave-world-card-head">
    <b>潮汐生物</b>
    <small>当前选择</small>
  </span>
  <small class="bioweave-world-model-card-summary">2 个类型 · 潮汐生物型 / 甲型</small>
</button>
~~~

类型卡副文案也必须使用独立的结构类名：

~~~html
<button class="bioweave-type-card" type="button" data-bioweave-action="world-model-select-type">
  <span class="bioweave-world-model-type-card-head">
    <b>甲型</b>
    <small>可选</small>
  </span>
  <small class="bioweave-world-model-type-card-summary">4/5 项能力已知 · 不可承担妊娠</small>
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
      data-bioweave-action="world-model-edit-section"
      data-bioweave-section="capabilities"
    >编辑</button>
  </header>
  <div class="bioweave-world-module-body">
    <!-- 只读字段或当前模块编辑器 -->
  </div>
</article>
~~~

能力模块编辑使用原生 checkbox，不再使用三态下拉框。`true` 初始为勾选，`false` 初始为未勾选，`null` 初始为 `indeterminate`；交互后由现有表单读取逻辑写回 true / false，未操作的 indeterminate 继续保存为 null：

~~~html
<label class="bioweave-world-model-capability-check">
  <span class="bioweave-world-model-capability-copy">
    <strong>可承担妊娠</strong>
    <small>勾选表示是；未勾选表示否。</small>
  </span>
  <input
    class="bioweave-checkbox bioweave-world-model-capability-input"
    type="checkbox"
    data-bioweave-world-section-field="can_carry_pregnancy"
    data-bioweave-world-capability-input
    data-bioweave-world-capability-state="unknown"
    aria-checked="mixed"
  >
</label>
~~~

物种选择区使用 `bioweave-world-model-card-head`、`bioweave-world-model-card-title`、`bioweave-world-model-card-mark` 和 `bioweave-world-model-card-summary` 组成物种卡；物种卡副文案必须使用 Runtime 的 `biological_types` 生成“`N 个类型 · 类型 / 类型`”，不能继续显示无关 description。生物类型卡使用 `bioweave-world-model-type-card-head`、`bioweave-world-model-card-mark` 和 `bioweave-world-model-type-card-summary`；副文案必须按能力字段真实的 true / false 数量显示“`已知数/总能力数 项能力已知 · 可承担妊娠 / 不可承担妊娠 / 妊娠未知`”，不能从类型名称推断能力。选择区标题与卡片之间保持紧凑的 5px 底部间距，类型标题上方 5px、下方 4px；类型卡标题使用 Desktop 15px、Mobile 14px，不能因为增加字号而恢复大块留白。四个类型模块“生殖能力、生殖规则、生命周期、特殊规则”必须在当前类型详情面板内组成一个连续的纵向模块组，不使用 2×2 分散卡片；Desktop 的生物类型详情与右侧世界级规则按 6:4 分栏，iPad / Mobile 退回单列。能力表格使用紧凑的两列：`否`左对齐，`是`右对齐并使用 `success` 色且保留 8px 右侧内缩，`未知`右对齐并使用 `warn` 色且保留同样内缩。医疗与照护表格单独使用 `minmax(92px, max-content) minmax(0, 1fr)` 和 5px 列间距，避免右侧内容离左侧过远。编辑状态使用现有的 data-bioweave-world-section-form、data-bioweave-world-section-field 和 data-bioweave-world-section-row；能力编辑采用原生 `bioweave-checkbox`，true 为勾选、false 为不勾选、null 使用 indeterminate，交互后仍保留 null / 未知语义。UI 不根据名称、性别、代词、外貌或类型名称推断生物能力；true、false、null 的显示由 Runtime DTO 决定。

## 设置格式

设置页面的主层级使用可点击标题展开/折叠，首层栏不额外向右缩进；同级首层栏之间使用紧凑的 `3px` 间距。首层栏按概念页保持“左侧 18px 方形 `+` / `−`、中间标题说明、右侧状态徽标”的顺序；折叠时右侧状态徽标保持中性色，展开时才按 Runtime 状态使用语义色。主栏标题使用 15px/700，副说明使用 11px/400，展开时显示 accent 左竖线。世界书来源按“角色卡 → 全局世界书 → 附加角色世界书 → 其他世界书”四个同级来源栏排列，父栏使用 13px/700，下级目录使用 11px/400 且不加粗。来源父栏右侧必须显示已选数量并把折叠标记放在最右侧；只要存在已选内容，数量徽标使用绿色 `good`，半选黄色只用于父级 checkbox 本身。子项右侧显示“已选”或“未选”状态徽标。勾选框本身必须与 label 正确绑定，点击标题区域只展开折叠，不替代勾选：

折叠栏本身不能写死夜间色：首层标题背景使用 `var(--bioweave-header)`，展开背景和 hover 使用 `var(--bioweave-card-selected)`，body 使用 `var(--bioweave-surface-raised)`，分隔线使用 `var(--bioweave-border)`；世界书来源子栏标题使用 `var(--bioweave-surface-soft)`，子项使用 `var(--bioweave-surface)`。这些映射必须跟随日、夜、跟随酒馆三套主题 token 一起变化。

API 来源 body 的顺序固定为“API 来源单选项 → 超时（秒）/重试次数 → 独立 API 配置（独立 API 时显示，内部依次为标题、默认 API 配置、已保存配置、编辑器）→ 安全提示”。独立 API 配置是平面 body，不再嵌套旧的 `details/summary`；已保存配置列表每行只显示保存时的配置名称，使用 32px 左右的紧凑单行布局，超出宽度使用省略号，编辑/删除按钮固定在右侧；服务商、模型、地址和密钥状态只在编辑器中显示，不在保存列表重复展开。所有 `bioweave-select` 保留原生下拉箭头，不隐藏可下拉提示。单选项文字、请求字段文字和现有 `data-bioweave-api-*` hooks 必须保留，不能为了贴近示例删除 Profile、模型下拉框、测试连接或 Secret Store 行为。

分析提示词 body 不再重复显示第二个“分析提示词”标题，只保留首层设置栏标题；字段顺序和文字固定为“顶部 SYSTEM、分析任务补充、输入前说明、输入后说明、尾部 SYSTEM”。保存和“高级 / 调试”操作位于 body 底部，字段 key、保存逻辑和调试 Popup 入口不变。

~~~html
<details class="bioweave-settings-group" open>
  <summary class="bioweave-settings-head">
    <span class="bioweave-settings-chevron" aria-hidden="true">−</span>
    <span class="bioweave-settings-title">
      <b>世界书来源</b>
      <small>选择当前分析所使用的资料</small>
    </span>
    <span class="bioweave-badge good">4 项已选</span>
  </summary>
  <div class="bioweave-settings-body">
    <details class="bioweave-source-branch" open>
      <summary class="bioweave-source-branch-head">
        <span class="bioweave-source-branch-select"><input class="bioweave-checkbox" type="checkbox" checked><span><strong>角色卡</strong><small>当前角色卡可读取字段</small></span></span>
        <span class="bioweave-source-branch-tools"><span class="bioweave-badge good">2/3 项</span><span class="bioweave-source-branch-chevron" aria-hidden="true">−</span></span>
      </summary>
      <div class="bioweave-source-child-list">
      <label class="bioweave-source-child">
        <input type="checkbox" data-bioweave-analysis-source="field:name">
        <span><strong>角色名称</strong><small>约 12 tokens</small></span>
        <span class="bioweave-badge">未选</span>
      </label>
      </div>
    </details>
    <details class="bioweave-source-branch">
      <summary class="bioweave-source-branch-head">
        <span class="bioweave-source-branch-select"><input class="bioweave-checkbox" type="checkbox"><span><strong>全局世界书</strong><small>当前酒馆已开启的全局来源</small></span></span>
        <span class="bioweave-source-branch-tools"><span class="bioweave-badge good">1/3 项</span><span class="bioweave-source-branch-chevron" aria-hidden="true">+</span></span>
      </summary>
    </details>
    <details class="bioweave-source-branch">
      <summary class="bioweave-source-branch-head">
        <span class="bioweave-source-branch-select"><input class="bioweave-checkbox" type="checkbox"><span><strong>附加角色世界书</strong><small>与当前角色关联的世界书</small></span></span>
        <span class="bioweave-source-branch-tools"><span class="bioweave-badge">未选</span><span class="bioweave-source-branch-chevron" aria-hidden="true">+</span></span>
      </summary>
    </details>
    <details class="bioweave-source-branch">
      <summary class="bioweave-source-branch-head">
        <span class="bioweave-source-branch-select"><input class="bioweave-checkbox" type="checkbox"><span><strong>其他世界书</strong><small>未归类的可用来源</small></span></span>
        <span class="bioweave-source-branch-tools"><span class="bioweave-badge">未选</span><span class="bioweave-source-branch-chevron" aria-hidden="true">+</span></span>
      </summary>
    </details>
  </div>
</details>
~~~

来源父栏的左侧 checkbox 负责该来源组的全选/取消全选，并用原生 `indeterminate` 表示半选；右侧徽标只表达 Runtime 已提供的选择状态，不能代替父级 checkbox，也不能凭名称推断条目是否可用。生产实现可用更具体的 `bioweave-analysis-*` 类名，但必须保留相同的视觉层级：父栏有 checkbox、数量徽标和最右侧 `+` / `−`，子项有缩进、较小字号和“已选/未选”徽标。

checkbox 使用概念页同款的原生尺寸和 accent 状态，不让宿主的全局 checkbox 样式覆盖生产控件；半选状态只把 checkbox accent 改为黄色，不能把右侧来源状态徽标改成黄色：

~~~css
.bioweave-checkbox,
.bioweave-panel input[type="checkbox"] {
  width: 16px;
  height: 16px;
  accent-color: var(--bioweave-accent);
  appearance: auto;
}
.bioweave-checkbox:indeterminate,
.bioweave-panel input[type="checkbox"]:indeterminate {
  accent-color: var(--bioweave-warn);
}
~~~

外部记忆来源使用单列列表。每一行都同时显示真实探测结果的“可用”或“不可用”状态；不可用来源继续保留 disabled 语义，不能用静态文案伪造可用能力：

~~~html
<div class="bioweave-external-memory-list">
  <label class="bioweave-external-memory-option">
    <input class="bioweave-checkbox" type="checkbox" data-bioweave-external-memory="provider-key">
    <span><strong>读取来源</strong><small>Runtime provider 返回的状态说明</small></span>
    <span class="bioweave-badge good">可用</span>
  </label>
</div>
~~~

设置必须继续支持 API 来源、模型下拉框、开关、世界书多级来源树、正则增删/启停/上下移动、外部记忆、世界分析提示词和调试预览。最近剧情使用同一个设置主栏 body：读取楼数和用户楼开关位于顶部双列网格，桌面保持均分，移动端使用 `1.15fr .85fr` 紧凑双列并保留 4px 间距；下方两个正则 scope 使用紧凑分隔线，不再嵌套第二套卡片壳。任何一个控件都不能只做静态外观。

### 正则行

正则行保持紧凑，一行优先展示。左侧提取/清洗列缩短，右侧上下移动按钮垂直紧挨，按钮整体顶部和底部与正则框对齐：

~~~html
<div class="bioweave-regex-row">
  <small>#1</small>
  <select aria-label="处理阶段">
    <option>提取</option>
    <option>清洗</option>
  </select>
  <input aria-label="查找正则" placeholder="查找表达式">
  <label class="bioweave-switch">
    <input type="checkbox" checked>
    <span aria-hidden="true"></span>
  </label>
  <div class="bioweave-regex-move" aria-label="调整顺序">
    <button type="button" aria-label="上移">↑</button>
    <button type="button" aria-label="下移">↓</button>
  </div>
  <button class="bioweave-button small" type="button">删除</button>
</div>
~~~

正则行桌面列定义为 `auto 72px minmax(150px, 1.7fr) auto auto auto`，提取/清洗列保留完整文字和原生箭头所需宽度；行内上下按钮宽 20px、无间隙、上下边缘与正则行框对齐。移动端使用 `18px 60px minmax(0, 1fr) 28px 20px 28px` 六列压缩版，行高 32px，输入框与同行按钮完整显示，提取/清洗下拉框保留原生下拉箭头；开关圆点显式固定在轨道内部右侧，不叠加旧版绝对定位位移。所有同行元素垂直居中且正则输入列不能挤压右侧按钮，也不允许页面级横向滚动。

## 三端规则

生产 UI 使用真实媒体查询，不使用原型中的 body[data-device] 作为运行时布局依据：

~~~css
@media (min-width: 1200px) { /* Desktop：顶部完整路由栏 */ }
@media (min-width: 768px) and (max-width: 1199px) {
  /* Tablet / iPad：顶部紧凑路由栏，单列内容 */
}
@media (max-width: 767px) {
  /* Mobile：标题与路由在顶部平铺成紧凑网格，单列卡片 */
}
~~~

Desktop、iPad 和 Mobile 都使用顶部 routebar，区别只在可用宽度、内边距和路由按钮的密度：Desktop 展示完整八个路由，iPad 保持完整路由但缩短标签间距，Mobile 使用四列多行网格平铺全部路由。主题图标按钮在三端都位于顶栏右侧，Mobile 只缩小命中区域内的图标，不隐藏控件。内容单列或按页面需要分栏，设置展开后不能被右侧下拉框撑变形；禁止页面级横向滚动，局部横向滚动只允许用于明确的内容容器。

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

1. 先读本文档、docs/ui-framework.config.json、docs/UI_FRAMEWORK_EXAMPLE.html 和 docs/UI_FULL_REFERENCE.html；
2. 再读目标页面模块和 ui/app.js 中对应的事件钩子；
3. 先写出要保留的 data-bioweave-* 接口和三端验收点；
4. 修改对应页面模块和 style.css，不新增第二套并行 UI；
5. 运行 npm run check 和 git diff --check；
6. 在 SillyTavern 中重新加载插件，分别验证 Desktop、iPad、Mobile；
7. 确认新结构稳定后，删除由本次迁移遗留的旧类名、旧模板和未使用 CSS；
8. 最终报告修改文件、保留的事件钩子、测试结果和仍需手动验证的项目。

## 验收清单

- [ ] 八个路由都能打开、关闭并重新打开。
- [ ] Desktop、iPad、Mobile 顶部都有统一 routebar，且均无页面级横向溢出。
- [ ] 页面标题下内容有统一缩进，卡片和表格高度紧凑。
- [ ] 世界物种/类型卡可选择，模块只有一个编辑入口，保存/取消有效。
- [ ] 世界书来源支持多级折叠、父子勾选和半选状态。
- [ ] 下拉框、折叠栏、checkbox、switch、正则上下按钮均可操作。
- [ ] 正则上下按钮与正则行顶部/底部对齐并且彼此紧挨。
- [ ] 旧 UI 不再参与渲染，没有两套 UI 同时存在。
- [ ] 生产业务数据、权限边界、敏感信息处理和现有测试契约未被改变。

## 配置同步规则

docs/ui-framework.config.json 是本框架的机器可读配置，也是字体、颜色、间距、尺寸、断点、组件和事件钩子的集中登记处。任何 UI 调整都必须同步检查它。

同步顺序固定为：

1. 先更新 ui-framework.config.json 中的 token、组件、断点或事件映射；
2. 再更新本文档中的说明和语法；
3. 再更新 UI_FRAMEWORK_EXAMPLE.html 和 UI_FULL_REFERENCE.html，使例子能反映新规则；
4. 最后修改生产 ui/*.js 与 style.css；
5. 新增控件必须同时补充组件登记、交互钩子、响应式规则和验收项。

字体、颜色、按钮、控件、边距、圆角或响应式规则不得只写在生产 CSS 里。配置文件不得写入 Runtime 数据、Chat 数据、模拟业务数据、API Key 或 Secret。

# 实施计划

## 执行顺序

1. 复核当前任务 artifacts、分支状态、既有 diff，并运行只读基线检查；确认 `ai/analyzer.js` 是否仍没有 Human 来源关键词逻辑。
2. 运行 `trellis-before-dev`：读取当前 task artifacts、frontend spec index、quality 与 cross-layer guide；在写产品代码前记录最小 change boundary。
3. 修改 `ai/prompts.js`：将 Human 段落收敛为“条件性隐含 Human baseline + Baseline + Delta”，明确逐字段优先级、Nonhuman 排除、当前 species 与来源分离；合并而不是重复堆加现有语义。
4. 在 `tests/world-model.test.js` 增加全新原创 fixture：优先测试 Prompt contract；通过 mocked AI response 验证隐含 Human 输出可走现有 baseline、delta 字段不被清空、Nonhuman/来源不明保持未知，以及新 type/新 species 不被名称自动创造。
5. 审计发现 Analyzer 原有 Human 字段证据 gate 要求同一证据单元出现 Human species 标签，会阻止无显式 Human 字样的合法当前 delta；因此仅放宽为按已成立 type 的直接证据定位字段，不加入任何世界观关键词。
6. 如正式数据模型文档仍把显式 Human 写法描述成必要条件，最小同步 `docs/DATA-MODEL.md`；不触碰其他文档。
7. 运行验证：
   - `node --test tests/world-model.test.js`
   - `npm test`
   - `npm run check`
   - `node --check ai/prompts.js`
   - `node --check ai/analyzer.js`（若本轮未改也验证工作区语法）
   - `git diff --check`
8. 检查完整 diff、文件范围、生产 Prompt/Analyzer 世界观无关性，更新任务记录，生成中文 commit message 并提交；报告 commit hash。

## 预期主动修改文件

- `ai/prompts.js`：Prompt Contract 和 Baseline + Delta 语义。
- `tests/world-model.test.js`：原创隐含 Human / delta / Nonhuman 回归。
- `docs/DATA-MODEL.md`：仅在现有正式说明与新 fallback Contract 不一致时同步一段。

## 默认不修改

- `ai/analyzer.js`（除非确定性证据 gate 证明阻断合法输出）
- `storage/schema.js`、`ai/input-builder.js`
- `ui/world.js`、`style.css`
- Event、State、Projection、Runtime、API、Worldbook selector
- 不新增 registry、ontology、来源字段、依赖或大型 abstraction

## 回滚点

产品代码修改前保留当前工作区状态；若实现证明 Prompt-only 无法通过现有结构 guard，则停止扩展，先报告具体 guard 路径，不把来源推断硬编码进 Analyzer。

## 实际实现结果

- `ai/prompts.js`：把 Human baseline 改为有条件的隐含 Human 推断，并加入 Baseline + Delta 的逐字段覆盖优先级；保留 biological type、Nonhuman、fertilization、gestation、lifecycle 和 null/[] Contract。
- `ai/analyzer.js`：只调整 Human 当前字段证据的通用局部性 guard，使没有字面 Human 标签但明确指向已成立 type 的 delta 可以进入 Human Male/Female baseline；不新增 species、路线或世界观词典。
- `docs/DATA-MODEL.md`：同步隐含 Human fallback 和逐字段 delta 的正式语义。
- `tests/world-model.test.js`：增加无 Human 字样的默认背景、单字段 capability/rule delta、明确 Nonhuman、来源未知、永久转化后的当前 species label，以及对应 Prompt Contract 回归。

## 验证结果

- `node --test tests/world-model.test.js`：106/106 通过。
- `npm test`：206/206 通过。
- `npm run check`：通过，包含 `node --check index.js` 和全量测试。
- `node --check ai/prompts.js`、`node --check ai/analyzer.js`：通过。
- `git diff --check`：通过。

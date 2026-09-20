# World Analysis 手动维护种族与性别

## Goal

在当前 Floor-authoritative World Model 中，让用户能够在 World Analysis 页面手动新增和删除已有的物种与生物类型分类，并在刷新、Chat 切换和 Swipe 切换后保持正确的 Floor-owned 数据。

## Confirmed repository facts

- `storage/schema.js` 与 `ai/analyzer.js` 的当前 canonical schema 是 `world_model.species[]`；每个 species 是 object，包含 `name`、`description`、`biological_types[]`。
- 当前没有独立的 `gender` 字段。`biological_types[]` 是开放字符串的稳定生理/生殖分类数组，可包含男性、女性或自定义分类，不能被规范化为固定 gender enum。
- `world_model_meta` 没有独立 normalize schema；Runtime 的 `resolveWorldModelAtOrBefore()` 从当前有效 Floor 读取并 clone，`saveWorldModel()` 只替换 `world_model` / `world_model_meta` 并通过 `store.saveFloor()` 写回当前 Floor owner。
- World UI renderer 位于 `ui/world.js`，页面状态、事件委托、manual save/reload 位于 `ui/app.js`；当前已有 World Model section editor 和 save path，但没有 species/type collection 的增删操作。
- AI parser 为 `parseWorldModelResponse()`，随后经 `normalizeWorldModel()` 与 evidence/final consistency guards。World Model AI save 是完整 canonical replacement；当前没有 manual override/provenance 层。

## Requirements

- 在 World Analysis UI 中查看当前 `species[]`；编辑区域右上角只保留一组统一的无文字图标按钮新增、删除 species/type。
- 点击 species 或其 `biological_types[]` 条目建立独立的 runtime selection；种族 section 与 biological_types section 各自拥有一组 header actions。UI 标签固定为“性别 / 生物类型”，该集合必须属于当前具体 species，不能扁平化成全局列表。
- 新增使用 inline input 或现有 popup，不使用原生 `prompt()`；输入 trim，空值不保存；按 trim 后值去重，不做 aggressive 大小写或名称改写。
- 新增 species 时向当前 `world_model.species[]` 添加符合现有 schema 的完整 species object，`biological_types` 初始为空；不发明简化 schema。
- 新增/删除 type 时只修改指定 `species.biological_types[]`；删除 species 时只删除指定 species object 及其 own types，不影响其它 species。
- 增删只修改目标 collection，保留同一 `world_model` 其它字段和 `world_model_meta` 原值。
- 所有写入必须经过当前 Runtime `saveWorldModel()` → `store.saveFloor()`；不得写 Chat metadata、global settings、localStorage 或第二套 override 数据库。
- 保存必须遵守当前 Chat token、Floor Version、active Swipe、owner verification 与 stale-write protection；Swipe 之间不得互相污染。
- 保存成功后以 authoritative model 更新 UI；保存失败时不得留下未持久化的 optimistic state，并恢复/保持 persisted state。
- busy/loading/error/stale/analysis-in-progress 状态不得导致重复写或错误显示。
- 所有修改均为当前 Floor 的 authoritative `world_model` clone/update/save；不建立 manual override/provenance 层。历史 Floor 不修改，未来 World Analysis 的增量更新方向不在本任务提前重构；当前 AI 仍是完整 replacement。
- 保持 Character Analysis、Event Analysis、Prompt、API、Worldbook、Data Management clear semantics 与 Floor ownership/lifecycle architecture 不变。

## Acceptance criteria

- Species add/delete 与 biological type add/delete 都能保存、reload 后正确存在/消失。
- 空输入不触发保存；重复值按 trim 后不产生重复。
- 增删后 `world_model` 的其它字段 deepEqual 保持，`world_model_meta` deepEqual 保持。
- 在 Swipe 1 修改只影响 Swipe 1，切回 Swipe 0 仍显示 Swipe 0 自己的模型。
- Persistence failure 后 UI 不显示假数据，Runtime 可继续使用并可重试。
- AI re-analysis replacement 行为有明确测试或记录。
- 两组常驻图标按钮具有 `title` 与 `aria-label`；种族加号不依赖 selection，类型加号依赖 selected species，删除按钮依赖对应 selection；复用已加载 Font Awesome，不引入新 dependency；桌面/窄面板布局不溢出。
- 运行 `npm test`、`npm run check`、所有修改 JS 的 `node --check` 与 `git diff --check`；不 commit/push。

## Out of scope

- 新建独立 `gender` schema、manual override/provenance layer、Chat-level World Model、global manual species/gender、local storage。
- 修改 AI prompt/parser 语义、World Model evidence guard、Character/Event/Worldbook/API/lifecycle 清除逻辑。

## Resolved product decisions

- 采用“性别 / 生物类型”标签，并直接操作现有 `species[].biological_types[]`。
- `species` 是 `world_model.species[]` 中的 object；`biological_types` 必须隶属于具体 species。
- 当前 Floor 保存后刷新从当前有效 Floor 重新读取；历史 Floor 保持不变。
- `world_model_meta` 保持原样，不因手动 collection 修改而清空或重建。
- 本 PRD 的 blocking decision 已解决；进入最终规划审查后，需用户显式批准规划摘要，才能 `task.py start`。

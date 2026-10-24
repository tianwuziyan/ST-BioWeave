# Implementation plan

1. 建立独立 `storyline-ui-prototype.html`，写入 BioWeave token、shell、人物列表和详情布局。
2. 使用上一轮 API 返回的 3 条示例支线，渲染候选路线卡、前提、节点摘要和结论目标。
3. 增加原型状态切换：候选、已选、生成中、已结束/空状态；所有状态只存在内存。
4. 加入桌面、平板、移动端媒体查询，以及焦点、键盘和触控命中区处理。
5. 通过浏览器或静态检查确认 HTML 可直接打开，检查无生产文件改动。
6. 将当前有效 Projection Views 中的 `storyline_snapshots` 投影为安全业务 DTO，并接入 `ui/app.js` 的业务刷新与清理状态。
7. 在 `ui/projection.js` 中把候选、已选、生成中和已结束状态作为人物详情增量区块渲染，保留全部既有生理观察内容。
8. 在 `style.css`、UI 配置、规范和结构示例中同步生产支线区块的类名、状态和响应式约束。
9. 补充 Runtime/UI 回归测试，确认内部 snapshot/branch/node/Floor 字段不会进入普通可见文案。

## Validation

- `node --check`（如脚本抽出为独立 JS；内嵌脚本则使用浏览器控制台/静态语法检查）。
- `git diff --check`。
- 通过浏览器实际查看桌面与窄屏布局，确认没有横向滚动。
- `node --check` 覆盖所有变更的 Runtime/UI JavaScript。
- `node --test tests/ui.test.js tests/projection-runtime.test.js` 覆盖生产 DTO 转发与候选/已选/终止渲染。
- `npm run check` 作为全量回归；若存在与本任务无关的既有失败，记录具体测试名与原因。
- `python3 ./.trellis/scripts/task.py validate .trellis/tasks/10-24-projection-storyline-ui-prototype` 校验任务文档。

## Rollback point

原型部分仍可通过删除 `.trellis/tasks/10-24-projection-storyline-ui-prototype/storyline-ui-prototype.html` 撤销；生产部分按 DTO 转发、UI 增量区块、样式/文档和测试的同一变更边界回滚，不触及 Storyline Floor 数据。

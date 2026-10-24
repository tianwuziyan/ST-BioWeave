# Implementation plan

1. 建立独立 `storyline-ui-prototype.html`，写入 BioWeave token、shell、人物列表和详情布局。
2. 使用上一轮 API 返回的 3 条示例支线，渲染候选路线卡、前提、节点摘要和结论目标。
3. 增加原型状态切换：候选、已选、生成中、已结束/空状态；所有状态只存在内存。
4. 加入桌面、平板、移动端媒体查询，以及焦点、键盘和触控命中区处理。
5. 通过浏览器或静态检查确认 HTML 可直接打开，检查无生产文件改动。

## Validation

- `node --check`（如脚本抽出为独立 JS；内嵌脚本则使用浏览器控制台/静态语法检查）。
- `git diff --check`。
- 通过浏览器实际查看桌面与窄屏布局，确认没有横向滚动。

## Rollback point

原型只在 `.trellis/tasks/10-24-projection-storyline-ui-prototype/` 内新增；删除该目录即可撤销本次原型，不触及生产代码。

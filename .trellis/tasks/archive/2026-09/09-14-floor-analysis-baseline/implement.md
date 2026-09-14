# 执行计划

## 1. 实现 baseline helper

- [x] 在 `runtime/event-analysis.js` 增加按目标索引向前搜索的异步 helper。
- [x] 对候选复用 active Swipe、`getFloor`、`resolveFloor`、`floorVersionFromData`、`sameFloorVersion` 和 `getActiveFloorEvents`。
- [x] 确认候选 floor 严格早于目标，且无候选时返回 `{analysis: null, events: []}`。

## 2. 接入输入构造

- [x] 在 `buildFloorAnalysisInput` 使用 helper 返回值并在 await 后 assert Chat token。
- [x] 保持当前剧情输入、World Model、recent story、character context 和 API 参数不变。
- [x] 检查成功保存仍是同楼层覆盖，未增加提前删除或下游 invalidation。

## 3. 补充回归测试

- [x] 在 `tests/event-analysis-runtime.test.js` 添加最近有效前置 baseline、空 baseline、目标楼层自引用防护、stale 前置跳过、重复替换测试。
- [x] 测试直接捕获 analyzer 输入的 normalized `existing_bioweave`。
- [x] 保留并验证已有失败/取消保留旧成功事件的测试。

## 4. 验证与审查

- [x] `node --check runtime/event-analysis.js`。
- [x] `node --test tests/event-analysis-runtime.test.js`（34/34）。
- [x] `npm test`（432/432）。
- [x] `npm run check`（432/432）。
- [x] 检查实际 diff，仅包含 runtime、runtime tests、领域规范和本任务规划文件；确认没有 UI、storage schema 或下游 invalidation 变更。

## 风险与回滚点

- 主要风险是候选索引、active Swipe 或 Floor Version 使用错误；以测试中的内容 hash、message version、Swipe 和 floor 字段变更覆盖。
- 若失败，只需回滚 `runtime/event-analysis.js` 与对应测试，现有 save/失败语义不需迁移。
- 不执行 commit、push 或其他发布操作，除非另行获得明确授权。

## Verification results

- `node --check runtime/event-analysis.js`: passed。
- `node --test tests/event-analysis-runtime.test.js`: 34 passed, 0 failed。
- `npm test`: 432 passed, 0 failed。
- `npm run check`: 432 passed, 0 failed。
- 独立 lint/type-check：项目未配置对应脚本。

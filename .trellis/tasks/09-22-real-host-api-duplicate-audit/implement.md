# 实施计划

1. 读取任务上下文与 Floor/Data Lifecycle 约束；检查当前 scheduler、World resolver/UI、parser/prompt 和 ST event adapter。
2. 用附件建立可重复的证据检查：请求分类、输出 JSON/validator 结果、重复输入指纹与目标 Floor 元数据。
3. 先增加失败回归测试：真实 `GENERATION_ENDED -> CHARACTER_MESSAGE_RENDERED`、重复 CMR、同 Floor 失败不自旋、World Full 成功后 Event 失败再 Reuse、World UI resolver、typed symptom object。
4. 修复 Floor-Version terminal/dedupe/failed 状态，使同一个宿主周期不产生第二个实际 Analysis Job；不改变 interval、retryPaused、World hard dependency 等已确认语义。
5. 修复 Event prompt contract，使 typed payload 与既有 validator 完全一致，不放宽 validator。
6. 若测试证明 UI 空白来自 runtime resolver/refresh，做最小的 Floor-owned 读取或状态刷新修复；纯 `GENERATION_ENDED` / `MESSAGE_RECEIVED` 信号不得清空 World UI；不引入 Chat metadata 旁路。
7. 运行 `npm test`、`npm run check`、`node --check`、`git diff --check`，并审查旧 scheduler 残留与任务范围外 diff。
8. 增加 World UI-ready hard gate：共享 canonical view-model、当前 Floor root version read-back、失败 diagnostic 与 Event API zero-call 回归。
9. 增加 Runtime 状态到 `ui/app.js` toastr bridge，区分自动/手动结果、面板关闭/插件关闭，并验证 terminal 去重与初始化 fatal notification。
10. 增加 World Full/Patch/read-back/UI-ready/Event 的 Runtime phase status；由 `ui/app.js`、World page 和 Characters page 统一映射阶段级 busy/waiting 状态，不改变 World→Event 业务顺序。

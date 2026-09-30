# 审计执行计划

1. [ ] 完成仓库结构、AGENTS、Floor/生命周期规范与相关历史任务索引。
2. [ ] 建立 core/runtime/storage/ai/ui 的符号与引用索引。
3. [ ] 追踪 Character Floor → Analyzer → Identity → Event → persistence → Registry → Tracking → State → UI 的真实路径。
4. [ ] 逐项审计 Registry、Facts/Profile、BiologicalEvent、Tracking、StateReducer、Episode、Attribution、Story Time、Current State、Snapshot、Projection。
5. [ ] 阅读关联测试并运行现有只读测试/静态检查；记录真实 Host 未覆盖项。
6. [ ] 检查相关 Markdown 与代码的冲突并生成完整 A–R 审计报告。
7. [ ] 复核 git status/diff，确认生产代码、schema、Prompt、validator、Scheduler、World Analysis、UI 均未被修改。

## 验证命令

- `git status --short`
- `git diff -- <production paths>`
- `rg` 符号/引用搜索
- 仓库已有 `npm test` / `npm run check`（如耗时或环境不适合，说明原因）

## 禁止操作

不得执行写入生产文件、格式化全仓、自动修复、删除、重构、commit、push 或更新任何既有 phase task 状态。

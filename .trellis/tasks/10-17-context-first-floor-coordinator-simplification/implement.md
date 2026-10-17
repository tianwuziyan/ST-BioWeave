# Execute 计划

1. 阅读当前 Coordinator、Store、Runtime Adapter 和已存在的 Floor persistence 测试，记录旧行为基线。
2. 在现有 Coordinator 入口中用 Context Floor view 替代普通计算/合并阶段的官方 owner/latest GET；保留身份、owner、Swipe、Floor Version 和执行状态保护。
3. 在现有 host slot adapter 路径中保持消息/active Swipe 镜像和非 BioWeave 字段，改为一次原生保存后一次官方 readback；不新增生产 Writer。
4. 为 changed/no-op、兄弟字段、显式空集合、历史 Floor、生命周期变化、保存失败/readback 不一致及连续 owner 写入补充确定性测试。
5. 运行 focused tests、`npm run check` 和 `git diff --check`，审查 diff，确认未触碰真实 Chat、业务规则或 Schema。
6. 在 `audit-report.md` 记录新旧调用链、实际请求计数、失败语义、剩余外部并发限制和回退点。

## 回退点

本任务只修改 Coordinator/Storage/Runtime persistence seam 及测试和报告；若验收失败，回退本任务新增的生产 diff 即可恢复旧 Coordinator 路径，不能改动先前任务目录或无关工作区修改。

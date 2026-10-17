# 执行计划：当前 SillyTavern 宿主原生持久化能力验证

## 阶段 1：宿主与项目源码证据

- [ ] 定位本机实际 SillyTavern 安装、版本/commit/源码状态。
- [ ] 读取并记录 save/get 前后端调用链、队列/锁/CAS、事件和文件操作。
- [ ] 对照 BioWeave adapter、Store、Coordinator 和上一轮 native host 审计。
- [ ] 将每条关键声明写入 `research/host-source-evidence.md` 并附路径/行号。

## 阶段 2：隔离验证

- [ ] 新增只读 test-only host persistence model 或扩展现有隔离测试，不导入生产持久化实现。
- [ ] 用 deferred barrier 覆盖完成语义、debounce、顺序、字段冲突、旧状态覆盖、Chat/Swipe/消息生命周期和失败/未知结果。
- [ ] 每个测试标注 SOURCE_VERIFIED、ISOLATED_TEST_VERIFIED、HOST_RUNTIME_UNVERIFIED 或 UNKNOWN 边界。

## 阶段 3：报告与检查

- [ ] 编写本任务 `audit-report.md`，区分已证实事实、测试模型结果、未验证假设和真实宿主待验证项。
- [ ] 运行针对性测试。
- [ ] 运行 `npm run check`。
- [ ] 运行 `git diff --check`。
- [ ] 检查本轮没有生产逻辑、宿主源码或真实数据变化，并保留既有工作区修改。

# ST-BioWeave World Model 长聊天性能审计

## Goal

只读审计 fix/world-model-prompt-baseline 分支的 World Model/Floor 读取、事件触发、UI refresh 和长聊天性能，产出带 CONFIRMED/LIKELY/UNVERIFIED 分级的证据报告；不修改生产代码、真实聊天数据或 Git 历史。

## Background and confirmed facts

- 当前分支为 `fix/world-model-prompt-baseline`；任务创建前 worktree clean，HEAD 需在审计报告中记录。
- Floor ownership contract 要求 World Model、Event 和 derived state 只能从当前 Chat、active Swipe、完整六字段 Floor Version 的有效 Floor 读取；不得以 Chat-level map、message mirror 或 runtime cache 作为历史事实源。
- World Model 与 Character/Event Analysis 共享 Floor 基础设施，但各自拥有 resolver、normalizer、persistence 和业务语义。
- 当前架构导航将 `runtime/world-analysis.js` 作为 World owner，`runtime/event-analysis.js` 作为分析管线协调者，`storage/store.js` 作为 Floor storage abstraction，`runtime/sillytavern-adapter.js` 作为 Host I/O，`ui/app.js` 作为 UI orchestration，`ui/world.js` 作为 World presentation。
- 用户明确要求本轮只读：不修改生产代码、真实聊天数据、Floor persistence contract；不执行 World Full/Supplement、migration、commit、push、reset、clean，也不创建新的 World Model cache。

## Requirements

### R1. Repository and lifecycle preparation

- 记录当前 HEAD、branch、worktree 状态，并保留已有 worktree 修改。
- 阅读并遵守 Trellis、架构、Floor ownership、World Model 和 data lifecycle 规范。
- 检查 World Model/Floor 生命周期与 authoritative readback、archive、Swipe isolation、Chat isolation、message invalidation 约束。

### R2. World Model read-path audit

以实际代码追踪并标注调用链：

`resolveWorldModelAtOrBefore()` → `resolveCurrentBioWeaveFloor()` → `resolveFloorAtIndex()` → storage/adapter owner-slot reads → `reloadWorldModelFromRuntime()` / `loadWorldModelState()` → normalize/view-model/UI render。

审计历史 Floor 扫描方向、停止条件、重复 Floor/Storage 读取、重复 normalize、重复 view-model 构建、深拷贝、JSON serialization，以及消息数量增长后的开销。

本项必须优先从“打开 BioWeave UI”完整初始化调用链开始，不得预设历史 Floor 扫描为根因。至少检查 UI 打开时的 World Model 自动读取、重复 resolver、同一 Floor 重复读取、normalize/structuredClone/JSON.stringify、未打开页面数据预构建、批量 View Model 构建、组件重复渲染和多个 UI lifecycle/refresh event 对同一 World 数据的重复处理。

性能分析必须分别控制并报告：A) 消息/Floor 数量，B) 当前 World Model 数据体积，C) 历史 World Model 快照数量，D) UI 初始化/渲染成本；不得将四者合并为一个“聊天变长”变量。

### R3. Event and refresh amplification audit

检查 `MESSAGE_RECEIVED`、`MESSAGE_DELETED`、`MESSAGE_EDITED`、`SWIPE_CHANGED`、`CHAT_CHANGED`、`WORLD_PERSISTENCE_CONFIRMED` 及实际兼容事件映射，确认 reload、invalidation、refresh queue、连续 refresh、hidden UI refresh、Status/World 重复读取和 render amplification。

### R4. Safe performance measurement

- 优先使用现有 tests/fixtures 或隔离的 synthetic harness；不得改写真实聊天数据或执行 AI World analysis。
- 在可行范围测量多个消息/Floor规模下的 Floor 定位、World resolver、Storage read count、World normalize、View Model build、UI render 和单次操作 refresh count。
- 报告必须拆分 CPU、异步等待、DOM render、Storage/Network 等类别；无法实测的项目必须标记为 UNVERIFIED，并说明原因。

### R5. Complexity and evidence grading

- 仅在代码证据或测量支持时确认 O(N)、O(N²)、重复 O(N)、重复深拷贝、JSON serialization 或 DOM 重建问题。
- 每条结论标记 `CONFIRMED`、`LIKELY` 或 `UNVERIFIED`，并带文件/行号、调用链或测量依据。
- 明确区分已确认根因、合理怀疑、未验证问题、安全优化点、不建议修改点、最小优化方案和 regression test 设计。

### R6. World Model historical-version semantics audit

验证 World Model Full/Supplement、Archive/Restore/Permanent Delete 的实际写入位置、当前 Floor 快照创建方式和 resolver 的历史查找语义。以以下版本语义为验收模型：Floor 10 的 Model A；Floor 20 归档后创建 Model B；Floor 21+ 在无新修改时继承 B；删除 Floor 20 及之后并回到 Floor 18 时重新得到 A，归档状态恢复为未归档。

重点检查是否原地修改旧 Floor、全局最新状态覆盖历史状态、删除后 resolver 回退、独立后续快照与中间 Floor 删除的规则、Swipe/Chat 切换污染，以及历史快照数量对 UI 打开性能的影响。性能建议不得让历史读取未来模型，也不得新增脱离 Floor/Chat/Swipe 的全局缓存。

### R7. Existing regression coverage audit

优先检查现有测试是否覆盖：Floor 10/A、Floor 20/B、Floor 18/A、Floor 20/B、Floor 21/B、删除后回退 A、Swipe 历史隔离和 Chat 隔离。若缺失，只记录测试缺口和建议，不修改测试或生产代码。

## Acceptance Criteria

1. 产出完整报告，至少覆盖：当前状态、UI 打开性能、World Model 数据体积与历史快照成本、完整读取调用链、复杂度、测量、增长热点、重复计算、事件/UI amplification、Floor 历史版本正确性、Archive/Restore/Delete 版本语义、已确认根因、尚未验证怀疑、安全优化、不建议修改、最小方案、需要新增的回归测试、涉及文件、文档/Trellis 影响。
2. 报告中的每个性能结论均能回溯到实际代码、测试/fixture、独立测量或明确的不可测原因；不把猜测写成事实。
3. 报告明确给出扫描方向/停止条件、Storage 调用次数、normalize/view-model/render 次数或其可测性边界，并分别给出 Floor 数量、World Model 体积、历史快照数量和 UI 初始化的影响。
4. 每个确认的问题提供文件路径、函数名、关键代码位置、实际调用链、触发条件、影响范围和证据/可重复测试结果；仅存在循环、clone 或 stringify 不得单独作为性能根因。
5. 报告明确验证或否定 Floor 10/A、Floor 20/B、Floor 21/B、删除后回退 A、Swipe isolation、Chat isolation 等历史语义；缺少现有测试的项目单列为测试缺口。
6. 审计过程未修改生产代码、测试、fixture、真实聊天数据、Floor persistence contract 或 Git 历史；task artifacts 是唯一允许新增的工作树内容。
7. 完成只读验证：至少执行相关静态检查/测试或说明为何跳过；确认最终 `git diff` 仅包含本任务审计 artifacts，且没有 Full/Supplement、migration、commit/push/reset/clean。
8. Markdown/Trellis 影响检查完成：若本次仅新增审计 task artifacts，说明没有需要同步的生产 Markdown；若审计揭示现有文档已不准确，先在报告中列出，不擅自修改生产文档。

## Out of scope

- 任何生产代码、测试代码、fixture、真实聊天数据或 persistence contract 修改。
- World Full/Supplement、AI/API 请求、migration、缓存新增、架构重构、commit、push、reset、clean。
- 未经用户后续批准的性能修复实施。

## Open questions

无阻塞性需求问题。技术上无法从现有 fixtures 安全覆盖的 real-host/DOM/Network 行为，按 UNVERIFIED 报告并提出后续 acceptance 方案。

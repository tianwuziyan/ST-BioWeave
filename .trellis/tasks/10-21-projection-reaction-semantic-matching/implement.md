# 实施计划：严格模式推演生理反应语义匹配

## 1. Core 反应概念模块

- [x] 建立受孕前观察反应概念表、时间范围、明确短语与排除组合的单一 owner。
- [x] 实现 Event 多概念提取纯函数，仅消费合格 Event 的 `symptom.kind` 与 `symptom.description`。
- [x] 实现 Projection 单概念解析纯函数，优先 branch key，文本 fallback 必须唯一。
- [x] 将现有只支持 `nausea` 的 matcher 改为基于概念交集、人物和 Story Time 的严格 matcher。
- [x] 保证输入不可变，未知、模糊、多概念和无反应分支失败关闭。

验证：Core 测试覆盖全部十个正向分支、柳如烟实例、否定/未发生/干呕未吐/单次剧烈恶心、泛词和多概念卡片。

## 2. Runtime 与 Debug

- [x] 继续复用 `collectActiveBusinessData()` 的同一次 Event snapshot，不增加 Analyzer/API 或完整业务读取。
- [x] 保留六字段 Floor Version 一致性检查、subject 隔离和当前有效 Floor/Swipe 边界。
- [x] Product DTO 继续只输出 `observed_reaction.matched`。
- [x] 扩展现有有界 Debug 关联记录，输出概念与匹配路径，不输出原始正文和完整 description。
- [x] 覆盖 Event 编辑/删除、Floor/Swipe 失效、阶段替换、回退旧楼和重复读取无写入测试。

## 3. UI 与文档

- [x] 保持“已触发”徽标、删除按钮和卡片布局不变；仅验证多张卡片可以分别显示徽标。
- [x] 同步 `docs/UI.md`、`docs/UI_FRAMEWORK.md`、配置中的严格模式说明；因 DOM、布局与样式未变，示例和完整参考无需产生无意义 diff。
- [x] 更新 Event/Projection 读模型规范，记录标题/内容只用于卡片语义、Event 才是事实来源。
- [x] 检查并同步 `docs/bioweave-data-lifecycle.md`；后续持久化触发记录扩展已补齐生命周期说明。

## 4. 验证

- [x] `node --check` 检查所有变更 JavaScript。
- [x] 运行 Core、Projection Runtime、UI focused tests。
- [x] `npm test`。
- [x] `npm run check`。
- [x] `git diff --check` 与完整差异审查。
- [x] 确认新增记录仍归现有 Floor-owned Projection timeline 所有，没有第二事实源、Projection factual transition 或额外 API 调用。
- [ ] 刷新真实 SillyTavern 后验证柳如烟实例与 Desktop/Tablet/Mobile UI。

## 5. 持久化触发记录与阶段历史

- [x] 在现有 `projection_timeline` 增加 Floor-owned append-only observation records，并补齐 schema、normalize、validation、dedupe、batch persistence 与 readback。
- [x] 当前阶段严格匹配成功后批量保存 `triggered` 记录；重复读取必须去重且不产生额外 Host 写入。
- [x] 健康自然恢复清理 Event 时保留已触发记录，不修改健康识别和恢复逻辑。
- [x] 用户手动编辑/删除 Event 后，只按修改后的事实同步当前阶段触发记录；旧阶段历史不倒改。
- [x] 阶段替换后仅保留新阶段为当前候选，并额外派生人物级“本轮曾经触发”历史；未触发旧卡不进入历史。
- [x] UI 保持当前阶段卡片结构，并以简短区域展示“本轮曾经触发”；历史项目不显示为当前仍在持续。
- [x] Projection Context 分别输出“此前出现过，不代表当前仍持续”和当前阶段可能反应。
- [x] 观察过程结束、Floor/Swipe 失效、回退旧楼和手动纠错的生命周期测试覆盖完整。
- [x] 同步 lifecycle registry、`docs/bioweave-data-lifecycle.md`、Floor State、Event Pipeline、UI 文档与配置；如 UI 增加结构，同步 HTML 示例和完整参考。

## 风险文件与回滚点

- `core/projection-eligibility.js`：现有 matcher 入口；避免继续扩成词表容器。
- 新 Core 纯函数模块：集中拥有概念表与严格解析规则。
- `runtime/projection-runtime.js`、`runtime/events.js`：只连接已有 snapshot 与 Debug，不承担语义解析。
- `tests/projection-eligibility.test.js`、`tests/projection-runtime.test.js`、`tests/ui.test.js`：回归主证据。
- UI 文档与配置：只同步行为说明，不改变已验收布局。

## 6. Debug enhancement（本轮追加）

- [x] 扩展既有 `projection_observed_reaction_links`，区分当前派生识别、当前 Floor `triggered_snapshots`、旧 `observation_records` fallback 与 Product/历史/Context 最终使用状态。
- [x] Debug 直接导出 endpoint 的人物级 `triggered_snapshots` 安全摘要，包含状态、创建 Floor、数量、Projection/概念/Event ID，不输出正文、完整 description 或 Prompt。
- [x] 新增独立 `PROJECTION_TRIGGERED_SNAPSHOT_PERSISTENCE` / `PROJECTION_TRIGGERED_SNAPSHOT_READBACK` trace，记录保存尝试、`appended` / `deduped` / `failed` / `unsupported`、snapshot_count、owner Floor Version 和权威读回结果；保留旧 observation persistence 字段兼容。
- [x] 补充 focused Runtime 测试，覆盖当前 Floor 导出、A→A+B、终止空快照、失败/未支持安全状态和 snapshot readback trace。

## 7. Health recovery stage regression fix（本轮追加）

- [x] 在新 prompt 读取前允许 `GENERATION_STARTED` 基于最新 fully completed、valid
  Character Floor 做一次 read-only Context rebuild；仅更新 transient extension slot，
  不记录 delivery submission，不执行 Analyzer/Projection processing、Tracking、recovery
  或 Floor write。body generation active 后继续由 Generation gate 阻止所有业务工作。
- [x] 保留 crossing-floor 语义：当前 request 读取上一份 completed Floor；response 完成并
  settle 新 Story Time 后，下一次 request 才读取新 stage。
- [x] 修复显式 `CHARACTER_MESSAGE_RENDERED` target 在更早 User snapshot difference 存在时
  被误判为 user-only 的问题；显式 target 保持严格 ID/index 与 assistant 校验，歧义时 fail closed。
- [x] 将 generation-settled 的 health recovery scheduling 保留在
  `scheduleRenderedCharacter` 的业务 owner 内，并置于 `alreadyObserved` 去重返回之前，
  使 completed response/render path 直接触发当前 Floor 的 recovered Event cleanup。
- [x] 回归验证：generation-start read-only refresh 的 zero persistence/AI/delivery writes；
  explicit Character render 在 earlier User snapshot difference 下完成 settle 与 recovered
  Event cleanup；focused tests、full `npm test`、`node --check` 与 `git diff --check` 均通过。

## 8. Health Assessment 成功响应解析修复（本轮追加）

- [x] 复现 API transport 成功但单个 `json` code fence 导致
  `HEALTH_ASSESSMENT_INVALID_JSON`、健康指导为 0 的失败。
- [x] Health Assessment parser 仅解包完整响应范围内的单个 JSON code fence；继续拒绝
  解释文字、多个响应块和无效 schema，不采用任意 substring repair。
- [x] 保留安全 parser diagnostics，并增加 extraction mode 便于区分 direct JSON 与 code fence。
- [x] 显式 Character/Event manual analysis 对同 Floor 缺失结果进行受版本保护的 Assessment
  重试；已有合法结果只复用，普通 reload/replay 不自动补评估。
- [x] 验证 Health Assessment、Health Recovery Guidance、Projection Context 与 Projection Runtime

## 9. Health recovery current-Floor snapshot（本轮追加）

- [x] 为 `health_assessment_timeline` 增加当前 Floor 快照元数据，同时保留每条 Assessment 的原始来源版本。
- [x] 阶段未变化时只读最近完整 timeline，不产生当前 Floor 写入；阶段变化时复制完整多阶段数据到当前 Floor，不重新调用 AI。
- [x] 健康 Event 手动编辑/删除只在当前 Floor 过滤并保存对应快照，历史 Floor 保持不变；回退时恢复历史版本。
- [x] 允许带有合法当前 Floor 快照标记的复制 Assessment 参与当前健康状态推导，并按 request key 去重，避免历史与当前副本重复。
- [x] 修复 Projection Context 在只读缓存命中时复用过期健康指导的问题。
- [x] 补充阶段切换、手动编辑/删除、历史回退、来源失效、无重复 AI 请求和缓存失效回归测试。
- [x] 同步 Floor ownership / lifecycle / health state 文档，明确快照是派生记录而不是事实 Event。
  focused tests，确认已保存健康指导可继续通过既有共享 Context slot 发送给 ST/API。

## 10. Projection triggered current-Floor snapshot

- [x] 先补失败回归：第一阶段触发 A，第二阶段新增 B 后，当前楼层必须权威读回 `[A, B]`；未触发旧卡不进入快照。
- [x] 将观察触发状态改为人物级完整 Floor 快照；阶段切换只读取向前最近的合法完整快照一次，并与当前阶段新触发记录合并。
- [x] 当前 UI、Debug 与 ST Context 改为消费当前楼层完整快照，不再跨多个历史楼层按人物 ID 拼接旧阶段记录。
- [x] 某人物观察结束时，在当前楼层写入该人物明确的空/终止快照；多人场景保留其他人物的完整快照。
- [x] 保持当前阶段手动编辑/删除只修改当前阶段结果，已经进入历史的旧阶段触发不倒改；健康自然恢复仍不撤销触发。
- [x] 所有快照写入继续经过当前 Chat、active Swipe、六字段 Floor Version、Coordinator 原子写入与权威读回；失败或 stale 不得产生部分快照。
- [x] 为现有 append-only observation records 提供有界兼容收敛；新快照生效后清理产品路径中的旧跨楼层拼接实现，避免两套权威读取。
- [x] 补齐阶段切换、同阶段不重复写、终止清空与旧卡防复活、后续新观察重启、多人独立、回退旧楼、Floor/Swipe 失效和旧数据兼容测试。
- [x] Floor 删除、编辑和 Swipe 边界变化先清空旧 UI，等 `BIOWEAVE_LIFECYCLE_SETTLED` 后再读取当前有效 Floor；补充回退时防止提交旧阶段数据的 UI 回归测试。
- [x] 实现完成后同步 Event Pipeline、Floor State、Data Lifecycle、Data Model 及受影响 UI 文档；文档只描述最终已经验证的字段与行为。
- [x] 运行 focused tests、`npm test`、`npm run check`、`git diff --check`；真实 SillyTavern UI 与 ST Context 验证仍待宿主刷新。

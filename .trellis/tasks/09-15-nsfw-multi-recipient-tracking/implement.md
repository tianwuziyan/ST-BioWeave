# 实施清单：NSFW 多人物妊娠追踪对象识别

## 阶段 0：进入实现前的门槛

- [ ] 任务已获得用户对本规划摘要的明确批准。
- [ ] 运行 `python3 ./.trellis/scripts/task.py start` 激活任务；确认分支和工作区没有
      非本任务的意外变更。
- [ ] 按 `trellis-before-dev` 重新读取本任务涉及层的 Trellis spec；实现判断仍以
      当前文件内容和实际 diff 为准。
- [ ] 检查 `package.json`、Prettier 配置和 package-manager 依赖；当前审计未发现
      Prettier 配置/依赖，最终仍需以实现时的实际检查为准。

## 阶段 1：Domain / Storage

- [ ] 在 `core/tracking.js` 中把 `trackingDecisionPath()` 的资格结果改为
      `eligibility: eligible | pending | ineligible`，并保持 reason code 与事件级
      rejection 语义可诊断。
- [ ] 将 Registry rebuild 拆成“先收集全部 exposure candidates、再逐个解析能力”的
      两阶段流程；收集循环不得按 capability 提前过滤或 return。
- [ ] 增加精确的 World Model `species -> biological_type -> capabilities` baseline
      resolution；个体明确非 null 证据覆盖 baseline，未知保持 null。
- [ ] 明确只用 `can_carry_pregnancy`（或当前 World Model 明确定义的等价承孕能力）作为
      gestational tracking qualification；`can_be_fertilized` 不能单独授权。
- [ ] 为 pending candidate 保存 character ID、exposure Event IDs、原始 Story Time、
      Source Version、identity、resolved capabilities 和 evidence；ineligible 不进入
      active subjects/candidates。
- [ ] 在 `storage/schema.js` / `storage/store.js` 增加 `tracking_candidates` 的默认值、
      读取归一化和保存 round-trip，兼容旧 Chat。

## 阶段 2：AI Prompt / Runtime 生命周期

- [ ] 在 `ai/prompts.js` 的 Core、Task、Output contract 同步加入 exhaustive scan、
      temporary candidate collection、无 user/Persona 优先级和中途失败继续扫描保护。
- [ ] 调整 identity 文案：允许 AI 综合稳定设定、生理/生殖事实和多条一致上下文证据
      做 contextual inference；单一姓名、称谓、外貌、行为位置、主动/被动、event_role
      或社会角色不得单独决定 biological_type/capability，冲突/不足保持 null/pending。
- [ ] 调整 exposure 文案，明确 World Model + species/type rules + narrative evidence
      决定机制；`possible_conception` 只代表潜在性，不代表实际受孕/怀孕。
- [ ] 在 `runtime/event-analysis.js` 传入 World Model/profile context，输出 pending
      registry/三态 decision，并确保所有现有 rebuild 触发点使用同一 Core path。
- [ ] 在 `ui/app.js` 的 World Model 手动/AI 保存成功后只调用 Runtime refresh，触发
      pending 重评；UI 不增加 capability/exposure 判断或 pending 普通列表。
- [ ] 确认 `tracking_subjects` 仍是 Characters list 的唯一来源，eligible 不写入任何
      actual pregnancy state。

## 阶段 3：回归测试与契约同步

- [ ] 更新 `tests/tracking.test.js` 的旧二态断言，并加入三态、World Model baseline、
      多 recipient、pending transition、原始 Story Time 和 fertilized/carry 分离测试。
- [ ] 更新 `tests/event-analysis.test.js` prompt/identity/0/1/N 断言，覆盖 exhaustive
      scan 和 `character_context` 非 whitelist。
- [ ] 更新 `tests/event-analysis-runtime.test.js`，覆盖多 subject、pending registry、
      World Model 更新后的 refresh 和 no actual pregnancy state。
- [ ] 如现有 UI/Runtime fixture 使用旧 `eligible` 或缺少 refresh stub，只修改 fixture
      contract，不给 UI 增加业务逻辑。
- [ ] 同步更新实际受影响的 `.trellis/spec/domain/event-pipeline.md`、
      `docs/DATA-MODEL.md`、`docs/UI.md`、`docs/DEVELOPMENT.md`、`README.md` 中的 null/
      pending/eligible 语义；只保留当前实现确实改变的文字。
- [ ] 搜索 `eligible`、`pending`、`possible_conception`、`pregnant`、
      `conception_confirmed`、`character_context`、`CAN_CARRY_PREGNANCY_UNKNOWN`，确认没
      有把 eligible/pending 写成 actual pregnancy，也没有旧的“unknown 永久丢弃”契约。

## 阶段 4：质量门禁

- [ ] 仅对实际修改的 Prettier 支持文件运行仓库本地 `--write`；若仓库仍无 Prettier，
      记录明确原因和探查结果。
- [ ] 运行 `npm run check`。
- [ ] 运行 `git diff --check`。
- [ ] 对所有修改过的 JS 文件逐一运行 `node --check <file>`。
- [ ] 检查 `git status --short` / `git diff --stat` / `git diff`，确认未 commit、未 push，
      且没有混入任务之外的修改。

## 预期修改文件（以实现时实际代码为准）

- 可能修改：`ai/prompts.js`、`core/tracking.js`、`runtime/event-analysis.js`、
  `storage/schema.js`、`storage/store.js`、`ui/app.js`。
- 可能修改：`tests/tracking.test.js`、`tests/event-analysis.test.js`、
  `tests/event-analysis-runtime.test.js` 以及受影响的 storage/UI contract tests。
- 可能同步：上述 domain/docs/README 文档。
- 不修改：Git 历史、远端、无关 UI 视觉结构、完整 Event 存储事实。

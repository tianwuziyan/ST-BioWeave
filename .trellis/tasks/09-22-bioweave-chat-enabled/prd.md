# BioWeave 当前 Chat 总开关

## Goal

为 BioWeave 增加 Chat-local runtime master switch，统一控制自动分析、Projection Context、manual refresh 与 UI 状态。

## Background / Confirmed Repository Facts

- `storage/schema.js` 已有唯一候选字段 `DEFAULT_SETTINGS.enabled = true`，并由 `emptyChat(chatId)` 放入 Chat-local `settings`；不得新增 `plugin_enabled`、`tracking_enabled` 或其它重复字段。
- 当前 Chat metadata 的 `bioweave.settings` 是 Chat 设置存储入口；`storage/store.js#getChat()` 对已存在 Chat 只克隆原值，因此旧 Chat 缺失 `enabled` 时必须在读取/规范化边界回退为 `true`。
- 目前 Runtime 的自动分析协调器、生命周期处理、Projection Context coordinator 和 UI manual refresh 尚未形成统一的 `enabled` authoritative guard；因此本需求不是单纯接线 UI。
- Projection Context 已提供 `clearProjectionContext()`，注入 key 为 `bioweave_projection_context`；Runtime 生命周期会在多个 Chat/Floor 变化路径刷新它。
- 现有异步分析具备 Chat epoch、Floor Version、AbortController 和 commit 前 stale 检查；本任务需把当前 Chat enabled 状态纳入同一失效条件。
- 当前 worktree 已有其它未提交修改；本任务只修改自身范围，保留并避让既有改动。

## Requirements

### Scope and persistence

- 复用 `settings.enabled`，语义为 Chat-local runtime master switch，默认 `true`。
- 实际作用域为 current Chat × current Character Card；状态保存于当前 Chat metadata，不写入角色卡、不按角色名持久化、不建立跨 Chat Character registry。
- 新 Chat、重新导入角色卡、旧 Chat 缺失字段均解析为 `true`；当前 Chat 手动关闭后 reload 仍为 `false`，同角色新 Chat 和其它角色 Chat 不继承。
- 关闭只表示 PAUSED/DISABLED，保留已有 World Model、Character Profiles、Events、Current State、Snapshots、Projections、Genealogy、Analysis history 和用户编辑结果，不清空 Floor 或修改历史 Floor。

### Runtime authoritative guard

- `enabled === false` 时，Runtime/coordinator/side-effect boundary 必须阻止后续自动 World Analysis、World Model update、Character/Event Analysis、BiologicalEvent extraction、Tracking/Profile rebuild、Snapshot creation、Projection eligibility/generation/evolution、Projection Evidence/Lifecycle 写入、Projection Context injection 及由这些流程触发的 AI/API 请求。
- Guard 必须覆盖 lifecycle event、scheduler、programmatic refresh、manual refresh 直接调用；pure reducer/evaluator/normalizer/validator 不感知 enabled。
- disabled 跳过不得写入 `failed`、`WORLD_MODEL_UNAVAILABLE` 或 failure retry attempt；如需内部结果，使用 `disabled` 或 `skipped_disabled`。
- `true → false` 立即清空 `bioweave_projection_context`；disabled 状态下任何 lifecycle refresh 不得重新注入。
- `false → true` 恢复正常读取、Projection coordinator 和后续分析触发点，但不得批量追补 disabled 期间 Floor；必要时重置 scheduler/backlog cursor，避免立即追补。
- 正在运行的请求在关闭后应尽可能 abort；即使底层请求不可取消，late response 在所有 commit/side-effect 边界再次检查 enabled，不得写入新事实、Snapshot、Projection 或 Tracking。

### UI and settings

- 顶栏右上角提供可访问总开关，Desktop/Tablet 显示原生 checkbox 与“已开启”/“已暂停”文字，Mobile 可紧凑化但必须保留文字或可访问标签。
- Tooltip/aria-label 分别为“启用 BioWeave”与“暂停 BioWeave”；刷新分析在 disabled 时禁用或提示暂停，不能绕过 Runtime guard。
- 关闭可复用现有 host Popup confirm：标题“暂停 BioWeave？”，说明明确停止自动分析、追踪和上下文注入且不产生新分析 API 请求、已有数据保留；按钮语义为取消/暂停。开启不确认。
- 若 Settings 页面补齐“启用 BioWeave” toggle，必须与顶栏绑定同一个 Chat-local `settings.enabled`，任一位置切换后立即同步，不存在第二状态源。

## Acceptance Criteria

- [ ] 缺失 `enabled` 规范化为 `true`；新 Chat、重新导入角色卡为 `true`；当前 Chat 关闭后 reload 保持 `false`；同角色新 Chat、其它角色 Chat 不继承。
- [ ] `settings.enabled` 仍是唯一总开关，未写入角色卡或跨 Chat registry。
- [ ] disabled 时 World/Character/Event analysis、BiologicalEvent、Tracking/Profile、Snapshot、Projection generation/evidence/lifecycle、Projection Context 和 API 请求均被阻止。
- [ ] disabled 不记录失败或 retry attempt；历史事实和用户编辑结果保持不变。
- [ ] `true → false` 立即清空 Projection Context；disabled lifecycle refresh 不重新注入；`false → true` 可恢复后续正常分析且不追补旧 Floor。
- [ ] manual refresh 在 disabled 时不调用 AI/API，并以禁用控件或现有 Toast 反馈暂停状态。
- [ ] 正在分析时关闭，late AI response 不得 commit；可取消请求按现有机制 abort。
- [ ] 顶栏 toggle 与 Settings toggle（如存在）使用同一状态源，false 状态显示“已暂停”且可访问。
- [ ] 回归测试覆盖用户列出的 20 项行为，至少落实为 settings/storage、runtime guard、projection context、manual refresh、UI 和 async race 测试集合。
- [ ] 同步更新 `.trellis/spec/domain/event-pipeline.md`、相关 runtime/settings/UI spec 与必要 docs，明确 enabled 是 Chat-local runtime master switch。
- [ ] 通过 `npm run check`、变更 JS 的 `node --check`、`git diff --check`；记录真实宿主 Desktop/Tablet/Mobile 验收边界。

## Out of Scope

- 不修改 BiologicalEvent、StateReducer 事实语义、World Model、Snapshot、Projection DTO/lifecycle、contributor attribution 或 genealogy/Floor Version contract。
- 不增加 legacy compatibility layer，不根据 gender、biological type、pregnancy capability 或角色存在性自动决定 enabled。
- 不追补 disabled 期间历史 Floor，不删除或重写历史数据。

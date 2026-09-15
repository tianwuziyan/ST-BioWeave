# 为独立 API profile 增加模型列表持久化缓存

## Goal

让每个 BioWeave 独立 API profile 持久化最后一次成功获取的模型列表，使用户重新打开设置或切换 profile 时无需再次刷新即可使用上次成功结果，同时不扩大 API Key / Secret 的存储边界。

## Background

已确认的当前行为：

- `ui/app.js:494-514` 的 `settingsState` 仅在当前 App 实例中保存 `modelList` 和 `modelListProfileKey`。
- `ui/app.js:2200-2207` 在新建、切换、取消 profile 编辑时会清空模型选择器状态。
- `ui/app.js:2523-2584` 的 `refreshModels()` 会调用现有 `withTestProfile()` 和 `fetchModels()`，成功后调用 `normalizeModelList()`，失败时只保留当次内存列表。
- `ui/settings.js:67-114` 的 `normalizeModelList()`、`renderModelPicker()` 已负责模型规范化和展示；本任务保持其签名、事件钩子和渲染行为兼容。
- `ui/app.js:576-613` 通过 profile store 读取全局设置；`storage/store.js:230-235` 统一调用 `normalizeExtensionSettings()` 后读写宿主全局设置。
- `storage/store.js:356-374` 是 profile 删除的持久化入口；`storage/schema.js:406-446` 是全局设置规范化入口，profile 本身只允许保存 `secret_ref`，不保存 API Key。

## Requirements

1. 使用现有全局设置存储机制保存模型缓存，不引入额外的独立 `localStorage` 状态。
2. 缓存按稳定 `profile_id` 隔离；每条缓存只包含 `profile_id`、规范化后的模型 ID 字符串数组和 `refreshed_at` 时间戳。
3. “刷新模型”继续执行现有请求流程。请求成功后先执行现有 `normalizeModelList()`，再完整替换当前 profile 的旧缓存并更新 `refreshed_at`。
4. 刷新请求失败时不得写入或清空缓存；当前 UI 继续显示本次刷新前最后一次成功的模型列表，并保留现有错误 Toast 逻辑。
5. 设置页面初始化、重新打开以及 App 实例重新创建后，编辑已有 profile 时自动恢复其缓存；切换编辑 profile 时只显示目标 profile 的缓存。
6. 删除 profile 时在同一次全局设置更新中清理对应模型缓存。
7. 未保存的新 profile 没有稳定 ID 时可以继续使用内存 `modelList`，但不得以 `new` / `__new__` 等临时键写入永久存储。保存 profile 获得正式 ID 后，允许将此前成功的内存结果迁移到正式 profile 缓存；迁移失败不得伪造缓存成功。
8. 模型缓存写入路径不得接收或保存 API Key、Secret、Secret Store 值或其它认证字段；既有 Secret Store 读写/删除边界保持不变。
9. API profile 保存只有在持久化成功、且必要的未保存模型缓存迁移完成后，才正式结束 editor 并回到 profile 列表；保存或校验失败时保留 editor、草稿和现有错误提示。
10. 任务分配的 API profile/source 切换只更新对应 `assignments[slot]`；不得触发 `edit-profile`、改变 `editingProfile`/`editingDraft`、切换 editor 或修改模型缓存。

## Acceptance Criteria

- [ ] 刷新成功后，宿主全局设置中出现对应 `profile_id` 的模型缓存，模型列表为 `normalizeModelList()` 结果且带 `refreshed_at`。
- [ ] 关闭并重新打开设置，或销毁后重新创建 App 并编辑同一 profile，可恢复上一次成功缓存；无需再次刷新。
- [ ] profile A/B 各自刷新或读取时只看到自己的模型列表，缓存不会交叉污染。
- [ ] 同一 profile 第二次刷新成功后，旧缓存被新列表完整替换，不残留旧模型。
- [ ] 第二次刷新失败后，UI 与持久化设置仍保留第一次成功的缓存和列表，并出现现有错误提示。
- [ ] 删除 profile 后，对应缓存不存在；其它 profile 的缓存仍保留。
- [ ] 新建未保存 profile 刷新时只更新内存状态，永久设置中不出现 `new` / `__new__` 缓存；保存后正式 ID 可接管该成功内存结果。
- [ ] 对包含 API Key、Secret、`secret_ref` 或其它认证字段的输入执行缓存写入/规范化后，缓存只包含允许的三个字段，序列化结果不含敏感值。
- [ ] 现有 API profile / Secret Store 行为和 `ui/settings.js` 的模型选择器事件、规范化、展示签名保持兼容。
- [ ] 新建与编辑 profile 保存成功后 editor 自动关闭并立即显示最新列表；保存/校验失败保持 editor 打开；未保存模型缓存迁移在关闭前完成。
- [ ] editor 关闭、编辑已有 profile 或新建未保存 draft 时，任务分配连续切换都只更新任务绑定；editor/draft/模型缓存保持原状，且不触发 `edit-profile` handler。

## Out of Scope

- 不改变模型列表 API 请求、重试、超时、错误分类或 Toast 文案的既有业务逻辑。
- 不改变 API profile 字段、Secret Store API、Chat/Floor 存储边界或设置页视觉结构。
- 不把缓存用于阻止显式“刷新模型”；用户每次点击仍然强制请求。

## Open Questions

无。缓存位置、失败语义、未保存 profile 行为和安全边界均已由需求与当前代码审计确定。

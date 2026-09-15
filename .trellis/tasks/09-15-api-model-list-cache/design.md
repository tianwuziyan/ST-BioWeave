# 技术设计：独立 API profile 模型列表缓存

## 1. 存储边界与数据结构

在现有 BioWeave 全局设置对象中增加顶层字段 `api_model_caches`，不使用 `localStorage`：

```js
{
  api_model_caches: {
    "profile-a": {
      profile_id: "profile-a",
      models: ["model-a", "model-b"],
      refreshed_at: 1234567890,
    },
  },
}
```

`storage/schema.js` 新增缓存规范化函数，并在 `normalizeExtensionSettings()` 中：

- 只读取对象形式的缓存映射；
- 只保留当前 `api_profiles` 中仍存在的稳定 profile ID；
- 每条缓存只输出 `profile_id`、字符串模型 ID 数组、非负有限整数 `refreshed_at`；
- 模型 ID 做 trim、去重，忽略非字符串项；
- 旧设置没有 `api_model_caches` 时规范化为空对象；
- 通过白名单形状而非复制输入对象，避免任何 API Key / Secret 字段进入缓存。

这样 profile 保存时会自然保留已有缓存，删除 profile 时也能在 store 层明确移除对应键；规范化还会淘汰孤立缓存。

## 2. Store API

`storage/store.js` 在 `createApiProfileStore()` 内新增：

- `getModelListCache(profileId)`：只接受稳定、已存在的 profile ID，返回克隆后的缓存或 `null`；临时新建键返回 `null`。
- `saveModelListCache(profileId, rawCache)`：验证 profile 已存在，使用 schema 缓存规范化后写回 `api_model_caches[profileId]`，返回克隆后的缓存。默认时间戳仅在调用方未提供时使用 `Date.now()`。

`deleteProfile()` 在构造 `nextSettings` 时复制并删除 `api_model_caches[id]`，与 profile/assignment 更新一起交给现有 `write()`，避免留下已删除 profile 的缓存。返回对象暴露上述读写方法，供 UI 和测试通过现有 store seam 使用。

## 3. UI 状态与数据流

保留 `ui/settings.js` 的 `modelList`、`modelListProfileKey`、`normalizeModelList()` 和 `refresh-models` hook。`ui/app.js` 增加最小状态字段：

- `modelListCaches`：当前全局设置中已规范化的缓存映射，仅作为 UI 恢复索引；
- `modelListRefreshedAt`：当前内存列表对应的成功时间，用于未保存 profile 保存后的迁移。

新增一个小型恢复辅助逻辑：

- `updateSettingsState()` 把 `settings.api_model_caches` 同步到 `modelListCaches`；
- `editProfile(profileId)` 在重置请求序列后，从目标 profile 的缓存恢复 `modelList`、`modelListProfileKey` 和时间戳；
- `startNewProfile()` / `cancelProfileEdit()` / `destroyBioWeave()` 不读取永久缓存，继续使用空的临时内存状态；
- 已有 App 通过 close/open 保留当前 state，重新创建 App 时由 `loadSettings()` 重新读取全局设置，随后编辑 profile 恢复缓存。

恢复逻辑只以 `profile_id` 为 key，不以配置名称、API URL 或当前模型推断身份。

## 4. 刷新与失败语义

`refreshModels()` 保留现有请求、序列号和 active-draft 防竞态检查：

1. 开始刷新前保留当前同 profile 的 `modelList` 和时间戳，显示 busy 状态；
2. 调用既有 `withTestProfile(..., {requireModel: false})` 和 `fetchModels()`；
3. 请求成功后调用现有 `normalizeModelList()`；
4. draft 有稳定 `profile_id` 时调用 `saveModelListCache()`，成功结果更新 `modelListCaches`；draft 没有稳定 ID 时只更新 `modelList` / `modelListRefreshedAt`，不触碰 store；
5. 通过现有序列号和当前 draft 检查后，将规范化的新列表完整替换 UI 状态；
6. 请求或缓存持久化失败进入现有 catch，保留刷新开始前的列表/缓存，不清空旧结果，并继续调用 `settingsOperationError()` / `notify()`。

显式刷新永远执行请求，不把缓存作为请求短路条件。

## 5. 保存成功后的 editor 生命周期

`saveSettingsForm()` 先捕获草稿并设置 busy，再等待 `saveProfile()` 完成；新 profile 若有内存模型列表，则继续等待正式 `profile_id` 的缓存迁移。只有这两个步骤都成功时，才将 `editingProfile` / `editingDraft` 置为 `undefined` 并重新渲染 profile 列表。保存或 schema 校验失败时不清空 editor 状态，保留当前草稿并沿用现有错误 Toast；迁移失败时也不报告缓存已成功，editor 保持打开。

保存期间使用 busy guard 防止重复保存或切换/取消 editor，避免异步旧结果覆盖新的编辑状态；空闲时的取消仍走原有 `cancelProfileEdit()`。

## 6. 未保存 profile 的保存迁移

保存表单前捕获 `__new__` 内存缓存快照（包括 `models` 和原始成功 `refreshed_at`）。`saveProfile()` 获得正式 ID 后，如果快照存在，则调用 `saveModelListCache(saved.profile_id, snapshot)`；成功后把 UI key 从 `__new__` 切换到正式 ID，并同步缓存映射。永久存储中从不写入 `__new__` 键。

缓存迁移是 profile 保存后的附加持久化步骤：若 store 不支持该方法，仍保留现有内存列表和 profile 保存行为；若迁移写入失败，不报告缓存已成功，沿用设置操作错误提示并保持当前内存列表可见。

## 7. 安全与兼容性

- API Key 继续只由 `withTestProfile()` 临时写入/删除 Secret Store；缓存写入只接收规范化模型列表和时间戳。
- 不把 profile 对象、表单 raw 或 Secret 引用复制进 `api_model_caches`；`secret_ref` 也不属于缓存字段。
- `ui/settings.js` 的参数和 HTML hook 不变，因此已有列表渲染、搜索、选择和刷新按钮行为保持不变。
- 现有全局设置/旧 profile 在缺少缓存字段时按空缓存读取，不需要额外迁移脚本。

## 8. 回滚形状

删除 `api_model_caches` 的 schema 默认/规范化逻辑、store 方法、UI 状态恢复与相关测试即可回到当前内存列表行为；旧设置字段会被忽略，不影响既有 profile/Secret 数据。实施阶段不提交、不推送。

## 9. 任务分配与 profile editor 的状态隔离

任务分配选择器与独立 API profile 编辑器使用同一个设置页事件委托，因而
必须在 `ui/app.js` 的 `input`、`click`、`change` 入口处先识别
`data-bioweave-assignment`。识别后只调用 `changeAssignment()` 并返回；不能
进入通用表单草稿捕获或 `data-bioweave-action` 委托。这样可保证：

- editor 关闭时，assignment change 后仍关闭；
- 正在编辑已有 profile 或新建草稿时，`editingProfile`、`editingDraft`、模型列表及 `api_model_caches` 均保持原值；
- 只有显式 `edit-profile` / `new-profile` action 才能创建编辑状态；
- profile 保存成功后的“缓存迁移完成 -> 清理 editor -> render”生命周期不受影响。

回归测试使用带有伪造 form/action 上下文的 assignment 事件，验证该边界不是
靠清空 editor 状态掩盖，而是由事件分类阻止错误委托。

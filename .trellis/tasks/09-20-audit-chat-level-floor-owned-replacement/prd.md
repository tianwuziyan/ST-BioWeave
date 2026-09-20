# 删除旧 Chat-level 数据框架并收敛到 Floor single source of truth

## Goal

直接删除已经被 Floor-owned 架构替代的 Chat-level persistence framework，使 reload 后人物、事件、canonical identity、World Model、previous API context 和 UI business DTO 只从当前有效 Floor 与真正配置恢复。

本阶段不兼容旧版本存档，不做 migration、legacy reader、deprecated schema 或 fallback；不修改 Data Management / clear 设计，不 commit/push。

## Product decisions

- BioWeave 当前处于开发/构建阶段，不需要兼容旧版本存档。
- `chatMetadata.bioweave.settings` 是 Chat-local configuration，保留且不改变语义。
- `data_lifecycle.character_reset` 是仍有效的 lifecycle control state，保留；clear 重构另行处理。
- 不修改 Prompt、API 配置、世界书或 Data Management UI。
- 纯函数工具（例如 `core/snapshot.js`）不因持久 schema 删除而自动删除。

## Required changes

删除 Chat-level：`character_profiles`、`character_registry`、`tracking_subjects`、`tracking_candidates`、`relationships`、`index`、Chat-level `world_model` / `world_model_meta`。

删除对应 schema default、normalizer、store getter/setter、refresh write-back、fallback/compatibility code、lifecycle ownership、fixtures 和旧 ownership docs。

删除未启用 Floor persistent slots：`history`、`snapshot`、`projections`，但保留仍有独立用途的纯函数。

将 Runtime 数据流固定为：

```text
valid Floor Events + Floor World Model + Floor character_registry
  -> rebuildTrackingRegistry()
  -> Runtime business DTO
  -> UI/API
```

`refreshTrackingRegistry()` 不得调用 `store.saveChat()` 保存人物 projection 或 scheduling index。

## Acceptance criteria

- `emptyChat()` 最终只保留结构字段、`settings` 和 `data_lifecycle.character_reset`。
- `emptyFloor()` 最终只保留实际启用的 Floor facts：`floor_version`、`analysis`、`events`、`character_registry`、`world_model`、`world_model_meta`，以及仍有明确 owner/consumer 的结构字段。
- Characters、Events、Overview 的 business DTO 从 Runtime derive 获取，不读取 Chat projection。
- previous/API/identity-history 只读取合法 Floor `character_registry`，没有 Chat fallback。
- World Model 没有 Chat compatibility path；storage、resolver、manual save、UI、API 和 reload 均走 Floor owner。
- `relationships` 不再作为持久 schema；未来 genealogy 重新按 Floor fact -> reducer -> Runtime projection 设计。
- `data_lifecycle.character_reset` 保留并继续承担清除后的 projection boundary 语义。
- 新增 Floor 1/2/3 reload proof，验证人物、事件、identity、World、previous API context、last processed floor、pending candidate、eligible subject/profile 全部恢复。
- 新增 forbidden dual-persistence contract test；运行 analysis、refresh、reload、World save 后，Chat metadata 不得出现：`character_profiles`, `character_registry`, `tracking_subjects`, `tracking_candidates`, `relationships`, `index`, `world_model`, `world_model_meta`。
- `npm test`、`npm run check`、`git diff --check` 通过；不 commit/push。

## Explicitly out of scope

- 不重构 clear、Start New Chat 或 Data Management UI。
- 不修改 Prompt、API 配置、世界书。
- 不实现 genealogy reducer。
- 不保留任何旧字段来兼容旧存档。

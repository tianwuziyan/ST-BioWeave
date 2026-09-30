# Design

## Boundary and flow

`core/world-species-archive.js` 新增 `deleteArchivedWorldModelSpecies(model, meta, speciesOrIndex)`。与 Restore 一样先归一化 meta，index 走 UI 直接目标；identity 查找仅调用现有 `normalizeWorldSpeciesIdentity()`。成功时克隆 model 并仅 splice 归一化 meta 的目标 entry；失败返回原输入和 `ARCHIVED_SPECIES_NOT_FOUND`。可用轻量 facade 适配 `ui/app.js` 已采用的 `*WorldSpecies` 命名，不复制逻辑。

归档 popover 中每行显示 Restore 与 Permanent Delete，后者用现有 `bioweave-danger-action`。只在按钮布局确实拥挤时最小改 `style.css`。

`ui/app.js` 的新 handler 靠近 Restore：busy/index/draft guard → 从当前 state 归一化 model/meta 并读取目标名称 → `confirmWithPopup` → domain pure transform → busy/render → 一次 `runtime.saveWorldModel({model, meta})` → token assert → state/render/notify。Cancel 不预写 state。失败沿用 Restore 的错误处理。保存成功不调用 `refreshTrackingAfterWorldModelSave`。

## Data lifecycle

归档 entry 属于当前有效 Floor/Swipe 的 World metadata。Permanent Delete 仅移除 snapshot，不引入持久化字段；World/All clear、Chat 切换、Swipe/版本失效和 stale-result guard 继续使用现有 World owner 生命周期。`runtime.saveWorldModel` 仍是唯一 writer；它的 readback 与 transaction 语义不变。

Full 与 Supplement 从当前 World owner 解析 meta 后动态构建归档引用。entry 移除后，引用不再包含该 identity，已有 gate/filter 自然不再因 Archive 排除它。`runtime/tracking-runtime.js` 未读取归档 meta，active model 不变，因此无需刷新 tracking registry。

## Compatibility and scope guard

保留 Archive/Restore 的完整 subtree、collision/no-op 和 canonical identity 行为。`Species-A` 与 `species-a` 继续不同；Human alias 继续由现有 helper 处理。若实施时发现排除引用被 registry 缓存，或最小实现必须改 runtime analysis/persistence/Analyzer/Prompt，暂停并报告调用链，不扩大范围。

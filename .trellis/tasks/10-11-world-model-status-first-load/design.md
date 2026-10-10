# 技术设计：状态页 World Model 轻量状态读取

## 根因与生命周期理解

World Model 状态的生命周期属于当前 Chat / Floor / Swipe 的持久化历史，不属于世界页。当前实现却把 resolver 调用绑定在世界路由：`render()` 仅在 `route === 'world'` 调用 `loadWorldModelState()`。状态路由只拿 `worldModelState.meta`，而 `ui/state.js` 将 `meta === null` 视为 `not_enabled`。因此“首次直达状态页”只是暴露了问题：实际错误是页面访问顺序改变了是否发生历史解析。

## 最小方案

只在 `ui/app.js` 让状态页成为现有 Runtime 历史 resolver 的独立消费者，并尽量复用现有 loader 状态：

- 状态页 render 时按需触发现有 `runtime.resolveWorldModelAtOrBefore()`；世界页仍使用完整现有 loader。两者的历史边界、Floor/Swipe 解析和 Chat token 必须相同。
- status-only 分支不调用 `normalizeStoredWorldModel`、`buildWorldModelViewModel`、fingerprint 或 `applyWorldModelUiIngress`；在同一有效 owner 内暂存 resolver 返回的原始模型，后续进入世界页时交给既有 ingress 一次性构建 View Model，避免重复 resolver 读取。该暂存只存在于当前 app 状态，并随 owner/generation 失效，不是跨 Chat/Floor/Swipe 缓存。
- 优先复用现有 `worldModelState.loading/loaded`、load generation、in-flight 与 queued refresh，不新建独立 hydration 状态管理。只有在现有异步流程无法避免临时 `null` 进入 `ui/state.js` 时，才增加最小的提交门控；该门控只控制何时提交/重绘原有 `worldModelMeta`，不产生新的可见状态。
- resolver 成功返回模型时写回原有 `worldModelMeta`，并保留同一 owner 的原始结果供世界页复用，继续使用 `ui/state.js` 的既有 `worldModelMeta ? success : not_enabled` 逻辑；确认当前历史无模型时继续显示原有未启动标签。
- resolver 失败沿用现有错误处理，不新增专属错误面板、不伪装成确认无模型，也不覆盖上一个已确认位置的数据。
- 完整世界页加载和既有 render / View Model / stringify 去重保持不变；关闭重开 UI 后仍从当前 resolver 重新得到同一历史位置结果。
- `ui/state.js` 的状态标签、样式和展示约定不改。

## 边界与兼容性

- Runtime 与 Floor storage 不变，World Model 仍从现有 resolver 的有效 Floor/Swipe 结果读取。
- 不保存 UI status，不产生 Chat-level cache，不改变 `worldModelState.model` 的世界页 View Model contract。
- `render()` 不调用 `worldPage()`；状态页只因当前历史 resolver 结果需要时更新一次，不增加首次打开 UI 的无关完整 render。
- lifecycle invalidation 继续清空/失效现有 app-local 状态，并使状态页下一次 render 重新读取当前 owner。

## 失败语义

- resolver 未返回模型且读取成功：沿用原有 `not_enabled` / “未启动”显示。
- resolver 尚未返回：复用现有 loader 的未完成语义；必要时由最小提交门控阻止临时 `null` 交给原有未启动判定。
- resolver 抛错：沿用现有错误处理；不提交新的 `meta`，也不把失败结果伪装成已确认的未启动状态。

## 回滚

修改集中在 `ui/app.js` 和 UI 测试；`ui/state.js` 不改可见状态体系。如验证发现 world route 行为变化，可只回滚 status-only 分支，保留原有 full loader。

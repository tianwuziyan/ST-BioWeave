# 修复状态页世界模型状态首次加载

## Goal

世界模型状态始终由当前 Chat / 有效 Floor / active Swipe 的真实持久化数据决定；状态页和世界页的访问顺序不得改变结果，也不触发任何 Full 或 Supplement 分析。

## Confirmed facts

- `ui/app.js:4317-4319` 只在 `route === 'state'` 向状态页传入 `worldModelState.meta`，状态页没有收到加载中、失败或模型存在性状态。
- `ui/app.js:4378` 之前只在 `route === 'world'` 调用 `loadWorldModelState()`；因此状态页是否正确依赖用户是否先访问世界页，页面访问顺序错误地影响了状态 hydration。
- `ui/state.js:39-43` 使用 `worldModelMeta ? 'success' : 'not_enabled'` 判定状态；未完成 hydration 的 `null` 被直接解释为“未启用”。
- Runtime 已提供 `resolveWorldModelAtOrBefore()`，该 resolver 按有效 Floor/Swipe 和 Floor Version 读取历史 World Model；当前 UI 的 world route loader 已具备 Chat token、generation、Floor Version 与 stale-result 隔离。
- `applyWorldModelUiIngress()` 会构建 World Model View Model；状态页只需要轻量的存在性、owner meta、加载中与失败状态，不应为了状态页渲染世界页或构建完整 View Model。

## Requirements

1. 状态页按需通过现有 Runtime resolver 读取当前历史位置的 World Model 状态；读取完成后继续复用现有 `worldModelMeta ? success : not_enabled` 判定与显示标签。
2. 页面访问顺序不得成为状态正确性的前提。若现有异步读取需要提交门控，只使用现有 loader 的最小 `loading/loaded` 语义，阻止未 hydration 的 `null` 被当作“未启动”；不新增 loading、failed、unknown 等可见 World Model 状态或 UI。
3. 读取失败沿用现有错误处理和安全回退，不新增专属错误面板，也不把失败伪装成已确认的“未启动”。
4. 读取只使用现有 Runtime resolver/真实 Floor-owned 数据，不触发 Full、Supplement、Event Analysis、Archive、Floor persistence 或 Chat 写入。
5. 状态页读取不构建完整 World Model View Model，也不渲染世界页；进入世界页后仍按现有路径 hydration，并与状态页结果一致。
6. Chat、Floor、Swipe 或 Floor Version 变化时，旧异步结果不得污染新状态；不得新增跨 Chat/Floor/Swipe 全局缓存。
7. 既有 UI render / View Model / stringify 去重逻辑保持不变。
8. 只修改必要的 UI 状态加载逻辑与相关测试；不修改真实聊天数据、World Model 历史语义、Floor persistence、migration 或分析流程。

## Acceptance Criteria

- [ ] 当前历史位置存在有效 World Model 时，状态页无论先访问世界页、先访问状态页、关闭重开 UI，均显示“成功”和对应 owner 信息。
- [ ] 没有 World Model 时显示真实的“未启动/尚未建立”状态。
- [ ] 状态页读取期间不因未 hydration 的 `null` 显示“未启动”；可见标签体系不变。
- [ ] resolver 失败沿用既有错误处理，不伪装成已确认的“未启动”。
- [ ] 先状态页后世界页、先世界页后状态页，两页状态一致且不产生明显重复读取。
- [ ] Chat、Floor、Swipe/版本切换后只显示新历史位置的状态，旧请求结果被丢弃。
- [ ] 定向测试覆盖读取次数、render 次数、无 Full/Supplement 调用和上述最小状态矩阵。
- [ ] `node --check`、相关 UI/World Model/Floor/Swipe 定向测试、`git diff --check` 通过；完整套件的既有失败需单独列出。

## Out of scope

- 不改 Runtime resolver、Floor persistence contract、历史版本语义、Full/Supplement、Archive、migration 或真实聊天数据。
- 不重构 UI 框架，不添加跨 Chat/Floor/Swipe 缓存或新的全局状态服务。

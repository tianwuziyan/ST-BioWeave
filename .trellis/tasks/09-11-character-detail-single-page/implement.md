# 执行计划：人物详情单页人物卡

## Ordered checklist

1. 记录当前 worktree、分支和相关代码证据；确认本轮只触及 UI、测试、样式和 UI 文档。
2. 在 `ui/characters.js` 删除人物详情 Tab 常量/内容选择器，抽出连续 section renderer，保证 Event exposure 只渲染一次并保留 participant/counterpart。
3. 在 `ui/characters.js` 移除 `characterDetailTab` 参数，保持 tracking subject 详情入口门槛和现有摘要/能力展示。
4. 在 `ui/app.js` 删除 Tab state、传参、reset、事件委托 selector 和 click handler；保留 `focusedCharacterId` 与顶级导航。
5. 删除 `style.css` 中仅旧人物详情 Tab 使用的 CSS。
6. 更新 `tests/phase2a-ui.test.js`，覆盖单页 section 共存、空状态、Tab 标记/状态移除、Event 去重、tracking subject gate、counterpart 和不做 eligibility/state 推导。
7. 更新 `docs/UI.md` 的 Character Detail 契约。
8. 运行 UI 回归测试和完整 `npm run check`，再运行 `git diff --check`；审阅 diff，确认禁区文件未被修改。

## Validation commands

```bash
npm run check
git diff --check
git status --short
git diff --stat
git diff -- ui/characters.js ui/app.js style.css tests/phase2a-ui.test.js docs/UI.md
```

## Risky files and review gates

- `ui/characters.js`：检查 section 顺序、`renderExposures` 单次调用、HTML escaping、subject-only gate。
- `ui/app.js`：检查所有 `characterDetailTab` / `data-character-tab` / `setCharacterTab` 引用均消失，并确认顶级 route 数组未变。
- `tests/phase2a-ui.test.js`：避免只测试字符串存在，必须测试同一 HTML 的共存与 Event card 计数。
- `docs/UI.md`：确认文档不再把人物详情描述为互斥 Tab。

## Authorization boundary

允许修改上述五个产品/验证文件及本任务规划文件；禁止修改用户列出的 Event AI、Tracking、Runtime、StoryTime、Prompt、World Model、StateReducer、Projection、Genealogy 等业务实现。禁止 commit 和 push。

# 实施计划

1. 在 `ui/app.js` 让 `route === 'state'` 通过现有 Runtime resolver 独立读取当前历史位置；优先复用既有 `worldModelState.loading/loaded`、in-flight、generation 和 queued refresh，不引入新的 hydration 状态管理。
   - 验证：状态页与世界页使用同一历史解析语义；不调用 Full/Supplement，不构建世界 View Model。
2. 仅在必要时增加最小提交门控，确保 resolver 尚未完成时不会把临时 `null` 交给原有 `worldModelMeta ? success : not_enabled` 判定；确认无模型时仍走原有未启动标签。
   - 验证：不新增 UI 标签或样式；读取失败不覆盖已确认的新旧历史状态，也不伪装成无模型。
3. 将 status-only 请求接入现有 Chat token、Floor/Swipe owner 与 queued refresh 隔离；同一有效 owner 已成功解析的原始结果可由后续 world route 复用，再进入既有完整 ingress，避免重复 resolver 读取。完整 world loader、render/View Model/stringify 优化保持不变。
   - 验证：Chat/Floor/Swipe/版本切换的旧 Promise 结果不会更新当前 `worldModelMeta`。
4. 增补 `tests/ui.test.js` 及必要的状态页测试，覆盖访问顺序无关、关闭重开、Floor 历史位置、Chat/Swipe 隔离、无历史模型、读取次数、render 次数和分析调用计数。
   - 验证：相关 UI/World Model/Floor/Swipe 定向测试通过。
5. 运行语法检查、`git diff --check` 和定向测试；检查相关 Markdown 是否仍准确。
   - 验证：记录完整套件既有失败，不将其宣称为本次修复失败或完整通过。

## 关键验证命令

```bash
node --check ui/app.js
node --check ui/state.js
npm test -- --test-name-pattern='World Model|state page|Chat|Swipe|Floor'
npm test -- tests/ui.test.js tests/phase2a-ui.test.js
git diff --check
```

命令参数将根据仓库实际 `package.json` 测试脚本调整；不得执行 commit、push、reset 或 clean。

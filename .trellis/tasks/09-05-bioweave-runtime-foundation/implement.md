# BioWeave 基础运行层实施计划

## 实施顺序

1. 更新 `manifest.json` 与 `index.js`：使用 activation hook，注册/复用 `#extensionsMenu` 菜单项，建立幂等 init/destroy 和 app/runtime 组合。
2. 更新 `runtime/chat.js` 与 `runtime/events.js`：使用官方 `getContext()` 字段、`eventTypes`、`removeListener`，实现 boundary epoch、陈旧操作拒绝、Chat/message/swipe/generation invalidation。
3. 更新 `runtime/floor.js`：补齐 Floor Version identity 比较、版本感知分析决策、成功/失败提交规则，并为编辑/swipe/手动刷新添加测试。
4. 更新 `storage/schema.js` 与 `storage/store.js`：默认结构、Chat scope 校验、普通消息/per-swipe 存储、异步边界校验和最小 secret-field 清洗。
5. 更新 `ui/app.js`、现有 `ui/*.js` 的骨架 class 与 `style.css`：统一 `bioweave-` 前缀，确保唯一根节点、主题 token、即时持久化、Chat 切换刷新、移动断点不引入横向溢出。
6. 在现有测试文件中增补核心契约；仅在存储测试无法自然归属时新增一个 `tests/store.test.js`，不拆出大量测试文件。
7. 运行质量门：`npm test`、`npm run check`、对所有修改的 JS 执行 `node --check`，并用静态搜索确认没有 `BioState`、`bw-`、`off?.` 等本轮应消除的旧/错误路径。
8. 依据用户要求输出 A–G 审计、修改文件清单、测试、TODO 与下一步；AI/完整 UI 功能保持明确 TODO。

## 验证命令

```bash
npm test
npm run check
node --check index.js
find runtime storage core ai story context ui -name '*.js' -print0 | xargs -0 -n1 node --check
rg -n "BioState|bw-|\.off\?\(|currentCharacter|api_key" --glob '!docs/references/**' .
```

## 风险点与回滚点

- `manifest.json` / `index.js`：宿主激活顺序、菜单 DOM 时序；改动后先验证模块可导入与 hook 幂等。
- `runtime/events.js`：宿主事件常量/解绑方法；以官方 release 源码为准，不保留猜测性 `off` 回退。
- `storage/store.js`：swipe 0 的迁移语义和 Chat 切换竞态；先用 fake adapter 测试读写路径，再接 UI。
- `ui/app.js` / `style.css`：前缀替换可能触及所有页面骨架；只做机械、同义替换和必要生命周期修正，不扩大为 v2.0 全 UI 重写。
- 若任一宿主适配验证失败，停止在该边界继续扩展，保留核心纯函数测试，并报告需要真实 ST 实例确认的部分。

## 开始实现前检查

- [x] 已获得用户创建 Trellis 任务的许可。
- [x] 已读取工程文档、参考图、入口、各业务目录、样式、设置和测试。
- [x] 已运行基线 `npm test`（7/7 通过）和 `node --check`。
- [x] 已核对官方 SillyTavern release 的 manifest、context、eventSource/EventEmitter、ChatMessage、secrets 资料。
- [x] 用户已批准本最终规划摘要，已执行 `task.py start` 进入实现阶段。

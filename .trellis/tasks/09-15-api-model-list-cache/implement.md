# 实施计划：独立 API profile 模型列表缓存

## 变更清单

1. [x] 在 `storage/schema.js` 增加 `api_model_caches` 默认值、缓存条目/映射规范化，并接入 `normalizeExtensionSettings()`。
2. [x] 在 `storage/store.js` 增加缓存读取/保存 API，并在 `deleteProfile()` 的原子全局设置写入中删除对应缓存。
3. [x] 在 `ui/app.js` 增加缓存索引和时间戳状态；更新 settings 加载、profile 切换、新建/取消/删除、保存迁移和销毁重置流程。
4. [x] 修改 `refreshModels()`：成功后规范化、持久化稳定 profile 缓存并替换内存列表；失败保留旧列表/缓存。
5. [x] 补充 `tests/api-profile.test.js` 的 schema/store 缓存、profile 隔离、覆盖、删除、临时键和安全边界测试。
6. [x] 补充 `tests/ui.test.js` 的刷新成功/失败、App 重建恢复、profile A/B 切换和未保存 profile 行为测试。
7. [x] 对本次修改的 JavaScript 执行显式风格参数的 `npx prettier --write`；再运行定向测试、`node --check`、`npm test`、`npm run check` 和 `git diff --check`。
8. [x] 由独立质量检查复核实际 diff、跨层数据流、Secret 边界和验收标准；检查通过后重复格式化与测试。
9. [x] 保存成功后仅在 profile 持久化及必要缓存迁移完成后清空 editor；保存/校验/迁移失败保留 editor，并补充原取消行为及异步竞态测试。

## 验证命令

```bash
npx prettier --write storage/schema.js storage/store.js ui/app.js tests/api-profile.test.js tests/ui.test.js
node --check storage/schema.js
node --check storage/store.js
node --check ui/app.js
node --check tests/api-profile.test.js
node --check tests/ui.test.js
node --test tests/api-profile.test.js tests/ui.test.js
npm test
npm run check
git diff --check
```

## 风险与回滚点

- `normalizeExtensionSettings()` 是所有全局 profile 设置的共同入口；先验证旧设置/Secret 兼容，再接入缓存字段。
- `refreshModels()` 具有并发序列号和 draft 切换保护；不要在持久化 await 后删除这些 guard。
- 新 profile 的 `__new__` 迁移必须在 `saveProfile()` 成功获得正式 ID 后进行，失败时不能产生临时永久键。
- `deleteProfile()` 必须保留现有 Secret 清理顺序和错误语义；缓存删除不能改为独立 localStorage 删除。
- 若实现与本计划的缓存字段或错误语义发生实质偏差，回到 planning 更新 `prd.md` / `design.md` 后再继续。

## 完成门槛

- [x] `prd.md`、`design.md`、`implement.md` 已审核并获用户批准。
- [x] 实现只触及任务范围文件及必要的 Trellis 规范/测试文件。
- [x] Prettier 已成功实际执行，且最终 JavaScript 通过对应参数的 `--check`。
- [x] 所有自动化检查结果真实记录；真实 SillyTavern Desktop/Tablet/Mobile 主机验收未执行，需在交付说明中明确。

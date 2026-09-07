# BioWeave UI Foundation / Responsive 实施计划

## 顺序

1. 记录并复核构画当前源码的接入事实：`#extensionsMenu` 菜单行、同步 click、`document.documentElement` fixed 主窗口宿主、高层级和移动端显式 viewport 定位。
2. 修正 `index.js` 菜单入口：保留稳定 observer、单一菜单项、canonical click/keyboard handler 与销毁清理；改为同步 open，移除 `preventDefault`、timer 和任何全局 body click 方案。
3. 修正 `ui/app.js` 根节点生命周期：`document.documentElement` 下唯一 overlay/panel，connected 检查，mount/open/close/destroy 幂等，Chat 切换不锁死再次打开；保留 route/focus/more 菜单壳。
4. 复核 `style.css`：沿用既有 Desktop/Tablet/Mobile 壳、三主题和 safe area，把主宿主层级提升到构画同量级，并用显式 top/left/`100dvw`/`100dvh` 取代移动端不稳定的 `inset: 0`。
5. 在现有 `tests/` 中增加少量 DOM/lifecycle/menu 回归测试；不建立独立业务 mock 数据库。
6. 运行 `npm test`、`npm run check`、所有修改 JS 的 `node --check`，并执行静态 forbidden-pattern 检查。
7. 用更新后的真实 SillyTavern 页面完成 Desktop/Tablet/Mobile 手工检查；主窗口应覆盖宿主 drawer，不将手动关闭 drawer 作为前置条件，并在交付信息中给出用户可重复步骤。
8. 通过 `trellis-check` 做范围/规范/测试复核；把菜单临时容器、detached root、移动安全区等新契约写入 frontend code-spec，再准备收尾。API Profile/Worldbook/World Model 继续列为 TODO。

## 验证命令

```bash
npm test
npm run check
find runtime storage core ai story context ui -name '*.js' -print0 | xargs -0 -n1 node --check
node --check index.js
rg -n "BioState|bw-|bio-card|currentCharacter|document\.body\?\.click\(\)" --glob '!docs/references/**' --glob '!*.jpeg' .
```

## 手工验收顺序

### Desktop（>= 1200px）

魔法棒 → `#extensionsMenu` → BioWeave；确认左侧完整导航、内容区、主题按钮出现。点击关闭再重复打开，确认只有一个 overlay/panel；依次打开总览、人物、事件、推演、家系、世界模型、设置。

### Tablet（768–1199px）

将窗口/浏览器 viewport 调到 1024×800 或真实 iPad；同样从魔法棒菜单进入，确认顶部紧凑导航和内容区；打开“更多”相关入口、人物详情和三主题，确认没有被 menu 销毁或发生横向溢出。

### Mobile（< 768px）

将 viewport 调到 390×844 或真实手机；直接从魔法棒 → `#extensionsMenu` → BioWeave 进入，不要求先手动关闭酒馆 drawer。确认单列 panel 位于宿主 UI 上层、底部“总览/人物/事件/推演/更多”导航；点击“更多”打开真实菜单并进入家系图谱、世界模型、设置、分析状态；检查底部安全区、关闭重开和页面宽度。

## 风险与停止点

- 如果入口仍无法触发，先抓取实际 `elementFromPoint()` 和宿主菜单状态，不能通过添加顶部常驻按钮掩盖问题。
- 如果宿主 menu 被重建，检查 observer 是否只恢复一个入口，不让业务 root 跟随 menu 生命周期。
- 如果测试暴露真实数据层问题，停止在 UI 任务边界，不顺手进入 API/Worldbook/World Model 或 Event CRUD。

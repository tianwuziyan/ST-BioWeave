# Implementation Plan — Character Health Popover v3

状态：实现完成，等待人工 review

## Ordered checklist

1. 读取适用规则与当前工作树差异；确认不覆盖 `work/`，确认健康弹窗现有 hooks 与测试断言。
2. 在 `ui/characters.js` 做最小 presentation markup 调整：第一列 body site/laterality/source，第二列中文标签/description/recovery，第三列 severity；不改变现有函数签名和 DTO 消费。
3. 在 `style.css` 收敛弹窗 desktop/mobile 定位、健康 token、header/body spacing、固定三列、来源底部对齐和连续三阶段 thermometer。
4. 检查旧 CSS 选择器、旧 HTML class 和测试是否仍指向已替换结构；只清理本次变更产生的无效样式/变量，不做无关重构。
5. 同步检查受影响 Markdown；如果 `docs/UI_FRAMEWORK.md` 或相关 Character Health 文档描述了旧视觉结构，按最终实现同步，否则记录无需更新。
6. 执行 focused health UI tests、`npm test`、`npm run check`、`node --check` 和 `git diff --check`；区分本次失败与既有失败。
7. 做静态验收：无英文业务标签、无百分比、无 demo event IDs/演示数据、intervention 未进入弹窗、source action hook 未变。

## Verification commands

```bash
npm test -- --test-name-pattern='health|character|UI'
npm test
npm run check
node --check ui/characters.js
git diff --check
```

## Risk and rollback points

- `ui/characters.js`：风险是误改 DTO fallback 或来源 action；回滚点为 health helper/render block。
- `style.css`：风险是旧的后置 `!important` 规则覆盖新布局、移动端页面横向溢出；回滚点为健康弹窗 CSS block 与其 mobile overrides。
- 真实 SillyTavern host 视觉验收仍需人工完成；Node/static tests 不能替代 desktop/tablet/mobile host 检查。

## Verification record

- focused Character Health UI：66 passed，0 failed。
- Health Assessment / Evolution / Recovery Guidance / Character UI / UI：194 passed，0 failed。
- `node --check ui/characters.js`、`node --check index.js`：通过。
- `git diff --check`：通过。
- 最近一次修正已覆盖：Health Read Model 摘要位于总体状态行下方、严重度右对齐警示色边框徽标、关闭按钮无额外外框；对应回归断言通过。
- `npm run check` / `npm test`：全量运行进入既有长时 `tests/event-analysis-runtime.test.js`，未获得 clean completion；该测试此前已有长时间无终态与独立失败记录，未将其归因于本次 UI 修改。全量运行中同时观察到既有 World Model fixture 与 Floor Version preflight 失败。
- 真实 SillyTavern Desktop / Tablet / Mobile host 视觉验收：尚未执行，留待人工 review。

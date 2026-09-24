# 人物分析 Prompt 回归修复报告

## 根因

`8f98263b` 在 `EVENT_ANALYZER_CORE_CONTRACT` 前部加入过宽的 authority 句：它把 `Character Card` 的 `gender/sex` 排除在 species、`biological_type` 与 capability 的全部依据之外。该句与同一 Prompt 后部既有规则冲突：明确生理性别可以参与映射到当前 World Model 已存在的 `biological_type`，而 capability 仍必须来自匹配 baseline 或明确个体证据。

## 最终语义

明确生理性别事实 → 仅作为映射到当前 validated World Model 已存在 `biological_type` 的证据 → 映射成功后读取匹配 species/type 的 World Model baseline capability，并结合明确个体证据。

gender/sex 不直接推出 capability，不创建缺失 type，不给 Nonhuman 套 Human baseline，不使用现实人类常识或旧默认能力补空；mapping 冲突/不足保持 `null` 并进入 pending。

## A–E 覆盖

- A：Event prompt regression test 断言已存在 Human type 的 gender mapping 与匹配 baseline capability 顺序。
- B：同一 test 断言不能由 gender 单独创建 type 或 capability。
- C：contract 断言禁止把其它 species 的同名 type 套用 Human baseline。
- D：既有 tracking fallback test 增加 `value=true`、`reason=EXPOSURE_CARRYING_CAPABILITY` 与 eligible registry 断言。
- E：contract 断言 mapping 冲突/不足保持 `null` 并进入 pending。

## 修改文件

- `ai/prompts.js`
- `tests/event-analysis.test.js`
- `tests/tracking.test.js`
- 本 task 的 Trellis 规划与报告文件

未修改 `core/tracking.js`、`runtime/event-analysis.js`、`runtime/events.js`、`core/identity.js`、World Model、Story Time、Calendar、StateReducer、Floor ownership、Persistence 或无关 Runtime。

## 五个提交审计

- `8f98263b`：确认新增了冲突 authority 句；这是本回归的 Prompt 引入点。
- `cbb5654e`：涉及调度/Runtime 变更，但未改 `core/tracking.js`。
- `12b40071`：涉及存储/UI 生命周期衔接，未改 `core/tracking.js`。
- `89a76da6`：涉及 Event 严格校验/诊断，未改 `core/tracking.js`。
- `b4df8930`：涉及 Floor 持久化协调与前置条件，未改 `core/tracking.js`。

## 验证

- `node --test tests/event-analysis.test.js tests/tracking.test.js`：56/56 通过。
- `npm run check`：928/928 通过。
- `node --check ai/prompts.js`：通过。
- `git diff --check`：通过。
- 未提交、未推送、未进入 Phase 2C。

## Diff 摘要

生产 Prompt 变更 3 处：CORE authority 句、TASK mapping/capability 顺序句、OUTPUT participant identity/type guard；新增 Event Prompt contract regression assertions 35 行；增强 tracking fallback regression assertions 9 行。当前生产代码 diff 未触及 Runtime。

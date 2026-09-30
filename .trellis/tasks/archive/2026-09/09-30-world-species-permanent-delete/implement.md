# Implementation plan

1. 保存审计证据与测试 baseline；核对 tracking exclusion 读取路径和 UI/World 生命周期规范。
2. Domain：增加归档 snapshot 删除纯函数及必要 facade；加输入不可变、identity、no-op、完整 snapshot、Archive/Restore 和 exclusion lifecycle 测试。
3. UI：在归档条目旁增加 danger action；在 Restore 旁加入确认与唯一 World save handler；加 render、Cancel/Confirm/payload/failure/no-refresh 测试。
4. 同步更新 `docs/ui-framework.config.json`、`docs/UI_FRAMEWORK.md`、`docs/UI_FRAMEWORK_EXAMPLE.html`、`docs/bioweave-data-lifecycle.md` 及 `.trellis/spec/domain/world-model.md`；必要时才改 `style.css`。
5. 验证：相关测试、`tests/ui.test.js`、完整 `npm test`、baseline/current failure identity diff、`git diff --check`、所有修改 JS 的 `node --check`；审查最终 diff 范围和实际 SillyTavern 可用性。

## Stop conditions

发现 tracking registry 缓存 archive exclusion、需要改 runtime analysis 或 persistence 架构，立即停止实现并报告证据。保留所有既有 Archive/Restore 行为。实施阶段原指令禁止 commit、push、reset、clean；2026-09-30 用户随后明确授权同步 GitHub，仅解除本任务的 commit/push 禁令。

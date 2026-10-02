# 定位真实宿主自动分析触发回归

## Goal

定位 `132f9158303b00a9abfb3b69a8204fc87ab009b7` 到当前
`fix/world-model-prompt-baseline` 之间的真实 SillyTavern 自动 Character/Event
analysis regression，并在且仅在代码、测试或真实 host shape 能证明根因时实施最小修复。

## Confirmed facts

- 当前分支相对 `132f915` 只有 `ad1f394` 与 `756d76c` 两个业务提交。
- 两提交没有修改 scheduler 的 interval、counter、due 规则或 generation lifecycle；主要改变了 host message role 归一化、Character Floor owner 判定和 narrative filtering。
- `132f915` 的 `isCharacterMessage`：`role=user/system` 或 `is_user/is_system` 对应值会拒绝，其余 shape 默认接受为 Character。
- 当前 `core/message-role.js`：`is_user=true` 为 User；`extra.type=narrator` 为 System；`extra.type=comment` 或任意其他非空 type 为 Other；显式存在 `is_user` 且为 false 时为 Character；最后才使用 synthetic message 的 `role` fallback。
- 当前本地已有的 hidden Character、generation settle、Character counter、due/automatic trace 测试通过；不能把这些测试通过误认为 real-host 已验收。
- 官方 SillyTavern 普通生成消息 shape 为 `is_user:false`、`is_system:false`、`extra:{}`，该 shape 在当前归一化器中仍是 Character。

## Requirements

1. 沿以下同一条链比较 OLD 与 CURRENT，并记录每个阶段的输入/输出：
   `generation lifecycle event → generated message → host role normalization → isCharacterMessage / Character Floor recognition → scheduler valid Character Floor counting → due decision → automatic event-analysis invocation`。
2. 明确回答 `OLD_WORKING_PATH`、`CURRENT_BROKEN_PATH`、`FIRST_BEHAVIOR_DIFFERENCE`，并标出 scheduler 是否收到、计数、due、调用 analysis，以及具体 guard/error。
3. 不依赖 commit message 推断根因；必须给出代码路径、真实 host shape 或可复现 fixture 证据。
4. 若根因明确，只修改最小必要代码，并新增回归测试：真实 host Character message shape 必须仍被识别为有效 Character Floor 并进入自动 scheduler；保留并验证 hidden Character、narrator、comment、unknown extension message 的边界测试。
5. 不回滚 manual supplement A+B preservation 修复；不恢复 hidden Character 被误判 system 的旧 bug；不重写 scheduler；不改变计数产品规则；不处理其他 21 个 failures；不 commit/push。

## Acceptance Criteria

- [ ] 报告完整覆盖用户要求的八个链路问题，并能定位首次行为差异。
- [ ] OLD/CURRENT 对同一个真实 host message shape 的分类、Floor 接收、计数、due 和 analysis invocation 有可复核证据。
- [ ] 只有在根因被证明时才有产品代码修改；否则明确报告 blocker/缺失的真实 shape 证据，不提交猜测修法。
- [ ] 若实施修复，新增 regression test 覆盖真实 shape 自动触发，并保留 hidden/narrator/comment/unknown extension 负向边界。
- [ ] 运行目标测试与 `node --check`；不把其他已知 failures 纳入本任务结论。
- [ ] 最终报告包含 `HOST_RETEST_STEP`，并明确 real-host acceptance 尚未由 Node tests 替代。
- [ ] 检查相关 Markdown 是否受影响；若实现改变角色契约或自动触发行为，同步更新受影响的权威 Markdown。

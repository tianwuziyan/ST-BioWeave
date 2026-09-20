# 执行计划（待规划批准后启动）

1. 加载 `trellis-before-dev`，读取 domain/frontend 规范，确认 worktree 与本任务边界。
2. 删除 `emptyChat()` 旧 projections、Chat registry、relationships、index 和 Chat World residue；保留结构、settings、`character_reset`。
3. 删除 `emptyFloor()` 的 `history`、`snapshot`、`projections`，同步 storage normalization/clear/lifecycle handling；保留独立纯函数。
4. 删除 store 的 Chat projection getter/setter、normalizer、legacy World cleanup 和所有 derived write-back。
5. 修改 `refreshTrackingRegistry()` 为 Runtime-only refresh；修正 `defaultCharacterContext()`、`buildFloorAnalysisInput()`、business DTO 和 UI consumers 的数据入口。
6. 更新 tests/fixtures/docs，移除旧 ownership/fallback 断言；不改 Prompt、API 配置、世界书和 Data Management UI。
7. 增加 Floor 1/2/3 reload proof，验证 Characters、Events、identity、World、previous API context、last processed floor、pending candidate、eligible subject/profile。
8. 增加 forbidden dual-persistence contract test，覆盖 analysis、refresh、reload、World save。
9. 运行 `npm test`、`npm run check`、`git diff --check`，检查 `git diff`；不 commit/push。

## Review gates

- 任何 `store.saveChat()` derived write-back 必须消失。
- Chat metadata forbidden list 必须在 Runtime refresh 后保持不存在。
- Floor previous/API/identity paths 必须没有 Chat fallback。
- `settings` 和 `data_lifecycle.character_reset` 语义不得被清除。
- clear 仅同步删除不存在的 ownership/fixture，不重新设计行为。

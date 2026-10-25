# 实施计划：简化剧情支线快照身份

## 阶段 0：基线

1. 搜索 `snapshot_id` 的全部生产和测试引用，区分快照业务字段、branch
   ID、delivery ID 和 attempt ID。
2. 运行现有 Storyline core/storage/runtime 聚焦测试，确认当前失败和
   既有行为基线。

## 阶段 1：核心合同与存储回写

1. 先补测试：旧 Floor 快照作为逻辑基线，在当前 Floor 变更后保存完整
   集合，历史 Floor 不变，readback 不因旧/新 Floor 身份差异失败。
2. 修改核心快照 normalize/validate/create，使 `subject_id` 成为必要的
   归属键，不再要求 `snapshot_id`。
3. 保持 storage 的 current-complete overlay、sibling preservation、
   current Floor restamp 和 explicit empty/terminated 语义。

## 阶段 2：运行时过期保护

1. `saveVerified()` 先将目标快照与 siblings 规范化到当前 Floor，再以
   subject、状态、selected branch、游标和分支结构完成 readback 比较。
2. judge API 返回后，使用当前有效 Floor/Swipe 与 `due_attempt_id`/subject
   重新验证；任何版本或尝试不一致都失败关闭，不写入旧结果。
3. 清理因删除 `snapshot_id` 产生的无效字段读取和测试夹具。
4. 同步 Runtime/Settings Debug 的安全投影，移除 storyline `snapshot_id`
   展示，但保留 triggered Projection 自身的同名字段。
5. 将独立 subject 的 Storyline API 请求改为并行等待；每个结果独立完成
   解析和 stale/attempt 校验。合并时逐条过滤不合格结果，保住同批其它
   合格结果，并通过当前 timeline 重读/overlay 避免 sibling 丢失。

## 阶段 3：文档与验证

1. 同步相关架构、Floor ownership 和 lifecycle 文档，只描述已实现事实。
2. 运行 Storyline 聚焦测试、相关 storage/runtime 测试、`npm run check`、
   `git diff --check` 和 `task.py validate`。
3. 检查真实宿主所需的 Debug 字段仍然安全且不泄漏完整 prompt/response，
   并确认设置页不再出现空的 storyline `snapshot_id` 行。
4. 增加至少一组“一个 subject 结果无效、另一个 subject 结果有效”的回归，
   验证有效 subject 仍被写入且无效结果未进入 Floor。

## 停止条件

- 若移除快照 ID 需要改动非 Storyline 的 Projection/Event identity，停止并
  另行拆分任务。
- 若发现当前 runtime 没有可替代的 owner/attempt stale guard，不删除该
  guard；保留最小内部版本指纹并报告原因。

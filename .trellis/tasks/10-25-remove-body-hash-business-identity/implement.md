# 实施计划：正文哈希身份迁移

## 阶段 0：基线与调用点分类

1. 读取完整 Floor ownership、Architecture 和 Data Lifecycle 合同。
2. 固化全仓命中清单，把每个 hash/version 调用点标为 logical owner、async operation 或纯
   fingerprint；记录其替代身份。
3. 运行当前聚焦测试，保存基线；任何与本任务无关的既有失败单独报告。

## 阶段 1：公共 Floor owner 与 schema

1. 先补四字段 owner、legacy extras 读取、新写入无 hash 的单元测试。
2. 将 `runtime/floor.js` 的权威身份收缩为 logical owner；提供唯一 comparator/key。
3. 迁移 AI/Core schemas、Event source、Snapshot/checkpoint 和 Projection/Health/Storyline DTO。
4. 更新确定性 ID builder，禁止序列化完整 Floor object。

## 阶段 2：Runtime 异步边界

1. Event/Character/World/Health 分析迁移到 logical owner + execution/run/request token。
2. Generation lifecycle 使用 intent/generation/Chat epoch，移除正文 hash 新 Floor 判断。
3. Projection/Storyline context、design/judge、submission/response 使用 operation/subject/
   branch/node/attempt identity。
4. `readStoryBodyByFloorVersion()` 按 logical owner 和 active Swipe 读取当前正文，不因旧 hash
   拒绝。
5. 为每个迟到结果路径增加或保留显式 stale 回归测试。

## 阶段 3：Storage 与完整集合语义

1. Floor coordinator 的 transaction/readback 改用 operation owner + active logical owner。
2. 迁移 Projection、Timing、Tracking、Participant、Pregnancy、Health/World/Event 的历史候选
   过滤、继承、overlay 和完整 readback。
3. 验证正文编辑、同 Floor 重分析、后续 Floor 修改/删除和回退矩阵。
4. 删除局部重复 owner comparator、六字段数组和旧兼容写回。

## 阶段 4：UI、Debug 与旧实现收口

1. 迁移 UI notification/refresh/edit target/activity key。
2. Debug 分功能显示 logical owner、API task identity、读取/写入先后和校验结果；不展示正文
   hash 业务版本。
3. 负向搜索 production/test/docs 中的 `content_hash`、正文派生 `message_version`、六字段旧
   语义；逐项确认剩余 hash 均为非正文 fingerprint。

## 阶段 5：文档与验证

1. 同步 Floor State、Event Pipeline、Frontend State、Architecture、Lifecycle、Data Model、
   Development、Scheduler、Health、UI 文档。
2. 运行受影响聚焦测试，再运行 `npm run check`、`git diff --check` 和
   `task.py validate`。
3. 审查实际 diff，确认未修改无关功能、未保留新旧两套身份合同。

## 停止条件

- 任一旧 hash guard 找不到可证明正确的显式 operation identity 时，停止该调用点修改并先
  补最小 token 设计，不得直接放宽 stale 防护。
- 发现宿主无法提供稳定 `message_id`/`swipe_id` 时，停止并报告，不用正文 hash 回退。
- 需要改变 Floor 持久化位置或新增 Chat-level 状态源时，拆分 root-cause 任务。

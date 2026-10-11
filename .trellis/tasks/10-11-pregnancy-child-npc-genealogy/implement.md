# 实施计划：Pregnancy Child NPC & Genealogy

本任务当前仅为 `planning`，本轮不得执行 `task.py start`，不得修改生产代码或测试。

## 阶段 0：契约与现状门禁

1. 读取 `core/identity.js`、`core/genealogy.js`、Event Analysis、Floor State、Data Lifecycle 和当前 pregnancy lifecycle archive。
2. 确认不新增 `child_id`，复用现有 `character_id`。
3. 在 lifecycle registry、schema、Coordinator owner 和 clear/invalidation 方案确认前不写入新字段。
4. 确认 delivery archive 是否已有 birth count/outcome；缺失时先补 canonical 契约，不用 AI 推断。

## 阶段 1：NPC profile 与出生状态

1. 设计并实现独立 Floor-owned NPC profile root。
2. 复用 Runtime identity allocator，保证未命名、改名、回退和 Swipe 隔离。
3. 实现 live/stillbirth/unknown 出生结局和明确出生人数约束。
4. 实现 birth Story Time 与年龄派生读取。

## 阶段 2：亲子关系与候选引用

1. 增加 child-target parent relationship fact。
2. 为每个孩子独立维护 father status。
3. 使用共享不可变 candidate source refs，避免永久复制完整候选名单。
4. 实现 child record readback → mother candidate cleanup → cleanup readback。
5. father confirmation 只能删除对应 child candidate refs，不能影响母亲 C002 或其它孩子。

## 阶段 3：历史与恢复验收

- Floor 20 怀孕、Floor 30 未命名出生、Floor 35 命名。
- 回退 Floor 25 不出现孩子；回退 Floor 32 不出现 Floor 35 的名字。
- active Swipe 切换不串读孩子。
- 单胎、双胞胎、人数未知、死产、父源未知和父源确认。
- 重复出生事实幂等，不重复建 NPC。
- stale Version、并发写入、archive 成功但 child persist 失败、child persist 成功但母亲 cleanup 失败。
- Projection/Tracking 不把 child profile 当作母亲 C002 的 Exposure 或 lock state。

## 实施前禁止事项

- 不把角色卡 ID 写入 NPC 身份。
- 不创建 `child_id`。
- 不根据姓名、性别、种族、父母资料或候选数量推断身份/出生事实。
- 不让 child persistence 阻止母亲 lifecycle release 或 C002。

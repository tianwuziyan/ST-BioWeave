# Pregnancy Child NPC & Genealogy

## 目标

为 BioWeave 建立“出生孩子作为 NPC”的独立 Floor-owned 业务链。孩子复用现有 `character_id`，不创建重复的 `child_id`，也不把 SillyTavern Character Card ID 当作 NPC 身份。

本任务只负责孩子 NPC profile、出生/命名生命周期、亲子关系和父方候选归属；母亲 pregnancy lifecycle、Exposure 删除、cycle lock release 和 C001→C002 由 `10-11-pregnancy-lifecycle-archive-release` 负责。

## 已批准边界

- `character_registry` 继续是轻量 canonical identity directory，仅保存稳定 `character_id`、姓名和别名。
- NPC profile、出生信息、亲子关系、父方候选和 pregnancy/cycle provenance 使用独立 Floor-owned business data。
- 不根据角色卡变化、姓名变化或父母资料重新生成孩子身份。
- 不根据预产期、Timing、Projection、候选数量推断出生。
- 父源未知不得阻止母亲 C002。
- miscarriage、termination、死产及未知出生结局不得默认创建存活 NPC。

## 核心验收

- 明确一名孩子创建一个稳定 `character_id`。
- 明确双胞胎创建两个不同 `character_id`，每个孩子独立 father status。
- 出生人数未知时不创建固定数量，保留可恢复待解析状态。
- 未命名孩子可存在，后续命名更新同一 ID。
- 出生日期复用 Story Time；年龄派生，不保存无法随剧情变化的固定年龄。
- child profile 和 parent relationship 在 Floor/Swipe/六字段 Version 下可读写、readback、回退和切换隔离。
- 母亲候选转移顺序为 child record readback → 母亲侧 candidate cleanup → cleanup readback。
- 父源确认后只删除对应 child 的候选名单，不删除 confirmed father fact 或其它孩子关系。

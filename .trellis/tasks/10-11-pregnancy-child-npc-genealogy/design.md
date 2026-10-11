# 技术设计：Pregnancy Child NPC & Genealogy

## 1. 身份与角色卡边界

复用现有 `core/identity.js` 的 `character_id` 和 `allocateSequentialCharacterId()`。AI 只提供出生事实和 response-local mention；Runtime 根据当前有效 Floor registry 确定性分配/复用 ID。

```text
明确出生事实
  → Runtime 验证 delivery archive 与 birth outcome
  → 分配/复用 character_id
  → 独立 Floor-owned NPC profile
  → child-target parent relationship
```

不新增 `child_id`，不使用角色卡 ID、姓名或别名作为身份键。

## 2. 建议的独立业务数据

具体字段需在实现前和 lifecycle registry 一起确认。逻辑上包括：

```text
npc_profile_timeline:
  profiles[]:
    character_id
    display_name|null
    aliases[]
    species|null
    sex_or_gender|null
    birth_story_time|null
    source_pregnancy_id|null
    source_cycle_id|null
    mother_character_id|null
    father_character_id|null
    father_status: unknown|confirmed|excluded
    birth_outcome: live|stillbirth|unknown|other
    created_at_floor_version
  parent_relationships[]:
    child_character_id
    parent_character_id|null
    relation: mother|father|other
    status: unknown|confirmed|excluded
    evidence_refs[]
    source_pregnancy_id
    source_cycle_id
  candidate_refs[]:
    child_character_id
    source_candidate_record_id
    shared_source_refs[]
    status: active|deleted
```

这是设计候选，不是本轮修改的 canonical schema。完整候选名单不应在每个孩子记录中永久复制；多个孩子可共享不可变来源 evidence refs，但每个孩子必须有独立关系状态。

## 3. 出生状态

- `live`：ST 明确出生且结果为存活，允许创建 NPC。
- `stillbirth`：保存出生结局事实，不创建存活 NPC，除非后续明确的 NPC 状态契约允许非存活人物实体。
- `unknown`：保存待解析出生事实，不创建固定数量的存活 NPC。
- 人数明确后，按出生 ordinal 和 source evidence 稳定绑定每个 child；人数未知时不得用默认 1 或 2。

## 4. 命名、成长与年龄

NPC 可以 `display_name: null` 存在。后续 ST 明确命名只能更新既有 `character_id`；多胞胎无法唯一绑定时 fail closed。

出生日期使用现有 Story Time。年龄由当前有效 Story Time 减出生 Story Time 派生；不得保存静态年龄作为长期事实。species、sex/gender 和其它生物字段只接受 ST 明确事实，未知保持 `null`。

## 5. 父源候选转移

```text
delivery archive validated
  → child identity/count uniquely bound
  → child profile + child-target candidate refs persist
  → readback verifies Floor/Swipe/version and source refs
  → remove mother-side active candidate record
  → readback verifies cleanup
```

母亲 C001 release 不等待这个流程。任何中途失败都保留母亲侧可恢复候选，不能产生两份长期 active list，也不能让候选依赖已删除 Exposure 重建。

父源确认必须绑定具体 `child_character_id`。确认一个孩子不会改变其它孩子；删除候选不删除 confirmed relationship fact。

## 6. Canonical fact binding

现有 `reproductive_source_attribution` 需要可靠 `cycle_id` binding，并需要 child-target fact/target 才能表达出生后多胞胎确认。Runtime 必须从 delivery archive、当前 Floor registry 和明确 source Event 确定 pregnancy/cycle/child IDs；AI 不得编造这些 IDs。无法唯一绑定时 fail closed，不删除候选。

## 7. Floor 历史与恢复

所有 profile、relationship、candidate-ref 写入必须经过现有 Floor Persistence Coordinator，并绑定 Character Floor、active Swipe、Chat 和六字段 Floor Version。回退、Swipe 切换或消息删除时，从目标 Floor 重建，不能读取未来 Floor 或全局 mutable registry。

幂等 key 至少包含 `(child_character_id, source_pregnancy_id, source_cycle_id, source_fact_id)`。profile creation、rename、candidate transfer、father confirmation 各自 readback；重复执行不能重复建人、误删其它孩子或提前清理母亲 C002 数据。

## 8. 出生事实来源稳定性

当前 lifecycle archive 能保存 delivery source Event IDs、source Floor/Swipe Version 和 provenance，但这些引用本身不保证原始 Event 后续不会被编辑或删除。子代任务不得把可变 Event ID/Version 引用当作不可变出生事实：必须优先消费 archive 中的稳定事实快照、payload digest 或等价不可变 evidence；若只有引用而没有可验证快照，child creation、出生人数/结局解析和候选转移必须 fail closed，不得从已删除 Exposure 重建。此要求属于子代任务的消费契约，本轮不扩张 lifecycle canonical schema。

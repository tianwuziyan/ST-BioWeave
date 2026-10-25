# 技术设计：移除正文哈希业务身份

## 1. 身份分层

统一提供只含四字段的 Floor owner helper：

```text
chat_id + message_id + floor + swipe_id
```

Core/Runtime/Storage/UI 不再各自维护六字段数组或局部 owner comparator。异步安全不靠正文
内容，而靠已有的 execution/run/request/generation/operation/transaction identity、Chat
epoch、subject/attempt identity 及 active owner existence。

## 2. Schema 与 legacy 兼容

- authoritative Floor/domain DTO 从 required/output schema 中移除 `content_hash` 和正文派生
  `message_version`；新写入不再产生这两个字段。
- normalizer 对旧对象采用 allow-extra 输入兼容：提取四字段 owner 和有效业务内容，忽略旧
  hash/version；不得因 extras 失败，也不得在下一次完整写入时继续复制 extras。
- Event source、created/source Floor owner、checkpoint owner 等统一改为四字段结构。
- `hashText()` 移到或保留在不暗示 Floor identity 的通用摘要位置；只允许明确的 semantic/
  source revision/prompt fingerprint 调用。

## 3. 调用点迁移规则

### 3.1 业务读取与完整集合写入

Event、World、Health、Projection、Tracking、Pregnancy、Participant、Storyline 和 Snapshot
读取均按当前 Chat 中 surviving、active Swipe、四字段 owner 合法的最近 Floor 完整集合。
修改/重新分析时：读取最近合法完整集合，按 domain key overlay，整体写入当前 Floor，历史
Floor 不变；显式空集合继续阻断继承。

### 3.2 异步与并发

- Event/World 分析：`analysis_execution_id`、`pipeline_run_id`、request identity + logical owner。
- Generation：`intent_id`、`generation_id`、Chat owner/epoch + logical owner。
- Projection/Storyline：`operation_id`、response/delivery ID、subject + branch/node/attempt +
  logical owner。
- Floor coordinator：transaction/operation owner + 当前 active logical owner + 写后完整 readback。

任何需要防止迟到结果的路径，若没有显式 token，先补最小 token；不得回退到正文哈希。

### 3.3 确定性业务 ID

Event、fact/pregnancy、Projection、observation、Snapshot、delivery/receipt 等 ID 使用稳定
业务输入（logical owner、subject、ordinal、semantic fingerprint、branch/node/attempt），
不得序列化整个 Floor object。正文编辑不改变同一事实身份，真正的不同业务对象仍独立。

### 3.4 UI 与 Debug

UI refresh、notification、edit target 和 activity completion 使用 logical owner 与显式 attempt/
operation ID。Debug 展示 logical owner、operation identity、读取来源 Floor、写入目标 Floor、
校验和结果；移除正文 hash/version 作为“版本”的描述。

## 4. 实施边界与旧实现清理

- 删除六字段常量、正文 `floorVersion()` hash 生成、基于 hash 的 comparator/key/fallback。
- 迁移全部调用方后删除局部 `sameFloorOwnerIdentity()` 和重复字段数组。
- 清理 AI prompt/schema、fixtures、Debug labels、文档中的六字段旧合同。
- 保留经分类证明与正文 Floor 身份无关的 observation/source/prompt/content fingerprint。
- 不新增第二套长期兼容 API；legacy 兼容仅位于输入 normalizer，不暴露为新业务合同。

## 5. 风险与控制

- **迟到结果覆盖**：先为每条旧 hash stale guard 标注替代 token，再删除旧判断。
- **旧数据无法读取**：fixtures 覆盖旧六字段对象；normalizer 忽略 extras 并输出四字段。
- **ID 碰撞**：确定性 ID 保留 subject/ordinal/semantic inputs，增加编辑前后稳定性和不同事实
  分离测试。
- **大范围回归**：按基础 owner → schema/ID → Runtime → Storage → UI/Debug → 文档分阶段，
  每阶段运行聚焦测试，最终跑完整检查。

## 6. 不变约束

- 事实仍由当前 Chat 中存在、active Swipe 的 Floor 拥有。
- 所有读写仍走现有 Floor storage abstraction。
- 最近合法 Floor 只向前读取；当前 Floor 写完整集合；回退读取历史状态。
- 删除 Floor、Swipe 切换/删除、Chat 切换和 Start New Chat lifecycle 语义不放宽。

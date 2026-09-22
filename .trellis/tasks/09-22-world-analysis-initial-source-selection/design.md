# 技术设计

## 1. 数据模型与 ownership

继续由当前 Chat 的 settings.worldbooks 拥有 source selection：

    worldbooks: {
      mode: 'selected_only',
      selected: [
        {source_id, entry_id, enabled: true},
        {source_id, field_key, enabled: true}
      ],
      selection_initialized: true
    }

selection_initialized 是 authoritative Chat-local configuration，不是 World Model 状态、Floor-derived state、Runtime cache 或 Character Card 字段。它随 Chat 保存、Chat 切换隔离，Character Card / World Info 原始数据不写入。

缺失字段由 schema normalization 读取为 false，但不应在普通读取时隐式保存；只有完成默认 selection 事务后才写入 true。mode 继续使用 selected_only。

## 2. 初始化状态机

    Chat source state
      ├─ selection_initialized === true
      │    └─ 直接加载 saved selected，不运行 policy
      └─ false / missing
           ├─ source catalog/content 未完整成功
           │    └─ 保留旧状态，不保存 initialized
           └─ character_card source discovery 完成，若存在则 entries 已成功 hydrate
                → 纯函数构造 default selected
                → owner/token 校验
                → 单次 Chat settings mutation/save
                ├─ confirmed → 内存/UI切换到 saved selected + initialized=true
                └─ failed/stale → 保留旧状态，不写半成品

初始化只在 ui/app.js 的 loadAnalysisSourcesState() 完成 source load 后触发。触发前只需确认当前 Character 的 `character_card` source discovery 已完成：存在 primary 时其 entries 必须成功 hydrate，不存在 primary 时视为已确认不存在。`character` additional Lorebooks、Global/Persona/Chat/other 保持 deferred，不阻塞初始化，也不属于默认范围。

source hydration 与 selection ownership 分离：每次 source collection 都会 eager hydrate `character_card`，即使它未被 selected；additional/global/other 仍按 generic deferred policy 处理。hydrated 只代表 UI 可读取 entries，不代表自动进入 AnalysisInput。

初始化完成后，任何 source refresh、World Model 状态变化、Full/Patch、Auto/Reuse、UI reopen、插件 reload 都只重新读取 Chat-local saved selection，不再调用 default policy。

## 3. Default selection policy

建议在 ai/worldbook.js 提供纯 selection policy helper，输入为 normalized sources 和当前 Chat source state，输出只包含 selection DTO，不负责保存、不调用 API、不修改 source。

规则顺序：

1. 保留 mode: selected_only。
2. 遍历 `worldbook_group === character_card` 的 Worldbook source。
3. 仅加入 entry 的 stable entry_id。
4. 对 entry metadata 执行默认排除匹配；命中则跳过。
5. 遍历 character_card source 的 fields 时只加入 is_current === true 的 opening field。
6. current greeting 不存在或多义时不加入任何 greeting，不 fallback 到 main。

不复用用户操作 handler 的副作用。selectAllSources()、setWorldbookEntriesSelection() 可以继续服务用户显式操作；如提取共享纯 helper，必须保持 handler 本身不承担首次初始化语义。

## 4. Normalized metadata contract

在 normalized entry 上增加 selection-policy 专用 metadata：

    {
      entry_id,
      label,
      content,
      token_estimate,
      available,
      metadata: {
        comment: string,
        keys: string[],
        secondary_keys: string[]
      }
    }

规范化规则：

- 独立 ST entry：comment ← comment；keys ← key；secondary_keys ← keysecondary。
- Character Book entry：comment ← comment；keys ← keys；secondary_keys ← secondary_keys。
- 兼容已有 DTO 输入时，可在归一化边界读取宿主 alias，但输出只保留上述统一字段。
- metadata.comment 只读取宿主 comment（或已确认的同名 metadata.comment 兼容输入）；不使用 label、title/name 作为排除匹配来源，避免把展示字段扩大为 policy metadata。
- 不把 metadata 拼进 content，不改变 entry_id、token estimate 或 Prompt body。
- metadata 只供 UI/debug/default-selection policy 使用；buildWorldbookInput() 继续显式投影必要字段，不能通过 spread 把 metadata 发送给模型。

## 5. 排除算法

默认 policy 常量为：状态、手机、NSFW、cot、玩法、超雄、思维链。

先对每个 metadata 字段执行 Unicode NFKC 规范化并 trim；中文关键词使用 includes() 直接包含匹配。

英文 token 使用大小写不敏感的 ASCII 单词边界匹配：关键词前后不得紧邻 ASCII 字母、数字或下划线。例如 CoT 规则、cot-规则、NSFW 内容命中；cotton、scotch 不因内部包含 cot 被命中。

匹配目标是 metadata.comment、metadata.keys[]、metadata.secondary_keys[] 的每个字符串。命中任意字段即排除。不得读取 content、uid/id、source_id 或整个 entry JSON。

这套规则避免英文 substring 误伤，同时保留中文词的直接包含语义。英文边界仅针对英文关键词；中文关键词不应用 ASCII word boundary 限制。

## 6. Current greeting

继续使用现有 detectCurrentCharacterGreetingField()：

    首条 Character message + active swipe_id
    → opening:main / opening:alternate:N
    → normalizeCharacterCardFields(...).is_current

default policy 只选择 field.is_current === true。如果首条消息缺失、角色名不匹配、swipe 不合法、alternate 无法对应或结果为空，则 greeting 不选；不猜测 opening:main。必要的 diagnostic 只能是内存/非阻断反馈，不进入 Chat selection 或 Prompt。

## 7. Source scope boundary

worldbook_group 是 default policy 的唯一来源范围依据：

- 默认允许：character_card；
- 默认拒绝：character、selected_global、chat、other 及未知 group。

`character` additional Lorebooks 仍由 source loader/UI/selection/input 链路保留，用户可手动勾选；这里只是首次默认 policy 不自动加入。

不能仅凭 label、book name、source id 或 entry 内容判断 Character ownership。现有 loadAnalysisSources() 的 runtime reference classification 继续负责 primary/additional Character Lorebook 的归类。

## 8. Async owner/stale guard

初始化复用现有 currentAnalysisChatToken()、assertAnalysisChatToken()、analysisSourceRequestSequence 和 Chat-aware save chain：

1. 捕获 Chat ID/token 和 request sequence。
2. source load 完成后检查 token、request sequence、当前 analysisSourcesState.chatId。
3. 在构造 default selection 后、保存前再次检查。
4. 保存 payload 从当前目标 Chat 读取并一次性写入 settings.worldbooks，包含 selected 与 initialized。
5. save 返回后再次检查 owner；只有 confirmed 且仍属于同一 Chat 才更新 UI/runtime state。

Chat A 的 stale result 必须直接丢弃，不得对 Chat B 计算或保存默认 selection。

## 9. Persistence failure

一次 saveChat mutation 同时写入：

    {
      ...currentWorldbookSettings,
      mode: 'selected_only',
      selected: defaultSelected,
      selection_initialized: true
    }

在 save confirmed 前，不把 initialized 标记发布为已完成。save 失败、stale、owner change 或 source content 不完整时，保留原 Chat payload、原内存 selection，并显示现有安全错误反馈。不得先单独保存 selected，再另行保存 initialized。

如果宿主 saveChat 的失败结果无法确认，按未确认处理，不标记 initialized；现有 Chat storage boundary 的 persistence outcome 语义优先。

## 10. Analysis DTO boundary

buildAnalysisInput() 继续从 selection 显式挑选 entry，并只投影 entry_id、label/name、content、token_estimate。metadata 不进入 World Model Prompt。默认排除 entry 不会出现在 input；用户手动重新选择后按现有路径正常进入 Full/Patch。不要在 Analyzer 或 Prompt 层再实现一次 policy。

## 11. Compatibility and lifecycle

- 旧 Chat 缺失 selection_initialized 视为未初始化，不做 migration guessing。
- 不建立 content/name/fuzzy identity 兼容层。
- 现有 ST 没有显式 id、按 Character Book index 产生 uid 的限制保持不变。
- 新增 source/entry 不触发持续 policy；initialized Chat 永远保持用户 selection，新增项默认未选。
- Chat-local settings 的 clear/lifecycle 文档需要登记新字段；清理 World Model 不应隐式清除 selection_initialized，因为 selection 是用户配置，不是 World Model 数据。

## 12. 风险与回滚

- 最大风险是 source deferred loading 造成 `character_card` 只看到 shell；loader 必须优先 hydrate 它，而 additional/global/other 不得因首次初始化被全量 eager 加载。
- 第二风险是 save 失败导致 UI 误显示 initialized；必须以 save confirmed 为唯一提交点。
- 第三风险是 metadata 扩展通过对象 spread 泄漏到 Prompt；用 input/prompt snapshot 测试锁定边界。
- 若实现验证失败，回滚范围只包含本 task 规划批准的 schema/source loader/app/tests/docs 文件，不修改 Character Card、World Info 原始数据或 Floor 事实。

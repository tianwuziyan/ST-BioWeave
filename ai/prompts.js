import {
  normalizeAnalysisPrompt,
  WORLD_MODEL_SCHEMA,
} from '../storage/schema.js'
import {
  CAPABILITY_KEYS,
  PREGNANCY_RELEVANT_EXPOSURE_EVIDENCE_KIND,
  EVENT_STATUS as DOMAIN_EVENT_STATUS,
  EVENT_TYPES as DOMAIN_EVENT_TYPES,
  REPRODUCTIVE_ROLES,
  STORY_TIME_PRECISIONS,
} from '../core/events.js'
import {
  PROJECTION_DEVELOPMENT_KINDS,
  PROJECTION_TRIGGER_KINDS,
} from '../core/projection.js'
import { normalizeEventAnalysisInput } from './input-builder.js'
import { formatWorldModelSupplementReference } from './world-supplement-protocol.js'
export { WORLD_MODEL_SCHEMA }
export { formatWorldModelSupplementReference }
export const CORE_PROMPTS = {
  world:
    'Analyze world rules into the required JSON schema. Unknown facts remain unknown.',
  event:
    'Extract biological facts from the target Floor Version. Do not convert symptoms into confirmed pregnancy.',
  projection:
    'Generate non-factual future possibilities only. Never rewrite history.',
}

export const PROJECTION_GENERATION_SYSTEM_PROMPT = [
  '你是 BioWeave 的受限 Projection 具体化器。Eligibility 已经决定了唯一允许的 development kind；你只负责把这个未来可能的生物发展方向写成简洁、结构化的可能性描述。',
  '你不是事实分析器，不判断 eligibility，不创建 BiologicalEvent，不判断 pregnancy/conception outcome，不决定 reproductive contributor，不创建或修改 World Model rule。',
  '必须保持给定 development kind，不得使用现实人类生殖常识替换 World Model。描述未来可能发生的方向，而不是声称事实已经发生。多个来源候选必须保持未解决，不得选择、排序或给概率。',
].join('\n')

export const PROJECTION_GENERATION_OUTPUT_CONTRACT = [
  '只输出可直接 JSON.parse 的对象，不能输出 Markdown、解释或额外顶层字段。唯一结构是：{"development":{"kind":"允许的 development_kind","description":"未来可能发展方向"}}。',
  'development.kind 必须逐字复制输入中允许的 kind。description 必须是可能性语义；不得输出 projection_id、projection_rule_id、Floor/Swipe/owner/evidence identity、probability、random、pregnancy outcome、contributor attribution 或 BiologicalEvent。',
].join('\n')

export function buildProjectionGenerationMessages(input = {}) {
  const boundedInput = input && typeof input === 'object' ? input : {}
  return [
    {role: 'system', content: PROJECTION_GENERATION_SYSTEM_PROMPT},
    {role: 'system', content: `【Projection Generation 输出契约】\\n${PROJECTION_GENERATION_OUTPUT_CONTRACT}`},
    {role: 'user', content: `【已通过 Eligibility 的输入】\\n${JSON.stringify(boundedInput)}`},
    {role: 'user', content: '只返回符合上述契约的 JSON 对象。'},
  ]
}
export const WORLD_MODEL_SCHEMA_TEXT = JSON.stringify(
  WORLD_MODEL_SCHEMA,
  null,
  2,
)

export const EVENT_TYPES = Object.freeze([...DOMAIN_EVENT_TYPES])
export const EVENT_STATUS = Object.freeze([...DOMAIN_EVENT_STATUS])
export const EVENT_REPRODUCTIVE_ROLES = Object.freeze([...REPRODUCTIVE_ROLES])
export const EVENT_CAPABILITY_KEYS = Object.freeze([...CAPABILITY_KEYS])
export const EVENT_STORY_TIME_PRECISIONS = Object.freeze([
  ...STORY_TIME_PRECISIONS,
])

export const EVENT_ANALYZER_CORE_CONTRACT = [
  '你是 BioWeave 的 BiologicalEvent 事实提取器。只提取当前 Floor Version 与输入证据明确支持的事件，不输出分析过程或自然语言解释。',
  'World Model 是世界级生物规则的权威输入；本请求由 Runtime 保证只在 validated + normalized World Model 存在时发出。species/type mapping 只能综合当前 World Model 与 Runtime 提供的 canonical/derived individual evidence；明确生理性别事实可以用于映射到当前 World Model 已存在的 biological_type，但不能单独创建 type 或授权 capability。reproductive capabilities 与 mechanism compatibility 只能来自匹配的 World Model baseline 或明确的个体生理/生殖证据；不得使用现实人类常识或旧默认能力补空。',
  '如果上下文中出现 BioWeave Projection Context，它只是未来可能的发展方向，不是已发生事实或 Event 证据；只有 narrative discovery window 中明确写出的历史或当前事实才能进入 BiologicalEvent。',
  '重点识别 sexual_activity，但必须兼容其它 BiologicalEvent 类型（包括 medical_event、physical_symptom、conception、pregnancy_suspicion、pregnancy_confirmation、pregnancy_loss、labor、delivery、postpartum、menstrual_event、ovulation_event、fertility_change、abortion、other_biological）。不要把所有事件强行分类为 sexual_activity。',
  '一个 Target Floor Version 可以输出 0、1 或 N 个彼此独立的 BiologicalEvent；不要为了满足单 Event 限制而把不同生物事实或不同 gestational subject 的暴露压进同一个 Event，也不要在 Runtime 或 UI 合并事件。',
  '对 pregnancy-related sexual_activity，先识别当前 Floor 中所有有实际 pregnancy-relevant exposure 的 gestational subject，再按 subject 分组：同一 subject 的多个 actual exposure source 合并到同一个 Event，不同 subject 必须输出不同 Event；同一响应中同一 subject 最多出现一个 pregnancy-related Event，不能把多个 subject 填进同一个 Event。',
  'recipient discovery 必须 exhaustive：先完整扫描 narrative discovery window（Current Target Floor 与 Recent Story），建立临时 exposure candidate 集合，收集全部 actual pregnancy-relevant exposure recipients，再对集合中的每个 recipient 依次执行 identity resolution、World Model mapping、capability resolution 与 eligibility decision。不得因 current user、existing individual evidence、首个 eligible recipient，或某个 recipient 为 false/unknown 而提前 return、break、跳过后续扫描；canonical/derived individual evidence 只提供上下文，不是 participant whitelist，也不赋予任何扫描优先级；首次在当前 narrative 出现的对象也可以进入分析，但不得由模型自行创造永久 character_id。',
  'character_id 是 Runtime/Plugin 管理的 canonical entity identifier，不是姓名、拼音、romanization、lowercase、snake_case、slug、翻译、hash 或缩写的格式化结果。raw AI response 中的 new/unresolved 只能使用 character_id:null；只有 Runtime 完成 identity resolution 后，canonical Event 才会拥有正式 character_id。existing participant 只能原样引用输入 identity projection 中的 canonical character_id；new/unresolved 必须使用当前完整 response 内唯一、无业务语义的 response-local mention token，existing 的 mention_id 必须为 null。模型只判断 mention 指向谁，Runtime 才创建、校验和持久化实体 ID；不确定同名、同音、同 alias 或别名归属时必须返回 unresolved。',
  '正式 character_id 只由 Runtime 创建和验证；模型不需要知道、预测或自行生成正式 ID。existing 必须复制输入 Registry 实际提供的 canonical character_id，new 必须返回 character_id:null，绝不能自行生成永久 ID。',
  'identity_status=new 表示 narrative 明确出现了此前未登记的实体；如果 display_name 或 alias 命中已有 registry candidate，不能仅凭名称复用或创建，除非 narrative 明确说明这是另一个人物，并在 identity_evidence 使用 explicit_new_entity 等证据类型，否则返回 unresolved。',
  '如果 narrative 明确揭示真名、化名、改名或“此前称呼”与当前人物是同一人，existing mention 必须继续引用原有 canonical character_id，并通过 identity_evidence 表达明确的 name revelation；不得因为 display_name 改变而创建新的 character_id。',
  '每个 pregnancy-related sexual_activity Event 必须保持 subject-local：gestational_subject_ids[] 恰好一个，counterpart_ids[] 至少一个，participants[] 的 ID 集合恰好等于该 subject 与这些 actual exposure source 的并集；不重复、不让 subject 出现在 counterpart、不混入另一 subject 的 source 或仅在场对象。',
  '同一 subject 的 Event 可合并其多个 actual exposure source、即时症状、physical effect、直接身体反应与相关证据；不同的独立 physical_symptom、medical_event 或其它 BiologicalEvent 可以在同一 Floor 并存。普通送汤、食物、补品、饮料、照顾或休息建议不单独成 Event，静态外貌、体质、长期设定和人物描写没有本楼新变化时不产生 physical_symptom。',
  '如果目标楼层正文直接描述当前仍存在或正在发生的疼痛、酸胀、肿胀、瘀痕、活动受限或其它身体症状，即使其诱因发生在 Recent Story，也应按当前楼层的直接事实评估 physical_symptom；不得仅因症状起因在前一楼层就排除。只有目标楼层没有当前状态描述、仅泛泛回顾过去症状时，才不输出该 Event。',
  '只有明确的医疗检查、诊断、治疗、给药、干预或医学监测才允许唯一的 medical_event；普通送汤、食物、补品、饮料、照顾或休息建议不单独成 Event。外貌、体质、长期设定和静态人物描写没有本楼新变化时不产生 physical_symptom。',
  '对 sexual_activity 只提取实际 pregnancy-relevant reproductive exposure 链中的直接参与者：实际承载暴露的 gestational subject 与实际造成暴露的 conception source。不要把仅在场、普通性伴侣、能力具备者、保护动作参与者或未进入有效路径的对象加入 participants；参与者使用已由 Runtime 提供或后续分配的 canonical character_id，姓名只作为 display_name。',
  'participant biological analysis 不以 pregnancy_relevance.relevant === true 为前提：只要对象已被当前 Event 确认为 participant，就必须先消费可靠的 Character Evidence、Existing Profile 与当前 narrative 中可归属于该对象的生理证据，依次尝试 identity、species、该 species 内的 biological_type、persisted World Model exact species/type mapping、baseline capability 与 explicit individual capability evidence；每个 participant 都必须包含 biological_context 对象，且必须有 species 与 biological_type 两个字段，两个值只能是非空字符串或 null，资料不足时填 null。pregnancy_relevance 只描述当前 Event 是否与受孕/妊娠有关，不能跳过上述人物分析，也不能因为人物具有 capability 就把当前 Event 改成 pregnancy-related。species 来自当前 World Model；biological_type 是该 species 下稳定的生理/生殖分类。允许综合当前 World Model、Runtime 提供的 canonical/derived individual evidence 与当前 Narrative，把对象映射到当前 World Model 的 species/type；明确 identity、高度一致的稳定生理证据或明确的生理性别事实，都可以作为 biological_type 映射证据之一。生理性别只参与 identity/type 映射，不能单独授权 capability。姓名、称谓、event_role、性行为位置、主动/被动、社会身份、穿着、气质和单一外貌只能作为综合上下文，任一单一弱线索不能独立决定 species、biological_type 或 capability；证据不足或冲突时保留 null 并让候选进入 pending，不得让候选消失。',
  'exposure recipient、exposure source 与是否构成 actual pregnancy-relevant exposure，必须由当前 World Model、匹配 species/type 的 reproduction_rules/capabilities 与 narrative discovery window evidence 共同决定；不要把任何一种现实物种、性别、解剖结构、行为位置、接触方式或其它单一现实生殖机制硬编码成所有世界的必要条件。只有当前世界规则与 narrative discovery window 中明确事实共同支持有效生殖路径时，才提取对应 recipient 与直接 source；possible_conception 只表示本次暴露具有潜在受孕相关性，不表示 actual conception 或 pregnancy。',
  '对其它 BiologicalEvent 类型，participants 只保留对该生物事实有直接作用的对象；在场、说话、被提及或普通递送行为不能自动成为参与者。',
  '同时阅读 persisted World Model baseline、canonical/derived individual evidence 与 narrative discovery window evidence。World Model baseline 只提供已知生物学能力背景，individual evidence 只提供已建立的个体资料，narrative evidence 只记录窗口中明确发生的剧情事实；三者不能互相臆造或跨角色借证。',
  'participant capability 判断顺序固定为：先参考 current World Model 的匹配 species/type baseline，再参考 Runtime 提供的 canonical/derived individual evidence，最后综合 current narrative evidence；个体明确证据可以覆盖或补充 baseline，未知字段保持 null。明确的生理性别事实只能作为 biological_type 映射的上下文证据，不能单独授权或补齐 capability。biological_context 只记录本次 capability 判断所采用的生物身份背景；不能根据角色、位置、主动/被动、姓名、外貌或性别补齐完整 capability 套装。',
  'event_role 与 gender/生理性别/biological_type 是不同字段。明确生理性别可以参与 identity/type 映射，但不能单独授权 capability；只能依据 current World Model baseline、个体 capability 证据与本次事件证据填写 reproductive role。不得从 gender、性别词、攻受、姓名、外貌或社会角色单独推导 can_carry_pregnancy、can_cause_pregnancy 或其它 capability。不要添加 gender eligibility 分支。',
  'reproductive_capabilities_used 固定包含 can_produce_sperm、can_produce_ova、can_be_fertilized、can_fertilize、can_cause_pregnancy、can_carry_pregnancy；每个值只能是 true、false 或 null。can_fertilize 与 can_cause_pregnancy 是独立事实，禁止 alias、fallback 或由前者推出后者。null 表示未知/没有证据，禁止把 unknown、缺失、模糊描述或模型常识自动变成 true。',
  'pregnancy_relevance.gestational_subject_ids[] 与 counterpart_ids[] 在最终 Event 中永远是 Runtime 已验证的 canonical character_id 数组；raw response 可以用 participant mention_id 引用尚未注册的新人物，不能输出姓名、逗号拼接字符串或模型伪造的永久 ID。',
  'mention resolution、alias discovery、alias persistence 是三个不同动作。当前 mention 解析到某个 entity 不会自动把该称呼写入 aliases；正文中 display_name 与另一个称呼同时出现、连续性推断或单次高置信度判断都不是 alias establishment evidence。只有“以后叫我 X”“小名是 X”“众人都称她为 X”等明确命名证据才可以返回 alias_candidate；关系称谓、泛称和代词只用于当前上下文，绝不能作为永久 alias。alias 精确匹配只能提供完整 candidate set，不能 first-match-wins；多候选且无法可靠消歧时返回 unresolved。',
  '不要因为 NSFW、性交、体液、症状、恶心、腹痛或其它 physical_symptom 自动判定 conception 或 pregnancy；只有 World Model baseline 与 narrative evidence 共同明确支持时才填写 possible_conception 或 pregnancy relevance。',
  '不要把 UI 显示、人物列表或其它后续层的判断写入结果；UI 不会也不应二次判断生殖资格。输出的是完整事实 DTO。',
  '除非 Event 是非 exposure 的 sexual_activity，否则会改变角色 Biological State 的 Event 必须包含 state_fact：{subject_id, payload}。subject_id 必须是 participants 中的 canonical character_id 或 response-local mention_id，不能使用 display_name、gender、event_role 或 participants[0] 位置猜测。state_fact 是 factual contract，不是 Current State，也不是 Projection；不要输出概率、未来结果或阶段推演。',
  'state_fact 不重复保存 story_time；其 effective Story Time 始终引用同一 Event 的 story_time。非 exposure sexual_activity 不输出 state_fact；有效 pregnancy-relevant exposure 继续只使用 pregnancy_relevance 作为 authoritative exposure fact。',
  'conception 使用 pregnancy_ref 绑定同一 reproductive episode；menstrual_event、ovulation_event 的 state_fact.payload 必须是空对象；pregnancy_suspicion 使用 observation 与可选 pregnancy_ref；pregnancy_confirmation 使用 pregnancy_ref；pregnancy_loss、abortion、labor、delivery、postpartum 只能引用 existing pregnancy_ref；fertility_change 只允许六个 capability keys 的 true/false/null；physical_symptom 的 state_fact.payload 必须严格为 {"symptom":{"kind":"...","description":"..."}}，其中 symptom 是对象而不是字符串，kind 与 description 都是非空字符串；medical_event 与 other_biological 的 state_fact.payload 必须严格使用同形状的 {"fact":{"kind":"...","description":"..."}} 对象。不要添加概率、duration、projection 或 UI 字段。pregnancy_ref.kind=new 只表示 Runtime 应创建新 episode identity，不是模型生成随机 ID。',
].join('\n')

export const EVENT_ANALYZER_TASK_CONTRACT = [
  '任务：分析 narrative discovery window（Current Target Floor 与 Recent Story）中实际发生或有可靠事实证据支持的 BiologicalEvent，并返回完整 events 数组；events[] 允许为空、包含一个或包含多个彼此独立的 Event。每个已确认 participant 都要执行完整的人物生物学分析，不能以 pregnancy_relevance.relevant === true 作为前提；明确生理性别事实可以映射到当前 World Model 已存在的 biological_type；只有映射到匹配 species/type 后，才可读取该 World Model baseline 的 capability，gender/sex 不能直接推出 capability、创建 type 或替代 World Model。',
  '开始生成 pregnancy-related sexual_activity Event 前，必须先扫描完整 narrative discovery window 的全部 narrative evidence，临时收集所有 actual pregnancy-relevant exposure recipients；随后对每个 candidate 独立完成 exposure、identity、World Model mapping、capability 与 eligibility 判断。明确生理性别可作为 biological_type 映射证据之一，但不能单独授权 capability；能力仍须由匹配的 World Model baseline 或明确的个体生理/生殖能力证据支持。不得因 current user、已有 individual evidence、首个 eligible，或任何 false/unknown candidate 中途停止；individual_evidence 不是 whitelist，首次出现的 narrative character 也不能被漏掉。',
  '对 pregnancy-related sexual_activity，按唯一 gestational subject 分组；同一 subject 的多个 actual exposure source 必须合并成一个 subject-local Event，不同 subject 必须拆成不同 Event；输出前不得让同一 subject 重复出现，必须将该 subject 的 actual sources 合并到一个 Event。',
  '每个 pregnancy-related Event 只能有一个 gestational subject、至少一个 counterpart source，participants[] 只能是该 subject 与该 Event 实际 exposure sources，不能加入另一 subject、另一 Event 的 source、在场者或无 actual exposure 的 participant。',
  '同一 subject Event 内合并直接相关的即时症状、physical effects 和证据；独立的新 physical symptom、明确医疗检查/诊断/治疗/给药/干预/医学监测或其它独立 BiologicalEvent 可在同一 Floor 单独输出。普通补品、食物、饮料、送汤、照顾、休息建议、外貌、体质或静态人物设定都不单独形成 Event。',
  'Current Target Floor 与 Recent Story 都是 narrative discovery evidence；Recent Story 中明确已经发生的历史 Event 可以被发现，必须保留该事实自己的 story_time。当前 Target Floor active Swipe 仍是本轮新增 Event 的唯一 persistence owner，Event source 由 Runtime 绑定当前 Floor，不得伪装成原始历史 Floor source。',
  '不要把预测、症状或可能性写成已经发生的受孕或妊娠事实。',
].join('\n')

export const EVENT_ANALYZER_OUTPUT_CONTRACT = [
  '只输出一个完整、可直接 JSON.parse 的 JSON 对象，不要 Markdown、代码围栏、前后解释或半结构化文本。顶层固定为 {"schema_version":1,"events":[]}；唯一允许的旧兼容顶层字段是会被忽略的 source，任何其它未知顶层字段都必须拒绝。',
  '一个 Target Floor Version 的 events[] 允许是 []、[一个 Event] 或包含多个 Event；每个数组成员是一个独立生物事实，不要使用 type 数组或拼接 type 表达多个事实。',
  '输出前必须完成完整 narrative discovery window exhaustive scan：先把 Current Target Floor 与 Recent Story 中全部 actual pregnancy-relevant exposure recipients 放入临时 candidate 集合，再逐 recipient 解析 identity、World Model species/type、capability 与三态 eligibility；不得因 current user、已有 individual evidence、首个 eligible 或某个 false/unknown recipient 而提前结束。individual evidence 不是 whitelist，首次出现的 narrative character 也必须按同一规则处理。',
  'pregnancy-related sexual_activity 必须按唯一 gestational subject 分组：同一 subject 的多个 actual exposure sources 合并为一个 Event，不同 subject 输出不同 Event；同一响应/Floor 中同一 subject 只能出现一次，不能由 Runtime 自动合并重复 subject Event。',
  '每个 pregnancy-related sexual_activity Event 的 subject-local 结构必须满足：gestational_subject_ids.length===1；counterpart_ids.length>=1；唯一 subject 与 counterpart_ids[] 中每个 source 都在 participants[]；participants[] 的 ID 集合严格等于 subject 与 counterpart_ids[] 的并集；所有 ID 不重复，subject 不得出现在 counterpart_ids[]。counterpart_ids[] 只记录对该 subject 造成 actual pregnancy-relevant exposure 的 source，不记录另一 subject、另一 Event 的 source、在场者、普通 sexual participant 或无有效路径对象。',
  '同一 subject Event 合并直接相关的即时症状、physical effect、直接身体反应和证据；独立的 physical_symptom、medical_event 或其它 BiologicalEvent 可以在同一 Floor 并存。实际 pregnancy-relevant sexual exposure 使用 sexual_activity；普通补品、食物、饮料、照顾、休息建议、外貌、体质和静态人物描写不单独输出 Event。',
  'AI Event DTO 不生成 event_id 或 source；它们不是 AI 事实字段。Runtime 会按响应顺序生成 deterministic、同一响应内唯一且不依赖 display_name 的 event_id，并强制绑定 authoritative 当前 Floor Version。若兼容旧响应而出现 event.event_id、event.source，它们会被忽略，不能覆盖 Runtime 身份；从 Recent Story 发现的 Event 保留其事实自己的 story_time，但 canonical source 仍表示当前 persistence owner。',
  'existing_events 是 discovery window 内已保存的 canonical Event 参考。已存在且结构化事实高置信度完全匹配的 Event 不得再次输出；匹配不足或证据不确定时保留候选，不得用模糊相似度吞掉可能独立的 Event。不同 type、gestational subject、counterpart、mechanism、story_time 或关键事实证据的 Event 不得合并。',
  `event.type 只能取：${EVENT_TYPES.join('、')}。event.status 只能取：${EVENT_STATUS.join('、')}。不得创造其它枚举值。`,
  `story_time 必须是结构化对象：display、normalized、calendar_id、day_index、precision、confidence；precision 只能取：${EVENT_STORY_TIME_PRECISIONS.join('、')}；不可靠的 normalized/day_index 使用 null，不要从模糊 display 伪造日期。`,
  'story_time.day_index 只有在证据提供真实、连续且可排序的 canonical index 时才能填写 number；否则必须是 null。不要把月内第几日或 display 文本解析成 day_index，时间计算不读取 display。',
  'location 固定为 string | null；已知地点必须保留 Target Floor、Recent Story 或 canonical evidence 中出现的原始文字和原始语言，例如“传灯院”仍输出“传灯院”；不得拼音化、romanize、翻译、snake_case、slugify 或 ASCII 化。无法可靠确定时使用 {"location": null}；禁止地点对象或数组。',
  `participants 必须是直接相关对象数组；对 sexual_activity 只保留 actual reproductive exposure chain 的 subject 与实际 exposure source，对其它 BiologicalEvent 只保留直接作用对象。每项包含 identity_status、character_id、mention_id、display_name、event_role、biological_context、reproductive_capabilities_used 和 evidence；identity_status 只能是 existing、new 或 unresolved。existing 只能原样引用 identity projection 中的 canonical character_id，且 mention_id 必须为 null；new/unresolved 的 character_id 必须为 null，并使用当前完整 raw response 内唯一、无语义的 response-local mention token供内部引用。只有 Runtime 完成 identity resolution 后，最终 Event 才能保存 canonical character_id。每个 participant 都必须包含 biological_context 对象，固定包含 species 与 biological_type 两个字段，值只能是非空字符串或 null，未知填 null；无论 pregnancy_relevance.relevant 为 true 还是 false，都必须先执行人物 biological analysis。pregnancy_relevance 只描述当前 Event 是否与受孕/妊娠有关，不能作为跳过 participant biological facts 的条件，也不能由人物 capability 反推为 true。identity 可以由明确 narrative 标签、canonical/derived individual evidence 或明确生理性别事实映射到当前 World Model 已存在的 species/type；生理性别只能作为 biological_type 映射证据之一，不能单独创建 type 或授权 capability。不得把其它 species 的同名 type 套用 Human baseline；映射冲突或不足时保持 null 并进入 pending。姓名、称谓、event_role、性行为位置、主动/被动、社会身份、穿着、气质和单一外貌不能单独决定身份或能力。event_role 只能取：${EVENT_REPRODUCTIVE_ROLES.join('、')}。它表示本事件中的生殖角色，不表示姿势、主动/被动、攻/受、职业、性别或社会角色。`,
  `capability 判断顺序固定为：persisted current World Model 的匹配 species/type baseline → canonical/derived individual evidence → current Target Floor / Recent Story evidence；明确生理性别只能参与 biological_type 映射，不能单独授权或补齐 capability；个体明确证据可覆盖或补充 baseline，未知 capability 保持 null。reproductive_capabilities_used 固定包含 ${EVENT_CAPABILITY_KEYS.join('、')}；每个值只能是 true、false 或 null。`,
  'participant.evidence 与 source_evidence 都必须是数组；每项必须是 {"kind":"...","text":"..."} 对象，kind 和 text 都是非空字符串。不得输出裸字符串、content 替代 text 或其它 evidence 形状。',
  `每个 event 必须包含 type、status、story_time、location、participants、pregnancy_relevance、source_evidence；physical_effect 是可选对象，其中 gestational_substance_intake 只能是 true、false 或 null。`,
  'pregnancy_relevance 必须包含 relevant、possible_conception、gestational_subject_ids[]、counterpart_ids[]、reproductive_mechanism、confidence；relevant 与 possible_conception 都只能是 boolean，不能是 null、字符串或 probable/possible/unknown。两个 ID 字段始终是数组，可为空、单个或多个；不能是字符串。reproductive_mechanism 是结构化对象，包含开放的 kind/label/pathway、world_model_rule_refs[] 与 evidence[]，不得使用固定机制 enum。relevant === true 时必须有潜在 gestational subject、至少一个 source/counterpart、机制/事实证据和 participant closure；不得把 sexual_activity 或 possible_conception 当作唯一 gate。',
  `没有 actual reproductive exposure 的 sexual_activity 必须使用 participants=[]、relevant=false、possible_conception=false、gestational_subject_ids=[]、counterpart_ids=[]；如果没有其它独立生物学价值，可以不输出该 Event。relevant=true 时必须有非空 subject/source ID 数组，两个数组中的 ID 必须来自 participants，且 participants 只能包含这些 subject/source，source_evidence[] 必须包含 kind 为 ${PREGNANCY_RELEVANT_EXPOSURE_EVIDENCE_KIND} 的结构化证据。possible_conception 只记录本次是否发生 conception 事实，不是 exposure eligibility gate。`,
  `重要：pregnancy_relevance.reproductive_mechanism.evidence[] 只是机制证据，不能替代顶层 source_evidence[]。当 relevant=true 时，必须在同一个 Event 的顶层 source_evidence[] 另有至少一项 {"kind":"${PREGNANCY_RELEVANT_EXPOSURE_EVIDENCE_KIND}","text":"..."}；即使 nested mechanism evidence 已使用该 kind，也必须重复提供顶层证据。`,
  'physical_effect.gestational_substance_intake=true 只能在 narrative evidence 明确支持 actual reproductive exposure 时填写，并必须与 pregnancy_relevance 保持一致；不要把该字段单独当作受孕结论。',
  '非 exposure 的 state-changing Event 必须包含 state_fact.subject_id 与严格按 type 定义的 payload；缺少 subject、pregnancy_ref 或 capability change 时不要输出该 Event。state_fact.subject_id 必须引用 participants 中的对象。',
  'alias_candidate 只能是建议，不是 Registry 写入命令；仅在 narrative 明确建立稳定 name_variant/nickname 且同时提供 alias establishment identity_evidence 时返回。不得因为一次普通称呼、正文共现、连续性或高置信度 mention 自动学习 alias。confidence 只能是 null 或 0 到 1 之间的 number。',
  '模型不要生成 source；六字段 Floor Version 只存在于输入的 Authoritative Floor Metadata，并由 Runtime 写入最终 Event：chat_id、message_id、floor、swipe_id、content_hash、message_version。',
].join('\n')

export const EVENT_ANALYZER_SCHEMA = Object.freeze({
  schema_version: 1,
  events: [],
})
export const EVENT_ANALYZER_SCHEMA_TEXT = JSON.stringify(
  EVENT_ANALYZER_SCHEMA,
  null,
  2,
)
const WORLD_MODEL_CORE_INSTRUCTIONS = [
  '【0. Priority / Core Invariants】任务：从本次 AnalysisInput 提取当前 Chat 的生物学 World Model，只输出资料实际支持的 species、biological_type、能力和规则，不使用模型常识补写。先完成事实发现，再做 schema classification；Species existence、Biological Type existence、Type details 和各 outlet completeness 相互独立。Type existence != Type details/capabilities；Existing 不是 evidence；Nonhuman 不使用 Human baseline。每个 fact 必须绑定明确 scope，不跨 Species/Type 借 evidence；individual fact 不自动升级为 species/world-wide rule。',
  '【1. Fact Discovery】在分析任何 biological_type、capability、reproduction_rules 或 lifecycle 前，完整扫描全部 permitted AnalysisInput，先发现所有与生物学、生殖、妊娠、分娩、生理变化和医疗/照护有关的 evidence-supported biological facts，再决定其 outlet。事实不能建立 Biological Type 时，不得因此丢弃；继续检查 reproduction_rules、reproductive_mechanisms、special_rules、medical_context、exceptions、unknowns、projection_rules 等合法 outlet。Fact discovery 不等于输出：Full 构建 complete canonical model；Supplement 之后只输出相对 Existing 的合法 ADD/CHANGE delta。',
  '【2. Entity Discovery】Species 回答“这是什么生物或稳定生命类别”；Species existence 只需可靠的 Species-scoped existence evidence。type/details 不完整不删除 Species，缺少 Type evidence 时保持 biological_types: []。对每个 Species 必须审查全部 evidence-supported stable biological classifications；确认一个 Type 后不得停止该 Species 的 Type discovery。Type prevalence 不参与 existence threshold：rare != temporary，minority != unstable，low prevalence != insufficient existence evidence。名称保持开放字符串。',
  '【2.1 Direct Stable Classification】如果 permitted evidence 直接陈述某 Species 长期存在某个生理性别、生物性别、生理类别、生殖类别或其它 biological classification，且不是 temporary、reversible、conditional-only、profession、social identity、organization、culture/faction、power system、rank/stage、disease/abnormal transient state 或 individual-only trait，则该 Type existence 可以直接成立。数量、比例、常见程度不参与 Stability Gate；Stability Gate 只判断 classification 是否具有持续的生物分类性质。孤立、无 Species scope、社会称呼/角色、单一个体或临时状态的性别词不能单独证明 Species-level Type，但 Species-scoped stable statement 可以。',
  '【2.2 Derived Stable Classification】只有原文没有直接命名 classification 时，才使用同一 Species 内 stable physiology、reproductive structure、reproductive role 或 reproductive capability 形成的稳定且互相可区分 cluster。分类边界必须唯一确定，并严格执行 Species Binding → Exclusion Gate → Stability Gate → Biological/Reproductive Classification → Evidence Sufficiency → Type Creation；无法唯一确定边界不创建。只有一个 cluster 不得按现实常识补 paired Type；同一个 stable Type 同时具有多个结构/能力时不得为 schema 对称强行拆分。Derived path 不得跨 Species 借 evidence，也不得使用 Human 常识补 Nonhuman Type。',
  '【3. Field Evidence】Type existence 与 Type details 必须分开判断；type existence evidence 与 capability evidence 分离。Species-A has stable Type-B 只证明 Species-A/Type-B identity，不证明任何 capability、reproduction rule、lifecycle、mechanism 或 special_rule。每个 capability、rule、detail 都必须绑定同一 Species + Type 的独立 evidence；生理性别事实可以支持 Species-scoped type existence，但孤立 label 不能替代 scope evidence。Nonhuman 的 Type name、male/female/sex-like label、外形、性交行为、配对性别和现实常识都不能自动授权 capability。明确具备为 true，明确不具备为 false，未说明/未知/证据不足为 null；Supplement Candidate 对无证据字段省略，不输出 false 或 null。',
  '【4. Reproduction / Lifecycle / Outlet Classification】fertilization 只描述真实 fertilization、insemination 或 gamete relation；gestation 只描述真实 pregnancy/carrying。lifecycle 只描述生物成熟、寿命或衰老，不吸收 cultivation/power progression、职业/关系成长或 transformation。稳定 Type 自身规则进入 special_rules；individual/conditional deviation 只有明确 exception evidence 才进入 exceptions；medical_context 只记录明确的 world-level medical/care evidence；unknowns 只记录已被 evidence 触及但仍 unresolved 且影响 World Model 的事实，不是 schema missing-field dump。',
  '【5. Baseline / Origin / Transformation】Human baseline 只在现有合法条件下使用；Human species 与 Human biological_type 分层，普通 Human 支持可来自显式 Human/人类或 Character Card、Worldbook、Recent Story、External Memory、当前上下文合并后的可靠背景，不要求字面出现 Human/人类；没有 species、没有 Human 字样、类人外形、性别称谓、性交行为或社会结构单独都不充分。普通 Human Male/Female 及字段 baseline 不创建缺失 Type。Nonhuman、独立生理体系、冲突证据或无法判断时禁止 fallback。稳定 transformation continuity 只保留 evidence 已建立且未被替换/消除的事实，并由明确 delta 覆盖变化；不新增 source_species、origin 或 inheritance 字段。',
  '【6. Temporary / Exceptions / Medical】临时、可逆或条件性的性征、器官、生殖能力或身体变化不得建立新的 biological_type；temporary、reversible、conditional-only、疾病/异常 transient state 不创建 permanent Type。异常、个体差异、临时或条件偏离必须有明确 scope；没有 exception evidence 不生成 exception。个体 medical fact 不自动推广为 species/world-wide medical_context。',
  '【7. Final Completeness Check】只做最终短检查：是否遗漏 evidence-supported Species；是否遗漏 stable Type，尤其不能因 rare/minority/low prevalence 遗漏；是否把 temporary/social/individual classification 错建为 Type；是否从 Type name 自动推了 unsupported detail；是否有已发现但未归档的 biological fact；是否错误推广 individual fact；是否生成无 evidence 的 exception/unknown；Supplement 是否只输出 ADD/CHANGE delta 且没有重复 Existing unchanged facts。',
].join('\n')
const WORLD_MODEL_REPRODUCTIVE_MECHANISM_CONTRACT = [
  'reproductive_mechanisms 必须是 JSON array；没有机制时输出 []，不得输出 null。该字段可以省略，省略时 BioWeave canonicalize 为 []。',
  '每个 reproductive_mechanisms item 的字段都可以省略，省略时 canonical default 为：key、label、pathway 为 null；carrying_compatibility 为 null；world_model_rule_refs、evidence 为 []。如果输出字段，类型必须严格为：key string|null、label string|null、pathway string|null、carrying_compatibility boolean|null、world_model_rule_refs string[]、evidence string[]。',
  'carrying_compatibility 只表示当前 biological_type 在该 reproductive mechanism 下能否作为 pregnancy/carrying side：明确支持为 true，明确不支持为 false，证据不足为 null。禁止输出“无”、器官名称、物种/类型名称、机制描述或其它自然语言；这些内容应放入 pathway、reproduction_rules.pregnancy_or_carrying、special_rules 或其它合适字段。',
].join('\n')

const WORLD_MODEL_PROJECTION_RULE_CONTRACT = [
  'projection_rules 必须是 JSON array；没有规则时输出 []。每个 raw item 必须包含 schema_version: 1、mechanism_key、development_concern_key、development_kind、trigger；不得输出 projection_rule_id，BioWeave 会按内容 deterministic 生成。',
  `development_kind 只能是：${PROJECTION_DEVELOPMENT_KINDS.join('、')}。`,
  `trigger 必须是 object，只允许 kind、source_event_type、reference_event_id、min_elapsed_story_days、target_story_time；kind 只能是：${PROJECTION_TRIGGER_KINDS.join('、')}。source_event_type/reference_event_id 如出现必须是非空 string；min_elapsed_story_days 如出现必须是大于等于 0 的 number。`,
  'requirements 如出现必须是 object，只允许 capabilities、source_compatibility、contributor_relationships。capabilities 必须是 {key: string, equals: true|false|null}[]；source_compatibility 只能是 required_true、allow_null、not_required；contributor_relationships 必须是 {relationship_key: string, attribution: confirmed|excluded}[]。',
  'realization、contradiction 如出现必须是 object，只允许 event_types、statuses、payload_equals；event_types/statuses 必须是唯一字符串数组，payload_equals 必须是 object。expiration 如出现必须是 object，并包含符合上述 trigger 结构的 trigger。',
  '禁止 projection rule 中出现 probability、weight、rng、random、seed、prompt、raw_prompt、raw_response、raw_ai_output、code、expression、script、callback、function、eval、pregnancy_id、pregnancy_outcome、no_pregnancy、outcome 等字段。',
].join('\n')
// 只用普通文字描述输出字段，避免把格式围栏或大段 schema 代码发送给后端。
const WORLD_MODEL_OUTPUT_CONTRACT = [
  '只输出一个结构化对象，不要输出解释文字、Markdown 或代码围栏；schema_version 固定为 1。JSON key 使用 schema 规定的英文，说明、规则和列表字符串使用中文。',
  '顶层只包含 schema_version、species、medical_context、exceptions、unknowns、projection_rules；不得出现顶层 biological_types 或 species 级 capabilities。',
  'species[] 包含 name、description、biological_types[]；每个 biological_type 包含 name、description、capabilities、reproductive_mechanisms[]、reproduction_rules、lifecycle、special_rules。',
  'capabilities 只能位于 biological_types 下，固定包含六个 key：can_produce_sperm、can_produce_ova、can_be_fertilized、can_fertilize、can_cause_pregnancy、can_carry_pregnancy；值只能是 true、false 或 null，can_fertilize 与 can_cause_pregnancy 不互为 alias。',
  WORLD_MODEL_REPRODUCTIVE_MECHANISM_CONTRACT,
  'reproduction_rules 固定包含 fertilization、pregnancy_or_carrying、cycle、ovulation、gestation、labor；lifecycle 固定包含 maturation、aging。规则字段只能使用 null、非空中文描述或 canonical absence value“无”：null 是未知/证据不足，非空描述是已知存在，“无”是已知不存在/不适用；没有提到或无法判断时不要写“无”。其它未知标量为 null，列表为数组。',
  'medical_context 固定包含 childbirth_difficulty、care_level、evidence，均为 nullable string。',
  'exceptions 必须是 JSON 数组；每项必须是对象，固定包含 statement、applies_to、evidence，三者均为 nullable string。不得使用以实体名称为 key 的对象映射；没有例外时输出 []。',
  'unknowns 必须是 JSON 字符串数组，不得使用对象映射；没有未知项时输出 []。special_rules 必须是 JSON 字符串数组，没有特殊规则时输出 []。',
  WORLD_MODEL_PROJECTION_RULE_CONTRACT,
].join('\n')
const HISTORY_MEMORY_CONTEXT = [
  '【外部历史参考信息】',
  '以下内容来自用户在设置中启用的外部历史或记忆来源，用于补充较早剧情背景。它是参考证据，请结合当前剧情、明确的后续事件和 BioWeave 已保存事实判断；若存在冲突，不要自行强行合并为确定事实。',
].join('\n')
function readableText(value) {
  return String(value ?? '')
    .replace(/\u0000/g, '')
    .trim()
}
function expandPlaceholders(value, names) {
  return readableText(value)
    .replace(/\{\{user\}\}|<user>/gi, names.userName)
    .replace(/\{\{char\}\}|<char>/gi, names.characterName)
}
function addBlock(
  lines,
  title,
  value,
  names = { userName: '用户', characterName: '角色' },
) {
  const text = expandPlaceholders(value, names)
  if (!text) return
  lines.push(`${title}\n${text}`)
}

function addMessage(messages, role, content) {
  const text = readableText(content)
  if (text) messages.push({ role, content: text })
}

function formatPromptValue(value, indent = 0, seen = new Set()) {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'string') return readableText(value) || '（空）'
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value)
  if (typeof value !== 'object') return '（不支持的值）'
  if (seen.has(value)) return '（重复引用已省略）'
  seen.add(value)
  if (Array.isArray(value)) {
    if (!value.length) return '（空数组）'
    return value
      .map(
        (item) =>
          `${' '.repeat(indent)}- ${formatPromptValue(item, indent + 2, seen)}`,
      )
      .join('\n')
  }
  const entries = Object.entries(value).sort(([left], [right]) =>
    left.localeCompare(right),
  )
  if (!entries.length) return '（空对象）'
  return entries
    .map(([key, item]) => {
      const valueText = formatPromptValue(item, indent + 2, seen)
      if (valueText.includes('\n'))
        return `${' '.repeat(indent)}${key}:\n${valueText}`
      return `${' '.repeat(indent)}${key}: ${valueText}`
    })
    .join('\n')
}

function hasPromptValue(value, seen = new Set()) {
  if (value === null || value === undefined) return false
  if (typeof value === 'string') return Boolean(readableText(value))
  if (typeof value === 'number' || typeof value === 'boolean') return true
  if (typeof value !== 'object' || seen.has(value)) return false
  seen.add(value)
  return Array.isArray(value)
    ? value.some((item) => hasPromptValue(item, seen))
    : Object.values(value).some((item) => hasPromptValue(item, seen))
}

function eventContextBlock(title, value, fallback = '（本次没有可用内容）') {
  const rendered = formatPromptValue(value)
  return `${title}\n${rendered === 'null' || rendered === '（空对象）' ? fallback : rendered}`
}

function formatCommonAnalysisPrompt(settings, names) {
  const blocks = [settings.task, settings.input_prefix]
    .map((value) => expandPlaceholders(value, names))
    .filter(Boolean)
  return blocks.length ? `【公共分析提示词】\n${blocks.join('\n\n')}` : ''
}

function formatAnalysisPromptTail(settings, names) {
  const blocks = [settings.input_suffix]
    .map((value) => expandPlaceholders(value, names))
    .filter(Boolean)
  return blocks.length ? `【公共分析补充】\n${blocks.join('\n\n')}` : ''
}

function formatCharacterReference(input, names) {
  const character =
    input?.character && typeof input.character === 'object'
      ? input.character
      : {}
  const lines = []
  addBlock(lines, '角色背景', character.description, names)
  if (!lines.length) return ''
  return [
    `【角色卡：${names.characterName} 的背景资料】`,
    '以下内容来自当前角色卡中用户允许 BioWeave 读取的字段，仅作为本次分析的背景资料与证据参考。角色卡未描述的内容不能因此自动视为已知事实。',
    lines.join('\n\n'),
  ].join('\n')
}

function formatCharacterGreetingReference(input, names) {
  const greetings = Array.isArray(input?.character?.greetings)
    ? input.character.greetings
    : []
  const contents = greetings
    .map((greeting) => expandPlaceholders(greeting?.content, names))
    .filter(Boolean)
  if (!contents.length) return ''
  return ['【开场白】', contents.join('\n\n')].join('\n')
}

function formatWorldbookReference(worldbooks, names) {
  const lines = []
  for (const worldbook of Array.isArray(worldbooks) ? worldbooks : []) {
    for (const entry of Array.isArray(worldbook?.entries)
      ? worldbook.entries
      : []) {
      const content = expandPlaceholders(entry?.content, names)
      if (!content) continue
      const label = expandPlaceholders(entry?.label || '未命名条目', names)
      lines.push(`【条目：${label}】\n${content}`)
    }
  }
  if (!lines.length) return ''
  return [
    '【世界书参考资料】',
    '以下内容来自用户在 BioWeave 设置中选择的世界书条目，请作为世界观、生物规则和背景资料的参考证据。若当前剧情存在明确的后续变化或个体例外，应结合当前剧情判断，不要机械覆盖当前事实。',
    lines.join('\n\n'),
  ].join('\n')
}

function formatPersonaReference(persona, names) {
  const value = persona && typeof persona === 'object' ? persona : {}
  const lines = []
  addBlock(lines, '人物名称', value.name || names.userName, names)
  addBlock(lines, '人物设定', value.description, names)
  if (!value.description) return ''
  return [
    `【${names.userName} 的人物设定】`,
    '以下内容来自 SillyTavern 当前启用的用户人物设定，仅供理解人物关系、身份背景和剧情事件时参考。人物设定本身不代表当前目标楼层一定发生了其中描述的事件。',
    lines.join('\n\n'),
  ].join('\n')
}

function formatExternalMemoryReference(externalMemory, names) {
  const lines = []
  for (const provider of Array.isArray(externalMemory) ? externalMemory : []) {
    if (
      provider?.enabled !== true ||
      provider?.available !== true ||
      provider?.content_available !== true ||
      ['disabled', 'unavailable', 'error'].includes(provider?.read_status)
    )
      continue
    for (const item of Array.isArray(provider?.items) ? provider.items : []) {
      const content = expandPlaceholders(item?.content, names)
      if (!content) continue
      const label = expandPlaceholders(
        item?.label || provider?.label || '历史记录',
        names,
      )
      lines.push(`【${label}】\n${content}`)
    }
  }
  if (!lines.length) return ''
  return [HISTORY_MEMORY_CONTEXT, lines.join('\n\n')].join('\n')
}

function formatWorldModelReference(worldModel) {
  if (!hasPromptValue(worldModel)) return ''
  const rendered = formatPromptValue(worldModel)
  return [
    '【当前 World Model 参考】',
    '以下内容是已经保存的 World Model baseline，仅作为生物规则和能力背景参考；它不是本次目标楼层已经发生的事件事实。',
    rendered,
  ].join('\n')
}

function formatExistingBioWeaveReference(existing) {
  if (!hasPromptValue(existing)) return ''
  const rendered = formatPromptValue(existing)
  return [
    '【现有 BioWeave 事实参考】',
    '以下是当前 Chat 已保存的结构化事实参考，用于避免重复或理解已有记录；不要把它改写成当前目标楼层的新事实。',
    rendered,
  ].join('\n')
}

function formatStoryTimeReference(storyTime, names) {
  if (!storyTime || typeof storyTime !== 'object') return ''
  const display = expandPlaceholders(storyTime.display, names)
  const normalized = expandPlaceholders(storyTime.normalized, names)
  const calendarId = expandPlaceholders(storyTime.calendar_id, names)
  const hasKnownValue = Boolean(
    display ||
    normalized ||
    calendarId ||
    (storyTime.day_index !== null && storyTime.day_index !== undefined) ||
    (storyTime.precision && storyTime.precision !== 'unknown') ||
    (storyTime.confidence !== null && storyTime.confidence !== undefined),
  )
  if (!hasKnownValue) return ''
  return [
    '故事时间结构化参考：',
    `显示：${display || '未知'}`,
    `标准化时间：${normalized || '未知'}`,
    `日历：${calendarId || '未知'}`,
    `连续日索引：${storyTime.day_index === null || storyTime.day_index === undefined ? '未知' : formatPromptValue(storyTime.day_index)}`,
    `精度：${expandPlaceholders(storyTime.precision, names) || '未知'}`,
    `置信度：${storyTime.confidence === null || storyTime.confidence === undefined ? '未知' : formatPromptValue(storyTime.confidence)}`,
  ].join('\n')
}

function narrativeItemsMatch(left, right) {
  if (!left || !right) return false
  const leftMessageId = readableText(left.message_id ?? left.messageId)
  const rightMessageId = readableText(right.message_id ?? right.messageId)
  const leftSwipeId = Number.isInteger(left.swipe_id) ? left.swipe_id : null
  const rightSwipeId = Number.isInteger(right.swipe_id) ? right.swipe_id : null
  if (leftMessageId && rightMessageId) {
    return (
      leftMessageId === rightMessageId &&
      (leftSwipeId === null ||
        rightSwipeId === null ||
        leftSwipeId === rightSwipeId)
    )
  }
  const leftFloor =
    left.floor === null || left.floor === undefined ? null : Number(left.floor)
  const rightFloor =
    right.floor === null || right.floor === undefined
      ? null
      : Number(right.floor)
  return (
    Number.isFinite(leftFloor) &&
    Number.isFinite(rightFloor) &&
    leftFloor === rightFloor
  )
}

function formatNarrativeContent(item, names) {
  return expandPlaceholders(item?.content ?? item?.narrative, names)
}

function formatNarrativeContext(
  items,
  targetItem = null,
  names,
  storyTime = null,
) {
  const recentItems = (Array.isArray(items) ? items : []).filter(
    (item) => !narrativeItemsMatch(item, targetItem),
  )
  const recentContent = recentItems
    .map((item) => formatNarrativeContent(item, names))
    .filter(Boolean)
  if (!targetItem) {
    return recentContent.length
      ? ['【近期剧情参考】', recentContent.join('\n\n')].join('\n\n')
      : ''
  }

  const targetContent = formatNarrativeContent(targetItem, names)
  const sections = []
  if (recentContent.length)
    sections.push(['【剧情上下文】', recentContent.join('\n\n')].join('\n\n'))
  if (targetContent) {
    sections.push(
      [
        '【本次分析内容】',
        formatStoryTimeReference(storyTime, names),
        targetContent,
      ]
        .filter(Boolean)
        .join('\n\n'),
    )
  }
  return sections.join('\n\n')
}

function formatEventCharacterReference(input, names) {
  return formatCharacterReference({ character: input?.character }, names)
}

function formatEventCharacterRegistry(identityContext, names) {
  const candidates = Array.isArray(identityContext?.canonical_candidates)
    ? identityContext.canonical_candidates
    : []
  const blocks = candidates
    .map((candidate) => {
      const characterId = expandPlaceholders(candidate?.character_id, names)
      if (!characterId) return ''
      const displayName = expandPlaceholders(candidate?.display_name, names)
      const aliases = Array.isArray(candidate?.aliases)
        ? candidate.aliases
            .map((alias) => expandPlaceholders(alias, names))
            .filter(Boolean)
        : []
      return [
        `canonical character_id（Runtime 原样提供）：${characterId}`,
        displayName ? `display_name：${displayName}` : 'display_name：未知',
        `aliases：${aliases.length ? aliases.join('、') : '（无）'}`,
      ].join('\n')
    })
    .filter(Boolean)
  const registryInstruction = blocks.length
    ? '以下是 Runtime 已登记的 canonical identity candidates。character_id 是不透明、稳定且只读的实体 ID；existing 只能从这些 ID 中原样选择，且 mention_id 必须为 null，不能根据 display_name 或 alias 改写、翻译、拼音化或自行生成 ID。display_name/alias 只用于理解 mention，alias 可能属于多个实体，不能 first-match-wins。没有足够证据时请返回 unresolved；首次出现的新人物使用 identity_status=new、character_id=null 和本次完整 response 内唯一、无语义的 response-local mention token，不得使用姓名、display_name、alias、拼音、canonical ID 或角色称谓作为 mention_id。'
    : '这是 Initial Registry Bootstrap：当前 character_registry.entities 为空，表示当前没有任何合法的 canonical identity candidate；本次 response 不存在合法的 identity_status=existing participant。此前未登记或无法解析的人物必须使用 identity_status=new 或 unresolved、character_id:null，以及当前完整 response 内唯一、无业务语义的 response-local mention token（不要把 <当前人物显示名>、姓名、display_name、alias、拼音、canonical ID 或角色称谓用作 mention_id）。Runtime 会在 response 返回后分配正式 canonical ID；模型不需要知道、预测或输出正式 character_id。existing 的 mention_id 必须为 null；new/unresolved 必须返回 character_id:null。'
  return [
    '【Runtime Canonical Character Registry】',
    registryInstruction,
    blocks.length
      ? blocks.join('\n\n')
      : '当前没有已登记的 canonical identity candidate。',
  ].join('\n')
}

const EVENT_CHARACTER_CAPABILITY_LABELS = Object.freeze({
  can_produce_sperm: '可产生精子',
  can_produce_ova: '可产生卵子',
  can_be_fertilized: '可被受精',
  can_cause_pregnancy: '可导致受孕',
  can_carry_pregnancy: '可承载妊娠',
})

function formatEventIndividualEvidence(individualEvidence, names) {
  const profiles = Array.isArray(individualEvidence) ? individualEvidence : []
  const profileBlocks = profiles
    .map((profile) => {
      const characterId = expandPlaceholders(profile?.character_id, names)
      const subjectKind = expandPlaceholders(profile?.subject_kind, names)
      const identityHint = expandPlaceholders(profile?.identity_hint, names)
      const displayName = expandPlaceholders(profile?.display_name, names)
      const stableEvidence = Array.isArray(profile?.stable_biological_evidence)
        ? profile.stable_biological_evidence
            .map((item) => {
              const text = expandPlaceholders(item?.text, names)
              const kind = expandPlaceholders(item?.kind, names)
              return text ? `${kind ? `${kind}：` : ''}${text}` : ''
            })
            .filter(Boolean)
        : []
      if (!characterId && !identityHint && !displayName && !stableEvidence.length) return ''
      const lines = [
        characterId
          ? `角色标识：${characterId}`
          : '角色标识：未分配 canonical character_id（仅使用本次 transient subject evidence）',
      ]
      if (subjectKind) lines.push(`证据对象：${subjectKind}`)
      if (identityHint) lines.push(`身份提示：${identityHint}`)
      const species = expandPlaceholders(profile?.species, names)
      const biologicalType = expandPlaceholders(profile?.biological_type, names)
      if (displayName) lines.push(`显示名称：${displayName}`)
      if (species) lines.push(`物种：${species}`)
      if (biologicalType) lines.push(`生物类型：${biologicalType}`)

      const capabilities =
        profile?.capabilities
      if (
        capabilities &&
        typeof capabilities === 'object' &&
        !Array.isArray(capabilities)
      ) {
        lines.push('已知生殖能力：')
        for (const key of EVENT_CAPABILITY_KEYS) {
          const value =
            capabilities[key] === true ||
            capabilities[key] === false ||
            capabilities[key] === null
              ? capabilities[key]
              : null
          lines.push(
            `- ${EVENT_CHARACTER_CAPABILITY_LABELS[key] ?? key}：${value === null ? '未知' : value ? '是' : '否'}`,
          )
        }
      }

      const evidence = Array.isArray(profile?.evidence)
        ? profile.evidence
            .map((item) => {
              if (item && typeof item === 'object' && !Array.isArray(item)) {
                const text = expandPlaceholders(
                  item.text ?? item.content,
                  names,
                )
                const kind = expandPlaceholders(item.kind, names)
                return text ? `${kind ? `${kind}：` : ''}${text}` : ''
              }
              return expandPlaceholders(item, names)
            })
            .filter(Boolean)
        : []
      if (evidence.length) {
        lines.push('资料证据：')
        evidence.forEach((item) => lines.push(`- ${item}`))
      }
      if (stableEvidence.length) {
        lines.push('稳定人物生理证据（不是当前 Floor Event）：')
        stableEvidence.forEach((item) => lines.push(`- ${item}`))
      }
      const provenance = profile?.provenance
      if (provenance?.source_kind) {
        lines.push(`证据来源：${expandPlaceholders(provenance.source_kind, names)}`)
      }
      return lines.join('\n')
    })
    .filter(Boolean)
  if (!profileBlocks.length) return ''
  return [
    '【事件相关角色参考】',
    '以下 individual_evidence 内容是经过 source-specific Character Evidence semantic projection 的稳定人物背景证据，仅用于 mention identity、World Model species/type mapping 和明确个体能力证据；它不代表本次目标楼层已经发生了任何事件，也不是 canonical identity candidates 的白名单，不能替代上面的 Runtime Character Registry。Character Card、Persona、Worldbook、External Memory 不以 raw host DTO 形式进入本请求。',
    profileBlocks.join('\n\n'),
  ]
    .filter(Boolean)
    .join('\n')
}

function formatEventExistingEvents(events) {
  if (!Array.isArray(events) || !events.length) return ''
  return [
    '【现有 BiologicalEvent 事实参考】',
    '以下是 narrative discovery window 覆盖范围内已保存的 canonical Event，用于避免重复或理解历史。已存在且结构化事实高置信度完全匹配的 Event 不要再次输出；窗口中尚未记录但有明确事实证据的 Event 可以补录，并由 Runtime 持久化到当前目标 Floor。',
    formatPromptValue(events),
  ].join('\n')
}

function formatEventFloorMetadata(input) {
  const scope =
    input.chat_scope && typeof input.chat_scope === 'object'
      ? input.chat_scope
      : {}
  const version =
    input.floor_version && typeof input.floor_version === 'object'
      ? input.floor_version
      : {}
  return [
    '【本次分析边界】',
    `目标楼层：${formatPromptValue(version.floor)}`,
    `目标消息：${formatPromptValue(version.message_id)}`,
    `目标 Swipe：${formatPromptValue(version.swipe_id)}`,
    scope.chat_id ? '当前 Chat 边界已由 Runtime 校验。' : '',
    '以上字段仅用于限定本次输入边界，不要复制到 Event 输出；Event source 由 Runtime 绑定。',
  ].join('\n')
}

function joinPromptSections(sections) {
  return sections.filter(Boolean).join('\n\n')
}

function formatWorldModelRules(settings, names) {
  return joinPromptSections([
    `【BioWeave World Model 分析规则】\n${WORLD_MODEL_CORE_INSTRUCTIONS}`,
    formatCommonAnalysisPrompt(settings, names),
    `【World Model 任务】\n${WORLD_MODEL_TASK_PROMPT}`,
    formatAnalysisPromptTail(settings, names),
    `【World Model 输出契约】\n${WORLD_MODEL_OUTPUT_CONTRACT}`,
  ])
}

function formatWorldModelReferences(input, names) {
  return joinPromptSections([
    formatCharacterReference(input, names),
    formatWorldbookReference(input.worldbooks, names),
    formatExternalMemoryReference(input.external_memory, names),
    formatCharacterGreetingReference(input, names),
  ])
}

function formatWorldModelPatchReferences(input, names) {
  return joinPromptSections([
    formatWorldModelReferences(input, names),
  ])
}

function formatWorldModelPatchTarget(worldModel) {
  return [
    '【Supplement Target：当前已保存的 World Model】',
    '这是当前已保存且 active 的 canonical World Model，是本次 Supplement 审阅与补全的目标；Existing = TARGET + comparison baseline。Existing 本身不是 evidence。',
    `<existing_world_model>${formatPromptValue(worldModel)}</existing_world_model>`,
  ].join('\n')
}

function formatWorldModelSupplementTarget(worldModel) {
  return [
    '【Supplement Target：当前已保存的 World Model】',
    '这是当前已保存且 active 的 canonical World Model，是本次 Supplement 审阅与补全的目标；Existing = TARGET + comparison baseline。Existing 本身不是 evidence。NONE RECORDED 表示 Existing canonical World Model 当前没有记录该 collection，只是 coverage marker，不是 negative biological evidence。',
    formatWorldModelSupplementReference(worldModel),
  ].join('\n')
}

function formatWorldModelPatchUserMessage(input, names, { evidenceFirst = false, supplementReference = false } = {}) {
  const request = supplementReference
    ? '【Supplement Evidence Candidate Output】根据 permitted evidence 与完整 Existing reference 输出一棵 hierarchical Complete Evidence-Supported Candidate。Existing 仅作 TARGET、comparison baseline 和 structure reference，不是 evidence。对 evidence-supported fact 逐字段比较：Existing 相同值已记录则省略；null、absent 或缺少 collection member 视为未记录并可补充；明确不同 known value 才提出 correction claim。不要执行 ADD、CHANGE、NO-OP 或 delta 判断。严格使用 v3 underscore semantic transport labels，只输出协议文本，不输出解释、JSON、Patch operation、target、path、classification 或 old_value。'
    : '【Supplement Request】根据前面的 permitted World Analysis evidence，完成事实发现、scope/classification 与 Existing exact comparison；只输出符合旧版契约的 evidence-supported sparse add/update JSON。Existing 不是 evidence；unchanged omission 保留 Existing；不要返回完整 World Model。'
  return joinPromptSections([
    supplementReference
      ? formatWorldModelSupplementTarget(input.world_model)
      : formatWorldModelPatchTarget(input.world_model),
    request,
  ])
}

function formatEventAnalysisRules(input, settings, names) {
  return joinPromptSections([
    `【BioWeave Event Analysis 核心规则】\n${EVENT_ANALYZER_CORE_CONTRACT}`,
    formatCommonAnalysisPrompt(settings, names),
    `【Event Analysis 任务】\n${EVENT_ANALYZER_TASK_CONTRACT}`,
    formatEventFloorMetadata(input),
    formatAnalysisPromptTail(settings, names),
    `【Event 输出契约】\n${EVENT_ANALYZER_OUTPUT_CONTRACT}`,
  ])
}

function formatEventAnalysisReferences(input, names) {
  return joinPromptSections([
    formatEventCharacterRegistry(input.identity_context, names),
    formatEventIndividualEvidence(input.individual_evidence, names),
    formatWorldModelReference(input.world_model),
    formatEventExistingEvents(input.existing_events),
  ])
}

function inputNames(input) {
  const meta = input?.meta && typeof input.meta === 'object' ? input.meta : {}
  return {
    userName:
      expandPlaceholders(meta.user_name ?? meta.userName ?? '用户', {
        userName: '用户',
        characterName: '角色',
      }) || '用户',
    characterName:
      expandPlaceholders(meta.character_name ?? meta.characterName ?? '角色', {
        userName: '用户',
        characterName: '角色',
      }) || '角色',
  }
}
const WORLD_MODEL_TASK_PROMPT =
  '请根据下面的资料整理当前 Chat 的生物学世界规则。只使用资料中的明确证据，不要把推测写成事实。'

export const WORLD_MODEL_PATCH_TASK_PROMPT =
  '请重新审阅当前允许的完整 World Analysis evidence，先完成 Fact Discovery、Species/Type scope 与共享 Direct/Derived Type existence gates，再将已判断的事实与 Existing 做 exact comparison。Existing 仅是 comparison baseline 与兼容合并参考，不是 evidence；不得用 Existing 或 type name 证明新的 Species/Type/field。对所有 evidence-supported stable classifications 与其它合法 outlets 完成 review 后，只输出 evidence-supported sparse v1 add/update delta：UNCHANGED 不输出，合法 ADD/CHANGE 才输出，omission 保留 Existing，不能输出完整 replacement World Model，也不能用 remove、invalidate、null 或空值表示删除。Previously missed 与 newly available evidence 使用相同 eligibility；individual-only、temporary、scope ambiguous 或 unsupported facts 不得升级为 world-level Patch。'

export const WORLD_MODEL_PATCH_OUTPUT_CONTRACT = [
  '只输出一个 JSON 对象：{"schema_version":1,"add":{},"update":{}}。add/update 只包含本次允许 evidence 建立的 world-level 新知识或 correction；不要输出 individual-only fact，也不要输出 scope ambiguous 的 world rule。不要输出内部 Semantic Delta 标签或解释，不要返回完整 World Model。',
  '允许 add 的字段：species、exceptions、unknowns、projection_rules；允许 update 的字段：species、medical_context、projection_rules。species 和 projection_rules 的 update 项必须包含稳定名称或 rule identity，并提供该项更新后的完整 canonical entry。',
  'update.species 是 complete updated canonical species Candidate：兼容补充时必须保留 Existing 中仍成立的 species/type/rule/fact，再加入当前 evidence 支持的新知识；不能只返回一个 nested sparse fragment。update.medical_context 是 sparse field update，Raw field absent 表示 unchanged。',
  WORLD_MODEL_REPRODUCTIVE_MECHANISM_CONTRACT,
  WORLD_MODEL_PROJECTION_RULE_CONTRACT,
  '本版本不支持 remove、invalidate 或通过省略字段删除旧规则；不要输出 remove/invalidate。明确 evidence-supported correction 只能通过 update 表达，不能通过省略字段或空值表达删除。',
  'sparse section 中缺少字段永远表示不修改；complete update.species 中 Existing 已知事实消失会被视为删除风险。不要求事实首次出现于 current Floor；不要因为某事实不是 current Floor 首次出现，就排除当前允许 evidence 中对 Existing Model 的补充；也不要把 Existing World Model 重新整理后作为完整结果返回。',
].join('\n')

export const WORLD_MODEL_SUPPLEMENT_FIELD_DICTIONARY = [
  '【World Model AI Field Dictionary】先理解每个字段在问什么，再按后续 evidence/scope rules 判断是否可以填写。所有例子只是帮助理解，不是 enum；Species 与 Biological_Type 都是开放字符串。',
  'Species / Species（物种、人种、生命种类）：提取 evidence 明确支持的稳定生命种类，例如 Species-A、人类、妖族、兽族、魔族、龙族、精灵或其它世界观生命种类。不得填性别、生理类型、职业、门派、阵营、社会身份、修炼境界或临时身体状态。缺少 Species-scoped evidence 时省略，不从 Existing 或其它 Species 补写。',
  'Species_Description（物种描述）：提取该 Species 由 evidence 支持的稳定身份、生物性质、来源或总体特征，例如 Species-A 的稳定来源描述。若事实已有 capability、reproduction rule、lifecycle 或 mechanism 专用字段，优先填写专用字段，不在 Description 中重复总结；Existing 或现实常识不足以支持它。',
  'Biological_Type / Biological_Type（稳定生理/生殖分类；性别是常见形式）：提取 Species 内 evidence 明确建立的稳定 biological、physiological 或 reproductive classification。男性、女性、雄性、雌性、双性、间性、Alpha、Beta、Omega 以及架空分类都只是开放字符串例子，不是 enum。Species scope 下直接陈述的 stable classification 可建立 identity；没有直接命名时才走 frozen Type Gate 的稳定、可重复、边界唯一 cluster 派生路径。职业、社会身份、组织/阵营、修炼阶段、疾病、临时/可逆/conditional-only 状态和 individual-only trait 不属于 Type。rare/minority/uncommon/low prevalence 不等于 temporary；“Species-A 大多为 Type-A，少量 Type-B 长期存在”可分别支持两个 identity。Type identity 只证明分类存在，不授权 capability。',
  'Type_Description（生理类型描述）：只提取该 Biological_Type 本身由 evidence 支持的稳定分类特征。不要把 capabilities、reproduction rules、lifecycle 或 mechanisms 拼成描述；例如 evidence 只支持 Can_Produce_Sperm 与 Can_Fertilize 时，不要自行生成“能产生精子并进行受精的类型”。没有独立 descriptive statement 时省略。',
  '【Capabilities】表示该 Biological_Type 被 evidence 明确支持的生殖能力；每个字段独立判断，Type identity 或另一个 capability 都不能授权它。明确正向证据=true，明确负向证据=false，unknown/unstated/insufficient=omit；Candidate 禁止 null，false 不表示 unknown、删除或 REMOVE。',
  'Can_Produce_Sperm：提取该 Type 是否产生精子或世界观等价雄性配子；不能仅凭男性、雄性或 Alpha 名称推断。Can_Produce_Ova：提取是否产生卵子或等价雌性配子；不能仅凭女性、雌性或 Omega 名称推断。',
  'Can_Be_Fertilized：提取该 Type 是否能作为被受精方；与 Can_Carry_Pregnancy 不同，被受精不自动意味着承载妊娠。Can_Fertilize：提取是否能使另一方配子/生殖结构发生受精；与 Can_Cause_Pregnancy 不同，能受精不自动意味着导致妊娠。',
  'Can_Cause_Pregnancy：提取该 Type 是否能通过 evidence 明确的生殖机制使另一承载方进入妊娠；性交、插入、精液或男性/雄性身份本身不够。Can_Carry_Pregnancy：提取该 Type 是否能作为妊娠承载方，使胚胎/胎儿在其身体或明确承载结构中发育；女性、雌性或 Omega 名称本身不够。',
  '【Reproduction Rules】只提取该 Type 的稳定生殖过程规则，不把 capability boolean 当作 rule。Fertilization：受精如何发生、配子如何结合、条件或授精机制；不写单纯妊娠、孕期、分娩或性行为。Pregnancy_Or_Carrying：妊娠/承载如何发生、承载结构与条件；它不是“能否怀孕”的 boolean。',
  'Cycle：稳定生殖、发情、月经或繁殖周期；一次性欲望变化不属于 Cycle。Ovulation：排卵、释放卵细胞或等价过程的稳定规则。Gestation：进入妊娠后的孕期长度、阶段或持续进展；不等于 Can_Carry_Pregnancy。Labor：分娩、生产、产程或出生方式；不要把 fertilization 或 gestation 重复到 Labor。各字段没有独立 evidence 时分别省略。',
  '【Lifecycle】Maturation：生物成熟、性成熟、成年或稳定发育成熟过程；不写修炼升级、职业成长、关系成长或力量境界。Aging：寿命、衰老、老化或年龄相关稳定变化；不写修炼境界或力量变化。',
  '【Reproductive Mechanisms / Mechanism】仅当普通 capability/rule 字段无法完整表达、且 evidence 明确支持独立生殖机制时使用；普通性交、生殖或妊娠事实不自动创建 Mechanism。Mechanism_Key 是稳定简短机器 key；Mechanism_Label 是人类可读名称；Mechanism_Pathway 是实际运作路径；Carrying_Compatibility 只有明确 true/false evidence 才输出；World_Model_Rule_Refs 只能引用明确关联的既有 rule reference；Evidence 只记录该机制对应的合法 evidence contract。',
  '【Special Rules / Rule】提取确实属于当前 Biological_Type、由 evidence 支持且没有更准确 structured field 表达的稳定特殊规则。Rule 是 fallback outlet，不是事实垃圾桶；若 capability、reproduction rule、lifecycle 或 mechanism 已能表达，则不要重复。Species-scoped rule 不得强行挂到 Type。',
  '【Medical Context】只记录明确属于 world-level 的医疗/照护背景。Childbirth_Difficulty 是世界级分娩难度或总体产科风险；Care_Level 是世界级医疗、产科或照护水平；Evidence 支持该 world-level context。单一个体治疗、症状、检查或护理不能自动升级为 world-level。',
  '【Exception】Exception_Statement 是偏离一般 World Model 规则的明确例外；Applies_To 是明确适用对象/范围；Evidence 支持该例外。未知、资料不足和普通临时事实不自动成为 Exception。',
  '【Unknown】Unknown_Fact 只记录 evidence 已触及但明确 unresolved、unknown 或 conflicting、且会影响 World Model 的重要事实，例如“尚不清楚 Species-A 是否存在第三种稳定 Biological_Type”。schema field 没资料不是 Unknown；missing field 与 omitted capability 都不是 Unknown。',
  '【Projection Rule】只记录合法 future projection rule contract，继续使用严格 JSON payload；AI 不创建 projection_rule_id，也不把普通 biological fact 塞进 Projection Rule。',
  '【Scope examples】Species-scoped fact 只能留在 Species scope；Type-scoped fact 必须留在对应 Species + Biological_Type；individual fact 不能自动升级为 Type、Species 或 world-level rule。“Species-A 中存在 Type-B”只支持 identity，不支持 Type-B capability。“Species-A 的个体甲可以承载妊娠”没有 Type-wide evidence 时不能输出 Type 的 Can_Carry_Pregnancy。Species 整体规则若没有合法 Species-scope outlet，也不能错误挂到任意 Type。',
].join('\n')

export const WORLD_MODEL_PATCH_V2_TASK_PROMPT =
  '【Supplement Evidence Candidate】一次 Supplement attempt 只有一次 API request。阅读全部 permitted evidence 与完整 Existing canonical World Model，先完成 internal Complete Evidence Discovery，再输出一棵 Complete Evidence-Supported Candidate；不负责 ADD、CHANGE 或 NO-OP。Existing = TARGET + comparison baseline + structure reference，不是 evidence。对每个 evidence-supported fact 做逐字段/逐 identity comparison：Existing 已有完全相同 known value 则不输出；null、absent 或 collection 中没有该 identity/member 视为尚未记录，可以输出；permitted evidence 明确支持不同 known value 时输出 correction claim。程序负责 deterministic Patch v2 comparison。\n\n' +
  WORLD_MODEL_SUPPLEMENT_FIELD_DICTIONARY +
  '\n\n【Candidate completeness】Complete Evidence-Supported Candidate 对 permitted evidence 与 Existing comparison 完整，而不是对 schema 完整。Complete means complete with respect to permitted evidence and the Existing comparison, not complete with respect to schema. 对每个 evidence-supported fact：Existing 相同 known value 已记录则省略；Existing 为 null/absent 或 collection 缺少 identity/member 时输出；known value 不同且 evidence 明确支持时输出 correction claim；schema 中存在但 evidence 不支持的 field 必须省略。Evidence completeness != Schema completeness。Candidate 仍是 presence-sensitive partial semantic object，不是完整 canonical World Model。\n\n【No Evidence Compression】不得因为 fact 数量少、rare、minority、uncommon、low prevalence、次要、非 dominant、出现在附带说明、另一个 Type 更常见、Existing 中没有或看起来不重要而省略 evidence-supported fact；但 Existing 已记录完全相同 known value 的 fact 不属于待补充输出。同一 evidence unit 支持多个可合法映射的 World Model facts 时，必须分别提取；发现 Type-A 后不得停止同一 evidence unit 或 Species 的 identity review。\n\n【No Schema Completion】不得为了让 Species、Biological_Type 或 section 看起来完整而补没有独立 permitted evidence 的 field。不得使用 Type/Species label、schema symmetry、现实常识、biological stereotype、Existing alone、相邻 capability、相邻 reproduction rule 或“通常应该如此”推断。Identity evidence 只建立 identity，不授权 details。Type identity does not authorize details.\n\n【Review order】1. 完整扫描全部 permitted evidence；2. 识别所有 evidence-supported Species；3. 对每个 Species 识别全部 evidence-supported Biological_Type identity，不以 dominant Type 为停止条件；Existing 已有 identity 不输出，Existing 缺失且 evidence 支持的 identity 才输出；4. identity 确定后，逐一检查 Description、Capabilities、Reproduction Rules、Lifecycle、Mechanisms、Special Rules、Medical Context、Exceptions、Unknowns、Projection Rules 的独立 scoped evidence，并与 Existing 比较；5. 只序列化 evidence-supported 且相对 Existing 缺失或明确不同的 facts。Identity discovery first. Detail extraction second. 缺少 details 不影响已被直接 evidence 支持的 identity。\n\n【完整 evidence review】输出前读完全部 permitted evidence。对每个 Species 检查 Species existence、直接陈述的 stable Biological Type、严格派生的 stable Type、Species-scoped facts、每个 Type 的独立字段证据，以及 mechanism、special rule、medical context、exception、unknown、projection rule。发现一个 Species 或 Type 后不得停止。\n\n【Type identity】Biological Type 不等同于性别，但性别、生理性别、生殖型是常见 Type；允许架空稳定分类。Species scope 下明确持续存在的 classification 可直接成立；rare、minority、uncommon、low prevalence 不影响 existence，数量少不等于 temporary。没有直接命名时，只有稳定、可重复识别且边界唯一的 physiology、reproductive structure、reproductive role 或 capability cluster 才可派生；只有一个 cluster 不补 paired Type。temporary、reversible、conditional-only、职业、社会身份、组织、阵营、修炼阶段、疾病/异常 transient state 和 individual-only trait 不建立 permanent Type。\n\n【Type identity != details】Type 名称、male/female/sex-like label、外形、性交行为、schema 对称性和现实常识都不能授权 capability。每个字段必须有同一 scope 的独立 permitted evidence；明确正面证据才输出 true，明确负面证据才输出 false，unknown/unstated/insufficient evidence 省略；Candidate 禁止 null，false 不表示 unknown、删除或无证据。Species-scoped fact 不得挂到 Type；Type-scoped fact 不得推广到 Species；individual fact 不得升级 scope。Nonhuman 不使用 Human baseline，不跨 Species 借 evidence。\n\n【Description discipline】Description 只用于可选的 identity/context 描述，不是结构化事实的兜底字段。已有专用 capability、rule、lifecycle 或 mechanism 字段时，优先写专用字段；不要把多个结构化事实拼成新的 Description。Existing Description 仍必须遵守 Existing comparison：Existing 已记录完全相同的 Description 时不输出；只有 Existing Description 为 null/absent 且 permitted evidence 支持，或 permitted evidence 明确支持与 Existing 不同的 known Description 时，才输出 supplement/correction claim。Existing 单独不能证明 Description。\n\n【输出】Existing 相同 known fact 不输出；Candidate 只输出相对 Existing 缺失或 evidence-supported correction claims。omission = no evidence-supported supplement claim for this field/preserve Existing，不表示 REMOVE。只输出层级 transport grammar 和 semantic exact field labels，不输出 JSON、delta、Patch v2 operation、target、path、classification、old_value 或解释。'

export const WORLD_MODEL_PATCH_V2_OUTPUT_CONTRACT = [
  'Output Grammar：只输出一个单次响应的层级标签文本；不得输出 JSON、Markdown fence、额外 discovery section、Candidate wrapper、Patch v2 operation、target、path、classification、old_value 或解释。顺序必须是 [World Model Supplement] → [World Model] → corresponding closing tags。',
  '[World Model Supplement]\n[World Model]\n[Species]\nSpecies: Species-A\n[Biological Type]\nBiological_Type: Type-B\n[/Biological Type]\n[/Species]\n[/World Model]\n[/World Model Supplement]',
  'Complete Evidence-Supported Candidate 是唯一 AI transport tree；它只包含相对完整 Existing 缺失或由 permitted evidence 明确支持的 correction claims。Existing 相同 known fact 不输出；程序负责 exact Existing comparison、ADD/CHANGE/NO-OP classification 与 Patch v2 派生。',
  '层级只允许 World Model → Species → Biological Type → Details；同一 Species 只使用一个 block。所有 opening/closing tags 与 parser stack 是唯一 ownership signal；indentation 不参与语义；不允许 implicit close、cross-scope re-parent、fuzzy alias、snake_case alias 或未定义标签。',
  'Allowed tags 只包括 [World Model Supplement]、[World Model]、[Species]、[Biological Type]、[Capabilities]、[Reproduction Rules]、[Lifecycle]、[Reproductive Mechanisms]、[Mechanism]、[Special Rules]、[Rule]、[Medical Context]、[Exceptions]、[Exception]、[Unknowns]、[Unknown]、[Projection Rules]、[Projection Rule] 及对应 closing tags。',
  `Complete Evidence-Supported Candidate grammar（每个 section 只允许下列 exact labels；不得创建未列出的字段；unsupported field 必须省略；不要为了让 section 完整而补字段）：
[Species]
Species: ...
Species_Description: ...
[/Species]
[Biological Type]
Biological_Type: ...
Type_Description: ...
[/Biological Type]
[Capabilities]
Can_Produce_Sperm: true|false
Can_Produce_Ova: true|false
Can_Be_Fertilized: true|false
Can_Fertilize: true|false
Can_Cause_Pregnancy: true|false
Can_Carry_Pregnancy: true|false
[/Capabilities]
[Reproduction Rules]
Fertilization: ...
Pregnancy_Or_Carrying: ...
Cycle: ...
Ovulation: ...
Gestation: ...
Labor: ...
[/Reproduction Rules]
[Lifecycle]
Maturation: ...
Aging: ...
[/Lifecycle]
[Mechanism]
Mechanism_Key: ...
Mechanism_Label: ...
Mechanism_Pathway: ...
Carrying_Compatibility: true|false
World_Model_Rule_Refs: [...]
Evidence: [...]
[/Mechanism]
[Rule]
Rule: ...
[/Rule]
[Medical Context]
Childbirth_Difficulty: ...
Care_Level: ...
Evidence: ...
[/Medical Context]
[Exception]
Exception_Statement: ...
Applies_To: ...
Evidence: ...
[/Exception]
[Unknown]
Unknown_Fact: ...
[/Unknown]
[Projection Rule]
JSON: {"schema_version":1,...}
[/Projection Rule]
Projection Rule 唯一允许的 representation 是单个 JSON object 的 JSON: 行；不得输出 projection_rule_id，不得在 Projection Rule 内使用 Name/Description 或其它逐字段标签。`,
  'Field labels 只能使用上述 exact underscore semantic tokens：Species、Species_Description、Biological_Type、Type_Description、Can_Produce_Sperm、Can_Produce_Ova、Can_Be_Fertilized、Can_Fertilize、Can_Cause_Pregnancy、Can_Carry_Pregnancy、Pregnancy_Or_Carrying、Mechanism_Key、Mechanism_Label、Mechanism_Pathway、Carrying_Compatibility、World_Model_Rule_Refs、Childbirth_Difficulty、Care_Level、Applies_To、Exception_Statement、Unknown_Fact，以及允许保留的单词 labels。不得使用旧 space labels、Name、Description、Value、Key、Label、Pathway、Statement 或 snake_case internal-field aliases；unsupported field 必须省略。Projection Rule 只允许一个 JSON object 的 JSON: line；boolean 只允许 true|false。malformed identity/hierarchy fail closed；leaf error 可在 ownership unambiguous 的最小 subtree 内 fail-soft。字段 absent = no claim/preserve Existing；不得用 null、false 或 empty collection 表示删除。Patch v2 是 internal deterministic IR，不由 AI 输出。',
].join('\n')

export function buildWorldModelMessages(
  analysisInput = {},
  promptSettings = {},
) {
  const settings = normalizeAnalysisPrompt(promptSettings)
  const input =
    analysisInput && typeof analysisInput === 'object' ? analysisInput : {}
  const names = inputNames(input)
  const messages = []
  addMessage(messages, 'system', expandPlaceholders(settings.system_top, names))
  addMessage(messages, 'system', formatWorldModelRules(settings, names))
  addMessage(messages, 'system', formatWorldModelReferences(input, names))
  addMessage(
    messages,
    'assistant',
    formatNarrativeContext(input.recent_story?.items, null, names),
  )
  addMessage(
    messages,
    'user',
    '请根据以上资料完成 World Model 分析，并只输出符合约定的结构化对象。',
  )
  addMessage(
    messages,
    'system',
    expandPlaceholders(settings.system_bottom, names),
  )
  return messages
}

export function buildWorldModelPatchMessages(
  analysisInput = {},
  promptSettings = {},
) {
  const settings = normalizeAnalysisPrompt(promptSettings)
  const input = analysisInput && typeof analysisInput === 'object' ? analysisInput : {}
  const names = inputNames(input)
  const messages = []
  addMessage(messages, 'system', expandPlaceholders(settings.system_top, names))
  addMessage(messages, 'system', joinPromptSections([
    `【BioWeave World Model Patch 分析规则】\n${WORLD_MODEL_CORE_INSTRUCTIONS}`,
    formatCommonAnalysisPrompt(settings, names),
    `【World Model Patch 任务】\n${WORLD_MODEL_PATCH_TASK_PROMPT}`,
    formatAnalysisPromptTail(settings, names),
    `【World Model Patch 输出契约】\n${WORLD_MODEL_PATCH_OUTPUT_CONTRACT}`,
  ]))
  addMessage(messages, 'system', formatWorldModelPatchReferences(input, names))
  addMessage(messages, 'assistant', formatNarrativeContext(input.recent_story?.items, null, names))
  addMessage(messages, 'user', formatWorldModelPatchUserMessage(input, names))
  addMessage(messages, 'system', expandPlaceholders(settings.system_bottom, names))
  return messages
}

export function buildWorldModelPatchMessagesV2(
  analysisInput = {},
  promptSettings = {},
) {
  const settings = normalizeAnalysisPrompt(promptSettings)
  const input = analysisInput && typeof analysisInput === 'object' ? analysisInput : {}
  const names = inputNames(input)
  const messages = []
  addMessage(messages, 'system', expandPlaceholders(settings.system_top, names))
  addMessage(messages, 'system', joinPromptSections([
    `【BioWeave World Model Supplement v3 Evidence Candidate 正式分析规则】\n${WORLD_MODEL_PATCH_V2_TASK_PROMPT}`,
    `【World Model Supplement v3 输出契约】\n${WORLD_MODEL_PATCH_V2_OUTPUT_CONTRACT}`,
  ]))
  addMessage(messages, 'system', formatWorldModelPatchReferences(input, names))
  addMessage(messages, 'assistant', formatNarrativeContext(input.recent_story?.items, null, names))
  addMessage(messages, 'user', formatWorldModelPatchUserMessage(input, names, { evidenceFirst: true, supplementReference: true }))
  addMessage(messages, 'system', expandPlaceholders(settings.system_bottom, names))
  return messages
}

export function buildEventAnalysisMessages(
  analysisInput = {},
  promptSettings = {},
) {
  const input = normalizeEventAnalysisInput(analysisInput)
  const settings = normalizeAnalysisPrompt(promptSettings)
  const names = inputNames(input)
  const messages = []
  addMessage(messages, 'system', expandPlaceholders(settings.system_top, names))
  addMessage(
    messages,
    'system',
    formatEventAnalysisRules(input, settings, names),
  )
  addMessage(messages, 'system', formatEventAnalysisReferences(input, names))
  addMessage(
    messages,
    'assistant',
    formatNarrativeContext(
      input.recent_story?.items ?? input.recent_context,
      input.current_floor,
      names,
      input.story_time,
    ),
  )
  addMessage(
    messages,
    'user',
    '请根据以上资料分析 narrative discovery window（Current Target Floor 与 Recent Story），只返回符合 Event Analysis 输出契约的完整固定 JSON 对象，不要输出其它文字。',
  )
  addMessage(
    messages,
    'system',
    expandPlaceholders(settings.system_bottom, names),
  )
  return messages
}

export function buildPrompt({
  task,
  customPrefix = '',
  taskCustom = '',
  worldbook = '',
  character = '',
  story = '',
  current = '',
  schema = '',
  customSuffix = '',
}) {
  return [
    ['CORE', CORE_PROMPTS[task]],
    ['CUSTOM PREFIX', customPrefix],
    ['TASK CUSTOM', taskCustom],
    ['WORLDBOOK', worldbook],
    ['CHARACTER', character],
    ['STORY', story],
    ['CURRENT BIOWEAVE', current],
    ['OUTPUT SCHEMA', schema],
    ['CUSTOM SUFFIX', customSuffix],
  ]
    .filter(([, value]) => String(value ?? '').trim())
    .map(([key, value]) => `## ${key}\n${value}`)
    .join('\n\n')
}
// 构造最小 World Analysis 请求，不复用会引入其他业务约束的复杂 Prompt Pipeline。
export function buildWorldModelPrompt(analysisInput = {}, promptSettings = {}) {
  return buildWorldModelMessages(analysisInput, promptSettings)
    .map((message) => message.content)
    .join('\n\n')
}

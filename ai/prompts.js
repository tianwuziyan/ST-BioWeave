import {
  normalizeAnalysisPrompt,
  WORLD_MODEL_SCHEMA,
} from '../storage/schema.js'
import {
  CAPABILITY_KEYS,
  CONCEPTION_RELEVANT_EXPOSURE_EVIDENCE_KIND,
  EVENT_STATUS as DOMAIN_EVENT_STATUS,
  EVENT_TYPES as DOMAIN_EVENT_TYPES,
  REPRODUCTIVE_ROLES,
  STORY_TIME_PRECISIONS,
} from '../core/events.js'
import { normalizeEventAnalysisInput } from './input-builder.js'
export { WORLD_MODEL_SCHEMA }
export const CORE_PROMPTS = {
  world:
    'Analyze world rules into the required JSON schema. Unknown facts remain unknown.',
  event:
    'Extract biological facts from the target Floor Version. Do not convert symptoms into confirmed pregnancy.',
  projection:
    'Generate non-factual future possibilities only. Never rewrite history.',
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
  '重点识别 sexual_activity，但必须兼容其它 BiologicalEvent 类型（包括 medical_event、physical_symptom、conception、pregnancy_suspicion、pregnancy_confirmation、pregnancy_loss、labor、delivery、postpartum、menstrual_event、ovulation_event、fertility_change、abortion、other_biological）。不要把所有事件强行分类为 sexual_activity。',
  '一个 Target Floor Version 可以输出 0、1 或 N 个彼此独立的 BiologicalEvent；不要为了满足单 Event 限制而把不同生物事实或不同 gestational subject 的暴露压进同一个 Event，也不要在 Runtime 或 UI 合并事件。',
  '对 pregnancy-related sexual_activity，先识别当前 Floor 中所有有实际 conception-relevant exposure 的 gestational subject，再按 subject 分组：同一 subject 的多个 actual exposure source 合并到同一个 Event，不同 subject 必须输出不同 Event；同一响应中同一 subject 最多出现一个 pregnancy-related Event，不能把多个 subject 填进同一个 Event。',
  'recipient discovery 必须 exhaustive：先完整扫描整个 Target Floor，建立临时 exposure candidate 集合，收集全部 actual pregnancy-relevant exposure recipients，再对集合中的每个 recipient 依次执行 identity resolution、World Model mapping、capability resolution 与 eligibility decision。不得因 Persona、current user、current Character Card、existing profile、首个 eligible recipient，或某个 recipient 为 false/unknown 而提前 return、break、跳过后续扫描；character_context 只提供上下文，不是 participant whitelist，也不赋予任何扫描优先级；首次在当前 narrative 出现的对象也可以进入分析，但不得由模型自行创造永久 character_id。',
  'character_id 是 Runtime/Plugin 管理的 canonical entity identifier，不是姓名、拼音、romanization、lowercase、snake_case、slug、翻译、hash 或缩写的格式化结果。raw AI response 中的 new/unresolved 只能使用 character_id:null；只有 Runtime 完成 identity resolution 后，canonical Event 才会拥有正式 character_id。existing participant 只能原样引用输入 character_registry 中的 canonical character_id；new/unresolved 必须使用当前完整 response 内唯一、无业务语义的 response-local mention_id（如 mention_1），existing 的 mention_id 必须为 null。模型只判断 mention 指向谁，Runtime 才创建、校验和持久化实体 ID；不确定同名、同音、同 alias 或别名归属时必须返回 unresolved。',
  '正式 character_id 只由 Runtime 创建和验证；模型不需要知道、预测或自行生成正式 ID。existing 必须复制输入 Registry 实际提供的 canonical character_id，new 必须返回 character_id:null，绝不能自行生成永久 ID。',
  'identity_status=new 表示 narrative 明确出现了此前未登记的实体；如果 display_name 或 alias 命中已有 registry candidate，不能仅凭名称复用或创建，除非 narrative 明确说明这是另一个人物，并在 identity_evidence 使用 explicit_new_entity 等证据类型，否则返回 unresolved。',
  '如果 narrative 明确揭示真名、化名、改名或“此前称呼”与当前人物是同一人，existing mention 必须继续引用原有 canonical character_id，并通过 identity_evidence 表达明确的 name revelation；不得因为 display_name 改变而创建新的 character_id。',
  '每个 pregnancy-related sexual_activity Event 必须保持 subject-local：gestational_subject_ids[] 恰好一个，counterpart_ids[] 至少一个，participants[] 的 ID 集合恰好等于该 subject 与这些 actual exposure source 的并集；不重复、不让 subject 出现在 counterpart、不混入另一 subject 的 source 或仅在场对象。',
  '同一 subject 的 Event 可合并其多个 actual exposure source、即时症状、physical effect、直接身体反应与相关证据；不同的独立 physical_symptom、medical_event 或其它 BiologicalEvent 可以在同一 Floor 并存。普通送汤、食物、补品、饮料、照顾或休息建议不单独成 Event，静态外貌、体质、长期设定和人物描写没有本楼新变化时不产生 physical_symptom。',
  '只有明确的医疗检查、诊断、治疗、给药、干预或医学监测才允许唯一的 medical_event；普通送汤、食物、补品、饮料、照顾或休息建议不单独成 Event。外貌、体质、长期设定和静态人物描写没有本楼新变化时不产生 physical_symptom。',
  '对 sexual_activity 只提取实际 conception-relevant reproductive exposure 链中的直接参与者：实际承载暴露的 gestational subject 与实际造成暴露的 conception source。不要把仅在场、普通性伴侣、能力具备者、保护动作参与者或未进入有效路径的对象加入 participants；参与者使用已由 Runtime 提供或后续分配的 canonical character_id，姓名只作为 display_name。',
  '仅对 event.type === "sexual_activity" 且 pregnancy_relevance.relevant === true、possible_conception === true 的 pregnancy-related Event 强制要求 participant biological_context：该 Event 的每个 participant 都必须包含 biological_context 对象，且必须有 species 与 biological_type 两个字段；两个值只能是非空字符串或 null，资料不足时填 null。species 来自当前 World Model；biological_type 是该 species 下稳定的生理/生殖分类。允许综合 Character Card、Persona、Worldbook、Narrative、Existing profile、稳定设定、身体结构/生理/生殖事实与多条一致上下文，把对象映射到当前 World Model 的 species/type；明确 identity、高度一致的稳定生理证据或明确的生理性别事实，都可以作为 biological_type 映射证据之一。生理性别只参与 identity/type 映射，不能单独授权 capability。姓名、称谓、event_role、性行为位置、主动/被动、社会身份、穿着、气质和单一外貌只能作为综合上下文，任一单一弱线索不能独立决定 species、biological_type 或 capability；证据不足或冲突时保留 null 并让候选进入 pending，不得让候选消失。',
  'exposure recipient、exposure source 与是否构成 actual pregnancy-relevant exposure，必须由当前 World Model、匹配 species/type 的 reproduction_rules/capabilities 与 Narrative evidence 共同决定；不要把任何一种现实物种、性别、解剖结构、行为位置、接触方式或其它单一现实生殖机制硬编码成所有世界的必要条件。只有当前世界规则与目标楼层证据共同支持有效生殖路径时，才提取对应 recipient 与直接 source；possible_conception 只表示本次暴露具有潜在受孕相关性，不表示 actual conception 或 pregnancy。',
  '对其它 BiologicalEvent 类型，participants 只保留对该生物事实有直接作用的对象；在场、说话、被提及或普通递送行为不能自动成为参与者。',
  '同时阅读 World Model baseline 与当前 Floor / recent_context 的 narrative evidence。World Model baseline 只提供已知生物学能力背景，narrative evidence 只记录本次剧情事实；二者不能互相臆造或跨角色借证。',
  'participant capability 判断顺序固定为：先参考 current World Model 的匹配 species/type baseline，再参考 existing character profile，然后综合 Character、Persona、Worldbook、稳定设定、身体/生理/生殖事实与 current narrative evidence；个体明确证据可以覆盖或补充 baseline，未知字段保持 null。明确的生理性别事实只能作为 biological_type 映射的上下文证据，不能单独授权或补齐 capability。biological_context 只记录本次 capability 判断所采用的生物身份背景；不能根据角色、位置、主动/被动、姓名、外貌或性别补齐完整 capability 套装。',
  'event_role 与 gender/生理性别/biological_type 是不同字段。明确生理性别可以参与 identity/type 映射，但不能单独授权 capability；只能依据 current World Model baseline、个体 capability 证据与本次事件证据填写 reproductive role。不得从 gender、性别词、攻受、姓名、外貌或社会角色单独推导 can_carry_pregnancy、can_cause_pregnancy 或其它 capability。不要添加 gender eligibility 分支。',
  'reproductive_capabilities_used 固定包含 can_produce_sperm、can_produce_ova、can_be_fertilized、can_carry_pregnancy、can_cause_pregnancy；每个值只能是 true、false 或 null。null 表示未知/没有证据，禁止把 unknown、缺失、模糊描述或模型常识自动变成 true。',
  'pregnancy_relevance.gestational_subject_ids[] 与 counterpart_ids[] 在最终 Event 中永远是 Runtime 已验证的 canonical character_id 数组；raw response 可以用 participant mention_id 引用尚未注册的新人物，不能输出姓名、逗号拼接字符串或模型伪造的永久 ID。',
  'mention resolution、alias discovery、alias persistence 是三个不同动作。当前 mention 解析到某个 entity 不会自动把该称呼写入 aliases；正文中 display_name 与另一个称呼同时出现、连续性推断或单次高置信度判断都不是 alias establishment evidence。只有“以后叫我 X”“小名是 X”“众人都称她为 X”等明确命名证据才可以返回 alias_candidate；关系称谓、泛称和代词只用于当前上下文，绝不能作为永久 alias。alias 精确匹配只能提供完整 candidate set，不能 first-match-wins；多候选且无法可靠消歧时返回 unresolved。',
  '不要因为 NSFW、性交、体液、症状、恶心、腹痛或其它 physical_symptom 自动判定 conception 或 pregnancy；只有 World Model baseline 与 narrative evidence 共同明确支持时才填写 possible_conception 或 pregnancy relevance。',
  '不要把 UI 显示、人物列表或其它后续层的判断写入结果；UI 不会也不应二次判断生殖资格。输出的是完整事实 DTO。',
].join('\n')

export const EVENT_ANALYZER_TASK_CONTRACT = [
  '任务：只分析【本次目标楼层】中实际发生或有可靠证据支持的 BiologicalEvent，并返回完整 events 数组；events[] 允许为空、包含一个或包含多个彼此独立的 Event。',
  '开始生成 pregnancy-related sexual_activity Event 前，必须先扫描完整目标楼层的全部 narrative evidence，临时收集所有 actual pregnancy-relevant exposure recipients；随后对每个 candidate 独立完成 exposure、identity、World Model mapping、capability 与 eligibility 判断。明确生理性别可作为 biological_type 映射证据之一，但不能单独授权 capability；能力仍须由匹配的 World Model baseline 或明确的个体生理/生殖能力证据支持。不得因 user/Persona/current Character、已有 profile、首个 eligible，或任何 false/unknown candidate 中途停止；character_context 不是 whitelist，首次出现的 narrative character 也不能被漏掉。',
  '对 pregnancy-related sexual_activity，按唯一 gestational subject 分组；同一 subject 的多个 actual exposure source 必须合并成一个 subject-local Event，不同 subject 必须拆成不同 Event；输出前不得让同一 subject 重复出现，必须将该 subject 的 actual sources 合并到一个 Event。',
  '每个 pregnancy-related Event 只能有一个 gestational subject、至少一个 counterpart source，participants[] 只能是该 subject 与该 Event 实际 exposure sources，不能加入另一 subject、另一 Event 的 source、在场者或无 actual exposure 的 participant。',
  '同一 subject Event 内合并直接相关的即时症状、physical effects 和证据；独立的新 physical symptom、明确医疗检查/诊断/治疗/给药/干预/医学监测或其它独立 BiologicalEvent 可在同一 Floor 单独输出。普通补品、食物、饮料、送汤、照顾、休息建议、外貌、体质或静态人物设定都不单独形成 Event。',
  'Recent Story 只作为前置剧情参考；目标楼层是本次事件事实的唯一直接提取对象。',
  '不要把预测、症状或可能性写成已经发生的受孕或妊娠事实。',
].join('\n')

export const EVENT_ANALYZER_OUTPUT_CONTRACT = [
  '只输出一个完整、可直接 JSON.parse 的 JSON 对象，不要 Markdown、代码围栏、前后解释或半结构化文本。顶层固定为 {"schema_version":1,"events":[]}；唯一允许的旧兼容顶层字段是会被忽略的 source，任何其它未知顶层字段都必须拒绝。',
  '一个 Target Floor Version 的 events[] 允许是 []、[一个 Event] 或包含多个 Event；每个数组成员是一个独立生物事实，不要使用 type 数组或拼接 type 表达多个事实。',
  '输出前必须完成完整 Target Floor exhaustive scan：先把全部 actual pregnancy-relevant exposure recipients 放入临时 candidate 集合，再逐 recipient 解析 identity、World Model species/type、capability 与三态 eligibility；不得因 user/Persona/current Character、character_context、已有 profile、首个 eligible 或某个 false/unknown recipient 而提前结束。character_context 不是 whitelist，首次出现的 narrative character 也必须按同一规则处理。',
  'pregnancy-related sexual_activity 必须按唯一 gestational subject 分组：同一 subject 的多个 actual exposure sources 合并为一个 Event，不同 subject 输出不同 Event；同一响应/Floor 中同一 subject 只能出现一次，不能由 Runtime 自动合并重复 subject Event。',
  '每个 pregnancy-related sexual_activity Event 的 subject-local 结构必须满足：gestational_subject_ids.length===1；counterpart_ids.length>=1；唯一 subject 与 counterpart_ids[] 中每个 source 都在 participants[]；participants[] 的 ID 集合严格等于 subject 与 counterpart_ids[] 的并集；所有 ID 不重复，subject 不得出现在 counterpart_ids[]。counterpart_ids[] 只记录对该 subject 造成 actual conception-relevant exposure 的 source，不记录另一 subject、另一 Event 的 source、在场者、普通 sexual participant 或无有效路径对象。',
  '同一 subject Event 合并直接相关的即时症状、physical effect、直接身体反应和证据；独立的 physical_symptom、medical_event 或其它 BiologicalEvent 可以在同一 Floor 并存。实际 pregnancy-relevant sexual exposure 使用 sexual_activity；普通补品、食物、饮料、照顾、休息建议、外貌、体质和静态人物描写不单独输出 Event。',
  'AI Event DTO 不生成 event_id 或 source；它们不是 AI 事实字段。Runtime 会按响应顺序生成 deterministic、同一响应内唯一且不依赖 display_name 的 event_id，并强制绑定 authoritative Floor Version。若兼容旧响应而出现 event.event_id、event.source，它们会被忽略，不能覆盖 Runtime 身份。',
  `event.type 只能取：${EVENT_TYPES.join('、')}。event.status 只能取：${EVENT_STATUS.join('、')}。不得创造其它枚举值。`,
  `story_time 必须是结构化对象：display、normalized、calendar_id、day_index、provider、precision、confidence；precision 只能取：${EVENT_STORY_TIME_PRECISIONS.join('、')}；不可靠的 normalized/day_index 使用 null，不要从模糊 display 伪造日期。`,
  'story_time.day_index 只有在证据提供真实、连续且可排序的 canonical index 时才能填写 number；否则必须是 null。不要把月内第几日或 display 文本解析成 day_index，时间计算不读取 display。',
  'location 固定为 string | null；已知地点必须保留 narrative、Target Floor、Recent Context 或 Worldbook 中出现的原始文字和原始语言，例如“传灯院”仍输出“传灯院”；不得拼音化、romanize、翻译、snake_case、slugify 或 ASCII 化。无法可靠确定时使用 {"location": null}；禁止地点对象或数组。',
  `participants 必须是直接相关对象数组；对 sexual_activity 只保留 actual reproductive exposure chain 的 subject 与实际 exposure source，对其它 BiologicalEvent 只保留直接作用对象。每项包含 identity_status、character_id、mention_id、display_name、event_role、reproductive_capabilities_used 和 evidence；identity_status 只能是 existing、new 或 unresolved。existing 只能原样引用 character_registry 中的 ID，且 mention_id 必须为 null；new/unresolved 的 character_id 必须为 null，并使用当前完整 raw response 内唯一、无语义的 mention_N（如 mention_1）供内部引用。只有 Runtime 完成 identity resolution 后，最终 Event 才能保存 canonical character_id。仅对 event.type === "sexual_activity" 且 pregnancy_relevance.relevant === true、possible_conception === true 的 pregnancy-related Event，每个 participant 还必须包含 biological_context 对象，固定包含 species 与 biological_type 两个字段，值只能是非空字符串或 null，未知填 null。identity 可以由明确标签、多条一致的稳定生理/生殖上下文或明确生理性别事实映射到当前 World Model；生理性别只能作为 biological_type 映射证据之一，不能单独授权 capability。姓名、称谓、event_role、性行为位置、主动/被动、社会身份、穿着、气质和单一外貌不能单独决定身份或能力，冲突/不足时保持 null。event_role 只能取：${EVENT_REPRODUCTIVE_ROLES.join('、')}。它表示本事件中的生殖角色，不表示姿势、主动/被动、攻/受、职业、性别或社会角色。`,
  `capability 判断顺序固定为：current World Model 的匹配 species/type baseline → existing character profile → Character / Persona / Worldbook / current narrative evidence；明确生理性别只能参与 biological_type 映射，不能单独授权或补齐 capability；个体明确证据可覆盖或补充 baseline，未知 capability 保持 null。reproductive_capabilities_used 固定包含 ${EVENT_CAPABILITY_KEYS.join('、')}；每个值只能是 true、false 或 null。`,
  'participant.evidence 与 source_evidence 都必须是数组；每项必须是 {"kind":"...","text":"..."} 对象，kind 和 text 都是非空字符串。不得输出裸字符串、content 替代 text 或其它 evidence 形状。',
  `每个 event 必须包含 type、status、story_time、location、participants、pregnancy_relevance、source_evidence；physical_effect 是可选对象，其中 gestational_substance_intake 只能是 true、false 或 null。`,
  'pregnancy_relevance 必须包含 relevant、possible_conception、gestational_subject_ids[]、counterpart_ids[]、confidence；relevant 与 possible_conception 都只能是 boolean，不能是 null、字符串或 probable/possible/unknown。两个 ID 字段始终是数组，可为空、单个或多个；不能是字符串。对于 pregnancy-related sexual_activity，subject 数组必须恰好一个，counterpart 数组必须至少一个，并遵守 subject-local participants 闭包。',
  `没有 actual reproductive exposure 的 sexual_activity 必须使用 participants=[]、relevant=false、possible_conception=false、gestational_subject_ids=[]、counterpart_ids=[]；如果没有其它独立生物学价值，可以不输出该 Event。possible_conception=true 时必须有非空 subject/source ID 数组，两个数组中的 ID 必须来自 participants，且 participants 只能包含这些 subject/source，source_evidence[] 必须包含 kind 为 ${CONCEPTION_RELEVANT_EXPOSURE_EVIDENCE_KIND} 的结构化证据。`,
  'physical_effect.gestational_substance_intake=true 只能在 narrative evidence 明确支持 actual reproductive exposure 时填写，并必须与 pregnancy_relevance 保持一致；不要把该字段单独当作受孕结论。',
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
  '【0. 总原则 / Analysis Order】任务：从本次 AnalysisInput 提取当前 Chat 的生物学 World Model，只输出资料实际支持的 species、biological_type、能力和规则，不使用模型常识补写。严格按顺序执行：1) Species Discovery；2) Biological Type Discovery；3) Baseline / Origin / Transformation；4) Field Evidence；5) Reproduction / Lifecycle；6) Temporary / Exceptions / Unknowns；7) Final Self-check。前层未知不代表后层不存在，后层资料不足也不能删除前层已可靠建立的实体。',
  '【1. Species Discovery】在分析任何 biological_type、capability、reproduction_rules 或 lifecycle 前，必须 exhaustive scan（完整扫描）整个 AnalysisInput，建立全部有可靠 existence evidence 的 species。species 回答“这是什么生物或稳定生命类别”；species existence 与 biological_type、capability、reproduction_rules、lifecycle 的完整程度独立。只要资料明确证明 species 存在就必须保留，不得因为 type 不完整、生殖机制未知、capability 未知、lifecycle 未知或资料较少而删除、遗漏或用 unknowns 替代；没有足够 type evidence 时输出 biological_types: []。',
  '【2. Biological Type Discovery】对每个已建立的 species 重新扫描完整 AnalysisInput，只寻找属于它的稳定生理、生殖或直接影响生殖机制的 biological classification；species 与 biological_type 是不同层级，按 species → biological_types → capabilities / reproduction_rules / lifecycle / special_rules 分层，名称保持开放字符串。候选必须同时满足 A–E：A. 明确绑定当前 species；B. 稳定存在而非一次性、条件性或临时状态；C. 直接涉及身体结构、生理机制、生殖角色或生殖能力；D. 去除职业、身份、社会角色、组织、文化群体、阵营、能力体系、等级/境界、成长阶段等非生物背景后仍成立；E. 当前 AnalysisInput 有充分直接证据或确定性低推理证据。稳定 biological classification 的 existence evidence 不要求原文显式命名该 classification：如果同一 species 的 species-wide 资料明确描述两种或多种稳定、互相可区分的 reproductive physiology / reproductive role / reproductive capability clusters，并能唯一映射为不同 biological classes，也属于确定性低推理 existence evidence；一组稳定证据指向 sperm-producing / fertilizing reproductive role、另一组稳定证据指向 ova-producing / pregnancy-carrying reproductive role 时，即使没有 male/female 标签，也可以使用证据最直接对应的简洁 canonical label（如“雄性”“雌性”或等价的稳定生殖分类名称）。原文无需提供 classification name，只要分类边界能由同一 species 的直接生理/生殖证据唯一确定即可建立；无法唯一确定边界时才不得创建。直接点名、数量/频率、对比、并存、例外语义均可作为证据；多数、少数、极少、少量、罕见、通常、也存在、除……外、例外等 type 不能因数量少或已有主要 type 而遗漏。只有一个稳定结构/角色 cluster 的证据时不得按常识补齐配对 type；同一稳定 type 明确同时具有这些结构或能力时不得强行拆分。可选 mutation、异常状态、职业/法术效果、个体差异或其它非 species-wide、非 type-level 证据不得拆分或升级 type，也不得跨 species 借证据；该规则不改变 §4：仅有 type 名称仍不能推 capability，Nonhuman 仍不使用 Human baseline。species、亚种或普通 taxonomy、血统/来源、职业/身份/组织/文化/阵营、能力体系、等级/境界、成长阶段、疾病/异常、个体特质/行为，以及临时或可逆状态（见 §6）都不是 type；不满足 A–E 就不建立，证据不足保持 biological_types: []，不得按常识补齐配对 type。固定双性分类统一使用名称“双性”。',
  '【3. Baseline / Origin / Transformation】Human species 与 Human biological_type 不同层级。Human species 可靠成立后，重新扫描完整 AnalysisInput：明确男性、女性、稳定双性（canonical “双性”）或其它满足 §2 A–E 的自定义分类才建立对应 type；其它稳定自定义分类不要求归入男性、女性或双性体系。“人类/普通人类”若只是重复 species 含义，不得作为 type 兜底。Human 是唯一内置现实生物 baseline，只能用于已经成立的普通 Human Male/Female，不创建缺失 type。普通 Human 支持可来自显式 Human/人类或 Character Card、Worldbook、Recent Story、External Memory、当前上下文合并后的可靠背景，不要求字面出现 Human/人类；独立 Nonhuman、陌生生命、不同生理体系、冲突证据或无法判断时禁止 fallback；没有 species、没有 Human 字样、类人外形、性别称谓、性交行为或社会结构单独都不充分。字段优先级为明确当前个体事实 > 明确 transformation/特殊体系规则 > 明确世界级规则 > Human baseline > unknown；delta 只覆盖明确改变的字段，其余稳定 baseline 保留。普通 Human Male 已知不适用的 pregnancy_or_carrying、cycle、ovulation、gestation、labor 写“无”，普通 Human Female 的 cycle、ovulation、gestation、labor 使用简洁 baseline；其它 Human type 不套用该 baseline。若资料证明当前 species/稳定形态来自已有类别的永久转化，来源中已成立且未被明确改变、替换或消除的稳定 type/字段可 continuity，明确 transformation delta 覆盖变化部分；已建立新 biological classification system 时使用新体系，来源不明时禁止 inheritance。个体来自 Human 不等于整个 species 有 Human origin，不得扩展为 species-wide 规则；只输出最终当前 species/type 与合成字段，不新增 source_species、origin、inheritance 字段。',
  '【4. Field Evidence】每个 species、biological_type 和字段独立举证，不跨 species/type 借证据。五个 capability（can_produce_sperm、can_produce_ova、can_be_fertilized、can_fertilize、can_carry_pregnancy）逐字段判断：明确具备为 true，明确不具备为 false，未说明/未知/证据不足为 null。生理性别事实可以支持 type 存在，但除已成立的 Human baseline 或可靠 continuity 外，不得从男性、女性、雄性、雌性等 type 名称直接推 capability；Nonhuman 不使用 Human template，即使类人、名称相同、器官相似或有性交行为，也必须依该 species/type 自身证据，未知保持 null。规则字段只有在明确不存在或不适用时写“无”，不能把未知写成“无”。',
  '【5. Reproduction / Lifecycle】reproduction_rules 与 lifecycle 的 string 字段中，null 表示未知、未提及、证据不足或无法判断；非空字符串表示资料支持机制存在；“无”只表示明确不存在、不具备或不适用。fertilization 只描述真实受精、授精或配子结合及当前 type 的供体/受体角色；性交、体液/能量交换、感染、寄生、侵蚀、异化、身体改造、觉醒、个体生成、力量变化或关系变化本身都不是 fertilization。gestation 只描述真实妊娠或孕育。lifecycle.maturation 只描述生物成熟或生命阶段变化，lifecycle.aging 只描述寿命、衰老或明确抗衰老生理；修炼境界、技能/力量 progression、职业/关系成长、觉醒流程、单纯 transformation/化形流程不得写入 lifecycle。资料只声明与人类相同，也只继承被声明的范围。',
  '【6. Temporary / Exceptions / Unknowns】临时、可逆或条件性的性征、器官、生殖能力或身体变化不得建立新的 biological_type，应保留在已有 type 的 special_rules、适当字段或全局 exceptions 中。medical_context、exceptions、unknowns 只记录 AnalysisInput 实际支持的内容；unknowns 只能表达真正未知的机制/字段，不能替代已知存在的 species/type。',
  '【7. Final Self-check】输出前内部检查，不输出过程：按 §1 检查 species completeness；按 §2 检查每个 species 是否遗漏 rare/minority/exception stable type 且所有 type 通过 A–E；按 §3 检查 Human/Nonhuman baseline 与 continuity；按 §4 检查 capability evidence；按 §5 检查 reproduction/lifecycle；按 §6 检查 temporary state、exceptions、unknowns；无可靠依据的字段保持 null。',
].join('\n')
// 只用普通文字描述输出字段，避免把格式围栏或大段 schema 代码发送给后端。
const WORLD_MODEL_OUTPUT_CONTRACT = [
  '只输出一个结构化对象，不要输出解释文字、Markdown 或代码围栏；schema_version 固定为 1。JSON key 使用 schema 规定的英文，说明、规则和列表字符串使用中文。',
  '顶层只包含 schema_version、species、medical_context、exceptions、unknowns；不得出现顶层 biological_types 或 species 级 capabilities。',
  'species[] 包含 name、description、biological_types[]；每个 biological_type 包含 name、description、capabilities、reproduction_rules、lifecycle、special_rules。',
  'capabilities 只能位于 biological_types 下，固定包含五个 key：can_produce_sperm、can_produce_ova、can_be_fertilized、can_fertilize、can_carry_pregnancy；值只能是 true、false 或 null。',
  'reproduction_rules 固定包含 fertilization、pregnancy_or_carrying、cycle、ovulation、gestation、labor；lifecycle 固定包含 maturation、aging。规则字段只能使用 null、非空中文描述或 canonical absence value“无”：null 是未知/证据不足，非空描述是已知存在，“无”是已知不存在/不适用；没有提到或无法判断时不要写“无”。其它未知标量为 null，列表为数组。',
  'medical_context 固定包含 childbirth_difficulty、care_level、evidence，均为 nullable string。',
  'exceptions 必须是 JSON 数组；每项必须是对象，固定包含 statement、applies_to、evidence，三者均为 nullable string。不得使用以实体名称为 key 的对象映射；没有例外时输出 []。',
  'unknowns 必须是 JSON 字符串数组，不得使用对象映射；没有未知项时输出 []。special_rules 必须是 JSON 字符串数组，没有特殊规则时输出 []。',
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
  for (const greeting of Array.isArray(character.greetings)
    ? character.greetings
    : []) {
    addBlock(
      lines,
      greeting?.is_current ? '开场信息（当前）' : greeting?.label || '开场信息',
      greeting?.content,
      names,
    )
  }
  if (!lines.length) return ''
  return [
    `【角色卡：${names.characterName} 的背景资料】`,
    '以下内容来自当前角色卡中用户允许 BioWeave 读取的字段，仅作为本次分析的背景资料与证据参考。角色卡未描述的内容不能因此自动视为已知事实。',
    lines.join('\n\n'),
  ].join('\n')
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
  const provider = expandPlaceholders(storyTime.provider, names)
  const hasKnownValue = Boolean(
    display ||
    normalized ||
    calendarId ||
    provider ||
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
    `提供者：${provider || '未知'}`,
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

function formatEventCharacterRegistry(registry, names) {
  const value =
    registry && typeof registry === 'object' && !Array.isArray(registry)
      ? registry
      : {}
  const entities =
    value.entities &&
    typeof value.entities === 'object' &&
    !Array.isArray(value.entities)
      ? value.entities
      : {}
  const blocks = Object.entries(entities)
    .map(([fallbackId, rawEntity]) => {
      const entity =
        rawEntity && typeof rawEntity === 'object' && !Array.isArray(rawEntity)
          ? rawEntity
          : {}
      const characterId = expandPlaceholders(
        entity.character_id ?? fallbackId,
        names,
      )
      if (!characterId) return ''
      const displayName = expandPlaceholders(entity.display_name, names)
      const aliases = Array.isArray(entity.aliases)
        ? entity.aliases
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
    ? '以下是 Runtime 已登记的 canonical identity candidates。character_id 是不透明、稳定且只读的实体 ID；existing 只能从这些 ID 中原样选择，且 mention_id 必须为 null，不能根据 display_name 或 alias 改写、翻译、拼音化或自行生成 ID。display_name/alias 只用于理解 mention，alias 可能属于多个实体，不能 first-match-wins。没有足够证据时请返回 unresolved；首次出现的新人物使用 identity_status=new、character_id=null 和本次完整 response 内唯一、无语义的 mention_N（如 mention_1），不得使用姓名、display_name、alias、拼音、canonical ID 或角色称谓作为 mention_id。'
    : '这是 Initial Registry Bootstrap：当前 character_registry.entities 为空，表示当前没有任何合法的 canonical identity candidate；本次 response 不存在合法的 identity_status=existing participant。此前未登记或无法解析的人物必须使用 identity_status=new 或 unresolved、character_id:null，以及当前完整 response 内唯一、无业务语义的 response-local mention_N（例如 mention_1；不要把 <当前人物显示名>、姓名、display_name、alias、拼音、canonical ID 或角色称谓用作 mention_id）。Runtime 会在 response 返回后分配正式 canonical ID；模型不需要知道、预测或输出正式 character_id。existing 的 mention_id 必须为 null；new/unresolved 必须返回 character_id:null。'
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

function formatEventCharacterContext(characterContext, names) {
  const value =
    characterContext &&
    typeof characterContext === 'object' &&
    !Array.isArray(characterContext)
      ? characterContext
      : {}
  const profiles =
    value.profiles &&
    typeof value.profiles === 'object' &&
    !Array.isArray(value.profiles)
      ? value.profiles
      : {}
  const profileBlocks = Object.entries(profiles)
    .map(([fallbackId, rawProfile]) => {
      const profile =
        rawProfile &&
        typeof rawProfile === 'object' &&
        !Array.isArray(rawProfile)
          ? rawProfile
          : {}
      const characterId = expandPlaceholders(
        profile.character_id ?? fallbackId,
        names,
      )
      if (!characterId) return ''
      const lines = [`角色标识：${characterId}`]
      const displayName = expandPlaceholders(profile.display_name, names)
      const species = expandPlaceholders(profile.species, names)
      const biologicalType = expandPlaceholders(profile.biological_type, names)
      if (displayName) lines.push(`显示名称：${displayName}`)
      if (species) lines.push(`物种：${species}`)
      if (biologicalType) lines.push(`生物类型：${biologicalType}`)

      const capabilities =
        profile.reproductive_capabilities ??
        profile.reproductive_capabilities_used
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

      const evidence = Array.isArray(profile.evidence)
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
      return lines.join('\n')
    })
    .filter(Boolean)
  const currentCharacter = expandPlaceholders(
    value.current_character ?? value.currentCharacter,
    names,
  )
  if (!currentCharacter && !profileBlocks.length) return ''
  return [
    '【事件相关角色参考】',
    '以下 character_context 内容来自 BioWeave 已建立的角色资料，仅作为角色身份和已知能力的语义背景证据参考；它不代表本次目标楼层已经发生了任何事件，也不是 canonical identity candidates 的白名单，不能替代上面的 Runtime Character Registry。',
    currentCharacter ? `当前角色显示名：${currentCharacter}` : '',
    profileBlocks.join('\n\n'),
  ]
    .filter(Boolean)
    .join('\n')
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
    formatEventCharacterRegistry(input.character_registry, names),
    formatEventCharacterReference(input, names),
    formatPersonaReference(input.persona, names),
    formatEventCharacterContext(input.character_context, names),
    formatWorldbookReference(input.worldbooks, names),
    formatExternalMemoryReference(input.external_memory, names),
    formatWorldModelReference(input.world_model),
    formatExistingBioWeaveReference(input.existing_bioweave),
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
    '请根据以上资料分析本次目标楼层，只返回符合 Event Analysis 输出契约的完整固定 JSON 对象，不要输出其它文字。',
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

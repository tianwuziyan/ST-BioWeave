const TAGS = Object.freeze({
  world: 'World Model',
  species: 'Species',
  type: 'Biological Type',
  capabilities: 'Capabilities',
  reproduction_rules: 'Reproduction Rules',
  lifecycle: 'Lifecycle',
  mechanisms: 'Reproductive Mechanisms',
  mechanism: 'Mechanism',
  special_rules: 'Special Rules',
  rule: 'Rule',
  medical_context: 'Medical Context',
  exceptions: 'Exceptions',
  exception: 'Exception',
  unknowns: 'Unknowns',
  unknown: 'Unknown',
  projection_rules: 'Projection Rules',
  projection_rule: 'Projection Rule',
})

const FIELD_LABELS = Object.freeze({
  schema_version: 'Schema_Version',
  name: 'Name',
  description: 'Description',
  can_produce_sperm: 'Can_Produce_Sperm',
  can_produce_ova: 'Can_Produce_Ova',
  can_be_fertilized: 'Can_Be_Fertilized',
  can_fertilize: 'Can_Fertilize',
  can_cause_pregnancy: 'Can_Cause_Pregnancy',
  can_carry_pregnancy: 'Can_Carry_Pregnancy',
  fertilization: 'Fertilization',
  pregnancy_or_carrying: 'Pregnancy_Or_Carrying',
  cycle: 'Cycle',
  ovulation: 'Ovulation',
  gestation: 'Gestation',
  labor: 'Labor',
  maturation: 'Maturation',
  aging: 'Aging',
  key: 'Key',
  label: 'Label',
  pathway: 'Pathway',
  carrying_compatibility: 'Carrying_Compatibility',
  world_model_rule_refs: 'World_Model_Rule_Refs',
  evidence: 'Evidence',
  statement: 'Statement',
  applies_to: 'Applies_To',
  childbirth_difficulty: 'Childbirth_Difficulty',
  care_level: 'Care_Level',
  value: 'Value',
  json: 'JSON',
})

const TRANSPORT_FIELD_LABELS = Object.freeze({
  [`${TAGS.species}:name`]: 'Species',
  [`${TAGS.species}:description`]: 'Species_Description',
  [`${TAGS.type}:name`]: 'Biological_Type',
  [`${TAGS.type}:description`]: 'Type_Description',
  [`${TAGS.mechanism}:key`]: 'Mechanism_Key',
  [`${TAGS.mechanism}:label`]: 'Mechanism_Label',
  [`${TAGS.mechanism}:pathway`]: 'Mechanism_Pathway',
  [`${TAGS.rule}:value`]: 'Rule',
  [`${TAGS.exception}:statement`]: 'Exception_Statement',
  [`${TAGS.exception}:applies_to`]: 'Applies_To',
  [`${TAGS.unknown}:value`]: 'Unknown_Fact',
})

const TAG_BY_NAME = new Map(Object.values(TAGS).map((tag) => [tag, tag]))
const FIELD_KEY_BY_LABEL = new Map(Object.entries(FIELD_LABELS).map(([key, label]) => [label, key]))
const TRANSPORT_KEY_BY_LABEL = new Map(Object.entries(TRANSPORT_FIELD_LABELS).map(([key, label]) => [key.split(':')[0] + ':' + label, key.split(':')[1]]))
const BOOLEAN_FIELDS = new Set([
  'can_produce_sperm',
  'can_produce_ova',
  'can_be_fertilized',
  'can_fertilize',
  'can_cause_pregnancy',
  'can_carry_pregnancy',
  'carrying_compatibility',
])
const CAPABILITY_FIELDS = new Set([
  'can_produce_sperm',
  'can_produce_ova',
  'can_be_fertilized',
  'can_fertilize',
  'can_cause_pregnancy',
  'can_carry_pregnancy',
])
const RULE_FIELDS = new Set([
  'fertilization',
  'pregnancy_or_carrying',
  'cycle',
  'ovulation',
  'gestation',
  'labor',
])
const LIFECYCLE_FIELDS = new Set(['maturation', 'aging'])
const MEDICAL_FIELDS = new Set(['childbirth_difficulty', 'care_level', 'evidence'])
const MECHANISM_FIELDS = new Set(['key', 'label', 'pathway', 'carrying_compatibility', 'world_model_rule_refs', 'evidence'])
const EXCEPTION_FIELDS = new Set(['statement', 'applies_to', 'evidence'])
const SECTION_FIELDS = Object.freeze({
  [TAGS.world]: new Set(['schema_version']),
  [TAGS.species]: new Set(['name', 'description']),
  [TAGS.type]: new Set(['name', 'description']),
  [TAGS.capabilities]: CAPABILITY_FIELDS,
  [TAGS.reproduction_rules]: RULE_FIELDS,
  [TAGS.lifecycle]: LIFECYCLE_FIELDS,
  [TAGS.mechanism]: MECHANISM_FIELDS,
  [TAGS.rule]: new Set(['value']),
  [TAGS.medical_context]: MEDICAL_FIELDS,
  [TAGS.exception]: EXCEPTION_FIELDS,
  [TAGS.unknown]: new Set(['value']),
  [TAGS.projection_rule]: new Set(['json']),
})

function quote(value) {
  if (value === undefined) return ''
  if (value === null) return 'null'
  if (typeof value === 'string') return value.includes('\n') ? JSON.stringify(value) : value
  return JSON.stringify(value)
}

function field(lines, key, value, section = null) {
  if (value === undefined) return
  const label = TRANSPORT_FIELD_LABELS[`${section ?? ''}:${key}`] ?? FIELD_LABELS[key] ?? key
  lines.push(`${label}: ${quote(value)}`)
}

function open(lines, tag) { lines.push(`[${tag}]`) }
function close(lines, tag) { lines.push(`[/${tag}]`) }

function formatMechanism(lines, mechanism) {
  open(lines, TAGS.mechanism)
  for (const key of ['key', 'label', 'pathway', 'carrying_compatibility', 'world_model_rule_refs', 'evidence']) field(lines, key, mechanism?.[key], TAGS.mechanism)
  close(lines, TAGS.mechanism)
}

function formatProjectionRule(lines, rule) {
  open(lines, TAGS.projection_rule)
  field(lines, 'json', rule)
  close(lines, TAGS.projection_rule)
}

export function formatWorldModelSupplementReference(worldModel) {
  const model = worldModel && typeof worldModel === 'object' && !Array.isArray(worldModel) ? worldModel : {}
  const lines = ['<existing_world_model_reference>', `[${TAGS.world}]`]
  field(lines, 'schema_version', model.schema_version)
  for (const species of Array.isArray(model.species) ? model.species : []) {
    open(lines, TAGS.species)
    field(lines, 'name', species?.name, TAGS.species)
    field(lines, 'description', species?.description, TAGS.species)
    for (const type of Array.isArray(species?.biological_types) ? species.biological_types : []) {
      open(lines, TAGS.type)
      field(lines, 'name', type?.name, TAGS.type)
      field(lines, 'description', type?.description, TAGS.type)
      open(lines, TAGS.capabilities)
      for (const key of CAPABILITY_FIELDS) field(lines, key, type?.capabilities?.[key])
      close(lines, TAGS.capabilities)
      open(lines, TAGS.reproduction_rules)
      for (const key of RULE_FIELDS) field(lines, key, type?.reproduction_rules?.[key])
      close(lines, TAGS.reproduction_rules)
      open(lines, TAGS.lifecycle)
      for (const key of LIFECYCLE_FIELDS) field(lines, key, type?.lifecycle?.[key])
      close(lines, TAGS.lifecycle)
      open(lines, TAGS.mechanisms)
      for (const mechanism of Array.isArray(type?.reproductive_mechanisms) ? type.reproductive_mechanisms : []) formatMechanism(lines, mechanism)
      close(lines, TAGS.mechanisms)
      open(lines, TAGS.special_rules)
      for (const value of Array.isArray(type?.special_rules) ? type.special_rules : []) {
        open(lines, TAGS.rule)
        field(lines, 'value', value, TAGS.rule)
        close(lines, TAGS.rule)
      }
      close(lines, TAGS.special_rules)
      close(lines, TAGS.type)
    }
    close(lines, TAGS.species)
  }
  open(lines, TAGS.medical_context)
  for (const key of MEDICAL_FIELDS) field(lines, key, model.medical_context?.[key])
  close(lines, TAGS.medical_context)
  open(lines, TAGS.exceptions)
  for (const exception of Array.isArray(model.exceptions) ? model.exceptions : []) {
    open(lines, TAGS.exception)
    for (const key of ['statement', 'applies_to', 'evidence']) field(lines, key, exception?.[key], TAGS.exception)
    close(lines, TAGS.exception)
  }
  close(lines, TAGS.exceptions)
  open(lines, TAGS.unknowns)
  for (const value of Array.isArray(model.unknowns) ? model.unknowns : []) {
    open(lines, TAGS.unknown)
    field(lines, 'value', value, TAGS.unknown)
    close(lines, TAGS.unknown)
  }
  close(lines, TAGS.unknowns)
  open(lines, TAGS.projection_rules)
  for (const rule of Array.isArray(model.projection_rules) ? model.projection_rules : []) formatProjectionRule(lines, rule)
  close(lines, TAGS.projection_rules)
  close(lines, TAGS.world)
  lines.push('</existing_world_model_reference>')
  return lines.join('\n')
}

function candidateError(message, diagnostics = [], code = 'WORLD_MODEL_CANDIDATE_INVALID') {
  const error = new Error(message)
  error.code = code
  error.diagnostics = diagnostics
  return error
}

function parseTag(line) {
  const match = line.trim().match(/^\[\/(.+)\]$|^\[(.+)\]$/u)
  if (!match) return null
  const closing = Boolean(match[1])
  const name = match[1] ?? match[2]
  return {closing, name}
}

function labelKey(label, section) {
  const normalized = String(label).trim()
  const semanticKey = TRANSPORT_KEY_BY_LABEL.get(`${section}:${normalized}`)
  if (semanticKey) return semanticKey
  const key = FIELD_KEY_BY_LABEL.get(normalized)
  if (!key) return null
  return TRANSPORT_FIELD_LABELS[`${section}:${key}`] === normalized || !TRANSPORT_FIELD_LABELS[`${section}:${key}`] ? key : null
}

function parseValue(raw, key) {
  const text = String(raw ?? '').trim()
  if (!text || text === 'NONE RECORDED') return {ignored: true}
  if (BOOLEAN_FIELDS.has(key)) {
    if (text === 'true') return {value: true}
    if (text === 'false') return {value: false}
    return {error: 'expected_boolean'}
  }
  if (text === 'null') return {error: 'null_not_allowed_in_candidate'}
  if ((text.startsWith('{') && text.endsWith('}')) || (text.startsWith('[') && text.endsWith(']')) || (text.startsWith('"') && text.endsWith('"'))) {
    try {
      const value = JSON.parse(text)
      if (value === null) return {error: 'null_not_allowed_in_candidate'}
      return {value}
    } catch {
      return {error: 'invalid_json_value'}
    }
  }
  return {value: text}
}

function frame(tag, parent = null) {
  return {tag, parent, data: {}, fields: new Set(), valid: true, children: []}
}

function allowedChild(parent, child) {
  const rules = {
    [TAGS.world]: new Set([TAGS.species, TAGS.medical_context, TAGS.exceptions, TAGS.unknowns, TAGS.projection_rules]),
    [TAGS.species]: new Set([TAGS.type]),
    [TAGS.type]: new Set([TAGS.capabilities, TAGS.reproduction_rules, TAGS.lifecycle, TAGS.mechanisms, TAGS.special_rules]),
    [TAGS.mechanisms]: new Set([TAGS.mechanism]),
    [TAGS.special_rules]: new Set([TAGS.rule]),
    [TAGS.exceptions]: new Set([TAGS.exception]),
    [TAGS.unknowns]: new Set([TAGS.unknown]),
    [TAGS.projection_rules]: new Set([TAGS.projection_rule]),
  }
  return rules[parent]?.has(child) ?? false
}

function attach(parent, child) {
  if (!parent || !child.valid) return
  if (child.tag === TAGS.species) parent.data.species.push(child.data)
  else if (child.tag === TAGS.type) parent.data.biological_types.push(child.data)
  else if (child.tag === TAGS.capabilities) parent.data.capabilities = child.data
  else if (child.tag === TAGS.reproduction_rules) parent.data.reproduction_rules = child.data
  else if (child.tag === TAGS.lifecycle) parent.data.lifecycle = child.data
  else if (child.tag === TAGS.mechanism) parent.data.reproductive_mechanisms.push(child.data)
  else if (child.tag === TAGS.rule) parent.data.special_rules.push(child.data.value)
  else if (child.tag === TAGS.exception) parent.data.exceptions.push(child.data)
  else if (child.tag === TAGS.unknown) parent.data.unknowns.push(child.data.value)
  else if (child.tag === TAGS.projection_rule) parent.data.projection_rules.push(child.data)
  else if (child.tag === TAGS.mechanisms) parent.data.reproductive_mechanisms = child.data.reproductive_mechanisms
  else if (child.tag === TAGS.special_rules) parent.data.special_rules = child.data.special_rules
  else if (child.tag === TAGS.medical_context) parent.data.medical_context = child.data
  else if (child.tag === TAGS.exceptions) parent.data.exceptions = child.data.exceptions
  else if (child.tag === TAGS.unknowns) parent.data.unknowns = child.data.unknowns
  else if (child.tag === TAGS.projection_rules) parent.data.projection_rules = child.data.projection_rules
}

function finalize(frameValue, diagnostics) {
  const required = {
    [TAGS.species]: 'name',
    [TAGS.type]: 'name',
    [TAGS.mechanism]: 'key',
    [TAGS.rule]: 'value',
    [TAGS.exception]: 'statement',
    [TAGS.unknown]: 'value',
  }
  const key = required[frameValue.tag]
  if (key && (typeof frameValue.data[key] !== 'string' || !frameValue.data[key].trim())) {
    frameValue.valid = false
    diagnostics.push({code: 'missing_required_field', tag: frameValue.tag, field: key})
  }
  if (frameValue.tag === TAGS.species && !Array.isArray(frameValue.data.biological_types)) frameValue.data.biological_types = []
  if (frameValue.tag === TAGS.type) {
    for (const keyName of ['capabilities', 'reproduction_rules', 'lifecycle']) if (!frameValue.data[keyName]) frameValue.data[keyName] = {}
    for (const keyName of ['reproductive_mechanisms', 'special_rules']) if (!frameValue.data[keyName]) frameValue.data[keyName] = []
  }
  if (frameValue.tag === TAGS.projection_rule && Object.hasOwn(frameValue.data, 'projection_rule_id')) {
    frameValue.valid = false
    diagnostics.push({code: 'projection_rule_identity_forbidden', tag: frameValue.tag})
  }
  return frameValue
}

export function parseWorldModelCandidateText(raw) {
  const text = String(raw ?? '')
  const diagnostics = []
  const root = frame(TAGS.world)
  root.data = {schema_version: 1, species: [], medical_context: {}, exceptions: [], unknowns: [], projection_rules: []}
  const stack = []
  let sawRoot = false
  const lines = text.split(/\r?\n/u)
  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index]
    const line = rawLine.trim()
    if (!line || line === '<existing_world_model_reference>' || line === '</existing_world_model_reference>') continue
    const tag = parseTag(line)
    if (tag) {
      if (tag.closing) {
        const position = stack.map((item) => item.tag).lastIndexOf(tag.name)
        if (position < 0) {
          diagnostics.push({code: 'closing_tag_without_opening', line: index + 1, tag: tag.name})
          continue
        }
        if (position !== stack.length - 1) {
          diagnostics.push({code: 'closing_tag_mismatch', line: index + 1, tag: tag.name})
          for (let cursor = stack.length - 1; cursor >= position; cursor -= 1) stack[cursor].valid = false
        }
        while (stack.length > position) {
          const completed = finalize(stack.pop(), diagnostics)
          if (completed.tag === TAGS.world) {
            if (completed.valid) sawRoot = true
          } else attach(stack[stack.length - 1] ?? root, completed)
        }
        continue
      }
      const known = TAG_BY_NAME.has(tag.name)
      if (!known) {
        diagnostics.push({code: 'unknown_tag', line: index + 1, tag: tag.name})
        stack.push({...frame(tag.name, stack.at(-1)), valid: false})
        continue
      }
      if (tag.name === TAGS.world && stack.length === 0) {
        stack.push(root)
        continue
      }
      if (tag.name === TAGS.species && stack.some((item) => item.tag === TAGS.species)) {
        diagnostics.push({code: 'species_boundary_conflict', line: index + 1})
        while (stack.length && stack.at(-1).tag !== TAGS.world) stack.pop()
      }
      const parent = stack.at(-1)
      if (!parent || !allowedChild(parent.tag, tag.name)) {
        diagnostics.push({code: 'ownership_ambiguous', line: index + 1, tag: tag.name})
        stack.push({...frame(tag.name, parent), valid: false})
      } else {
        const child = frame(tag.name, parent)
        if (tag.name === TAGS.species) child.data = {biological_types: []}
        if (tag.name === TAGS.type) child.data = {}
        if (tag.name === TAGS.capabilities || tag.name === TAGS.reproduction_rules || tag.name === TAGS.lifecycle || tag.name === TAGS.medical_context) child.data = {}
        if (tag.name === TAGS.mechanisms) child.data = {reproductive_mechanisms: []}
        if (tag.name === TAGS.special_rules) child.data = {special_rules: []}
        if (tag.name === TAGS.exceptions) child.data = {exceptions: []}
        if (tag.name === TAGS.unknowns) child.data = {unknowns: []}
        if (tag.name === TAGS.projection_rules) child.data = {projection_rules: []}
        stack.push(child)
      }
      continue
    }
    const fieldMatch = line.match(/^([^:]+):\s*(.*)$/u)
    if (!fieldMatch) {
      diagnostics.push({code: 'unrecognized_line', line: index + 1})
      continue
    }
    const current = stack.at(-1)
    if (!current || !current.valid) continue
    const key = labelKey(fieldMatch[1], current.tag)
    if (!key) {
      diagnostics.push({code: 'unknown_field', line: index + 1, field: fieldMatch[1]})
      continue
    }
    if (!SECTION_FIELDS[current.tag]?.has(key)) {
      diagnostics.push({code: 'unsupported_field_for_section', line: index + 1, tag: current.tag, field: key})
      continue
    }
    if (current.fields.has(key)) {
      current.valid = false
      diagnostics.push({code: 'duplicate_scalar', line: index + 1, field: key})
      continue
    }
    const parsed = parseValue(fieldMatch[2], key)
    if (parsed.ignored) continue
    if (parsed.error) {
      diagnostics.push({code: parsed.error, line: index + 1, field: key})
      continue
    }
    current.fields.add(key)
    if (key === 'json') {
      if (!parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) {
        diagnostics.push({code: 'projection_json_invalid', line: index + 1})
        current.valid = false
      } else current.data = {...current.data, ...parsed.value}
    }
    else current.data[key] = parsed.value
  }
  if (stack.length) {
    for (const item of stack) {
      item.valid = false
      diagnostics.push({code: 'unclosed_tag', tag: item.tag})
    }
  }
  if (!sawRoot) throw candidateError('WORLD_MODEL_CANDIDATE_ROOT_INVALID', diagnostics)
  return {candidate: root.data, diagnostics}
}

export function validateWorldModelCandidate(candidate) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw candidateError('WORLD_MODEL_CANDIDATE_INVALID')
  if (candidate.schema_version !== undefined && candidate.schema_version !== 1) throw candidateError('WORLD_MODEL_CANDIDATE_SCHEMA_VERSION_INVALID')
  if (!Array.isArray(candidate.species) || !Array.isArray(candidate.exceptions) || !Array.isArray(candidate.unknowns) || !Array.isArray(candidate.projection_rules)) throw candidateError('WORLD_MODEL_CANDIDATE_COLLECTION_INVALID')
  const validName = value => typeof value === 'string' && value.trim() !== ''
  const speciesNames = new Set()
  for (const species of candidate.species) {
    if (!species || typeof species !== 'object' || Array.isArray(species) || !validName(species.name) || !Array.isArray(species.biological_types)) throw candidateError('WORLD_MODEL_CANDIDATE_SPECIES_INVALID')
    if (speciesNames.has(species.name)) throw candidateError('WORLD_MODEL_CANDIDATE_DUPLICATE_IDENTITY', [{code: 'duplicate_species_identity', name: species.name}], 'WORLD_MODEL_CANDIDATE_DUPLICATE_IDENTITY')
    speciesNames.add(species.name)
    const typeNames = new Set()
    for (const type of species.biological_types) {
      if (!type || typeof type !== 'object' || Array.isArray(type) || !validName(type.name)) throw candidateError('WORLD_MODEL_CANDIDATE_TYPE_INVALID')
      if (typeNames.has(type.name)) throw candidateError('WORLD_MODEL_CANDIDATE_DUPLICATE_IDENTITY', [{code: 'duplicate_type_identity', species: species.name, name: type.name}], 'WORLD_MODEL_CANDIDATE_DUPLICATE_IDENTITY')
      typeNames.add(type.name)
      for (const key of ['capabilities', 'reproduction_rules', 'lifecycle']) if (type[key] !== undefined && (!type[key] || typeof type[key] !== 'object' || Array.isArray(type[key]))) throw candidateError('WORLD_MODEL_CANDIDATE_SECTION_INVALID')
      for (const key of ['reproductive_mechanisms', 'special_rules']) if (type[key] !== undefined && !Array.isArray(type[key])) throw candidateError('WORLD_MODEL_CANDIDATE_COLLECTION_INVALID')
      if (Array.isArray(type.special_rules) && type.special_rules.some(rule => !validName(rule))) throw candidateError('WORLD_MODEL_CANDIDATE_RULE_INVALID')
      if (Array.isArray(type.reproductive_mechanisms) && type.reproductive_mechanisms.some(mechanism => !mechanism || typeof mechanism !== 'object' || Array.isArray(mechanism) || !validName(mechanism.key))) throw candidateError('WORLD_MODEL_CANDIDATE_MECHANISM_INVALID')
    }
  }
  if (candidate.medical_context !== undefined && (!candidate.medical_context || typeof candidate.medical_context !== 'object' || Array.isArray(candidate.medical_context))) throw candidateError('WORLD_MODEL_CANDIDATE_MEDICAL_CONTEXT_INVALID')
  if (candidate.exceptions.some(exception => !exception || typeof exception !== 'object' || Array.isArray(exception) || !validName(exception.statement))) throw candidateError('WORLD_MODEL_CANDIDATE_EXCEPTION_INVALID')
  if (candidate.unknowns.some(unknown => !validName(unknown))) throw candidateError('WORLD_MODEL_CANDIDATE_UNKNOWN_INVALID')
  if (candidate.projection_rules.some(rule => !rule || typeof rule !== 'object' || Array.isArray(rule) || Object.hasOwn(rule, 'projection_rule_id'))) throw candidateError('WORLD_MODEL_CANDIDATE_PROJECTION_ID_INVALID')
  return candidate
}

function supplementError(message, diagnostics = []) {
  const error = new Error(message)
  error.code = 'WORLD_MODEL_SUPPLEMENT_INVALID'
  error.diagnostics = diagnostics
  return error
}

function sectionBody(lines) {
  return lines.slice(1, -1).join('\n')
}

export function parseWorldModelSupplementText(raw) {
  const text = String(raw ?? '').replace(/^```(?:text|markdown)?\s*/iu, '').replace(/\s*```$/u, '')
  const diagnostics = []
  const candidateLines = []
  const stack = []
  let sawRoot = false
  let closedRoot = false
  let sawWorldModel = false
  let closedWorldModel = false

  for (const [lineIndex, rawLine] of text.split(/\r?\n/u).entries()) {
    const line = rawLine.trim()
    if (!line) continue
    const tag = parseTag(line)
    if (!tag) {
      if (stack.some(item => item.tag === 'World Model') && !stack.some(item => item.invalid)) candidateLines.push(line)
      else diagnostics.push({code: 'supplement_unowned_line', line: lineIndex + 1})
      continue
    }

    if (tag.closing) {
      if (stack.some(item => item.tag === 'World Model') && tag.name !== 'World Model Supplement') candidateLines.push(line)
      const position = stack.map(item => item.tag).lastIndexOf(tag.name)
      if (position < 0) {
        diagnostics.push({code: 'closing_tag_without_opening', line: lineIndex + 1, tag: tag.name})
        continue
      }
      if (position !== stack.length - 1) {
        diagnostics.push({code: 'closing_tag_mismatch', line: lineIndex + 1, tag: tag.name})
        for (let cursor = stack.length - 1; cursor >= position; cursor -= 1) {
          diagnostics.push({code: 'invalid_subtree_discarded', tag: stack[cursor].tag})
        }
      }
      while (stack.length > position + 1) stack.pop()
      const completed = stack.pop()
      if (completed.tag === 'World Model') {
        closedWorldModel = true
        if (position !== 1) diagnostics.push({code: 'supplement_world_model_scope_invalid', line: lineIndex + 1})
      }
      if (completed.tag === 'World Model Supplement') {
        sawRoot = true
        closedRoot = true
      }
      continue
    }

    if (!stack.length) {
      if (tag.name !== 'World Model Supplement' || sawRoot || closedRoot) {
        diagnostics.push({code: 'supplement_root_invalid', line: lineIndex + 1, tag: tag.name})
        continue
      }
      stack.push({tag: tag.name})
      continue
    }

    if (stack.length === 1) {
      if (tag.name !== 'World Model' || sawWorldModel) {
        diagnostics.push({code: 'supplement_world_model_invalid', line: lineIndex + 1, tag: tag.name})
        stack.push({tag: tag.name, invalid: true})
        continue
      }
      sawWorldModel = true
      stack.push({tag: tag.name})
      candidateLines.push(line)
      continue
    }

    if (stack.some(item => item.invalid)) {
      stack.push({tag: tag.name, invalid: true})
      continue
    }
    candidateLines.push(line)
    stack.push({tag: tag.name})
  }

  for (const item of stack) diagnostics.push({code: 'unclosed_tag', tag: item.tag})
  if (!sawRoot || !closedRoot || !sawWorldModel || !closedWorldModel) diagnostics.push({code: 'supplement_root_invalid'})
  if (diagnostics.length) throw supplementError('WORLD_MODEL_SUPPLEMENT_INVALID', diagnostics)

  const candidate = parseWorldModelCandidateText(candidateLines.join('\n'))
  return {
    candidate: candidate.candidate,
    diagnostics: candidate.diagnostics,
  }
}

const FACT_DELTA_FIELDS = Object.freeze({
  identity: new Set(['Species_Identity', 'Type_Identity']),
  species: new Set(['Species_Description']),
  type: new Set([
    'Type_Description',
    'Can_Produce_Sperm',
    'Can_Produce_Ova',
    'Can_Be_Fertilized',
    'Can_Fertilize',
    'Can_Cause_Pregnancy',
    'Can_Carry_Pregnancy',
    'Fertilization',
    'Pregnancy_Or_Carrying',
    'Cycle',
    'Ovulation',
    'Gestation',
    'Labor',
    'Maturation',
    'Aging',
    'Special_Rule',
    'Reproductive_Mechanism',
  ]),
  world: new Set([
    'Childbirth_Difficulty',
    'Care_Level',
    'Medical_Evidence',
    'Exception',
    'Unknown',
    'Projection_Rule',
  ]),
})

const FACT_DELTA_SCALAR_FIELDS = new Set([
  'Species_Description',
  'Type_Description',
  'Can_Produce_Sperm',
  'Can_Produce_Ova',
  'Can_Be_Fertilized',
  'Can_Fertilize',
  'Can_Cause_Pregnancy',
  'Can_Carry_Pregnancy',
  'Fertilization',
  'Pregnancy_Or_Carrying',
  'Cycle',
  'Ovulation',
  'Gestation',
  'Labor',
  'Maturation',
  'Aging',
  'Childbirth_Difficulty',
  'Care_Level',
  'Medical_Evidence',
])

const FACT_DELTA_BOOLEAN_FIELDS = new Set([
  'Can_Produce_Sperm',
  'Can_Produce_Ova',
  'Can_Be_Fertilized',
  'Can_Fertilize',
  'Can_Cause_Pregnancy',
  'Can_Carry_Pregnancy',
  'Carrying_Compatibility',
])

const FACT_DELTA_PAYLOAD_KEYS = Object.freeze({
  Reproductive_Mechanism: new Set([
    'Mechanism_Key',
    'Mechanism_Label',
    'Mechanism_Pathway',
    'Carrying_Compatibility',
    'World_Model_Rule_Refs',
    'Mechanism_Evidence',
  ]),
  Exception: new Set(['Exception_Statement', 'Applies_To', 'Exception_Evidence']),
  Projection_Rule: new Set(['Projection_Rule_JSON']),
})

const COVERAGE_TYPE_SCALAR_FIELDS = Object.freeze([
  ['Type_Description', ['description']],
  ['Can_Produce_Sperm', ['capabilities', 'can_produce_sperm']],
  ['Can_Produce_Ova', ['capabilities', 'can_produce_ova']],
  ['Can_Be_Fertilized', ['capabilities', 'can_be_fertilized']],
  ['Can_Fertilize', ['capabilities', 'can_fertilize']],
  ['Can_Cause_Pregnancy', ['capabilities', 'can_cause_pregnancy']],
  ['Can_Carry_Pregnancy', ['capabilities', 'can_carry_pregnancy']],
  ['Fertilization', ['reproduction_rules', 'fertilization']],
  ['Pregnancy_Or_Carrying', ['reproduction_rules', 'pregnancy_or_carrying']],
  ['Cycle', ['reproduction_rules', 'cycle']],
  ['Ovulation', ['reproduction_rules', 'ovulation']],
  ['Gestation', ['reproduction_rules', 'gestation']],
  ['Labor', ['reproduction_rules', 'labor']],
  ['Maturation', ['lifecycle', 'maturation']],
  ['Aging', ['lifecycle', 'aging']],
])

const COVERAGE_WORLD_SCALAR_FIELDS = Object.freeze([
  ['Childbirth_Difficulty', ['medical_context', 'childbirth_difficulty']],
  ['Care_Level', ['medical_context', 'care_level']],
  ['Medical_Evidence', ['medical_context', 'evidence']],
])

const COVERAGE_COLLECTION_FIELDS = Object.freeze([
  ['Special_Rule', ['special_rules'], 'biological_type'],
  ['Reproductive_Mechanism', ['reproductive_mechanisms'], 'biological_type'],
  ['Exception', ['exceptions'], 'world'],
  ['Unknown', ['unknowns'], 'world'],
  ['Projection_Rule', ['projection_rules'], 'world'],
])

function coverageMissingScalar(value) {
  return value === null || value === undefined || (
    typeof value === 'string' && (!value.trim() || /^NONE RECORDED$/iu.test(value.trim()))
  )
}

function coverageCollectionHasContent(value, field) {
  if (!Array.isArray(value) || value.length === 0) return false
  return value.some(item => {
    if (typeof item === 'string') return item.trim() && !/^NONE RECORDED$/iu.test(item.trim())
    if (!item || typeof item !== 'object') return false
    if (field === 'Reproductive_Mechanism') return typeof item.key === 'string' && item.key.trim() && !/^NONE RECORDED$/iu.test(item.key.trim())
    if (field === 'Exception') return typeof item.statement === 'string' && item.statement.trim() && !/^NONE RECORDED$/iu.test(item.statement.trim())
    return true
  })
}

function coverageTarget(scope, field, species, biologicalType, category) {
  return {
    scope,
    category,
    field,
    ...(species ? {species} : {}),
    ...(biologicalType ? {biological_type: biologicalType} : {}),
  }
}

function stableReviewId(prefix, index) {
  return `${prefix}-v1-${String(index + 1).padStart(4, '0')}`
}

export function buildWorldModelSupplementIdentityReviewSubjects(existingModel = {}, evidenceSubjects = []) {
  const names = new Set()
  const add = value => {
    const name = typeof value === 'string' ? value.trim() : ''
    if (name) names.add(name)
  }
  for (const species of Array.isArray(existingModel?.species) ? existingModel.species : []) add(species?.name)
  for (const subject of Array.isArray(evidenceSubjects) ? evidenceSubjects : []) add(subject?.species ?? subject)
  return [...names].sort((left, right) => left.localeCompare(right)).map((species, index) => ({
    subject_id: stableReviewId('identity-review', index),
    scope: 'species',
    species,
  }))
}

export function buildWorldModelSupplementCoverageTargets(existingModel = {}) {
  const model = existingModel && typeof existingModel === 'object' ? existingModel : {}
  const targets = []
  for (const species of Array.isArray(model.species) ? model.species : []) {
    if (!species || typeof species.name !== 'string' || !species.name.trim()) continue
    const speciesName = species.name.trim()
    if (coverageMissingScalar(species.description))
      targets.push(coverageTarget('species', 'Species_Description', speciesName, null, 'description'))
    for (const type of Array.isArray(species.biological_types) ? species.biological_types : []) {
      if (!type || typeof type.name !== 'string' || !type.name.trim()) continue
      const typeName = type.name.trim()
      for (const [field, path] of COVERAGE_TYPE_SCALAR_FIELDS) {
        const value = type?.[path[0]]?.[path[1]]
        if (coverageMissingScalar(value)) targets.push(coverageTarget('biological_type', field, speciesName, typeName, path[0]))
      }
      for (const [field, path, scope] of COVERAGE_COLLECTION_FIELDS) {
        if (scope !== 'biological_type') continue
        if (!coverageCollectionHasContent(type?.[path[0]], field))
          targets.push(coverageTarget('biological_type', field, speciesName, typeName, path[0]))
      }
    }
  }
  for (const [field, path] of COVERAGE_WORLD_SCALAR_FIELDS) {
    if (coverageMissingScalar(model?.[path[0]]?.[path[1]])) targets.push(coverageTarget('world', field, null, null, path[0]))
  }
  for (const [field, path, scope] of COVERAGE_COLLECTION_FIELDS) {
    if (scope !== 'world') continue
    if (!coverageCollectionHasContent(model?.[path[0]], field)) targets.push(coverageTarget('world', field, null, null, path[0]))
  }
  return targets.map((target, index) => ({
    target_id: stableReviewId('coverage-target', index),
    ...target,
  }))
}

function reviewError(code, diagnostics = []) {
  const error = new Error(code)
  error.code = code
  error.diagnostics = diagnostics
  return error
}

function reviewBlockName(name) {
  if (name === 'Coverage Review') return 'coverage'
  if (name === 'Identity Discovery Review') return 'identity'
  return null
}

function factDeltaAddress(fact) {
  if (fact?.field === 'Exception' || fact?.field === 'Unknown' || fact?.field === 'Projection_Rule' || !fact?.species) {
    return {scope: 'world'}
  }
  if (fact?.biological_type) {
    return {scope: 'biological_type', species: fact.species, biological_type: fact.biological_type}
  }
  return {scope: 'species', species: fact.species}
}

export function parseWorldModelSupplementReviewText(raw) {
  const lines = String(raw ?? '').split(/\r?\n/u)
  const coverage = []
  const identity = []
  let block = null
  let fields = null
  const flush = () => {
    if (!fields) return
    const target = block === 'coverage' ? {
      target_id: fields.Target_ID,
      disposition: fields.Disposition,
    } : {
      subject_id: fields.Subject_ID,
      species: fields.Species,
      disposition: fields.Disposition,
    }
    ;(block === 'coverage' ? coverage : identity).push(target)
    fields = null
  }
  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.trim()
    const open = line.match(/^\[([^/][^\]]*)\]$/u)
    const close = line.match(/^\[\/([^\]]+)\]$/u)
    if (open) {
      const next = reviewBlockName(open[1])
      if (!next) continue
      if (block) throw reviewError('WORLD_MODEL_SUPPLEMENT_REVIEW_GRAMMAR_INVALID', [{line: index + 1}])
      block = next
      fields = {}
      continue
    }
    if (close && reviewBlockName(close[1])) {
      if (!block || reviewBlockName(close[1]) !== block) throw reviewError('WORLD_MODEL_SUPPLEMENT_REVIEW_GRAMMAR_INVALID', [{line: index + 1}])
      flush()
      block = null
      continue
    }
    if (!block || !line) continue
    const pair = line.match(/^([^:]+):\s*(.*)$/u)
    if (!pair) throw reviewError('WORLD_MODEL_SUPPLEMENT_REVIEW_GRAMMAR_INVALID', [{line: index + 1}])
    const key = pair[1].trim()
    const allowed = block === 'coverage' ? new Set(['Target_ID', 'Disposition']) : new Set(['Subject_ID', 'Species', 'Disposition'])
    if (!allowed.has(key) || Object.hasOwn(fields, key)) throw reviewError('WORLD_MODEL_SUPPLEMENT_REVIEW_GRAMMAR_INVALID', [{line: index + 1, field: key}])
    fields[key] = pair[2].trim()
  }
  if (block) throw reviewError('WORLD_MODEL_SUPPLEMENT_REVIEW_GRAMMAR_INVALID')
  return {coverage_dispositions: coverage, identity_reviews: identity}
}

export function validateWorldModelSupplementCompleteness({
  coverageTargets = [],
  coverageDispositions = [],
  identitySubjects = [],
  identityReviews = [],
  facts = [],
} = {}) {
  const targetById = new Map(coverageTargets.map(target => [target.target_id, target]))
  const seenCoverage = new Set()
  const targetFactCounts = new Map()
  for (const fact of Array.isArray(facts) ? facts : []) {
    const address = factDeltaAddress(fact)
    const key = [address.scope, address.species ?? '', address.biological_type ?? '', fact?.field].join(':')
    targetFactCounts.set(key, (targetFactCounts.get(key) ?? 0) + 1)
  }
  const missing = []
  const invalid = []
  for (const disposition of Array.isArray(coverageDispositions) ? coverageDispositions : []) {
    if (!targetById.has(disposition.target_id) || seenCoverage.has(disposition.target_id) || !['EMITTED', 'NO_EVIDENCE'].includes(disposition.disposition)) {
      invalid.push({target_id: disposition.target_id ?? null, reason: 'invalid_or_duplicate_disposition'})
      continue
    }
    seenCoverage.add(disposition.target_id)
    const target = targetById.get(disposition.target_id)
    const key = factDeltaCoverageKey(target)
    const factCount = targetFactCounts.get(key) ?? 0
    if (disposition.disposition === 'EMITTED' && factCount !== 1) invalid.push({target_id: target.target_id, reason: 'emitted_fact_count_must_equal_one', fact_count: factCount})
    if (disposition.disposition === 'NO_EVIDENCE' && factCount !== 0) invalid.push({target_id: target.target_id, reason: 'no_evidence_must_have_no_fact', fact_count: factCount})
  }
  for (const target of coverageTargets) if (!seenCoverage.has(target.target_id)) missing.push({target_id: target.target_id, reason: 'missing_disposition'})
  const subjectById = new Map(identitySubjects.map(subject => [subject.subject_id, subject]))
  const seenSubjects = new Set()
  for (const review of Array.isArray(identityReviews) ? identityReviews : []) {
    if (!subjectById.has(review.subject_id) || seenSubjects.has(review.subject_id) || review.disposition !== 'REVIEWED' || review.species !== subjectById.get(review.subject_id).species)
      invalid.push({subject_id: review.subject_id ?? null, reason: 'invalid_or_duplicate_identity_review'})
    else seenSubjects.add(review.subject_id)
  }
  for (const subject of identitySubjects) if (!seenSubjects.has(subject.subject_id)) missing.push({subject_id: subject.subject_id, reason: 'missing_identity_review'})
  const coverageMissingDispositionCount = missing.filter(item => item.reason === 'missing_disposition').length
  const identityReviewMissingCount = missing.filter(item => item.reason === 'missing_identity_review').length
  const accounting = {
    supplement_completeness_complete: missing.length === 0 && invalid.length === 0,
    identity_review_count: identitySubjects.length,
    identity_review_completed_count: seenSubjects.size,
    identity_review_missing_count: identityReviewMissingCount,
    coverage_target_count: coverageTargets.length,
    coverage_disposition_count: Array.isArray(coverageDispositions) ? coverageDispositions.length : 0,
    coverage_missing_disposition_count: coverageMissingDispositionCount,
  }
  if (missing.length || invalid.length) throw reviewError('WORLD_MODEL_SUPPLEMENT_INCOMPLETE', [{missing, invalid, ...accounting}])
  return {complete: true, ...accounting}
}

function factDeltaCoverageKey(target) {
  return [target?.scope, target?.species ?? '', target?.biological_type ?? '', target?.field].join(':')
}

function factDeltaError(message, diagnostics = [], code = 'WORLD_MODEL_FACT_DELTA_INVALID') {
  const error = new Error(message)
  error.code = code
  error.diagnostics = diagnostics
  return error
}

function factDeltaText(value, field) {
  const text = String(value ?? '').trim()
  if (!text || text === 'null' || (field !== 'Field' && /^unknown$/iu.test(text)) || text === 'NONE RECORDED') {
    throw factDeltaError('WORLD_MODEL_FACT_DELTA_VALUE_INVALID', [{field}], 'WORLD_MODEL_FACT_DELTA_VALUE_INVALID')
  }
  if (FACT_DELTA_BOOLEAN_FIELDS.has(field)) {
    if (text === 'true') return true
    if (text === 'false') return false
    throw factDeltaError('WORLD_MODEL_FACT_DELTA_BOOLEAN_INVALID', [{field}], 'WORLD_MODEL_FACT_DELTA_BOOLEAN_INVALID')
  }
  return text
}

function factDeltaJson(value, field, expected) {
  const text = String(value ?? '').trim()
  if (!text) throw factDeltaError('WORLD_MODEL_FACT_DELTA_VALUE_INVALID', [{field}])
  let parsed
  try { parsed = JSON.parse(text) } catch { throw factDeltaError('WORLD_MODEL_FACT_DELTA_JSON_INVALID', [{field}]) }
  if (expected === 'object' && (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)))
    throw factDeltaError('WORLD_MODEL_FACT_DELTA_JSON_INVALID', [{field}])
  if (expected === 'string[]' && (!Array.isArray(parsed) || parsed.some(item => typeof item !== 'string')))
    throw factDeltaError('WORLD_MODEL_FACT_DELTA_JSON_INVALID', [{field}])
  return parsed
}

function factDeltaParseLine(line, lineNumber) {
  const match = line.match(/^([^:]+):\s*(.*)$/u)
  if (!match) throw factDeltaError('WORLD_MODEL_FACT_DELTA_LINE_INVALID', [{line: lineNumber}])
  return {key: match[1].trim(), value: match[2]}
}

const FACT_DELTA_TEXT_CONTINUATION_FIELDS = new Set([
  'Species_Description',
  'Type_Description',
  'Fertilization',
  'Pregnancy_Or_Carrying',
  'Cycle',
  'Ovulation',
  'Gestation',
  'Labor',
  'Maturation',
  'Aging',
  'Childbirth_Difficulty',
  'Care_Level',
  'Medical_Evidence',
  'Special_Rule',
  'Unknown',
])

function factDeltaContinuationAllowed(lines) {
  // Continuation is deliberately decided from the already parsed Field and
  // payload label; it never repairs an address or changes the payload schema.
  const field = lines.find(item => item.key === 'Field')?.value?.trim()
  const previous = lines.at(-1)
  if (!previous || !field) return false
  if (previous.key === 'Value') return FACT_DELTA_TEXT_CONTINUATION_FIELDS.has(field)
  if (field === 'Exception') return ['Exception_Statement', 'Applies_To', 'Exception_Evidence'].includes(previous.key)
  if (field === 'Reproductive_Mechanism') return ['Mechanism_Label', 'Mechanism_Pathway'].includes(previous.key)
  return false
}

function factDeltaLooksLikeSplitStructuralLabel(line) {
  if (/^\s*:\s*/u.test(line)) return true
  return /^(?:Species|Biological_Type|Field|Value|Species_Description|Type_Description|Can_Produce_Sperm|Can_Produce_Ova|Can_Be_Fertilized|Can_Fertilize|Can_Cause_Pregnancy|Can_Carry_Pregnancy|Fertilization|Pregnancy_Or_Carrying|Cycle|Ovulation|Gestation|Labor|Maturation|Aging|Childbirth_Difficulty|Care_Level|Medical_Evidence|Special_Rule|Exception|Unknown|Reproductive_Mechanism|Projection_Rule|Exception_Statement|Applies_To|Exception_Evidence|Mechanism_Key|Mechanism_Label|Mechanism_Pathway|Carrying_Compatibility|World_Model_Rule_Refs|Mechanism_Evidence|Projection_Rule_JSON)\s*$/u.test(line)
}

function factDeltaScope(fact) {
  if (fact.field === 'Species_Identity' || fact.field === 'Species_Description') return 'species'
  if (fact.field === 'Type_Identity' || FACT_DELTA_FIELDS.type.has(fact.field)) return 'type'
  return 'world'
}

function factDeltaFinalize(lines, startLine) {
  const pairs = new Map()
  for (const item of lines) {
    if (pairs.has(item.key)) throw factDeltaError('WORLD_MODEL_FACT_DELTA_DUPLICATE_FIELD', [{line: item.line, field: item.key}])
    pairs.set(item.key, item.value)
  }
  const species = pairs.has('Species') ? factDeltaText(pairs.get('Species'), 'Species') : undefined
  const type = pairs.has('Biological_Type') ? factDeltaText(pairs.get('Biological_Type'), 'Biological_Type') : undefined
  const field = factDeltaText(pairs.get('Field'), 'Field')
  const scope = factDeltaScope({field})
  if (scope !== 'world' && !species) throw factDeltaError('WORLD_MODEL_FACT_DELTA_SPECIES_REQUIRED', [{line: startLine, field}])
  if (scope === 'species' && type) throw factDeltaError('WORLD_MODEL_FACT_DELTA_SCOPE_INVALID', [{line: startLine, field}])
  if (scope === 'world' && (species || type)) throw factDeltaError('WORLD_MODEL_FACT_DELTA_SCOPE_INVALID', [{line: startLine, field}])
  const allowed = scope === 'species'
    ? FACT_DELTA_FIELDS.species
    : scope === 'type'
      ? FACT_DELTA_FIELDS.type
      : FACT_DELTA_FIELDS.world
  if (!allowed.has(field) && !FACT_DELTA_FIELDS.identity.has(field))
    throw factDeltaError('WORLD_MODEL_FACT_DELTA_FIELD_UNSUPPORTED', [{line: startLine, field}])
  if (field === 'Type_Identity' && !type) throw factDeltaError('WORLD_MODEL_FACT_DELTA_TYPE_REQUIRED', [{line: startLine}])
  if (field !== 'Type_Identity' && scope === 'type' && !type)
    throw factDeltaError('WORLD_MODEL_FACT_DELTA_TYPE_REQUIRED', [{line: startLine, field}])
  const baseSize = 1 + (species ? 1 : 0) + (type ? 1 : 0)
  if (field === 'Species_Identity' || field === 'Type_Identity') {
    if (pairs.size !== baseSize) throw factDeltaError('WORLD_MODEL_FACT_DELTA_IDENTITY_PAYLOAD_INVALID', [{line: startLine}])
    return {species, ...(type ? {biological_type: type} : {}), field}
  }
  const address = scope === 'world' ? {} : {species, ...(type ? {biological_type: type} : {})}
  const knownKeys = new Set(['Species', 'Biological_Type', 'Field', ...(FACT_DELTA_SCALAR_FIELDS.has(field) || field === 'Special_Rule' || field === 'Unknown' ? ['Value'] : []), ...FACT_DELTA_PAYLOAD_KEYS[field] ?? []])
  for (const key of pairs.keys()) if (!knownKeys.has(key)) throw factDeltaError('WORLD_MODEL_FACT_DELTA_PAYLOAD_KEY_UNKNOWN', [{line: startLine, field: key}])
  if (FACT_DELTA_SCALAR_FIELDS.has(field)) {
    if (pairs.size !== baseSize + 1 || !pairs.has('Value')) throw factDeltaError('WORLD_MODEL_FACT_DELTA_SCALAR_PAYLOAD_INVALID', [{line: startLine, field}])
    return {...address, field, value: factDeltaText(pairs.get('Value'), field)}
  }
  if (field === 'Special_Rule' || field === 'Unknown') {
    if (pairs.size !== baseSize + 1 || !pairs.has('Value')) throw factDeltaError('WORLD_MODEL_FACT_DELTA_COLLECTION_PAYLOAD_INVALID', [{line: startLine, field}])
    return {...address, field, value: factDeltaText(pairs.get('Value'), field)}
  }
  if (field === 'Exception') {
    if (!pairs.has('Exception_Statement') || pairs.size < baseSize + 1 || pairs.size > baseSize + 3)
      throw factDeltaError('WORLD_MODEL_FACT_DELTA_EXCEPTION_PAYLOAD_INVALID', [{line: startLine}])
    return {
      ...address,
      field,
      exception: {
        statement: factDeltaText(pairs.get('Exception_Statement'), 'Exception_Statement'),
        ...(pairs.has('Applies_To') ? {applies_to: factDeltaText(pairs.get('Applies_To'), 'Applies_To')} : {}),
        ...(pairs.has('Exception_Evidence') ? {evidence: factDeltaText(pairs.get('Exception_Evidence'), 'Exception_Evidence')} : {}),
      },
    }
  }
  if (field === 'Reproductive_Mechanism') {
    if (!type || !pairs.has('Mechanism_Key')) throw factDeltaError('WORLD_MODEL_FACT_DELTA_MECHANISM_PAYLOAD_INVALID', [{line: startLine}])
    const mechanism = {key: factDeltaText(pairs.get('Mechanism_Key'), 'Mechanism_Key')}
    for (const [transport, canonical] of [
      ['Mechanism_Label', 'label'], ['Mechanism_Pathway', 'pathway'],
      ['Carrying_Compatibility', 'carrying_compatibility'],
      ['World_Model_Rule_Refs', 'world_model_rule_refs'], ['Mechanism_Evidence', 'evidence'],
    ]) if (pairs.has(transport)) mechanism[canonical] = FACT_DELTA_BOOLEAN_FIELDS.has(transport)
      ? factDeltaText(pairs.get(transport), transport)
      : (transport === 'World_Model_Rule_Refs' || transport === 'Mechanism_Evidence'
        ? factDeltaJson(pairs.get(transport), transport, 'string[]')
        : factDeltaText(pairs.get(transport), transport))
    return {...address, field, mechanism}
  }
  if (field === 'Projection_Rule') {
    if (pairs.size !== baseSize + 1 || !pairs.has('Projection_Rule_JSON')) throw factDeltaError('WORLD_MODEL_FACT_DELTA_PROJECTION_PAYLOAD_INVALID', [{line: startLine}])
    const projection_rule = factDeltaJson(pairs.get('Projection_Rule_JSON'), 'Projection_Rule_JSON', 'object')
    if (Object.hasOwn(projection_rule, 'projection_rule_id')) throw factDeltaError('WORLD_MODEL_FACT_DELTA_PROJECTION_ID_FORBIDDEN', [{line: startLine}])
    return {...address, field, projection_rule}
  }
  throw factDeltaError('WORLD_MODEL_FACT_DELTA_FIELD_UNSUPPORTED', [{line: startLine, field}])
}

export function parseWorldModelFactDeltaText(raw) {
  const text = String(raw ?? '').replace(/^```(?:text|markdown)?\s*/iu, '').replace(/\s*```$/u, '')
  const lines = text.split(/\r?\n/u)
  let reviewBlock = false
  const factLinesOnly = lines.filter(line => {
    const trimmed = line.trim()
    if (/^\[(?:Coverage Review|Identity Discovery Review)\]$/u.test(trimmed)) {
      reviewBlock = true
      return false
    }
    if (/^\[\/(?:Coverage Review|Identity Discovery Review)\]$/u.test(trimmed)) {
      reviewBlock = false
      return false
    }
    return !reviewBlock
  })
  const diagnostics = []
  const rejectedFacts = []
  const facts = []
  let rootState = 'none'
  let factLines = null
  let factStart = 0
  let factIndex = -1
  let factDepth = 0
  let factInvalid = null
  let factRaw = []
  let rawFactBlockCount = 0
  const rejectFact = (error) => {
    const diagnosticCode = error?.code && error.code !== 'WORLD_MODEL_FACT_DELTA_INVALID'
      ? error.code
      : error?.message?.startsWith('WORLD_MODEL_FACT_DELTA_')
        ? error.message
        : 'WORLD_MODEL_FACT_DELTA_FACT_INVALID'
    rejectedFacts.push({
      index: factIndex,
      raw: factRaw.join('\n'),
      code: diagnosticCode,
      reason: error?.message ?? 'WORLD_MODEL_FACT_DELTA_FACT_INVALID',
      diagnostics: Array.isArray(error?.diagnostics) ? error.diagnostics : [],
    })
  }
  for (const [index, rawLine] of factLinesOnly.entries()) {
    const line = rawLine.trim()
    if (!line) continue
    if (line === '[World Model Updates]') {
      if (rootState !== 'none') throw factDeltaError('WORLD_MODEL_FACT_DELTA_ROOT_INVALID', [{line: index + 1}])
      rootState = 'open'
      continue
    }
    if (line === '[/World Model Updates]') {
      if (rootState !== 'open' || factLines) throw factDeltaError('WORLD_MODEL_FACT_DELTA_ROOT_INVALID', [{line: index + 1}])
      rootState = 'closed'
      continue
    }
    if (rootState !== 'open') throw factDeltaError('WORLD_MODEL_FACT_DELTA_TRAILING_TEXT', [{line: index + 1}])
    if (line === '[Fact]') {
      if (factLines) {
        factRaw.push(line)
        factInvalid ??= factDeltaError('WORLD_MODEL_FACT_DELTA_NESTED_FACT', [{line: index + 1}])
        factDepth += 1
        continue
      }
      factLines = []
      factStart = index + 1
      factIndex += 1
      rawFactBlockCount += 1
      factDepth = 1
      factInvalid = null
      factRaw = [line]
      continue
    }
    if (line === '[/Fact]') {
      if (!factLines) throw factDeltaError('WORLD_MODEL_FACT_DELTA_FACT_CLOSE_INVALID', [{line: index + 1}])
      factRaw.push(line)
      if (factDepth > 1) {
        factDepth -= 1
        continue
      }
      if (factInvalid) rejectFact(factInvalid)
      else {
        try {
          facts.push(factDeltaFinalize(factLines, factStart))
        } catch (error) {
          rejectFact(error)
        }
      }
      factLines = null
      factDepth = 0
      factInvalid = null
      factRaw = []
      continue
    }
    if (!factLines) throw factDeltaError('WORLD_MODEL_FACT_DELTA_TRAILING_TEXT', [{line: index + 1}])
    factRaw.push(line)
    if (/^(?:ADD_|SET_FIELD|REMOVE|CHANGE|NO_OP|NO-OP)\b/u.test(line)) {
      factInvalid ??= factDeltaError('WORLD_MODEL_FACT_DELTA_PATCH_IR_FORBIDDEN', [{line: index + 1}])
      continue
    }
    if (factInvalid) continue
    try {
      const pair = factDeltaParseLine(line, index + 1)
      factLines.push({...pair, line: index + 1})
    } catch (error) {
      if ((error?.code === 'WORLD_MODEL_FACT_DELTA_LINE_INVALID' || error?.message === 'WORLD_MODEL_FACT_DELTA_LINE_INVALID') && !factDeltaLooksLikeSplitStructuralLabel(line) && factDeltaContinuationAllowed(factLines)) {
        factLines.at(-1).value = `${factLines.at(-1).value.trim()} ${line}`.trim()
      } else {
        factInvalid = error
      }
    }
  }
  if (rootState !== 'closed') throw factDeltaError('WORLD_MODEL_FACT_DELTA_ROOT_INVALID', diagnostics)
  if (factLines) {
    rejectFact(factInvalid ?? factDeltaError('WORLD_MODEL_FACT_DELTA_ROOT_INVALID', diagnostics))
    factLines = null
  }
  return {facts, rejectedFacts, diagnostics, raw_fact_block_count: rawFactBlockCount}
}

export function validateWorldModelFactDelta(facts) {
  if (!Array.isArray(facts)) throw factDeltaError('WORLD_MODEL_FACT_DELTA_INVALID')
  for (const fact of facts) {
    if (!fact || typeof fact !== 'object' || Array.isArray(fact) || typeof fact.field !== 'string')
      throw factDeltaError('WORLD_MODEL_FACT_DELTA_FACT_INVALID')
    const scope = factDeltaScope(fact)
    const hasSpecies = typeof fact.species === 'string' && fact.species.trim()
    const hasType = typeof fact.biological_type === 'string' && fact.biological_type.trim()
    if (scope === 'world' && (hasSpecies || hasType)) throw factDeltaError('WORLD_MODEL_FACT_DELTA_SCOPE_INVALID')
    if (scope !== 'world' && !hasSpecies) throw factDeltaError('WORLD_MODEL_FACT_DELTA_SPECIES_REQUIRED')
    if (scope === 'species' && hasType) throw factDeltaError('WORLD_MODEL_FACT_DELTA_SCOPE_INVALID')
    if (scope === 'type' && !hasType) throw factDeltaError('WORLD_MODEL_FACT_DELTA_TYPE_REQUIRED')
  }
  return facts
}

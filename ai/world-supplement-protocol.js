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

const WRITABLE_FACTS = [
  {field: 'Species_Identity', wireScope: 'species', owner: 'species', path: ['name'], container: 'identity', mutation: 'ADD_SPECIES', payload: 'identity', createWritable: true, correctionWritable: false, uiOutlet: 'species_selector'},
  {field: 'Species_Description', wireScope: 'species', owner: 'species', path: ['description'], container: 'scalar', mutation: 'SET_FIELD', payload: 'string', createWritable: true, correctionWritable: true, uiOutlet: 'species_description'},
  {field: 'Type_Identity', wireScope: 'type', owner: 'biological_type', path: ['name'], container: 'identity', mutation: 'ADD_TYPE', payload: 'identity', createWritable: true, correctionWritable: false, uiOutlet: 'type_selector'},
  {field: 'Type_Description', wireScope: 'type', owner: 'biological_type', path: ['description'], container: 'scalar', mutation: 'SET_FIELD', payload: 'string', createWritable: true, correctionWritable: true, uiOutlet: 'type_description'},
  ...[
    ['Can_Produce_Sperm', ['capabilities', 'can_produce_sperm']],
    ['Can_Produce_Ova', ['capabilities', 'can_produce_ova']],
    ['Can_Be_Fertilized', ['capabilities', 'can_be_fertilized']],
    ['Can_Fertilize', ['capabilities', 'can_fertilize']],
    ['Can_Cause_Pregnancy', ['capabilities', 'can_cause_pregnancy']],
    ['Can_Carry_Pregnancy', ['capabilities', 'can_carry_pregnancy']],
  ].map(([field, path]) => ({field, wireScope: 'type', owner: 'biological_type', path, container: 'scalar', mutation: 'SET_FIELD', payload: 'boolean', createWritable: true, correctionWritable: true, uiOutlet: 'capabilities'})),
  ...[
    ['Fertilization', ['reproduction_rules', 'fertilization']],
    ['Pregnancy_Or_Carrying', ['reproduction_rules', 'pregnancy_or_carrying']],
    ['Cycle', ['reproduction_rules', 'cycle']],
    ['Ovulation', ['reproduction_rules', 'ovulation']],
    ['Gestation', ['reproduction_rules', 'gestation']],
    ['Labor', ['reproduction_rules', 'labor']],
  ].map(([field, path]) => ({field, wireScope: 'type', owner: 'biological_type', path, container: 'scalar', mutation: 'SET_FIELD', payload: 'string', createWritable: true, correctionWritable: true, uiOutlet: 'reproduction_rules'})),
  ...[
    ['Maturation', ['lifecycle', 'maturation']],
    ['Aging', ['lifecycle', 'aging']],
  ].map(([field, path]) => ({field, wireScope: 'type', owner: 'biological_type', path, container: 'scalar', mutation: 'SET_FIELD', payload: 'string', createWritable: true, correctionWritable: true, uiOutlet: 'lifecycle'})),
  {field: 'Special_Rule', wireScope: 'type', owner: 'biological_type', path: ['special_rules'], container: 'simple_collection', mutation: 'ADD_SPECIAL_RULE', payload: 'string', createWritable: true, correctionWritable: false, uiOutlet: 'special_rules'},
  {field: 'Reproductive_Mechanism', wireScope: 'type', owner: 'biological_type', path: ['reproductive_mechanisms'], container: 'structured_collection', mutation: 'ADD_MECHANISM', payload: 'mechanism', createWritable: true, correctionWritable: false, identity: 'key', uiOutlet: 'reproductive_mechanisms'},
  ...[
    ['Childbirth_Difficulty', ['medical_context', 'childbirth_difficulty']],
    ['Care_Level', ['medical_context', 'care_level']],
    ['Medical_Evidence', ['medical_context', 'evidence']],
  ].map(([field, path]) => ({field, wireScope: 'world', owner: 'world', path, container: 'scalar', mutation: 'SET_FIELD', payload: 'string', createWritable: true, correctionWritable: true, uiOutlet: 'medical_context'})),
  {field: 'Exception', wireScope: 'world', owner: 'world', path: ['exceptions'], container: 'structured_collection', mutation: 'ADD_EXCEPTION', payload: 'exception', createWritable: true, correctionWritable: false, identity: 'statement+applies_to', uiOutlet: 'exceptions'},
  {field: 'Unknown', wireScope: 'world', owner: 'world', path: ['unknowns'], container: 'lifecycle_collection', mutation: 'ADD_UNKNOWN', payload: 'string', createWritable: true, correctionWritable: false, identity: 'normalized_text', uiOutlet: 'unknowns'},
  {field: 'Projection_Rule', wireScope: 'world', owner: 'world', path: ['projection_rules'], container: 'structured_collection', mutation: 'ADD_PROJECTION_RULE', payload: 'projection_rule', createWritable: true, correctionWritable: false, identity: 'projection_rule_id', uiOutlet: 'projection_rules'},
]

export const SUPPLEMENT_CANONICAL_WRITABILITY_REGISTRY = Object.freeze(
  Object.fromEntries(WRITABLE_FACTS.map(entry => [entry.field, Object.freeze({...entry, path: Object.freeze([...entry.path])})])),
)

export const SUPPLEMENT_CANONICAL_WRITABILITY_FIELDS = Object.freeze(
  WRITABLE_FACTS.map(entry => entry.field),
)

export function supplementFactDescriptor(field) {
  return SUPPLEMENT_CANONICAL_WRITABILITY_REGISTRY[field] ?? null
}

const FACT_DELTA_FIELDS = Object.freeze({
  identity: new Set(WRITABLE_FACTS.filter(item => item.container === 'identity').map(item => item.field)),
  species: new Set(WRITABLE_FACTS.filter(item => item.wireScope === 'species' && item.container !== 'identity').map(item => item.field)),
  type: new Set(WRITABLE_FACTS.filter(item => item.wireScope === 'type' && item.container !== 'identity').map(item => item.field)),
  world: new Set(WRITABLE_FACTS.filter(item => item.wireScope === 'world').map(item => item.field)),
})

const JSON_FACT_FIELDS = new Set([
  ...FACT_DELTA_FIELDS.identity,
  ...FACT_DELTA_FIELDS.species,
  ...FACT_DELTA_FIELDS.type,
  ...FACT_DELTA_FIELDS.world,
])

const FACT_DELTA_SCALAR_FIELDS = new Set(WRITABLE_FACTS.filter(item => item.container === 'scalar').map(item => item.field))

const FACT_DELTA_BOOLEAN_FIELDS = new Set(
  WRITABLE_FACTS.filter(item => item.payload === 'boolean').map(item => item.field),
)

const COVERAGE_TYPE_SCALAR_FIELDS = Object.freeze(
  WRITABLE_FACTS
    .filter(item => item.container === 'scalar' && item.wireScope === 'type')
    .map(item => [item.field, item.path]),
)

const COVERAGE_WORLD_SCALAR_FIELDS = Object.freeze(
  WRITABLE_FACTS
    .filter(item => item.container === 'scalar' && item.wireScope === 'world')
    .map(item => [item.field, item.path]),
)

const COVERAGE_COLLECTION_FIELDS = Object.freeze(
  WRITABLE_FACTS
    .filter(item => item.container === 'simple_collection' || item.container === 'structured_collection' || item.container === 'lifecycle_collection')
    .map(item => [item.field, item.path, item.owner]),
)

export function worldModelSupplementCoverageCardinality(field) {
  return COVERAGE_COLLECTION_FIELDS.some(([collectionField]) => collectionField === field)
    ? 'collection'
    : 'scalar'
}

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
    cardinality: worldModelSupplementCoverageCardinality(field),
    ...(species ? {species} : {}),
    ...(biologicalType ? {biological_type: biologicalType} : {}),
  }
}

function stableReviewId(prefix, index) {
  return `${prefix}-v1-${String(index + 1).padStart(4, '0')}`
}

function stableCoverageTargetId(target) {
  const address = [
    target?.scope ?? '',
    target?.species ?? '',
    target?.biological_type ?? '',
    target?.field ?? '',
  ].join('\u001f')
  let hash = 2166136261
  for (let index = 0; index < address.length; index += 1) {
    hash ^= address.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `coverage-target-v1-${(hash >>> 0).toString(16).padStart(8, '0')}`
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
  return targets.map(target => ({
    target_id: stableCoverageTargetId(target),
    ...target,
  }))
}

function reviewError(code, diagnostics = []) {
  const error = new Error(code)
  error.code = code
  error.diagnostics = diagnostics
  return error
}

function identityTypesForSpecies(model, speciesName) {
  const species = Array.isArray(model?.species)
    ? model.species.find(item => item?.name === speciesName)
    : null
  return new Set(
    (Array.isArray(species?.biological_types) ? species.biological_types : [])
      .filter(type => typeof type?.name === 'string' && type.name.trim())
      .map(type => type.name.trim()),
  )
}

function identityFactsForSpecies(facts, speciesName) {
  return (Array.isArray(facts) ? facts : [])
    .filter(fact => fact?.field === 'Type_Identity' && fact?.species === speciesName && typeof fact?.biological_type === 'string' && fact.biological_type.trim())
}

function distinctIdentityFactCount(facts, existingTypes) {
  return new Set(
    facts
      .map(fact => fact.biological_type.trim())
      .filter(type => !existingTypes.has(type)),
  ).size
}

export function summarizeWorldModelSupplementIdentityDiversity({
  existingModel = {},
  identitySubjects = [],
  identityReviews = [],
  facts = [],
  acceptedFacts = [],
} = {}) {
  const reviewsBySubject = new Map(
    (Array.isArray(identityReviews) ? identityReviews : [])
      .filter(review => review && typeof review === 'object')
      .map(review => [review.subject_id, review]),
  )
  const subjects = (Array.isArray(identitySubjects) ? identitySubjects : []).map(subject => {
    const review = reviewsBySubject.get(subject?.subject_id)
    const existingTypes = identityTypesForSpecies(existingModel, subject?.species)
    const responseFacts = identityFactsForSpecies(facts, subject?.species)
    const acceptedResponseFacts = identityFactsForSpecies(acceptedFacts, subject?.species)
    const observedTypes = new Set(existingTypes)
    for (const fact of responseFacts) observedTypes.add(fact.biological_type.trim())
    const reported = Number.isInteger(review?.distinct_type_count) && review.distinct_type_count >= 0
      ? review.distinct_type_count
      : null
    const initialTypeNames = [...existingTypes].sort((left, right) => left.localeCompare(right))
    const discoveredSiblingTypeNames = [...new Set(responseFacts.map(fact => fact.biological_type.trim()))]
      .filter(type => !existingTypes.has(type))
      .sort((left, right) => left.localeCompare(right))
    const acceptedSiblingTypeNames = [...new Set(acceptedResponseFacts.map(fact => fact.biological_type.trim()))]
      .filter(type => !existingTypes.has(type))
      .sort((left, right) => left.localeCompare(right))
    const rejectedSiblingTypeNames = discoveredSiblingTypeNames.filter(type => !acceptedSiblingTypeNames.includes(type))
    const initialIdentitySearchPerformed = Boolean(review && Object.hasOwn(review, 'additional_type_search'))
    const siblingSearchSeeded = existingTypes.size > 0
    const siblingSearchComplete = initialIdentitySearchPerformed && review?.additional_type_search === 'EXHAUSTED'
    let code = null
    if (!review) code = 'WORLD_MODEL_SUPPLEMENT_IDENTITY_REVIEW_MISSING'
    else if (review.disposition !== 'REVIEWED' || review.species !== subject?.species) code = 'WORLD_MODEL_SUPPLEMENT_IDENTITY_REVIEW_INVALID'
    else if (!Number.isInteger(review.distinct_type_count) || review.distinct_type_count < 0) code = 'WORLD_MODEL_SUPPLEMENT_IDENTITY_COUNT_INVALID'
    else if (review.additional_type_search !== 'EXHAUSTED') code = 'WORLD_MODEL_SUPPLEMENT_IDENTITY_SEARCH_NOT_EXHAUSTED'
    else if (reported !== observedTypes.size) code = 'WORLD_MODEL_SUPPLEMENT_IDENTITY_COUNT_MISMATCH'
    return {
      subject_id: subject?.subject_id ?? null,
      species: subject?.species ?? null,
      initial_type_count: existingTypes.size,
      initial_type_names: initialTypeNames,
      initial_identity_search_performed: initialIdentitySearchPerformed,
      sibling_search_seeded: siblingSearchSeeded,
      sibling_search_complete: siblingSearchComplete,
      discovered_sibling_type_count: discoveredSiblingTypeNames.length,
      discovered_sibling_type_names: discoveredSiblingTypeNames,
      accepted_sibling_type_count: acceptedSiblingTypeNames.length,
      accepted_sibling_type_names: acceptedSiblingTypeNames,
      rejected_sibling_type_count: rejectedSiblingTypeNames.length,
      rejected_sibling_type_names: rejectedSiblingTypeNames,
      reported_distinct_type_count: reported,
      host_observed_distinct_type_count: observedTypes.size,
      accepted_canonical_type_count: existingTypes.size + acceptedSiblingTypeNames.length,
      new_type_identity_fact_count: distinctIdentityFactCount(responseFacts, existingTypes),
      accepted_new_type_identity_count: distinctIdentityFactCount(acceptedResponseFacts, existingTypes),
      observed_type_names: [...observedTypes].sort((left, right) => left.localeCompare(right)),
      complete: !code,
      ...(code ? {code} : {}),
    }
  })
  const aggregate = subjects.reduce((summary, subject) => {
    summary.reported_distinct_type_count += subject.reported_distinct_type_count ?? 0
    summary.host_observed_distinct_type_count += subject.host_observed_distinct_type_count
    summary.accepted_canonical_type_count += subject.accepted_canonical_type_count
    summary.discovered_sibling_type_count += subject.discovered_sibling_type_count
    summary.accepted_sibling_type_count += subject.accepted_sibling_type_count
    summary.rejected_sibling_type_count += subject.rejected_sibling_type_count
    summary.discovered_sibling_type_names.push(...subject.discovered_sibling_type_names)
    summary.accepted_sibling_type_names.push(...subject.accepted_sibling_type_names)
    summary.rejected_sibling_type_names.push(...subject.rejected_sibling_type_names)
    summary.new_type_identity_fact_count += subject.new_type_identity_fact_count
    summary.accepted_new_type_identity_count += subject.accepted_new_type_identity_count
    return summary
  }, {
    reported_distinct_type_count: 0,
    host_observed_distinct_type_count: 0,
    accepted_canonical_type_count: 0,
    discovered_sibling_type_count: 0,
    accepted_sibling_type_count: 0,
    rejected_sibling_type_count: 0,
    discovered_sibling_type_names: [],
    accepted_sibling_type_names: [],
    rejected_sibling_type_names: [],
    new_type_identity_fact_count: 0,
    accepted_new_type_identity_count: 0,
  })
  return {
    subjects,
    ...aggregate,
    discovered_sibling_type_names: [...new Set(aggregate.discovered_sibling_type_names)].sort((left, right) => left.localeCompare(right)),
    accepted_sibling_type_names: [...new Set(aggregate.accepted_sibling_type_names)].sort((left, right) => left.localeCompare(right)),
    rejected_sibling_type_names: [...new Set(aggregate.rejected_sibling_type_names)].sort((left, right) => left.localeCompare(right)),
  }
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

export function validateWorldModelSupplementCompleteness({
  coverageTargets = [],
  coverageDispositions = [],
  identitySubjects = [],
  identityReviews = [],
  facts = [],
  coverageFactMappings = null,
  acceptedFacts = null,
  existingModel = {},
} = {}) {
  const targetById = new Map(coverageTargets.map(target => [target.target_id, target]))
  const seenCoverage = new Set()
  const targetFactCounts = new Map()
  const rawTargetFactCounts = new Map()
  const mappingByTargetId = new Map((Array.isArray(coverageFactMappings) ? coverageFactMappings : []).map(item => [item.target_id, item]))
  const targetFacts = Array.isArray(acceptedFacts) ? acceptedFacts : facts
  for (const fact of Array.isArray(facts) ? facts : []) {
    const address = factDeltaAddress(fact)
    const key = [address.scope, address.species ?? '', address.biological_type ?? '', fact?.field].join(':')
    rawTargetFactCounts.set(key, (rawTargetFactCounts.get(key) ?? 0) + 1)
  }
  for (const fact of targetFacts) {
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
    const mapping = mappingByTargetId.get(target.target_id)
    const factCount = mapping ? mapping.exact_address_match_count : targetFactCounts.get(key) ?? 0
    const cardinality = target.cardinality ?? worldModelSupplementCoverageCardinality(target.field)
    if (
      disposition.disposition === 'EMITTED' &&
      (cardinality === 'collection' ? factCount < 1 : factCount !== 1)
    ) invalid.push({
      target_id: target.target_id,
      reason: rawTargetFactCounts.get(key) === 1 && Array.isArray(acceptedFacts)
        ? 'emitted_fact_rejected'
        : cardinality === 'collection'
          ? 'emitted_collection_requires_at_least_one_fact'
          : 'emitted_fact_count_must_equal_one',
      fact_count: factCount,
      raw_fact_count: mapping?.raw_candidate_fact_count ?? rawTargetFactCounts.get(key) ?? 0,
      ...(mapping ? {coverage_mapping: mapping} : {}),
    })
    if (disposition.disposition === 'NO_EVIDENCE' && factCount !== 0) invalid.push({target_id: target.target_id, reason: 'no_evidence_must_have_no_fact', fact_count: factCount, ...(mapping ? {coverage_mapping: mapping} : {})})
  }
  for (const target of coverageTargets) if (!seenCoverage.has(target.target_id)) missing.push({target_id: target.target_id, reason: 'missing_disposition'})
  const subjectById = new Map(identitySubjects.map(subject => [subject.subject_id, subject]))
  const seenSubjects = new Set()
  for (const review of Array.isArray(identityReviews) ? identityReviews : []) {
    if (!subjectById.has(review.subject_id) || seenSubjects.has(review.subject_id) || review.disposition !== 'REVIEWED' || review.species !== subjectById.get(review.subject_id).species)
      invalid.push({subject_id: review.subject_id ?? null, reason: 'invalid_or_duplicate_identity_review'})
    else seenSubjects.add(review.subject_id)
  }
  for (const subject of identitySubjects) if (!seenSubjects.has(subject.subject_id)) missing.push({subject_id: subject.subject_id, reason: 'missing_identity_review', code: 'WORLD_MODEL_SUPPLEMENT_IDENTITY_REVIEW_MISSING'})
  const identityDiversity = summarizeWorldModelSupplementIdentityDiversity({
    existingModel,
    identitySubjects,
    identityReviews,
    facts,
  })
  for (const subject of identityDiversity.subjects) {
    if (subject.code && !invalid.some(item => item.subject_id === subject.subject_id && item.code === subject.code)) {
      invalid.push({
        ...subject,
        reported: subject.reported_distinct_type_count,
        observed: subject.host_observed_distinct_type_count,
        reason: 'identity_diversity_accounting_invalid',
      })
    }
  }
  const coverageMissingDispositionCount = missing.filter(item => item.reason === 'missing_disposition').length
  const identityReviewMissingCount = missing.filter(item => item.reason === 'missing_identity_review').length
  const accounting = {
    supplement_completeness_complete: missing.length === 0 && invalid.length === 0,
    identity_review_count: identitySubjects.length,
    identity_review_completed_count: seenSubjects.size,
    identity_review_missing_count: identityReviewMissingCount,
    identity_diversity: identityDiversity.subjects,
    reported_distinct_type_count: identityDiversity.reported_distinct_type_count,
    host_observed_distinct_type_count: identityDiversity.host_observed_distinct_type_count,
    new_type_identity_fact_count: identityDiversity.new_type_identity_fact_count,
    accepted_new_type_identity_count: identityDiversity.accepted_new_type_identity_count,
    coverage_target_count: coverageTargets.length,
    coverage_disposition_count: Array.isArray(coverageDispositions) ? coverageDispositions.length : 0,
    coverage_missing_disposition_count: coverageMissingDispositionCount,
  }
  if (missing.length || invalid.length) {
    const error = reviewError('WORLD_MODEL_SUPPLEMENT_INCOMPLETE', [{missing, invalid, coverage_fact_mappings: (Array.isArray(coverageFactMappings) ? coverageFactMappings : []).slice(0, 128), ...accounting}])
    error.analysis_stage = 'supplement_completeness'
    error.completeness_failure = true
    error.diagnostic_code = invalid.find(item => item.code)?.code ?? 'WORLD_MODEL_SUPPLEMENT_INCOMPLETE'
    throw error
  }
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

function factDeltaScope(fact) {
  return supplementFactDescriptor(fact?.field)?.wireScope ?? null
}

export function validateWorldModelFactDelta(facts) {
  if (!Array.isArray(facts)) throw factDeltaError('WORLD_MODEL_FACT_DELTA_INVALID')
  for (const fact of facts) {
    if (!fact || typeof fact !== 'object' || Array.isArray(fact) || typeof fact.field !== 'string')
      throw factDeltaError('WORLD_MODEL_FACT_DELTA_FACT_INVALID')
    const scope = factDeltaScope(fact)
    if (!scope) throw factDeltaError('WORLD_MODEL_FACT_DELTA_FIELD_UNSUPPORTED', [{field: fact.field}], 'WORLD_MODEL_FACT_DELTA_FIELD_UNSUPPORTED')
    const hasSpecies = typeof fact.species === 'string' && fact.species.trim()
    const hasType = typeof fact.biological_type === 'string' && fact.biological_type.trim()
    if (scope === 'world' && (hasSpecies || hasType)) throw factDeltaError('WORLD_MODEL_FACT_DELTA_SCOPE_INVALID')
    if (scope !== 'world' && !hasSpecies) throw factDeltaError('WORLD_MODEL_FACT_DELTA_SPECIES_REQUIRED')
    if (scope === 'species' && hasType) throw factDeltaError('WORLD_MODEL_FACT_DELTA_SCOPE_INVALID')
    if (scope === 'type' && !hasType) throw factDeltaError('WORLD_MODEL_FACT_DELTA_TYPE_REQUIRED')
  }
  return facts
}

function jsonFactError(code, index, details = {}) {
  const error = factDeltaError(code, [{fact_index: index, ...details}], code)
  error.fact_index = index
  return error
}

function jsonFactText(value, field, index) {
  if (typeof value !== 'string' || !value.trim() || /^NONE RECORDED$/iu.test(value.trim()) || /^unknown$/iu.test(value.trim()))
    throw jsonFactError('WORLD_MODEL_FACT_DELTA_JSON_VALUE_INVALID', index, {field})
  return value.trim()
}

function jsonFactControlText(value, field, index) {
  if (typeof value !== 'string' || !value.trim())
    throw jsonFactError('WORLD_MODEL_FACT_DELTA_JSON_VALUE_INVALID', index, {field})
  return value.trim()
}

// Unknowns are persisted as strings for schema compatibility.  Their queue
// identity is therefore derived by the host from canonical text, never from
// model-generated or time-based identifiers.
export function worldModelUnknownId(value) {
  const text = String(value ?? '').trim().normalize('NFKC').replace(/\s+/gu, ' ').toLowerCase()
  let hash = 2166136261
  for (const char of text) {
    hash ^= char.codePointAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return `unknown_${(hash >>> 0).toString(16).padStart(8, '0')}`
}

export function buildWorldModelSupplementUnknownContext(model = {}) {
  return (Array.isArray(model.unknowns) ? model.unknowns : []).map((value) => ({
    unknown_id: worldModelUnknownId(value),
    value: String(value).trim(),
    expected_scope: 'world',
    expected_resolution: 'accepted_fact_with_exact_canonical_address',
  }))
}

function jsonFactEnum(value, field, allowed, index) {
  const token = jsonFactControlText(value, field, index)
  if (!allowed.has(token)) throw jsonFactError('WORLD_MODEL_FACT_DELTA_JSON_ENUM_INVALID', index, {field, value: token})
  return token
}

function jsonFactField(value, index) {
  return jsonFactEnum(value, 'field', JSON_FACT_FIELDS, index)
}

function jsonFactBoolean(value, field, index) {
  if (typeof value !== 'boolean') throw jsonFactError('WORLD_MODEL_FACT_DELTA_JSON_BOOLEAN_INVALID', index, {field})
  return value
}

function jsonFactAddress(item, field, index, scope) {
  const species = item.species === undefined ? undefined : jsonFactControlText(item.species, 'species', index)
  const biologicalType = item.biological_type === undefined ? undefined : jsonFactControlText(item.biological_type, 'biological_type', index)
  if (scope === 'world' && (species !== undefined || biologicalType !== undefined))
    throw jsonFactError('WORLD_MODEL_FACT_DELTA_JSON_SCOPE_INVALID', index, {field})
  if (scope !== 'world' && species === undefined)
    throw jsonFactError('WORLD_MODEL_FACT_DELTA_JSON_SPECIES_REQUIRED', index, {field})
  if (scope === 'species' && biologicalType !== undefined)
    throw jsonFactError('WORLD_MODEL_FACT_DELTA_JSON_SCOPE_INVALID', index, {field})
  if (scope === 'type' && biologicalType === undefined)
    throw jsonFactError('WORLD_MODEL_FACT_DELTA_JSON_TYPE_REQUIRED', index, {field})
  return {species, biologicalType}
}

function assertJsonKeys(item, allowed, index) {
  for (const key of Object.keys(item)) if (!allowed.has(key)) throw jsonFactError('WORLD_MODEL_FACT_DELTA_JSON_PAYLOAD_KEY_UNKNOWN', index, {key})
}

function normalizeJsonFact(item, index) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) throw jsonFactError('WORLD_MODEL_FACT_DELTA_JSON_FACT_INVALID', index)
  const field = jsonFactField(item.field, index)
  const scope = factDeltaScope({field})
  if (!scope) throw jsonFactError('WORLD_MODEL_FACT_DELTA_JSON_FIELD_UNSUPPORTED', index, {field})
  if (item.scope !== scope) throw jsonFactError('WORLD_MODEL_FACT_DELTA_JSON_SCOPE_INVALID', index, {field, expected_scope: scope, actual_scope: item.scope})
  const {species, biologicalType} = jsonFactAddress(item, field, index, scope)
  const base = {
    ...(species !== undefined ? {species} : {}),
    ...(biologicalType !== undefined ? {biological_type: biologicalType} : {}),
    field,
  }
  const descriptor = supplementFactDescriptor(field)
  if (descriptor?.container === 'identity') {
    assertJsonKeys(item, new Set(['scope', 'species', 'biological_type', 'field']), index)
    return base
  }
  if (descriptor?.container === 'scalar') {
    assertJsonKeys(item, new Set(['scope', 'species', 'biological_type', 'field', 'value']), index)
    if (!Object.hasOwn(item, 'value')) throw jsonFactError('WORLD_MODEL_FACT_DELTA_JSON_SCALAR_PAYLOAD_INVALID', index, {field})
    return {
      ...base,
      value: FACT_DELTA_BOOLEAN_FIELDS.has(field)
        ? jsonFactBoolean(item.value, field, index)
        : jsonFactText(item.value, field, index),
    }
  }
  if (descriptor?.container === 'simple_collection' || descriptor?.container === 'lifecycle_collection') {
    assertJsonKeys(item, new Set(['scope', 'species', 'biological_type', 'field', 'value']), index)
    return {...base, value: jsonFactText(item.value, field, index)}
  }
  if (descriptor?.field === 'Exception') {
    assertJsonKeys(item, new Set(['scope', 'field', 'exception']), index)
    const exception = item.exception
    if (!exception || typeof exception !== 'object' || Array.isArray(exception)) throw jsonFactError('WORLD_MODEL_FACT_DELTA_JSON_EXCEPTION_PAYLOAD_INVALID', index)
    assertJsonKeys(exception, new Set(['statement', 'applies_to', 'evidence']), index)
    return {
      ...base,
      exception: {
        statement: jsonFactText(exception.statement, 'statement', index),
        ...(exception.applies_to === undefined ? {} : {applies_to: jsonFactText(exception.applies_to, 'applies_to', index)}),
        ...(exception.evidence === undefined ? {} : {evidence: jsonFactText(exception.evidence, 'evidence', index)}),
      },
    }
  }
  if (descriptor?.field === 'Reproductive_Mechanism') {
    assertJsonKeys(item, new Set(['scope', 'species', 'biological_type', 'field', 'mechanism']), index)
    const mechanism = item.mechanism
    if (!mechanism || typeof mechanism !== 'object' || Array.isArray(mechanism)) throw jsonFactError('WORLD_MODEL_FACT_DELTA_JSON_MECHANISM_PAYLOAD_INVALID', index)
    assertJsonKeys(mechanism, new Set(['key', 'label', 'pathway', 'carrying_compatibility', 'world_model_rule_refs', 'evidence']), index)
    const normalized = {key: jsonFactText(mechanism.key, 'key', index)}
    for (const key of ['label', 'pathway']) if (mechanism[key] !== undefined) normalized[key] = jsonFactText(mechanism[key], key, index)
    if (mechanism.carrying_compatibility !== undefined) normalized.carrying_compatibility = jsonFactBoolean(mechanism.carrying_compatibility, 'carrying_compatibility', index)
    for (const key of ['world_model_rule_refs', 'evidence']) if (mechanism[key] !== undefined) {
      if (!Array.isArray(mechanism[key]) || mechanism[key].some(value => typeof value !== 'string' || !value.trim()))
        throw jsonFactError('WORLD_MODEL_FACT_DELTA_JSON_COLLECTION_INVALID', index, {field: key})
      normalized[key] = mechanism[key].map(value => value.trim())
    }
    return {...base, mechanism: normalized}
  }
  if (descriptor?.field === 'Projection_Rule') {
    assertJsonKeys(item, new Set(['scope', 'field', 'projection_rule']), index)
    if (!item.projection_rule || typeof item.projection_rule !== 'object' || Array.isArray(item.projection_rule) || Object.hasOwn(item.projection_rule, 'projection_rule_id'))
      throw jsonFactError('WORLD_MODEL_FACT_DELTA_JSON_PROJECTION_PAYLOAD_INVALID', index)
    return {...base, projection_rule: item.projection_rule}
  }
  throw jsonFactError('WORLD_MODEL_FACT_DELTA_JSON_FIELD_UNSUPPORTED', index, {field})
}

function balancedJsonRoot(text) {
  const source = String(text ?? '').trim()
  if (!source) return null
  try { return JSON.parse(source) } catch {}
  const fenced = source.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/iu)
  if (fenced) {
    try { return JSON.parse(fenced[1]) } catch {}
  }
  let start = -1
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') {
      inString = true
      continue
    }
    if (char === '{') {
      if (start < 0) start = index
      depth += 1
    } else if (char === '}' && start >= 0) {
      depth -= 1
      if (depth === 0) {
        try { return JSON.parse(source.slice(start, index + 1)) } catch { return null }
      }
      if (depth < 0) return null
    }
  }
  return null
}

export function parseWorldModelFactDeltaJson(raw) {
  const root = balancedJsonRoot(raw)
  if (!root || typeof root !== 'object' || Array.isArray(root)) {
    const error = factDeltaError('WORLD_MODEL_FACT_DELTA_JSON_ROOT_INVALID', [], 'WORLD_MODEL_FACT_DELTA_JSON_ROOT_INVALID')
    error.format_retryable = true
    throw error
  }
  const rootKeys = new Set(['facts', 'coverage', 'identity_reviews', 'resolved_unknown_ids'])
  if (Object.keys(root).some(key => !rootKeys.has(key))) {
    const error = factDeltaError('WORLD_MODEL_FACT_DELTA_JSON_ROOT_INVALID', [], 'WORLD_MODEL_FACT_DELTA_JSON_ROOT_INVALID')
    error.format_retryable = true
    throw error
  }
  if (!Array.isArray(root.facts)) {
    const error = factDeltaError('WORLD_MODEL_FACT_DELTA_JSON_FACTS_INVALID', [], 'WORLD_MODEL_FACT_DELTA_JSON_FACTS_INVALID')
    error.format_retryable = true
    throw error
  }
  const facts = []
  const rejectedFacts = []
  root.facts.forEach((item, index) => {
    try {
      const fact = normalizeJsonFact(item, index)
      validateWorldModelFactDelta([fact])
      facts.push(fact)
    } catch (error) {
      rejectedFacts.push({
        index,
        raw: item,
        code: error?.code ?? 'WORLD_MODEL_FACT_DELTA_JSON_FACT_INVALID',
        reason: error?.message ?? 'WORLD_MODEL_FACT_DELTA_JSON_FACT_INVALID',
        diagnostics: Array.isArray(error?.diagnostics) ? error.diagnostics : [],
      })
    }
  })
  const coverage = root.coverage
  const noEvidence = Array.isArray(coverage?.no_evidence_target_ids)
    ? coverage.no_evidence_target_ids.filter(value => typeof value === 'string' && value.trim()).map(value => value.trim())
    : []
  const coverageDiagnostics = coverage && (!coverage || typeof coverage !== 'object' || Array.isArray(coverage) || (Object.hasOwn(coverage, 'no_evidence_target_ids') && !Array.isArray(coverage.no_evidence_target_ids)))
    ? [{code: 'WORLD_MODEL_SUPPLEMENT_JSON_COVERAGE_INVALID'}]
    : []
  const identityReviews = []
  const rejectedIdentityReviews = []
  if (root.identity_reviews !== undefined && !Array.isArray(root.identity_reviews)) rejectedIdentityReviews.push({index: null, code: 'WORLD_MODEL_SUPPLEMENT_JSON_IDENTITY_REVIEWS_INVALID', reason: 'identity_reviews must be an array'})
  for (const [index, review] of (Array.isArray(root.identity_reviews) ? root.identity_reviews : []).entries()) {
    try {
      if (!review || typeof review !== 'object' || Array.isArray(review)) throw new Error('WORLD_MODEL_SUPPLEMENT_JSON_IDENTITY_REVIEW_INVALID')
      assertJsonKeys(review, new Set(['subject_id', 'species', 'status', 'disposition', 'distinct_type_count', 'additional_type_search']), index)
      const normalized = {
        subject_id: jsonFactControlText(review.subject_id, 'subject_id', index),
        species: jsonFactControlText(review.species, 'species', index),
        disposition: review.status === 'REVIEWED' ? 'REVIEWED' : review.disposition,
        distinct_type_count: review.distinct_type_count,
        additional_type_search: review.additional_type_search,
      }
      if (normalized.disposition !== 'REVIEWED' || !Number.isInteger(normalized.distinct_type_count) || normalized.distinct_type_count < 0 || normalized.additional_type_search !== 'EXHAUSTED') throw new Error('WORLD_MODEL_SUPPLEMENT_JSON_IDENTITY_REVIEW_INVALID')
      identityReviews.push(normalized)
    } catch (error) {
      rejectedIdentityReviews.push({index, raw: review, code: error?.message ?? 'WORLD_MODEL_SUPPLEMENT_JSON_IDENTITY_REVIEW_INVALID', reason: error?.message ?? 'WORLD_MODEL_SUPPLEMENT_JSON_IDENTITY_REVIEW_INVALID'})
    }
  }
  const resolvedUnknownIds = []
  const rejectedUnknownResolutions = []
  if (root.resolved_unknown_ids !== undefined && !Array.isArray(root.resolved_unknown_ids))
    rejectedUnknownResolutions.push({index: null, code: 'WORLD_MODEL_SUPPLEMENT_JSON_UNKNOWN_RESOLUTIONS_INVALID', reason: 'resolved_unknown_ids must be an array'})
  for (const [index, declaration] of (Array.isArray(root.resolved_unknown_ids) ? root.resolved_unknown_ids : []).entries()) {
    try {
      if (!declaration || typeof declaration !== 'object' || Array.isArray(declaration)) throw new Error('WORLD_MODEL_SUPPLEMENT_JSON_UNKNOWN_RESOLUTION_INVALID')
      assertJsonKeys(declaration, new Set(['unknown_id', 'resolving_fact_addresses']), index)
      const unknown_id = jsonFactControlText(declaration.unknown_id, 'unknown_id', index)
      if (!Array.isArray(declaration.resolving_fact_addresses) || declaration.resolving_fact_addresses.length === 0)
        throw new Error('WORLD_MODEL_SUPPLEMENT_JSON_UNKNOWN_RESOLUTION_ADDRESS_INVALID')
      const resolving_fact_addresses = declaration.resolving_fact_addresses.map((address) => {
        if (!address || typeof address !== 'object' || Array.isArray(address)) throw new Error('WORLD_MODEL_SUPPLEMENT_JSON_UNKNOWN_RESOLUTION_ADDRESS_INVALID')
        assertJsonKeys(address, new Set(['scope', 'species', 'biological_type', 'field']), index)
        const scope = jsonFactControlText(address.scope, 'scope', index)
        if (!new Set(['world', 'species', 'biological_type']).has(scope)) throw new Error('WORLD_MODEL_SUPPLEMENT_JSON_UNKNOWN_RESOLUTION_SCOPE_INVALID')
        const normalized = {scope}
        if (scope !== 'world') normalized.species = jsonFactControlText(address.species, 'species', index)
        if (scope === 'biological_type') normalized.biological_type = jsonFactControlText(address.biological_type, 'biological_type', index)
        normalized.field = jsonFactControlText(address.field, 'field', index)
        return normalized
      })
      resolvedUnknownIds.push({unknown_id, resolving_fact_addresses})
    } catch (error) {
      rejectedUnknownResolutions.push({index, raw: declaration, code: error?.message ?? 'WORLD_MODEL_SUPPLEMENT_JSON_UNKNOWN_RESOLUTION_INVALID', reason: error?.message ?? 'WORLD_MODEL_SUPPLEMENT_JSON_UNKNOWN_RESOLUTION_INVALID'})
    }
  }
  return {
    facts,
    rejectedFacts,
    coverage_no_evidence_target_ids: [...new Set(noEvidence)],
    identity_reviews: identityReviews,
    rejectedIdentityReviews,
    resolved_unknown_ids: resolvedUnknownIds,
    rejectedUnknownResolutions,
    coverageDiagnostics,
  }
}

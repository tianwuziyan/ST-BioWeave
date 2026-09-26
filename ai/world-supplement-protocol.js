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
  schema_version: 'Schema Version',
  name: 'Name',
  description: 'Description',
  can_produce_sperm: 'Can Produce Sperm',
  can_produce_ova: 'Can Produce Ova',
  can_be_fertilized: 'Can Be Fertilized',
  can_fertilize: 'Can Fertilize',
  can_cause_pregnancy: 'Can Cause Pregnancy',
  can_carry_pregnancy: 'Can Carry Pregnancy',
  fertilization: 'Fertilization',
  pregnancy_or_carrying: 'Pregnancy Or Carrying',
  cycle: 'Cycle',
  ovulation: 'Ovulation',
  gestation: 'Gestation',
  labor: 'Labor',
  maturation: 'Maturation',
  aging: 'Aging',
  key: 'Key',
  label: 'Label',
  pathway: 'Pathway',
  carrying_compatibility: 'Carrying Compatibility',
  world_model_rule_refs: 'World Model Rule Refs',
  evidence: 'Evidence',
  statement: 'Statement',
  applies_to: 'Applies To',
  childbirth_difficulty: 'Childbirth Difficulty',
  care_level: 'Care Level',
  value: 'Value',
  json: 'JSON',
})

const TAG_BY_NAME = new Map(Object.values(TAGS).map((tag) => [tag, tag]))
const FIELD_KEY_BY_LABEL = new Map(Object.entries(FIELD_LABELS).map(([key, label]) => [label, key]))
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

export const WORLD_MODEL_DISCOVERY_TAGS = Object.freeze({
  root: 'Discovery',
  species: 'Species',
  type: 'Biological Type',
})

function quote(value) {
  if (value === undefined) return ''
  if (value === null) return 'null'
  if (typeof value === 'string') return value.includes('\n') ? JSON.stringify(value) : value
  return JSON.stringify(value)
}

function field(lines, key, value) {
  if (value === undefined) return
  lines.push(`${FIELD_LABELS[key] ?? key}: ${quote(value)}`)
}

function open(lines, tag) { lines.push(`[${tag}]`) }
function close(lines, tag) { lines.push(`[/${tag}]`) }

function formatMechanism(lines, mechanism) {
  open(lines, TAGS.mechanism)
  for (const key of ['key', 'label', 'pathway', 'carrying_compatibility', 'world_model_rule_refs', 'evidence']) field(lines, key, mechanism?.[key])
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
    field(lines, 'name', species?.name)
    field(lines, 'description', species?.description)
    for (const type of Array.isArray(species?.biological_types) ? species.biological_types : []) {
      open(lines, TAGS.type)
      field(lines, 'name', type?.name)
      field(lines, 'description', type?.description)
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
        field(lines, 'value', value)
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
    for (const key of ['statement', 'applies_to', 'evidence']) field(lines, key, exception?.[key])
    close(lines, TAGS.exception)
  }
  close(lines, TAGS.exceptions)
  open(lines, TAGS.unknowns)
  for (const value of Array.isArray(model.unknowns) ? model.unknowns : []) {
    open(lines, TAGS.unknown)
    field(lines, 'value', value)
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

function labelKey(label) {
  return FIELD_KEY_BY_LABEL.get(String(label).trim()) ?? null
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
  const text = String(raw ?? '').replace(/^```(?:text|markdown)?\s*/iu, '').replace(/\s*```$/u, '')
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
    const key = labelKey(fieldMatch[1])
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

function discoveryError(message, diagnostics = [], code = 'WORLD_MODEL_DISCOVERY_INVALID') {
  const error = new Error(message)
  error.code = code
  error.diagnostics = diagnostics
  return error
}

function discoveryFrame(tag, parent = null) {
  return {tag, parent, data: {}, fields: new Set(), valid: true}
}

function discoveryAllowedChild(parent, child) {
  if (parent === WORLD_MODEL_DISCOVERY_TAGS.root) return child === WORLD_MODEL_DISCOVERY_TAGS.species
  if (parent === WORLD_MODEL_DISCOVERY_TAGS.species) return child === WORLD_MODEL_DISCOVERY_TAGS.type
  return false
}

function attachDiscovery(parent, child) {
  if (!parent || !child.valid) return
  if (child.tag === WORLD_MODEL_DISCOVERY_TAGS.species) parent.data.species.push(child.data)
  if (child.tag === WORLD_MODEL_DISCOVERY_TAGS.type) parent.data.biological_types.push(child.data)
}

function finalizeDiscovery(frameValue, diagnostics) {
  if ((frameValue.tag === WORLD_MODEL_DISCOVERY_TAGS.species || frameValue.tag === WORLD_MODEL_DISCOVERY_TAGS.type) &&
      (typeof frameValue.data.name !== 'string' || !frameValue.data.name.trim())) {
    frameValue.valid = false
    diagnostics.push({code: 'missing_required_field', tag: frameValue.tag, field: 'name'})
  }
  if (frameValue.tag === WORLD_MODEL_DISCOVERY_TAGS.species && !Array.isArray(frameValue.data.biological_types)) frameValue.data.biological_types = []
  return frameValue
}

export function parseWorldModelDiscoveryText(raw) {
  const text = String(raw ?? '').replace(/^```(?:text|markdown)?\s*/iu, '').replace(/\s*```$/u, '')
  const diagnostics = []
  const root = discoveryFrame(WORLD_MODEL_DISCOVERY_TAGS.root)
  root.data = {species: []}
  const stack = []
  let sawRoot = false
  let closedRoot = false
  const lines = text.split(/\r?\n/u)
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim()
    if (!line) continue
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
          const completed = finalizeDiscovery(stack.pop(), diagnostics)
          if (completed.tag === WORLD_MODEL_DISCOVERY_TAGS.root) {
            if (completed.valid) sawRoot = true
            closedRoot = true
          } else attachDiscovery(stack.at(-1) ?? root, completed)
        }
        continue
      }
      if (tag.name === WORLD_MODEL_DISCOVERY_TAGS.root && stack.length === 0) {
        if (closedRoot || sawRoot) diagnostics.push({code: 'duplicate_root', line: index + 1, tag: tag.name})
        else stack.push(root)
        continue
      }
      const known = Object.values(WORLD_MODEL_DISCOVERY_TAGS).includes(tag.name)
      if (!known) {
        diagnostics.push({code: 'unsupported_discovery_tag', line: index + 1, tag: tag.name})
        stack.push({...discoveryFrame(tag, stack.at(-1)), valid: false})
        continue
      }
      const parent = stack.at(-1)
      if (!parent || !discoveryAllowedChild(parent.tag, tag.name) || !parent.valid) {
        diagnostics.push({code: 'ownership_ambiguous', line: index + 1, tag: tag.name})
        stack.push({...discoveryFrame(tag.name, parent), valid: false})
        continue
      }
      const child = discoveryFrame(tag.name, parent)
      if (tag.name === WORLD_MODEL_DISCOVERY_TAGS.species) child.data = {biological_types: []}
      if (tag.name === WORLD_MODEL_DISCOVERY_TAGS.type) child.data = {}
      stack.push(child)
      continue
    }
    const fieldMatch = line.match(/^([^:]+):\s*(.*)$/u)
    if (!fieldMatch) {
      diagnostics.push({code: 'unrecognized_line', line: index + 1})
      continue
    }
    const current = stack.at(-1)
    if (!current || !current.valid) continue
    if (fieldMatch[1].trim() !== 'Name') {
      diagnostics.push({code: 'unsupported_discovery_field', line: index + 1, field: fieldMatch[1].trim()})
      current.valid = false
      continue
    }
    if (current.tag !== WORLD_MODEL_DISCOVERY_TAGS.species && current.tag !== WORLD_MODEL_DISCOVERY_TAGS.type) {
      diagnostics.push({code: 'ownership_ambiguous', line: index + 1, field: 'Name'})
      current.valid = false
      continue
    }
    if (current.fields.has('name')) {
      diagnostics.push({code: 'duplicate_scalar', line: index + 1, field: 'Name'})
      current.valid = false
      continue
    }
    current.fields.add('name')
    current.data.name = fieldMatch[2].trim()
  }
  if (stack.length) {
    for (const item of stack) {
      item.valid = false
      diagnostics.push({code: 'unclosed_tag', tag: item.tag})
    }
  }
  if (!sawRoot) throw discoveryError('WORLD_MODEL_DISCOVERY_ROOT_INVALID', diagnostics)
  return {ledger: root.data, diagnostics}
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
  const sectionLines = new Map()
  const invalidSections = new Set()
  const stack = []
  let activeSection = null
  let sawRoot = false
  let closedRoot = false
  let sectionOrder = []

  const markInvalid = (section = activeSection) => {
    if (section) invalidSections.add(section)
  }

  for (const [lineIndex, rawLine] of text.split(/\r?\n/u).entries()) {
    const line = rawLine.trim()
    if (!line) continue
    const tag = parseTag(line)
    if (!tag) {
      if (activeSection) sectionLines.get(activeSection).push(line)
      else diagnostics.push({code: 'supplement_unowned_line', line: lineIndex + 1})
      continue
    }

    if (tag.closing) {
      if (activeSection) sectionLines.get(activeSection).push(line)
      const position = stack.map(item => item.tag).lastIndexOf(tag.name)
      if (position < 0) {
        diagnostics.push({code: 'closing_tag_without_opening', line: lineIndex + 1, tag: tag.name})
        markInvalid()
        continue
      }
      if (position !== stack.length - 1) {
        diagnostics.push({code: 'closing_tag_mismatch', line: lineIndex + 1, tag: tag.name})
        markInvalid()
        for (let cursor = stack.length - 1; cursor >= position; cursor -= 1) markInvalid(stack[cursor].section)
      }
      while (stack.length > position + 1) stack.pop()
      const completed = stack.pop()
      if (completed.tag === 'World Model Supplement') {
        sawRoot = true
        closedRoot = true
        if (activeSection) markInvalid()
      } else if (completed.tag === 'Discovery' || completed.tag === 'Candidate') {
        if (activeSection !== completed.tag) markInvalid(completed.tag)
        activeSection = null
      }
      continue
    }

    if (stack.length === 0) {
      if (tag.name !== 'World Model Supplement' || sawRoot || closedRoot) {
        diagnostics.push({code: 'supplement_root_invalid', line: lineIndex + 1, tag: tag.name})
        markInvalid()
        continue
      }
      stack.push({tag: tag.name, section: null})
      continue
    }

    if (stack.length === 1 && stack[0].tag === 'World Model Supplement') {
      if (tag.name !== 'Discovery' && tag.name !== 'Candidate') {
        diagnostics.push({code: 'supplement_section_invalid', line: lineIndex + 1, tag: tag.name})
        markInvalid()
        stack.push({tag: tag.name, section: activeSection})
        continue
      }
      if (activeSection || sectionLines.has(tag.name) || (tag.name === 'Discovery' && sectionOrder.includes('Candidate'))) {
        diagnostics.push({code: 'duplicate_or_out_of_order_section', line: lineIndex + 1, tag: tag.name})
        markInvalid(tag.name)
      }
      activeSection = tag.name
      sectionOrder.push(tag.name)
      sectionLines.set(tag.name, [line])
      stack.push({tag: tag.name, section: tag.name})
      continue
    }

    if (activeSection) sectionLines.get(activeSection).push(line)
    stack.push({tag: tag.name, section: activeSection})
  }

  if (stack.length) {
    for (const item of stack) {
      diagnostics.push({code: 'unclosed_tag', tag: item.tag})
      markInvalid(item.section)
    }
  }
  if (!sawRoot || !closedRoot) diagnostics.push({code: 'supplement_root_invalid'})
  if (!sectionLines.has('Discovery')) diagnostics.push({code: 'missing_discovery_section'})
  if (!sectionLines.has('Candidate')) diagnostics.push({code: 'missing_candidate_section'})
  if (sectionOrder.join('|') !== 'Discovery|Candidate') diagnostics.push({code: 'supplement_section_order_invalid'})
  if (diagnostics.length || invalidSections.size) throw supplementError('WORLD_MODEL_SUPPLEMENT_INVALID', diagnostics)

  const discovery = parseWorldModelDiscoveryText(sectionLines.get('Discovery').join('\n'))
  const candidate = parseWorldModelCandidateText(sectionBody(sectionLines.get('Candidate')))
  return {
    discoveryLedger: discovery.ledger,
    candidate: candidate.candidate,
    diagnostics: [...discovery.diagnostics, ...candidate.diagnostics],
  }
}

export function validateWorldModelDiscoveryLedger(ledger) {
  if (!ledger || typeof ledger !== 'object' || Array.isArray(ledger) || !Array.isArray(ledger.species)) {
    throw discoveryError('WORLD_MODEL_DISCOVERY_INVALID')
  }
  const validName = value => typeof value === 'string' && value.trim() !== ''
  const speciesNames = new Set()
  for (const species of ledger.species) {
    if (!species || typeof species !== 'object' || Array.isArray(species) || !validName(species.name) || !Array.isArray(species.biological_types)) {
      throw discoveryError('WORLD_MODEL_DISCOVERY_SPECIES_INVALID')
    }
    if (speciesNames.has(species.name)) throw discoveryError('WORLD_MODEL_DISCOVERY_DUPLICATE_IDENTITY', [{code: 'duplicate_species_identity', name: species.name}], 'WORLD_MODEL_DISCOVERY_DUPLICATE_IDENTITY')
    speciesNames.add(species.name)
    const typeNames = new Set()
    for (const type of species.biological_types) {
      if (!type || typeof type !== 'object' || Array.isArray(type) || !validName(type.name)) throw discoveryError('WORLD_MODEL_DISCOVERY_TYPE_INVALID')
      if (typeNames.has(type.name)) throw discoveryError('WORLD_MODEL_DISCOVERY_DUPLICATE_IDENTITY', [{code: 'duplicate_type_identity', species: species.name, name: type.name}], 'WORLD_MODEL_DISCOVERY_DUPLICATE_IDENTITY')
      typeNames.add(type.name)
    }
  }
  return ledger
}

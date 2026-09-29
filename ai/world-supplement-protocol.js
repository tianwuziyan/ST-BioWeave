
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

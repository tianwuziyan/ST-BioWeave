const HUMAN_SPECIES_NAMES = new Set([
  '人类',
  '人',
  'human',
  'humans',
  '人类human',
  'human人类',
  '人类人类',
  'homosapiens',
])

function humanAliasKey(value) {
  return String(value ?? '').replace(/\s+/gu, '').replace(/[()\uFF08\uFF09]/gu, '').toLowerCase()
}

function speciesText(value) {
  const name = typeof value === 'object' ? value?.name : value
  if (name === undefined || name === null || typeof name !== 'string') return null
  const text = name.trim()
  if (!text || ['unknown', 'null', 'undefined', 'n/a', '未知', '不确定'].includes(text.toLowerCase())) return null
  return text
}

export function isCanonicalWorldHumanSpecies(value) {
  return HUMAN_SPECIES_NAMES.has(humanAliasKey(speciesText(value)))
}

export function canonicalWorldSpeciesName(value) {
  const text = speciesText(value)
  if (!text) return null
  if (isCanonicalWorldHumanSpecies(text)) return '人类'
  return text
    .replace(/\bHomo\s+sapiens\b/gi, '人类')
    .replace(/\bHumans?\b/gi, '人类')
    .replace(/\bfemale\b/gi, '女性')
    .replace(/\bmale\b/gi, '男性')
    .replace(/双性\s*[\/／]\s*间性/gu, '双性')
}

export function canonicalWorldSpeciesIdentity(value) {
  return canonicalWorldSpeciesName(value)
}

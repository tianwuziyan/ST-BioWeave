const ARCHIVE_BY = 'manual'
import {canonicalWorldSpeciesIdentity} from './world-species-identity.js'

function clone(value) {
  if (value === undefined) return undefined
  if (typeof structuredClone === 'function') return structuredClone(value)
  if (Array.isArray(value)) return value.map(clone)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]))
  return value
}

export function normalizeWorldSpeciesIdentity(value) {
  return canonicalWorldSpeciesIdentity(value)
}

function speciesEntries(meta) {
  return Array.isArray(meta?.archived_species) ? meta.archived_species : []
}

export function normalizeArchivedSpecies(meta = {}) {
  const source = meta && typeof meta === 'object' ? meta : {}
  const entries = []
  const seen = new Set()
  for (const entry of speciesEntries(source)) {
    const species = entry?.species && typeof entry.species === 'object' ? clone(entry.species) : null
    const identity = normalizeWorldSpeciesIdentity(species)
    if (!identity || seen.has(identity)) continue
    seen.add(identity)
    entries.push({
      species,
      archived_at: typeof entry?.archived_at === 'string' && entry.archived_at ? entry.archived_at : null,
      archived_by: entry?.archived_by || ARCHIVE_BY,
    })
  }
  return { ...clone(source), archived_species: entries }
}

export function findArchivedWorldModelSpecies(meta = {}, identity) {
  const normalized = normalizeWorldSpeciesIdentity(identity)
  if (!normalized) return null
  return speciesEntries(normalizeArchivedSpecies(meta)).find(entry => normalizeWorldSpeciesIdentity(entry.species) === normalized) ?? null
}

export function listArchivedWorldModelSpecies(meta = {}) {
  return normalizeArchivedSpecies(meta).archived_species
}

export function isWorldModelSpeciesArchived(meta = {}, identity) {
  return Boolean(findArchivedWorldModelSpecies(meta, identity))
}

export function buildArchivedSpeciesReference(meta = {}) {
  return listArchivedWorldModelSpecies(meta)
    .map(entry => ({name: String(entry.species?.name ?? '').trim()}))
    .filter(entry => entry.name)
}

export function archiveWorldModelSpecies(model = {}, meta = {}, speciesOrIndex, {archivedAt = new Date().toISOString(), archivedBy = ARCHIVE_BY} = {}) {
  const nextModel = clone(model ?? {})
  nextModel.species = Array.isArray(nextModel.species) ? nextModel.species : []
  const index = Number.isInteger(speciesOrIndex)
    ? speciesOrIndex
    : nextModel.species.findIndex(item => normalizeWorldSpeciesIdentity(item) === normalizeWorldSpeciesIdentity(speciesOrIndex))
  const species = index >= 0 && index < nextModel.species.length ? nextModel.species[index] : null
  if (!species || !normalizeWorldSpeciesIdentity(species)) return {model: nextModel, meta: normalizeArchivedSpecies(meta), changed: false, reason: 'SPECIES_NOT_FOUND'}
  const normalizedMeta = normalizeArchivedSpecies(meta)
  const identity = normalizeWorldSpeciesIdentity(species)
  if (normalizedMeta.archived_species.some(entry => normalizeWorldSpeciesIdentity(entry.species) === identity))
    return {model: nextModel, meta: normalizedMeta, changed: false, reason: 'SPECIES_ALREADY_ARCHIVED'}
  nextModel.species.splice(index, 1)
  normalizedMeta.archived_species.push({species: clone(species), archived_at: archivedAt, archived_by: archivedBy})
  return {model: nextModel, meta: normalizedMeta, changed: true}
}

export function restoreWorldModelSpecies(model = {}, meta = {}, speciesOrIndex) {
  const nextModel = clone(model ?? {})
  nextModel.species = Array.isArray(nextModel.species) ? nextModel.species : []
  const normalizedMeta = normalizeArchivedSpecies(meta)
  const index = Number.isInteger(speciesOrIndex)
    ? speciesOrIndex
    : normalizedMeta.archived_species.findIndex(entry => normalizeWorldSpeciesIdentity(entry.species) === normalizeWorldSpeciesIdentity(speciesOrIndex))
  const entry = index >= 0 && index < normalizedMeta.archived_species.length ? normalizedMeta.archived_species[index] : null
  if (!entry?.species) return {model: nextModel, meta: normalizedMeta, changed: false, reason: 'ARCHIVED_SPECIES_NOT_FOUND'}
  const identity = normalizeWorldSpeciesIdentity(entry.species)
  if (nextModel.species.some(item => normalizeWorldSpeciesIdentity(item) === identity))
    return {model: nextModel, meta: normalizedMeta, changed: false, reason: 'ACTIVE_SPECIES_COLLISION'}
  nextModel.species.push(clone(entry.species))
  normalizedMeta.archived_species.splice(index, 1)
  return {model: nextModel, meta: normalizedMeta, changed: true}
}

export function filterArchivedWorldModelSpecies(model = {}, meta = {}) {
  const next = clone(model ?? {})
  const archived = new Set(buildArchivedSpeciesReference(meta).map(item => normalizeWorldSpeciesIdentity(item)))
  next.species = (Array.isArray(next.species) ? next.species : []).filter(item => !archived.has(normalizeWorldSpeciesIdentity(item)))
  return next
}

export function archivedWorldModelSpeciesDiagnostic(identity) {
  return {code: 'ARCHIVED_SPECIES_EXCLUDED', identity: normalizeWorldSpeciesIdentity(identity)}
}

export function isArchivedWorldModelFact(fact, meta = {}) {
  const archived = new Set(buildArchivedSpeciesReference(meta).map(item => normalizeWorldSpeciesIdentity(item)))
  const species = normalizeWorldSpeciesIdentity(fact?.species)
  return Boolean(species && archived.has(species))
}

export const normalizeSpeciesIdentity = normalizeWorldSpeciesIdentity
export const normalizeWorldSpeciesArchiveMeta = normalizeArchivedSpecies
export const listArchivedSpecies = listArchivedWorldModelSpecies
export const buildWorldSpeciesArchiveReferences = buildArchivedSpeciesReference
export const filterArchivedSpecies = filterArchivedWorldModelSpecies

export function isSpeciesArchived(identity, meta = {}) {
  return isWorldModelSpeciesArchived(meta, identity)
}

export const WORLD_SPECIES_ARCHIVE_DUPLICATE = 'SPECIES_ALREADY_ARCHIVED'
export const WORLD_SPECIES_ARCHIVE_RESTORE_COLLISION = 'ACTIVE_SPECIES_COLLISION'

export function archiveWorldSpecies(model, meta, speciesOrIndex, options = {}) {
  const result = archiveWorldModelSpecies(model, meta, speciesOrIndex, options)
  return result.changed ? result : {...result, code: result.reason}
}

export function restoreWorldSpecies(model, meta, speciesOrIndex) {
  const result = restoreWorldModelSpecies(model, meta, speciesOrIndex)
  return result.changed ? result : {...result, code: result.reason}
}

function operationSpeciesIdentity(operation) {
  if (operation?.op === 'ADD_SPECIES') return operation.species?.name
  return operation?.target?.species_name ?? operation?.species_name
}

export function rejectArchivedSpeciesOperation(operation, meta = {}) {
  const identity = operationSpeciesIdentity(operation)
  if (!identity || !isWorldModelSpeciesArchived(meta, identity)) return null
  return {
    code: 'ARCHIVED_SPECIES_EXCLUDED',
    diagnostic_code: 'ARCHIVED_SPECIES_EXCLUDED',
    species: String(identity).trim(),
    operation: operation?.op ?? null,
  }
}

export function rejectArchivedSpeciesFact(fact, meta = {}) {
  if (fact?.scope === 'world') return null
  const identity = fact?.species
  if (!identity || !isWorldModelSpeciesArchived(meta, identity)) return null
  return {
    code: 'ARCHIVED_SPECIES_EXCLUDED',
    diagnostic_code: 'ARCHIVED_SPECIES_EXCLUDED',
    species: String(identity).trim(),
    field: fact?.field ?? null,
  }
}

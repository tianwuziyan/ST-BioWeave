import { hashText } from './hash.js';

function stableValue(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(stableValue);
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
}

export function stableWorldModelStringify(value) {
  return JSON.stringify(stableValue(value));
}

export async function fingerprintWorldModel(value) {
  if (value === null || value === undefined) {
    return {status: 'null', full_hash: null, fingerprint: null};
  }
  const canonical = stableWorldModelStringify(value);
  const fullHash = await hashText(canonical);
  return {
    status: 'present',
    full_hash: `sha256:${fullHash}`,
    fingerprint: `sha256:${fullHash.slice(0, 12)}...`,
  };
}

export async function fingerprintWorldModelString(canonical) {
  if (canonical === null || canonical === undefined) {
    return {status: 'unavailable', full_hash: null, fingerprint: null};
  }
  const fullHash = await hashText(canonical);
  return {
    status: 'present',
    full_hash: `sha256:${fullHash}`,
    fingerprint: `sha256:${fullHash.slice(0, 12)}...`,
  };
}

function modelAddresses(model) {
  const addresses = new Set();
  for (const species of Array.isArray(model?.species) ? model.species : []) {
    const speciesName = typeof species?.name === 'string' ? species.name.trim() : '';
    if (!speciesName) continue;
    addresses.add(speciesName);
    for (const type of Array.isArray(species.biological_types) ? species.biological_types : []) {
      const typeName = typeof type?.name === 'string' ? type.name.trim() : '';
      if (typeName) addresses.add(`${speciesName} / ${typeName}`);
    }
  }
  return [...addresses].sort((left, right) => left.localeCompare(right));
}

function modelCounts(model) {
  const species = Array.isArray(model?.species) ? model.species : [];
  return {
    species_count: species.length,
    biological_type_count: species.reduce(
      (count, item) => count + (Array.isArray(item?.biological_types) ? item.biological_types.length : 0),
      0,
    ),
  };
}

export function worldModelAddressInventory(model) {
  return modelAddresses(model);
}

export function worldModelCounts(model) {
  return modelCounts(model);
}

export async function buildWorldModelLayerSnapshot({model = null, viewModel = null, source = 'unknown', unavailableReason = null} = {}) {
  const fingerprint = model !== null && model !== undefined
    ? await fingerprintWorldModel(model)
    : {status: unavailableReason ? 'unavailable' : 'null', full_hash: null, fingerprint: null};
  const counts = modelCounts(model);
  let viewModelFingerprint = null;
  if (viewModel !== null && viewModel !== undefined) viewModelFingerprint = await fingerprintWorldModel(viewModel);
  return {
    source,
    model_present: model !== null && model !== undefined,
    fingerprint: fingerprint.fingerprint,
    full_hash: fingerprint.full_hash,
    fingerprint_status: fingerprint.status,
    unavailable_reason: unavailableReason,
    ...counts,
    addresses: modelAddresses(model),
    ...(viewModelFingerprint
      ? {view_model_fingerprint: viewModelFingerprint.fingerprint, view_model_full_hash: viewModelFingerprint.full_hash}
      : {}),
  };
}

export async function buildRenderedWorldLayerSnapshot({canonicalSerialized = null, viewModelSerialized = null, counts = {}, addresses = [], rendered_at = null} = {}) {
  const fingerprint = await fingerprintWorldModelString(canonicalSerialized);
  const viewModelFingerprint = await fingerprintWorldModelString(viewModelSerialized);
  return {
    source: 'last_render_diagnostic',
    model_present: fingerprint.status === 'present',
    fingerprint_status: fingerprint.status,
    fingerprint: fingerprint.fingerprint,
    full_hash: fingerprint.full_hash,
    view_model_fingerprint: viewModelFingerprint.fingerprint,
    view_model_full_hash: viewModelFingerprint.full_hash,
    ...counts,
    addresses: [...addresses],
    rendered_at,
  };
}

function compareFingerprint(left, right) {
  if (!left || !right || left.fingerprint_status === 'unavailable' || right.fingerprint_status === 'unavailable') return 'UNAVAILABLE';
  if (left.fingerprint_status === 'null' || right.fingerprint_status === 'null') return 'UNAVAILABLE';
  return left.full_hash === right.full_hash ? 'MATCH' : 'MISMATCH';
}

export function compareWorldModelLayers(layers = {}) {
  const pairs = {
    runtime_vs_floor: ['runtime', 'floor'],
    floor_vs_ui: ['floor', 'ui'],
    ui_vs_last_render: ['ui', 'last_render'],
    runtime_vs_ui: ['runtime', 'ui'],
  };
  const worldConsistency = Object.fromEntries(
    Object.entries(pairs).map(([key, [left, right]]) => [key, compareFingerprint(layers[left], layers[right])]),
  );
  return {
    world_consistency: worldConsistency,
    mismatch_layers: Object.entries(worldConsistency).filter(([, value]) => value === 'MISMATCH').map(([key]) => key),
  };
}

function difference(left = [], right = []) {
  const rightSet = new Set(right);
  return left.filter(item => !rightSet.has(item));
}

export function diffWorldModelAddresses(layers = {}) {
  const addresses = name => Array.isArray(layers[name]?.addresses) ? layers[name].addresses : [];
  return {
    runtime_not_in_floor: difference(addresses('runtime'), addresses('floor')),
    floor_not_in_runtime: difference(addresses('floor'), addresses('runtime')),
    floor_not_in_ui: difference(addresses('floor'), addresses('ui')),
    ui_not_in_floor: difference(addresses('ui'), addresses('floor')),
    ui_not_in_render: difference(addresses('ui'), addresses('last_render')),
    render_not_in_ui: difference(addresses('last_render'), addresses('ui')),
  };
}

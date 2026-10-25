export const FLOOR_OWNER_FIELDS = Object.freeze([
  'chat_id',
  'message_id',
  'floor',
  'swipe_id',
]);

function hasValue(value) {
  if (value === undefined || value === null) return false;
  return typeof value !== 'string' || value.trim() !== '';
}

export function normalizeFloorOwner(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return Object.fromEntries(FLOOR_OWNER_FIELDS.map(field => [field, value[field] ?? null]));
}

export function hasCompleteFloorOwner(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
    && FLOOR_OWNER_FIELDS.every(field => (
      Object.prototype.hasOwnProperty.call(value, field) && hasValue(value[field])
    ));
}

export function sameFloorOwner(left, right) {
  return hasCompleteFloorOwner(left)
    && hasCompleteFloorOwner(right)
    && FLOOR_OWNER_FIELDS.every(field => left[field] === right[field]);
}

export function floorOwnerKey(value) {
  return hasCompleteFloorOwner(value)
    ? FLOOR_OWNER_FIELDS.map(field => JSON.stringify(value[field])).join('|')
    : null;
}

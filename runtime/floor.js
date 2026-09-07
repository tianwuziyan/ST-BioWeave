const FLOOR_VERSION_FIELDS = [
  'chat_id',
  'message_id',
  'floor',
  'swipe_id',
  'content_hash',
  'message_version',
];

export async function hashText(text = '') {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.subtle) throw new Error('CRYPTO_SUBTLE_UNAVAILABLE');
  const source = text == null ? '' : String(text);
  const buffer = await cryptoApi.subtle.digest('SHA-256', new TextEncoder().encode(source));
  return [...new Uint8Array(buffer)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function floorVersion({
  chatId,
  messageId,
  floor,
  swipeId = 0,
  text = '',
  messageVersion,
}) {
  const contentHash = await hashText(text);
  return {
    chat_id: chatId,
    message_id: messageId,
    floor,
    swipe_id: swipeId,
    content_hash: contentHash,
    message_version: messageVersion ?? `v1:${contentHash}`,
  };
}

export function sameFloorVersion(left, right) {
  if (!left || !right) return false;
  return FLOOR_VERSION_FIELDS.every(field => (
    left[field] !== undefined
    && right[field] !== undefined
    && left[field] === right[field]
  ));
}

function analysisRecord(meta) {
  return meta?.analysis && typeof meta.analysis === 'object' ? meta.analysis : meta;
}

function savedVersion(meta) {
  const record = analysisRecord(meta);
  return record?.floor_version ?? record?.version ?? null;
}

export function shouldAnalyze(meta, {version, manual = false} = {}) {
  if (manual) return true;
  const record = analysisRecord(meta);
  if (!record || record.status !== 'success') return true;
  if (!version) return false;
  return !sameFloorVersion(savedVersion(meta), version);
}

function clone(value) {
  if (value === undefined || value === null) return value;
  if (typeof structuredClone === 'function') return structuredClone(value);
  if (Array.isArray(value)) return value.map(clone);
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
  return value;
}

function isSuccessful(meta) {
  return analysisRecord(meta)?.status === 'success';
}

export function commitAnalysis(previous, attempt, version) {
  const attemptRecord = {
    ...clone(attempt),
    floor_version: clone(version),
  };
  if (isSuccessful(attempt)) {
    return {
      ...attemptRecord,
      status: 'success',
    };
  }

  const previousSuccess = isSuccessful(previous)
    ? previous
    : isSuccessful(previous?.last_success)
      ? previous.last_success
      : null;
  if (previousSuccess) {
    return {
      ...clone(previousSuccess),
      status: 'failed',
      floor_version: clone(version),
      last_success: clone(previousSuccess),
      last_attempt: attemptRecord,
      last_error: attempt?.error ?? attempt?.message ?? null,
    };
  }

  return {
    ...attemptRecord,
    status: 'failed',
    last_attempt: attemptRecord,
    last_error: attempt?.error ?? attempt?.message ?? null,
  };
}

export function isIntervalTarget(floor, lastFloor, interval = 3) {
  if (interval < 1) return false;
  return lastFloor == null ? floor >= interval : floor - lastFloor >= interval;
}

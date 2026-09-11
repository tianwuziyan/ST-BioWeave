export const FLOOR_VERSION_FIELDS = Object.freeze([
  'chat_id',
  'message_id',
  'floor',
  'swipe_id',
  'content_hash',
  'message_version',
]);

const SHA256_INITIAL_HASH = Object.freeze([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
  0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
]);

const SHA256_ROUND_CONSTANTS = Object.freeze([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
  0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
  0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
  0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotateRight(value, bits) {
  return (value >>> bits) | (value << (32 - bits));
}

function bytesToHex(bytes) {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

function wordToHex(word) {
  return word.toString(16).padStart(8, '0');
}

// HTTP SillyTavern pages can expose crypto without crypto.subtle. Keep this
// fallback dependency-free so Floor Version identity remains compatible.
function sha256Fallback(bytes) {
  const bitLength = bytes.length * 8;
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;

  const bitLengthHigh = Math.floor(bitLength / 0x100000000);
  const bitLengthLow = bitLength >>> 0;
  const lengthOffset = paddedLength - 8;
  padded[lengthOffset] = bitLengthHigh >>> 24;
  padded[lengthOffset + 1] = bitLengthHigh >>> 16;
  padded[lengthOffset + 2] = bitLengthHigh >>> 8;
  padded[lengthOffset + 3] = bitLengthHigh;
  padded[lengthOffset + 4] = bitLengthLow >>> 24;
  padded[lengthOffset + 5] = bitLengthLow >>> 16;
  padded[lengthOffset + 6] = bitLengthLow >>> 8;
  padded[lengthOffset + 7] = bitLengthLow;

  const hash = [...SHA256_INITIAL_HASH];
  const words = new Uint32Array(64);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      const position = offset + index * 4;
      words[index] = (
        (padded[position] << 24)
        | (padded[position + 1] << 16)
        | (padded[position + 2] << 8)
        | padded[position + 3]
      ) >>> 0;
    }
    for (let index = 16; index < 64; index += 1) {
      const previous15 = words[index - 15];
      const previous2 = words[index - 2];
      const smallSigma0 = rotateRight(previous15, 7) ^ rotateRight(previous15, 18) ^ (previous15 >>> 3);
      const smallSigma1 = rotateRight(previous2, 17) ^ rotateRight(previous2, 19) ^ (previous2 >>> 10);
      words[index] = (words[index - 16] + smallSigma0 + words[index - 7] + smallSigma1) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = hash;
    for (let index = 0; index < 64; index += 1) {
      const bigSigma1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choice = (e & f) ^ ((~e) & g);
      const temporary1 = (h + bigSigma1 + choice + SHA256_ROUND_CONSTANTS[index] + words[index]) >>> 0;
      const bigSigma0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temporary2 = (bigSigma0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temporary1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temporary1 + temporary2) >>> 0;
    }
    hash[0] = (hash[0] + a) >>> 0;
    hash[1] = (hash[1] + b) >>> 0;
    hash[2] = (hash[2] + c) >>> 0;
    hash[3] = (hash[3] + d) >>> 0;
    hash[4] = (hash[4] + e) >>> 0;
    hash[5] = (hash[5] + f) >>> 0;
    hash[6] = (hash[6] + g) >>> 0;
    hash[7] = (hash[7] + h) >>> 0;
  }
  return hash.map(wordToHex).join('');
}

export async function hashText(text = '') {
  const cryptoApi = globalThis.crypto;
  const source = text == null ? '' : String(text);
  const bytes = new TextEncoder().encode(source);
  const digest = cryptoApi?.subtle?.digest;
  if (typeof digest === 'function') {
    // Do not hide a real WebCrypto digest failure; only missing capability
    // falls back to the compatible pure-JS implementation.
    const buffer = await digest.call(cryptoApi.subtle, 'SHA-256', bytes);
    return bytesToHex(new Uint8Array(buffer));
  }
  return sha256Fallback(bytes);
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

function hasVersionValue(value) {
  if (value === undefined || value === null) return false;
  return typeof value !== 'string' || value.trim() !== '';
}

export function hasCompleteFloorVersion(version) {
  if (!version || typeof version !== 'object' || Array.isArray(version)) return false;
  return FLOOR_VERSION_FIELDS.every(field => (
    Object.prototype.hasOwnProperty.call(version, field)
    && hasVersionValue(version[field])
  ));
}

export function sameFloorVersion(left, right) {
  if (!hasCompleteFloorVersion(left) || !hasCompleteFloorVersion(right)) return false;
  return FLOOR_VERSION_FIELDS.every(field => (
    left[field] === right[field]
  ));
}

export function floorVersionFromData(data) {
  if (!data || typeof data !== 'object') return null;
  return data?.analysis?.floor_version ?? data?.floor_version ?? null;
}

export function eventSourceMatchesFloorVersion(eventOrSource, version) {
  const source = eventOrSource?.source && typeof eventOrSource.source === 'object'
    ? eventOrSource.source
    : eventOrSource;
  return sameFloorVersion(source, version);
}

// Read only facts produced for the authoritative current Floor Version.  A
// missing/incomplete version intentionally yields no events rather than
// treating a previous successful result as active.
export function getActiveFloorEvents(floorOrEvents, version) {
  if (!hasCompleteFloorVersion(version)) return [];
  const events = Array.isArray(floorOrEvents) ? floorOrEvents : floorOrEvents?.events;
  if (!Array.isArray(events)) return [];
  return events.filter(event => eventSourceMatchesFloorVersion(event, version));
}

export const activeFloorEvents = getActiveFloorEvents;

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

function attemptStatus(attempt) {
  return attempt?.status === 'cancelled' ? 'cancelled' : 'failed';
}

function attemptErrorCode(attempt) {
  return attempt?.error_code
    ?? attempt?.error
    ?? attempt?.code
    ?? attempt?.message
    ?? null;
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
      status: attemptStatus(attempt),
      floor_version: clone(version),
      last_success: clone(previousSuccess),
      last_attempt: attemptRecord,
      last_error: attemptErrorCode(attempt),
      error_code: attemptErrorCode(attempt),
      error_stage: attempt?.stage ?? null,
      safe_error_summary: attempt?.safe_error_summary ?? null,
    };
  }

  return {
    ...attemptRecord,
    status: attemptStatus(attempt),
    last_attempt: attemptRecord,
    last_error: attemptErrorCode(attempt),
    error_code: attemptErrorCode(attempt),
    error_stage: attempt?.stage ?? null,
    safe_error_summary: attempt?.safe_error_summary ?? null,
  };
}

export function isIntervalTarget(floor, lastFloor, interval = 3) {
  if (interval < 1) return false;
  return lastFloor == null ? floor >= interval : floor - lastFloor >= interval;
}

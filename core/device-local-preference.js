function readStorageCandidate(readCandidate) {
  try {
    return readCandidate() ?? null
  } catch {
    return null
  }
}

export function resolveDeviceLocalStorage({documentRef = globalThis.document, windowRef, storageRef} = {}) {
  if (storageRef !== undefined && storageRef !== null) return storageRef
  const resolvedWindow = windowRef ?? documentRef?.defaultView
  const candidates = [
    () => resolvedWindow?.localStorage,
    () => documentRef?.defaultView?.localStorage,
    () => globalThis.localStorage,
  ]
  for (const readCandidate of candidates) {
    const candidate = readStorageCandidate(readCandidate)
    if (candidate) return candidate
  }
  return null
}

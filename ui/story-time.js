export function resolveStoryTimeDifference(precomputedDifferences = {}, eventId = '') {
  if (Object.prototype.hasOwnProperty.call(precomputedDifferences ?? {}, eventId)) {
    return precomputedDifferences[eventId]
  }
  return null
}

export function formatStoryTimeRelative(difference) {
  if (!difference) return ''
  const value = Number(difference.value)
  if (!Number.isFinite(value)) return ''
  if (value === 0) return difference.unit === 'minute' ? '同一时间' : '今天'
  const suffix = value > 0 ? '前' : '后'
  const magnitude = Math.abs(value)
  if (difference.unit === 'minute') {
    const hours = Math.floor(magnitude / 60)
    const minutes = magnitude % 60
    if (hours && minutes) return `${hours}小时${minutes}分钟${suffix}`
    if (hours) return `${hours}小时${suffix}`
    return `${minutes}分钟${suffix}`
  }
  return `${magnitude}天${suffix}`
}

// 中文日期纯函数：保持 SevenDaysCal 的输入顺序和失败返回约定。
export const _CN_NUM_MAP = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  两: 2,
  兩: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
  廿: 20,
  卄: 20,
  卅: 30,
  卌: 40,
  壹: 1,
  贰: 2,
  貳: 2,
  叁: 3,
  參: 3,
  叄: 3,
  肆: 4,
  伍: 5,
  陆: 6,
  陸: 6,
  柒: 7,
  捌: 8,
  玖: 9,
  拾: 10,
  佰: 100,
  仟: 1000,
}
export const _CN_MONTH_ALIAS = {
  正: 1,
  正月: 1,
  孟春: 1,
  初春: 1,
  早春: 1,
  上春: 1,
  端春: 1,
  端月: 1,
  征月: 1,
  初月: 1,
  泰月: 1,
  杨月: 1,
  寅月: 1,
  孟阳: 1,
  春阳: 1,
  初阳: 1,
  首阳: 1,
  新正: 1,
  月正: 1,
  开岁: 1,
  献岁: 1,
  芳岁: 1,
  华岁: 1,
  岁岁: 1,
  仲春: 2,
  中春: 2,
  甜春: 2,
  正春: 2,
  仲阳: 2,
  如月: 2,
  杏月: 2,
  丽月: 2,
  令月: 2,
  卯月: 2,
  花朝: 2,
  竹秋: 2,
  季春: 3,
  暮春: 3,
  晚春: 3,
  末春: 3,
  嘉月: 3,
  蚕月: 3,
  花月: 3,
  桃月: 3,
  桃浪: 3,
  初夏: 4,
  首夏: 4,
  孟夏: 4,
  维夏: 4,
  槐夏: 4,
  仲月: 4,
  梅月: 4,
  阴月: 4,
  乏月: 4,
  麦月: 4,
  余月: 4,
  巳月: 4,
  槐月: 4,
  清和月: 4,
  中吕: 4,
  麦候: 4,
  麦秋: 4,
  仲夏: 5,
  中夏: 5,
  榴月: 5,
  蒲月: 5,
  午月: 5,
  皋月: 5,
  天中: 5,
  端阳: 5,
  季夏: 6,
  晚夏: 6,
  暮夏: 6,
  暑月: 6,
  季月: 6,
  荷月: 6,
  伏月: 6,
  首秋: 7,
  早秋: 7,
  新秋: 7,
  初秋: 7,
  孟秋: 7,
  上秋: 7,
  兰秋: 7,
  申月: 7,
  兰月: 7,
  巧月: 7,
  相月: 7,
  霜月: 7,
  仲秋: 8,
  正秋: 8,
  桂月: 8,
  壮月: 8,
  酉月: 8,
  获月: 8,
  仲商: 8,
  南吕: 8,
  暮秋: 9,
  晚秋: 9,
  季秋: 9,
  凉秋: 9,
  菊月: 9,
  戌月: 9,
  玄月: 9,
  秋白: 9,
  霜序: 9,
  暮商: 9,
  季商: 9,
  初冬: 10,
  孟冬: 10,
  上冬: 10,
  开冬: 10,
  吉月: 10,
  良月: 10,
  坤月: 10,
  阳月: 10,
  小阳春: 10,
  亥月: 10,
  应钟: 10,
  冬: 11,
  仲冬: 11,
  中冬: 11,
  子月: 11,
  辜月: 11,
  龙潜月: 11,
  葭月: 11,
  畅月: 11,
  黄钟: 11,
  腊: 12,
  臘: 12,
  严冬: 12,
  季冬: 12,
  残冬: 12,
  末冬: 12,
  暮冬: 12,
  穷冬: 12,
  腊冬: 12,
  严月: 12,
  腊月: 12,
  冰月: 12,
  大吕: 12,
}
export const _CN_FESTIVAL_ALIAS = {
  正朝: { month: 1, day: 1 },
  三朝: { month: 1, day: 1 },
  元春: { month: 1, day: 1 },
  元旦: { month: 1, day: 1 },
  元日: { month: 1, day: 1 },
  无朔: { month: 1, day: 1 },
  元正: { month: 1, day: 1 },
  人日: { month: 1, day: 7 },
  人曰: { month: 1, day: 7 },
  元宵: { month: 1, day: 15 },
  元夕: { month: 1, day: 15 },
  元夜: { month: 1, day: 15 },
  上元: { month: 1, day: 15 },
  灯节: { month: 1, day: 15 },
  中和日: { month: 2, day: 1 },
  重三: { month: 3, day: 3 },
  上巳: { month: 3, day: 3 },
  三巳: { month: 3, day: 3 },
  上除: { month: 3, day: 3 },
  令节: { month: 3, day: 3 },
  浴佛日: { month: 4, day: 8 },
  浣花日: { month: 4, day: 19 },
  端午: { month: 5, day: 5 },
  端午节: { month: 5, day: 5 },
  蒲节: { month: 5, day: 5 },
  午日: { month: 5, day: 5 },
  天贶节: { month: 6, day: 6 },
  七夕: { month: 7, day: 7 },
  星节: { month: 7, day: 7 },
  乞巧节: { month: 7, day: 7 },
  中元: { month: 7, day: 15 },
  中元节: { month: 7, day: 15 },
  中秋: { month: 8, day: 15 },
  中秋节: { month: 8, day: 15 },
  仲秋节: { month: 8, day: 15 },
  重阳: { month: 9, day: 9 },
  重阳节: { month: 9, day: 9 },
  菊花节: { month: 9, day: 9 },
  重九: { month: 9, day: 9 },
  下元: { month: 10, day: 15 },
  下元节: { month: 10, day: 15 },
  除夕: { month: 12, day: 30 },
  守岁: { month: 12, day: 30 },
}
export function normalizeCnDateDigits(value) {
  return String(value ?? '').replace(/[０-９]/g, ch => String(ch.charCodeAt(0) - 0xff10))
}
export function _cnToNumber(s) {
  if (!s) return null
  if (s === '元') return 1
  s = normalizeCnDateDigits(s)
  if (/^\d+$/.test(s)) return parseInt(s, 10)
  if (s.length === 1) return _CN_NUM_MAP[s] ?? null
  // 廿三=23 / 卅一=31（农历日常写 廿一~廿九，偶见卅）：首字定 20/30，其后为个位。
  if (s[0] === '廿' || s[0] === '卄' || s[0] === '卅') {
    const ones = _CN_NUM_MAP[s.slice(1)]
    if (ones != null && ones < 10) return _CN_NUM_MAP[s[0]] + ones
    return null
  }
  const t = s.replace(/拾/g, '十').replace(/佰/g, '百').replace(/仟/g, '千')
  if (t.includes('千') || t.includes('百')) {
    let total = 0
    let rest = t
    for (const [unit, factor] of [
      ['千', 1000],
      ['百', 100],
    ]) {
      const parts = rest.split(unit)
      if (parts.length > 1) {
        total += (parts[0] ? (_CN_NUM_MAP[parts[0]] ?? Number(parts[0])) : 1) * factor
        rest = parts.slice(1).join(unit)
      }
    }
    if (rest) {
      const tail = _cnToNumber(rest)
      if (tail != null) total += tail
    }
    return total || null
  }
  if (t.includes('十')) {
    const [a, b] = t.split('十')
    const tens = a === '' ? 1 : _CN_NUM_MAP[a]
    const ones = b === '' ? 0 : _CN_NUM_MAP[b]
    if (tens != null && ones != null) return tens * 10 + ones
  }
  return null
}
function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
function aliasPattern(alias) {
  return Object.keys(alias)
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join('|')
}
const CN_NUMBER_TOKEN = '零〇一二两兩三四五六七八九十廿卄卅卌壹贰貳叁參叄肆伍陆陸柒捌玖拾佰仟'
const CN_NUMBER_RE = `[${CN_NUMBER_TOKEN}]+`
const DAY_RE = `(初(?:${CN_NUMBER_RE})|\\d{1,2}|${CN_NUMBER_RE})`
const DATE_BOUNDARY = '[\\s|｜,，、;；=＝]'
function calendarIsGregorian(calendar) {
  return calendar == null || calendar.kind === 'gregorian' || calendar.id === 'default-gregorian'
}
function defaultValidMonthDay(month, day, calendar) {
  if (!Number.isInteger(month) || !Number.isInteger(day) || month < 1 || day < 1) return null
  const monthCount = calendarIsGregorian(calendar) ? 12 : Array.isArray(calendar?.months) ? calendar.months.length : 0
  if (month > monthCount) return null
  const monthDays = calendarIsGregorian(calendar)
    ? [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]
    : Number(calendar.months[month - 1]?.days || 0)
  return day <= monthDays ? { month, day } : null
}
function validRealDate(year, month, day) {
  if (![year, month, day].every(Number.isInteger) || month < 1 || month > 12 || day < 1 || day > 31) return null
  const d = new Date(0)
  d.setUTCHours(0, 0, 0, 0)
  d.setUTCFullYear(year, month - 1, day)
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day ? d : null
}
function monthFromToken(token, monthAlias) {
  const value = String(token || '').replace(/\s/g, '')
  const withoutSuffix = value.endsWith('月') ? value.slice(0, -1) : value
  return monthAlias[value] ?? monthAlias[withoutSuffix] ?? _cnToNumber(withoutSuffix)
}
function dayFromToken(token) {
  const value = String(token || '').replace(/^初/, '')
  return _cnToNumber(value)
}
function monthTokenPattern(monthAlias = _CN_MONTH_ALIAS) {
  const aliases = aliasPattern(monthAlias)
  return `(?:(?:${aliases}|\\d{1,2}|${CN_NUMBER_RE})\\s*月|(?:${aliases}))`
}
function formalMonthDescriptors(calendar) {
  return (calendar?.months || [])
    .map((month, index) => ({ index, name: String(month?.name || '').trim() }))
    .filter(item => item.name)
    .sort((a, b) => b.name.length - a.name.length)
}
function matchFormalMonthDate(text, calendar) {
  for (const { index, name } of formalMonthDescriptors(calendar)) {
    const escaped = escapeRegExp(name)
    const match = new RegExp(`${escaped}\\s*(?:第\\s*)?${DAY_RE}\\s*日?`).exec(text)
    if (!match) continue
    const day = dayFromToken(match[1])
    if (day != null) return { month: index + 1, day, index: match.index }
  }
  return null
}
function parseFullFormalMonthDate(text, options) {
  for (const { index, name } of formalMonthDescriptors(options.calendar)) {
    const match = new RegExp(
      `(?:^|${DATE_BOUNDARY})((?:元|${CN_NUMBER_RE})|\\d{1,4})\\s*年\\s*${escapeRegExp(name)}\\s*${DAY_RE}\\s*日?(?=$|${DATE_BOUNDARY}|周|週|星期|礼拜|禮拜)`,
    ).exec(text)
    if (!match) continue
    const day = dayFromToken(match[2])
    const value = normalizeParsedDate({month: index + 1, day}, options, parseYearToken(match[1]))
    if (value) return value
  }
  return null
}
function matchFestival(text, festivalAlias) {
  const match = new RegExp(aliasPattern(festivalAlias)).exec(text)
  if (!match) return null
  const value = festivalAlias[match[0]]
  return value ? { ...value, index: match.index, alias: match[0] } : null
}
function matchMonthDate(text, monthAlias = _CN_MONTH_ALIAS) {
  const match = new RegExp(`${monthTokenPattern(monthAlias)}\\s*${DAY_RE}\\s*日?`).exec(text)
  if (!match) return null
  const token = match[0].replace(/\s*(?:日)?$/, '').match(new RegExp(`^(.+?)(?:\\s*)${DAY_RE}(?:\\s*日)?$`))
  if (!token) return null
  const month = monthFromToken(token[1], monthAlias)
  const day = dayFromToken(token[2])
  return month != null && day != null ? { month, day, index: match.index } : null
}
function findMonthOrFestivalDate(text, options) {
  const festival = matchFestival(text, options.festivalAlias)
  const monthDate = matchMonthDate(text, options.monthAlias)
  const formal = matchFormalMonthDate(text, options.calendar)
  const candidates = [festival, monthDate, formal].filter(Boolean).sort((a, b) => a.index - b.index)
  return candidates[0] || null
}
function normalizeParsedDate(value, options, year = null, eraLabel = null) {
  if (!value || !Number.isInteger(value.month) || !Number.isInteger(value.day)) return null
  const monthDay =
    typeof options.validMonthDay === 'function'
      ? options.validMonthDay({ month: value.month, day: value.day }, options.calendar)
      : defaultValidMonthDay(value.month, value.day, options.calendar)
  if (!monthDay) return null
  if (year != null && (!Number.isInteger(year) || year < 1 || year > 9999)) return null
  const gregorian = calendarIsGregorian(options.calendar)
  if (year != null && !eraLabel && gregorian && typeof options.validRealDate === 'function' && !options.validRealDate(year, value.month, value.day))
    return null
  if (year != null && !eraLabel && gregorian && options.validRealDate == null && !validRealDate(year, value.month, value.day)) return null
  return {
    ...monthDay,
    ...(year != null ? { year } : {}),
    ...(eraLabel ? { eraLabel } : {}),
  }
}
function readMonthDate(text, options, start = 0) {
  const hit = findMonthOrFestivalDate(text.slice(start), options)
  return hit ? { ...hit, index: hit.index + start } : null
}
function parseYearToken(token) {
  return /^\d+$/.test(token) ? +token : _cnToNumber(token)
}
function parseFullChineseDate(text, options) {
  const monthRe = monthTokenPattern(options.monthAlias)
  const match = new RegExp(
    `(?:^|${DATE_BOUNDARY})((?:元|${CN_NUMBER_RE}))\\s*年\\s*(${monthRe})\\s*${DAY_RE}\\s*日?(?=$|${DATE_BOUNDARY}|周|週|星期|礼拜|禮拜)`,
  ).exec(text)
  if (!match) return null
  const year = parseYearToken(match[1])
  const month = monthFromToken(match[2], options.monthAlias)
  const day = dayFromToken(match[3])
  return normalizeParsedDate({ month, day }, options, year)
}
function parseFullChineseFestival(text, options) {
  const match = new RegExp(
    `(?:^|${DATE_BOUNDARY})((?:元|${CN_NUMBER_RE}))\\s*年\\s*(${aliasPattern(options.festivalAlias)})(?=$|${DATE_BOUNDARY})`,
  ).exec(text)
  if (!match) return null
  return normalizeParsedDate(options.festivalAlias[match[2]], options, parseYearToken(match[1]))
}
function parseEraDate(text, options) {
  const eraYearRe = new RegExp(`(?:^|${DATE_BOUNDARY})(?:(?:【([^】]{1,20})】)|([\\u3400-\\u9fff]{1,20}?))\\s*(\\d{1,4}|${CN_NUMBER_RE})\\s*年`)
  const match = eraYearRe.exec(text)
  if (!match) return null
  const eraLabel = match[1] || match[2] || null
  if (eraLabel && [...eraLabel].every(ch => CN_NUMBER_TOKEN.includes(ch))) return null
  const year = parseYearToken(match[3])
  const tail = text.slice(match.index + match[0].length)
  const candidate = readMonthDate(tail, options)
  if (!candidate) return null
  const value = normalizeParsedDate(candidate, options, year, eraLabel)
  return value
}
function hasUnresolvedFullYear(text) {
  return /(?:年\s*[^\n|｜,，、;；=＝]{0,20}?月\s*[^\n|｜,，、;；=＝]{0,10}?日?)/.test(text)
}
/**
 * Parse a SevenDaysCal-compatible story date without host state.
 * The result is a month/day structure, with year and eraLabel when present.
 */
export function parseCnDate(
  text,
  {
    calendar = null,
    validMonthDay = null,
    validRealDate: suppliedValidRealDate = null,
    monthAlias = _CN_MONTH_ALIAS,
    festivalAlias = _CN_FESTIVAL_ALIAS,
  } = {},
) {
  const value = normalizeCnDateDigits(text)
  if (!value.trim() || /<\/?bbs_end\s*>/i.test(value) || /未知|无法|不确定|不清楚|没有|无明确/.test(value)) return null
  const options = { calendar, validMonthDay, validRealDate: suppliedValidRealDate, monthAlias, festivalAlias }
  // 显式数字纪年一旦出现但越界，不能降级成“无年”的月日。
  const explicitNumericYear = value.match(new RegExp(`(?:^|${DATE_BOUNDARY})(\\d{1,})\\s*年`))
  if (explicitNumericYear && (+explicitNumericYear[1] < 1 || +explicitNumericYear[1] > 9999)) return null
  const explicitCnYear = value.match(new RegExp(`(?:^|${DATE_BOUNDARY})(${CN_NUMBER_RE})\\s*年`))
  if (explicitCnYear) {
    const year = parseYearToken(explicitCnYear[1])
    if (!Number.isInteger(year) || year < 1 || year > 9999) return null
  }
  // 与 SevenDaysCal 相同：精确数字日期优先。
  let match = value.match(
    new RegExp(`(?:^|${DATE_BOUNDARY})(\\d{4})\\s*[-/.]\\s*(\\d{1,2})\\s*[-/.]\\s*(\\d{1,2})(?=$|[\\s|｜,，、;；]|周|週|星期|礼拜|禮拜)`),
  )
  if (match) return normalizeParsedDate({ month: +match[2], day: +match[3] }, options, +match[1])
  const fullChinese = parseFullChineseDate(value, options)
  if (fullChinese) return fullChinese
  const fullChineseFestival = parseFullChineseFestival(value, options)
  if (fullChineseFestival) return fullChineseFestival
  const era = parseEraDate(value, options)
  if (era) return era
  const fullFormal = parseFullFormalMonthDate(value, options)
  if (fullFormal) return fullFormal
  match = value.match(
    new RegExp(
      `(?:^|${DATE_BOUNDARY})(\\d{1,4})\\s*年\\s*(${monthTokenPattern(monthAlias)})\\s*(${DAY_RE})\\s*日?(?=$|${DATE_BOUNDARY}|周|週|星期|礼拜|禮拜)`,
    ),
  )
  if (match) {
    const month = monthFromToken(match[2], monthAlias)
    const day = dayFromToken(match[3])
    return normalizeParsedDate({ month, day }, options, +match[1])
  }
  match = value.match(
    new RegExp(`(?:^|${DATE_BOUNDARY})(\\d{1,4})\\s*年\\s*(${aliasPattern(festivalAlias)})(?=$|${DATE_BOUNDARY})`),
  )
  if (match) return normalizeParsedDate(festivalAlias[match[2]], options, +match[1])
  if (hasUnresolvedFullYear(value)) return null
  // 自定义历法正式月名按最长名称优先，沿用 SevenDaysCal 的月名流程。
  const formal = matchFormalMonthDate(value, calendar)
  if (formal) return normalizeParsedDate(formal, options)
  // 固定节日和月份 alias 都通过数据词典解析，别名匹配顺序由长度决定。
  const festival = matchFestival(value, festivalAlias)
  if (festival) return normalizeParsedDate(festival, options)
  match = value.match(new RegExp(`(?:^|${DATE_BOUNDARY})(第\\s*)?(\\d{1,2})\\s*月\\s*(\\d{1,2})\\s*日?`))
  if (match) return normalizeParsedDate({ month: +match[2], day: +match[3] }, options)
  const monthDate = matchMonthDate(value, monthAlias)
  if (monthDate) return normalizeParsedDate(monthDate, options)
  return null
}
export const parseChineseDate = parseCnDate
export function extractDayFromTime(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return null
  let m
  // 阿拉伯：YYYY年M月D日
  if ((m = timeStr.match(/(\d{2,4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})/))) return `${+m[1]}-${+m[2]}-${+m[3]}`
  // 阿拉伯：YYYY/M/D、YYYY-M-D、YYYY.M.D
  if ((m = timeStr.match(/(\d{2,4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/))) return `${+m[1]}-${+m[2]}-${+m[3]}`
  // 纪元年名 + 数字月/日：年后须紧跟标点分隔符。
  if ((m = timeStr.match(/年\s*[\/\-.]\s*(\d{1,2})\s*[\/\-.]\s*(\d{1,2})/))) return `cn-0-${+m[1]}-${+m[2]}`
  // 相对天数：第N天/日
  if ((m = timeStr.match(/第\s*(\d+)\s*[天日]/))) return `day-${+m[1]}`
  // day N
  if ((m = timeStr.match(/day\s*(\d+)/i))) return `day-${+m[1]}`
  // 古代中文：<cn年>年<cn月/正/冬/腊>月<初X/cn日>[日]?
  m = timeStr.match(
    /(元|[零〇一二两兩三四五六七八九十廿卅壹贰貳叁參叄肆伍陆陸柒捌玖拾]+)\s*年\s*(正|冬|腊|[零〇一二两兩三四五六七八九十廿卅壹贰貳叁參叄肆伍陆陸柒捌玖拾]+)\s*月\s*(初[零〇一二两兩三四五六七八九十廿卅壹贰貳叁參叄肆伍陆陸柒捌玖拾]|[零〇一二两兩三四五六七八九十廿卅壹贰貳叁參叄肆伍陆陸柒捌玖拾]+)/,
  )
  if (m) {
    const year = _cnToNumber(m[1])
    const month = m[2] in _CN_MONTH_ALIAS ? _CN_MONTH_ALIAS[m[2]] : _cnToNumber(m[2])
    const day = m[3].startsWith('初') ? _cnToNumber(m[3].slice(1)) : _cnToNumber(m[3])
    if (year != null && month != null && day != null) return `cn-${year}-${month}-${day}`
  }
  const parsed = parseCnDate(timeStr)
  if (parsed?.month != null && parsed?.day != null) return `${parsed.year != null ? `cn-${parsed.year}` : 'cn-0'}-${parsed.month}-${parsed.day}`
  return null
}

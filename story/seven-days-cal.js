function textValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function visibleText(value) {
  if (typeof value === 'string') return value.trim();
  if (!value || typeof value !== 'object') return '';
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

function publicWorldbookReference(value) {
  if (typeof value === 'string' || typeof value === 'number') {
    const name = textValue(value);
    return name ? {name, stable: ''} : null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const readText = keys => keys.map(key => textValue(value[key])).find(Boolean) || '';
  const name = readText(['file_name', 'fileName', 'filename', 'name', 'label', 'worldbook_name', 'worldbookName']);
  const stable = readText(['source_id', 'sourceId', 'file_id', 'fileId', 'host_key', 'hostKey', 'id', 'key']);
  return name || stable ? {name, stable} : null;
}

function publicWorldbookEntryValues(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  const entries = value.entries
    ?? value.data?.entries
    ?? value.items
    ?? value.data?.items;
  if (Array.isArray(entries)) return entries;
  if (entries && typeof entries === 'object') return Object.values(entries);
  return [];
}

function animaSummaryEntryCount(value) {
  return publicWorldbookEntryValues(value).filter(entry => {
    const extra = entry && typeof entry === 'object' ? entry.extra : null;
    return extra?.createdBy === 'anima_summary'
      && Object.prototype.hasOwnProperty.call(extra, 'history');
  }).length;
}

// 公开扩展数据只读取正文相关字段，不把扩展对象或私有状态原样带入预览。
function publicContentText(value, seen = new Set()) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value).trim();
  if (typeof value !== 'object' || seen.has(value)) return '';
  seen.add(value);
  if (Array.isArray(value)) return value.map(item => publicContentText(item, seen)).filter(Boolean).join('\n');
  return ['content', 'text', 'relativeText', 'mes', 'message', 'summary', 'description', 'history']
    .map(key => Object.prototype.hasOwnProperty.call(value, key) ? publicContentText(value[key], seen) : '')
    .filter(Boolean)
    .join('\n');
}

function publicItemLabel(value, fallback) {
  if (typeof value === 'string' || typeof value === 'number') return textValue(value) || fallback;
  if (!value || typeof value !== 'object') return fallback;
  return ['label', 'title', 'comment', 'name', 'id', 'uid', 'nodeId']
    .map(key => textValue(value[key]))
    .find(Boolean) || fallback;
}

function animaSummaryEntries(value) {
  return publicWorldbookEntryValues(value).map((entry, index) => {
    const extra = entry && typeof entry === 'object' ? entry.extra : null;
    if (extra?.createdBy !== 'anima_summary' || !Object.prototype.hasOwnProperty.call(extra, 'history')) return null;
    const content = publicContentText(entry?.content ?? entry?.text ?? entry?.summary ?? extra?.history);
    if (!content) return null;
    return {
      label: publicItemLabel(entry, `Anima 摘要 ${index + 1}`),
      content,
    };
  }).filter(Boolean);
}

function publicWorldbookSourceText(reference) {
  if (reference?.name && reference?.stable) return `${reference.name}（稳定来源：${reference.stable}）`;
  if (reference?.name) return reference.name;
  if (reference?.stable) return `稳定来源：${reference.stable}`;
  return '';
}

function publicHistoryFileName(value) {
  if (!value || typeof value !== 'object') return '';
  const readText = source => {
    if (typeof source === 'string' || typeof source === 'number') return textValue(source);
    if (!source || typeof source !== 'object' || Array.isArray(source)) return '';
    return ['file_name', 'fileName', 'filename', 'book_name', 'bookName', 'worldbook_name', 'worldbookName']
      .map(key => textValue(source[key]))
      .find(Boolean) || '';
  };
  return readText(value)
    || readText(value.source)
    || readText(value.book)
    || readText(value.worldbook)
    || '';
}

function publicHistoryCount(value) {
  if (Array.isArray(value)) return value.length;
  if (!value || typeof value !== 'object') return null;
  for (const key of ['history', 'entries', 'items', 'messages', 'nodes', 'data']) {
    if (Array.isArray(value[key])) return value[key].length;
  }
  return null;
}

async function probeAnima(tavernHelper) {
  if (typeof tavernHelper?.getChatWorldbookName !== 'function'
    || typeof tavernHelper?.getWorldbook !== 'function') {
    return {
      available: false,
      content_available: false,
      items: [],
      status: '未检测到公开世界书读取接口',
    };
  }

  let rawReference;
  try {
    rawReference = await tavernHelper.getChatWorldbookName.call(tavernHelper, 'current');
  } catch {
    return {
      available: true,
      content_available: false,
      items: [],
      status: '公开接口存在，但无法读取当前 Chat 的世界书来源',
    };
  }
  const reference = publicWorldbookReference(rawReference);
  if (!reference) {
    return {
      available: true,
      content_available: false,
      items: [],
      status: '公开接口存在，但当前 Chat 没有关联世界书来源',
    };
  }

  let rawWorldbook;
  try {
    rawWorldbook = await tavernHelper.getWorldbook.call(tavernHelper, reference.name || reference.stable);
  } catch {
    return {
      available: true,
      content_available: false,
      items: [],
      status: `已确认当前世界书「${publicWorldbookSourceText(reference)}」，但公开接口读取失败`,
    };
  }
  if (rawWorldbook === undefined || rawWorldbook === null) {
    return {
      available: true,
      content_available: false,
      items: [],
      status: `已确认当前世界书「${publicWorldbookSourceText(reference)}」，但当前没有可读取的世界书条目`,
    };
  }
  const entryCount = animaSummaryEntryCount(rawWorldbook);
  const items = animaSummaryEntries(rawWorldbook);
  if (!entryCount) {
    return {
      available: true,
      content_available: false,
      items: [],
      status: `已确认当前世界书「${publicWorldbookSourceText(reference)}」，但未发现 Anima 摘要条目`,
    };
  }
  return {
    available: true,
    content_available: items.length > 0,
    items,
    status: `来源：当前 Chat 的公开世界书「${publicWorldbookSourceText(reference)}」；已确认 ${entryCount} 个 Anima 摘要条目`,
  };
}

function publicHistoryContentAvailable(value) {
  if (value === undefined || value === null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'string' || typeof value === 'number') return Boolean(String(value).trim());
  if (typeof value !== 'object') return false;
  const count = publicHistoryCount(value);
  if (count !== null) return count > 0;
  return ['content', 'text', 'relativeText'].some(key => visibleText(value[key]) !== '');
}

function publicHistoryItems(value) {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) {
    return value.map((item, index) => {
      const content = publicContentText(item);
      return content ? {label: publicItemLabel(item, `公开记录 ${index + 1}`), content} : null;
    }).filter(Boolean);
  }
  if (typeof value !== 'object') {
    const content = publicContentText(value);
    return content ? [{label: '公开记录', content}] : [];
  }
  for (const key of ['history', 'entries', 'items', 'messages', 'nodes']) {
    if (!Array.isArray(value[key])) continue;
    const items = publicHistoryItems(value[key]);
    if (items.length) return items;
  }
  const direct = publicContentText(value);
  if (direct) return [{label: publicItemLabel(value, '公开历史'), content: direct}];
  if (value.data && typeof value.data === 'object') return publicHistoryItems(value.data);
  return [];
}

async function probeBaiBaiBook(baiBaiBook) {
  const methodName = typeof baiBaiBook?.getInjectedHistory === 'function'
    ? 'getInjectedHistory'
    : typeof baiBaiBook?.getHistory === 'function'
      ? 'getHistory'
      : '';
  if (!methodName) {
    return {
      available: false,
      content_available: false,
      items: [],
      status: '未检测到柏宝书公开只读接口',
    };
  }

  let history;
  try {
    history = await baiBaiBook[methodName].call(baiBaiBook);
  } catch {
    return {
      available: true,
      content_available: false,
      items: [],
      status: `已检测到 STBaiBaiBook.${methodName}()，但读取失败`,
    };
  }
  if (history === undefined || history === null) {
    return {
      available: true,
      content_available: false,
      items: [],
      status: `已检测到 STBaiBaiBook.${methodName}()，但当前没有可用记录`,
    };
  }
  const filename = publicHistoryFileName(history);
  const count = publicHistoryCount(history);
  const countText = count === null ? '' : `；返回 ${count} 条记录`;
  const contentAvailable = publicHistoryContentAvailable(history);
  const items = publicHistoryItems(history);
  if (!contentAvailable) {
    return {
      available: true,
      content_available: false,
      items: [],
      status: `已检测到 STBaiBaiBook.${methodName}()，但当前没有可用记录${filename ? `（来源：${filename}）` : ''}`,
    };
  }
  return {
    available: true,
    content_available: items.length > 0,
    items,
    status: filename
      ? `来源：${filename}（STBaiBaiBook.${methodName}()）${countText}`
      : `接口：STBaiBaiBook.${methodName}()；公开接口未提供文件名${countText}`,
  };
}

export function detectExternalMemoryProviders({
  context = globalThis.SillyTavern?.getContext?.() ?? null,
  globalRef = globalThis,
} = {}) {
  const tavernHelper = globalRef?.TavernHelper;
  const baiBaiBook = globalRef?.STBaiBaiBook;
  const animaAvailable = typeof tavernHelper?.getChatWorldbookName === 'function'
    && typeof tavernHelper?.getWorldbook === 'function';
  const baiBaiMethod = typeof baiBaiBook?.getInjectedHistory === 'function'
    ? 'getInjectedHistory'
    : typeof baiBaiBook?.getHistory === 'function'
      ? 'getHistory'
      : '';
  const baiBaiAvailable = Boolean(baiBaiMethod);
  return [
    {
      key: 'anima',
      source_type: 'external_memory',
      label: 'Anima',
      available: animaAvailable,
      content_available: false,
      items: [],
      status: animaAvailable ? '等待读取当前公开世界书来源' : '未检测到公开世界书读取接口',
    },
    {
      key: 'baobaoshu',
      source_type: 'external_memory',
      label: '柏宝书',
      available: baiBaiAvailable,
      content_available: false,
      items: [],
      status: baiBaiAvailable ? `等待读取 STBaiBaiBook.${baiBaiMethod}()` : '未检测到柏宝书公开只读接口',
    },
    {
      key: 'database_memory',
      source_type: 'external_memory',
      label: '数据库记忆',
      available: false,
      content_available: false,
      items: [],
      status: '未检测到可依赖的公开接口',
    },
  ];
}

// 只读取公开接口返回的安全正文 DTO；不读取私有 Store，也不写入 Chat 数据。
export async function probeExternalMemoryProviders({
  context = globalThis.SillyTavern?.getContext?.() ?? null,
  globalRef = globalThis,
} = {}) {
  const providers = detectExternalMemoryProviders({context, globalRef});
  const [anima, baobaoshu] = await Promise.all([
    probeAnima(globalRef?.TavernHelper),
    probeBaiBaiBook(globalRef?.STBaiBaiBook),
  ]);
  return providers.map(provider => {
    if (provider.key === 'anima') {
      return {
        ...provider,
        status: anima.status,
        content_available: anima.content_available === true,
        items: anima.items ?? [],
      };
    }
    if (provider.key === 'baobaoshu') {
      return {
        ...provider,
        status: baobaoshu.status,
        content_available: baobaoshu.content_available === true,
        items: baobaoshu.items ?? [],
      };
    }
    return provider;
  });
}

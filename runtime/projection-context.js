import {
  PROJECTION_CONTEXT_DEPTH,
  PROJECTION_CONTEXT_INJECTION_KEY,
  PROJECTION_CONTEXT_POSITION,
  PROJECTION_CONTEXT_ROLE,
  buildProjectionContext,
} from '../core/projection-context.js';

export function createProjectionContextCoordinator({
  getProjectionViews,
  resolveCurrentFloor,
  getChatId,
  setExtensionPrompt,
  attributionResolver = null,
  injection = {},
} = {}) {
  if (typeof getProjectionViews !== 'function') throw new TypeError('PROJECTION_VIEWS_REQUIRED');
  if (typeof resolveCurrentFloor !== 'function') throw new TypeError('CURRENT_FLOOR_REQUIRED');
  const position = injection.position ?? PROJECTION_CONTEXT_POSITION;
  const depth = injection.depth ?? PROJECTION_CONTEXT_DEPTH;
  const role = injection.role ?? PROJECTION_CONTEXT_ROLE;
  let destroyed = false;

  function write(prompt) {
    if (typeof setExtensionPrompt !== 'function') return {status: 'unavailable'};
    return setExtensionPrompt({
      key: PROJECTION_CONTEXT_INJECTION_KEY,
      content: prompt,
      position,
      depth,
      scan: false,
      role,
    }) ?? {status: 'updated'};
  }

  function clearProjectionContext() {
    if (destroyed) return {status: 'destroyed'};
    return write('');
  }

  async function refreshProjectionContext({chatId = getChatId?.()} = {}) {
    if (destroyed) return {status: 'destroyed', dto: [], prompt: ''};
    if (chatId === null || chatId === undefined || chatId === '') {
      clearProjectionContext();
      return {status: 'cleared', reason: 'no_chat', dto: [], prompt: ''};
    }
    let floor;
    try {
      floor = await resolveCurrentFloor();
    } catch {
      clearProjectionContext();
      return {status: 'cleared', reason: 'no_character_floor', dto: [], prompt: ''};
    }
    if (!floor?.version || String(floor.version.chat_id) !== String(chatId)) {
      clearProjectionContext();
      return {status: 'cleared', reason: 'invalid_floor', dto: [], prompt: ''};
    }
    try {
      const views = await getProjectionViews({chatId, endpointFloor: floor.version.floor});
      const attributionBySubject = typeof attributionResolver === 'function'
        ? await attributionResolver({chatId, floor, views})
        : {};
      const context = buildProjectionContext(views?.all ?? views, {attributionBySubject});
      write(context.prompt);
      return {status: context.prompt ? 'updated' : 'cleared', dto: context.dto, prompt: context.prompt};
    } catch {
      clearProjectionContext();
      return {status: 'cleared', reason: 'projection_read_failed', dto: [], prompt: ''};
    }
  }

  function destroy() {
    if (destroyed) return;
    clearProjectionContext();
    destroyed = true;
  }

  return {refreshProjectionContext, clearProjectionContext, destroy};
}

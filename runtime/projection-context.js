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

  function unavailableResult(error = null) {
    return {
      ok: false,
      status: 'unavailable',
      reason: error?.code ?? error?.reason ?? 'ST_EXTENSION_PROMPT_UNAVAILABLE',
    };
  }

  function write(prompt) {
    if (typeof setExtensionPrompt !== 'function') return unavailableResult();
    try {
      const result = setExtensionPrompt({
        key: PROJECTION_CONTEXT_INJECTION_KEY,
        content: prompt,
        position,
        depth,
        scan: false,
        role,
      });
      if (result === false || result?.ok === false || result?.status === 'unavailable') {
        return unavailableResult(result);
      }
      return {ok: true, status: 'available'};
    } catch (error) {
      return unavailableResult(error);
    }
  }

  function clearProjectionContext() {
    if (destroyed) return {status: 'destroyed'};
    const result = write('');
    return result.ok === false ? result : {ok: true, status: 'cleared'};
  }

  function clearFor(reason, extra = {}) {
    const result = clearProjectionContext();
    return result.ok === false
      ? {...result, ...extra}
      : {ok: true, status: 'cleared', reason, ...extra};
  }

  async function refreshProjectionContext({chatId = getChatId?.()} = {}) {
    if (destroyed) return {status: 'destroyed', dto: [], prompt: ''};
    if (chatId === null || chatId === undefined || chatId === '') {
      return clearFor('no_chat', {dto: [], prompt: ''});
    }
    let floor;
    try {
      floor = await resolveCurrentFloor();
    } catch {
      return clearFor('no_character_floor', {dto: [], prompt: ''});
    }
    if (!floor?.version || String(floor.version.chat_id) !== String(chatId)) {
      return clearFor('invalid_floor', {dto: [], prompt: ''});
    }
    try {
      const views = await getProjectionViews({chatId, endpointFloor: floor.version.floor});
      const attributionBySubject = typeof attributionResolver === 'function'
        ? await attributionResolver({chatId, floor, views})
        : {};
      const context = buildProjectionContext(views?.all ?? views, {attributionBySubject});
      const result = write(context.prompt);
      if (result.ok === false) return {...result, dto: context.dto, prompt: ''};
      return {ok: true, status: context.prompt ? 'updated' : 'cleared', dto: context.dto, prompt: context.prompt};
    } catch {
      return clearFor('projection_read_failed', {dto: [], prompt: ''});
    }
  }

  function destroy() {
    if (destroyed) return;
    clearProjectionContext();
    destroyed = true;
  }

  return {refreshProjectionContext, clearProjectionContext, destroy};
}

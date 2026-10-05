import {
  PROJECTION_CONTEXT_DEPTH,
  PROJECTION_CONTEXT_INJECTION_KEY,
  PROJECTION_CONTEXT_POSITION,
  PROJECTION_CONTEXT_ROLE,
  buildProjectionContext,
} from '../core/projection-context.js';
import {attributionBySubjectFromCurrentState} from '../core/reproductive-attribution.js';
import {sameFloorVersion} from './floor.js';

export function createCurrentStateAttributionResolver({collectActiveBusinessData} = {}) {
  if (typeof collectActiveBusinessData !== 'function') throw new TypeError('CURRENT_STATE_REQUIRED');
  return async ({chatId, floor} = {}) => {
    if (!floor?.version || String(floor.version.chat_id) !== String(chatId)) return {};
    const business = await collectActiveBusinessData();
    if (business?.current_state_status !== 'ready') return {};
    if (!business?.current_floor?.version || !sameFloorVersion(business.current_floor.version, floor.version)) return {};
    return attributionBySubjectFromCurrentState(business.current_state);
  };
}

export function createProjectionContextCoordinator({
  getProjectionViews,
  resolveCurrentFloor,
  getChatId,
  setExtensionPrompt,
  enabledResolver = () => true,
  attributionResolver = null,
  healthGuidanceResolver = null,
  injection = {},
} = {}) {
  if (typeof getProjectionViews !== 'function') throw new TypeError('PROJECTION_VIEWS_REQUIRED');
  if (typeof resolveCurrentFloor !== 'function') throw new TypeError('CURRENT_FLOOR_REQUIRED');
  const position = injection.position ?? PROJECTION_CONTEXT_POSITION;
  const depth = injection.depth ?? PROJECTION_CONTEXT_DEPTH;
  const role = injection.role ?? PROJECTION_CONTEXT_ROLE;
  let destroyed = false;

  function isEnabled() {
    try {
      return enabledResolver() !== false;
    } catch {
      return false;
    }
  }

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

function floorReadStillMatches(left, right) {
  if (sameFloorVersion(left, right)) return true;
  if (!left || !right) return false;
  return String(left.chat_id ?? '') === String(right.chat_id ?? '')
    && Number(left.floor) === Number(right.floor)
    && (left.swipe_id === undefined || right.swipe_id === undefined || Number(left.swipe_id) === Number(right.swipe_id));
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
    if (!isEnabled())
      return clearFor('disabled', {dto: [], prompt: ''});
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
      let healthGuidance = [];
      if (typeof healthGuidanceResolver === 'function') {
        try {
          healthGuidance = await healthGuidanceResolver({chatId, floor, views});
        } catch {
          healthGuidance = [];
        }
      }
      if (String(getChatId?.() ?? chatId) !== String(chatId)) {
        return {ok: false, status: 'stale', reason: 'CHAT_CHANGED', dto: [], prompt: ''};
      }
      const currentFloor = await resolveCurrentFloor();
      if (!currentFloor?.version || !floorReadStillMatches(currentFloor.version, floor.version)) {
        return {ok: false, status: 'stale', reason: 'FLOOR_CHANGED', dto: [], prompt: ''};
      }
      const context = buildProjectionContext(views?.all ?? views, {attributionBySubject, healthGuidance});
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

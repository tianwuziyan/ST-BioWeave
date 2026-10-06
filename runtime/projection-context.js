import {
  PROJECTION_CONTEXT_DEPTH,
  PROJECTION_CONTEXT_INJECTION_KEY,
  PROJECTION_CONTEXT_POSITION,
  PROJECTION_CONTEXT_ROLE,
  buildProjectionContext,
} from '../core/projection-context.js';
import {attributionBySubjectFromCurrentState} from '../core/reproductive-attribution.js';
import {sameFloorVersion} from './floor.js';
import {diagnosticFingerprint} from './diagnostics.js';

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
  trace = () => {},
  injection = {},
} = {}) {
  if (typeof getProjectionViews !== 'function') throw new TypeError('PROJECTION_VIEWS_REQUIRED');
  if (typeof resolveCurrentFloor !== 'function') throw new TypeError('CURRENT_FLOOR_REQUIRED');
  const position = injection.position ?? PROJECTION_CONTEXT_POSITION;
  const depth = injection.depth ?? PROJECTION_CONTEXT_DEPTH;
  const role = injection.role ?? PROJECTION_CONTEXT_ROLE;
  let destroyed = false;
  let refreshTail = Promise.resolve();

  function diagnostic(stage, details = {}) {
    try { trace({stage, ...details}); } catch { /* diagnostics never affect context */ }
  }

  function generationFields(generation = null) {
    return {
      generation_id: generation?.generation_id ?? generation?.generationId ?? null,
      generation_intent_id: generation?.generation_intent_id ?? generation?.generationIntentId ?? null,
      generation_type: generation?.generation_type ?? generation?.generationType ?? generation?.genType ?? null,
    };
  }

  function isEnabled() {
    try {
      return enabledResolver() !== false;
    } catch {
      return false;
    }
  }

function unavailableResult(error = null) {
  const source = error && typeof error === 'object' ? error : {};
  const rawMessage = source.error_message ?? source.message ?? null;
  const safeMessage = rawMessage == null
    ? null
    : String(rawMessage).replace(/authorization\s*[:=]\s*\S+/giu, 'authorization:[redacted]').slice(0, 240);
  return {
    ok: false,
    status: 'unavailable',
    reason: source.code ?? source.reason ?? 'ST_EXTENSION_PROMPT_UNAVAILABLE',
    error_name: source.error_name ?? source.name ?? null,
    error_code: source.error_code ?? source.code ?? null,
    error_message: safeMessage,
    adapter_available: source.adapter_available ?? null,
    set_extension_prompt_available: source.set_extension_prompt_available ?? null,
    setter_bound_to_context: source.setter_bound_to_context ?? null,
    position_argument: source.position_argument ?? null,
    depth_argument: source.depth_argument ?? null,
    role_argument: source.role_argument ?? null,
    position_constant_available: source.position_constant_available ?? null,
    role_constant_available: source.role_constant_available ?? null,
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

  function clearFor(reason, extra = {}, generation = null) {
    const result = clearProjectionContext();
    if (result.ok !== false) {
      diagnostic('PROJECTION_CONTEXT_SLOT_CLEARED', {
        ...generationFields(generation),
        slot: PROJECTION_CONTEXT_INJECTION_KEY,
        context_nonempty: false,
        slot_nonempty: false,
        projection_contribution_count: 0,
        health_guidance_count: 0,
        clear_reason: reason,
      });
    }
    return result.ok === false
      ? {...result, ...extra}
      : {ok: true, status: 'cleared', reason, ...extra};
  }

  async function refreshProjectionContextInternal({chatId = getChatId?.(), generation = null} = {}) {
    diagnostic('PROJECTION_CONTEXT_REFRESH_STARTED', {
      ...generationFields(generation),
      slot: PROJECTION_CONTEXT_INJECTION_KEY,
    });
    if (destroyed) return {status: 'destroyed', dto: [], prompt: ''};
    if (!isEnabled())
      return clearFor('disabled', {dto: [], prompt: ''}, generation);
    if (chatId === null || chatId === undefined || chatId === '') {
      return clearFor('no_chat', {dto: [], prompt: ''}, generation);
    }
    let floor;
    try {
      floor = await resolveCurrentFloor();
    } catch {
      return clearFor('no_character_floor', {dto: [], prompt: ''}, generation);
    }
    if (!floor?.version || String(floor.version.chat_id) !== String(chatId)) {
      return clearFor('invalid_floor', {dto: [], prompt: ''}, generation);
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
      diagnostic('PROJECTION_CONTEXT_HEALTH_INPUT', {
        ...generationFields(generation),
        slot: PROJECTION_CONTEXT_INJECTION_KEY,
        health_guidance_count: Array.isArray(healthGuidance) ? healthGuidance.length : 0,
        selected_stage_summary: [...new Set((Array.isArray(healthGuidance) ? healthGuidance : []).map(item => item?.stage).filter(Boolean))],
        guidance_fingerprints: (Array.isArray(healthGuidance) ? healthGuidance : []).map(item => item?.guidance_fingerprint).filter(Boolean),
        projection_contribution_count: Array.isArray(views?.all ?? views) ? (views?.all ?? views).filter(item => item?.context_visible === true).length : 0,
      });
      if (String(getChatId?.() ?? chatId) !== String(chatId)) {
        return {ok: false, status: 'stale', reason: 'CHAT_CHANGED', dto: [], prompt: ''};
      }
      const currentFloor = await resolveCurrentFloor();
      if (!currentFloor?.version || !floorReadStillMatches(currentFloor.version, floor.version)) {
        return {ok: false, status: 'stale', reason: 'FLOOR_CHANGED', dto: [], prompt: ''};
      }
      const context = buildProjectionContext(views?.all ?? views, {attributionBySubject, healthGuidance});
      const result = write(context.prompt);
      const projectionContributionCount = context.dto.filter(item => item?.context_type !== 'health_recovery_guidance').length;
      const healthGuidanceCount = context.dto.filter(item => item?.context_type === 'health_recovery_guidance').length;
      const selectedStageSummary = [...new Set((Array.isArray(healthGuidance) ? healthGuidance : []).map(item => item?.stage).filter(Boolean))];
      const guidanceFingerprints = (Array.isArray(healthGuidance) ? healthGuidance : [])
        .flatMap(item => Array.isArray(item?.guidance_fingerprints) ? item.guidance_fingerprints : [])
        .filter(Boolean);
      const contextDetails = {
        ...generationFields(generation),
        slot: PROJECTION_CONTEXT_INJECTION_KEY,
        context_nonempty: Boolean(context.prompt),
        slot_nonempty: Boolean(context.prompt),
        projection_contribution_count: projectionContributionCount,
        health_guidance_count: healthGuidanceCount,
        selected_stage_summary: selectedStageSummary,
        guidance_fingerprints: guidanceFingerprints,
        context_fingerprint: context.prompt ? diagnosticFingerprint(context.prompt) : null,
      };
      if (result.ok === false) {
        diagnostic('PROJECTION_CONTEXT_SLOT_WRITE_FAILED', {
          ...contextDetails,
          reason: result.reason ?? 'ST_EXTENSION_PROMPT_WRITE_FAILED',
          error_name: result.error_name ?? null,
          error_code: result.error_code ?? null,
          error_message: result.error_message ?? null,
          adapter_available: result.adapter_available ?? null,
          set_extension_prompt_available: result.set_extension_prompt_available ?? null,
          setter_bound_to_context: result.setter_bound_to_context ?? null,
          position_argument: result.position_argument ?? position,
          depth_argument: result.depth_argument ?? depth,
          role_argument: result.role_argument ?? role,
          position_constant_available: result.position_constant_available ?? null,
          role_constant_available: result.role_constant_available ?? null,
        });
        return {...result, dto: context.dto, prompt: '', ...contextDetails};
      }
      if (context.prompt) diagnostic('PROJECTION_CONTEXT_SLOT_WRITTEN', contextDetails);
      else diagnostic('PROJECTION_CONTEXT_SLOT_CLEARED', {...contextDetails, clear_reason: 'both_context_inputs_empty'});
      return {ok: true, status: context.prompt ? 'updated' : 'cleared', dto: context.dto, prompt: context.prompt, ...contextDetails};
    } catch {
      return clearFor('projection_read_failed', {dto: [], prompt: ''}, generation);
    }
  }

  function refreshProjectionContext(options = {}) {
    const refresh = refreshTail.then(() => refreshProjectionContextInternal(options));
    refreshTail = refresh.catch(() => undefined);
    return refresh;
  }

  function destroy() {
    if (destroyed) return;
    clearProjectionContext();
    destroyed = true;
  }

  return {refreshProjectionContext, clearProjectionContext, destroy};
}

import {
  buildEventAnalysisInput,
  collectAnalysisContext,
  mergeRecentStorySettings,
  processNarrativeFloor,
} from '../ai/input-builder.js';
import {createWorldbookCache, loadAnalysisSources} from '../ai/worldbook.js';
import {safeErrorSummary as clientSafeErrorSummary} from '../ai/client.js';
import {normalizeEvent, sortEvents, validateEvent} from '../core/events.js';
import {explainTrackingDecision, rebuildTrackingRegistry} from '../core/tracking.js';
import {normalizeStoryTime} from '../story/time.js';
import {detectExternalMemoryProviders, probeExternalMemoryProviders} from '../story/seven-days-cal.js';
import {
  commitAnalysis,
  floorVersion,
  floorVersionFromData,
  hashText,
  isIntervalTarget,
  sameFloorVersion,
  shouldAnalyze,
} from './floor.js';

const AUTO_ANALYSIS_EVENTS = new Set([
  'MESSAGE_RECEIVED',
  'GENERATION_ENDED',
  'MESSAGE_UPDATED',
  'MESSAGE_EDITED',
  'MESSAGE_SWIPED',
  'MESSAGE_SWIPE_DELETED',
]);
const FORCED_LIFECYCLE_EVENTS = new Set([
  'MESSAGE_UPDATED',
  'MESSAGE_EDITED',
  'MESSAGE_SWIPED',
  'MESSAGE_SWIPE_DELETED',
]);

function scalar(value) {
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return null;
}

function messagePartText(value) {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (!value || typeof value !== 'object') return '';
  return String(value.mes ?? value.content ?? value.message ?? value.text ?? '');
}

function messageText(message, swipeId = 0) {
  if (typeof message === 'string' || typeof message === 'number') return String(message);
  if (!message || typeof message !== 'object') return '';
  if (message.swipes && typeof message.swipes === 'object' && message.swipes[swipeId] !== undefined) {
    return messagePartText(message.swipes[swipeId]);
  }
  return messagePartText(message.mes ?? message.content ?? message.message);
}

function messageRole(message) {
  const role = String(message?.role ?? '').trim().toLowerCase();
  if (['user', 'assistant', 'system'].includes(role)) return role;
  if (message?.is_system === true) return 'system';
  if (message?.is_user === true) return 'user';
  return 'assistant';
}

function messageFloor(message, index, storedVersion = null) {
  for (const candidate of [message?.floor, message?.floor_id, message?.floorIndex, storedVersion?.floor, index]) {
    const parsed = Number(candidate);
    if (Number.isFinite(parsed)) return Math.round(parsed);
  }
  return index;
}

function messageId(message, index, storedVersion = null) {
  for (const candidate of [message?.message_id, message?.messageId, message?.id, storedVersion?.message_id, index]) {
    const value = scalar(candidate);
    if (value !== null) return value;
  }
  return index;
}

function messageVersion(message, storedVersion = null) {
  return scalar(message?.message_version ?? message?.messageVersion ?? message?.version ?? storedVersion?.message_version)
    ?? undefined;
}

function defaultCharacterContext(_context, chatData = {}, analysisInput = {}) {
  return {
    current_character: analysisInput.meta?.character_name ?? null,
    character_card: analysisInput.character ?? {},
    profiles: chatData.character_profiles ?? {},
  };
}

function analysisTimestamp(analysis) {
  return analysis?.last_success?.analyzed_at
    ?? analysis?.last_success?.last_analyzed_at
    ?? analysis?.analyzed_at
    ?? analysis?.last_analyzed_at
    ?? null;
}

function isRequestAborted(error) {
  const code = String(error?.code ?? '').trim().toUpperCase();
  return error?.name === 'AbortError'
    || code === 'REQUEST_ABORTED'
    || code === 'ABORTED'
    || code === 'ERR_ABORTED'
    || code === 'ABORT_ERR'
    || code === 'ERR_CANCELED'
    || code === 'ERR_CANCELLED';
}

function isStaleChat(error) {
  return error?.message === 'STALE_CHAT' || error?.code === 'STALE_CHAT';
}

function requestAbortedError() {
  const error = new Error('REQUEST_ABORTED');
  error.code = 'REQUEST_ABORTED';
  error.analysis_stage = 'cancelled';
  return error;
}

function diagnosticCode(error) {
  const code = String(error?.diagnostic_code ?? '').trim();
  if (code) return code;
  if (error?.code === 'EVENT_ANALYSIS_INVALID' && error?.message && error.message !== error.code) {
    return String(error.message);
  }
  return String(error?.code ?? error?.message ?? 'EVENT_ANALYSIS_FAILED');
}

function safeDiagnosticSummary(error, stage = null) {
  const code = diagnosticCode(error);
  if (code === 'REQUEST_ABORTED') return '用户取消';
  if (code === 'API_PROFILE_NOT_CONFIGURED') return '事件分析任务没有解析到可用 API 配置';
  if (code === 'EVENT_RESPONSE_EMPTY') return 'AI 响应为空或未能提取正文';
  if (code === 'EVENT_RESPONSE_JSON_INVALID') return 'AI 响应不是有效 JSON';
  if (code === 'EVENT_SCHEMA_INVALID'
    || code === 'domain_validation_failed'
    || code === 'unexpected_top_level_field'
    || code === 'unexpected_event_field'
    || code === 'missing_event_field'
    || code === 'invalid_event_role'
    || code === 'invalid_possible_conception'
    || code === 'invalid_evidence_shape'
    || code === 'participant_reference_invalid'
    || code.startsWith('EVENT_ANALYSIS_')) {
    return 'AI 返回未通过 Event JSON Schema 校验';
  }
  if (code === 'ST_CHAT_STORAGE_UNAVAILABLE') return 'SillyTavern Chat 存储不可用';
  if (code === 'ST_METADATA_STORAGE_UNAVAILABLE') return 'SillyTavern Chat metadata 存储不可用';
  if (code === 'ST_METADATA_UNAVAILABLE') return 'SillyTavern Chat metadata 存储不可用';
  if (code === 'ST_FLOOR_STORAGE_UNAVAILABLE') return 'SillyTavern Floor 存储不可用';
  if (stage === 'floor_resolution') return '当前 Floor 解析失败，未生成分析版本';
  if (stage === 'floor_version') return 'Floor Version 计算失败，未生成完整版本';
  if (stage === 'request_build') return 'Event Analysis 请求构建失败';
  if (stage === 'normalization') return 'BiologicalEvent 归一化失败';
  if (stage === 'registry_rebuild') return 'Tracking Registry 重建失败';
  return clientSafeErrorSummary(error);
}

function floorExecutionKey(version) {
  return [
    version?.chat_id,
    version?.message_id,
    version?.floor,
    version?.swipe_id,
    version?.content_hash,
    version?.message_version,
  ].map(value => String(value ?? '')).join('\u001f');
}

async function deterministicEventId(version, ordinal) {
  const material = [
    'bioweave-event-id-v1',
    version?.chat_id,
    version?.message_id,
    version?.floor,
    version?.swipe_id,
    version?.content_hash,
    version?.message_version,
    ordinal,
  ].map(value => String(value ?? '')).join('\u001f');
  const digest = await hashText(material);
  return `evt_${digest.slice(0, 24)}_${ordinal + 1}`;
}

function executionError(error, stage = null) {
  const code = diagnosticCode(error);
  const resolvedStage = error?.analysis_stage ?? stage ?? 'analysis';
  const path = error?.diagnostic_path ?? error?.error_path ?? null;
  return {
    stage: resolvedStage,
    error_code: code,
    error_path: path,
    diagnostic_path: path,
    safe_error_summary: safeDiagnosticSummary(error, resolvedStage),
  };
}

function withAnalysisStage(error, stage) {
  if (error && typeof error === 'object') {
    error.analysis_stage ??= stage;
    return error;
  }
  const wrapped = new Error(String(error ?? 'EVENT_ANALYSIS_FAILED'));
  wrapped.analysis_stage = stage;
  return wrapped;
}

function isFloorPreflightStage(stage) {
  return stage === 'floor_resolution' || stage === 'floor_version';
}

function safeFloorPreflightStatus(error, trackingSubjectCount = 0) {
  const diagnostic = executionError(error, error?.analysis_stage ?? 'floor_resolution');
  return {
    state: 'failed',
    busy: false,
    current_floor: null,
    floor_version: null,
    attempt: null,
    last_success: null,
    last_error: diagnostic.error_code,
    error_stage: diagnostic.stage,
    error_code: diagnostic.error_code,
    error_path: diagnostic.error_path,
    diagnostic_path: diagnostic.diagnostic_path,
    safe_error_summary: diagnostic.safe_error_summary,
    started_at: null,
    finished_at: null,
    event_count: 0,
    active_event_count: 0,
    tracking_subject_count: trackingSubjectCount,
    current_floor_events: [],
  };
}

export function createEventAnalysisCoordinator({
  st,
  chat,
  store,
  analyzer,
  storyTime = null,
  characterContextResolver = defaultCharacterContext,
  analysisContextCollector = collectAnalysisContext,
  analysisSourceLoader = loadAnalysisSources,
  analysisSourceLoaderOptions = {},
  externalMemoryProviderLoader = null,
  globalRecentStoryResolver = () => ({}),
  analysisSourceCache = null,
  notify = () => {},
} = {}) {
  if (!st || !chat || !store) throw new TypeError('EVENT_ANALYSIS_DEPENDENCIES_REQUIRED');
  const inFlight = new Map();
  const lastTerminal = new Map();
  let attemptSequence = 0;
  let registryRefreshChain = Promise.resolve();
  let destroyed = false;
  const sourceCache = analysisSourceCache ?? createWorldbookCache();

  async function collectExternalMemoryProviders(context) {
    if (typeof externalMemoryProviderLoader === 'function') {
      return externalMemoryProviderLoader({context});
    }
    try {
      return await probeExternalMemoryProviders({context});
    } catch {
      return detectExternalMemoryProviders({context});
    }
  }

  function messageCollection() {
    const context = st.getContext?.();
    const value = st.getChat?.() ?? context?.chat;
    return Array.isArray(value) ? value : null;
  }

  function messages() {
    return messageCollection() ?? [];
  }

  function recentStoryItemsBefore(targetIndex) {
    return messages().slice(0, Math.max(0, targetIndex)).map((message, index) => {
      const swipeId = store.getActiveSwipeId?.(index) ?? 0;
      return {
        ...message,
        floor: messageFloor(message, index),
        message_id: messageId(message, index),
        swipe_id: swipeId,
        role: messageRole(message),
      };
    });
  }

  function resolveMessage(selector = null) {
    const all = messages();
    if (!all.length) throw new Error('MESSAGE_NOT_FOUND');
    if (selector === null || selector === undefined) {
      const index = all.length - 1;
      return {index, message: all[index]};
    }
    if (typeof selector === 'object'
      && (selector.__messageIndex === true || selector.messageIndex !== undefined || selector.index !== undefined)
      && selector.message_id === undefined && selector.messageId === undefined) {
      const index = Number(selector.messageIndex ?? selector.index);
      if (Number.isInteger(index) && index >= 0 && index < all.length) return {index, message: all[index]};
      throw new Error('MESSAGE_NOT_FOUND');
    }
    const requested = typeof selector === 'object'
      ? selector.message_id ?? selector.messageId
      : selector;
    if (requested === null || requested === undefined || requested === '') {
      const index = all.length - 1;
      return {index, message: all[index]};
    }
    for (let index = 0; index < all.length; index += 1) {
      const stored = floorVersionFromData(store.getActiveFloor?.(index));
      if (String(messageId(all[index], index, stored)) === String(requested)) return {index, message: all[index]};
    }
    const index = Number(requested);
    if (Number.isInteger(index) && index >= 0 && index < all.length) return {index, message: all[index]};
    throw new Error('MESSAGE_NOT_FOUND');
  }

  async function resolveFloor(selector = null) {
    let resolved;
    try {
      resolved = resolveMessage(selector);
    } catch (error) {
      throw withAnalysisStage(error, 'floor_resolution');
    }
    const {index, message} = resolved;
    let swipeId;
    let floorData;
    let storedVersion;
    let chatId;
    try {
      swipeId = store.getActiveSwipeId?.(index) ?? 0;
      floorData = store.getFloor?.(index, swipeId) ?? {};
      storedVersion = floorVersionFromData(floorData);
      chatId = chat.current();
    } catch (error) {
      throw withAnalysisStage(error, 'floor_resolution');
    }
    let version;
    try {
      version = await floorVersion({
        chatId,
        messageId: messageId(message, index, storedVersion),
        floor: messageFloor(message, index, storedVersion),
        swipeId,
        text: messageText(message, swipeId),
        messageVersion: messageVersion(message, storedVersion),
      });
    } catch (error) {
      throw withAnalysisStage(error, 'floor_version');
    }
    return {index, message, swipeId, floorData, version, chatId};
  }

  async function collectActiveEvents(token = chat.token()) {
    const activeEvents = [];
    const all = messages();
    for (let index = 0; index < all.length; index += 1) {
      const swipeId = store.getActiveSwipeId?.(index);
      if (swipeId === null || swipeId === undefined) continue;
      const floorData = store.getFloor?.(index, swipeId);
      if (!floorData) continue;
      const storedVersion = floorVersionFromData(floorData);
      let version;
      try {
        version = await floorVersion({
          chatId: token.chatId,
          messageId: messageId(all[index], index, storedVersion),
          floor: messageFloor(all[index], index, storedVersion),
          swipeId,
          text: messageText(all[index], swipeId),
          messageVersion: messageVersion(all[index], storedVersion),
        });
      } catch (error) {
        throw withAnalysisStage(error, 'floor_version');
      }
      chat.assert(token);
      activeEvents.push(...(store.getActiveFloorEvents?.(index, version) ?? []));
    }
    return sortEvents(activeEvents);
  }

  function refreshTrackingRegistry(reason = 'runtime') {
    const refresh = async () => {
      if (!messageCollection()) return null;
      const token = chat.token();
      const activeEvents = await collectActiveEvents(token);
      chat.assert(token);
      const previousChat = store.getChat(token.chatId);
      const registry = rebuildTrackingRegistry(activeEvents, previousChat);
      await store.saveChat(token.chatId, {...previousChat, ...registry});
      chat.assert(token);
      notify({
        type: 'TRACKING_REGISTRY_REFRESHED',
        payload: {reason, event_count: activeEvents.length},
        chatId: token.chatId,
      });
      return {...registry, active_events: activeEvents};
    };
    const result = registryRefreshChain.then(refresh, refresh);
    registryRefreshChain = result.catch(() => null);
    return result;
  }

  async function statusForCurrentFloor() {
    let target;
    try {
      target = await resolveFloor();
    } catch (error) {
      if (error?.message !== 'MESSAGE_NOT_FOUND' && isFloorPreflightStage(error?.analysis_stage)) {
        const chatData = store.getChat(chat.current());
        return safeFloorPreflightStatus(error, Object.keys(chatData.tracking_subjects ?? {}).length);
      }
      if (error?.message !== 'MESSAGE_NOT_FOUND') throw error;
      const chatId = chat.current();
      const chatData = store.getChat(chatId);
      return {
        state: 'not_analyzed', busy: false, current_floor: null, floor_version: null,
        attempt: null, last_success: null, last_error: null, event_count: 0,
        tracking_subject_count: Object.keys(chatData.tracking_subjects ?? {}).length,
        current_floor_events: [],
      };
    }
    const analysis = target.floorData?.analysis ?? null;
    const matchesCurrent = sameFloorVersion(analysis?.floor_version, target.version);
    const key = floorExecutionKey(target.version);
    const activeAttempt = inFlight.get(key);
    const terminal = lastTerminal.get(key);
    const persistedState = matchesCurrent && ['success', 'failed', 'cancelled'].includes(analysis?.status)
      ? analysis.status
      : 'not_analyzed';
    const state = activeAttempt && !activeAttempt.cancelRequested
      ? 'running'
      : terminal?.state ?? persistedState;
    const busy = Boolean(activeAttempt && !activeAttempt.cancelRequested);
    const currentFloorEvents = store.getActiveFloorEvents?.(target.index, target.version) ?? [];
    const diagnostic = terminal?.diagnostic
      ?? (analysis?.last_attempt && analysis.last_attempt.status !== 'success'
        ? {
          stage: analysis.error_stage ?? analysis.last_attempt.stage ?? null,
          error_code: analysis.error_code ?? analysis.last_attempt.error_code ?? analysis.last_error ?? null,
          error_path: analysis.error_path ?? analysis.last_attempt.error_path ?? null,
          diagnostic_path: analysis.diagnostic_path
            ?? analysis.last_attempt.diagnostic_path
            ?? analysis.last_attempt.error_path
            ?? null,
          safe_error_summary: analysis.safe_error_summary ?? analysis.last_attempt.safe_error_summary ?? null,
        }
        : null);
    return {
      state,
      busy,
      current_floor: {
        floor: target.version.floor,
        message_id: target.version.message_id,
        swipe_id: target.swipeId,
        version: target.version,
      },
      floor_version: target.version,
      attempt: activeAttempt?.attempt ?? terminal?.attempt ?? analysis?.last_attempt ?? (analysis ? {
        status: analysis.status,
        analyzed_at: analysis.analyzed_at ?? analysis.attempted_at ?? null,
      } : null),
      last_success: analysisTimestamp(analysis),
      last_error: diagnostic?.error_code ?? analysis?.last_error ?? analysis?.last_attempt?.error ?? null,
      error_stage: diagnostic?.stage ?? analysis?.error_stage ?? null,
      error_code: diagnostic?.error_code ?? analysis?.error_code ?? null,
      error_path: diagnostic?.error_path ?? analysis?.error_path ?? analysis?.last_attempt?.error_path ?? null,
      diagnostic_path: diagnostic?.diagnostic_path
        ?? analysis?.diagnostic_path
        ?? analysis?.last_attempt?.diagnostic_path
        ?? analysis?.last_attempt?.error_path
        ?? null,
      safe_error_summary: diagnostic?.safe_error_summary ?? analysis?.safe_error_summary ?? null,
      started_at: activeAttempt?.started_at ?? terminal?.started_at ?? analysis?.last_attempt?.started_at ?? null,
      finished_at: activeAttempt?.finished_at ?? terminal?.finished_at ?? analysis?.last_attempt?.finished_at ?? null,
      event_count: currentFloorEvents.length,
      current_floor_events: currentFloorEvents,
    };
  }

  async function collectActiveBusinessData() {
    const token = chat.token();
    const status = await statusForCurrentFloor();
    chat.assert(token);
    const chatData = store.getChat(token.chatId);
    if (isFloorPreflightStage(status.error_stage)) {
      return buildBusinessData(status, [], chatData);
    }
    let activeEvents;
    try {
      activeEvents = await collectActiveEvents(token);
    } catch (error) {
      if (!isFloorPreflightStage(error?.analysis_stage)) throw error;
      return buildBusinessData(safeFloorPreflightStatus(
        error,
        Object.keys(chatData.tracking_subjects ?? {}).length,
      ), [], chatData);
    }
    chat.assert(token);
    return buildBusinessData(status, activeEvents, chatData);
  }

  function buildBusinessData(status, activeEvents, chatData) {
    const trackingSubjects = chatData.tracking_subjects ?? {};
    const trackingDecisions = activeEvents.flatMap(event => explainTrackingDecision(event)
      .map(decision => ({event_id: event.event_id, ...decision})));
    const sexualActivityCount = activeEvents.filter(event => event.type === 'sexual_activity').length;
    const exposureEventCount = Object.values(trackingSubjects).reduce((total, subject) => (
      total + (Array.isArray(subject?.exposure_event_ids) ? subject.exposure_event_ids.length : 0)
    ), 0);
    const analysisStatus = {
      ...status,
      active_event_count: activeEvents.length,
      sexual_activity_count: sexualActivityCount,
      tracking_subject_count: Object.keys(trackingSubjects).length,
      active_events: activeEvents,
      tracking_decisions: trackingDecisions,
      registry_summary: {
        tracking_subject_count: Object.keys(trackingSubjects).length,
        character_ids: Object.keys(trackingSubjects),
        exposure_event_count: exposureEventCount,
      },
    };
    return {
      tracking_subjects: trackingSubjects,
      character_profiles: chatData.character_profiles ?? {},
      active_events: activeEvents,
      current_floor: status.current_floor,
      last_success: status.last_success,
      analysis_status: analysisStatus,
      ...analysisStatus,
    };
  }

  function executionIsCurrent(execution) {
    return !destroyed
      && !execution.cancelRequested
      && !execution.released
      && inFlight.get(execution.key) === execution
      && !execution.controller?.signal.aborted;
  }

  function assertExecutionCurrent(execution, token) {
    if (!executionIsCurrent(execution)) throw requestAbortedError();
    chat.assert(token);
  }

  function finalizeExecution(execution, state, error = null) {
    if (execution.released) return execution.terminal;
    if (inFlight.get(execution.key) === execution) inFlight.delete(execution.key);
    execution.released = true;
    execution.finished_at = new Date().toISOString();
    const diagnostic = error
      ? executionError(error, execution.stage)
      : execution.diagnostic ?? null;
    const terminal = {
      state,
      attempt: execution.attempt,
      started_at: execution.started_at,
      finished_at: execution.finished_at,
      floor_version: execution.version,
      diagnostic,
    };
    execution.terminal = terminal;
    lastTerminal.set(execution.key, terminal);
    execution.controller = null;
    notify({
      type: 'EVENT_ANALYSIS_STATUS_CHANGED',
      payload: {
        state,
        attempt: execution.attempt,
        started_at: execution.started_at,
        finished_at: execution.finished_at,
        floor_version: execution.version,
        ...(diagnostic ?? {}),
      },
      chatId: execution.version.chat_id,
    });
    if (state === 'success') {
      notify({
        type: 'EVENT_ANALYSIS_COMMITTED',
        payload: {
          state,
          attempt: execution.attempt,
          event_count: execution.event_count ?? 0,
          floor_version: execution.version,
        },
        chatId: execution.version.chat_id,
      });
    }
    return terminal;
  }

  async function persistTerminalAttempt(execution, target, savedAnalysis, status, diagnostic = null) {
    const currentFloorData = store.getFloor?.(target.index, target.swipeId) ?? target.floorData ?? {};
    const previousAnalysis = currentFloorData.analysis ?? savedAnalysis;
    const events = Array.isArray(currentFloorData.events)
      ? currentFloorData.events
      : (Array.isArray(target.floorData?.events) ? target.floorData.events : []);
    const finishedAt = new Date().toISOString();
    const attemptRecord = {
      status,
      attempted_at: finishedAt,
      started_at: execution.started_at,
      finished_at: finishedAt,
      reason: execution.reason,
      attempt: execution.attempt,
      ...(diagnostic ?? {}),
    };
    const analysis = commitAnalysis(previousAnalysis, attemptRecord, target.version);
    await store.saveFloor(target.index, target.swipeId, {
      ...currentFloorData,
      analysis,
      events,
    });
    return analysis;
  }

  async function rollbackLateFloorCommit(execution, target) {
    if (!execution.floorSaved || !store.getFloor) return;
    const current = store.getFloor(target.index, target.swipeId);
    if (current?.analysis?.attempt !== execution.attempt || current?.analysis?.status !== 'success') return;
    try {
      await store.saveFloor(target.index, target.swipeId, target.floorData);
    } catch {
      // The terminal cancellation state is still authoritative in memory; a
      // newer execution is protected by the attempt guard above.
    }
  }

  async function buildFloorAnalysisInput(target, token) {
    const chatData = store.getChat(token.chatId);
    const context = st.getContext?.() ?? {};
    const globalRecentStory = globalRecentStoryResolver?.() ?? {};
    const recentStorySettings = mergeRecentStorySettings(
      globalRecentStory,
      chatData.settings?.recent_story ?? {},
    );
    const storyTimeValue = storyTime?.atFloor?.(target.version.floor)
      ?? normalizeStoryTime(target.message?.story_time ?? target.message?.storyTime ?? null);
    const commonInput = await analysisContextCollector({
      context,
      chatId: token.chatId,
      chatSettings: chatData.settings ?? {},
      globalRecentStory,
      // The shared collector owns floor_count and regex processing. Runtime
      // only supplies the causal prefix of the Chat so a specified target
      // Floor can never pull future narrative into its context.
      recentStoryItems: recentStoryItemsBefore(target.index),
      sourceLoader: analysisSourceLoader,
      sourceLoaderOptions: {
        ...analysisSourceLoaderOptions,
        context,
        fetchRef: analysisSourceLoaderOptions.fetchRef ?? st.fetch,
        getRequestHeaders: analysisSourceLoaderOptions.getRequestHeaders ?? st.getRequestHeaders,
        cache: analysisSourceLoaderOptions.cache ?? sourceCache,
      },
      externalMemoryProviderLoader: collectExternalMemoryProviders,
      excludeRecentFloor: {
        floor: target.version.floor,
        message_id: target.version.message_id,
        swipe_id: target.swipeId,
      },
      includePersonaInTokenEstimate: true,
    });
    const characterContext = characterContextResolver(
      context,
      chatData,
      commonInput,
    );
    const targetMessage = target.message && typeof target.message === 'object' && !Array.isArray(target.message)
      ? {
        ...target.message,
        floor: target.version.floor,
        message_id: target.version.message_id,
        swipe_id: target.swipeId,
        role: messageRole(target.message),
      }
      : {
        content: messageText(target.message, target.swipeId),
        floor: target.version.floor,
        message_id: target.version.message_id,
        swipe_id: target.swipeId,
        role: messageRole(target.message),
      };
    const processedTarget = processNarrativeFloor({
      message: targetMessage,
      floor: target.version.floor,
      messageId: target.version.message_id,
      swipeId: target.swipeId,
      role: messageRole(target.message),
      settings: recentStorySettings,
    });
    return buildEventAnalysisInput({
      ...commonInput,
      chatId: token.chatId,
      floorVersion: target.version,
      currentFloor: {
        floor: target.version.floor,
        message_id: target.version.message_id,
        swipe_id: target.swipeId,
        narrative: processedTarget?.content ?? '',
        role: messageRole(target.message),
      },
      worldModel: chatData.world_model,
      storyTime: storyTimeValue,
      characterContext,
      existingBioWeave: {
        analysis: target.floorData?.analysis ?? null,
        events: Array.isArray(target.floorData?.events) ? target.floorData.events : [],
      },
    });
  }

  async function runAnalysis(execution, target, savedAnalysis) {
    let token = null;
    let terminalState = 'failed';
    let terminalError = null;
    try {
      token = chat.token();
      execution.stage = 'request_build';
      const analysisInput = await buildFloorAnalysisInput(target, token);
      if (typeof analyzer?.analyzeFloor !== 'function') throw new Error('EVENT_ANALYZER_UNAVAILABLE');

      execution.stage = 'api_request';
      const result = await analyzer.analyzeFloor({
        analysisInput,
        floor_version: target.version,
        authoritative_floor_version: target.version,
        signal: execution.controller.signal,
      });
      assertExecutionCurrent(execution, token);

      execution.stage = 'normalization';
      const events = await Promise.all((Array.isArray(result?.events) ? result.events : []).map(async (event, ordinal) => {
        const facts = event && typeof event === 'object' && !Array.isArray(event)
          ? Object.fromEntries(Object.entries(event).filter(([key]) => key !== 'event_id' && key !== 'source'))
          : event;
        const normalized = normalizeEvent(facts);
        return normalizeEvent({
          ...normalized,
          event_id: await deterministicEventId(target.version, ordinal),
          source: target.version,
        });
      }));
      execution.stage = 'schema_validation';
      const invalidEvent = events
        .map((event, index) => ({event, index, validation: validateEvent(event)}))
        .find(item => !item.validation.ok);
      if (invalidEvent) {
        const firstError = invalidEvent.validation.errors?.[0] ?? null;
        const error = new Error('EVENT_DOMAIN_VALIDATION_FAILED');
        error.code = 'EVENT_DOMAIN_VALIDATION_FAILED';
        error.diagnostic_code = 'domain_validation_failed';
        error.diagnostic_path = `$.events[${invalidEvent.index}]${firstError ? `.${firstError}` : ''}`;
        error.error_path = error.diagnostic_path;
        throw error;
      }
      const analyzedAt = new Date().toISOString();
      const analysis = commitAnalysis(savedAnalysis, {
        status: 'success', analyzed_at: analyzedAt, last_analyzed_at: analyzedAt,
        started_at: execution.started_at, finished_at: analyzedAt,
        event_count: events.length, reason: execution.reason, attempt: execution.attempt,
      }, target.version);

      execution.stage = 'floor_save';
      assertExecutionCurrent(execution, token);
      await store.saveFloor(target.index, target.swipeId, {...target.floorData, analysis, events});
      execution.floorSaved = true;
      assertExecutionCurrent(execution, token);

      execution.stage = 'chat_save';
      const currentChat = store.getChat(token.chatId);
      const previousProcessedFloor = Number(currentChat.index?.last_processed_floor);
      const lastProcessedFloor = Number.isFinite(previousProcessedFloor)
        ? Math.max(previousProcessedFloor, target.version.floor)
        : target.version.floor;
      assertExecutionCurrent(execution, token);
      await store.saveChat(token.chatId, {
        ...currentChat,
        index: {...(currentChat.index ?? {}), last_processed_floor: lastProcessedFloor},
      });

      execution.stage = 'registry_rebuild';
      assertExecutionCurrent(execution, token);
      await refreshTrackingRegistry(execution.reason);
      assertExecutionCurrent(execution, token);
      execution.event_count = events.length;
      terminalState = 'success';
      return {events, version: target.version, status: 'success', attempt: execution.attempt};
    } catch (error) {
      const cancelled = execution.cancelRequested || isRequestAborted(error) || error?.code === 'REQUEST_ABORTED';
      if (cancelled) {
        terminalState = 'cancelled';
        terminalError = requestAbortedError();
        execution.diagnostic = executionError(terminalError, 'cancelled');
        await rollbackLateFloorCommit(execution, target);
        if (!execution.released) {
          try {
            await persistTerminalAttempt(execution, target, savedAnalysis, 'cancelled', execution.diagnostic);
          } catch {
            // Cancellation must remain an informational terminal state even if
            // the host cannot persist the diagnostic metadata.
          }
        }
        throw terminalError;
      }

      terminalState = 'failed';
      terminalError = error;
      execution.diagnostic = executionError(error, execution.stage);
      error.analysis_stage ??= execution.diagnostic.stage;
      error.error_code ??= execution.diagnostic.error_code;
      error.safe_error_summary ??= execution.diagnostic.safe_error_summary;
      // Chat epoch 变化后的结果不属于当前作用域；释放执行即可，不能把旧
      // Floor 的失败元数据写回当前 Chat/Swipe。
      if (!execution.released && !isStaleChat(error)) {
        try {
          await persistTerminalAttempt(execution, target, savedAnalysis, 'failed', execution.diagnostic);
          try {
            await refreshTrackingRegistry('analysis-failed');
          } catch (registryError) {
            if (registryError?.message === 'STALE_CHAT') throw registryError;
          }
        } catch (saveError) {
          if (saveError?.message === 'STALE_CHAT') throw saveError;
        }
      }
      throw error;
    } finally {
      if (!execution.released) finalizeExecution(execution, terminalState, terminalError);
    }
  }

  async function analyzeFloor(selector = null, {force = false, reason = 'automatic'} = {}) {
    const target = await resolveFloor(selector);
    const requestKey = floorExecutionKey(target.version);
    if (inFlight.has(requestKey)) return inFlight.get(requestKey).promise;
    const savedAnalysis = target.floorData?.analysis ?? null;
    if (!shouldAnalyze(savedAnalysis, {version: target.version, manual: force})) {
      return {skipped: true, version: target.version, status: 'success'};
    }
    const attempt = ++attemptSequence;
    const controller = new AbortController();
    const execution = {
      key: requestKey,
      version: target.version,
      attempt,
      reason,
      controller,
      started_at: new Date().toISOString(),
      stage: 'request_build',
      cancelRequested: false,
      released: false,
      floorSaved: false,
      promise: null,
    };
    inFlight.set(requestKey, execution);
    execution.promise = runAnalysis(execution, target, savedAnalysis);
    notify({
      type: 'EVENT_ANALYSIS_STATUS_CHANGED',
      payload: {
        state: 'running',
        attempt,
        started_at: execution.started_at,
        floor_version: target.version,
      },
      chatId: target.chatId,
    });
    return execution.promise;
  }

  function analyzeCurrentFloor(options = {}) {
    return analyzeFloor(null, options);
  }

  function refreshCurrentFloorAnalysis() {
    return analyzeCurrentFloor({force: true, reason: 'manual-refresh'});
  }

  async function getCurrentFloorAnalysisInput() {
    const target = await resolveFloor();
    const token = chat.token();
    chat.assert(token);
    return buildFloorAnalysisInput(target, token);
  }

  async function requestAbortCurrentFloorAnalysis() {
    let target;
    try {
      target = await resolveFloor();
    } catch (error) {
      if (error?.message === 'MESSAGE_NOT_FOUND') return false;
      throw error;
    }
    const execution = inFlight.get(floorExecutionKey(target.version));
    if (!execution || execution.cancelRequested || execution.released) return false;
    execution.cancelRequested = true;
    const controller = execution.controller;
    controller?.abort?.();
    const terminalError = requestAbortedError();
    execution.diagnostic = executionError(terminalError, 'cancelled');
    finalizeExecution(execution, 'cancelled', terminalError);
    try {
      await persistTerminalAttempt(execution, target, target.floorData?.analysis ?? null, 'cancelled', execution.diagnostic);
    } catch {
      // The in-memory terminal state remains visible; persistence failure must
      // not turn an intentional cancellation into an error notification.
    }
    return true;
  }

  async function handleLifecycleEvent(event) {
    if (event?.type === 'MESSAGE_DELETED' || event?.type === 'CHAT_CHANGED') {
      await refreshTrackingRegistry(event.type);
      return {skipped: true, reason: event.type};
    }
    if (!AUTO_ANALYSIS_EVENTS.has(event?.type)) return {skipped: true, reason: 'unsupported-event'};
    const target = resolveMessage(event?.payload ?? null);
    const floor = messageFloor(target.message, target.index);
    const chatData = store.getChat(chat.current());
    const interval = Number(chatData.settings?.analysis_interval ?? 3);
    if (!FORCED_LIFECYCLE_EVENTS.has(event.type)
      && !isIntervalTarget(floor, chatData.index?.last_processed_floor, interval)) {
      return {skipped: true, reason: 'interval'};
    }
    return analyzeFloor({__messageIndex: true, index: target.index}, {force: false, reason: event.type});
  }

  async function findActiveEvent(eventId) {
    const targetId = String(eventId ?? '').trim();
    if (!targetId) throw new Error('EVENT_NOT_FOUND');
    const all = messages();
    for (let index = 0; index < all.length; index += 1) {
      const target = await resolveFloor({__messageIndex: true, index});
      const events = store.getActiveFloorEvents?.(index, target.version) ?? [];
      const eventIndex = events.findIndex(event => String(event?.event_id) === targetId);
      if (eventIndex >= 0) return {...target, event: events[eventIndex]};
    }
    throw new Error('EVENT_NOT_FOUND');
  }

  async function updateEvent(eventId, patch = {}) {
    const target = await findActiveEvent(eventId);
    const nextEvent = normalizeEvent({...target.event, ...patch, event_id: target.event.event_id, source: target.event.source});
    if (!validateEvent(nextEvent).ok) throw new Error('EVENT_ANALYSIS_INVALID');
    const events = [...(Array.isArray(target.floorData.events) ? target.floorData.events : [])];
    const index = events.findIndex(event => String(event?.event_id) === String(eventId));
    if (index < 0) throw new Error('EVENT_NOT_FOUND');
    events[index] = nextEvent;
    await store.saveFloor(target.index, target.swipeId, {...target.floorData, events});
    await refreshTrackingRegistry('event-edit');
    return nextEvent;
  }

  async function deleteEvent(eventId) {
    const target = await findActiveEvent(eventId);
    const events = (Array.isArray(target.floorData.events) ? target.floorData.events : [])
      .filter(event => String(event?.event_id) !== String(eventId));
    await store.saveFloor(target.index, target.swipeId, {...target.floorData, events});
    await refreshTrackingRegistry('event-delete');
    return true;
  }

  function destroy() {
    destroyed = true;
    for (const execution of inFlight.values()) {
      execution.cancelRequested = true;
      execution.controller?.abort?.();
      execution.released = true;
      execution.controller = null;
    }
    inFlight.clear();
  }

  return {
    analyzeCurrentFloor,
    analyzeFloor,
    refreshCurrentFloorAnalysis,
    getCurrentFloorAnalysisInput,
    requestAbortCurrentFloorAnalysis,
    getCurrentFloorAnalysisStatus: statusForCurrentFloor,
    getCurrentFloorEvents: async () => (await statusForCurrentFloor()).current_floor_events,
    getTrackingRegistry: async () => {
      const chatData = store.getChat(chat.current());
      return {
        tracking_subjects: chatData.tracking_subjects ?? {},
        character_profiles: chatData.character_profiles ?? {},
      };
    },
    collectActiveBusinessData,
    handleLifecycleEvent,
    refreshTrackingRegistry,
    updateEvent,
    deleteEvent,
    destroy,
  };
}

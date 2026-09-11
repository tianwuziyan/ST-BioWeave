import {formatStoryTime} from '../story/time.js';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

function displayValue(value, fallback = '—') {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'object') {
    if (typeof value.name === 'string' && value.name) return value.name;
    try {
      return JSON.stringify(value);
    } catch {
      return fallback;
    }
  }
  return String(value);
}

const ANALYSIS_STATES = new Set(['not_analyzed', 'running', 'success', 'failed', 'cancelled']);
const ANALYSIS_STATE_LABELS = Object.freeze({
  not_analyzed: '尚未分析',
  running: '分析中',
  success: '分析成功',
  failed: '分析失败',
  cancelled: '已取消',
});
const DIAGNOSTIC_SECRET_KEYS = /(?:api[_-]?key|authorization|bearer|password|secret|raw(?:[_-]?(?:ai|response))?|request[_-]?body|response[_-]?body|headers?)/i;

function recordValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export function normalizeAnalysisStatus(value = null) {
  const source = recordValue(value);
  const state = ANALYSIS_STATES.has(source.state) ? source.state : 'not_analyzed';
  return {
    ...source,
    state,
    busy: source.busy === true || state === 'running',
  };
}

export function analysisStatusLabel(value = null) {
  return ANALYSIS_STATE_LABELS[normalizeAnalysisStatus(value).state];
}

export function renderAnalysisActionButton(value = null, {className = 'bioweave-primary-action'} = {}) {
  const status = normalizeAnalysisStatus(value);
  const busy = status.busy;
  const label = busy || status.state === 'running'
    ? '分析中… · 点击可终止'
    : status.state === 'success' || status.state === 'failed' || status.state === 'cancelled'
      ? '重新分析当前楼层'
      : '分析当前楼层';
  return '<button type="button" class="' + escapeHtml(className)
    + '" data-bioweave-action="analyze-current-floor" aria-busy="' + String(busy)
    + '">' + label + '</button>';
}

export function analysisStatusEvents(value = null, fallback = [], field = 'active_events') {
  const status = normalizeAnalysisStatus(value);
  const source = Object.prototype.hasOwnProperty.call(status, field) ? status[field] : fallback;
  if (Array.isArray(source)) return source;
  if (source && typeof source === 'object') {
    if (Array.isArray(source.events)) return source.events;
    return Object.values(source);
  }
  return [];
}

export function analysisStatusCount(value = null, field, fallback = 0) {
  const raw = normalizeAnalysisStatus(value)[field];
  const number = typeof raw === 'number' ? raw : Number(raw);
  if (Number.isFinite(number)) return Math.max(0, Math.trunc(number));
  return fallback;
}

export function analysisStatusCurrentFloor(value = null, fallback = null) {
  const status = normalizeAnalysisStatus(value);
  return status.current_floor && typeof status.current_floor === 'object'
    ? status.current_floor
    : fallback;
}

export function analysisStatusFloorVersion(value = null, fallback = null) {
  const status = normalizeAnalysisStatus(value);
  return status.floor_version
    ?? status.current_floor?.version
    ?? status.current_floor?.floor_version
    ?? fallback?.version
    ?? null;
}

function safeDiagnosticClone(value, key = '', seen = new Set()) {
  if (key && DIAGNOSTIC_SECRET_KEYS.test(key)) return undefined;
  if (value === null || value === undefined) return value;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value !== 'object') return String(value);
  if (seen.has(value)) return '[循环引用]';
  const nextSeen = new Set(seen);
  nextSeen.add(value);
  if (Array.isArray(value)) return value.map(item => safeDiagnosticClone(item, '', nextSeen));
  return Object.fromEntries(Object.entries(value)
    .map(([itemKey, item]) => [itemKey, safeDiagnosticClone(item, itemKey, nextSeen)])
    .filter(([, item]) => item !== undefined));
}

function safeDiagnosticText(value, fallback = '—') {
  if (value === null || value === undefined || value === '') return fallback;
  const safeValue = safeDiagnosticClone(value);
  if (safeValue === undefined) return fallback;
  if (typeof safeValue === 'string' || typeof safeValue === 'number' || typeof safeValue === 'boolean') {
    return String(safeValue);
  }
  try {
    return JSON.stringify(safeValue);
  } catch {
    return fallback;
  }
}

function safeDiagnosticJson(value) {
  try {
    return escapeHtml(JSON.stringify(safeDiagnosticClone(value), null, 2) ?? 'null');
  } catch {
    return escapeHtml('null');
  }
}

function compactFloorVersion(version) {
  const source = recordValue(version);
  const hash = source.content_hash === null || source.content_hash === undefined
    ? ''
    : String(source.content_hash);
  const compactHash = hash.length > 12 ? hash.slice(0, 12) + '…' : hash;
  const values = [
    source.chat_id,
    source.message_id,
    source.floor === undefined ? null : `F${source.floor}`,
    source.swipe_id === undefined ? null : `S${source.swipe_id}`,
    compactHash,
    source.message_version,
  ].filter(value => value !== null && value !== undefined && value !== '');
  return values.length ? values.map(value => displayValue(value)).join(' · ') : '—';
}

function analysisTimestamp(value) {
  if (value && typeof value === 'object') {
    for (const key of ['display', 'at', 'analyzed_at', 'completed_at', 'timestamp', 'time']) {
      if (value[key] !== undefined && value[key] !== null && value[key] !== '') return displayValue(value[key]);
    }
  }
  return safeDiagnosticText(value);
}

function renderAnalysisDetail(status, events, registrySummary, version) {
  const source = recordValue(version);
  const versionFields = ['chat_id', 'message_id', 'floor', 'swipe_id', 'content_hash', 'message_version']
    .map(field => '<div><dt>' + escapeHtml(field) + '</dt><dd><code>'
      + escapeHtml(safeDiagnosticText(source[field])) + '</code></dd></div>').join('');
  return '<details class="bioweave-card bioweave-analysis-detail" data-bioweave-analysis-detail>'
    + '<summary>查看分析详情</summary><h3>Event Analysis 详情</h3>'
    + '<dl class="bioweave-data-list bioweave-analysis-metadata">'
    + '<div><dt>status</dt><dd>' + escapeHtml(status.state) + '</dd></div>'
    + '<div><dt>execution_status</dt><dd>' + escapeHtml(status.busy ? 'running' : status.state) + '</dd></div>'
    + '<div><dt>stage</dt><dd>' + escapeHtml(safeDiagnosticText(status.error_stage)) + '</dd></div>'
    + '<div><dt>attempt</dt><dd>' + escapeHtml(safeDiagnosticText(status.attempt)) + '</dd></div>'
    + '<div><dt>started_at</dt><dd>' + escapeHtml(safeDiagnosticText(status.started_at)) + '</dd></div>'
    + '<div><dt>finished_at</dt><dd>' + escapeHtml(safeDiagnosticText(status.finished_at)) + '</dd></div>'
    + '<div><dt>error_code</dt><dd>' + escapeHtml(safeDiagnosticText(status.error_code ?? status.last_error)) + '</dd></div>'
    + '<div><dt>safe_error_summary</dt><dd>' + escapeHtml(safeDiagnosticText(status.safe_error_summary)) + '</dd></div>'
    + '<div><dt>last_success</dt><dd>' + escapeHtml(safeDiagnosticText(status.last_success)) + '</dd></div>'
    + '<div><dt>last_error</dt><dd>' + escapeHtml(safeDiagnosticText(status.last_error)) + '</dd></div>'
    + versionFields + '</dl>'
    + '<section><h4>解析后的 Event JSON</h4><pre data-bioweave-analysis-events-json>'
    + safeDiagnosticJson(events) + '</pre></section>'
    + '<section><h4>Registry Summary</h4><pre data-bioweave-registry-summary>'
    + safeDiagnosticJson(registrySummary) + '</pre></section>'
    + '</details>';
}

function entriesOf(value) {
  if (Array.isArray(value)) return value.map((item, index) => ({key: index, value: item}));
  if (value && typeof value === 'object') return Object.entries(value).map(([key, item]) => ({key, value: item}));
  return [];
}

function characterIdOf(value, fallback = '') {
  return String(value?.character_id ?? value?.id ?? fallback ?? '').trim();
}

function eventIdOf(value, fallback = '') {
  return String(value?.event_id ?? fallback ?? '').trim();
}

function renderSubjectList(trackingSubjects) {
  const subjects = entriesOf(trackingSubjects)
    .map(({key, value}) => ({id: characterIdOf(value, key), value}))
    .filter(({id, value}) => id && value && typeof value === 'object');
  if (!subjects.length) {
    return '<div class="bioweave-empty">当前暂无需要追踪的角色。</div>';
  }
  return subjects.slice(0, 5).map(({id, value: subject}) => '<button type="button" class="bioweave-character-row" data-character-id="'
    + escapeHtml(id) + '"><span><b>' + escapeHtml(displayValue(subject.display_name, id))
    + '</b><small class="bioweave-muted">稳定 character_id：' + escapeHtml(id) + '</small></span>'
    + '<span>›</span></button>').join('');
}

function storyTimeDisplay(event) {
  return formatStoryTime(event?.story_time);
}

function renderRecentEvents(activeEvents) {
  const events = entriesOf(activeEvents)
    .map(({key, value}) => ({id: eventIdOf(value, key), value}))
    .filter(({id, value}) => id && value && typeof value === 'object');
  if (!events.length) return '<div class="bioweave-empty">当前 Chat 尚无生理历史事件。</div>';
  return '<div class="bioweave-event-list">' + events.slice(0, 5).map(({id, value: event}) => {
    const floor = event?.source?.floor ?? event?.floor;
    return '<article class="bioweave-card bioweave-overview-event"><header><b>'
      + escapeHtml(displayValue(event.type, 'BiologicalEvent')) + '</b><span class="bioweave-badge">'
      + escapeHtml(displayValue(event.status)) + '</span></header><p class="bioweave-muted">Event ID：<code>'
      + escapeHtml(id) + '</code></p><p>Story Time：' + escapeHtml(displayValue(storyTimeDisplay(event)))
      + ' · Floor：' + escapeHtml(displayValue(floor)) + '</p><p>Location：'
      + escapeHtml(displayValue(event.location)) + '</p></article>';
  }).join('') + '</div>';
}

export function overviewPage({
  trackingSubjects = [],
  activeEvents,
  events,
  chatName = '当前 Chat',
  currentFloor = null,
  lastAnalysis = null,
  analysisStatus = null,
} = {}) {
  const status = normalizeAnalysisStatus(analysisStatus);
  const subjects = entriesOf(trackingSubjects)
    .map(({key, value}) => ({id: characterIdOf(value, key), value}))
    .filter(({id, value}) => id && value && typeof value === 'object');
  const fallbackEvents = Array.isArray(activeEvents) ? activeEvents : entriesOf(events).map(({value}) => value);
  const biologicalEvents = analysisStatusEvents(status, fallbackEvents, 'active_events');
  const currentFloorEvents = analysisStatusEvents(status, [], 'current_floor_events');
  const floorRecord = analysisStatusCurrentFloor(status, currentFloor);
  const floor = floorRecord && typeof floorRecord === 'object' ? floorRecord.floor : floorRecord;
  const version = analysisStatusFloorVersion(status, currentFloor);
  const eventCount = analysisStatusCount(status, 'event_count', currentFloorEvents.length);
  const activeEventCount = analysisStatusCount(status, 'active_event_count', biologicalEvents.length);
  const subjectCount = analysisStatusCount(status, 'tracking_subject_count', subjects.length);
  const lastSuccess = Object.prototype.hasOwnProperty.call(status, 'last_success')
    ? status.last_success
    : lastAnalysis;
  const errorSummary = status.last_error;
  return '<section class="bioweave-page bioweave-overview-page"><div class="bioweave-page-title"><div><h2>总览</h2><p>'
    + '<strong class="bioweave-chat-name">' + escapeHtml(displayValue(chatName, '当前 Chat')) + '</strong>'
    + ' <span class="bioweave-muted">· 当前 Floor ' + escapeHtml(displayValue(floor))
    + ' · Floor Version：' + escapeHtml(compactFloorVersion(version))
    + ' · Analysis Status：' + escapeHtml(analysisStatusLabel(status)) + '</span></p></div>'
    + '<div class="bioweave-page-actions">' + renderAnalysisActionButton(status) + '</div></div>'
    + '<div class="bioweave-summary"><div><strong>' + subjectCount + '</strong><span>追踪人物</span></div>'
    + '<div><strong>' + activeEventCount + '</strong><span>事件</span></div>'
    + '<div><strong>—</strong><span>推演</span></div><div><strong>—</strong><span>家系代数</span></div></div>'
    + '<div class="bioweave-overview-grid"><section class="bioweave-card bioweave-characters"><header><b>人物总览</b>'
    + '<button type="button" data-route="characters">查看全部</button></header>' + renderSubjectList(trackingSubjects)
    + '</section><section class="bioweave-card"><header><b>最近事件</b><button type="button" data-route="events">查看全部</button></header>'
    + renderRecentEvents(biologicalEvents) + '</section>'
    + '<section class="bioweave-card"><header><b>当前推演</b><button type="button" data-route="projection">查看全部</button></header>'
    + '<div class="bioweave-empty">当前没有需要展示的生理推演。推演并非已发生事实。</div></section>'
    + '<section class="bioweave-card"><header><b>家系概览</b><button type="button" data-route="genealogy">查看图谱</button></header>'
    + '<div class="bioweave-empty">尚未建立已确认的亲子关系。</div></section>'
    + '<section class="bioweave-card"><header><b>世界概览</b><button type="button" data-route="world">查看详情</button></header>'
    + '<div class="bioweave-empty">世界模型尚未建立。</div></section>'
    + '<section class="bioweave-card bioweave-analysis-status-card"><header><b>分析状态</b>'
    + '<span class="bioweave-badge">' + escapeHtml(analysisStatusLabel(status)) + '</span></header>'
    + '<dl class="bioweave-data-list">'
    + '<div><dt>当前 Floor</dt><dd>' + escapeHtml(displayValue(floor)) + '</dd></div>'
    + '<div><dt>Floor Version</dt><dd><code>' + escapeHtml(compactFloorVersion(version)) + '</code></dd></div>'
    + '<div><dt>Analysis Status</dt><dd>' + escapeHtml(status.state) + '</dd></div>'
    + '<div><dt>Last Success</dt><dd>' + escapeHtml(analysisTimestamp(lastSuccess)) + '</dd></div>'
    + '<div><dt>Current Floor Event Count</dt><dd>' + eventCount + '</dd></div>'
    + '<div><dt>Tracking Subject Count</dt><dd>' + subjectCount + '</dd></div>'
    + '<div><dt>Error Summary</dt><dd>' + escapeHtml(safeDiagnosticText(errorSummary)) + '</dd></div>'
    + '</dl>'
    + renderAnalysisDetail(status, currentFloorEvents, status.registry_summary, version)
    + '</section></div></section>';
}

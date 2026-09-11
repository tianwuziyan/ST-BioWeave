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
const EVENT_TYPE_LABELS = Object.freeze({
  sexual_activity: '性活动',
  conception: '受孕事件',
  pregnancy_suspicion: '妊娠疑似',
  pregnancy_confirmation: '妊娠确认',
  pregnancy_loss: '妊娠终止',
  abortion: '人工流产',
  labor: '分娩过程',
  delivery: '分娩',
  postpartum: '产后事件',
  menstrual_event: '月经事件',
  ovulation_event: '排卵事件',
  fertility_change: '生育能力变化',
  physical_symptom: '身体症状',
  medical_event: '医疗事件',
  other_biological: '其他生理事件',
});
const EVENT_STATUS_LABELS = Object.freeze({
  confirmed: '已确认',
  probable: '较可能',
  ambiguous: '有歧义',
  negated: '已否定',
  fictional: '虚构',
});

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

function analysisTimestamp(value) {
  if (value && typeof value === 'object') {
    for (const key of ['display', 'at', 'analyzed_at', 'completed_at', 'timestamp', 'time']) {
      if (value[key] !== undefined && value[key] !== null && value[key] !== '') return displayValue(value[key]);
    }
    return '—';
  }
  return displayValue(value);
}

function entriesOf(value) {
  if (Array.isArray(value)) return value.map((item, index) => ({key: index, value: item}));
  if (value && typeof value === 'object') return Object.entries(value).map(([key, item]) => ({key, value: item}));
  return [];
}

function characterIdOf(value, fallback = '') {
  return String(value?.character_id ?? value?.id ?? fallback ?? '').trim();
}

function renderSubjectList(trackingSubjects) {
  const subjects = entriesOf(trackingSubjects)
    .map(({key, value}) => ({id: characterIdOf(value, key), value}))
    .filter(({id, value}) => id && value && typeof value === 'object');
  if (!subjects.length) {
    return '<div class="bioweave-empty">当前暂无需要追踪的角色。</div>';
  }
  return subjects.slice(0, 5).map(({id, value: subject}) => '<button type="button" class="bioweave-character-row" data-character-id="'
    + escapeHtml(id) + '"><span><b>' + escapeHtml(displayValue(subject.display_name, '未命名角色'))
    + '</b></span>'
    + '<span>›</span></button>').join('');
}

function storyTimeDisplay(event) {
  return formatStoryTime(event?.story_time);
}

function renderRecentEvents(activeEvents) {
  const events = entriesOf(activeEvents)
    .map(({value}) => value)
    .filter(value => value && typeof value === 'object');
  if (!events.length) return '<div class="bioweave-empty">当前 Chat 尚无生理历史事件。</div>';
  return '<div class="bioweave-event-list">' + events.slice(0, 5).map(event => {
    return '<article class="bioweave-card bioweave-overview-event"><header><b>'
      + escapeHtml(EVENT_TYPE_LABELS[event.type] ?? displayValue(event.type, '生理事件')) + '</b><span class="bioweave-badge">'
      + escapeHtml(EVENT_STATUS_LABELS[event.status] ?? displayValue(event.status)) + '</span></header><p>发生时间：'
      + escapeHtml(displayValue(storyTimeDisplay(event))) + '</p><p>地点：'
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
  const eventCount = analysisStatusCount(status, 'event_count', currentFloorEvents.length);
  const activeEventCount = analysisStatusCount(status, 'active_event_count', biologicalEvents.length);
  const subjectCount = analysisStatusCount(status, 'tracking_subject_count', subjects.length);
  const lastSuccess = Object.prototype.hasOwnProperty.call(status, 'last_success')
    ? status.last_success
    : lastAnalysis;
  return '<section class="bioweave-page bioweave-overview-page"><div class="bioweave-page-title"><div><h2>总览</h2><p>'
    + '<strong class="bioweave-chat-name">' + escapeHtml(displayValue(chatName, '当前 Chat')) + '</strong>'
    + ' <span class="bioweave-muted">· 当前 Floor ' + escapeHtml(displayValue(floor))
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
    + '<div><dt>Analysis Status</dt><dd>' + escapeHtml(analysisStatusLabel(status)) + '</dd></div>'
    + '<div><dt>最近成功分析</dt><dd>' + escapeHtml(analysisTimestamp(lastSuccess)) + '</dd></div>'
    + '<div><dt>Current Floor Event Count</dt><dd>' + eventCount + '</dd></div>'
    + '<div><dt>Tracking Subject Count</dt><dd>' + subjectCount + '</dd></div>'
    + '</dl>'
    + '</section></div></section>';
}

import {formatStoryTime} from '../story/time.js';
import {
  analysisStatusCount,
  analysisStatusEvents,
  eventStatusTone,
  normalizeAnalysisStatus,
  renderAnalysisActionButton,
} from './overview.js';

const eventStatuses = ['confirmed', 'probable', 'ambiguous', 'negated', 'fictional'];

const eventTypeLabels = {
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
};

const eventStatusLabels = {
  confirmed: '已确认',
  probable: '较可能',
  ambiguous: '有歧义',
  negated: '已否定',
  fictional: '虚构',
};

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

function renderValue(value, fallback = '—') {
  return escapeHtml(displayValue(value, fallback));
}

function renderTriState(value) {
  if (value === true) return '是';
  if (value === false) return '否';
  if (value === null) return '未知';
  return renderValue(value);
}

function entriesOf(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return Object.values(value);
  return [];
}

function eventIdOf(event, fallback = '') {
  return String(event?.event_id ?? fallback ?? '').trim();
}

function renderDefinitionList(rows, className = '') {
  return '<dl class="bioweave-data-list ' + escapeHtml(className) + '">'
    + rows.map(([label, value]) => '<div><dt>' + escapeHtml(label) + '</dt><dd>'
      + (typeof value === 'string' && value.startsWith('__html__') ? value.slice(8) : renderValue(value))
      + '</dd></div>').join('') + '</dl>';
}

function participantNamesForIds(event, value) {
  if (!Array.isArray(value) || !value.length) return '—';
  const participants = new Map((Array.isArray(event?.participants) ? event.participants : [])
    .map(participant => [String(participant?.character_id ?? ''), participant]));
  return value.map(id => escapeHtml(displayValue(participants.get(String(id))?.display_name, '未命名对象'))).join('、');
}

function eventTypeLabel(value) {
  return eventTypeLabels[value] ?? displayValue(value, '生理事件');
}

function eventStatusLabel(value) {
  return eventStatusLabels[value] ?? displayValue(value);
}

function renderPregnancyRelevance(event) {
  const relevance = event?.pregnancy_relevance;
  if (!relevance || typeof relevance !== 'object') {
    return '<div class="bioweave-empty">—</div>';
  }
  return renderDefinitionList([
    ['与妊娠相关', `__html__${renderTriState(relevance.relevant)}`],
    ['存在受孕可能', `__html__${renderTriState(relevance.possible_conception)}`],
    ['妊娠追踪对象', `__html__${participantNamesForIds(event, relevance.gestational_subject_ids)}`],
    ['相关对象', `__html__${participantNamesForIds(event, relevance.counterpart_ids)}`],
    ['判断置信度', `__html__${renderValue(relevance.confidence)}`],
  ], 'bioweave-pregnancy-relevance');
}

function renderEvidence(event) {
  const evidence = Array.isArray(event?.source_evidence) ? event.source_evidence : [];
  if (!evidence.length) return '<div class="bioweave-empty">无事件证据。</div>';
  return '<ul class="bioweave-event-evidence">' + evidence.map(item =>
    '<li>' + escapeHtml(displayValue(typeof item === 'string' ? item : item?.text, '未提供证据文本')) + '</li>').join('') + '</ul>';
}

function renderEditForm(event) {
  const eventId = eventIdOf(event);
  const jsonValue = value => escapeHtml(JSON.stringify(value ?? null, null, 2));
  return '<form class="bioweave-card bioweave-event-form" data-bioweave-event-form data-bioweave-event-id="'
    + escapeHtml(eventId) + '"><h3>编辑当前有效 Event</h3>'
    + '<p class="bioweave-muted">Event ID 为只读；保存由页面所属 App 处理。</p>'
    + '<label>Event ID<input class="bioweave-input" data-bioweave-event-field="event_id" value="'
    + escapeHtml(eventId) + '" readonly></label>'
    + '<label>Type<input class="bioweave-input" data-bioweave-event-field="type" value="'
    + escapeHtml(displayValue(event.type, '')) + '" /></label>'
    + '<label>Status<select class="bioweave-select" data-bioweave-event-field="status">'
    + eventStatuses.map(status => '<option value="' + status + '"' + (event.status === status ? ' selected' : '') + '>'
      + status + '</option>').join('') + '</select></label>'
    + '<label>Location<input class="bioweave-input" data-bioweave-event-field="location" value="'
    + escapeHtml(displayValue(event.location, '')) + '" /></label>'
    + '<label>Story Time<textarea class="bioweave-input" data-bioweave-event-field="story_time">'
    + jsonValue(event.story_time) + '</textarea></label>'
    + '<label>Participants / Roles<textarea class="bioweave-input" data-bioweave-event-field="participants">'
    + jsonValue(event.participants) + '</textarea></label>'
    + '<label>Pregnancy Relevance<textarea class="bioweave-input" data-bioweave-event-field="pregnancy_relevance">'
    + jsonValue(event.pregnancy_relevance) + '</textarea></label>'
    + '<label>Source Evidence<textarea class="bioweave-input" data-bioweave-event-field="source_evidence">'
    + jsonValue(event.source_evidence) + '</textarea></label>'
    + '<div class="bioweave-page-actions"><button type="button" class="bioweave-primary-action" data-bioweave-action="save-event" data-bioweave-event-id="'
    + escapeHtml(eventId) + '">保存 Event</button><button type="button" class="bioweave-secondary-action" data-bioweave-action="cancel-event-edit" data-bioweave-event-id="'
    + escapeHtml(eventId) + '">取消</button></div></form>';
}

function renderEventCard(event, editingEventId) {
  const eventId = eventIdOf(event);
  const confidence = event?.pregnancy_relevance?.confidence ?? event?.confidence;
  return '<article class="bioweave-card bioweave-event-card" data-bioweave-event-id="' + escapeHtml(eventId) + '">'
    + '<header><div><b>' + escapeHtml(eventTypeLabel(event.type)) + '</b></div>'
    + '<span class="bioweave-badge ' + eventStatusTone(event.status) + '">' + escapeHtml(eventStatusLabel(event.status)) + '</span></header>'
    + renderDefinitionList([
      ['发生时间', `__html__${renderValue(formatStoryTime(event?.story_time))}`],
      ['地点', `__html__${renderValue(event.location)}`],
      ['判断置信度', `__html__${renderValue(confidence)}`],
    ])
    + '<section><h4>妊娠相关性</h4>' + renderPregnancyRelevance(event) + '</section>'
    + '<section><h4>事件证据</h4>' + renderEvidence(event) + '</section>'
    + '<div class="bioweave-page-actions"><button type="button" class="bioweave-secondary-action" data-bioweave-action="edit-event" data-bioweave-event-id="'
    + escapeHtml(eventId) + '">编辑 Event</button><button type="button" class="bioweave-danger-action" data-bioweave-action="delete-event" data-bioweave-event-id="'
    + escapeHtml(eventId) + '">删除 Event</button></div>'
    + (editingEventId === eventId ? renderEditForm(event) : '') + '</article>';
}

export function eventsPage({activeEvents, events, editingEventId = null, analysisStatus = null} = {}) {
  const status = normalizeAnalysisStatus(analysisStatus);
  const fallbackEvents = Array.isArray(activeEvents) ? activeEvents : entriesOf(events);
  const biologicalEvents = analysisStatusEvents(status, fallbackEvents, 'active_events');
  const eventCount = analysisStatusCount(status, 'active_event_count', biologicalEvents.length);
  const emptyCopy = status.state === 'success'
    ? '当前楼层已完成分析，但没有识别到 BiologicalEvent。'
    : status.state === 'running'
      ? '当前楼层正在分析，暂时没有可显示的 BiologicalEvent。'
      : status.state === 'cancelled'
        ? '本次楼层分析已取消；现有历史事件仍然保留。'
      : status.state === 'failed'
        ? '当前楼层分析失败，尚无可显示的 BiologicalEvent。'
        : '当前 Chat 尚无 BiologicalEvent。';
  const currentFloorNotice = status.state === 'success' && analysisStatusCount(status, 'event_count', biologicalEvents.length) === 0
    ? '<p class="bioweave-muted">当前楼层已完成分析，但没有识别到 BiologicalEvent。下方保留当前 Chat 的历史事件。</p>'
    : status.state === 'cancelled' && biologicalEvents.length
      ? '<p class="bioweave-muted">本次楼层分析已取消；下方保留当前 Chat 的历史事件。</p>'
    : status.state === 'not_analyzed' && biologicalEvents.length
      ? '<p class="bioweave-muted">当前楼层尚未完成分析；下方为当前 Chat 已保存的历史事件。</p>'
      : '';
  const cards = biologicalEvents.map(event => renderEventCard(event, editingEventId)).join('');
  return '<section class="bioweave-page bioweave-events-page" data-bioweave-page="events"><div class="bioweave-page-title bioweave-page-head"><div><h2>历史事件</h2>'
    + '<p class="bioweave-muted">当前 Chat 的 BiologicalEvent 事实</p></div>'
    + '<div class="bioweave-page-actions">' + renderAnalysisActionButton(status)
    + '<span class="bioweave-badge">' + eventCount + ' 个事件</span></div></div>'
    + currentFloorNotice
    + (biologicalEvents.length ? '<div class="bioweave-event-list">' + cards + '</div>'
      : '<section class="bioweave-card bioweave-empty"><b>' + emptyCopy + '</b>'
        + '<p>完成当前楼层分析后，已解析的事件详情会显示在这里。</p></section>')
    + '</section>';
}

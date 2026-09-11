import {formatStoryTime} from '../story/time.js';

const eventStatuses = ['confirmed', 'probable', 'ambiguous', 'negated', 'fictional'];

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

function storyTime(event) {
  const value = event?.story_time;
  return value && typeof value === 'object' ? value : {display: value};
}

function renderDefinitionList(rows, className = '') {
  return '<dl class="bioweave-data-list ' + escapeHtml(className) + '">'
    + rows.map(([label, value]) => '<div><dt>' + escapeHtml(label) + '</dt><dd>'
      + (typeof value === 'string' && value.startsWith('__html__') ? value.slice(8) : renderValue(value))
      + '</dd></div>').join('') + '</dl>';
}

function renderParticipants(event) {
  const participants = Array.isArray(event?.participants) ? event.participants : [];
  if (!participants.length) return '<div class="bioweave-empty">无参与者资料。</div>';
  return '<ul class="bioweave-event-participants">' + participants.map(participant => {
    const id = participant?.character_id;
    const name = participant?.display_name ?? id ?? '未命名角色';
    const role = participant?.event_role ?? participant?.role;
    return '<li><b>' + escapeHtml(displayValue(name)) + '</b>'
      + (id ? ' <code>character_id：' + escapeHtml(id) + '</code>' : '')
      + '<span class="bioweave-muted"> · Reproductive Role：' + renderValue(role) + '</span></li>';
  }).join('') + '</ul>';
}

function formatIdList(value) {
  if (!Array.isArray(value) || !value.length) return '—';
  return value.map(item => escapeHtml(item)).join('、');
}

function renderPregnancyRelevance(event) {
  const relevance = event?.pregnancy_relevance;
  if (!relevance || typeof relevance !== 'object') {
    return '<div class="bioweave-empty">—</div>';
  }
  return renderDefinitionList([
    ['Relevant', `__html__${renderTriState(relevance.relevant)}`],
    ['Possible Conception', `__html__${renderTriState(relevance.possible_conception)}`],
    ['Gestational Subject IDs', `__html__${formatIdList(relevance.gestational_subject_ids)}`],
    ['Counterpart IDs', `__html__${formatIdList(relevance.counterpart_ids)}`],
    ['Confidence', `__html__${renderValue(relevance.confidence)}`],
  ], 'bioweave-pregnancy-relevance');
}

function renderStoryTime(event) {
  const time = storyTime(event);
  return renderDefinitionList([
    ['Display', formatStoryTime(event?.story_time)],
    ['Normalized', time.normalized],
    ['Day Index', time.day_index],
    ['Calendar ID', time.calendar_id],
    ['Provider', time.provider],
    ['Precision', time.precision],
    ['Confidence', time.confidence],
  ], 'bioweave-story-time');
}

function renderSource(event) {
  const source = event?.source ?? {};
  return '<div data-bioweave-event-readonly="source">' + renderDefinitionList([
    ['event_id', `__html__<code>${escapeHtml(eventIdOf(event))}</code>`],
    ['chat_id', `__html__<code>${escapeHtml(displayValue(source.chat_id))}</code>`],
    ['message_id', `__html__<code>${escapeHtml(displayValue(source.message_id))}</code>`],
    ['floor', `__html__<code>${escapeHtml(displayValue(source.floor))}</code>`],
    ['swipe_id', `__html__<code>${escapeHtml(displayValue(source.swipe_id))}</code>`],
    ['content_hash', `__html__<code>${escapeHtml(displayValue(source.content_hash))}</code>`],
    ['message_version', `__html__<code>${escapeHtml(displayValue(source.message_version))}</code>`],
  ], 'bioweave-event-source') + '</div>';
}

function renderEvidence(event) {
  const evidence = Array.isArray(event?.source_evidence) ? event.source_evidence : [];
  if (!evidence.length) return '<div class="bioweave-empty">无 source evidence。</div>';
  return '<ul class="bioweave-event-evidence">' + evidence.map(item =>
    '<li><span>' + escapeHtml(displayValue(item?.kind)) + '</span>：'
    + escapeHtml(displayValue(item?.text ?? item)) + '</li>').join('') + '</ul>';
}

function renderEditForm(event) {
  const eventId = eventIdOf(event);
  const jsonValue = value => escapeHtml(JSON.stringify(value ?? null, null, 2));
  return '<form class="bioweave-card bioweave-event-form" data-bioweave-event-form data-bioweave-event-id="'
    + escapeHtml(eventId) + '"><h3>编辑当前有效 Event</h3>'
    + '<p class="bioweave-muted">Event ID 与 Source 为只读；保存由页面所属 App 处理。</p>'
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
  const floor = event?.source?.floor ?? event?.floor;
  const confidence = event?.pregnancy_relevance?.confidence ?? event?.confidence;
  return '<article class="bioweave-card bioweave-event-card" data-bioweave-event-id="' + escapeHtml(eventId) + '">'
    + '<header><div><b>' + escapeHtml(displayValue(event.type, 'BiologicalEvent')) + '</b>'
    + '<p class="bioweave-muted" data-bioweave-event-readonly="event_id">Event ID：<code>' + escapeHtml(eventId) + '</code></p></div>'
    + '<span class="bioweave-badge">' + escapeHtml(displayValue(event.status)) + '</span></header>'
    + renderDefinitionList([
      ['Story Time', `__html__${renderValue(formatStoryTime(event?.story_time))}`],
      ['Floor', `__html__${renderValue(floor)}`],
      ['Location', `__html__${renderValue(event.location)}`],
      ['Confidence', `__html__${renderValue(confidence)}`],
    ])
    + '<section><h4>Participants / Reproductive Roles</h4>' + renderParticipants(event) + '</section>'
    + '<section><h4>Pregnancy Relevance</h4>' + renderPregnancyRelevance(event) + '</section>'
    + '<section><h4>Story Time</h4>' + renderStoryTime(event) + '</section>'
    + '<section><h4>Source（只读）</h4>' + renderSource(event) + '</section>'
    + '<section><h4>Source Evidence</h4>' + renderEvidence(event) + '</section>'
    + '<div class="bioweave-page-actions"><button type="button" class="bioweave-secondary-action" data-bioweave-action="edit-event" data-bioweave-event-id="'
    + escapeHtml(eventId) + '">编辑 Event</button><button type="button" class="bioweave-danger-action" data-bioweave-action="delete-event" data-bioweave-event-id="'
    + escapeHtml(eventId) + '">删除 Event</button></div>'
    + (editingEventId === eventId ? renderEditForm(event) : '') + '</article>';
}

export function eventsPage({activeEvents, events, editingEventId = null} = {}) {
  const biologicalEvents = Array.isArray(activeEvents)
    ? activeEvents
    : entriesOf(events);
  const cards = biologicalEvents.map(event => renderEventCard(event, editingEventId)).join('');
  return '<section class="bioweave-page bioweave-events-page"><div class="bioweave-page-title"><div><h2>历史事件</h2>'
    + '<p class="bioweave-muted">当前 Chat 的 BiologicalEvent 事实</p></div>'
    + '<span class="bioweave-badge">' + biologicalEvents.length + ' 个事件</span></div>'
    + (biologicalEvents.length ? '<div class="bioweave-event-list">' + cards + '</div>'
      : '<section class="bioweave-card bioweave-empty"><b>当前 Chat 尚无历史事件</b>'
        + '<p>当有效 BiologicalEvent 写入当前 Chat 后，事件详情会显示在这里。</p></section>')
    + '</section>';
}

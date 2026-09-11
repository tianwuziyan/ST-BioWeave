import {formatStoryTime} from '../story/time.js';
import {
  analysisStatusCount,
  analysisStatusEvents,
  normalizeAnalysisStatus,
  renderAnalysisActionButton,
} from './overview.js';

const capabilityLabels = {
  can_produce_sperm: '可产生精子',
  can_produce_ova: '可产生卵子',
  can_be_fertilized: '可受精',
  can_carry_pregnancy: '可承载妊娠',
  can_cause_pregnancy: '可导致受孕',
};

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
  if (Array.isArray(value)) return value.map((item, index) => ({key: index, value: item}));
  if (value && typeof value === 'object') {
    return Object.entries(value).map(([key, item]) => ({key, value: item}));
  }
  return [];
}

function characterIdOf(value, fallback = '') {
  const id = value?.character_id ?? value?.id ?? fallback;
  return String(id ?? '').trim();
}

function subjectEntries(trackingSubjects) {
  return entriesOf(trackingSubjects)
    .map(({key, value}) => ({key: characterIdOf(value, key), value}))
    .filter(({key, value}) => Boolean(key) && value && typeof value === 'object');
}

function profileFor(characterProfiles, characterId) {
  return entriesOf(characterProfiles)
    .map(({key, value}) => ({key: characterIdOf(value, key), value}))
    .find(({key}) => key === characterId)?.value ?? null;
}

function eventIdOf(event, fallback = '') {
  return String(event?.event_id ?? fallback ?? '').trim();
}

function eventEntries(activeEvents) {
  return entriesOf(activeEvents)
    .map(({key, value}) => ({key: eventIdOf(value, key), value}))
    .filter(({key, value}) => Boolean(key) && value && typeof value === 'object');
}

function storyTimeDisplay(event) {
  return escapeHtml(formatStoryTime(event?.story_time));
}

function counterpartSummary(event) {
  const ids = Array.isArray(event?.pregnancy_relevance?.counterpart_ids)
    ? event.pregnancy_relevance.counterpart_ids
    : [];
  if (!ids.length) return '—';
  const participants = new Map((Array.isArray(event?.participants) ? event.participants : [])
    .map(participant => [characterIdOf(participant), participant]));
  return ids.map(id => {
    const participant = participants.get(String(id));
    return displayValue(participant?.display_name, '未命名相关对象');
  }).join('、');
}

function eventTypeLabel(value) {
  return eventTypeLabels[value] ?? displayValue(value, '生理事件');
}

function eventStatusLabel(value) {
  return eventStatusLabels[value] ?? displayValue(value);
}

function subjectStatusLabel(value) {
  if (value === 'active') return '追踪中';
  if (value === 'inactive') return '已结束';
  return displayValue(value, '追踪中');
}

function renderExposureDebug(event, eventId) {
  const source = event?.source ?? {};
  const fields = [
    ['event_id', eventId],
    ['chat_id', source.chat_id],
    ['message_id', source.message_id],
    ['floor', source.floor ?? event?.floor],
    ['swipe_id', source.swipe_id],
    ['content_hash', source.content_hash],
    ['message_version', source.message_version],
  ];
  return '<details class="bioweave-event-debug"><summary>调试信息</summary>'
    + '<dl class="bioweave-data-list">' + fields.map(([label, value]) =>
      '<div><dt>' + escapeHtml(label) + '</dt><dd><code>' + escapeHtml(displayValue(value))
      + '</code></dd></div>').join('') + '</dl></details>';
}

function renderExposureEvent(event, fallbackEventId) {
  const eventId = eventIdOf(event, fallbackEventId);
  if (!event) {
    return '<article class="bioweave-card bioweave-character-exposure" data-bioweave-event-id="'
      + escapeHtml(eventId) + '"><b>相关事件</b><p class="bioweave-muted">当前有效事件中未找到该引用。</p>'
      + '<details class="bioweave-event-debug"><summary>调试信息</summary><p>event_id：<code>'
      + escapeHtml(eventId) + '</code></p></details></article>';
  }
  return '<article class="bioweave-card bioweave-character-exposure" data-bioweave-event-id="'
    + escapeHtml(eventId) + '"><header><b>' + escapeHtml(eventTypeLabel(event.type))
    + '</b><span class="bioweave-badge">' + escapeHtml(eventStatusLabel(event.status)) + '</span></header>'
    + '<dl class="bioweave-data-list">'
    + '<div><dt>发生时间</dt><dd>' + storyTimeDisplay(event) + '</dd></div>'
    + '<div><dt>地点</dt><dd>' + renderValue(event.location) + '</dd></div>'
    + '<div><dt>相关对象</dt><dd>' + escapeHtml(counterpartSummary(event)) + '</dd></div>'
    + '</dl>' + renderExposureDebug(event, eventId) + '</article>';
}

function renderCapabilities(profile) {
  const capabilities = profile?.reproductive_capabilities;
  if (!capabilities || typeof capabilities !== 'object' || Array.isArray(capabilities)) {
    return '<div class="bioweave-empty">尚无可显示的生殖能力资料。</div>';
  }
  const keys = Object.keys(capabilities);
  if (!keys.length) return '<div class="bioweave-empty">尚无可显示的生殖能力资料。</div>';
  return '<dl class="bioweave-data-list bioweave-capabilities">' + keys.map(key =>
    '<div><dt>' + escapeHtml(capabilityLabels[key] ?? key) + '</dt><dd>'
    + renderTriState(capabilities[key]) + '</dd></div>').join('') + '</dl>';
}

function renderCharacterFacts(profile) {
  const biologicalContext = profile?.biological_context ?? {};
  const species = profile?.species ?? biologicalContext.species;
  const type = profile?.biological_type ?? profile?.type ?? biologicalContext.biological_type;
  return '<dl class="bioweave-data-list">'
    + '<div><dt>物种</dt><dd>' + renderValue(species) + '</dd></div>'
    + '<div><dt>生理类型</dt><dd>' + renderValue(type) + '</dd></div>'
    + '</dl>';
}

function renderExposures(subject, activeEvents) {
  const exposureIds = Array.isArray(subject?.exposure_event_ids)
    ? [...new Set(subject.exposure_event_ids.map(value => String(value ?? '').trim()).filter(Boolean))]
    : [];
  if (!exposureIds.length) return '<div class="bioweave-empty">当前没有可显示的 exposure Event。</div>';
  const events = new Map(eventEntries(activeEvents).map(({key, value}) => [key, value]));
  return exposureIds.map(eventId => renderExposureEvent(events.get(eventId), eventId)).join('');
}

function renderCharacterSummary({characterId, subject, profile}) {
  const displayName = profile?.display_name ?? subject?.display_name ?? characterId;
  return '<section class="bioweave-card bioweave-character-summary"><header><b>' + escapeHtml(displayValue(displayName))
    + '</b><span class="bioweave-badge">妊娠追踪</span></header>'
    + renderCharacterFacts(profile)
    + '<details class="bioweave-event-debug"><summary>调试信息</summary><p>character_id：<code>'
    + escapeHtml(characterId) + '</code></p></details></section>';
}

function renderCurrentState() {
  return '<section class="bioweave-card bioweave-detail-section"><h3>当前状态</h3>'
    + '<p class="bioweave-muted">等待状态引擎计算</p></section>';
}

function renderExposuresSection(subject, activeEvents) {
  return '<section class="bioweave-card bioweave-detail-section"><h3>受孕相关记录</h3>'
    + '<p class="bioweave-muted">只展示当前追踪 Registry 引用的有效事件。</p>'
    + renderExposures(subject, activeEvents) + '</section>';
}

function renderProjectionSection() {
  return '<section class="bioweave-card bioweave-detail-section"><h3>推演</h3>'
    + '<div class="bioweave-empty">当前没有可显示的生理推演。推演并非已发生事实。</div></section>';
}

function renderRelationsSection() {
  return '<section class="bioweave-card bioweave-detail-section"><h3>关系</h3>'
    + '<div class="bioweave-empty">尚未建立已确认的亲子或其他关系。</div></section>';
}

function renderNotesSection() {
  return '<section class="bioweave-card bioweave-detail-section"><h3>备注</h3>'
    + '<div class="bioweave-empty">当前没有可显示的人物备注。</div></section>';
}

function detailPage({characterId, subject, profile, activeEvents}) {
  return '<section class="bioweave-page bioweave-character-detail">'
    + '<div class="bioweave-page-title"><div><button type="button" class="bioweave-back" data-back-to-characters>← 返回人物列表</button>'
    + '<h2>人物详情</h2><p class="bioweave-muted">当前 Chat · 妊娠追踪</p></div></div>'
    + renderCharacterSummary({characterId, subject, profile})
    + '<section class="bioweave-card bioweave-detail-section"><h3>生殖能力</h3>'
    + renderCapabilities(profile) + '</section>'
    + renderCurrentState()
    + renderExposuresSection(subject, activeEvents)
    + renderProjectionSection()
    + renderRelationsSection()
    + renderNotesSection()
    + '</section>';
}

function unavailableDetailPage(characterId) {
  return '<section class="bioweave-page bioweave-character-detail">'
    + '<div class="bioweave-page-title"><div><button type="button" class="bioweave-back" data-back-to-characters>← 返回人物列表</button>'
    + '<h2>人物详情</h2></div></div><section class="bioweave-card bioweave-empty">'
    + '<b>当前没有可追踪的角色详情。</b><p>未找到 character_id：<code>' + escapeHtml(characterId) + '</code>。</p>'
    + '</section></section>';
}

export function charactersPage({
  characterId = null,
  trackingSubjects = [],
  characterProfiles = {},
  activeEvents = [],
  analysisStatus = null,
} = {}) {
  const status = normalizeAnalysisStatus(analysisStatus);
  const subjects = subjectEntries(trackingSubjects);
  const effectiveEvents = analysisStatusEvents(status, activeEvents, 'active_events');
  if (characterId) {
    const id = String(characterId);
    const subject = subjects.find(item => item.key === id)?.value;
    if (!subject) return unavailableDetailPage(id);
    return detailPage({
      characterId: id,
      subject,
      profile: profileFor(characterProfiles, id),
      activeEvents: effectiveEvents,
    });
  }
  const rows = subjects.map(({key, value: subject}) => {
    const displayName = subject.display_name ?? key;
    const exposureCount = Array.isArray(subject.exposure_event_ids) ? subject.exposure_event_ids.length : 0;
    return '<button type="button" class="bioweave-card bioweave-character-row" data-character-id="'
      + escapeHtml(key) + '"><span><b>' + escapeHtml(displayValue(displayName))
      + '</b></span><span class="bioweave-character-state">' + escapeHtml(subjectStatusLabel(subject.status))
      + ' · ' + exposureCount + ' 次相关事件　›</span></button>';
  }).join('');
  const emptyState = status.state === 'not_analyzed'
    ? '<div class="bioweave-card bioweave-empty"><b>尚未完成事件分析。</b>'
      + '<p>完成当前楼层分析后，符合追踪条件的角色会显示在这里。</p></div>'
    : status.state === 'running'
      ? '<div class="bioweave-card bioweave-empty"><b>当前楼层正在分析中。</b>'
        + '<p>分析完成后将更新 BiologicalEvent 与 Tracking Subject。</p></div>'
      : status.state === 'cancelled'
        ? '<div class="bioweave-card bioweave-empty"><b>本次事件分析已取消。</b>'
          + '<p>现有 Tracking Subject 与历史事件仍然保留，可重新分析当前楼层。</p></div>'
      : status.state === 'failed'
        ? '<div class="bioweave-card bioweave-empty"><b>当前楼层事件分析失败。</b>'
          + '<p>错误摘要：<code>' + escapeHtml(displayValue(status.last_error, 'EVENT_ANALYSIS_FAILED')) + '</code>。如有旧的成功事件，它们仍然有效。</p></div>'
      : '<div class="bioweave-card bioweave-empty"><b>当前没有需要妊娠追踪的角色。</b>'
      + '<p>当前没有进入 Tracking Subject Registry 的角色。</p>'
      + '<dl class="bioweave-data-list bioweave-tracking-counts">'
      + '<div><dt>当前有效事件</dt><dd>' + analysisStatusCount(status, 'active_event_count', 0) + '</dd></div>'
      + '<div><dt>性活动事件</dt><dd>' + analysisStatusCount(status, 'sexual_activity_count', 0) + '</dd></div>'
      + '<div><dt>妊娠追踪人物</dt><dd>' + analysisStatusCount(status, 'tracking_subject_count', 0) + '</dd></div>'
      + '</dl></div>';
  return '<section class="bioweave-page"><div class="bioweave-page-title"><div><h2>人物列表</h2>'
    + '<p class="bioweave-muted">当前 Chat 中已进入妊娠相关追踪流程的角色</p></div>'
    + '<div class="bioweave-page-actions">' + renderAnalysisActionButton(status) + '</div></div>'
    + (subjects.length
      ? '<div class="bioweave-toolbar"><input class="bioweave-input" placeholder="搜索人物……" aria-label="搜索人物">'
        + '<button class="bioweave-select" type="button">全部状态 ▾</button></div>' + rows
      : emptyState)
    + '</section>';
}

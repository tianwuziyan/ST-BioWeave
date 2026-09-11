import {formatStoryTime} from '../story/time.js';

const characterDetailTabs = [
  ['state', '状态'],
  ['events', '事件'],
  ['projection', '推演'],
  ['relations', '关系'],
  ['notes', '备注'],
];

const capabilityLabels = {
  can_produce_sperm: '可产生精子',
  can_produce_ova: '可产生卵子',
  can_be_fertilized: '可受精',
  can_carry_pregnancy: '可承载妊娠',
  can_cause_pregnancy: '可导致受孕',
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

function participantSummary(event) {
  const participants = Array.isArray(event?.participants) ? event.participants : [];
  if (!participants.length) return '—';
  return participants.map(participant => {
    const name = displayValue(participant?.display_name, '未命名角色');
    const id = characterIdOf(participant);
    const role = participant?.event_role ?? participant?.role;
    const suffix = [id ? `ID：${id}` : '', role ? `角色：${displayValue(role)}` : '']
      .filter(Boolean)
      .join(' · ');
    return `${name}${suffix ? `（${suffix}）` : ''}`;
  }).join('、');
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
    const name = displayValue(participant?.display_name, String(id));
    return `${name}（${String(id)}）`;
  }).join('、');
}

function renderExposureEvent(event, fallbackEventId) {
  const eventId = eventIdOf(event, fallbackEventId);
  if (!event) {
    return '<article class="bioweave-card bioweave-character-exposure" data-bioweave-event-id="'
      + escapeHtml(eventId) + '"><b>Exposure Event</b><p class="bioweave-muted">Event ID：'
      + escapeHtml(eventId) + ' · 当前有效事件中未找到该引用。</p></article>';
  }
  const floor = event?.source?.floor ?? event?.floor;
  return '<article class="bioweave-card bioweave-character-exposure" data-bioweave-event-id="'
    + escapeHtml(eventId) + '"><header><b>' + escapeHtml(displayValue(event.type, 'BiologicalEvent'))
    + '</b><span class="bioweave-badge">' + escapeHtml(displayValue(event.status)) + '</span></header>'
    + '<dl class="bioweave-data-list">'
    + '<div><dt>Event ID</dt><dd><code>' + escapeHtml(eventId) + '</code></dd></div>'
    + '<div><dt>Story Time</dt><dd>' + storyTimeDisplay(event) + '</dd></div>'
    + '<div><dt>Floor</dt><dd>' + renderValue(floor) + '</dd></div>'
    + '<div><dt>Location</dt><dd>' + renderValue(event.location) + '</dd></div>'
    + '<div><dt>Participants / Roles</dt><dd>' + escapeHtml(participantSummary(event)) + '</dd></div>'
    + '<div><dt>Counterpart IDs</dt><dd>' + escapeHtml(counterpartSummary(event)) + '</dd></div>'
    + '</dl></article>';
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
    + '<div><dt>species</dt><dd>' + renderValue(species) + '</dd></div>'
    + '<div><dt>type</dt><dd>' + renderValue(type) + '</dd></div>'
    + '</dl>';
}

function renderExposures(subject, activeEvents) {
  const exposureIds = Array.isArray(subject?.exposure_event_ids)
    ? subject.exposure_event_ids.map(value => String(value ?? '').trim()).filter(Boolean)
    : [];
  if (!exposureIds.length) return '<div class="bioweave-empty">当前没有可显示的 exposure Event。</div>';
  const events = new Map(eventEntries(activeEvents).map(({key, value}) => [key, value]));
  return exposureIds.map(eventId => renderExposureEvent(events.get(eventId), eventId)).join('');
}

function renderTabContent(tab, subject, activeEvents) {
  if (tab === 'state') {
    return '<section class="bioweave-card bioweave-detail-section"><h3>状态</h3>'
      + '<p class="bioweave-muted">等待状态引擎计算</p></section>';
  }
  if (tab === 'events') {
    return '<section class="bioweave-card bioweave-detail-section"><h3>事件</h3>'
      + '<p class="bioweave-muted">以下为该 Tracking Subject 的全部 exposure Event。</p>'
      + renderExposures(subject, activeEvents) + '</section>';
  }
  const content = {
    projection: ['推演', '当前没有可显示的生理推演。推演并非已发生事实。'],
    relations: ['关系', '尚未建立已确认的亲子或其他关系图谱。'],
    notes: ['备注', '当前没有可显示的人物备注。'],
  }[tab] ?? ['状态', '等待状态引擎计算'];
  return '<section class="bioweave-card bioweave-detail-section"><h3>' + content[0]
    + '</h3><div class="bioweave-empty">' + content[1] + '</div></section>';
}

function detailPage({characterId, characterDetailTab, subject, profile, activeEvents}) {
  const tab = characterDetailTabs.some(([id]) => id === characterDetailTab) ? characterDetailTab : 'state';
  const displayName = profile?.display_name ?? subject?.display_name ?? characterId;
  const buttons = characterDetailTabs.map(([id, label]) => '<button type="button" role="tab" data-character-tab="'
    + id + '" aria-selected="' + String(id === tab) + '" class="' + (id === tab ? 'active' : '') + '">'
    + label + '</button>').join('');
  return '<section class="bioweave-page bioweave-character-detail">'
    + '<div class="bioweave-page-title"><div><button type="button" class="bioweave-back" data-back-to-characters>← 返回人物列表</button>'
    + '<h2>人物详情</h2><p class="bioweave-muted">人物 ID：' + escapeHtml(characterId) + ' · 当前 Chat</p></div></div>'
    + '<section class="bioweave-card bioweave-character-summary"><header><b>' + escapeHtml(displayValue(displayName))
    + '</b><span class="bioweave-badge">Tracking Subject</span></header>'
    + '<p class="bioweave-muted">稳定 character_id：<code>' + escapeHtml(characterId) + '</code></p>'
    + renderCharacterFacts(profile) + '</section>'
    + '<section class="bioweave-card bioweave-detail-section"><h3>生殖能力</h3>'
    + renderCapabilities(profile) + '</section>'
    + '<div class="bioweave-character-tabs" role="tablist" aria-label="人物详情分区">' + buttons + '</div>'
    + renderTabContent(tab, subject, activeEvents)
    + '<section class="bioweave-card bioweave-detail-section"><h3>Exposure Events</h3>'
    + '<p class="bioweave-muted">只展示 Registry 引用的当前有效事件。</p>'
    + renderExposures(subject, activeEvents) + '</section>'
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
  characterDetailTab = 'state',
  trackingSubjects = [],
  characterProfiles = {},
  activeEvents = [],
} = {}) {
  const subjects = subjectEntries(trackingSubjects);
  if (characterId) {
    const id = String(characterId);
    const subject = subjects.find(item => item.key === id)?.value;
    if (!subject) return unavailableDetailPage(id);
    return detailPage({
      characterId: id,
      characterDetailTab,
      subject,
      profile: profileFor(characterProfiles, id),
      activeEvents,
    });
  }
  const rows = subjects.map(({key, value: subject}) => {
    const displayName = subject.display_name ?? key;
    const exposureCount = Array.isArray(subject.exposure_event_ids) ? subject.exposure_event_ids.length : 0;
    return '<button type="button" class="bioweave-card bioweave-character-row" data-character-id="'
      + escapeHtml(key) + '"><span><b>' + escapeHtml(displayValue(displayName))
      + '</b><small class="bioweave-muted">稳定 character_id：' + escapeHtml(key) + '</small></span>'
      + '<span class="bioweave-character-state">' + escapeHtml(displayValue(subject.status))
      + ' · ' + exposureCount + ' 个 exposure Event　›</span></button>';
  }).join('');
  return '<section class="bioweave-page"><div class="bioweave-page-title"><div><h2>人物列表</h2>'
    + '<p class="bioweave-muted">当前 Chat 中已进入妊娠相关追踪流程的角色</p></div></div>'
    + (subjects.length
      ? '<div class="bioweave-toolbar"><input class="bioweave-input" placeholder="搜索人物……" aria-label="搜索人物">'
        + '<button class="bioweave-select" type="button">全部状态 ▾</button></div>' + rows
      : '<div class="bioweave-card bioweave-empty"><b>当前尚无需要追踪的角色。</b>'
        + '<p>当剧情中发生存在受孕可能的相关事件后，角色将显示在这里。</p></div>')
    + '</section>';
}

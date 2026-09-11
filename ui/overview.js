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
} = {}) {
  const subjects = entriesOf(trackingSubjects)
    .map(({key, value}) => ({id: characterIdOf(value, key), value}))
    .filter(({id, value}) => id && value && typeof value === 'object');
  const biologicalEvents = Array.isArray(activeEvents) ? activeEvents : entriesOf(events).map(({value}) => value);
  const floor = currentFloor && typeof currentFloor === 'object' ? currentFloor.floor : currentFloor;
  const analysis = lastAnalysis && typeof lastAnalysis === 'object'
    ? (lastAnalysis.display ?? lastAnalysis.at ?? lastAnalysis.timestamp)
    : lastAnalysis;
  return '<section class="bioweave-page bioweave-overview-page"><div class="bioweave-page-title"><div><h2>总览</h2><p>'
    + '<strong class="bioweave-chat-name">' + escapeHtml(displayValue(chatName, '当前 Chat')) + '</strong>'
    + ' <span class="bioweave-muted">· Floor ' + escapeHtml(displayValue(floor)) + ' · 已追踪 '
    + subjects.length + ' 人物 · 最近分析 ' + escapeHtml(displayValue(analysis)) + '</span></p></div>'
    + '<button type="button" class="bioweave-refresh" data-bioweave-action="refresh">↻ 刷新分析</button></div>'
    + '<div class="bioweave-summary"><div><strong>' + subjects.length + '</strong><span>追踪人物</span></div>'
    + '<div><strong>' + biologicalEvents.length + '</strong><span>事件</span></div>'
    + '<div><strong>—</strong><span>推演</span></div><div><strong>—</strong><span>家系代数</span></div></div>'
    + '<div class="bioweave-overview-grid"><section class="bioweave-card bioweave-characters"><header><b>人物总览</b>'
    + '<button type="button" data-route="characters">查看全部</button></header>' + renderSubjectList(trackingSubjects)
    + '</section><section class="bioweave-card"><header><b>最近事件</b><button type="button" data-route="events">查看全部</button></header>'
    + renderRecentEvents(Array.isArray(activeEvents) ? activeEvents : biologicalEvents) + '</section>'
    + '<section class="bioweave-card"><header><b>当前推演</b><button type="button" data-route="projection">查看全部</button></header>'
    + '<div class="bioweave-empty">当前没有需要展示的生理推演。推演并非已发生事实。</div></section>'
    + '<section class="bioweave-card"><header><b>家系概览</b><button type="button" data-route="genealogy">查看图谱</button></header>'
    + '<div class="bioweave-empty">尚未建立已确认的亲子关系。</div></section>'
    + '<section class="bioweave-card"><header><b>世界概览</b><button type="button" data-route="world">查看详情</button></header>'
    + '<div class="bioweave-empty">世界模型尚未建立。</div></section>'
    + '<section class="bioweave-card"><header><b>分析状态</b><button type="button" data-route="state">查看详情</button></header>'
    + '<div class="bioweave-empty">当前没有可显示的分析状态。</div></section></div></section>';
}

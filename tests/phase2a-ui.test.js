import test from 'node:test';
import assert from 'node:assert/strict';
import {charactersPage} from '../ui/characters.js';
import {eventsPage} from '../ui/events.js';
import {overviewPage} from '../ui/overview.js';

const event = {
  event_id: 'evt-1',
  type: 'sexual_activity',
  status: 'confirmed',
  story_time: {
    display: '第三日夜间',
    normalized: null,
    day_index: null,
    calendar_id: 'story',
    provider: 'bioweave_fallback',
    precision: 'unknown',
    confidence: 0.4,
  },
  location: '花园',
  participants: [
    {character_id: 'char-a', display_name: '阿甲', event_role: 'potential_gestational_subject'},
    {character_id: 'char-b', display_name: '阿乙', event_role: 'potential_conception_source'},
  ],
  pregnancy_relevance: {
    relevant: true,
    possible_conception: true,
    gestational_subject_ids: ['char-a'],
    counterpart_ids: ['char-b'],
    confidence: 0.8,
  },
  source_evidence: [{kind: 'narrative', text: '明确的当前楼层证据'}],
  source: {
    chat_id: 'chat-1',
    message_id: 'message-1',
    floor: 7,
    swipe_id: 0,
    content_hash: 'hash-1',
    message_version: 2,
  },
};

const trackingSubject = {
  character_id: 'char-a',
  display_name: '阿甲',
  created_from_event_id: 'evt-1',
  exposure_event_ids: ['evt-1'],
  status: 'active',
};

test('characters page renders the real empty state without demo DTO', () => {
  const html = charactersPage();
  assert.match(html, /当前尚无需要追踪的角色。/);
  assert.match(html, /当剧情中发生存在受孕可能的相关事件后，角色将显示在这里。/);
  assert.doesNotMatch(html, /demo-character-1|演示人物|占位 DTO/);
});

test('characters page renders DTO facts, tri-state capabilities, and all exposure events', () => {
  const html = charactersPage({
    trackingSubjects: [trackingSubject],
    characterProfiles: {
      'char-a': {
        character_id: 'char-a',
        display_name: '阿甲',
        species: '人类',
        biological_type: '类型甲',
        reproductive_capabilities: {
          can_carry_pregnancy: true,
          can_produce_ova: null,
          can_produce_sperm: false,
        },
      },
    },
    activeEvents: [event],
    characterId: 'char-a',
  });
  assert.match(html, /阿甲/);
  assert.match(html, /char-a/);
  assert.match(html, /人类/);
  assert.match(html, /类型甲/);
  assert.match(html, /可承载妊娠[\s\S]*?是/);
  assert.match(html, /可产生卵子[\s\S]*?未知/);
  assert.match(html, /可产生精子[\s\S]*?否/);
  assert.match(html, /evt-1/);
  assert.match(html, /等待状态引擎计算/);
  assert.doesNotMatch(html, /probability|gestational age|妊娠概率|妊娠天数/);
});

test('events page displays fact fields and exposes explicit edit/delete actions', () => {
  const html = eventsPage({activeEvents: [event], editingEventId: 'evt-1'});
  for (const value of ['第三日夜间', '7', '花园', '阿甲', '阿乙', 'potential_gestational_subject', 'potential_conception_source', 'true', '0.8', 'chat-1', 'message-1', 'hash-1']) {
    assert.match(html, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(html, /data-bioweave-action="edit-event"[^>]*data-bioweave-event-id="evt-1"/);
  assert.match(html, /data-bioweave-action="delete-event"[^>]*data-bioweave-event-id="evt-1"/);
  assert.match(html, /data-bioweave-event-form[^>]*data-bioweave-event-id="evt-1"/);
  assert.match(html, /data-bioweave-event-field="location"/);
  assert.match(html, /data-bioweave-event-field="participants"/);
  assert.match(html, /data-bioweave-event-field="pregnancy_relevance"/);
  assert.match(html, /data-bioweave-event-field="event_id"[^>]*readonly/);
});

test('events page accepts an object-shaped Event collection for compatibility', () => {
  const html = eventsPage({events: {'evt-1': event}});
  assert.match(html, /evt-1/);
  assert.match(html, /花园/);
});

test('events page keeps source and event id read-only and does not infer eligibility', () => {
  const html = eventsPage({activeEvents: [{
    ...event,
    participants: [{character_id: 'char-x', display_name: '角色 X', gender: 'female', receiver: true}],
    pregnancy_relevance: {relevant: false, possible_conception: false, gestational_subject_ids: [], counterpart_ids: []},
  }], editingEventId: 'evt-1'});
  assert.match(html, /Source（只读）/);
  assert.match(html, /data-bioweave-event-field="event_id"[^>]*readonly/);
  assert.match(html, /char-x/);
  assert.doesNotMatch(html, /data-bioweave-event-field="gender"|data-bioweave-event-field="receiver"/);
});

test('overview counts only passed tracking subjects and active events and keeps unfinished areas empty', () => {
  const html = overviewPage({
    trackingSubjects: [trackingSubject],
    activeEvents: [event],
    chatName: '测试 Chat',
  });
  assert.match(html, /测试 Chat/);
  assert.match(html, /<strong>1<\/strong><span>追踪人物<\/span>/);
  assert.match(html, /<strong>1<\/strong><span>事件<\/span>/);
  assert.match(html, /阿甲/);
  assert.match(html, /evt-1/);
  assert.match(html, /当前没有需要展示的生理推演。/);
  assert.match(html, /尚未建立已确认的亲子关系。/);
  assert.doesNotMatch(html, /demo-character-1|演示人物|真实人物数据尚未接入/);
});

test('page DTO text remains HTML-escaped', () => {
  const html = eventsPage({
    activeEvents: [{
      ...event,
      location: '<img src=x onerror=alert(1)>',
      participants: [{character_id: 'char-x', display_name: '<角色>\'"'}],
    }],
  });
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /&lt;角色&gt;&#39;&quot;/);
});

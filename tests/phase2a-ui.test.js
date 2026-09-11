import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {charactersPage} from '../ui/characters.js';
import {eventsPage} from '../ui/events.js';
import {overviewPage} from '../ui/overview.js';
import {CONCEPTION_RELEVANT_EXPOSURE_EVIDENCE_KIND} from '../core/events.js';

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
    {character_id: 'char-c', display_name: '阿丙', event_role: 'other_participant'},
  ],
  pregnancy_relevance: {
    relevant: true,
    possible_conception: true,
    gestational_subject_ids: ['char-a'],
    counterpart_ids: ['char-b'],
    confidence: 0.8,
  },
  source_evidence: [
    {kind: 'narrative', text: '明确的当前楼层证据'},
    {kind: CONCEPTION_RELEVANT_EXPOSURE_EVIDENCE_KIND, text: '实际暴露证据'},
  ],
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

test('characters page distinguishes not analyzed from analyzed with zero subjects', () => {
  const html = charactersPage();
  assert.match(html, /尚未完成事件分析。/);
  assert.match(html, /分析当前楼层/);
  const analyzed = charactersPage({
    analysisStatus: {
      state: 'success',
      active_event_count: 1,
      sexual_activity_count: 1,
      tracking_subject_count: 0,
      tracking_decisions: [{character_id: 'char-a', eligible: false, reasons: ['CAN_CARRY_PREGNANCY_UNKNOWN']}],
    },
  });
  assert.match(analyzed, /当前没有需要妊娠追踪的角色。/);
  assert.doesNotMatch(analyzed, /Tracking Decision 诊断|CAN_CARRY_PREGNANCY_UNKNOWN/);
  assert.match(analyzed, /重新分析当前楼层/);
  assert.doesNotMatch(html, /demo-character-1|演示人物|占位 DTO/);
});

test('characters page only enumerates tracking subjects and ignores diagnostic decisions and profiles', () => {
  const html = charactersPage({
    trackingSubjects: [{
      character_id: 'character_subject',
      display_name: 'subject_display',
      exposure_event_ids: ['event_fixture'],
      status: 'active',
    }],
    characterProfiles: {
      character_source: {character_id: 'character_source', display_name: 'source_display'},
      character_other: {character_id: 'character_other', display_name: 'other_display'},
    },
    activeEvents: [{
      event_id: 'event_fixture',
      type: 'sexual_activity',
      participants: [
        {character_id: 'character_subject', display_name: 'subject_display'},
        {character_id: 'character_source', display_name: 'source_display'},
        {character_id: 'character_other', display_name: 'other_display'},
      ],
    }],
    analysisStatus: {
      state: 'success',
      tracking_decisions: [
        {character_id: 'character_source', eligible: false, reasons: ['CAN_CARRY_PREGNANCY_FALSE']},
        {character_id: 'character_other', eligible: false, reasons: ['NOT_SEXUAL_ACTIVITY']},
      ],
    },
  });

  assert.match(html, /subject_display/);
  assert.doesNotMatch(html, /source_display|other_display/);
  assert.doesNotMatch(html, /Tracking Decision 诊断|CAN_CARRY_PREGNANCY_FALSE|NOT_SEXUAL_ACTIVITY/);
});

test('events page distinguishes not analyzed from analyzed with zero events', () => {
  const pending = eventsPage({analysisStatus: {state: 'not_analyzed'}});
  assert.match(pending, /当前 Chat 尚无 BiologicalEvent。/);
  assert.match(pending, /分析当前楼层/);
  const analyzed = eventsPage({
    activeEvents: [event],
    analysisStatus: {state: 'success', event_count: 0, active_event_count: 1, active_events: [event], current_floor_events: []},
  });
  assert.match(analyzed, /当前楼层已完成分析，但没有识别到 BiologicalEvent。/);
  assert.match(analyzed, /当前 Chat 的历史事件/);
  assert.match(analyzed, /evt-1/);
  assert.match(analyzed, /重新分析当前楼层/);
});

test('overview renders current Floor analysis status and secret-redacted details', () => {
  const html = overviewPage({
    analysisStatus: {
      state: 'failed',
      current_floor: {floor: 42},
      floor_version: {...event.source, floor: 42},
      last_success: '2026-09-11T12:31:00.000Z',
      last_error: 'JSON_SCHEMA_INVALID',
      event_count: 1,
      active_event_count: 3,
      tracking_subject_count: 1,
      current_floor_events: [event],
      active_events: [event],
      registry_summary: {tracking_subject_count: 1, api_key: 'must-not-render'},
    },
  });
  assert.match(html, /当前 Floor 42/);
  assert.match(html, /分析失败/);
  assert.match(html, /JSON_SCHEMA_INVALID/);
  assert.match(html, /Event Analysis 详情/);
  assert.doesNotMatch(html, /must-not-render/);
});

test('running Event Analysis keeps the action clickable and exposes execution diagnostics', () => {
  const html = overviewPage({
    analysisStatus: {
      state: 'running',
      busy: true,
      current_floor: {floor: 42},
      floor_version: event.source,
      attempt: 3,
      started_at: '2026-09-11T12:30:00.000Z',
      error_stage: 'api_request',
      error_code: 'REQUEST_TIMEOUT',
      safe_error_summary: '请求超时',
    },
  });
  assert.match(html, /分析中… · 点击可终止/);
  assert.doesNotMatch(html, /data-bioweave-action="analyze-current-floor"[^>]*disabled/);
  assert.match(html, /api_request/);
  assert.match(html, /REQUEST_TIMEOUT/);
  assert.match(html, /请求超时/);
});

test('characters page renders DTO facts, tri-state capabilities, and all exposure events', () => {
  const html = charactersPage({
    trackingSubjects: [{...trackingSubject, exposure_event_ids: ['evt-1', 'evt-1']}],
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
  for (const section of ['当前状态', '受孕相关记录', '推演', '关系', '备注']) {
    assert.match(html, new RegExp(`<h3>${section}</h3>`));
  }
  assert.equal((html.match(/bioweave-character-exposure/g) ?? []).length, 1);
  assert.match(html, /阿乙/);
  assert.doesNotMatch(html, /阿丙/);
  assert.doesNotMatch(html, /<dt>参与者<\/dt>|事件角色/);
  assert.match(html, /等待状态引擎计算/);
  assert.doesNotMatch(html, /role="tablist"|role="tab"|data-character-tab|aria-selected=/);
  assert.doesNotMatch(html, /probability|gestational age|妊娠概率|妊娠天数/);
  const characterSource = readFileSync(new URL('../ui/characters.js', import.meta.url), 'utf8');
  assert.doesNotMatch(characterSource, /physical_effect|protection|condom|ejaculat/i);
});

test('character exposure cards render one counterpart projection per referenced Event', () => {
  const html = charactersPage({
    trackingSubjects: [{character_id: 'char-a', display_name: '阿甲', exposure_event_ids: ['evt-1', 'evt-1']}],
    characterProfiles: {},
    activeEvents: [event],
    characterId: 'char-a',
  });
  assert.equal((html.match(/data-bioweave-event-id="evt-1"/g) ?? []).length, 1);
  assert.match(html, /<dt>相关对象<\/dt>[\s\S]*阿乙/);
  assert.doesNotMatch(html, /<dt>参与者<\/dt>/);
});

test('character detail keeps every section for false or unknown capabilities and gates on tracking subjects', () => {
  const html = charactersPage({
    trackingSubjects: [{
      character_id: 'char-null',
      display_name: '未知承载者',
      exposure_event_ids: [],
      status: 'active',
    }],
    characterProfiles: {
      'char-null': {
        character_id: 'char-null',
        display_name: '未知承载者',
        reproductive_capabilities: {
          can_carry_pregnancy: false,
          can_produce_ova: null,
        },
      },
    },
    characterId: 'char-null',
  });

  assert.match(html, /未知承载者/);
  assert.match(html, /可承载妊娠[\s\S]*?否/);
  assert.match(html, /可产生卵子[\s\S]*?未知/);
  for (const text of [
    '当前状态',
    '当前没有可显示的 exposure Event。',
    '当前没有可显示的生理推演。推演并非已发生事实。',
    '尚未建立已确认的亲子或其他关系。',
    '当前没有可显示的人物备注。',
  ]) {
    assert.match(html, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }

  const profileOnly = charactersPage({
    characterProfiles: {'profile-only': {character_id: 'profile-only', display_name: '只有资料'}},
    characterId: 'profile-only',
  });
  assert.match(profileOnly, /当前没有可追踪的角色详情。/);
  assert.doesNotMatch(profileOnly, /当前状态|受孕相关记录|只有资料/);
});

test('character detail no longer exposes tab state or bindings and keeps top-level routes', () => {
  const characterSource = readFileSync(new URL('../ui/characters.js', import.meta.url), 'utf8');
  const appSource = readFileSync(new URL('../ui/app.js', import.meta.url), 'utf8');
  const styleSource = readFileSync(new URL('../style.css', import.meta.url), 'utf8');

  assert.doesNotMatch(characterSource, /characterDetailTabs|characterDetailTab|renderTabContent|data-character-tab|role="tablist"|role="tab"/);
  assert.doesNotMatch(appSource, /characterDetailTab|setCharacterTab|data-character-tab/);
  assert.doesNotMatch(styleSource, /bioweave-character-tabs/);
  assert.match(appSource, /const desktopRoutes = \['overview', 'characters', 'events', 'projection', 'genealogy', 'world', 'settings'\]/);
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
  assert.match(html, /来源与调试信息/);
  assert.match(html, /data-bioweave-event-field="event_id"[^>]*readonly/);
  assert.match(html, /char-x/);
  assert.doesNotMatch(html, /data-bioweave-event-field="gender"|data-bioweave-event-field="receiver"/);
});

test('event page preserves every participant while keeping raw presentation fields in details', () => {
  const html = eventsPage({
    activeEvents: [{
      event_id: 'event_fixture',
      type: 'sexual_activity',
      status: 'confirmed',
      story_time: {display: 'story_day_fixture', normalized: null, day_index: null},
      location: 'location_fixture',
      participants: [
        {character_id: 'character_subject', display_name: 'subject_display', event_role: 'potential_gestational_subject'},
        {character_id: 'character_source', display_name: 'source_display', event_role: 'potential_conception_source'},
      ],
      pregnancy_relevance: {
        relevant: true,
        possible_conception: true,
        gestational_subject_ids: ['character_subject'],
        counterpart_ids: ['character_source'],
        confidence: 0.8,
      },
      source_evidence: [{kind: 'narrative', text: 'fixture evidence'}],
      source: {
        chat_id: 'chat_fixture',
        message_id: 'message_fixture',
        floor: 4,
        swipe_id: 0,
        content_hash: 'hash_fixture',
        message_version: 'v1',
      },
    }],
  });

  assert.match(html, /subject_display/);
  assert.match(html, /source_display/);
  assert.match(html, /潜在妊娠承载者/);
  assert.match(html, /潜在受孕来源/);
  assert.match(html, /来源与调试信息/);
  assert.doesNotMatch(html, /Reproductive Role|potential_gestational_subject|potential_conception_source/);
});

test('characters source contains no tracking decision presentation path', () => {
  const source = readFileSync(new URL('../ui/characters.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /tracking_decisions|renderTrackingDecisions|explainTrackingDecision/);
  assert.doesNotMatch(source, /participantSummary|reproductiveRoleLabels|event_role/);
  assert.match(source, /counterpart_ids/);
});

test('overview counts only passed tracking subjects and active events and keeps unfinished areas empty', () => {
  const html = overviewPage({
    trackingSubjects: [trackingSubject],
    activeEvents: [event, {...event, event_id: 'evt-2'}, {...event, event_id: 'evt-3'}],
    chatName: '测试 Chat',
  });
  assert.match(html, /测试 Chat/);
  assert.match(html, /<strong>1<\/strong><span>追踪人物<\/span>/);
  assert.match(html, /<strong>3<\/strong><span>事件<\/span>/);
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

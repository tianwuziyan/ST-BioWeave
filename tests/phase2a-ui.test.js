import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {charactersPage} from '../ui/characters.js';
import {eventsPage} from '../ui/events.js';
import {overviewPage} from '../ui/overview.js';
import {statePage} from '../ui/state.js';
import {worldPage} from '../ui/world.js';
import {PREGNANCY_RELEVANT_EXPOSURE_EVIDENCE_KIND} from '../core/events.js';

const event = {
  event_id: 'evt-1',
  type: 'sexual_activity',
  status: 'confirmed',
  story_time: {
    display: '第三日夜间',
    normalized: null,
    day_index: null,
    calendar_id: 'story',
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
    {kind: PREGNANCY_RELEVANT_EXPOSURE_EVIDENCE_KIND, text: '实际暴露证据'},
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

function visibleMarkup(html) {
  return html.replace(/\sdata-[\w-]+(?:="[^"]*")?/g, '');
}

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
      tracking_decisions: [{character_id: 'char-a', eligibility: 'pending', reasons: ['CAN_CARRY_PREGNANCY_UNKNOWN']}],
    },
  });
  assert.match(analyzed, /当前没有需要事件追踪的角色。/);
  assert.doesNotMatch(analyzed, /Tracking Decision 诊断|CAN_CARRY_PREGNANCY_UNKNOWN/);
  assert.match(analyzed, /重新分析当前楼层/);
  assert.doesNotMatch(html, /demo-character-1|演示人物|占位 DTO/);
});

test('characters failed state keeps diagnostics out of the ordinary product page', () => {
  const html = charactersPage({
    analysisStatus: {state: 'failed', last_error: 'duplicate_gestational_subject_event'},
  });
  assert.match(html, /当前楼层事件分析失败。/);
  assert.match(html, /请稍后重试。/);
  assert.match(html, /旧的成功事件，它们仍然有效/);
  assert.doesNotMatch(html, /duplicate_gestational_subject_event|错误摘要|last_error/);
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
        {character_id: 'character_source', eligibility: 'ineligible', reasons: ['CAN_CARRY_PREGNANCY_FALSE']},
        {character_id: 'character_other', eligibility: 'ineligible', reasons: ['NOT_SEXUAL_ACTIVITY']},
      ],
    },
  });

  assert.match(html, /subject_display/);
  assert.doesNotMatch(html, /source_display|other_display/);
  assert.doesNotMatch(html, /Tracking Decision 诊断|CAN_CARRY_PREGNANCY_FALSE|NOT_SEXUAL_ACTIVITY/);
});

test('characters page renders every supplied tracking subject', () => {
  const html = charactersPage({
    trackingSubjects: [
      {character_id: 'subject_a', display_name: 'subject_a_display', exposure_event_ids: ['event_a'], status: 'active'},
      {character_id: 'subject_b', display_name: 'subject_b_display', exposure_event_ids: ['event_b'], status: 'active'},
    ],
    characterProfiles: {
      subject_a: {character_id: 'subject_a', display_name: 'subject_a_display'},
      subject_b: {character_id: 'subject_b', display_name: 'subject_b_display'},
    },
  });

  assert.equal((html.match(/class="bioweave-card bioweave-character-row/g) ?? []).length, 2);
  assert.match(html, /subject_a_display/);
  assert.match(html, /subject_b_display/);
});

test('character detail exposes a read/write nickname editor without changing the displayed canonical name', () => {
  const html = charactersPage({
    characterId: 'char-a',
    trackingSubjects: [{character_id: 'char-a', display_name: '柳如烟', exposure_event_ids: [], status: 'active'}],
    characterProfiles: {char: {character_id: 'char-a', display_name: '柳如烟'}},
    aliasEditor: {open: true, loading: false, characterId: 'char-a', draftAliases: ['如烟', '烟儿'], saving: false},
  });
  assert.match(html, /data-bioweave-action="open-character-aliases"/);
  assert.match(html, /昵称 \/ 别名/);
  assert.match(html, /用于识别同一人物，不会改变正式名称“柳如烟”。/);
  assert.match(html, /2 个/);
  assert.match(html, /bioweave-character-alias-field/);
  assert.match(html, /bioweave-character-alias-remove/);
  assert.match(html, /value="如烟"/);
  assert.match(html, /value="烟儿"/);
  assert.match(html, /data-bioweave-action="save-character-aliases"/);
  assert.match(html, /display_name|柳如烟/);
  assert.doesNotMatch(html, /character_registry/);
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

test('events page formats relative Story Time from the supplied current Story Time', () => {
  const html = eventsPage({
    currentStoryTime: {display: '第十日', normalized: null, day_index: 10, calendar_id: 'story', precision: 'day'},
    activeEvents: [{...event, story_time: {display: '第七日', normalized: null, day_index: 7, calendar_id: 'story', precision: 'day'}}],
    currentStoryTimeDifferences: {'evt-1': {value: 3, unit: 'day'}},
  });
  assert.match(html, /3天前/);
  assert.match(html, /第七日/);
});

test('event row orders Story Time, relative time, event details, tracking count, and status', () => {
  const storyTime = {display: '羲和1年3月4日 巳时中', normalized: null, day_index: null, calendar_id: null, precision: 'minute'};
  const html = eventsPage({
    activeEvents: [{...event, story_time: storyTime}],
    currentStoryTimeDifferences: {'evt-1': {value: 60, unit: 'day'}},
  });
  assert.match(html, /class="bioweave-event-review-time"[^>]*>[\s\S]*class="bioweave-event-story-time">羲和1年3月4日 巳时中<\/b>[\s\S]*class="bioweave-event-relative-time bioweave-event-review-relative">60天前<\/small><\/span>[\s\S]*class="bioweave-event-review-main"[\s\S]*class="bioweave-event-review-type"[\s\S]*class="bioweave-event-review-meta"[\s\S]*class="bioweave-event-review-detail"[\s\S]*class="bioweave-badge[\s\S]*class="bioweave-event-review-chevron"/);
  assert.match(html, /亲密互动/);
  assert.match(html, /花园 · 阿甲 · 阿乙/);
});

test('event relative formatter handles zero, one, and unavailable Runtime differences without hiding the date', () => {
  const storyTime = {display: '第三日夜间', normalized: null, day_index: null, calendar_id: null, precision: 'day'};
  const render = difference => eventsPage({activeEvents: [{...event, story_time: storyTime}], currentStoryTimeDifferences: {'evt-1': difference}});
  assert.match(render({value: 1, unit: 'day'}), /1天前/);
  assert.match(render({value: 0, unit: 'day'}), /今天/);
  const unavailable = render(null);
  assert.match(unavailable, /class="bioweave-event-story-time">第三日夜间<\/b>/);
  assert.doesNotMatch(unavailable, /class="bioweave-event-relative-time"/);
});

test('event tracking omits the relative item completely when Runtime difference is unavailable', () => {
  const html = eventsPage({
    activeEvents: [{...event, story_time: {display: '第三日', normalized: null, day_index: null, calendar_id: null, precision: 'day'}}],
    currentStoryTimeDifferences: {'evt-1': null},
  });
  assert.match(html, /class="bioweave-event-story-time">第三日<\/b>/);
  assert.doesNotMatch(html, /class="bioweave-event-relative-time"/);
});

test('events page uses precise Story Time for hours and future values, without system time', () => {
  const eventAtTen = {...event, story_time: {display: '8月17日 10:00', normalized: '2026-08-17T10:00', day_index: 20682, calendar_id: 'story', precision: 'hour'}};
  const currentAtTwelve = {display: '8月17日 12:00', normalized: '2026-08-17T12:00', day_index: 20682, calendar_id: 'story', precision: 'hour'};
  assert.match(eventsPage({currentStoryTime: currentAtTwelve, activeEvents: [eventAtTen], currentStoryTimeDifferences: {'evt-1': {value: 120, unit: 'minute'}}}), /2小时前/);
  assert.match(eventsPage({currentStoryTime: eventAtTen, activeEvents: [{...eventAtTen, story_time: currentAtTwelve}], currentStoryTimeDifferences: {'evt-1': {value: -120, unit: 'minute'}}}), /2小时后/);
  const incomparable = eventsPage({currentStoryTime: {...currentAtTwelve, calendar_id: 'other'}, activeEvents: [eventAtTen], currentStoryTimeDifferences: {'evt-1': null}});
  assert.doesNotMatch(incomparable, /2小时前|2小时后/);
  assert.doesNotMatch(readFileSync(new URL('../ui/events.js', import.meta.url), 'utf8'), /Date\.now|Date\.UTC|new Date/);
});

test('character event tracking orders Story Time, relative time, event details, and status', () => {
  const xiheEvent = {
    ...event,
    story_time: {display: '羲和1年3月4日 巳时中', normalized: 'cn-1-3-4', day_index: 63, calendar_id: 'xihe', precision: 'day'},
  };
  const html = charactersPage({
    characterId: 'char-a',
    trackingSubjects: {subject: {character_id: 'char-a', display_name: '阿甲', exposure_event_ids: ['evt-1'], status: 'active'}},
    characterProfiles: {subject: {character_id: 'char-a', display_name: '阿甲', reproductive_capabilities: {can_fertilize: false}}},
    activeEvents: [xiheEvent],
    currentStoryTime: {display: '羲和1年3月7日', normalized: 'cn-1-3-7', day_index: 66, calendar_id: 'xihe', precision: 'day'},
    currentStoryTimeDifferences: {'evt-1': {value: 3, unit: 'day'}},
  });
  assert.match(html, /class="bioweave-character-exposure-date"[\s\S]*羲和1年3月4日 巳时中<\/span><\/span>[\s\S]*class="bioweave-event-relative-time bioweave-character-exposure-relative"[^>]*>3天前<\/small>[\s\S]*class="bioweave-character-exposure-type"[\s\S]*class="bioweave-character-exposure-meta"[\s\S]*class="bioweave-badge/);
  const dateBlock = html.match(/<span class="bioweave-character-exposure-date"[\s\S]*?<\/span><\/span>/)?.[0] ?? '';
  assert.doesNotMatch(dateBlock, /bioweave-event-relative-time/);
  assert.doesNotMatch(html, />can_fertilize<|>can_fertilize<\/dt>/);
});

test('character event tracking renders Runtime custom-calendar difference for display-only Story Time', () => {
  const html = charactersPage({
    characterId: 'char-a',
    trackingSubjects: {subject: {character_id: 'char-a', display_name: '阿甲', exposure_event_ids: ['evt-1'], status: 'active'}},
    characterProfiles: {subject: {character_id: 'char-a', display_name: '阿甲'}},
    activeEvents: [{...event, story_time: {display: '羲和元年三月四日 巳时中', normalized: null, day_index: null, calendar_id: null, precision: 'minute'}}],
    currentStoryTime: {display: '羲和元年五月初四 未时', normalized: null, day_index: null, calendar_id: null, precision: 'hour'},
    currentStoryTimeDifferences: {'evt-1': {value: 60, unit: 'day'}},
  });
  assert.match(html, /羲和元年三月四日 巳时中/);
  assert.match(html, /class="bioweave-event-relative-time bioweave-character-exposure-relative"[^>]*>60天前<\/small>/);
});

test('event and exposure records use the same relative-time presentation formatter', () => {
  const difference = {value: 60, unit: 'day'};
  const storyTime = {display: '羲和1年3月4日 巳时中', normalized: null, day_index: null, calendar_id: null, precision: 'minute'};
  const eventHtml = eventsPage({activeEvents: [{...event, story_time: storyTime}], currentStoryTimeDifferences: {'evt-1': difference}});
  const characterHtml = charactersPage({
    characterId: 'char-a',
    trackingSubjects: {subject: {character_id: 'char-a', display_name: '阿甲', exposure_event_ids: ['evt-1'], status: 'active'}},
    characterProfiles: {subject: {character_id: 'char-a', display_name: '阿甲'}},
    activeEvents: [{...event, story_time: storyTime}],
    currentStoryTimeDifferences: {'evt-1': difference},
  });
  assert.match(eventHtml, /class="bioweave-event-relative-time bioweave-event-review-relative">60天前<\/small>/);
  assert.match(characterHtml, /class="bioweave-event-relative-time bioweave-character-exposure-relative">60天前<\/small>/);
});

test('event and character rows preserve the date block without a relative placeholder', () => {
  const storyTime = {display: '不可比较日期', normalized: null, day_index: null, calendar_id: null, precision: 'unknown'};
  const eventHtml = eventsPage({activeEvents: [{...event, story_time: storyTime}], currentStoryTimeDifferences: {'evt-1': null}});
  const characterHtml = charactersPage({
    characterId: 'char-a',
    trackingSubjects: {subject: {character_id: 'char-a', display_name: '阿甲', exposure_event_ids: ['evt-1'], status: 'active'}},
    characterProfiles: {subject: {character_id: 'char-a', display_name: '阿甲'}},
    activeEvents: [{...event, story_time: storyTime}],
    currentStoryTimeDifferences: {'evt-1': null},
  });
  assert.match(eventHtml, /class="bioweave-event-story-time">不可比较日期<\/b>/);
  assert.match(characterHtml, /class="bioweave-event-story-time">不可比较日期<\/span>/);
  assert.doesNotMatch(eventHtml, /bioweave-event-review-relative/);
  assert.doesNotMatch(characterHtml, /bioweave-character-exposure-relative/);
});

test('character exposure visual divider follows the relative Story Time item', () => {
  const style = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  assert.match(style, /\.bioweave-character-exposure-date\s*\{[^}]*border-right:\s*0\s*!important;/);
  assert.match(style, /\.bioweave-character-exposure-relative\s*\{[^}]*border-right:\s*1px solid var\(--bioweave-border-soft\)\s*!important;/);
});

test('event review details start two tab stops after the time group', () => {
  const style = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  assert.match(style, /\.bioweave-event-review-row\s*\{[^}]*grid-template-columns:\s*166px\s+minmax\(0, 1fr\)\s+max-content\s+16px\s*!important;/);
  assert.match(style, /\.bioweave-event-review-main\s*\{[^}]*grid-template-columns:\s*minmax\(110px, \.8fr\)\s+minmax\(170px, 1\.4fr\)\s+max-content\s*!important;/);
});

test('character tracking uses day fallback, precise clock, future values, and unknown safely', () => {
  const subject = {character_id: 'char-a', display_name: '阿甲', exposure_event_ids: ['evt-1'], status: 'active'};
  const render = (eventStoryTime, currentStoryTime, difference) => charactersPage({
    characterId: 'char-a', trackingSubjects: {subject}, characterProfiles: {subject: {character_id: 'char-a'}},
    activeEvents: [{...event, story_time: eventStoryTime}], currentStoryTime, currentStoryTimeDifferences: {'evt-1': difference},
  });
  const sameDay = {display: '同日', normalized: 'cn-1-3-4', day_index: 63, calendar_id: 'xihe', precision: 'day'};
  assert.match(render(sameDay, {...sameDay, display: '当前'}, {value: 0, unit: 'day'}), /今天/);
  const eventAtTen = {...sameDay, display: '巳时', normalized: 'cn-1-3-4T10:00', precision: 'hour'};
  const currentAtTwelve = {...sameDay, display: '午时', normalized: 'cn-1-3-4T12:00', precision: 'hour'};
  assert.match(render(eventAtTen, currentAtTwelve, {value: 120, unit: 'minute'}), /2小时前/);
  assert.match(render(currentAtTwelve, {...sameDay, day_index: 61, display: '前两日'}, {value: -2, unit: 'day'}), /2天后/);
  assert.doesNotMatch(render({...sameDay, calendar_id: 'other'}, sameDay, null), /今天|天前|天后/);
  assert.match(render({...sameDay, display: null, day_index: null, normalized: null}, sameDay, null), /未知时间/);
});

test('capability labels remain Chinese across Character, State, and World UI', () => {
  const stateHtml = statePage({trackingSubjects: {char: {character_id: 'char', display_name: '角色', status: 'active'}}, currentStateStatus: 'ready', currentState: {characters: {char: {identity: {display_name: '角色'}, reproductive_capabilities: {can_fertilize: false}}}, diagnostics: []}, focusedCharacterId: 'char'});
  const characterHtml = charactersPage({characterId: 'char', trackingSubjects: {char: {character_id: 'char', display_name: '角色', exposure_event_ids: [], status: 'active'}}, characterProfiles: {char: {character_id: 'char', reproductive_capabilities: {can_fertilize: false}}}});
  const worldHtml = worldPage({worldModel: {schema_version: 1, species: [{name: '物种', capabilities: {can_fertilize: false}, biological_types: [{name: '类型', capabilities: {can_fertilize: false}}]}]}, selectedSpeciesIndex: 0, selectedTypeIndex: 0});
  for (const html of [stateHtml, characterHtml, worldHtml]) {
    assert.match(html, /可使对方受精/);
    assert.doesNotMatch(html, />can_fertilize</);
  }
});

test('overview renders business analysis status without execution diagnostics', () => {
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
  assert.match(html, /最近成功分析/);
  assert.doesNotMatch(html, /JSON_SCHEMA_INVALID|Event Analysis 详情|Registry Summary|解析后的 Event JSON|chat-1|message-1|hash-1/);
  assert.doesNotMatch(html, /Floor Version|content_hash|message_version/);
});

test('running Event Analysis keeps the action clickable without execution diagnostics', () => {
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
  assert.doesNotMatch(html, /api_request|REQUEST_TIMEOUT|请求超时|attempt|started_at|error_stage/);
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
  assert.doesNotMatch(visibleMarkup(html), /char-a|evt-1|chat-1|message-1|hash-1/);
  assert.match(html, /人类/);
  assert.match(html, /类型甲/);
  assert.match(html, /可承载妊娠[\s\S]*?是/);
  assert.match(html, /可产生卵子[\s\S]*?未知/);
  assert.match(html, /可产生精子[\s\S]*?否/);
  assert.match(html, /data-bioweave-event-id="evt-1"/);
  assert.doesNotMatch(html, /调试信息|content_hash|message_version|chat_id|message_id/);
  for (const section of ['当前状态', '事件追踪', '推演', '关系', '备注']) {
    assert.match(html, new RegExp(`<h3>${section}</h3>`));
  }
  assert.equal((html.match(/class="bioweave-card bioweave-character-exposure"/g) ?? []).length, 1);
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
    '当前没有可显示的相关事件。',
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
  assert.doesNotMatch(styleSource, /bioweave-analysis-detail/);
  assert.match(styleSource, /bioweave-analysis-debug-popup-content/);
  assert.match(appSource, /const desktopRoutes = \['overview', 'characters', 'events', 'projection', 'genealogy', 'world', 'settings', 'state'\]/);
});

test('events ordinary cards keep user-readable facts and preserve operation bindings', () => {
  const html = eventsPage({activeEvents: [event]});
  for (const value of ['第三日夜间', '花园', '阿甲', '阿乙', '是', '0.8', '明确的当前楼层证据', '实际暴露证据']) {
    assert.match(html, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(html, /data-bioweave-event-id="evt-1"/);
  assert.match(html, /data-bioweave-action="edit-event"[^>]*data-bioweave-event-id="evt-1"/);
  assert.match(html, /data-bioweave-action="delete-event"[^>]*data-bioweave-event-id="evt-1"/);
  assert.doesNotMatch(html, /参与者|事件角色|结构化标识|来源与调试信息|narrative|pregnancy_relevant_exposure/);
  assert.doesNotMatch(html, /chat-1|message-1|hash-1|content_hash|message_version|normalized|day_index|calendar_id/);
});

test('event edit form keeps necessary structured fields and readonly Event ID', () => {
  const html = eventsPage({activeEvents: [event], editingEventId: 'evt-1'});
  assert.match(html, /data-bioweave-event-form[^>]*data-bioweave-event-id="evt-1"/);
  assert.match(html, /data-bioweave-event-field="location"/);
  assert.match(html, /data-bioweave-event-field="participants"/);
  assert.match(html, /data-bioweave-event-field="pregnancy_relevance"/);
  assert.match(html, /data-bioweave-event-field="event_id"[^>]*readonly/);
  assert.match(html, /value="evt-1" readonly/);
});

test('events page accepts an object-shaped Event collection for compatibility', () => {
  const html = eventsPage({events: {'evt-1': event}});
  assert.match(html, /data-bioweave-event-id="evt-1"/);
  assert.doesNotMatch(visibleMarkup(html), /evt-1/);
  assert.match(html, /花园/);
});

test('events ordinary card does not expose participant identifiers or inferred eligibility', () => {
  const html = eventsPage({activeEvents: [{
    ...event,
    participants: [{character_id: 'char-x', display_name: '角色 X', gender: 'female', receiver: true}],
    pregnancy_relevance: {relevant: false, possible_conception: false, gestational_subject_ids: [], counterpart_ids: []},
  }]});
  assert.doesNotMatch(html, /角色 X|char-x|gender|receiver|参与者|事件角色/);
  assert.doesNotMatch(html, /来源与调试信息|结构化标识|chat-1|message-1|hash-1/);
});

test('event page projects pregnancy objects without rendering participant roles or provenance', () => {
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
  assert.doesNotMatch(html, /<h4>参与者<\/h4>|事件角色|潜在妊娠承载者|潜在受孕来源/);
  assert.doesNotMatch(html, /potential_gestational_subject|potential_conception_source|结构化标识|来源与调试信息/);
  assert.doesNotMatch(html, /chat_fixture|message_fixture|hash_fixture|content_hash|message_version|normalized|day_index/);
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
  assert.match(html, /data-character-id="char-a"/);
  assert.doesNotMatch(visibleMarkup(html), /char-a|evt-1|Event ID|Floor Version|Registry Summary|content_hash|message_version/);
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
      pregnancy_relevance: {...event.pregnancy_relevance, counterpart_ids: ['char-x']},
    }],
  });
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /&lt;角色&gt;&#39;&quot;/);
});

test('state page renders no Character Floor and empty Current State without fabricating facts', () => {
  const noFloor = statePage({currentStateStatus: 'NO_CHARACTER_FLOOR'});
  assert.match(noFloor, /暂无可分析的角色楼层/);
  const empty = statePage({currentStateStatus: 'ready', currentState: {characters: {}, diagnostics: []}});
  assert.match(empty, /暂无生物状态数据/);
  assert.doesNotMatch(empty, /pregnancy|已怀孕|排卵预测/);
});

test('state page renders tri-state capabilities and factual exposure fields only', () => {
  const html = statePage({
    trackingSubjects: {subject: {character_id: 'char-1', display_name: '角色甲', status: 'active'}},
    focusedCharacterId: 'char-1',
    currentStateStatus: 'ready',
    currentState: {
      schema_version: 1,
      diagnostics: [],
      characters: {
        'char-1': {
          identity: {character_id: 'char-1', display_name: '角色甲', species: null, biological_type: 'type-a'},
          reproductive_capabilities: {
            can_produce_sperm: true,
            can_produce_ova: false,
            can_be_fertilized: null,
            can_fertilize: true,
            can_carry_pregnancy: null,
            can_cause_pregnancy: false,
          },
          reproductive_exposure: {
            records: [{event_id: 'evt-1', counterpart_ids: ['char-2'], status: 'confirmed', story_time: null, reproductive_mechanism: {kind: 'fixture'}}],
            last_exposure_event_id: 'evt-1', last_exposure_story_time: null, elapsed_story_days: null,
          },
          conception: {status: 'unknown', pregnancy_ids: [], confirmed_event_ids: [], uncertain_event_ids: []},
          pregnancy: {current_status: 'unknown', active_pregnancy_ids: [], episodes: {}},
          cycle: {factual_event_ids: ['cycle-1'], uncertain_event_ids: []},
          postpartum: {factual_event_ids: [], episodes: {}},
          symptoms: {records: []}, medical: {records: []}, activity_chain: {event_ids: ['evt-1']},
        },
      },
    },
  });
  assert.match(html, /角色甲/);
  assert.match(html, /可产生精子[\s\S]*?是/);
  assert.match(html, /可产生卵子[\s\S]*?否/);
  assert.match(html, /可受精[\s\S]*?未知/);
  assert.match(html, /经过 Story Time 天数[\s\S]*?未知/);
  assert.match(html, /暴露事实不等于受孕确认/);
  assert.match(html, /明确周期事实/);
  assert.doesNotMatch(html, /下次月经|fertile window|概率/);
});

test('state page keeps pregnancy episodes separate and surfaces diagnostics without changing facts', () => {
  const html = statePage({
    trackingSubjects: {subject: {character_id: 'char-1', display_name: '角色甲', status: 'active'}},
    currentStateStatus: 'ready', focusedCharacterId: 'char-1',
    currentState: {
      characters: {
        'char-1': {
          identity: {display_name: '角色甲'}, reproductive_capabilities: {}, reproductive_exposure: {},
          conception: {status: 'confirmed', pregnancy_ids: ['preg-a', 'preg-b'], confirmed_event_ids: ['confirm-a'], uncertain_event_ids: []},
          pregnancy: {current_status: 'confirmed', active_pregnancy_ids: ['preg-b'], episodes: {
            'preg-a': {status: 'ended', confirmation_event_ids: ['confirm-a'], termination_event_ids: ['loss-a'], delivery_event_ids: [], labor_event_ids: []},
            'preg-b': {status: 'confirmed', confirmation_event_ids: ['confirm-b'], termination_event_ids: [], delivery_event_ids: [], labor_event_ids: []},
          }},
          cycle: {}, postpartum: {}, symptoms: {}, medical: {}, activity_chain: {},
        },
      },
      diagnostics: [{code: 'pregnancy_episode_conflict', detail: 'fixture conflict'}],
    },
  });
  assert.match(html, /妊娠记录 1/);
  assert.match(html, /妊娠记录 2/);
  assert.match(html, /已结束/);
  assert.match(html, /已确认/);
  assert.match(html, /部分状态存在事实冲突或信息不完整/);
  assert.match(html, /pregnancy_episode_conflict/);
  assert.doesNotMatch(html, /从未怀孕/);
});

test('state page focus selection is presentation-only and does not expose source as a character card', () => {
  const html = statePage({
    focusedCharacterId: 'char-source',
    trackingSubjects: {subject: {character_id: 'char-subject', display_name: '承孕角色', status: 'active'}},
    currentStateStatus: 'ready',
    currentState: {characters: {'char-source': {identity: {display_name: '来源角色'}}}, diagnostics: []},
  });
  assert.match(html, /该角色当前无可用 State/);
  assert.doesNotMatch(html, /来源角色/);
});

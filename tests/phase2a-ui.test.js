import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { charactersPage } from '../ui/characters.js'
import { eventsPage, focusEventById } from '../ui/events.js'
import { overviewPage } from '../ui/overview.js'
import { statePage } from '../ui/state.js'
import { summarizeWorldModelUiProjection, worldPage } from '../ui/world.js'
import { PREGNANCY_RELEVANT_EXPOSURE_EVIDENCE_KIND } from '../core/events.js'
import { createWorldModelUiIngressFixture, WORLD_MODEL_UI_INGRESS_VALUES } from './fixtures/world-model/ui-ingress.js'

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
    { character_id: 'char-a', display_name: '阿甲', event_role: 'potential_gestational_subject' },
    { character_id: 'char-b', display_name: '阿乙', event_role: 'potential_conception_source' },
    { character_id: 'char-c', display_name: '阿丙', event_role: 'other_participant' },
  ],
  pregnancy_relevance: {
    relevant: true,
    possible_conception: true,
    gestational_subject_ids: ['char-a'],
    counterpart_ids: ['char-b'],
    confidence: 0.8,
  },
  source_evidence: [
    { kind: 'narrative', text: '明确的当前楼层证据' },
    { kind: PREGNANCY_RELEVANT_EXPOSURE_EVIDENCE_KIND, text: '实际暴露证据' },
  ],
  source: {
    chat_id: 'chat-1',
    message_id: 'message-1',
    floor: 7,
    swipe_id: 0,
    content_hash: 'hash-1',
    message_version: 2,
  },
}

const trackingSubject = {
  character_id: 'char-a',
  display_name: '阿甲',
  created_from_event_id: 'evt-1',
  exposure_event_ids: ['evt-1'],
  status: 'active',
}

function visibleMarkup(html) {
  return html.replace(/\sdata-[\w-]+(?:="[^"]*")?/g, '')
}

test('characters page distinguishes not analyzed from analyzed with zero subjects', () => {
  const html = charactersPage()
  assert.match(html, /尚未完成事件分析。/)
  assert.match(html, /分析当前楼层/)
  const analyzed = charactersPage({
    analysisStatus: {
      state: 'success',
      active_event_count: 1,
      sexual_activity_count: 1,
      tracking_subject_count: 0,
      tracking_decisions: [{ character_id: 'char-a', eligibility: 'pending', reasons: ['CAN_CARRY_PREGNANCY_UNKNOWN'] }],
    },
  })
  assert.match(analyzed, /当前没有需要事件追踪的角色。/)
  assert.doesNotMatch(analyzed, /Tracking Decision 诊断|CAN_CARRY_PREGNANCY_UNKNOWN/)
  assert.match(analyzed, /重新分析当前楼层/)
  assert.doesNotMatch(html, /demo-character-1|演示人物|占位 DTO/)
})

test('characters failed state keeps diagnostics out of the ordinary product page', () => {
  const html = charactersPage({
    analysisStatus: { state: 'failed', last_error: 'duplicate_gestational_subject_event' },
  })
  assert.match(html, /当前楼层事件分析失败。/)
  assert.match(html, /请稍后重试。/)
  assert.match(html, /旧的成功事件，它们仍然有效/)
  assert.doesNotMatch(html, /duplicate_gestational_subject_event|错误摘要|last_error/)
})

test('characters page only enumerates tracking subjects and ignores diagnostic decisions and profiles', () => {
  const html = charactersPage({
    trackingSubjects: [
      {
        character_id: 'character_subject',
        display_name: 'subject_display',
        exposure_event_ids: ['event_fixture'],
        status: 'active',
      },
    ],
    characterProfiles: {
      character_source: { character_id: 'character_source', display_name: 'source_display' },
      character_other: { character_id: 'character_other', display_name: 'other_display' },
    },
    activeEvents: [
      {
        event_id: 'event_fixture',
        type: 'sexual_activity',
        participants: [
          { character_id: 'character_subject', display_name: 'subject_display' },
          { character_id: 'character_source', display_name: 'source_display' },
          { character_id: 'character_other', display_name: 'other_display' },
        ],
      },
    ],
    analysisStatus: {
      state: 'success',
      tracking_decisions: [
        { character_id: 'character_source', eligibility: 'ineligible', reasons: ['CAN_CARRY_PREGNANCY_FALSE'] },
        { character_id: 'character_other', eligibility: 'ineligible', reasons: ['NOT_SEXUAL_ACTIVITY'] },
      ],
    },
  })

  assert.match(html, /subject_display/)
  assert.doesNotMatch(html, /source_display|other_display/)
  assert.doesNotMatch(html, /Tracking Decision 诊断|CAN_CARRY_PREGNANCY_FALSE|NOT_SEXUAL_ACTIVITY/)
})

test('characters page renders every supplied tracking subject', () => {
  const html = charactersPage({
    trackingSubjects: [
      { character_id: 'subject_a', display_name: 'subject_a_display', exposure_event_ids: ['event_a'], status: 'active' },
      { character_id: 'subject_b', display_name: 'subject_b_display', exposure_event_ids: ['event_b'], status: 'active' },
    ],
    characterProfiles: {
      subject_a: { character_id: 'subject_a', display_name: 'subject_a_display' },
      subject_b: { character_id: 'subject_b', display_name: 'subject_b_display' },
    },
  })

  assert.equal((html.match(/class="bioweave-card bioweave-character-row/g) ?? []).length, 2)
  assert.match(html, /subject_a_display/)
  assert.match(html, /subject_b_display/)
})

test('character detail exposes a read/write nickname editor without changing the displayed canonical name', () => {
  const html = charactersPage({
    characterId: 'char-a',
    trackingSubjects: [{ character_id: 'char-a', display_name: '柳如烟', exposure_event_ids: [], status: 'active' }],
    characterProfiles: { char: { character_id: 'char-a', display_name: '柳如烟' } },
    aliasEditor: { open: true, loading: false, characterId: 'char-a', draftAliases: ['如烟', '烟儿'], saving: false },
  })
  assert.match(html, /data-bioweave-action="open-character-aliases"/)
  assert.match(html, /昵称 \/ 别名/)
  assert.match(html, /仅用于识别，不改变正式名称/)
  assert.match(html, /2 个/)
  assert.match(html, /class="bioweave-badge good"/)
  assert.match(html, /bioweave-character-alias-field/)
  assert.match(html, /data-bioweave-action="remove-character-alias"/)
  assert.match(html, /value="如烟"/)
  assert.match(html, /value="烟儿"/)
  assert.match(html, /data-bioweave-action="save-character-aliases"/)
  assert.match(html, /display_name|柳如烟/)
  assert.doesNotMatch(html, /character_registry/)
})

test('nickname editor uses a real alias label without the legacy ghost pseudo-element', () => {
  const html = charactersPage({
    characterId: 'char-a',
    trackingSubjects: [{ character_id: 'char-a', display_name: '柳如烟', exposure_event_ids: [], status: 'active' }],
    characterProfiles: { char: { character_id: 'char-a', display_name: '柳如烟' } },
    aliasEditor: { open: true, loading: false, characterId: 'char-a', draftAliases: ['如烟'], saving: false },
  })
  const css = readFileSync(fileURLToPath(new URL('../style.css', import.meta.url)), 'utf8')
  assert.match(html, /<label class="bioweave-character-alias-field"><span>别名<\/span><input class="bioweave-input"/)
  assert.match(css, /\.bioweave-character-alias-field::before\s*\{\s*content:\s*none\s*!important;\s*display:\s*none\s*!important;/)
  assert.match(css, /\.bioweave-character-alias-field \.bioweave-input[\s\S]*?height:\s*28px\s*!important;/)
})

test('events page distinguishes not analyzed from analyzed with zero events', () => {
  const pending = eventsPage({ analysisStatus: { state: 'not_analyzed' } })
  assert.match(pending, /当前 Chat 尚无 BiologicalEvent。/)
  assert.match(pending, /分析当前楼层/)
  const analyzed = eventsPage({
    activeEvents: [event],
    analysisStatus: { state: 'success', event_count: 0, active_event_count: 1, active_events: [event], current_floor_events: [] },
  })
  assert.match(analyzed, /当前楼层已完成分析，但没有识别到 BiologicalEvent。/)
  assert.match(analyzed, /当前 Chat 的历史事件/)
  assert.match(analyzed, /evt-1/)
  assert.match(analyzed, /重新分析当前楼层/)
})

test('events page formats relative Story Time from the supplied current Story Time', () => {
  const html = eventsPage({
    currentStoryTime: { display: '第十日', normalized: null, day_index: 10, calendar_id: 'story', precision: 'day' },
    activeEvents: [{ ...event, story_time: { display: '第七日', normalized: null, day_index: 7, calendar_id: 'story', precision: 'day' } }],
    currentStoryTimeDifferences: { 'evt-1': { value: 3, unit: 'day' } },
  })
  assert.match(html, /3天前/)
  assert.match(html, /第七日/)
})

test('event row orders Story Time, relative time, event details, tracking count, and status', () => {
  const storyTime = { display: '羲和1年3月4日 巳时中', normalized: null, day_index: null, calendar_id: null, precision: 'minute' }
  const html = eventsPage({
    activeEvents: [{ ...event, story_time: storyTime }],
    currentStoryTimeDifferences: { 'evt-1': { value: 60, unit: 'day' } },
  })
  assert.match(
    html,
    /class="bioweave-event-review-time"[^>]*>[\s\S]*class="bioweave-event-story-time">羲和1年3月4日 巳时中<\/b>[\s\S]*class="bioweave-event-relative-time bioweave-event-review-relative">60天前<\/small><\/span>[\s\S]*class="bioweave-event-review-main"[\s\S]*class="bioweave-event-review-type"[\s\S]*class="bioweave-event-review-meta"[\s\S]*class="bioweave-event-review-detail"[\s\S]*class="bioweave-badge[\s\S]*class="bioweave-event-review-chevron"/,
  )
  assert.match(html, /亲密互动/)
  assert.match(html, /花园 · 阿甲 · 阿乙/)
})

test('event relative formatter handles zero, one, and unavailable Runtime differences without hiding the date', () => {
  const storyTime = { display: '第三日夜间', normalized: null, day_index: null, calendar_id: null, precision: 'day' }
  const render = difference =>
    eventsPage({ activeEvents: [{ ...event, story_time: storyTime }], currentStoryTimeDifferences: { 'evt-1': difference } })
  assert.match(render({ value: 1, unit: 'day' }), /1天前/)
  assert.match(render({ value: 0, unit: 'day' }), /今天/)
  const unavailable = render(null)
  assert.match(unavailable, /class="bioweave-event-story-time">第三日夜间<\/b>/)
  assert.doesNotMatch(unavailable, /class="bioweave-event-relative-time"/)
})

test('event tracking omits the relative item completely when Runtime difference is unavailable', () => {
  const html = eventsPage({
    activeEvents: [{ ...event, story_time: { display: '第三日', normalized: null, day_index: null, calendar_id: null, precision: 'day' } }],
    currentStoryTimeDifferences: { 'evt-1': null },
  })
  assert.match(html, /class="bioweave-event-story-time">第三日<\/b>/)
  assert.doesNotMatch(html, /class="bioweave-event-relative-time"/)
})

test('events page uses precise Story Time for hours and future values, without system time', () => {
  const eventAtTen = {
    ...event,
    story_time: { display: '8月17日 10:00', normalized: '2026-08-17T10:00', day_index: 20682, calendar_id: 'story', precision: 'hour' },
  }
  const currentAtTwelve = { display: '8月17日 12:00', normalized: '2026-08-17T12:00', day_index: 20682, calendar_id: 'story', precision: 'hour' }
  assert.match(
    eventsPage({
      currentStoryTime: currentAtTwelve,
      activeEvents: [eventAtTen],
      currentStoryTimeDifferences: { 'evt-1': { value: 120, unit: 'minute' } },
    }),
    /2小时前/,
  )
  assert.match(
    eventsPage({
      currentStoryTime: eventAtTen,
      activeEvents: [{ ...eventAtTen, story_time: currentAtTwelve }],
      currentStoryTimeDifferences: { 'evt-1': { value: -120, unit: 'minute' } },
    }),
    /2小时后/,
  )
  const incomparable = eventsPage({
    currentStoryTime: { ...currentAtTwelve, calendar_id: 'other' },
    activeEvents: [eventAtTen],
    currentStoryTimeDifferences: { 'evt-1': null },
  })
  assert.doesNotMatch(incomparable, /2小时前|2小时后/)
  assert.doesNotMatch(readFileSync(new URL('../ui/events.js', import.meta.url), 'utf8'), /Date\.now|Date\.UTC|new Date/)
})

test('character event tracking orders Story Time, relative time, event details, and status', () => {
  const xiheEvent = {
    ...event,
    story_time: { display: '羲和1年3月4日 巳时中', normalized: 'cn-1-3-4', day_index: 63, calendar_id: 'xihe', precision: 'day' },
  }
  const html = charactersPage({
    characterId: 'char-a',
    trackingSubjects: { subject: { character_id: 'char-a', display_name: '阿甲', exposure_event_ids: ['evt-1'], status: 'active' } },
    characterProfiles: { subject: { character_id: 'char-a', display_name: '阿甲', reproductive_capabilities: { can_fertilize: false } } },
    activeEvents: [xiheEvent],
    currentStoryTime: { display: '羲和1年3月7日', normalized: 'cn-1-3-7', day_index: 66, calendar_id: 'xihe', precision: 'day' },
    currentStoryTimeDifferences: { 'evt-1': { value: 3, unit: 'day' } },
  })
  assert.match(
    html,
    /class="bioweave-character-exposure-date"[\s\S]*羲和1年3月4日 巳时中<\/span><\/span>[\s\S]*class="bioweave-event-relative-time bioweave-character-exposure-relative"[^>]*>3天前<\/small>[\s\S]*class="bioweave-character-exposure-type"[\s\S]*class="bioweave-character-exposure-meta"[\s\S]*class="bioweave-badge/,
  )
  const dateBlock = html.match(/<span class="bioweave-character-exposure-date"[\s\S]*?<\/span><\/span>/)?.[0] ?? ''
  assert.doesNotMatch(dateBlock, /bioweave-event-relative-time/)
  assert.doesNotMatch(html, />can_fertilize<|>can_fertilize<\/dt>/)
})

test('character event tracking renders Runtime custom-calendar difference for display-only Story Time', () => {
  const html = charactersPage({
    characterId: 'char-a',
    trackingSubjects: { subject: { character_id: 'char-a', display_name: '阿甲', exposure_event_ids: ['evt-1'], status: 'active' } },
    characterProfiles: { subject: { character_id: 'char-a', display_name: '阿甲' } },
    activeEvents: [
      { ...event, story_time: { display: '羲和元年三月四日 巳时中', normalized: null, day_index: null, calendar_id: null, precision: 'minute' } },
    ],
    currentStoryTime: { display: '羲和元年五月初四 未时', normalized: null, day_index: null, calendar_id: null, precision: 'hour' },
    currentStoryTimeDifferences: { 'evt-1': { value: 60, unit: 'day' } },
  })
  assert.match(html, /羲和元年三月四日 巳时中/)
  assert.match(html, /class="bioweave-event-relative-time bioweave-character-exposure-relative"[^>]*>60天前<\/small>/)
})

test('character event tracking does not show the internal Event Registry note', () => {
  const html = charactersPage({
    characterId: 'char-a',
    trackingSubjects: [{ character_id: 'char-a', display_name: '柳如烟', exposure_event_ids: ['evt-1'], status: 'active' }],
    characterProfiles: { 'char-a': { character_id: 'char-a', display_name: '柳如烟' } },
    activeEvents: [{ ...event, event_id: 'evt-1' }],
  })
  assert.doesNotMatch(html, /完整事实仍来自当前 Event Registry|这里只在人物内展开查看/)
})

test('event and exposure records use the same relative-time presentation formatter', () => {
  const difference = { value: 60, unit: 'day' }
  const storyTime = { display: '羲和1年3月4日 巳时中', normalized: null, day_index: null, calendar_id: null, precision: 'minute' }
  const eventHtml = eventsPage({ activeEvents: [{ ...event, story_time: storyTime }], currentStoryTimeDifferences: { 'evt-1': difference } })
  const characterHtml = charactersPage({
    characterId: 'char-a',
    trackingSubjects: { subject: { character_id: 'char-a', display_name: '阿甲', exposure_event_ids: ['evt-1'], status: 'active' } },
    characterProfiles: { subject: { character_id: 'char-a', display_name: '阿甲' } },
    activeEvents: [{ ...event, story_time: storyTime }],
    currentStoryTimeDifferences: { 'evt-1': difference },
  })
  assert.match(eventHtml, /class="bioweave-event-relative-time bioweave-event-review-relative">60天前<\/small>/)
  assert.match(characterHtml, /class="bioweave-event-relative-time bioweave-character-exposure-relative">60天前<\/small>/)
})

test('event and character rows preserve the date block without a relative placeholder', () => {
  const storyTime = { display: '不可比较日期', normalized: null, day_index: null, calendar_id: null, precision: 'unknown' }
  const eventHtml = eventsPage({ activeEvents: [{ ...event, story_time: storyTime }], currentStoryTimeDifferences: { 'evt-1': null } })
  const characterHtml = charactersPage({
    characterId: 'char-a',
    trackingSubjects: { subject: { character_id: 'char-a', display_name: '阿甲', exposure_event_ids: ['evt-1'], status: 'active' } },
    characterProfiles: { subject: { character_id: 'char-a', display_name: '阿甲' } },
    activeEvents: [{ ...event, story_time: storyTime }],
    currentStoryTimeDifferences: { 'evt-1': null },
  })
  assert.match(eventHtml, /class="bioweave-event-story-time">不可比较日期<\/b>/)
  assert.match(characterHtml, /class="bioweave-event-story-time">不可比较日期<\/span>/)
  assert.doesNotMatch(eventHtml, /bioweave-event-review-relative/)
  assert.doesNotMatch(characterHtml, /bioweave-character-exposure-relative/)
})

test('character exposure visual divider follows the relative Story Time item', () => {
  const style = readFileSync(new URL('../style.css', import.meta.url), 'utf8')
  assert.match(style, /\.bioweave-character-exposure-date\s*\{[^}]*border-right:\s*0\s*!important;/)
  assert.match(style, /\.bioweave-character-exposure-relative\s*\{[^}]*border-right:\s*1px solid var\(--bioweave-border-soft\)\s*!important;/)
})

test('character exposure status badge stays content-sized on mobile', () => {
  const style = readFileSync(fileURLToPath(new URL('../style.css', import.meta.url)), 'utf8')
  assert.match(
    style,
    /\.bioweave-character-exposure > summary > \.bioweave-badge \{[^}]*justify-self: end !important;[^}]*width: max-content !important;/,
  )
})

test('event review details start two tab stops after the time group', () => {
  const style = readFileSync(new URL('../style.css', import.meta.url), 'utf8')
  assert.match(style, /\.bioweave-event-review-row\s*\{[^}]*grid-template-columns:\s*166px\s+minmax\(0, 1fr\)\s+max-content\s+16px\s*!important;/)
  assert.match(
    style,
    /\.bioweave-event-review-main\s*\{[^}]*grid-template-columns:\s*minmax\(110px, \.8fr\)\s+minmax\(170px, 1\.4fr\)\s+max-content\s*!important;/,
  )
})

test('character tracking uses day fallback, precise clock, future values, and unknown safely', () => {
  const subject = { character_id: 'char-a', display_name: '阿甲', exposure_event_ids: ['evt-1'], status: 'active' }
  const render = (eventStoryTime, currentStoryTime, difference) =>
    charactersPage({
      characterId: 'char-a',
      trackingSubjects: { subject },
      characterProfiles: { subject: { character_id: 'char-a' } },
      activeEvents: [{ ...event, story_time: eventStoryTime }],
      currentStoryTime,
      currentStoryTimeDifferences: { 'evt-1': difference },
    })
  const sameDay = { display: '同日', normalized: 'cn-1-3-4', day_index: 63, calendar_id: 'xihe', precision: 'day' }
  assert.match(render(sameDay, { ...sameDay, display: '当前' }, { value: 0, unit: 'day' }), /今天/)
  const eventAtTen = { ...sameDay, display: '巳时', normalized: 'cn-1-3-4T10:00', precision: 'hour' }
  const currentAtTwelve = { ...sameDay, display: '午时', normalized: 'cn-1-3-4T12:00', precision: 'hour' }
  assert.match(render(eventAtTen, currentAtTwelve, { value: 120, unit: 'minute' }), /2小时前/)
  assert.match(render(currentAtTwelve, { ...sameDay, day_index: 61, display: '前两日' }, { value: -2, unit: 'day' }), /2天后/)
  assert.doesNotMatch(render({ ...sameDay, calendar_id: 'other' }, sameDay, null), /今天|天前|天后/)
  assert.match(render({ ...sameDay, display: null, day_index: null, normalized: null }, sameDay, null), /未知时间/)
})

test('capability labels remain Chinese across Character, State, and World UI', () => {
  const stateHtml = statePage({
    trackingSubjects: { char: { character_id: 'char', display_name: '角色', status: 'active' } },
    currentStateStatus: 'ready',
    currentState: {
      characters: { char: { identity: { display_name: '角色' }, reproductive_capabilities: { can_fertilize: false } } },
      diagnostics: [],
    },
    focusedCharacterId: 'char',
  })
  const characterHtml = charactersPage({
    characterId: 'char',
    trackingSubjects: { char: { character_id: 'char', display_name: '角色', exposure_event_ids: [], status: 'active' } },
    characterProfiles: { char: { character_id: 'char', reproductive_capabilities: { can_fertilize: false } } },
  })
  const worldHtml = worldPage({
    worldModel: {
      schema_version: 1,
      species: [
        { name: '物种', capabilities: { can_fertilize: false }, biological_types: [{ name: '类型', capabilities: { can_fertilize: false } }] },
      ],
    },
    selectedSpeciesIndex: 0,
    selectedTypeIndex: 0,
  })
  for (const html of [characterHtml, worldHtml]) {
    assert.match(html, /使对方受精/)
    assert.doesNotMatch(html, />can_fertilize</)
  }
  assert.doesNotMatch(stateHtml, /可使对方受精|can_fertilize/)
})

test('canonical World Model mutation fields reach the World renderer', () => {
  const model = createWorldModelUiIngressFixture()
  const html = worldPage({ worldModel: model, selectedSpeciesIndex: 0, selectedTypeIndex: 0 })
  for (const value of WORLD_MODEL_UI_INGRESS_VALUES) assert.match(html, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  const projection = summarizeWorldModelUiProjection(model)
  assert.equal(projection.unrendered_canonical_field_count, 0)
  assert.ok(projection.rendered_field_count > 0)
})

test('overview renders business analysis status without execution diagnostics', () => {
  const html = overviewPage({
    analysisStatus: {
      state: 'failed',
      current_floor: { floor: 42 },
      floor_version: { ...event.source, floor: 42 },
      last_success: '2026-09-11T12:31:00.000Z',
      last_error: 'JSON_SCHEMA_INVALID',
      event_count: 1,
      active_event_count: 3,
      tracking_subject_count: 1,
      current_floor_events: [event],
      active_events: [event],
      registry_summary: { tracking_subject_count: 1, api_key: 'must-not-render' },
    },
  })
  assert.match(html, /当前 Floor 42/)
  assert.match(html, /分析失败/)
  assert.match(html, /最近成功分析/)
  assert.doesNotMatch(html, /JSON_SCHEMA_INVALID|Event Analysis 详情|Registry Summary|解析后的 Event JSON|chat-1|message-1|hash-1/)
  assert.doesNotMatch(html, /Floor Version|content_hash|message_version/)
})

test('running Event Analysis keeps the action clickable without execution diagnostics', () => {
  const html = overviewPage({
    analysisStatus: {
      state: 'running',
      busy: true,
      current_floor: { floor: 42 },
      floor_version: event.source,
      attempt: 3,
      started_at: '2026-09-11T12:30:00.000Z',
      error_stage: 'api_request',
      error_code: 'REQUEST_TIMEOUT',
      safe_error_summary: '请求超时',
    },
  })
  assert.match(html, /分析中… · 点击可终止/)
  assert.doesNotMatch(html, /data-bioweave-action="analyze-current-floor"[^>]*disabled/)
  assert.doesNotMatch(html, /api_request|REQUEST_TIMEOUT|请求超时|attempt|started_at|error_stage/)
})

test('characters page renders DTO facts, tri-state capabilities, and all exposure events', () => {
  const html = charactersPage({
    trackingSubjects: [{ ...trackingSubject, exposure_event_ids: ['evt-1', 'evt-1'] }],
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
  })
  assert.match(html, /阿甲/)
  assert.doesNotMatch(visibleMarkup(html), /char-a|evt-1|chat-1|message-1|hash-1/)
  assert.match(html, /人类/)
  assert.match(html, /类型甲/)
  assert.match(html, /可承载妊娠[\s\S]*?是/)
  assert.match(html, /产生卵子[\s\S]*?未知/)
  assert.match(html, /产生精子[\s\S]*?否/)
  assert.match(html, /data-bioweave-event-id="evt-1"/)
  assert.doesNotMatch(html, /调试信息|content_hash|message_version|chat_id|message_id/)
  for (const section of ['当前状态', '事件记录', '其他信息', '推演', '关系', '备注']) {
    assert.match(
      html,
      new RegExp(
        section === '其他信息'
          ? `<h3>${section}</h3>`
          : section === '推演' || section === '关系' || section === '备注'
            ? `<strong>${section}</strong>`
            : `<h3>${section}</h3>`,
      ),
    )
  }
  assert.equal((html.match(/class="bioweave-card bioweave-character-exposure"/g) ?? []).length, 1)
  assert.match(html, /阿乙/)
  assert.doesNotMatch(html, /阿丙/)
  assert.doesNotMatch(html, /<dt>参与者<\/dt>|事件角色/)
  assert.match(html, /当前状态/)
  assert.doesNotMatch(html, /role="tablist"|role="tab"|data-character-tab|aria-selected=/)
  assert.doesNotMatch(html, /probability|gestational age|妊娠概率|妊娠天数/)
  const characterSource = readFileSync(new URL('../ui/characters.js', import.meta.url), 'utf8')
  assert.doesNotMatch(characterSource, /physical_effect|protection|condom|ejaculat/i)
})

test('character and world capability labels use the product order', async () => {
  const html = charactersPage({
    characterId: 'char-a',
    trackingSubjects: [{ character_id: 'char-a', display_name: '柳如烟', exposure_event_ids: [], status: 'active' }],
    characterProfiles: {
      'char-a': {
        character_id: 'char-a',
        display_name: '柳如烟',
        reproductive_capabilities: {
          can_cause_pregnancy: true,
          can_carry_pregnancy: false,
          can_be_fertilized: false,
          can_fertilize: true,
          can_produce_ova: false,
          can_produce_sperm: true,
        },
      },
    },
  })
  const order = ['产生精子', '产生卵子', '使对方受精', '自身可受精', '使对方妊娠', '可承载妊娠']
  let previous = -1
  for (const label of order) {
    const index = html.indexOf(label)
    assert.ok(index > previous, `${label} should follow the requested capability order`)
    previous = index
  }
  const { CAPABILITY_LABELS } = await import('../ui/world.js')
  assert.deepEqual(Object.values(CAPABILITY_LABELS), order)
})

test('character exposure cards render one counterpart projection per referenced Event', () => {
  const html = charactersPage({
    trackingSubjects: [{ character_id: 'char-a', display_name: '阿甲', exposure_event_ids: ['evt-1', 'evt-1'] }],
    characterProfiles: {},
    activeEvents: [event],
    characterId: 'char-a',
  })
  assert.equal((html.match(/data-bioweave-event-id="evt-1"/g) ?? []).length, 1)
  assert.match(html, /<dt>相关对象<\/dt>[\s\S]*阿乙/)
  assert.doesNotMatch(html, /<dt>参与者<\/dt>/)
})

test('character detail keeps every section for false or unknown capabilities and gates on tracking subjects', () => {
  const html = charactersPage({
    trackingSubjects: [
      {
        character_id: 'char-null',
        display_name: '未知承载者',
        exposure_event_ids: [],
        status: 'active',
      },
    ],
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
  })

  assert.match(html, /未知承载者/)
  assert.match(html, /可承载妊娠[\s\S]*?否/)
  assert.match(html, /产生卵子[\s\S]*?未知/)
  for (const text of ['当前状态', '当前没有可显示的相关事件。', '其他信息', '推演', '关系', '备注']) {
    assert.match(html, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }

  const profileOnly = charactersPage({
    characterProfiles: { 'profile-only': { character_id: 'profile-only', display_name: '只有资料' } },
    characterId: 'profile-only',
  })
  assert.match(profileOnly, /当前没有可追踪的角色详情。/)
  assert.doesNotMatch(profileOnly, /当前状态|受孕相关记录|只有资料/)
})

test('character detail no longer exposes tab state or bindings and keeps top-level routes', () => {
  const characterSource = readFileSync(new URL('../ui/characters.js', import.meta.url), 'utf8')
  const appSource = readFileSync(new URL('../ui/app.js', import.meta.url), 'utf8')
  const styleSource = readFileSync(new URL('../style.css', import.meta.url), 'utf8')

  assert.doesNotMatch(characterSource, /characterDetailTabs|characterDetailTab|renderTabContent|data-character-tab|role="tablist"|role="tab"/)
  assert.doesNotMatch(appSource, /characterDetailTab|setCharacterTab|data-character-tab/)
  assert.doesNotMatch(styleSource, /bioweave-character-tabs/)
  assert.doesNotMatch(styleSource, /bioweave-analysis-detail/)
  assert.match(styleSource, /bioweave-analysis-debug-popup-content/)
  assert.match(appSource, /const desktopRoutes = \['overview', 'characters', 'events', 'projection', 'genealogy', 'world', 'settings', 'state'\]/)
})

test('character page follows the reference single-surface layout contract', () => {
  const html = charactersPage({
    characterId: 'char-a',
    trackingSubjects: [{ character_id: 'char-a', display_name: '角色甲', exposure_event_ids: [] }],
    characterProfiles: { 'char-a': { character_id: 'char-a', display_name: '角色甲' } },
    currentState: { characters: { 'char-a': {} }, diagnostics: [] },
    currentStateStatus: 'ready',
  })
  const style = readFileSync(new URL('../style.css', import.meta.url), 'utf8')
  assert.match(html, /bioweave-character-detail-title/)
  assert.match(html, /bioweave-character-section-head/)
  assert.match(html, /bioweave-character-state-strip/)
  assert.match(html, /bioweave-character-other-list/)
  assert.doesNotMatch(html, /bioweave-character-summary|<h2>人物详情<\/h2>/)
  assert.match(style, /\.bioweave-character-workspace \{ grid-template-columns: 220px minmax\(0, 1fr\) !important; gap: 9px/)
  assert.match(style, /\.bioweave-character-row \{[^}]*min-height: 42px/)
  assert.match(style, /\.bioweave-character-capabilities \{ grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/)
  assert.match(style, /\.bioweave-character-state-strip,[\s\S]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)/)
})

test('character detail placeholder keeps the reference inner spacing on mobile', () => {
  const style = readFileSync(fileURLToPath(new URL('../style.css', import.meta.url)), 'utf8')
  assert.match(style, /\.bioweave-character-detail-pane\.bioweave-character-detail-placeholder \{\s*padding: 16px !important;/)
})

test('events ordinary cards keep user-readable facts and preserve operation bindings', () => {
  const html = eventsPage({ activeEvents: [event] })
  for (const value of ['第三日夜间', '花园', '阿甲', '阿乙', '是', '0.8', '明确的当前楼层证据', '实际暴露证据']) {
    assert.match(html, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
  assert.match(html, /data-bioweave-event-id="evt-1"/)
  assert.match(html, /data-bioweave-action="edit-event"[^>]*data-bioweave-event-id="evt-1"/)
  assert.match(html, /data-bioweave-action="delete-event"[^>]*data-bioweave-event-id="evt-1"/)
  assert.doesNotMatch(html, /参与者|事件角色|结构化标识|来源与调试信息|narrative|pregnancy_relevant_exposure/)
  assert.doesNotMatch(html, /chat-1|message-1|hash-1|content_hash|message_version|normalized|day_index|calendar_id/)
})

test('event edit form keeps necessary structured fields and readonly Event ID', () => {
  const html = eventsPage({ activeEvents: [event], editingEventId: 'evt-1' })
  assert.match(html, /data-bioweave-event-form[^>]*data-bioweave-event-id="evt-1"/)
  assert.match(html, /data-bioweave-event-field="location"/)
  assert.match(html, /data-bioweave-event-field="participants"/)
  assert.match(html, /data-bioweave-event-field="pregnancy_relevance"/)
  assert.match(html, /data-bioweave-event-field="event_id"[^>]*readonly/)
  assert.match(html, /value="evt-1" readonly/)
})

test('events page accepts an object-shaped Event collection for compatibility', () => {
  const html = eventsPage({ events: { 'evt-1': event } })
  assert.match(html, /data-bioweave-event-id="evt-1"/)
  assert.doesNotMatch(visibleMarkup(html), /evt-1/)
  assert.match(html, /花园/)
})

test('events ordinary card does not expose participant identifiers or inferred eligibility', () => {
  const html = eventsPage({
    activeEvents: [
      {
        ...event,
        participants: [{ character_id: 'char-x', display_name: '角色 X', gender: 'female', receiver: true }],
        pregnancy_relevance: { relevant: false, possible_conception: false, gestational_subject_ids: [], counterpart_ids: [] },
      },
    ],
  })
  assert.doesNotMatch(html, /角色 X|char-x|gender|receiver|参与者|事件角色/)
  assert.doesNotMatch(html, /来源与调试信息|结构化标识|chat-1|message-1|hash-1/)
})

test('events page projects a non-exposure state fact subject from Current State identity', () => {
  const html = eventsPage({
    activeEvents: [{
      event_id: 'evt-symptom',
      type: 'physical_symptom',
      status: 'confirmed',
      story_time: { display: '第七十日', normalized: null, day_index: 70 },
      location: '房间',
      participants: [
        { character_id: 'char_000099', display_name: '不应读取的人物', event_role: 'unknown' },
        { character_id: 'char_000001', display_name: '参与者副本', event_role: 'unknown' },
      ],
      pregnancy_relevance: {
        relevant: false,
        possible_conception: false,
        gestational_subject_ids: [],
        counterpart_ids: [],
      },
      state_fact: {
        subject_id: 'char_000001',
        payload: { symptom: { kind: 'pelvic_and_muscle_soreness', description: '事实描述' } },
      },
    }],
    currentState: {
      characters: {
        char_000001: { identity: { character_id: 'char_000001', display_name: '祁鸢' } },
      },
    },
  })
  assert.match(html, /事实归属：祁鸢/)
  assert.match(html, /<dt>事实归属<\/dt><dd>祁鸢<\/dd>/)
  assert.doesNotMatch(html, /未关联追踪人物/)
  assert.doesNotMatch(html, /不应读取的人物|参与者副本/)
})

test('events page uses an explicit fallback when the identity projection has no display name', () => {
  const html = eventsPage({
    activeEvents: [{
      ...event,
      event_id: 'evt-symptom-fallback',
      type: 'physical_symptom',
      participants: [{ character_id: 'char_000001', display_name: '参与者姓名', event_role: 'unknown' }],
      pregnancy_relevance: { relevant: false, possible_conception: false, gestational_subject_ids: [], counterpart_ids: [] },
      state_fact: { subject_id: 'char_000001', payload: { symptom: { kind: 'soreness', description: '事实描述' } } },
    }],
    currentState: { characters: { char_000001: { identity: { character_id: 'char_000001', display_name: null } } } },
  })
  assert.match(html, /事实归属：未命名事实人物/)
  assert.doesNotMatch(html, /参与者姓名/)
  assert.doesNotMatch(html, /未关联追踪人物/)
})

test('event page projects pregnancy objects without rendering participant roles or provenance', () => {
  const html = eventsPage({
    activeEvents: [
      {
        event_id: 'event_fixture',
        type: 'sexual_activity',
        status: 'confirmed',
        story_time: { display: 'story_day_fixture', normalized: null, day_index: null },
        location: 'location_fixture',
        participants: [
          { character_id: 'character_subject', display_name: 'subject_display', event_role: 'potential_gestational_subject' },
          { character_id: 'character_source', display_name: 'source_display', event_role: 'potential_conception_source' },
        ],
        pregnancy_relevance: {
          relevant: true,
          possible_conception: true,
          gestational_subject_ids: ['character_subject'],
          counterpart_ids: ['character_source'],
          confidence: 0.8,
        },
        source_evidence: [{ kind: 'narrative', text: 'fixture evidence' }],
        source: {
          chat_id: 'chat_fixture',
          message_id: 'message_fixture',
          floor: 4,
          swipe_id: 0,
          content_hash: 'hash_fixture',
          message_version: 'v1',
        },
      },
    ],
  })

  assert.match(html, /subject_display/)
  assert.match(html, /source_display/)
  assert.doesNotMatch(html, /<h4>参与者<\/h4>|事件角色|潜在妊娠承载者|潜在受孕来源/)
  assert.doesNotMatch(html, /potential_gestational_subject|potential_conception_source|结构化标识|来源与调试信息/)
  assert.doesNotMatch(html, /chat_fixture|message_fixture|hash_fixture|content_hash|message_version|normalized|day_index/)
})

test('characters source contains no tracking decision presentation path', () => {
  const source = readFileSync(new URL('../ui/characters.js', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /tracking_decisions|renderTrackingDecisions|explainTrackingDecision/)
  assert.doesNotMatch(source, /participantSummary|reproductiveRoleLabels|event_role/)
  assert.match(source, /counterpart_ids/)
})

test('overview counts only passed tracking subjects and active events and keeps unfinished areas empty', () => {
  const html = overviewPage({
    trackingSubjects: [trackingSubject],
    activeEvents: [event, { ...event, event_id: 'evt-2' }, { ...event, event_id: 'evt-3' }],
    chatName: '测试 Chat',
  })
  assert.match(html, /测试 Chat/)
  assert.match(html, /<strong>1<\/strong><span>追踪人物<\/span>/)
  assert.match(html, /<strong>3<\/strong><span>事件<\/span>/)
  assert.match(html, /阿甲/)
  assert.match(html, /data-character-id="char-a"/)
  assert.doesNotMatch(visibleMarkup(html), /char-a|evt-1|Event ID|Floor Version|Registry Summary|content_hash|message_version/)
  assert.match(html, /当前没有需要展示的生理推演。/)
  assert.match(html, /尚未建立已确认的亲子关系。/)
  assert.doesNotMatch(html, /demo-character-1|演示人物|真实人物数据尚未接入/)
})

test('page DTO text remains HTML-escaped', () => {
  const html = eventsPage({
    activeEvents: [
      {
        ...event,
        location: '<img src=x onerror=alert(1)>',
        participants: [{ character_id: 'char-x', display_name: '<角色>\'"' }],
        pregnancy_relevance: { ...event.pregnancy_relevance, counterpart_ids: ['char-x'] },
      },
    ],
  })
  assert.doesNotMatch(html, /<img src=x/)
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/)
  assert.match(html, /&lt;角色&gt;&#39;&quot;/)
})

test('state page is a plugin status page without Character State or selector', () => {
  const html = statePage({
    chatName: '测试 Chat',
    chatId: 'chat-1',
    currentFloor: { floor: 60, message_id: '60', swipe_id: 0, version: { content_hash: 'hash', message_version: 2 } },
    currentStoryTime: { display: '羲和元年五月初四 午时' },
    currentStoryTimeStatus: 'ready',
    currentStateStatus: 'ready',
    analysisStatus: { state: 'success', busy: false, event_count: 2, tracking_subject_count: 1 },
  })
  assert.match(html, /分析状态/)
  assert.match(html, /任务队列/)
  assert.match(html, /当前楼层 60/)
  assert.match(html, /事件分析/)
  assert.match(html, /当前故事时间/)
  assert.match(html, /生物状态/)
  assert.match(html, /安全摘要/)
  assert.match(html, /世界模型/)
  assert.doesNotMatch(html, /World Model|Event Analysis|Biological State|Secret Store|Chat Scope|Story Time/)
  assert.doesNotMatch(html, /data-bioweave-state-character-id|当前角色|生殖能力|生殖暴露|妊娠状态|周期|身体表现|医疗事实|活动链/)
})

test('state page shows empty plugin status without fabricating Character State', () => {
  const html = statePage({ currentStateStatus: 'NO_CHARACTER_FLOOR', analysisStatus: { state: 'not_analyzed' } })
  assert.match(html, /暂无有效当前楼层/)
  assert.doesNotMatch(html, /生殖能力|生殖暴露|妊娠状态|妊娠记录|data-bioweave-state-character-id/)
})

test('character page renders the selected Character Biological State from Runtime DTO', () => {
  const state = {
    characters: {
      'char-a': {
        reproductive_exposure: { records: [{ status: 'confirmed', counterpart_ids: ['char-b'] }], elapsed_story_days: 61 },
        conception: { status: 'unknown' },
        pregnancy: { current_status: 'unknown', active_pregnancy_ids: [], episodes: {} },
        cycle: {},
        postpartum: {},
        symptoms: {},
        medical: {},
        activity_chain: { event_ids: ['evt-1'] },
      },
      'char-b': {
        reproductive_exposure: { records: [] },
        conception: {},
        pregnancy: {},
        cycle: {},
        postpartum: {},
        symptoms: {},
        medical: {},
        activity_chain: {},
      },
    },
    diagnostics: [],
  }
  const htmlA = charactersPage({
    characterId: 'char-a',
    trackingSubjects: [{ character_id: 'char-a', display_name: '角色甲', exposure_event_ids: [] }],
    characterProfiles: { 'char-a': { character_id: 'char-a', display_name: '角色甲', reproductive_capabilities: { can_fertilize: true } } },
    currentState: state,
    currentStateStatus: 'ready',
  })
  const htmlB = charactersPage({
    characterId: 'char-b',
    trackingSubjects: [{ character_id: 'char-b', display_name: '角色乙', exposure_event_ids: [] }],
    characterProfiles: { 'char-b': { character_id: 'char-b', display_name: '角色乙', reproductive_capabilities: {} } },
    currentState: state,
    currentStateStatus: 'ready',
  })
  assert.match(htmlA, /当前状态/)
  assert.match(htmlA, /1 条已确认记录/)
  assert.match(htmlA, /周期、产后、身体表现、医疗事实暂无记录/)
  assert.match(htmlB, /角色乙/)
  assert.doesNotMatch(htmlB, /1 条已确认记录/)
})

test('character page keeps profile and Event data when Current State is unavailable', () => {
  const html = charactersPage({
    characterId: 'char-a',
    trackingSubjects: [{ character_id: 'char-a', display_name: '角色甲', exposure_event_ids: [] }],
    characterProfiles: { 'char-a': { character_id: 'char-a', display_name: '角色甲', reproductive_capabilities: { can_carry_pregnancy: true } } },
    currentStateStatus: 'error',
  })
  assert.match(html, /角色甲/)
  assert.match(html, /状态归约发生错误/)
  assert.match(html, /可承载妊娠[\s\S]*是/)
})

test('character details consume grouped Health State issues without rebuilding lifecycle', () => {
  const healthState = {
    schema_version: 1,
    characters: {
      'char-a': {
        current_health_summary: null,
        active_observations: [
          { source_event_id: 'active-pain', expected_recovery: { boundary: { day_index: 10 } } },
        ],
        grouped_issues: [
          { group_key: 'wrist|left|pain', display_site: 'wrist', laterality: 'left', factual_kind: 'pain', description: '疼痛', source_observation_ids: ['active-pain', 'duplicate-pain'] },
          { group_key: 'wrist|left|abrasion', display_site: 'wrist', laterality: 'left', factual_kind: 'abrasion', description: '擦伤', source_observation_ids: ['active-abrasion'] },
        ],
      },
    },
  }
  const html = charactersPage({
    characterId: 'char-a',
    trackingSubjects: [{ character_id: 'char-a', display_name: '角色甲', exposure_event_ids: [] }],
    characterProfiles: { 'char-a': { character_id: 'char-a', display_name: '角色甲' } },
    currentHealthState: healthState,
    currentStateStatus: 'ready',
    healthPopoverOpen: true,
  })
  assert.match(html, /data-bioweave-action="toggle-character-health"/)
  assert.match(html, /id="bioweave-character-health-popover"/)
  assert.match(html, /有健康问题/)
  assert.match(html, />wrist<\/strong>/)
  assert.match(html, /疼痛/)
  assert.match(html, /擦伤/)
  assert.equal((html.match(/>疼痛<\/p>/g) ?? []).length, 1)
  assert.doesNotMatch(html, /active-pain|duplicate-pain|expected_recovery|day_index/)
})

test('Character Health displays factual body sites without laterality or localization rewrites', () => {
  const html = charactersPage({
    characterId: 'char-a',
    trackingSubjects: [{ character_id: 'char-a', display_name: '角色甲', exposure_event_ids: [] }],
    currentHealthState: {
      characters: {
        'char-a': {
          grouped_issues: [
            { group_key: '右臂外侧|right|pain', display_site: '右臂外侧', body_site: '右臂外侧', laterality: 'right', description: '疼痛' },
            { group_key: '左膝|left|pain', display_site: '左膝', body_site: '左膝', laterality: 'left', description: '酸痛' },
            { group_key: 'upper-arm|right|pain', display_site: '上臂外侧', body_site: '上臂外侧', laterality: 'right', description: '不补方向' },
            { group_key: 'full-body|unspecified|fever', display_site: '全身', body_site: '全身', laterality: null, description: '发热' },
            { group_key: 'general|unspecified|cough', display_site: 'general', body_site: null, laterality: 'right', description: '咳嗽' },
          ],
        },
      },
    },
    currentStateStatus: 'ready',
    healthPopoverOpen: true,
  })
  assert.match(html, />右臂外侧<\/strong>/)
  assert.match(html, />左膝<\/strong>/)
  assert.match(html, />上臂外侧<\/strong>/)
  assert.match(html, />全身<\/strong>/)
  assert.match(html, />未标明部位<\/strong>/)
  assert.doesNotMatch(html, /右右臂外侧|左左膝|右上臂外侧/)

  const source = readFileSync(new URL('../ui/characters.js', import.meta.url), 'utf8')
  const displaySiteSource = source.slice(source.indexOf('function healthDisplaySite'), source.indexOf('function healthSourceEventIds'))
  assert.doesNotMatch(displaySiteSource, /startsWith|\.replace\(/)
})

test('character Health State is scoped by canonical character id and supports conservative empty states', () => {
  const healthState = {
    schema_version: 1,
    characters: {
      'char-a': {
      grouped_issues: [{ group_key: 'general|unspecified|fever', display_site: 'general', factual_kind: 'fever', description: '发热', source_observation_ids: ['fever-a'] }],
      },
    },
  }
  const base = {
    trackingSubjects: [
      { character_id: 'char-a', display_name: '角色甲', exposure_event_ids: [] },
      { character_id: 'char-b', display_name: '角色乙', exposure_event_ids: [] },
    ],
    characterProfiles: {
      'char-a': { character_id: 'char-a', display_name: '角色甲' },
      'char-b': { character_id: 'char-b', display_name: '角色乙' },
    },
    currentHealthState: healthState,
    currentStateStatus: 'ready',
  }
  const htmlA = charactersPage({ ...base, characterId: 'char-a', currentStateStatus: 'ready', healthPopoverOpen: true })
  const htmlB = charactersPage({ ...base, characterId: 'char-b', currentStateStatus: 'ready' })
  const missing = charactersPage({ ...base, characterId: 'char-a', currentHealthState: null, currentStateStatus: 'STATE_ERROR', healthPopoverOpen: true })
  assert.match(htmlA, /未标明部位/)
  assert.doesNotMatch(htmlA, /全身/)
  assert.match(htmlA, /发热/)
  assert.doesNotMatch(htmlB, /发热/)
  assert.match(htmlB, /健康 · 正常/)
  assert.match(missing, /健康 · 暂不可用/)
})

test('Character Health UI prefers factual descriptions and never exposes machine kind', () => {
  const html = charactersPage({
    characterId: 'char-a',
    trackingSubjects: [{ character_id: 'char-a', display_name: '角色甲', exposure_event_ids: [] }],
    currentHealthState: {
      characters: {
        'char-a': {
          grouped_issues: [{
            group_key: 'unspecified|unspecified|pain_and_soreness',
            display_site: 'general',
            factual_kind: 'pain_and_soreness',
            description: '大腿根部与腰侧肌肉钝痛，下腹沉坠淤痛，胯骨酸软且体虚无力',
            source_observation_ids: ['health-event'],
          }],
        },
      },
    },
    currentStateStatus: 'ready',
    healthPopoverOpen: true,
  })
  assert.match(html, /大腿根部与腰侧肌肉钝痛，下腹沉坠淤痛，胯骨酸软且体虚无力/)
  assert.doesNotMatch(html, /pain_and_soreness|pain and soreness/)
  assert.match(html, /未标明部位/)
  assert.doesNotMatch(html, /全身/)
})

test('Character Health source actions use current canonical Event ids and isolate characters', () => {
  const healthState = {
    characters: {
      'char-a': {
        grouped_issues: [{
          display_site: 'wrist',
          factual_kind: 'pain',
          description: '疼痛',
          source_observation_ids: ['event-a', 'event-a-2', 'event-b'],
        }],
      },
    },
  }
  const html = charactersPage({
    characterId: 'char-a',
    trackingSubjects: [{ character_id: 'char-a', display_name: '角色甲', exposure_event_ids: [] }],
    currentHealthState: healthState,
    currentStateStatus: 'ready',
    healthPopoverOpen: true,
    activeEvents: [
      { event_id: 'event-a', state_fact: { subject_id: 'char-a' } },
      { event_id: 'event-a-2', state_fact: { subject_id: 'char-a' } },
      { event_id: 'event-b', state_fact: { subject_id: 'char-b' } },
    ],
  })
  assert.match(html, /2 条来源/)
  assert.match(html, /data-bioweave-event-id="event-a"/)
  assert.match(html, /data-bioweave-event-id="event-a-2"/)
  assert.doesNotMatch(html, /data-bioweave-event-id="event-b"/)
})

test('Character Health stays out of the detail body until the status popover is opened', () => {
  const html = charactersPage({
    characterId: 'char-a',
    trackingSubjects: [{ character_id: 'char-a', display_name: '角色甲', exposure_event_ids: [] }],
    currentStateStatus: 'ready',
    currentHealthState: {characters: {'char-a': {grouped_issues: [{display_site: 'wrist', description: '疼痛'}]}}},
  })
  assert.match(html, /健康 · 有异常/)
  assert.doesNotMatch(html, /<section[^>]+bioweave-character-health-popover/)
  assert.doesNotMatch(html, /bioweave-character-health-detail-section/)
})

test('Character Health popover follows the compact A layout without an extra card or summary row', () => {
  const html = charactersPage({
    characterId: 'char-a',
    trackingSubjects: [{ character_id: 'char-a', display_name: '角色甲', exposure_event_ids: [] }],
    currentStateStatus: 'ready',
    currentHealthState: {characters: {'char-a': {grouped_issues: [{display_site: '左手腕', description: '疼痛'}]}}},
    healthPopoverOpen: true,
  })
  assert.match(html, /<section class="bioweave-character-health-popover"/)
  assert.doesNotMatch(html, /bioweave-card bioweave-character-health-popover|当前有健康问题<\/p>/)
  assert.match(html, /bioweave-character-health-dot warning/)
})

test('Character Health status button uses warning, good, and unavailable Runtime states', () => {
  const base = {
    characterId: 'char-a',
    trackingSubjects: [{character_id: 'char-a', display_name: '角色甲', exposure_event_ids: []}],
  }
  const warning = charactersPage({...base, currentStateStatus: 'ready', currentHealthState: {characters: {'char-a': {grouped_issues: [{description: '疼痛'}]}}}})
  const good = charactersPage({...base, currentStateStatus: 'ready', currentHealthState: {characters: {'char-a': {grouped_issues: []}}}})
  const normalWithoutEntry = charactersPage({...base, currentStateStatus: 'ready', currentHealthState: {schema_version: 1, characters: {}}})
  const neutral = charactersPage({...base, currentStateStatus: 'STATE_ERROR', currentHealthState: null})
  assert.match(warning, /class="bioweave-button bioweave-character-health-button warning"[\s\S]*健康 · 有异常/)
  assert.match(good, /class="bioweave-button bioweave-character-health-button good"[\s\S]*健康 · 正常/)
  assert.match(normalWithoutEntry, /class="bioweave-button bioweave-character-health-button good"[\s\S]*健康 · 正常/)
  assert.match(neutral, /class="bioweave-button bioweave-character-health-button neutral"[\s\S]*健康 · 暂不可用/)
  assert.ok(warning.indexOf('健康 · 有异常') < warning.indexOf('推演周期'))
  assert.ok(warning.indexOf('推演周期') < warning.indexOf('编辑昵称'))
})

test('Character Health overview maps the read-model severity summary without exposing machine values', () => {
  const base = {
    characterId: 'char-a',
    trackingSubjects: [{character_id: 'char-a', display_name: '角色甲', exposure_event_ids: []}],
    currentStateStatus: 'ready',
    healthPopoverOpen: true,
  }
  for (const [severitySummary, label] of [['mild', '轻微'], ['moderate', '中度'], ['severe', '严重'], ['unknown', '有健康问题']]) {
    const html = charactersPage({...base, currentHealthState: {characters: {'char-a': {
      severity_summary: severitySummary,
      grouped_issues: [{description: '疼痛'}],
    }}}})
    assert.match(html, new RegExp('>总体状态</span><strong[^>]*>' + label + '<'))
    assert.doesNotMatch(html, new RegExp('>' + severitySummary + '<'))
  }
  const normal = charactersPage({...base, currentHealthState: {characters: {'char-a': {severity_summary: 'normal', grouped_issues: []}}}})
  assert.match(normal, />总体状态<\/span><strong[^>]*>正常</)
})

test('Character Health source action is omitted when its Event is not in the current read model', () => {
  const html = charactersPage({
    characterId: 'char-a',
    trackingSubjects: [{ character_id: 'char-a', display_name: '角色甲', exposure_event_ids: [] }],
    currentHealthState: {
      characters: {
        'char-a': {
          grouped_issues: [{ display_site: 'wrist', description: '疼痛', source_observation_ids: ['deleted-event'] }],
        },
      },
    },
    activeEvents: [],
  })
  assert.doesNotMatch(html, /查看来源事件|定位来源事件/)
})

test('Events source navigation helper locates only the canonical Event DOM identity', () => {
  const classes = new Set()
  const target = {
    dataset: { bioweaveEventId: 'event-a' },
    open: false,
    classList: { add: value => classes.add(value), remove: value => classes.delete(value) },
    scrollIntoViewOptions: null,
    scrollIntoView(options) { this.scrollIntoViewOptions = options },
  }
  const documentRef = {
    defaultView: { setTimeout(callback) { callback(); return 1 } },
    querySelectorAll() { return [target] },
  }
  assert.deepEqual(focusEventById('event-a', documentRef), { ok: true, event_id: 'event-a' })
  assert.equal(target.open, true)
  assert.deepEqual(target.scrollIntoViewOptions, { behavior: 'smooth', block: 'center' })
  assert.equal(classes.has('bioweave-event-source-focus'), false)
  assert.deepEqual(focusEventById('missing-event', documentRef), { ok: false, reason: 'EVENT_NOT_FOUND', event_id: 'missing-event' })
})

test('Character Health source navigation is a narrow App action', () => {
  const appSource = readFileSync(new URL('../ui/app.js', import.meta.url), 'utf8')
  assert.match(appSource, /focusEventById/)
  assert.match(appSource, /view-health-source-event/)
  assert.match(appSource, /activeEventById\(normalizedId\)/)
})

test('Character UI forwards current Health State without exposing internal assessment fields', () => {
  const appSource = readFileSync(new URL('../ui/app.js', import.meta.url), 'utf8')
  assert.match(appSource, /currentHealthState: collected\.current_health_state/)
  assert.match(appSource, /currentHealthState: businessState\.currentHealthState/)
  assert.doesNotMatch(charactersPage({
    characterId: 'char-a',
    trackingSubjects: [{ character_id: 'char-a', display_name: '角色甲', exposure_event_ids: [] }],
    currentHealthState: {
      characters: {
        'char-a': {
          grouped_issues: [{
            display_site: 'wrist',
            laterality: 'left',
            factual_kind: 'pain',
            source_event_ids: ['evt'],
            assessment_id: 'assessment-secret',
            source_floor_version: { floor: 1 },
            expected_recovery: { boundary: { day_index: 10 } },
          }],
        },
      },
    },
  }), /assessment-secret|source_floor_version|day_index/)
})

test('state selector event hook is removed while Character focus remains', () => {
  const appSource = readFileSync(new URL('../ui/app.js', import.meta.url), 'utf8')
  const stateSource = readFileSync(new URL('../ui/state.js', import.meta.url), 'utf8')
  assert.doesNotMatch(appSource, /data-bioweave-state-character-id/)
  assert.doesNotMatch(stateSource, /focusedCharacterId|trackingSubjects|currentState\.characters/)
})

test('state page follows the reference task queue and security summary visual contract', () => {
  const style = readFileSync(new URL('../style.css', import.meta.url), 'utf8')
  const html = statePage({ analysisStatus: { state: 'success' }, currentStateStatus: 'ready' })
  assert.match(html, /class="bioweave-page bioweave-state-page"/)
  assert.match(html, /class="bioweave-plugin-status-task-list"/)
  assert.match(html, /任务队列/)
  assert.match(html, /安全摘要/)
  assert.match(html, /密钥存储/)
  assert.match(html, /当前对话作用域/)
  assert.match(style, /\.bioweave-state-page \{[^}]*max-width: 820px/)
  assert.match(style, /\.bioweave-plugin-status-entity-row \{[^}]*padding: 7px 9px/)
  assert.match(style, /\.bioweave-plugin-status-row \{[^}]*border-top: 1px solid var\(--bioweave-border-soft\)/)
})

test('Character Health does not render deferred medical intervention presentation', () => {
  const html = charactersPage({
    characterId: 'char-a',
    trackingSubjects: [{ character_id: 'char-a', display_name: '角色甲', exposure_event_ids: [] }],
    currentStateStatus: 'ready',
    healthPopoverOpen: true,
    activeEvents: [
      {event_id: 'obs-event', state_fact: {subject_id: 'char-a'}},
      {event_id: 'int-event', state_fact: {subject_id: 'char-a'}},
    ],
    currentHealthState: {
      characters: {
        'char-a': {
          severity_summary: 'mild',
          grouped_issues: [{
            body_site: '右臂外侧',
            laterality: 'right',
            health_observations: [{description: '右臂外侧被划开长约三寸的血口', source_event_id: 'obs-event'}],
            source_event_ids: ['obs-event'],
          }],
        },
      },
    },
  })
  assert.equal((html.match(/class="bioweave-character-health-issue-site">右臂外侧/g) || []).length, 1)
  assert.match(html, /当前身体问题/)
  assert.doesNotMatch(html, /医疗处理/)
  assert.match(html, /右臂外侧被划开长约三寸的血口/)
  assert.doesNotMatch(html, /外敷解毒止血药粉进行急救止血/)
  assert.match(html, /obs-event/)
  assert.doesNotMatch(html, /int-event/)
})

import test from "node:test";
import assert from "node:assert/strict";
import {
  eligibleGestationalSubjects,
  explainTrackingDecision,
  rebuildTrackingRegistry,
  resolveCarryingCapability,
} from "../core/tracking.js";
import { PREGNANCY_RELEVANT_EXPOSURE_EVIDENCE_KIND } from "../core/events.js";

function event(overrides = {}) {
  return {
    event_id: "evt-1",
    type: "sexual_activity",
    status: "confirmed",
    location: "room",
    source: {
      chat_id: "chat-1",
      message_id: "message-1",
      floor: 1,
      swipe_id: 0,
      content_hash: "hash-1",
      message_version: "v1",
    },
    participants: [
      {
        character_id: "char-a",
        display_name: "A",
        event_role: "potential_gestational_subject",
        biological_context: { species: "human", biological_type: "type-a" },
        reproductive_capabilities_used: { can_carry_pregnancy: true },
        evidence: [{ kind: "narrative", text: "exposure" }],
      },
      {
        character_id: "char-b",
        display_name: "B",
        event_role: "potential_conception_source",
        reproductive_capabilities_used: { can_cause_pregnancy: true },
        evidence: [{ kind: "narrative", text: "source" }],
      },
    ],
    pregnancy_relevance: {
      relevant: true,
      possible_conception: true,
      gestational_subject_ids: ["char-a"],
      counterpart_ids: ["char-b"],
      confidence: 0.8,
    },
    source_evidence: [
      { kind: "current_floor", text: "event evidence" },
      {
        kind: PREGNANCY_RELEVANT_EXPOSURE_EVIDENCE_KIND,
        text: "actual exposure evidence",
      },
    ],
    ...overrides,
  };
}

function abstractWorldModel(typeCapabilities = {}) {
  return {
    schema_version: 1,
    species: [
      {
        name: "species_alpha",
        biological_types: Object.entries(typeCapabilities).map(
          ([name, capabilities]) => ({
            name,
            capabilities,
          }),
        ),
      },
    ],
  };
}

function abstractExposureEvent({
  eventId = "evt_abstract",
  subjectId = "subject_a",
  sourceId = "source_a",
  subjectType = null,
  subjectSpecies = subjectType ? "species_alpha" : null,
  subjectCapabilities = {},
  sourceCapabilities = { can_cause_pregnancy: true },
  floor = 10,
  swipeId = 0,
  storyTime = { display: `story-${floor}`, precision: "day", day_index: floor },
} = {}) {
  return {
    event_id: eventId,
    type: "sexual_activity",
    status: "confirmed",
    location: "abstract-location",
    story_time: storyTime,
    source: {
      chat_id: "chat-abstract",
      message_id: `message-${floor}`,
      floor,
      swipe_id: swipeId,
      content_hash: `hash-${eventId}`,
      message_version: `version-${eventId}`,
    },
    participants: [
      {
        character_id: subjectId,
        display_name: `${subjectId}-display`,
        event_role: "potential_gestational_subject",
        biological_context: {
          species: subjectSpecies,
          biological_type: subjectType,
        },
        reproductive_capabilities_used: subjectCapabilities,
        evidence: [{ kind: "narrative", text: `${subjectId}-evidence` }],
      },
      {
        character_id: sourceId,
        display_name: `${sourceId}-display`,
        event_role: "potential_conception_source",
        biological_context: {
          species: "species_alpha",
          biological_type: "type_b",
        },
        reproductive_capabilities_used: sourceCapabilities,
        evidence: [{ kind: "narrative", text: `${sourceId}-evidence` }],
      },
    ],
    pregnancy_relevance: {
      relevant: true,
      possible_conception: true,
      gestational_subject_ids: [subjectId],
      counterpart_ids: [sourceId],
      confidence: 0.9,
    },
    source_evidence: [
      {
        kind: PREGNANCY_RELEVANT_EXPOSURE_EVIDENCE_KIND,
        text: `${eventId}-exposure`,
      },
    ],
  };
}

test("tracking requires a pregnancy-relevant exposure and explicit carrying capability", () => {
  assert.deepEqual(eligibleGestationalSubjects(event()), ["char-a"]);
  assert.deepEqual(
    eligibleGestationalSubjects(event({ type: "physical_symptom" })),
    ["char-a"],
  );
  assert.deepEqual(
    eligibleGestationalSubjects(
      event({
        pregnancy_relevance: {
          ...event().pregnancy_relevance,
          relevant: false,
        },
      }),
    ),
    [],
  );
  assert.deepEqual(
    eligibleGestationalSubjects(
      event({
        pregnancy_relevance: {
          ...event().pregnancy_relevance,
          possible_conception: false,
        },
      }),
    ),
    ["char-a"],
  );
  assert.deepEqual(
    eligibleGestationalSubjects(
      event({
        participants: event().participants.map((participant) => ({
          ...participant,
          reproductive_capabilities_used: {
            ...participant.reproductive_capabilities_used,
            can_carry_pregnancy: null,
          },
        })),
      }),
    ),
    [],
  );
  assert.deepEqual(
    eligibleGestationalSubjects(event({ status: "negated" })),
    [],
  );
  assert.deepEqual(
    eligibleGestationalSubjects(event({ status: "fictional" })),
    [],
  );
});

test("non-sexual mechanism exposure enters tracking without a conception flag", () => {
  const nonSexualExposure = event({
    type: "medical_event",
    pregnancy_relevance: {
      ...event().pregnancy_relevance,
      possible_conception: false,
      reproductive_mechanism: {
        kind: "world_defined_implant_path",
        label: "直接植入胚胎",
        pathway: "implantation",
        world_model_rule_refs: ["rule-implant"],
        evidence: [{ kind: "world_model", text: "明确机制规则" }],
      },
    },
  });
  assert.deepEqual(
    eligibleGestationalSubjects(nonSexualExposure, {
      world_model: {
        species: [{
          name: "human",
          biological_types: [{
            name: "type-a",
            reproductive_mechanisms: [{
              key: "world_defined_implant_path",
              carrying_compatibility: true,
            }],
          }],
        }],
      },
    }),
    ["char-a"],
  );
});

test("carrying capability resolves independently in mechanism context", () => {
  const characterFacts = {
    capabilities: { can_carry_pregnancy: false },
    type: {
      reproductive_mechanisms: [
        { key: "natural_path", carrying_compatibility: false },
        { key: "implant_path", carrying_compatibility: true },
        { key: "parasitic_path", carrying_compatibility: null },
      ],
    },
  };
  const eventFor = (key) => ({
    pregnancy_relevance: { reproductive_mechanism: { kind: key } },
  });
  assert.equal(resolveCarryingCapability({ characterFacts, exposureEvent: eventFor("natural_path") }).value, false);
  assert.equal(resolveCarryingCapability({ characterFacts, exposureEvent: eventFor("implant_path") }).value, true);
  assert.equal(resolveCarryingCapability({ characterFacts, exposureEvent: eventFor("parasitic_path") }).value, null);
  assert.equal(resolveCarryingCapability({ characterFacts, exposureEvent: eventFor("unknown_path") }).value, null);
});

test("explicit exposure carrying evidence resolves when the World Model mechanism entry is absent", () => {
  const exposure = event({
    type: "medical_event",
    pregnancy_relevance: {
      ...event().pregnancy_relevance,
      possible_conception: false,
      reproductive_mechanism: { kind: "world_defined_implant_path" },
    },
  });

  assert.deepEqual(
    rebuildTrackingRegistry([exposure]).tracking_subjects,
    { "char-a": {
      character_id: "char-a",
      display_name: "A",
      created_from_event_id: "evt-1",
      exposure_event_ids: ["evt-1"],
      status: "active",
    } },
  );
  assert.deepEqual(rebuildTrackingRegistry([exposure]).tracking_candidates, {});
  const resolution = resolveCarryingCapability({
    characterFacts: {
      explicitCapabilities: { can_carry_pregnancy: true },
      type: { reproductive_mechanisms: [] },
    },
    exposureEvent: exposure,
  });
  assert.equal(resolution.value, true);
  assert.equal(resolution.reason, "EXPOSURE_CARRYING_CAPABILITY");
});

test("gender-like labels and event roles do not create a subject when capability is unknown", () => {
  const candidate = event({
    participants: [
      {
        ...event().participants[0],
        event_role: "other_participant",
        gender: "female",
        reproductive_capabilities_used: { can_carry_pregnancy: null },
      },
    ],
  });
  assert.deepEqual(eligibleGestationalSubjects(candidate), []);
});

test("tracking diagnostics explain eligible and non-subject participants", () => {
  assert.deepEqual(explainTrackingDecision(event()), [
    { character_id: "char-a", eligibility: "eligible", reasons: [] },
    {
      character_id: "char-b",
      eligibility: "ineligible",
      reasons: ["NOT_GESTATIONAL_SUBJECT"],
    },
  ]);
});

test("diagnostic sharing preserves subject-local eligibility across Events", () => {
  const base = event();
  const resultA = event({
    participants: [
      { ...base.participants[0], character_id: "char-a" },
      base.participants[1],
    ],
    pregnancy_relevance: {
      ...base.pregnancy_relevance,
      gestational_subject_ids: ["char-a"],
    },
  });
  const resultC = event({
    participants: [
      { ...base.participants[0], character_id: "char-c" },
      base.participants[1],
    ],
    pregnancy_relevance: {
      ...base.pregnancy_relevance,
      gestational_subject_ids: ["char-c"],
    },
  });
  assert.deepEqual(
    [
      ...eligibleGestationalSubjects(resultC),
      ...eligibleGestationalSubjects(resultA),
    ],
    ["char-c", "char-a"],
  );
});

test("tracking diagnostics explain unknown and false carrying capability", () => {
  const unknown = explainTrackingDecision(
    event({
      participants: event().participants.map((participant) =>
        participant.character_id === "char-a"
          ? {
              ...participant,
              reproductive_capabilities_used: { can_carry_pregnancy: null },
            }
          : participant,
      ),
    }),
  );
  assert.deepEqual(
    unknown.find((decision) => decision.character_id === "char-a"),
    {
      character_id: "char-a",
      eligibility: "pending",
      reasons: ["CAN_CARRY_PREGNANCY_UNKNOWN"],
    },
  );

  const falseCapability = explainTrackingDecision(
    event({
      participants: event().participants.map((participant) =>
        participant.character_id === "char-a"
          ? {
              ...participant,
              reproductive_capabilities_used: { can_carry_pregnancy: false },
            }
          : participant,
      ),
    }),
  );
  assert.deepEqual(
    falseCapability.find((decision) => decision.character_id === "char-a"),
    {
      character_id: "char-a",
      eligibility: "ineligible",
      reasons: ["CAN_CARRY_PREGNANCY_FALSE"],
    },
  );
});

test("tracking diagnostics explain absent conception exposure and missing participants", () => {
  const irrelevant = explainTrackingDecision(
    event({
      pregnancy_relevance: {
        relevant: false,
        possible_conception: false,
        gestational_subject_ids: [],
        counterpart_ids: [],
      },
    }),
  );
  assert.deepEqual(
    irrelevant.find((decision) => decision.character_id === "char-a"),
    {
      character_id: "char-a",
      eligibility: "ineligible",
      reasons: ["INVALID_EVENT", "NOT_GESTATIONAL_SUBJECT"],
    },
  );

  const noExposure = explainTrackingDecision(
    event({
      pregnancy_relevance: {
        relevant: false,
        possible_conception: false,
        gestational_subject_ids: [],
        counterpart_ids: [],
      },
    }),
  );
  assert.deepEqual(
    noExposure.find((decision) => decision.character_id === "char-a"),
    {
      character_id: "char-a",
      eligibility: "ineligible",
      reasons: ["INVALID_EVENT", "NOT_GESTATIONAL_SUBJECT"],
    },
  );

  const missingParticipant = explainTrackingDecision(
    event({
      participants: [event().participants[1]],
      pregnancy_relevance: {
        ...event().pregnancy_relevance,
        gestational_subject_ids: ["char-a"],
      },
    }),
  );
  assert.deepEqual(
    missingParticipant.find((decision) => decision.character_id === "char-a"),
    {
      character_id: "char-a",
      eligibility: "ineligible",
      reasons: ["INVALID_EVENT", "PARTICIPANT_NOT_FOUND"],
    },
  );
});

test("no-exposure sexual activity cannot create a tracking subject", () => {
  const noExposure = event({
    participants: [],
    pregnancy_relevance: {
      relevant: false,
      possible_conception: false,
      gestational_subject_ids: [],
      counterpart_ids: [],
    },
  });
  assert.deepEqual(eligibleGestationalSubjects(noExposure), []);
  assert.deepEqual(rebuildTrackingRegistry([noExposure]).tracking_subjects, {});
});

test("tracking diagnostics explain nonsexual, excluded, and invalid events", () => {
  const nonsexual = explainTrackingDecision(
    event({ type: "physical_symptom" }),
  );
  assert.deepEqual(
    nonsexual.find((decision) => decision.character_id === "char-a"),
    {
      character_id: "char-a",
      eligibility: "eligible",
      reasons: [],
    },
  );

  const excluded = explainTrackingDecision(event({ status: "negated" }));
  assert.deepEqual(
    excluded.find((decision) => decision.character_id === "char-a"),
    {
      character_id: "char-a",
      eligibility: "ineligible",
      reasons: [
        "EVENT_STATUS_EXCLUDED",
        "PREGNANCY_RELEVANT_EXPOSURE_INVALID",
      ],
    },
  );

  assert.deepEqual(explainTrackingDecision({}), [
    {
      character_id: null,
      eligibility: "ineligible",
      reasons: ["INVALID_EVENT"],
    },
  ]);
});

test("registry supports multiple subjects, counterpart references, repeated exposure, and dangling cleanup", () => {
  const first = event();
  const second = event({
    event_id: "evt-2",
    source: {
      ...first.source,
      message_id: "message-2",
      floor: 2,
      content_hash: "hash-2",
      message_version: "v2",
    },
    participants: [
      {
        ...first.participants[0],
        character_id: "char-a",
      },
      {
        ...first.participants[1],
        character_id: "char-d",
        display_name: "D",
        reproductive_capabilities_used: { can_cause_pregnancy: true },
        evidence: [{ kind: "narrative", text: "second source" }],
      },
    ],
    pregnancy_relevance: {
      relevant: true,
      possible_conception: true,
      gestational_subject_ids: ["char-a"],
      counterpart_ids: ["char-d"],
    },
  });
  const third = event({
    event_id: "evt-3",
    source: {
      ...first.source,
      message_id: "message-3",
      floor: 3,
      content_hash: "hash-3",
      message_version: "v3",
    },
    participants: [
      {
        ...first.participants[0],
        character_id: "char-c",
        display_name: "C",
        reproductive_capabilities_used: { can_carry_pregnancy: true },
        evidence: [{ kind: "narrative", text: "third exposure" }],
      },
      {
        ...first.participants[1],
        character_id: "char-d",
        display_name: "D",
        reproductive_capabilities_used: { can_cause_pregnancy: true },
        evidence: [{ kind: "narrative", text: "third source" }],
      },
    ],
    pregnancy_relevance: {
      relevant: true,
      possible_conception: true,
      gestational_subject_ids: ["char-c"],
      counterpart_ids: ["char-d"],
    },
  });
  const registry = rebuildTrackingRegistry([first, second, third, first], {
    tracking_subjects: {
      "char-a": {
        character_id: "char-a",
        display_name: "A",
        created_from_event_id: "deleted-event",
        exposure_event_ids: ["deleted-event"],
        status: "active",
      },
      "char-z": {
        character_id: "char-z",
        display_name: "Z",
        created_from_event_id: "deleted-event",
        exposure_event_ids: ["deleted-event"],
        status: "active",
      },
    },
    character_profiles: {
      "char-z": { character_id: "char-z", display_name: "Z" },
    },
  });

  assert.deepEqual(registry.tracking_subjects["char-a"].exposure_event_ids, [
    "evt-1",
    "evt-2",
  ]);
  assert.equal(
    registry.tracking_subjects["char-a"].created_from_event_id,
    "evt-1",
  );
  assert.deepEqual(registry.tracking_subjects["char-c"].exposure_event_ids, [
    "evt-3",
  ]);
  assert.equal(registry.tracking_subjects["char-z"], undefined);
  assert.deepEqual(registry.subjects, registry.tracking_subjects);
  assert.equal(registry.tracking_subjects["char-a"].counterpart_ids, undefined);
  assert.equal(registry.tracking_subjects["char-a"].event, undefined);
  assert.equal(registry.character_profiles["char-z"], undefined);
});

test("empty current events remove all derived tracking facts", () => {
  const registry = rebuildTrackingRegistry([], {
    tracking_subjects: {
      "char-a": {
        character_id: "char-a",
        display_name: "A",
        created_from_event_id: "evt-old",
        exposure_event_ids: ["evt-old"],
        status: "active",
      },
    },
    character_profiles: {
      "char-a": {
        character_id: "char-a",
        display_name: "A",
        event: { event_id: "evt-old", participants: [] },
      },
    },
  });
  assert.deepEqual(registry.tracking_subjects, {});
  assert.deepEqual(registry.character_profiles, {});
});

test("legacy nested derived data cannot authorize a current Event", () => {
  const candidateEvent = abstractExposureEvent({
    eventId: "evt_nested_legacy",
    subjectId: "subject_nested",
    sourceId: "source_nested",
    subjectCapabilities: { can_carry_pregnancy: null },
  });
  candidateEvent.participants[0].biological_context = {
    species: null,
    biological_type: null,
  };
  const registry = rebuildTrackingRegistry([candidateEvent], {
    tracking_subjects: {},
    tracking_candidates: {},
    character_profiles: {},
    bioweave: {
      character_profiles: {
        subject_nested: {
          character_id: "subject_nested",
          display_name: "subject_nested-display",
          species: "species_alpha",
          biological_type: "type_a",
          reproductive_capabilities: { can_carry_pregnancy: true },
        },
      },
    },
  });

  assert.deepEqual(registry.tracking_subjects, {});
  assert.equal(
    registry.tracking_candidates.subject_nested.eligibility,
    "pending",
  );
  assert.equal(registry.tracking_candidates.subject_nested.species, null);
  assert.equal(
    registry.tracking_candidates.subject_nested.reproductive_capabilities
      .can_carry_pregnancy,
    null,
  );
  assert.deepEqual(registry.character_profiles.subject_nested.evidence, [
    "subject_nested-evidence",
  ]);
});

test("conflicting identity or capability evidence remains pending instead of becoming eligible", () => {
  const identityConflict = rebuildTrackingRegistry([
    abstractExposureEvent({
      eventId: "evt_identity_conflict_a",
      subjectType: "type_a",
      subjectCapabilities: { can_carry_pregnancy: true },
    }),
    abstractExposureEvent({
      eventId: "evt_identity_conflict_b",
      subjectType: "type_b",
      subjectCapabilities: { can_carry_pregnancy: true },
    }),
  ]);
  assert.equal(identityConflict.tracking_subjects.subject_a, undefined);
  assert.equal(
    identityConflict.tracking_candidates.subject_a.eligibility,
    "pending",
  );
  assert.equal(
    identityConflict.tracking_candidates.subject_a.reproductive_capabilities
      .can_carry_pregnancy,
    null,
  );

  const capabilityConflictEvent = abstractExposureEvent({
    eventId: "evt_capability_conflict",
    subjectId: "subject_capability_conflict",
    sourceId: "source_capability_conflict",
    subjectCapabilities: { can_carry_pregnancy: true },
  });
  const capabilityConflict = rebuildTrackingRegistry([
    capabilityConflictEvent,
    abstractExposureEvent({
      eventId: "evt_capability_conflict_b",
      subjectId: "subject_capability_conflict",
      sourceId: "source_capability_conflict_b",
      subjectCapabilities: { can_carry_pregnancy: false },
    }),
  ]);
  assert.equal(
    capabilityConflict.tracking_subjects.subject_capability_conflict,
    undefined,
  );
  assert.equal(
    capabilityConflict.tracking_candidates.subject_capability_conflict
      .eligibility,
    "pending",
  );
  assert.equal(
    capabilityConflict.tracking_candidates.subject_capability_conflict
      .reproductive_capabilities.can_carry_pregnancy,
    null,
  );
});

test("stale profiles and candidates cannot fill unknown current capability or evidence", () => {
  const current = abstractExposureEvent({
    subjectType: null,
    subjectCapabilities: { can_carry_pregnancy: null },
  });
  const registry = rebuildTrackingRegistry([current], {
    tracking_candidates: {
      subject_a: {
        character_id: "subject_a",
        display_name: "stale display",
        species: "species_alpha",
        biological_type: "type_a",
        reproductive_capabilities: { can_carry_pregnancy: true },
        evidence: ["stale candidate evidence"],
      },
    },
    character_profiles: {
      subject_a: {
        character_id: "subject_a",
        display_name: "stale display",
        species: "species_alpha",
        biological_type: "type_a",
        reproductive_capabilities: { can_carry_pregnancy: true },
        evidence: ["stale profile evidence"],
      },
    },
  });

  assert.deepEqual(registry.tracking_subjects, {});
  assert.equal(registry.tracking_candidates.subject_a.eligibility, "pending");
  assert.equal(registry.tracking_candidates.subject_a.species, null);
  assert.equal(
    registry.tracking_candidates.subject_a.reproductive_capabilities
      .can_carry_pregnancy,
    null,
  );
  assert.deepEqual(registry.tracking_candidates.subject_a.evidence, [
    "evt_abstract-exposure",
    "subject_a-evidence",
  ]);
  assert.ok(
    !registry.tracking_candidates.subject_a.evidence.includes("STALE_EVIDENCE"),
  );
  assert.deepEqual(registry.character_profiles.subject_a.evidence, [
    "subject_a-evidence",
  ]);
});

test("exhaustive candidate collection keeps later recipients after an ineligible recipient", () => {
  const events = [
    abstractExposureEvent({
      eventId: "evt_true_first",
      subjectId: "subject_first",
      sourceId: "source_first",
      subjectCapabilities: { can_carry_pregnancy: true },
    }),
    abstractExposureEvent({
      eventId: "evt_false_middle",
      subjectId: "subject_middle",
      sourceId: "source_middle",
      subjectCapabilities: { can_carry_pregnancy: false },
    }),
    abstractExposureEvent({
      eventId: "evt_true_last",
      subjectId: "subject_last",
      sourceId: "source_last",
      subjectCapabilities: { can_carry_pregnancy: true },
    }),
  ];
  const registry = rebuildTrackingRegistry(events);

  assert.deepEqual(Object.keys(registry.tracking_subjects), [
    "subject_first",
    "subject_last",
  ]);
  assert.deepEqual(registry.tracking_candidates, {});
  assert.equal(registry.tracking_subjects.subject_middle, undefined);
  assert.equal(
    registry.character_profiles.subject_last.character_id,
    "subject_last",
  );
});

test("unknown carry capability is pending and does not enter eligible subjects", () => {
  const candidateEvent = abstractExposureEvent({
    eventId: "evt_pending",
    subjectCapabilities: { can_be_fertilized: true, can_carry_pregnancy: null },
  });
  const decisions = explainTrackingDecision(candidateEvent);
  assert.equal(
    decisions.find((item) => item.character_id === "subject_a").eligibility,
    "pending",
  );

  const registry = rebuildTrackingRegistry([candidateEvent]);
  assert.deepEqual(registry.tracking_subjects, {});
  assert.equal(registry.tracking_candidates.subject_a.eligibility, "pending");
  assert.deepEqual(registry.tracking_candidates.subject_a.exposure_event_ids, [
    "evt_pending",
  ]);
});

test("World Model type baseline resolves identity and keeps fertilized-only recipients ineligible", () => {
  const worldModel = abstractWorldModel({
    type_a: { can_be_fertilized: true, can_carry_pregnancy: true },
    type_b: { can_be_fertilized: true, can_carry_pregnancy: false },
  });
  const eligibleEvent = abstractExposureEvent({
    eventId: "evt_baseline_true",
    subjectCapabilities: { can_be_fertilized: null, can_carry_pregnancy: null },
    subjectType: "type_a",
  });
  const ineligibleEvent = abstractExposureEvent({
    eventId: "evt_baseline_false",
    subjectId: "subject_b",
    sourceId: "source_b",
    subjectCapabilities: { can_be_fertilized: true, can_carry_pregnancy: null },
    subjectType: "type_b",
  });
  const registry = rebuildTrackingRegistry([eligibleEvent, ineligibleEvent], {
    world_model: worldModel,
  });

  assert.ok(registry.tracking_subjects.subject_a);
  assert.equal(registry.tracking_subjects.subject_b, undefined);
  assert.deepEqual(registry.tracking_candidates, {});
});

test("pending candidate re-evaluation preserves the original exposure Story Time and Source Version", () => {
  const exposure = abstractExposureEvent({
    eventId: "evt_original",
    floor: 10,
    swipeId: 2,
    storyTime: {
      display: "story-time-original",
      normalized: null,
      day_index: 10,
      calendar_id: "calendar_alpha",
      provider: "narrative",
      precision: "day",
      confidence: 0.7,
    },
    subjectCapabilities: { can_carry_pregnancy: null },
    subjectType: "type_a",
  });
  const pending = rebuildTrackingRegistry([exposure], { world_model: null });
  assert.equal(pending.tracking_candidates.subject_a.eligibility, "pending");
  assert.equal(
    pending.tracking_candidates.subject_a.exposure_records[0].source.floor,
    10,
  );
  assert.equal(
    pending.tracking_candidates.subject_a.exposure_records[0].source.swipe_id,
    2,
  );
  assert.equal(
    pending.tracking_candidates.subject_a.exposure_records[0].story_time
      .day_index,
    10,
  );

  const resolved = rebuildTrackingRegistry([exposure], {
    ...pending,
    world_model: abstractWorldModel({ type_a: { can_carry_pregnancy: true } }),
  });
  assert.ok(resolved.tracking_subjects.subject_a);
  assert.equal(
    resolved.tracking_subjects.subject_a.created_from_event_id,
    "evt_original",
  );
  assert.deepEqual(resolved.tracking_candidates, {});
  assert.equal(exposure.story_time.day_index, 10);
  assert.equal(exposure.source.floor, 10);
  assert.equal(exposure.source.swipe_id, 2);
});

test("pending candidate becomes absent when trusted World Model resolves carry as false", () => {
  const exposure = abstractExposureEvent({
    eventId: "evt_resolved_false",
    subjectCapabilities: { can_carry_pregnancy: null },
    subjectType: "type_b",
  });
  const pending = rebuildTrackingRegistry([exposure]);
  const resolved = rebuildTrackingRegistry([exposure], {
    ...pending,
    world_model: abstractWorldModel({
      type_b: { can_be_fertilized: true, can_carry_pregnancy: false },
    }),
  });

  assert.deepEqual(resolved.tracking_subjects, {});
  assert.deepEqual(resolved.tracking_candidates, {});
  assert.equal(exposure.event_id, "evt_resolved_false");
});

test("exact identity mapping can use a baseline while weak-only identity remains pending", () => {
  const worldModel = abstractWorldModel({
    type_a: { can_carry_pregnancy: true },
  });
  const mapped = abstractExposureEvent({
    eventId: "evt_mapped",
    subjectType: "type_a",
    subjectCapabilities: { can_carry_pregnancy: null },
  });
  const weakOnly = abstractExposureEvent({
    eventId: "evt_weak_only",
    subjectId: "subject_weak",
    sourceId: "source_weak",
    subjectType: null,
    subjectCapabilities: { can_carry_pregnancy: null },
  });
  const registry = rebuildTrackingRegistry([mapped, weakOnly], {
    world_model: worldModel,
  });

  assert.ok(registry.tracking_subjects.subject_a);
  assert.equal(registry.tracking_subjects.subject_weak, undefined);
  assert.equal(
    registry.tracking_candidates.subject_weak.eligibility,
    "pending",
  );
  assert.equal(registry.tracking_candidates.subject_weak.species, null);
  assert.equal(registry.tracking_candidates.subject_weak.biological_type, null);
});

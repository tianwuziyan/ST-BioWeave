import {activeHealthAssessments} from '../core/health-assessment.js';
import {
  deriveCurrentHealthState,
  emptyCurrentHealthState,
  expiredHealthEventIds,
} from '../core/health-evolution.js';
import {buildHealthRecoveryGuidance} from '../core/health-recovery-guidance.js';

export function createHealthEvolutionRuntime() {
  function activeAssessments({states = [], events = []} = {}) {
    const assessments = [];
    const seen = new Set();
    for (const state of Array.isArray(states) ? states : []) {
      for (const assessment of activeHealthAssessments({
        timeline: state?.floorData?.health_assessment_timeline,
        events,
        floorVersion: state?.version,
      })) {
        const key = assessment?.request_key ?? assessment?.assessment_id;
        if (!key || seen.has(key)) continue;
        seen.add(key);
        assessments.push(assessment);
      }
    }
    return assessments;
  }

  function deriveFromFloorStates({states = [], currentEvents = [], currentStoryTime = null} = {}) {
    const events = Array.isArray(currentEvents) ? [...currentEvents] : [];
    const assessments = activeAssessments({states, events});
    return deriveCurrentHealthState({events, assessments, currentStoryTime});
  }

  function findExpiredEventIds({
    states = [],
    currentEvents = [],
    currentStoryTime = null,
    protectedEventIds = [],
  } = {}) {
    const events = Array.isArray(currentEvents) ? [...currentEvents] : [];
    return expiredHealthEventIds({
      events,
      assessments: activeAssessments({states, events}),
      currentStoryTime,
      protectedEventIds,
    });
  }

  return {
    deriveFromFloorStates,
    findExpiredEventIds,
    buildRecoveryGuidance: buildHealthRecoveryGuidance,
    emptyCurrentHealthState,
  };
}

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
    for (const state of Array.isArray(states) ? states : []) {
      assessments.push(...activeHealthAssessments({
        timeline: state?.floorData?.health_assessment_timeline,
        events,
        floorVersion: state?.version,
      }));
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

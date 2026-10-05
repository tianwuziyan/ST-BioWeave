import {activeHealthAssessments} from '../core/health-assessment.js';
import {deriveCurrentHealthState, emptyCurrentHealthState} from '../core/health-evolution.js';
import {buildHealthRecoveryGuidance} from '../core/health-recovery-guidance.js';

export function createHealthEvolutionRuntime() {
  function deriveFromFloorStates({states = [], currentStoryTime = null} = {}) {
    const events = [];
    const assessments = [];
    for (const state of Array.isArray(states) ? states : []) {
      const version = state?.version;
      const floorEvents = Array.isArray(state?.events) ? state.events : [];
      events.push(...floorEvents);
      assessments.push(...activeHealthAssessments({
        timeline: state?.floorData?.health_assessment_timeline,
        events: floorEvents,
        floorVersion: version,
      }));
    }
    return deriveCurrentHealthState({events, assessments, currentStoryTime});
  }

  return {
    deriveFromFloorStates,
    buildRecoveryGuidance: buildHealthRecoveryGuidance,
    emptyCurrentHealthState,
  };
}

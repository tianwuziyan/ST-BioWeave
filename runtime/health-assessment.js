import {
  HEALTH_ASSESSMENT_SCHEMA_VERSION,
  healthAssessmentEligibility,
  healthAssessmentRequestKey,
  healthObservationFingerprint,
  normalizeHealthAssessmentTimeline,
  validateHealthAssessment,
} from '../core/health-assessment.js';
import {diagnosticFingerprint} from './diagnostics.js';

function clone(value) {
  return value === undefined ? value : structuredClone(value);
}

function versionOf(target) {
  return target?.version ?? target?.floor_version ?? null;
}

export function createHealthAssessmentCoordinator({
  analyzer,
  getFloor,
  commitFloorPatch,
  assertExecutionTargetCurrent,
  trace = () => {},
} = {}) {
  const inFlight = new Map();

  function selectCandidates({events = [], currentEvents = []} = {}) {
    const priorById = new Map((Array.isArray(currentEvents) ? currentEvents : [])
      .map(event => [event?.event_id, event]));
    return (Array.isArray(events) ? events : []).filter(event => {
      const prior = priorById.get(event?.event_id);
      return !prior
        || healthObservationFingerprint(prior) !== healthObservationFingerprint(event);
    });
  }

  function diagnostic(stage, details = {}) {
    try { trace({type: 'HEALTH_ASSESSMENT_TRACE', stage, ...details}); } catch { /* diagnostics never affect facts */ }
  }

  function correlation({event, version, fingerprint, requestKey, execution} = {}) {
    return {
      source_event_id: event?.event_id ?? null,
      source_floor_version: clone(version),
      source_observation_fingerprint_hash: diagnosticFingerprint(fingerprint),
      request_key: requestKey ?? null,
      invocation_id: execution?.execution_id ?? execution?.id ?? null,
    };
  }

  async function assessFloor({target, execution, token, events, signal} = {}) {
    const version = versionOf(target);
    const floor = getFloor?.(target?.index, target?.swipeId) ?? null;
    let timeline = normalizeHealthAssessmentTimeline(floor?.health_assessment_timeline);
    const results = [];
    for (const event of Array.isArray(events) ? events : []) {
      const eligibility = healthAssessmentEligibility(event);
      if (!eligibility.eligible) continue;
      const fingerprint = healthObservationFingerprint(eligibility.event);
      const requestKey = await healthAssessmentRequestKey({
        eventId: eligibility.event.event_id,
        floorVersion: version,
        observationFingerprint: fingerprint,
      });
      const existing = timeline.assessments.find(item => item.request_key === requestKey);
      diagnostic('HEALTH_ASSESSMENT_LOOKUP', {
        ...correlation({event: eligibility.event, version, fingerprint, requestKey, execution}),
        assessment_present: Boolean(existing),
        assessment_valid: Boolean(existing && validateHealthAssessment(existing).ok),
      });
      if (existing && validateHealthAssessment(existing).ok) {
        results.push(existing);
        diagnostic('HEALTH_ASSESSMENT_REUSED', {
          ...correlation({event: eligibility.event, version, fingerprint, requestKey, execution}),
          assessment_id: existing.assessment_id ?? null,
          assessment_valid: true,
        });
        continue;
      }

      const request = async () => {
        try {
          if (typeof assertExecutionTargetCurrent === 'function')
            await assertExecutionTargetCurrent(execution, target, token);
          const latest = getFloor?.(target?.index, target?.swipeId) ?? null;
          const liveEvent = latest?.events?.find(item => item?.event_id === event.event_id);
          if (!liveEvent || healthObservationFingerprint(liveEvent) !== fingerprint) {
            diagnostic('HEALTH_ASSESSMENT_STALE_BEFORE_REQUEST', {request_key: requestKey});
            return null;
          }
          diagnostic('HEALTH_ASSESSMENT_REQUEST_STARTED', {
            ...correlation({event: liveEvent, version, fingerprint, requestKey, execution}),
          });
          const response = await analyzer.analyzeHealthAssessment({event: liveEvent, signal});
          diagnostic('HEALTH_ASSESSMENT_REQUEST_COMPLETED', {
            ...correlation({event: liveEvent, version, fingerprint, requestKey, execution}),
            response_schema_version: response?.schema_version ?? null,
          });
          if (typeof assertExecutionTargetCurrent === 'function')
            await assertExecutionTargetCurrent(execution, target, token);
          const after = getFloor?.(target?.index, target?.swipeId) ?? null;
          const currentEvent = after?.events?.find(item => item?.event_id === event.event_id);
          if (!currentEvent || healthObservationFingerprint(currentEvent) !== fingerprint) {
            diagnostic('HEALTH_ASSESSMENT_STALE_COMPLETION_DISCARDED', {request_key: requestKey});
            return null;
          }
          const latestTimeline = normalizeHealthAssessmentTimeline(after?.health_assessment_timeline);
          const accepted = latestTimeline.assessments.find(item => item.request_key === requestKey);
          if (accepted && validateHealthAssessment(accepted).ok) {
            timeline = latestTimeline;
            return accepted;
          }
          const candidate = {
            ...response,
            assessment_id: `${requestKey}_v1`,
            request_key: requestKey,
            source_event_id: currentEvent.event_id,
            source_floor_version: clone(version),
            source_observation_fingerprint: fingerprint,
            reference_story_time: clone(currentEvent.story_time),
            assessment_source: response.assessment_source ?? 'ai_derived_assessment',
          };
          const validation = validateHealthAssessment(candidate);
          if (!validation.ok) {
            diagnostic('HEALTH_ASSESSMENT_VALIDATION_FAILED', {request_key: requestKey, errors: validation.errors});
            return null;
          }
          const next = {
            ...latestTimeline,
            schema_version: HEALTH_ASSESSMENT_SCHEMA_VERSION,
            assessments: [...latestTimeline.assessments, validation.value],
          };
          await commitFloorPatch(target, 'health', {health_assessment_timeline: next}, {
            operation_type: 'health-assessment-persist',
            execution,
            assertCurrent: () => assertExecutionTargetCurrent?.(execution, target, token),
          });
          const readback = getFloor?.(target?.index, target?.swipeId) ?? null;
          const acceptedReadback = normalizeHealthAssessmentTimeline(readback?.health_assessment_timeline)
            .assessments.find(item => item.request_key === requestKey);
          if (!acceptedReadback || !validateHealthAssessment(acceptedReadback).ok) {
            diagnostic('HEALTH_ASSESSMENT_READBACK_FAILED', {request_key: requestKey});
            return null;
          }
          timeline = normalizeHealthAssessmentTimeline(readback?.health_assessment_timeline);
          diagnostic('HEALTH_ASSESSMENT_ACCEPTED', {
            ...correlation({event: currentEvent, version, fingerprint, requestKey, execution}),
            assessment_id: acceptedReadback.assessment_id ?? null,
            assessment_valid: true,
          });
          return acceptedReadback;
        } catch (error) {
          diagnostic('HEALTH_ASSESSMENT_REQUEST_FAILED', {
            ...correlation({event, version, fingerprint, requestKey, execution}),
            reason: error?.code ?? error?.message,
          });
          diagnostic('HEALTH_ASSESSMENT_FAILED', {request_key: requestKey, code: error?.code ?? error?.message});
          return null;
        }
      };
      const inFlightRequest = inFlight.get(requestKey);
      if (inFlightRequest) {
        diagnostic('HEALTH_ASSESSMENT_INFLIGHT_REUSED', {
          ...correlation({event: eligibility.event, version, fingerprint, requestKey, execution}),
        });
      }
      const pending = inFlightRequest ?? request();
      inFlight.set(requestKey, pending);
      try {
        const result = await pending;
        if (result) results.push(result);
      } finally {
        if (inFlight.get(requestKey) === pending) inFlight.delete(requestKey);
      }
    }
    return results;
  }

  return {
    assessFloor,
    selectCandidates,
    inFlight,
  };
}

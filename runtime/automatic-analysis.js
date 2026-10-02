/**
 * Narrow automatic-analysis port.
 *
 * The scheduler remains owned by event-analysis.js during Phase 1. This port
 * only exposes the lifecycle-facing observe operation and read/reset hooks;
 * it deliberately does not expose scheduler state mutation primitives.
 */
export function createAutomaticAnalysisPort({
  observeSettledCharacterFloor,
  getState,
  reset,
} = {}) {
  if (typeof observeSettledCharacterFloor !== "function" ||
      typeof getState !== "function" ||
      typeof reset !== "function") {
    throw new TypeError("AUTOMATIC_ANALYSIS_PORT_DEPENDENCIES_REQUIRED");
  }

  return Object.freeze({
    observeSettledCharacterFloor,
    getState,
    reset,
  });
}

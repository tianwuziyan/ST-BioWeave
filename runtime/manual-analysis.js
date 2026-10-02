/**
 * Narrow manual-analysis port.
 *
 * Manual callers share the analysis execution port inside event-analysis.js;
 * this facade only names the supported user-invoked operations. Legacy runtime
 * methods remain available during the migration for compatibility.
 */
export function createManualAnalysisPort({
  refreshCurrentFloor,
  analyzeCurrentCharacterEvents,
  analyzeCurrentFloor,
} = {}) {
  if (typeof refreshCurrentFloor !== "function" ||
      typeof analyzeCurrentCharacterEvents !== "function" ||
      typeof analyzeCurrentFloor !== "function") {
    throw new TypeError("MANUAL_ANALYSIS_PORT_DEPENDENCIES_REQUIRED");
  }

  return Object.freeze({
    refreshCurrentFloor,
    analyzeCurrentCharacterEvents,
    analyzeCurrentFloor,
  });
}

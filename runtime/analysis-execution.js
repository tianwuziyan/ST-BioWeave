/**
 * Narrow shared analysis execution port.
 *
 * Phase 2 keeps the execution coordinator in event-analysis.js. The port
 * only provides one formal entry point so automatic and manual callers share
 * the existing analyzeFloor implementation without duplicating the pipeline.
 */
export function createAnalysisExecutionPort({run} = {}) {
  if (typeof run !== "function")
    throw new TypeError("ANALYSIS_EXECUTION_PORT_DEPENDENCIES_REQUIRED");

  return Object.freeze({
    run(request = {}) {
      const {
        target = null,
        force = false,
        reason = "automatic",
        generation,
        intent,
        trigger,
      } = request;
      const options = {force, reason};
      if (Object.prototype.hasOwnProperty.call(request, "generation"))
        options.generation = generation;
      if (Object.prototype.hasOwnProperty.call(request, "intent"))
        options.intent = intent;
      if (Object.prototype.hasOwnProperty.call(request, "trigger"))
        options.trigger = trigger;
      return run(target, options);
    },
  });
}

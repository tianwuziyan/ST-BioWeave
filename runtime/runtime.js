import {createRuntimeDiagnostics} from "./diagnostics.js";
import {createCharacterEventAnalysis} from "./character-event-analysis.js";
import {createEventEditing} from "./event-editing.js";
import {createGenerationLifecycle} from "./generation-lifecycle.js";
import {createTrackingRuntime} from "./tracking-runtime.js";
import {createWorldAnalysis} from "./world-analysis.js";

// Composition root for the runtime feature modules.  The pipeline and its
// mutable execution state remain owned by event-analysis.js; this module only
// creates feature instances and wires narrow capabilities into them.
export function createRuntime({
  diagnosticsOptions = {},
  tracking,
  generation,
  world,
  characterEvent,
  eventEditing,
} = {}) {
  const diagnostics = createRuntimeDiagnostics(diagnosticsOptions);
  const trackingRuntime = createTrackingRuntime(tracking);
  const generationLifecycle = createGenerationLifecycle(generation);
  const worldAnalysis = createWorldAnalysis({
    ...world,
    formatExecutionDiagnostic: (error, stage) =>
      diagnostics.formatExecutionDiagnostic(error, stage),
  });
  const characterEventAnalysis = createCharacterEventAnalysis(characterEvent);
  const editing = createEventEditing(eventEditing);

  return {
    diagnostics,
    generationLifecycle,
    trackingRuntime,
    worldAnalysis,
    characterEventAnalysis,
    eventEditing: editing,
  };
}

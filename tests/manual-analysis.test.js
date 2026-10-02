import test from "node:test";
import assert from "node:assert/strict";
import { createManualAnalysisPort } from "../runtime/manual-analysis.js";

test("manual-analysis port exposes only user-invoked analysis operations", async () => {
  const calls = [];
  const port = createManualAnalysisPort({
    refreshCurrentFloor: () => calls.push("refresh"),
    analyzeCurrentCharacterEvents: () => calls.push("character"),
    analyzeCurrentFloor: options => calls.push(["floor", options]),
  });

  await port.refreshCurrentFloor();
  await port.analyzeCurrentCharacterEvents();
  await port.analyzeCurrentFloor({force: false});

  assert.deepEqual(calls, ["refresh", "character", ["floor", {force: false}]]);
  assert.deepEqual(Object.keys(port).sort(), [
    "analyzeCurrentCharacterEvents",
    "analyzeCurrentFloor",
    "refreshCurrentFloor",
  ]);
});

test("manual-analysis port rejects incomplete dependencies", () => {
  assert.throws(
    () => createManualAnalysisPort(),
    /MANUAL_ANALYSIS_PORT_DEPENDENCIES_REQUIRED/,
  );
});

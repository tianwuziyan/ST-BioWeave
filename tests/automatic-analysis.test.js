import test from "node:test";
import assert from "node:assert/strict";
import { createAutomaticAnalysisPort } from "../runtime/automatic-analysis.js";

test("automatic-analysis port forwards only its narrow lifecycle operations", async () => {
  const calls = [];
  const state = { counter: 2, retryPaused: false };
  const port = createAutomaticAnalysisPort({
    observeSettledCharacterFloor: async (target, options) => {
      calls.push(["observe", target, options]);
      return { skipped: true, reason: "character-interval" };
    },
    getState: () => state,
    reset: reason => calls.push(["reset", reason]),
  });
  const target = { index: 4, version: { message_id: "message-4" } };

  assert.deepEqual(
    await port.observeSettledCharacterFloor(target, { reason: "automatic" }),
    { skipped: true, reason: "character-interval" },
  );
  assert.equal(port.getState(), state);
  port.reset("chat-boundary");
  assert.deepEqual(calls, [
    ["observe", target, { reason: "automatic" }],
    ["reset", "chat-boundary"],
  ]);
  assert.deepEqual(Object.keys(port).sort(), ["getState", "observeSettledCharacterFloor", "reset"]);
});

test("automatic-analysis port rejects incomplete dependencies", () => {
  assert.throws(
    () => createAutomaticAnalysisPort({}),
    /AUTOMATIC_ANALYSIS_PORT_DEPENDENCIES_REQUIRED/,
  );
});

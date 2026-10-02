import test from "node:test";
import assert from "node:assert/strict";
import { createAnalysisExecutionPort } from "../runtime/analysis-execution.js";

test("automatic and manual callers share the same execution port", async () => {
  const calls = [];
  const port = createAnalysisExecutionPort({
    run: async (...args) => {
      calls.push(args);
      return {status: "success"};
    },
  });
  const automaticEntry = request => port.run(request);
  const manualEntry = request => port.run(request);
  const target = {index: 3, version: {message_id: "message-3"}};

  await automaticEntry({target, force: false, reason: "automatic", trigger: "automatic"});
  await manualEntry({target: null, force: true, reason: "manual-refresh", trigger: "manual-refresh"});

  assert.deepEqual(calls, [
    [target, {force: false, reason: "automatic", trigger: "automatic"}],
    [null, {force: true, reason: "manual-refresh", trigger: "manual-refresh"}],
  ]);
  assert.equal(Object.keys(port).length, 1);
  assert.equal(Object.keys(port)[0], "run");
});

test("analysis execution port rejects incomplete dependencies", () => {
  assert.throws(
    () => createAnalysisExecutionPort(),
    /ANALYSIS_EXECUTION_PORT_DEPENDENCIES_REQUIRED/,
  );
});

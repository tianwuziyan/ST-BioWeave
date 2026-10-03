import test from "node:test";
import assert from "node:assert/strict";
import { createGenerationLifecycle } from "../runtime/generation-lifecycle.js";

function version(index, messageId = `message-${index}`) {
  return {
    chat_id: "chat",
    message_id: messageId,
    floor: index,
    swipe_id: 0,
    content_hash: `hash-${index}`,
    message_version: `v1:hash-${index}`,
  };
}

function target(index) {
  return { index, chatId: "chat", swipeId: 0, version: version(index) };
}

function createFixture(overrides = {}) {
  const traces = [];
  const lifecycle = createGenerationLifecycle({
    getChatId: () => "chat",
    baselineVersionForPayload: () => null,
    resolveEndedTarget: async index => target(index),
    isTargetNew: () => true,
    floorExecutionKey: value => JSON.stringify(value),
    emitTrace: (stage, pending, current, details) =>
      traces.push({ stage, pending, current, details }),
    ...overrides,
  });
  return { lifecycle, traces };
}

test("a newer rendered Character Floor supersedes a pending reroll before its delayed end callback", async () => {
  const settled = [];
  const fixture = createFixture({
    onGenerationSettled: async (...args) => settled.push(args),
  });

  fixture.lifecycle.onGenerationStarted({
    generation_type: "regenerate",
    message_id: "message-56",
  });
  const first = await fixture.lifecycle.onCharacterMessageRendered(target(56));
  assert.equal(first.reason, "generation-awaiting-end");

  const newer = await fixture.lifecycle.onCharacterMessageRendered(target(66));
  assert.equal(newer, null);
  assert.equal(fixture.lifecycle.getState().pendingGeneration, null);

  const delayedEnd = await fixture.lifecycle.onGenerationEnded();
  assert.equal(delayedEnd.reason, "generation-ended-without-intent");
  assert.equal(settled.length, 0);
  assert.equal(
    fixture.traces.some(item =>
      item.stage === "GENERATION_INTENT_SUPERSEDED" &&
      item.details.supersede_reason === "newer_character_floor_rendered",
    ),
    true,
  );
});

test("a settled callback fails closed when its target is no longer the current owner", async () => {
  let checks = 0;
  const fixture = createFixture({
    isSettledTargetCurrent: async () => checks++ === 0,
    onGenerationSettled: () => {
      throw new Error("must not schedule stale owner");
    },
  });
  fixture.lifecycle.onGenerationStarted({
    generation_type: "regenerate",
    message_id: "message-56",
  });
  await fixture.lifecycle.onCharacterMessageRendered(target(56));
  const result = await fixture.lifecycle.onGenerationEnded();
  assert.deepEqual(result, { skipped: true, reason: "generation-stale-owner" });
  assert.equal(fixture.lifecycle.getState().pendingGeneration, null);
});

test("a new normal generation supersedes an older force intent", () => {
  const fixture = createFixture();
  fixture.lifecycle.onGenerationStarted({
    generation_type: "regenerate",
    message_id: "message-56",
  });
  fixture.lifecycle.onGenerationStarted({
    generation_type: "normal",
    message_id: "message-66",
  });
  const state = fixture.lifecycle.getState();
  assert.equal(state.pendingGeneration.generation_type, "normal");
  assert.equal(
    fixture.traces.filter(item => item.stage === "GENERATION_INTENT_SUPERSEDED").length,
    1,
  );
});

test("completed generation ownership requires the same Chat, Swipe, Floor Version, and intent", async () => {
  let chatId = "chat";
  let settledGeneration = null;
  const fixture = createFixture({
    getChatId: () => chatId,
    onGenerationSettled: async (_target, options) => {
      settledGeneration = options.generation;
      return { skipped: true, reason: "test-settled" };
    },
  });
  fixture.lifecycle.onGenerationStarted({
    generation_type: "regenerate",
    message_id: "message-56",
    swipe_id: 0,
  });
  await fixture.lifecycle.onCharacterMessageRendered(target(56));
  await fixture.lifecycle.onGenerationEnded();
  assert.equal(
    fixture.lifecycle.isGenerationOwnerCurrent(settledGeneration, target(56)),
    true,
  );
  assert.equal(
    fixture.lifecycle.isGenerationOwnerCurrent(settledGeneration, {
      index: 56,
      version: {...version(56), content_hash: "changed", message_version: "v1:changed"},
    }),
    false,
  );
  chatId = "other-chat";
  assert.equal(fixture.lifecycle.isGenerationOwnerCurrent(settledGeneration, target(56)), false);
});

test("an ownerless completed marker only consumes its settled Floor index", async () => {
  const fixture = createFixture({
    onGenerationSettled: async () => ({ skipped: true, reason: "test-settled" }),
  });
  fixture.lifecycle.onGenerationStarted("regenerate");
  const settled = await fixture.lifecycle.onCharacterMessageRendered(target(56));
  assert.equal(settled.reason, "generation-awaiting-end");
  await fixture.lifecycle.onGenerationEnded();

  const laterFloor = await fixture.lifecycle.onCharacterMessageRendered(target(66));
  assert.equal(laterFloor, null);
});

test("a completed marker does not claim scheduler observed ownership", async () => {
  const observedKeys = [];
  const fixture = createFixture({
    rememberObservedKey: key => observedKeys.push(key),
    onGenerationSettled: async () => ({ skipped: true, reason: "test-settled" }),
  });
  fixture.lifecycle.onGenerationStarted("normal");
  await fixture.lifecycle.onCharacterMessageRendered(target(66));
  await fixture.lifecycle.onGenerationEnded();
  const result = await fixture.lifecycle.onCharacterMessageRendered(target(66));

  assert.deepEqual(result, { skipped: true, reason: "generation-already-consumed" });
  assert.equal(observedKeys.length, 0);
});

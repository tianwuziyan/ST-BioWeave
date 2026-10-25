import test from "node:test";
import assert from "node:assert/strict";
import {resolveStorylineBodyMessageIndex} from "../runtime/events.js";

test("storyline body lookup uses the chat-array index when host messages omit message_id", () => {
  const messages = [
    {role: "user", content: "用户输入"},
    {role: "assistant", content: "第一条正文"},
    {role: "assistant", content: "第二条正文"},
  ];

  assert.equal(
    resolveStorylineBodyMessageIndex(messages, {message_id: 1, floor: 1}),
    1,
  );
  assert.equal(
    resolveStorylineBodyMessageIndex(messages, {message_id: "2", floor: 2}),
    2,
  );
});

test("storyline body lookup uses the host Floor field when its array index differs", () => {
  const messages = [
    {floor: 104, role: "assistant", content: "上一条正文"},
    {floor: 106, role: "assistant", content: "需要判定的正文"},
  ];

  assert.equal(
    resolveStorylineBodyMessageIndex(messages, {message_id: 106, floor: 106}),
    1,
  );
});

test("storyline body lookup prefers an explicit host message_id", () => {
  const messages = [
    {message_id: "host-0", role: "assistant", content: "第一条正文"},
    {role: "assistant", content: "第二条正文"},
  ];

  assert.equal(
    resolveStorylineBodyMessageIndex(messages, {message_id: "host-0", floor: 0}),
    0,
  );
  assert.equal(
    resolveStorylineBodyMessageIndex(messages, {message_id: 1, floor: 1}),
    1,
  );
});

test("storyline body lookup uses the Floor as a deterministic tie-breaker", () => {
  const messages = [
    {message_id: 7, role: "assistant", content: "重复标识 A"},
    {message_id: 7, role: "assistant", content: "重复标识 B"},
  ];

  assert.equal(
    resolveStorylineBodyMessageIndex(messages, {message_id: 7, floor: 1}),
    1,
  );
  assert.equal(
    resolveStorylineBodyMessageIndex(messages, {message_id: 8, floor: 1}),
    -1,
  );
});

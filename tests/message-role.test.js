import test from "node:test";
import assert from "node:assert/strict";
import {
  isCharacterMessageRole,
  normalizeHostMessageRole,
} from "../core/message-role.js";
import { isCharacterMessage } from "../storage/store.js";

test("normalizes real SillyTavern hidden Character messages as character", () => {
  const message = { is_user: false, is_system: true, extra: {} };
  assert.equal(normalizeHostMessageRole(message), "character");
  assert.equal(isCharacterMessageRole(message), true);
  assert.equal(isCharacterMessage(message), true);
});

test("normalizes native and explicit host roles deterministically", () => {
  assert.equal(normalizeHostMessageRole({ is_user: false, is_system: false, extra: {} }), "character");
  assert.equal(normalizeHostMessageRole({ is_user: false, is_system: false, extra: { type: "assistant_message" } }), "character");
  assert.equal(normalizeHostMessageRole({ is_user: false, is_system: true, extra: { type: "assistant_message" } }), "other");
  assert.equal(normalizeHostMessageRole({ is_user: true, is_system: false }), "user");
  assert.equal(normalizeHostMessageRole({ is_user: true, is_system: true }), "user");
  assert.equal(normalizeHostMessageRole({ is_user: false, is_system: true, extra: { type: "narrator" } }), "system");
  assert.equal(normalizeHostMessageRole({ is_user: false, is_system: true, extra: { type: "comment" } }), "other");
  assert.equal(normalizeHostMessageRole({ is_user: false, is_system: true, extra: { type: "extension_system" } }), "other");
});

test("uses legacy role only for synthetic messages without host-native role fields", () => {
  assert.equal(normalizeHostMessageRole({ role: "assistant" }), "character");
  assert.equal(normalizeHostMessageRole({ role: "user" }), "user");
  assert.equal(normalizeHostMessageRole({ role: "system" }), "system");
  assert.equal(normalizeHostMessageRole({ role: "system", is_user: false, extra: {} }), "character");
  assert.equal(normalizeHostMessageRole({ role: "assistant", is_user: false, extra: { type: "narrator" } }), "system");
});

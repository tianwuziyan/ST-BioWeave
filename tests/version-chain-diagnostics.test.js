import test from "node:test";
import assert from "node:assert/strict";
import {
  buildVersionChainDiagnostic,
  versionChainTransition,
} from "../runtime/diagnostics.js";

function version(overrides = {}) {
  return {
    chat_id: "chat-1",
    message_id: "message-1",
    floor: 70,
    swipe_id: 0,
    content_hash: "hash-a",
    message_version: "v1:hash-a",
    ...overrides,
  };
}

function chain(boundary, overrides = {}) {
  return buildVersionChainDiagnostic({
    boundary,
    source_kind: "analysis_target",
    version: version(overrides.version),
    message_index: 70,
    generation_id: null,
    generation_intent_id: "intent-1",
    generation_type: "normal",
    generation_ended: true,
    generation_settled: true,
    final_floor_index: 70,
    final_floor_version: version(overrides.final_floor_version),
    scheduler_revision: 4,
    analysis_execution_id: "analysis-execution-1",
    source_text_length: 12,
  });
}

test("正常版本链在相同 hash 下不产生 transition", () => {
  const first = chain("ANALYSIS_INPUT_READY");
  const second = chain("API_RESULT_RECEIVED");
  assert.equal(versionChainTransition(first, second), null);
});

test("analysis target 与 authoritative read 的 logical owner 分叉产生 transition", () => {
  const from = chain("ANALYSIS_INPUT_READY");
  const to = chain("AUTHORITATIVE_SOURCE_READ_BEFORE_WRITE", {
    version: {message_id: "message-2", floor: 71},
  });
  assert.deepEqual(versionChainTransition(from, to), {
    stage: "VERSION_CHAIN_TRANSITION",
    analysis_execution_id: "analysis-execution-1",
    from_boundary: "ANALYSIS_INPUT_READY",
    to_boundary: "AUTHORITATIVE_SOURCE_READ_BEFORE_WRITE",
    from_chat_id: "chat-1",
    to_chat_id: "chat-1",
    from_message_id: "message-1",
    to_message_id: "message-2",
    from_floor: 70,
    to_floor: 71,
    from_swipe_id: 0,
    to_swipe_id: 0,
    from_source_kind: "analysis_target",
    to_source_kind: "analysis_target",
  });
});

test("Swipe 变化在 transition 中保留两侧 swipe_id", () => {
  const from = chain("ANALYSIS_INPUT_READY");
  const to = chain("API_RESULT_RECEIVED", {
    version: {swipe_id: 1, content_hash: "hash-b", message_version: "v1:hash-b"},
  });
  const transition = versionChainTransition(from, to);
  assert.equal(transition.from_swipe_id, 0);
  assert.equal(transition.to_swipe_id, 1);
});

test("正文派生版本字段不再进入版本链节点", () => {
  const first = chain("ANALYSIS_INPUT_READY");
  const second = chain("API_RESULT_RECEIVED", {
    version: {message_version: "v2:hash-a"},
  });
  assert.equal(second.content_hash, undefined);
  assert.equal(second.message_version, undefined);
  assert.equal(versionChainTransition(first, second), null);
});

test("generation_id 缺失时仍可通过 analysis_execution_id 关联", () => {
  const entry = chain("API_REQUEST_STARTED");
  assert.equal(entry.generation_id, null);
  assert.equal(entry.analysis_execution_id, "analysis-execution-1");
});

test("diagnostic 字段缺失时使用 null 或 unavailable，不伪造 host save 状态", () => {
  const entry = buildVersionChainDiagnostic({
    boundary: "API_REQUEST_STARTED",
    source_kind: "analysis_target",
    analysis_execution_id: "analysis-execution-2",
  });
  assert.equal(entry.content_hash, undefined);
  assert.equal(entry.message_version, undefined);
  assert.equal(entry.host_save_state, "unavailable");
  assert.equal(entry.host_post_save_hook, "NO_PUBLIC_POST_SAVE_HOOK");
});

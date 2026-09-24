import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {resolve} from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);

test("ordinary Floor business modules submit owner patches instead of direct full-slot saves", async () => {
  const files = ["runtime/event-analysis.js", "storage/projection.js"];
  for (const relative of files) {
    const source = await readFile(resolve(root, relative), "utf8");
    assert.doesNotMatch(source, /\bstore\.saveFloor\s*\(/u, relative);
  }
});

test("the coordinator remains the single ordinary owner and does not create Chat metadata Floor storage", async () => {
  const source = await readFile(resolve(root, "storage/floor-persistence-coordinator.js"), "utf8");
  assert.match(source, /FLOOR_TX_(?:CREATED|QUEUED|CONFIRMED)/u);
  assert.match(source, /FLOOR_OWNER_FIELDS/u);
  assert.doesNotMatch(source, /chatMetadata\.(?:floors|bioweave_floor)/u);
});

test("production storage uses the generic adapter slot writer", async () => {
  const storeSource = await readFile(resolve(root, "storage/store.js"), "utf8");
  const adapterSource = await readFile(resolve(root, "runtime/events.js"), "utf8");
  assert.match(storeSource, /adapter\.saveFloorSlot \?\? adapter\.saveFloorBioWeave/u);
  assert.match(adapterSource, /async saveFloorSlot\(/u);
  assert.doesNotMatch(adapterSource, /saveOfficialFloorBioWeave/u);
});

test("ordinary business modules cannot bypass the Coordinator with host save orchestration", async () => {
  const files = ["runtime/event-analysis.js", "storage/projection.js"];
  for (const relative of files) {
    const source = await readFile(resolve(root, relative), "utf8");
    assert.doesNotMatch(source, /\/api\/chats\/save/u, relative);
    assert.doesNotMatch(source, /\bcontext\.saveChat\s*\(/u, relative);
    assert.doesNotMatch(source, /\bsaveOfficialFloorSlot\s*\(/u, relative);
    assert.doesNotMatch(source, /\bextra\.bioweave\s*=/u, relative);
    assert.doesNotMatch(source, /\bswipe_info\s*\[[^\]]+\].*\.extra\.bioweave\s*=/u, relative);
  }
});

test("the compatibility entry point cannot become a second persistence implementation", async () => {
  const source = await readFile(resolve(root, "runtime/floor-persistence.js"), "utf8");
  assert.match(source, /from ["']\.\.\/storage\/floor-persistence-coordinator\.js["']/u);
  assert.doesNotMatch(source, /function createFloorPersistenceCoordinator|const tails|store\.saveFloor/u);
});

test("the frozen Coordinator retains owner acquisition, readback, sibling audit, and confirmed semantics", async () => {
  const source = await readFile(resolve(root, "storage/floor-persistence-coordinator.js"), "utf8");
  assert.match(source, /FLOOR_OWNER_FIELDS/u);
  assert.match(source, /HOST_AHEAD_OF_OFFICIAL/u);
  assert.match(source, /TRUE_STALE_OWNER_CHANGE/u);
  assert.match(source, /FLOOR_TX_SIBLING_AUDIT/u);
  assert.match(source, /FLOOR_TX_CONFIRMED/u);
  assert.match(source, /readAuthoritativeFloor/u);
  assert.match(source, /tails\.get\(transaction\.transaction_key\)/u);
  assert.match(source, /commitState: "confirmed"/u);
});

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

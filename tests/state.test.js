import test from 'node:test';import assert from 'node:assert/strict';import {reduceState} from '../core/state.js';
test('reducer preserves deterministic event order',()=>assert.deepEqual(reduceState({events:[{event_id:'b',source:{floor:2}},{event_id:'a',source:{floor:1}}]}).processed_events,['a','b']));

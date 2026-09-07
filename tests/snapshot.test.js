import test from 'node:test';import assert from 'node:assert/strict';import {shouldSnapshot} from '../core/snapshot.js';
test('snapshot interval',()=>{assert.equal(shouldSnapshot(8,6,3),false);assert.equal(shouldSnapshot(9,6,3),true);});

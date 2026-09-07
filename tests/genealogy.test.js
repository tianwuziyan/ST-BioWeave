import test from 'node:test';import assert from 'node:assert/strict';import {sortRelatives} from '../core/genealogy.js';
test('generation first',()=>assert.equal(sortRelatives([{character_id:'b',generation:2},{character_id:'a',generation:1}])[0].character_id,'a'));

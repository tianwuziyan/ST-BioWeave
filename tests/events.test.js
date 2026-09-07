import test from 'node:test';import assert from 'node:assert/strict';import {validateEvent} from '../core/events.js';
test('valid event',()=>assert.equal(validateEvent({event_id:'e1',type:'physical_symptom',status:'confirmed',source:{chat_id:'c'}}).ok,true));

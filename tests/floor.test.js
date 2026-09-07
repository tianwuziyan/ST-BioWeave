import test from 'node:test';import assert from 'node:assert/strict';import {commitAnalysis,shouldAnalyze} from '../runtime/floor.js';

const version={chat_id:'chat-a',message_id:'m1',floor:1,swipe_id:0,content_hash:'hash-1',message_version:'v1'};
const editedVersion={...version,content_hash:'hash-2',message_version:'v2'};

test('success not auto repeated',()=>assert.equal(shouldAnalyze({status:'success'}),false));
test('same floor version is not repeated',()=>assert.equal(shouldAnalyze({status:'success',floor_version:version},{version}),false));
test('edited floor version is analyzed again',()=>assert.equal(shouldAnalyze({status:'success',floor_version:version},{version:editedVersion}),true));
test('manual refresh allowed',()=>assert.equal(shouldAnalyze({status:'success',floor_version:version},{version,manual:true}),true));
test('failed retries',()=>assert.equal(shouldAnalyze({status:'failed',floor_version:version},{version}),true));
test('failed refresh retains previous success result',()=>{
  const result=commitAnalysis({status:'success',floor_version:version,summary:'旧结果'},{status:'failed',error:'timeout'},editedVersion);
  assert.equal(result.status,'failed');
  assert.equal(result.summary,'旧结果');
  assert.equal(result.last_success.summary,'旧结果');
  assert.deepEqual(result.floor_version,editedVersion);
  const repeatedFailure=commitAnalysis(result,{status:'failed',error:'again'},editedVersion);
  assert.equal(repeatedFailure.last_success.summary,'旧结果');
});

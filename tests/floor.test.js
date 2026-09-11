import test from 'node:test';import assert from 'node:assert/strict';import {activeFloorEvents,commitAnalysis,eventSourceMatchesFloorVersion,getActiveFloorEvents,shouldAnalyze} from '../runtime/floor.js';

const version={chat_id:'chat-a',message_id:'m1',floor:1,swipe_id:0,content_hash:'hash-1',message_version:'v1'};
const editedVersion={...version,content_hash:'hash-2',message_version:'v2'};
const replacementEvent={event_id:'evt-new',source:editedVersion};
const previousEvent={event_id:'evt-old',source:version};

test('success not auto repeated',()=>assert.equal(shouldAnalyze({status:'success'}),false));
test('same floor version is not repeated',()=>assert.equal(shouldAnalyze({status:'success',floor_version:version},{version}),false));
test('edited floor version is analyzed again',()=>assert.equal(shouldAnalyze({status:'success',floor_version:version},{version:editedVersion}),true));
test('manual refresh allowed',()=>assert.equal(shouldAnalyze({status:'success',floor_version:version},{version,manual:true}),true));
test('failed retries',()=>assert.equal(shouldAnalyze({status:'failed',floor_version:version},{version}),true));
test('failed refresh retains previous success result',()=>{
  const result=commitAnalysis({status:'success',floor_version:version,summary:'旧结果',events:[previousEvent]},{status:'failed',error:'timeout'},editedVersion);
  assert.equal(result.status,'failed');
  assert.equal(result.summary,'旧结果');
  assert.equal(result.last_success.summary,'旧结果');
  assert.deepEqual(result.events,[previousEvent]);
  assert.deepEqual(result.floor_version,editedVersion);
  const repeatedFailure=commitAnalysis(result,{status:'failed',error:'again'},editedVersion);
  assert.equal(repeatedFailure.last_success.summary,'旧结果');
});

test('manual success replaces the previous version result',()=>{
  const result=commitAnalysis({status:'success',floor_version:version,summary:'旧结果',events:[previousEvent]},
    {status:'success',summary:'新结果',events:[replacementEvent]},editedVersion);
  assert.equal(result.status,'success');
  assert.equal(result.summary,'新结果');
  assert.deepEqual(result.events,[replacementEvent]);
  assert.equal(result.last_success,undefined);
});

test('active event scan requires every source field to match the current version',()=>{
  const incomplete={event_id:'evt-incomplete',source:{...version,content_hash:undefined}};
  const wrongSwipe={event_id:'evt-wrong-swipe',source:{...version,swipe_id:1}};
  const wrongMessageVersion={event_id:'evt-wrong-version',source:{...version,message_version:'v2'}};
  const floor={events:[previousEvent,incomplete,wrongSwipe,wrongMessageVersion]};
  assert.equal(eventSourceMatchesFloorVersion(previousEvent,version),true);
  assert.equal(eventSourceMatchesFloorVersion(incomplete,version),false);
  assert.deepEqual(getActiveFloorEvents(floor,version).map(event=>event.event_id),['evt-old']);
  assert.deepEqual(activeFloorEvents(floor,editedVersion),[]);
  assert.deepEqual(getActiveFloorEvents(floor),[]);
});

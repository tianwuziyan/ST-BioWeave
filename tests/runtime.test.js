import test from 'node:test';
import assert from 'node:assert/strict';
import {createChatBoundary,STALE_CHAT} from '../runtime/chat.js';
import {createRuntime,createSillyTavernAdapter} from '../runtime/events.js';
import {floorVersion} from '../runtime/floor.js';
import {createStore} from '../storage/store.js';
import {CONCEPTION_RELEVANT_EXPOSURE_EVIDENCE_KIND} from '../core/events.js';

function createAdapter() {
  let chatId='chat-a';
  let pendingSave=null;
  const metadata={bioweave:{chat_scope:{chat_id:'chat-a'},marker:'chat-a'}};
  const message={swipes:['zero','one'],swipe_info:[{},{}]};
  return {
    metadata,
    message,
    setChatId(value){chatId=value;},
    holdNextChatSave(){
      return new Promise(resolve => { pendingSave=resolve; });
    },
    releaseChatSave(){pendingSave?.();pendingSave=null;},
    getChatId(){return chatId;},
    getChatMetadata(){return metadata;},
    getMessage(index){return index===0?message:null;},
    async saveChatMetadata(key,value,expectedChatId){
      assert.equal(expectedChatId,chatId);
      if (pendingSave) await new Promise(resolve => {
        const release=pendingSave;
        pendingSave=()=>{release();resolve();};
      });
      metadata[key]=value;
    },
    async saveFloorBioWeave(index,swipeId,value,expectedChatId){
      assert.equal(expectedChatId,chatId);
      if (Array.isArray(message.swipes)||Array.isArray(message.swipe_info)) {
        message.swipe_info??=[];
        message.swipe_info[swipeId]??={};
        message.swipe_info[swipeId].extra??={};
        message.swipe_info[swipeId].extra.bioweave=value;
      } else {
        message.extra??={};
        message.extra.bioweave=value;
      }
    },
  };
}

test('chat boundary rejects a token after chat switch',()=>{
  let chatId='chat-a';
  const boundary=createChatBoundary({getChatId:()=>chatId});
  const token=boundary.token();
  chatId='chat-b';
  assert.throws(()=>boundary.assert(token),new RegExp(STALE_CHAT));
  assert.equal(boundary.current(),'chat-b');
});

test('per-swipe floor storage isolates swipe zero and other swipes',async()=>{
  const adapter=createAdapter();
  const store=createStore(adapter,createChatBoundary(adapter));
  await store.saveFloor(0,0,{floor_version:{chat_id:'chat-a'},value:'zero'});
  await store.saveFloor(0,1,{floor_version:{chat_id:'chat-a'},value:'one'});
  assert.equal(adapter.message.extra?.bioweave,undefined);
  assert.equal(store.getFloor(0,0).value,'zero');
  assert.equal(store.getFloor(0,1).value,'one');
  assert.equal(store.getFloor(0,2).value,undefined);
});

test('active floor reads the message swipe and drops deleted floors',async()=>{
  const adapter=createAdapter();
  adapter.message.swipe_id=0;
  const store=createStore(adapter,createChatBoundary(adapter));
  const versionA={chat_id:'chat-a',message_id:0,floor:1,swipe_id:0,content_hash:'hash-a',message_version:'v1'};
  const versionB={...versionA,swipe_id:1,content_hash:'hash-b',message_version:'v2'};
  await store.saveFloor(0,0,{analysis:{status:'success',floor_version:versionA},events:[{event_id:'evt-a',source:versionA}]});
  await store.saveFloor(0,1,{analysis:{status:'success',floor_version:versionB},events:[{event_id:'evt-b',source:versionB}]});

  assert.equal(store.getActiveSwipeId(0),0);
  assert.deepEqual(store.getActiveFloorEvents(0,versionA).map(event=>event.event_id),['evt-a']);
  adapter.message.swipe_id=1;
  assert.equal(store.getActiveSwipeId(0),1);
  assert.deepEqual(store.getActiveFloorEvents(0,versionB).map(event=>event.event_id),['evt-b']);
  assert.deepEqual(store.getActiveFloorEvents(0,versionA),[]);

  adapter.getMessage=()=>null;
  assert.equal(store.getActiveFloor(0),null);
  assert.deepEqual(store.getActiveFloorEvents(0,versionB),[]);
});

test('ordinary floor storage uses message extra when no swipe structure exists',async()=>{
  const adapter=createAdapter();
  delete adapter.message.swipes;
  delete adapter.message.swipe_info;
  adapter.message.extra={};
  const store=createStore(adapter,createChatBoundary(adapter));
  await store.saveFloor(0,0,{floor_version:{chat_id:'chat-a'},value:'ordinary'});
  assert.equal(adapter.message.extra.bioweave.value,'ordinary');
  assert.equal(store.getFloor(0,0).value,'ordinary');
});

test('chat reads never return another chat metadata',()=>{
  const adapter=createAdapter();
  const store=createStore(adapter,createChatBoundary(adapter));
  adapter.setChatId('chat-b');
  assert.deepEqual(store.getChat('chat-a').chat_scope,{chat_id:'chat-a'});
  assert.equal(store.getChat('chat-b').marker,undefined);
});

test('legacy Chat reads as an empty tracking registry without writing a migration',()=>{
  const adapter=createAdapter();
  adapter.metadata.bioweave={chat_scope:{chat_id:'chat-a'},marker:'legacy'};
  const store=createStore(adapter,createChatBoundary(adapter));
  const restored=store.getChat('chat-a');
  assert.deepEqual(restored.tracking_subjects,{});
  assert.equal(adapter.metadata.bioweave.tracking_subjects,undefined);
  assert.equal(restored.marker,'legacy');
});

test('tracking registry writes retain Chat scope and secret sanitization',async()=>{
  const adapter=createAdapter();
  const store=createStore(adapter,createChatBoundary(adapter));
  await store.saveTrackingSubjects('chat-a',{
    charA:{character_id:'charA',status:'active',exposure_event_ids:['evt-a']},
    api_key:'do-not-persist',
  });
  assert.deepEqual(store.getTrackingSubjects('chat-a').charA.exposure_event_ids,['evt-a']);
  assert.equal(adapter.metadata.bioweave.tracking_subjects.api_key,undefined);
  assert.deepEqual(adapter.metadata.bioweave.chat_scope,{chat_id:'chat-a'});
});

test('runtime registry refresh scans current Floor facts without requesting AI',async()=>{
  const adapter=createAdapter();
  adapter.message.swipe_id=0;
  adapter.message.swipes=['story'];
  adapter.getChat=()=>[adapter.message];
  const text='story';
  const version=await floorVersion({
    chatId:'chat-a',
    messageId:0,
    floor:0,
    swipeId:0,
    text,
  });
  await createStore(adapter,createChatBoundary(adapter)).saveFloor(0,0,{
    analysis:{status:'success',floor_version:version},
    events:[{
      event_id:'evt-refresh',
      type:'sexual_activity',
      status:'confirmed',
      source:version,
      participants:[
        {
          character_id:'char-a',
          display_name:'A',
          event_role:'potential_gestational_subject',
          reproductive_capabilities_used:{can_carry_pregnancy:true},
        },
        {
          character_id:'char-b',
          display_name:'B',
          event_role:'potential_conception_source',
          reproductive_capabilities_used:{can_cause_pregnancy:true},
        },
      ],
      pregnancy_relevance:{
        relevant:true,
        possible_conception:true,
        gestational_subject_ids:['char-a'],
        counterpart_ids:['char-b'],
      },
      source_evidence:[{kind:CONCEPTION_RELEVANT_EXPOSURE_EVIDENCE_KIND,text:'actual exposure'}],
    }],
  });
  const runtime=createRuntime({adapter});
  assert.equal(await runtime.init(),true);
  const registry=await runtime.refreshTrackingRegistry('focused-test');
  assert.equal(registry.tracking_subjects['char-a'].created_from_event_id,'evt-refresh');
  assert.deepEqual(adapter.metadata.bioweave.tracking_subjects['char-a'].exposure_event_ids,['evt-refresh']);
});

test('stale async chat save is rejected after chat switch',async()=>{
  const adapter=createAdapter();
  adapter.holdNextChatSave();
  const store=createStore(adapter,createChatBoundary(adapter));
  const pending=store.saveChat('chat-a',{chat_scope:{chat_id:'chat-a'},marker:'old'});
  adapter.setChatId('chat-b');
  adapter.releaseChatSave();
  await assert.rejects(pending,new RegExp(STALE_CHAT));
});

test('chat storage removes secret values and global API configuration while preserving references',async()=>{
  const adapter=createAdapter();
  const store=createStore(adapter,createChatBoundary(adapter));
  await store.saveChat('chat-a',{chat_scope:{chat_id:'chat-a'},api_key:'secret',nested:{apiKey:'nested-secret',api_profiles:{profile:{model:'must-not-persist'}},api_request_settings:{timeout:1,retry_count:0}},secret_ref:'ref-1',api_profiles:{profile:{model:'must-not-persist'}},assignments:{world_analysis:'profile'},api_request_settings:{timeout:1,retry_count:0}});
  assert.equal(adapter.metadata.bioweave.api_key,undefined);
  assert.equal(adapter.metadata.bioweave.nested.apiKey,undefined);
  assert.equal(adapter.metadata.bioweave.nested.api_profiles,undefined);
  assert.equal(adapter.metadata.bioweave.secret_ref,'ref-1');
  assert.equal(adapter.metadata.bioweave.api_profiles,undefined);
  assert.equal(adapter.metadata.bioweave.assignments,undefined);
  assert.equal(adapter.metadata.bioweave.api_request_settings,undefined);
  assert.equal(adapter.metadata.bioweave.nested.api_request_settings,undefined);
});

test('SillyTavern global settings rollback keeps the prior profile on save failure',async()=>{
  const previous={api_profiles:{old:{profile_id:'old'}},assignments:{}};
  const context={
    extensionSettings:{bioweave:previous},
    async saveSettingsDebounced(){throw new Error('SAVE_FAILED');},
  };
  globalThis.SillyTavern={getContext:()=>context};
  try {
    const adapter=createSillyTavernAdapter();
    await assert.rejects(adapter.saveGlobalSettings({api_profiles:{next:{profile_id:'next'}},assignments:{}}),/SAVE_FAILED/);
    assert.equal(context.extensionSettings.bioweave,previous);
  } finally {
    delete globalThis.SillyTavern;
  }
});

test('runtime uses official eventTypes and removes listeners on destroy',async()=>{
  const registered=new Map();
  const source={
    on(type,listener){registered.set(type,listener);},
    removeListener(type,listener){assert.equal(registered.get(type),listener);registered.delete(type);},
  };
  const eventTypes={CHAT_CHANGED:'chat',MESSAGE_UPDATED:'updated',MESSAGE_EDITED:'edited',MESSAGE_DELETED:'deleted',MESSAGE_SWIPED:'swiped',MESSAGE_SWIPE_DELETED:'swipe-deleted',MESSAGE_RECEIVED:'received',GENERATION_ENDED:'ended'};
  const adapter={getChatId:()=> 'chat-a',getContext:()=>({eventSource:source,eventTypes})};
  const runtime=createRuntime({adapter});
  const events=[];
  runtime.subscribe(event=>events.push(event));
  assert.equal(await runtime.init(),true);
  assert.equal(registered.size,8);
  registered.get('edited')({message_id:0});
  assert.equal(events.at(-1).type,'MESSAGE_EDITED');
  runtime.destroy();
  assert.equal(registered.size,0);
  assert.equal(await runtime.init(),false);
});

test('SillyTavern adapter writes per-swipe data to the host message',async()=>{
  const context={chatId:'chat-a',chat:[{swipes:['zero','one'],swipe_info:[{},{}]}],saveChat:async()=>{}};
  globalThis.SillyTavern={getContext:()=>context};
  try {
    const adapter=createSillyTavernAdapter();
    await adapter.saveFloorBioWeave(0,0,{marker:'zero'},'chat-a');
    await adapter.saveFloorBioWeave(0,1,{marker:'one'},'chat-a');
    assert.equal(context.chat[0].extra?.bioweave,undefined);
    assert.equal(context.chat[0].swipe_info[0].extra.bioweave.marker,'zero');
    assert.equal(context.chat[0].swipe_info[1].extra.bioweave.marker,'one');
  } finally {
    delete globalThis.SillyTavern;
  }
});

test('SillyTavern adapter preserves object-indexed swipe_info storage',async()=>{
  const context={chatId:'chat-a',chat:[{
    swipes:{0:{content:'zero'},1:{content:'one'}},
    swipe_info:{},
  }],saveChat:async()=>{}};
  globalThis.SillyTavern={getContext:()=>context};
  try {
    const adapter=createSillyTavernAdapter();
    await adapter.saveFloorBioWeave(0,1,{marker:'one'},'chat-a');
    assert.equal(context.chat[0].extra?.bioweave,undefined);
    assert.equal(context.chat[0].swipe_info[1].extra.bioweave.marker,'one');
  } finally {
    delete globalThis.SillyTavern;
  }
});

test('SillyTavern adapter persists Chat settings through host metadata for another endpoint',async()=>{
  let metadataSaveCount=0;
  const context={
    chatId:'chat-a',
    chatMetadata:{},
    async saveMetadata(){metadataSaveCount+=1;},
  };
  globalThis.SillyTavern={getContext:()=>context};
  try {
    const firstStore=createStore(createSillyTavernAdapter(),createChatBoundary({getChatId:()=>context.chatId,getChatMetadata:()=>context.chatMetadata,saveChatMetadata:async(...args)=>createSillyTavernAdapter().saveChatMetadata(...args)}));
    await firstStore.saveChat('chat-a',{
      chat_scope:{chat_id:'chat-a'},
      settings:{
        recent_story:{floor_count:12,regex_user_enabled:true,regex_rules:[]},
        external_memory:{anima:true,baobaoshu:false,database_memory:false},
      },
    });

    const secondAdapter=createSillyTavernAdapter();
    const secondStore=createStore(secondAdapter,createChatBoundary(secondAdapter));
    const restored=secondStore.getChat('chat-a');
    assert.equal(restored.settings.recent_story.floor_count,12);
    assert.equal(restored.settings.recent_story.regex_user_enabled,true);
    assert.equal(restored.settings.external_memory.anima,true);
    assert.equal(metadataSaveCount,1);
  } finally {
    delete globalThis.SillyTavern;
  }
});

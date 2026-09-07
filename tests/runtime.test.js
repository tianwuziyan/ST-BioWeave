import test from 'node:test';
import assert from 'node:assert/strict';
import {createChatBoundary,STALE_CHAT} from '../runtime/chat.js';
import {createRuntime,createSillyTavernAdapter} from '../runtime/events.js';
import {createStore} from '../storage/store.js';

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

import test from 'node:test';import assert from 'node:assert/strict';import {activeFloorEvents,commitAnalysis,eventSourceMatchesFloorVersion,floorVersion,getActiveFloorEvents,hashText,sameFloorVersion,shouldAnalyze} from '../runtime/floor.js';

const version={chat_id:'chat-a',message_id:'m1',floor:1,swipe_id:0,content_hash:'hash-1',message_version:'v1'};
const editedVersion={...version,content_hash:'hash-2',message_version:'v2'};
const replacementEvent={event_id:'evt-new',source:editedVersion};
const previousEvent={event_id:'evt-old',source:version};

async function withGlobalCrypto(value, callback) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    enumerable: descriptor?.enumerable ?? true,
    value,
  });
  try {
    return await callback();
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'crypto', descriptor);
    else delete globalThis.crypto;
  }
}

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

test('HTTP-like crypto without subtle uses UTF-8 SHA-256 fallback compatible with WebCrypto', {concurrency: false}, async()=>{
  const vectors = [
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    ['ASCII text 123 !@#', '1f38d7f0ca65e11d012317e5a22b7663ed7b314475359a05dbf0f4d6bddd7196'],
    ['中文字符', '76b1b5e05a5793dff353fbf1290a0a6ba15b651b11a3dccb4c7e8da55c5c0259'],
    ['你好，世界', '46932f1e6ea5216e77f58b1908d72ec9322ed129318c6d4bd4450b5eaab9d7e7'],
    ['永和三年三月初七', '87c1d286c2e7647064bc71090a1f1ad0e87700d076e41117bbaa5dc73323cf10'],
    ['emoji 😀🧬', '84a03fc34c3aeb34af1f79498fd2a00f921f6fc60579312c2e72a0923b7712a9'],
    ['第一行\n第二行\r\n第三行', '9f5fe7bb2551a8249f3aea4f53e14394b87a5beca42d13d01380934bd4326470'],
    ['BioWeave 长文本 😀\n'.repeat(1000), 'dd4bec5a596fd78ab1581c82fca4ddb1c6519ee4b44a76d55c1ea92525c64c98'],
  ];
  assert.equal(typeof globalThis.crypto?.subtle?.digest, 'function');
  const webCryptoHashes = [];
  for (const [input, expected] of vectors) {
    const actual = await hashText(input);
    assert.equal(actual, expected);
    webCryptoHashes.push(actual);
  }
  await withGlobalCrypto({subtle: undefined}, async()=>{
    for (const [index, [input, expected]] of vectors.entries()) {
      assert.equal(await hashText(input), expected);
      assert.equal(await hashText(input), webCryptoHashes[index]);
    }
  });
});

test('HTTP-like fallback preserves six-field Floor Version and change semantics', {concurrency: false}, async()=>{
  assert.equal(typeof globalThis.crypto?.subtle?.digest, 'function');
  const webCryptoVersion = await floorVersion({
    chatId: 'chat-http', messageId: 'message-1', floor: 4, swipeId: 0, text: 'abc',
  });
  await withGlobalCrypto({subtle: undefined}, async()=>{
    const base = await floorVersion({
      chatId: 'chat-http', messageId: 'message-1', floor: 4, swipeId: 0, text: 'abc',
    });
    assert.deepEqual(Object.keys(base), ['chat_id', 'message_id', 'floor', 'swipe_id', 'content_hash', 'message_version']);
    assert.equal(base.content_hash, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    assert.equal(base.message_version, `v1:${base.content_hash}`);
    assert.deepEqual(base, webCryptoVersion);
    assert.equal(sameFloorVersion(webCryptoVersion, base), true);
    assert.equal(sameFloorVersion(base, {...base}), true);

    const changedText = await floorVersion({
      chatId: 'chat-http', messageId: 'message-1', floor: 4, swipeId: 0, text: 'abc changed',
    });
    const changedSwipe = await floorVersion({
      chatId: 'chat-http', messageId: 'message-1', floor: 4, swipeId: 1, text: 'abc',
    });
    const changedMessageVersion = await floorVersion({
      chatId: 'chat-http', messageId: 'message-1', floor: 4, swipeId: 0, text: 'abc', messageVersion: 'v2',
    });
    assert.notEqual(changedText.content_hash, base.content_hash);
    assert.equal(sameFloorVersion(base, changedText), false);
    assert.equal(sameFloorVersion(base, changedSwipe), false);
    assert.equal(sameFloorVersion(base, changedMessageVersion), false);
  });
});

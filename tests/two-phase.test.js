'use strict';
// Point DSP_TEST_SOURCE at the candidate source root (containing native/).
// Reuse the existing fixture verbatim; this file does not alter application code.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const {webcrypto} = require('node:crypto');
const root = process.env.DSP_TEST_SOURCE || path.resolve(__dirname, '..');
const {create, sessionChanged} = require(path.join(root, 'native/nativeAudioNegotiation'));
const profileHelper = require(path.join(root, 'native/nativeAudioProfile'));
const audioHelper = require(path.join(root, 'native/nativeAudioSession'));
const fixtureFile = path.join(root, 'tests/deepstream-native-audio-negotiation.test.js');
const input = fs.readFileSync(fixtureFile, 'utf8');
const a = input.indexOf('function fixture()');
const b = input.indexOf('\nasync function prepare(', a);
assert.ok(a >= 0 && b > a, 'the original fixture is available');
const fixture = vm.runInNewContext(input.slice(a, b) + '\nfixture',
    {webcrypto, profileHelper, audioHelper, structuredClone, URL, setTimeout, clearTimeout});
const caps = async () => ({nativeAudioHlsAvailable:true});

async function setup({missingAudio=true, missingSubtitle=false}={}) {
    const f=fixture(), controller=create(f.win,caps);
    const marked=await controller.registerItem(f.item,undefined,Promise.resolve(f.profile));
    assert.notEqual(marked, f.profile, 'candidate must be registered');
    const data={...f.request,DeviceProfile:marked};
    if(missingAudio) delete data.AudioStreamIndex;
    if(missingSubtitle) delete data.SubtitleStreamIndex;
    const original={...f.config,data};
    const first=await f.req(original);
    const initialData=structuredClone(f.result);
    initialData.PlaySessionId='first-session';
    initialData.MediaSources[0].SupportsDirectPlay=true;
    delete initialData.MediaSources[0].TranscodingUrl;
    const initial={config:first,data:initialData};
    let count=0, secondRequest;
    f.win.ApiClient._sdk.axiosInstance.request=async config=>{
        count++;
        if(count>1) throw new Error('unexpected third PlaybackInfo request');
        // Exercise the registered interceptors as axios does; a nested request
        // must not recursively re-enter the two-stage flow.
        secondRequest=await f.req(config);
        const data=structuredClone(f.result);
        data.PlaySessionId='second-session';
        data.MediaSources[0].TranscodingUrl=data.MediaSources[0].TranscodingUrl.replace('PlaySessionId=play-1','PlaySessionId=second-session');
        return await f.res({config:secondRequest,data});
    };
    return {f,controller,first,initial,original,get count(){return count},get secondRequest(){return secondRequest}};
}

test('keeps first request unchanged, uses one verified second response and its own session',async()=>{
    const s=await setup();
    try {
        assert.equal(s.first.data.EnableDirectPlay,undefined);
        assert.equal(s.first.data.AudioStreamIndex,undefined);
        const firstSnapshot=JSON.stringify(s.initial.data);
        const result=await s.f.res(s.initial);
        assert.equal(s.count,1, 'one additional POST only');
        const sent=typeof s.secondRequest.data==='string'?JSON.parse(s.secondRequest.data):s.secondRequest.data;
        assert.equal(sent.AudioStreamIndex,2);assert.equal(sent.SubtitleStreamIndex,-1);
        assert.equal(sent.MediaSourceId,'source-1');assert.equal(sent.StartTimeTicks,s.original.data.StartTimeTicks);
        assert.equal(sent.MaxStreamingBitrate,s.original.data.MaxStreamingBitrate);
        assert.equal(sent.UserId,s.original.data.UserId);
        assert.equal(sent.EnableDirectPlay,false);assert.equal(sent.EnableDirectStream,false);
        assert.equal(sent.AllowAudioStreamCopy,true);assert.equal(sent.AllowVideoStreamCopy,true);
        assert.equal(result.data.PlaySessionId,'second-session');
        assert.equal(result.data.MediaSources[0].DeepStreamNativeAudioRequest.playSessionId,'second-session');
        assert.equal(JSON.stringify(s.initial.data),firstSnapshot,'first response is not mutated');
    } finally {s.controller.dispose()}
});

test('ambiguous first response never causes a second request',async()=>{
    const variants=[
        d=>delete d.PlaySessionId,
        d=>delete d.MediaSources[0].DefaultAudioStreamIndex,
        d=>delete d.MediaSources[0].DefaultSubtitleStreamIndex,
        d=>d.MediaSources[0].DefaultSubtitleStreamIndex=null,
        d=>d.MediaSources[0].DefaultSubtitleStreamIndex=5,
        d=>d.MediaSources[0].DefaultSecondarySubtitleStreamIndex=5,
        d=>d.MediaSources.push({...structuredClone(d.MediaSources[0]),Id:'second-source'}),
        d=>d.MediaSources[0].Id='unknown-source',
        d=>d.MediaSources[0].RequiresOpening=true,
        d=>d.MediaSources[0].LiveStreamId='synthetic-live'
    ];
    for(const mutate of variants){const s=await setup();try{
        mutate(s.initial.data);const result=await s.f.res(s.initial);
        assert.equal(result,s.initial);assert.equal(s.count,0);
    }finally{s.controller.dispose()}}
});

test('failed or unverifiable second response returns first response without a third request',async()=>{
    for(const variant of ['network','wrong-track','same-session','missing-session','unknown-source','unsupported-codec']){
        const s=await setup();try{
            let count=0;
            s.f.win.ApiClient._sdk.axiosInstance.request=async config=>{
                count++;if(count>1)throw new Error('unexpected third request');
                if(variant==='network')throw new Error('synthetic network error');
                const prepared=await s.f.req(config),data=structuredClone(s.f.result);
                data.PlaySessionId=variant==='same-session'?'first-session':'second-session';
                if(variant==='missing-session') delete data.PlaySessionId;
                data.MediaSources[0].TranscodingUrl=data.MediaSources[0].TranscodingUrl.replace('PlaySessionId=play-1','PlaySessionId=second-session');
                if(variant==='wrong-track')data.MediaSources[0].DefaultAudioStreamIndex=4;
                if(variant==='unknown-source')data.MediaSources[0].Id='unknown-source';
                if(variant==='unsupported-codec')data.MediaSources[0].TranscodingUrl=data.MediaSources[0].TranscodingUrl.replace('AudioCodec=eac3','AudioCodec=aac');
                return await s.f.res({config:prepared,data});
            };
            const result=await s.f.res(s.initial);
            assert.equal(result,s.initial,variant);assert.equal(count,1,variant);
        }finally{s.controller.dispose()}
    }
});

test('stop while second request is pending never delivers either stale response',async()=>{
    const s=await setup();try{
        let resolveSecond,calls=0;
        s.f.win.ApiClient._sdk.axiosInstance.request=()=>{calls++;return new Promise(resolve=>{resolveSecond=resolve})};
        const result=Promise.resolve().then(()=>s.f.res(s.initial));
        for(let i=0;i<8 && !resolveSecond;i++)await new Promise(resolve=>setImmediate(resolve));
        assert.equal(calls,1);sessionChanged(s.f.win);
        resolveSecond({data:structuredClone(s.f.result)});
        await assert.rejects(result,/session|changed|cancel|abort|stale/i);
    }finally{s.controller.dispose()}
});

test('stop between planning and dispatch sends no second request',async()=>{
    const s=await setup();try{
        let count=0;
        s.f.win.setTimeout=(fn,ms)=>{
            queueMicrotask(()=>sessionChanged(s.f.win));
            return setTimeout(fn,ms);
        };
        s.f.win.ApiClient._sdk.axiosInstance.request=async()=>{count++;return {data:{}}};
        await assert.rejects(Promise.resolve().then(()=>s.f.res(s.initial)),/session|changed|cancel|abort|stale/i);
        assert.equal(count,0);
    }finally{s.controller.dispose()}
});

test('original PlaybackInfo errors pass through without a second request',async()=>{
    const s=await setup();try{
        s.initial.data.ErrorCode='NoCompatibleStream';
        assert.equal(await s.f.res(s.initial),s.initial);
        assert.equal(s.count,0);
    }finally{s.controller.dispose()}
});

test('aborted ambiguous first response cannot revive a stale start',async()=>{
    const s=await setup();try{
        const abort=new AbortController();s.initial.config.signal=abort.signal;
        s.initial.data.MediaSources=[];abort.abort();
        await assert.rejects(Promise.resolve().then(()=>s.f.res(s.initial)),/session|changed|cancel|abort|stale/i);
        assert.equal(s.count,0);
    }finally{s.controller.dispose()}
});

test('second request timeout returns original response and starts no further POST',async()=>{
    const s=await setup();try{
        let count=0;
        s.f.win.ApiClient._sdk.axiosInstance.request=()=>{count++;return Promise.reject(Object.assign(new Error('timeout'),{code:'ECONNABORTED'}))};
        const result=await s.f.res(s.initial);
        assert.equal(result,s.initial);assert.equal(count,1);
    }finally{s.controller.dispose()}
});

test('a stalled second request is bounded and the late response cannot replace the first',async()=>{
    const s=await setup();try{
        let count=0,resolveSecond;
        s.f.win.setTimeout=(fn,ms)=>setTimeout(fn,Math.min(ms,25));
        s.f.win.ApiClient._sdk.axiosInstance.request=()=>{
            count++;return new Promise(resolve=>{resolveSecond=resolve});
        };
        let timeout;
        const limit=new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('second request was not bounded')),1500)});
        let result;
        try{result=await Promise.race([Promise.resolve().then(()=>s.f.res(s.initial)),limit])}
        finally{clearTimeout(timeout)}
        assert.equal(result,s.initial);assert.equal(count,1);
        resolveSecond?.({data:structuredClone(s.f.result)});
        await new Promise(resolve=>setImmediate(resolve));
        assert.equal(count,1);
    }finally{s.controller.dispose()}
});
test('unverified followup bypassing response handler cannot replace original',async()=>{
 const s=await setup();try{
  let count=0;s.f.win.ApiClient._sdk.axiosInstance.request=async config=>{
   count++;const data=structuredClone(s.f.result);data.PlaySessionId='second-session';
   data.MediaSources[0].DeepStreamNativeAudioRequest={contract:'deepstream-audio-hls-v1',itemId:'item-1',sourceId:'source-1',audioIndex:2,playSessionId:'second-session'};
   return {config,data};
  };
  const result=await s.f.res(s.initial);assert.equal(result,s.initial);assert.equal(count,1);
 }finally{s.controller.dispose()}
});

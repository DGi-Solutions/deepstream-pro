'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const {webcrypto}=require('node:crypto');
const {create,sessionChanged}=require('../native/nativeAudioNegotiation');
const profileHelper=require('../native/nativeAudioProfile');const audioHelper=require('../native/nativeAudioSession');
function fixture(){let next=1;const requestHandlers=new Map(),responseHandlers=new Map(),events=new Map();
 const reg=map=>({use(fn,fail){const i=next++;fn.rejected=fail;map.set(i,fn);return i},eject(i){map.delete(i)}});
 const axios={interceptors:{request:reg(requestHandlers),response:reg(responseHandlers)}};
 const media={Id:'source-1',Protocol:'File',IsRemote:false,RequiresOpening:false,RequiresClosing:false,IsInfiniteStream:false,SupportsTranscoding:true,Bitrate:2500000,RequiredHttpHeaders:{},MediaStreams:[{Index:0,Type:'Video',Codec:'h264',BitDepth:8,Width:1920,Height:1080,BitRate:1800000,IsInterlaced:false,IsExternal:false},{Index:2,Type:'Audio',Codec:'eac3',Channels:6,BitRate:640000,SampleRate:48000,IsExternal:false},{Index:4,Type:'Audio',Codec:'aac',Channels:2,IsExternal:false}]};
 const item={Id:'item-1',ServerId:'server-1',MediaType:'Video',Type:'Movie',MediaSources:[media]};
 const profile={Name:'DeepStream Pro',MaxStaticBitrate:1000000000,DirectPlayProfiles:[{Type:'Audio'},{Type:'Photo'},{Type:'Video'}],TranscodingProfiles:[{Type:'Audio'},{Type:'Video',Container:'ts',Protocol:'hls',VideoCodec:'h264,hevc',AudioCodec:'aac,ac3',MaxAudioChannels:'6'}],CodecProfiles:[],ContainerProfiles:[]};
 const request={UserId:'user-1',IsPlayback:true,MediaSourceId:'source-1',AudioStreamIndex:2,SubtitleStreamIndex:-1,StartTimeTicks:120000000,MaxStreamingBitrate:140000000,DeviceProfile:profile};
 const auth='MediaBrowser Token="synthetic"';const sdk={basePath:'https://server.invalid/jellyfin',authorizationHeader:auth,axiosInstance:axios};
 const win={crypto:webcrypto,setTimeout,clearTimeout,DeepStreamNativeAudioProfile:profileHelper,DeepStreamNativeAudio:audioHelper,addEventListener(n,f){events.set(n,f)},removeEventListener(n){events.delete(n)},jmpInfo:{settings:{audio:{spatialAudio:true,channels:'auto',device:'auto',devicetype:'basic',exclusive:false},video:{}}},ApiClient:{_sdk:sdk,serverId:()=> 'server-1',getCurrentUserId:()=> 'user-1',serverAddress:()=> 'https://server.invalid/jellyfin',getItem:async()=>item}};
 const config={method:'POST',url:'/Items/item-1/PlaybackInfo',baseURL:'https://server.invalid/jellyfin',headers:{'X-Emby-Authorization':auth},data:request};
 const url='https://server.invalid/jellyfin/Videos/item-1/master.m3u8?MediaSourceId=source-1&PlaySessionId=play-1&AudioStreamIndex=2&AudioCodec=eac3&VideoCodec=h264&AllowAudioStreamCopy=true&AllowVideoStreamCopy=true&SegmentContainer=mp4';
 const result={PlaySessionId:'play-1',MediaSources:[{...structuredClone(media),DefaultAudioStreamIndex:2,DefaultSubtitleStreamIndex:-1,TranscodingUrl:url}]};
 return {win,item,profile,request,config,result,requestHandlers,responseHandlers,events,
  req:c=>[...requestHandlers.values()][0](c),res:r=>[...responseHandlers.values()][0](r)};
}
async function prepare(f,controller){const marked=await controller.registerItem(f.item,undefined,Promise.resolve(f.profile));assert.notEqual(marked,f.profile);return {...f.config,data:{...f.request,DeviceProfile:marked}}}
const caps=async()=>({nativeAudioHlsAvailable:true});
test('one marked request and verified response produce only a minimal source marker',async()=>{const f=fixture(),c=create(f.win,caps);try{const original=JSON.stringify(f.config),req=await prepare(f,c);const prepared=await f.req(req);assert.notEqual(prepared,req);assert.equal(prepared.headers,req.headers);assert.equal(JSON.stringify(f.config),original);assert.equal(prepared.data.EnableDirectPlay,false);assert.equal(prepared.data.AllowVideoStreamCopy,true);const raw=structuredClone(f.result),r=await f.res({config:prepared,data:raw});assert.deepEqual(r.data.MediaSources[0].DeepStreamNativeAudioRequest,{contract:'deepstream-audio-hls-v1',itemId:'item-1',sourceId:'source-1',audioIndex:2,playSessionId:'play-1'});assert.equal(raw.MediaSources[0].DeepStreamNativeAudioRequest,undefined);assert.equal(await f.req(req),req,'nonce consumed once');assert.equal(JSON.stringify(r.data.MediaSources[0].DeepStreamNativeAudioRequest).includes('http'),false)}finally{c.dispose()}});
test('mismatched, missing, duplicate or overriding auth leaves request unchanged',async()=>{for(const headers of [{Authorization:'different'},{},{Authorization:'MediaBrowser Token="synthetic"','X-Emby-Authorization':'MediaBrowser Token="synthetic"'},{authorization:['MediaBrowser Token="synthetic"']},{'X-Emby-Authorization':'MediaBrowser Token="synthetic"','X-Emby-Token':'different'}]){const f=fixture(),c=create(f.win,caps);try{const req=await prepare(f,c),bad={...req,headers};assert.equal(await f.req(bad),bad);assert.notEqual(await f.req(req),req)}finally{c.dispose()}}const f=fixture(),c=create(f.win,caps);try{const req=await prepare(f,c),bad={...req,auth:{username:'x',password:'y'}};assert.equal(await f.req(bad),bad)}finally{c.dispose()}});
test('wrong item, changed marked profile, wrong user and unrelated endpoints are untouched',async()=>{const f=fixture(),c=create(f.win,caps);try{const req=await prepare(f,c);for(const bad of [{...req,url:'/Items/other/PlaybackInfo'},{...req,url:'https://foreign.invalid/jellyfin/Items/item-1/PlaybackInfo'},{...req,method:'GET'},{...req,params:{x:1}},{...req,data:{...req.data,UserId:'other'}},{...req,data:{...req.data,DeviceProfile:{...req.data.DeviceProfile,MaxStaticBitrate:1}}}])assert.equal(await f.req(bad),bad);assert.notEqual(await f.req(req),req)}finally{c.dispose()}});
test('uncertain or transcoded response rejects before playback',async()=>{const changes=[r=>delete r.PlaySessionId,r=>r.MediaSources[0].DefaultAudioStreamIndex=4,r=>r.MediaSources[0].DefaultSubtitleStreamIndex=3,r=>r.MediaSources[0].TranscodeReasons=['VideoCodecNotSupported'],r=>r.MediaSources[0].TranscodingUrl=r.MediaSources[0].TranscodingUrl.replace('AllowVideoStreamCopy=true','AllowVideoStreamCopy=false'),r=>r.MediaSources[0].TranscodingUrl+='&MaxWidth=640',r=>r.MediaSources[0].TranscodingUrl+='&Width=640',r=>r.MediaSources[0].TranscodingUrl+='&VideoProfile=main',r=>r.MediaSources[0].TranscodingUrl=r.MediaSources[0].TranscodingUrl.replace('SegmentContainer=mp4','SegmentContainer=ts'),r=>r.TranscodingInfo={IsAudioDirect:false,IsVideoDirect:true},r=>r.MediaSources[0].TranscodingUrl+='&VideoBitrate=1000',r=>r.MediaSources[0].TranscodingUrl+='&AudioBitrate=64000',r=>r.MediaSources[0].TranscodingUrl=r.MediaSources[0].TranscodingUrl.replace('VideoCodec=h264','VideoCodec=hevc')];for(const mutate of changes){const f=fixture(),c=create(f.win,caps);try{const req=await prepare(f,c),sent=await f.req(req),data=structuredClone(f.result);mutate(data);assert.throws(()=>f.res({config:sent,data}),/could not be verified/)}finally{c.dispose()}}});
test('stop or session change during request and response cannot deliver marked stale media',async()=>{const f=fixture(),c=create(f.win,caps);try{const req=await prepare(f,c),sent=await f.req(req);sessionChanged(f.win);assert.equal(f.requestHandlers.size,0);assert.equal(f.responseHandlers.size,0);await c.registerItem(f.item,undefined,Promise.resolve(f.profile));const next=[...f.responseHandlers.values()][0];assert.throws(()=>next({config:sent,data:f.result}),/session changed/)}finally{c.dispose()}});
test('retry invalidates old nonce; missing crypto returns original profile',async()=>{let f=fixture(),c=create(f.win,caps);try{const req=await prepare(f,c);assert.equal(await c.registerItem(f.item,{isRetry:true},Promise.resolve(f.profile)),f.profile);assert.equal(await f.req(req),req)}finally{c.dispose()}f=fixture();delete f.win.crypto;c=create(f.win,caps);try{assert.equal(await c.registerItem(f.item,undefined,Promise.resolve(f.profile)),f.profile)}finally{c.dispose()}});
test('simultaneous requests have distinct nonces; same-item registration supersedes older ticket',async()=>{const f=fixture(),c=create(f.win,caps);try{const other={...f.item,Id:'item-2'};const [a,b]=await Promise.all([c.registerItem(f.item,null,Promise.resolve(f.profile)),c.registerItem(other,null,Promise.resolve(f.profile))]);assert.notEqual(a.Name,b.Name);const req={...f.config,data:{...f.request,DeviceProfile:a}};assert.notEqual(await f.req(req),req);const req2={...f.config,url:'/Items/item-2/PlaybackInfo',data:{...f.request,DeviceProfile:b}};assert.notEqual(await f.req(req2),req2);let resolve;const pending=c.registerItem(f.item,null,new Promise(r=>resolve=r));const latest=await c.registerItem(f.item,null,Promise.resolve(f.profile));resolve(f.profile);assert.equal(await pending,f.profile);assert.notEqual(latest,f.profile)}finally{c.dispose()}});
test('epoch change while capabilities resolve returns untouched original request',async()=>{const f=fixture();let deferred,blocking=false;const c=create(f.win,()=>blocking?new Promise(r=>{deferred=r}):caps());try{const req=await prepare(f,c);blocking=true;const p=f.req(req);sessionChanged(f.win);deferred({nativeAudioHlsAvailable:true});assert.equal(await p,req)}finally{c.dispose()}});
test('JSON request and AxiosHeaders-like objects work without mutating headers',async()=>{const f=fixture(),c=create(f.win,caps);try{const req=await prepare(f,c);const h={toJSON:()=>({'X-Emby-Authorization':'MediaBrowser Token="synthetic"'})};const input={...req,headers:h,data:JSON.stringify(req.data)};const sent=await f.req(input);assert.equal(sent.headers,h);assert.equal(typeof sent.data,'string');assert.equal(JSON.parse(sent.data).EnableDirectPlay,false)}finally{c.dispose()}});
test('at most eight pending registrations can survive and disabled routes retain original',async()=>{const f=fixture();let release;const blocked=new Promise(r=>{release=r});const c=create(f.win,()=>blocked);try{const jobs=[];for(let i=0;i<9;i++)jobs.push(c.registerItem({...f.item,Id:'other-'+i},null,Promise.resolve(f.profile)));await new Promise(r=>setImmediate(r));release({nativeAudioHlsAvailable:true});const out=await Promise.all(jobs);assert.equal(out[0],f.profile);assert.equal(out.filter(p=>p!==f.profile).length,8);f.win.jmpInfo.settings.audio.device='manual';assert.equal(await c.registerItem(f.item,null,Promise.resolve(f.profile)),f.profile)}finally{c.dispose()}});
test('SDK without response interceptor never alters a request',async()=>{const f=fixture();delete f.win.ApiClient._sdk.axiosInstance.interceptors.response;const c=create(f.win,caps);try{assert.equal(await c.registerItem(f.item,null,Promise.resolve(f.profile)),f.profile);assert.equal(f.requestHandlers.size,0)}finally{c.dispose()}});
test('a newer request for the same item invalidates an older in-flight response',async()=>{const f=fixture(),c=create(f.win,caps);try{const oldReq=await prepare(f,c),sent=await f.req(oldReq);const newer=await prepare(f,c);assert.throws(()=>f.res({config:sent,data:f.result}),/session changed/);assert.notEqual(await f.req(newer),newer)}finally{c.dispose()}});
test('a newer registration during capability lookup prevents stale mutation',async()=>{const f=fixture();let deferred,slow=false;const c=create(f.win,()=>slow?new Promise(r=>{deferred=r}):caps());try{const oldReq=await prepare(f,c);slow=true;const old=f.req(oldReq);slow=false;await prepare(f,c);deferred({nativeAudioHlsAvailable:true});assert.equal(await old,oldReq)}finally{c.dispose()}});
test('response config cloned without private symbol is correlated by one-shot profile name',async()=>{const f=fixture(),c=create(f.win,caps);try{const req=await prepare(f,c),sent=await f.req(req),cloned={...sent};const out=f.res({config:cloned,data:f.result});assert.equal(out.data.MediaSources[0].DeepStreamNativeAudioRequest.itemId,'item-1')}finally{c.dispose()}});
test('cleared session rejects late response even if private symbol was stripped',async()=>{const f=fixture(),c=create(f.win,caps);try{const req=await prepare(f,c),sent=await f.req(req),cloned={...sent},handler=[...f.responseHandlers.values()][0];sessionChanged(f.win);assert.throws(()=>handler({config:cloned,data:f.result}),/session changed/)}finally{c.dispose()}});
test('ambiguous response config for same item fails closed',async()=>{const f=fixture(),c=create(f.win,caps);try{const req=await prepare(f,c);await f.req(req);assert.throws(()=>f.res({config:{...f.config,data:{}},data:f.result}),/could not be verified/)}finally{c.dispose()}});
test('ineligible selection remains an untouched request and response',async()=>{const f=fixture(),c=create(f.win,caps);try{const req=await prepare(f,c),bad={...req,data:{...req.data,SubtitleStreamIndex:3}};assert.equal(await f.req(bad),bad);const response={config:bad,data:f.result};assert.equal(f.res(response),response)}finally{c.dispose()}});
test('parallel unmodified reuse of a marker cannot claim a modified response',async()=>{const f=fixture(),c=create(f.win,caps);try{const req=await prepare(f,c),sent=await f.req(req);assert.equal(await f.req(req),req);const unrelated={config:{...req},data:f.result};assert.equal(f.res(unrelated),unrelated);const delivered=f.res({config:{...sent},data:f.result});assert.equal(delivered.data.MediaSources[0].DeepStreamNativeAudioRequest.itemId,'item-1')}finally{c.dispose()}});
test('a response with altered actual auth cannot claim the protected result',async()=>{const f=fixture(),c=create(f.win,caps);try{const req=await prepare(f,c),sent=await f.req(req),bad={...sent,headers:{Authorization:'different'}};assert.throws(()=>f.res({config:bad,data:f.result}),/could not be verified/)}finally{c.dispose()}});

test('a failed HTTP request releases its correlation and cannot later deliver',async()=>{const f=fixture(),c=create(f.win,caps);try{const req=await prepare(f,c),sent=await f.req(req);const handler=[...f.responseHandlers.values()][0];await assert.rejects(handler.rejected({config:sent}));assert.throws(()=>handler({config:sent,data:f.result}),/session changed/)}finally{c.dispose()}});
test('omitted server default copy flags are appended without rewriting original URL bytes',async()=>{for(const removed of [['AllowAudioStreamCopy=true'],['AllowVideoStreamCopy=true'],['AllowAudioStreamCopy=true','AllowVideoStreamCopy=true']]){const f=fixture(),c=create(f.win,caps);try{const req=await prepare(f,c),sent=await f.req(req),data=structuredClone(f.result);let raw=data.MediaSources[0].TranscodingUrl;for(const flag of removed)raw=raw.replace('&'+flag,'');raw+='&ApiKey=synthetic%2Bvalue%2F%3D';data.MediaSources[0].TranscodingUrl=raw;const out=f.res({config:sent,data});const result=out.data.MediaSources[0].TranscodingUrl;assert.equal(result.startsWith(raw),true);assert.match(result,/AllowAudioStreamCopy=true/);assert.match(result,/AllowVideoStreamCopy=true/);assert.equal(data.MediaSources[0].TranscodingUrl,raw)}finally{c.dispose()}}});
test('explicit false, conflicting duplicates or empty copy values reject before playback',async()=>{for(const query of ['&AllowAudioStreamCopy=false','&AllowVideoStreamCopy=false','&allowaudiostreamcopy=true','&allowvideostreamcopy=true','&AllowAudioStreamCopy=','&AllowVideoStreamCopy=']){const f=fixture(),c=create(f.win,caps);try{const req=await prepare(f,c),sent=await f.req(req),data=structuredClone(f.result);data.MediaSources[0].TranscodingUrl+=query;assert.throws(()=>f.res({config:sent,data}),/could not be verified/)}finally{c.dispose()}}});
test('single explicit false copy flag never gets changed into true',async()=>{for(const flag of ['AllowAudioStreamCopy','AllowVideoStreamCopy']){const f=fixture(),c=create(f.win,caps);try{const req=await prepare(f,c),sent=await f.req(req),data=structuredClone(f.result);data.MediaSources[0].TranscodingUrl=data.MediaSources[0].TranscodingUrl.replace(flag+'=true',flag+'=false');assert.throws(()=>f.res({config:sent,data}),/could not be verified/)}finally{c.dispose()}}});

test('URL transcode reasons reject any video or audio conversion reason',async()=>{
 for(const reason of ['VideoCodecNotSupported','VideoBitrateNotSupported','ContainerNotSupported,AudioCodecNotSupported','2','']){
  const f=fixture(),c=create(f.win,caps);try{const req=await prepare(f,c),sent=await f.req(req),data=structuredClone(f.result);
   data.MediaSources[0].TranscodingUrl+='&TranscodeReasons='+encodeURIComponent(reason);
   assert.throws(()=>f.res({config:sent,data}),/could not be verified/);
  }finally{c.dispose()}}
 for(const reason of ['0','ContainerNotSupported']){
  const f=fixture(),c=create(f.win,caps);try{const req=await prepare(f,c),sent=await f.req(req),data=structuredClone(f.result);
   data.MediaSources[0].TranscodingUrl+='&TranscodeReasons='+encodeURIComponent(reason);
   const out=f.res({config:sent,data});assert.ok(out.data.MediaSources[0].DeepStreamNativeAudioRequest);
  }finally{c.dispose()}}
});

test('video path admits same canonical UUID only and keeps origin and prefix checks',()=>{const f=fixture(),id='1234567890abcdef1234567890abcdef';f.item.Id=id;const source=structuredClone(f.result.MediaSources[0]);const current={serverId:'server-1',serverBaseUrl:'https://server.invalid/jellyfin'};const opt={item:f.item,mediaSource:source,url:'https://server.invalid/jellyfin/Videos/12345678-90ab-cdef-1234-567890abcdef/master.m3u8?MediaSourceId=source-1&PlaySessionId=play-1&AudioStreamIndex=2&AudioCodec=eac3&AllowAudioStreamCopy=true',playMethod:'Transcode',playSessionId:'play-1'};assert.ok(audioHelper.hlsSelection(opt,current));for(const url of [opt.url.replace('12345678-90ab','12345679-90ab'),opt.url.replace('server.invalid','other.invalid'),opt.url.replace('/jellyfin/','/other/'),opt.url.replace('12345678-90ab','1234567-890ab')])assert.equal(audioHelper.hlsSelection({...opt,url},current),null)});

test('unverified HLS negotiates the original request once and keeps selection and resume',async()=>{const f=fixture(),c=create(f.win,caps);try{const req=await prepare(f,c);req.headers['Accept-Language']='de';const sent=await f.req(req);let retried,number=0;f.win.ApiClient._sdk.axiosInstance.request=async x=>{number++;retried=x;const data=structuredClone(f.result);data.PlaySessionId='retry-2';data.MediaSources[0].SupportsDirectPlay=true;return {config:x,data}};const raw=structuredClone(f.result);raw.MediaSources[0].TranscodingUrl+='&MaxFramerate=24';sent.headers={...sent.headers,'Content-Length':'999'};const out=await f.res({config:sent,data:raw});assert.equal(number,1);assert.equal(out.data.PlaySessionId,'retry-2');assert.equal(out.data.MediaSources[0].DeepStreamNativeAudioRequest,undefined);for(const k of ['UserId','StartTimeTicks','AudioStreamIndex','SubtitleStreamIndex','MediaSourceId','MaxStreamingBitrate','IsPlayback'])assert.equal(retried.data[k],req.data[k]);assert.equal(retried.headers['Accept-Language'],'de');assert.equal(Object.keys(retried.headers).some(x=>x.toLowerCase()==='content-length'),false);assert.notEqual(retried.data.EnableDirectPlay,false);assert.notEqual(retried.data.EnableDirectStream,false)}finally{c.dispose()}});
test('session change before fallback request cancels retry',async()=>{const f=fixture(),c=create(f.win,caps);try{const req=await prepare(f,c),sent=await f.req(req);let count=0;f.win.ApiClient._sdk.axiosInstance.request=async()=>{count++;return {}};const raw=structuredClone(f.result);raw.MediaSources[0].TranscodingUrl+='&MaxFramerate=24';const result=f.res({config:sent,data:raw});sessionChanged(f.win);await assert.rejects(result,/session changed/);assert.equal(count,0)}finally{c.dispose()}});
test('session change while fallback request is pending rejects stale result',async()=>{const f=fixture(),c=create(f.win,caps);try{const req=await prepare(f,c),sent=await f.req(req);let resolve;f.win.ApiClient._sdk.axiosInstance.request=()=>new Promise(r=>{resolve=r});const raw=structuredClone(f.result);raw.MediaSources[0].TranscodingUrl+='&MaxFramerate=24';const result=f.res({config:sent,data:raw});await Promise.resolve();sessionChanged(f.win);resolve({data:structuredClone(f.result)});await assert.rejects(result,/session changed/)}finally{c.dispose()}});
test('fallback refuses changed audio or subtitle selection',async()=>{for(const k of ['DefaultAudioStreamIndex','DefaultSubtitleStreamIndex']){const f=fixture(),c=create(f.win,caps);try{const req=await prepare(f,c),sent=await f.req(req);f.win.ApiClient._sdk.axiosInstance.request=async()=>{const data=structuredClone(f.result);data.MediaSources[0][k]=99;return {data}};const raw=structuredClone(f.result);raw.MediaSources[0].TranscodingUrl+='&MaxFramerate=24';await assert.rejects(f.res({config:sent,data:raw}),/selection could not be verified/)}finally{c.dispose()}}});
test('fallback network failure is propagated without repeated retry',async()=>{const f=fixture(),c=create(f.win,caps);try{const req=await prepare(f,c),sent=await f.req(req);let count=0;f.win.ApiClient._sdk.axiosInstance.request=async()=>{count++;throw new Error('synthetic failure')};const raw=structuredClone(f.result);raw.MediaSources[0].TranscodingUrl+='&MaxFramerate=24';await assert.rejects(f.res({config:sent,data:raw}),/synthetic failure/);assert.equal(count,1)}finally{c.dispose()}});

test('aborted playback never starts a fallback and pending fallback is discarded',async()=>{for(const early of [true,false]){const f=fixture(),c=create(f.win,caps);try{const req=await prepare(f,c),sent=await f.req(req),abort=new AbortController();sent.signal=abort.signal;let resolve,count=0;f.win.ApiClient._sdk.axiosInstance.request=()=>{count++;return new Promise(r=>{resolve=r})};const raw=structuredClone(f.result);raw.MediaSources[0].TranscodingUrl+='&MaxFramerate=24';if(early){abort.abort();assert.throws(()=>f.res({config:sent,data:raw}),/could not be verified/);assert.equal(count,0)}else{const result=f.res({config:sent,data:raw});await Promise.resolve();assert.equal(count,1);abort.abort();resolve({data:structuredClone(f.result)});await assert.rejects(result,/session changed/)}}finally{c.dispose()}}});
test('DV response is bound to the exact server-advertised HEVC range and selected copy streams',async()=>{
 for(const [range,profile,wire] of [['DOVI',5,'DOVI'],['DOVIWithHDR10',8,'DOVI,DOVIWithHDR10,HDR10'],['DOVIWithHLG',8,'DOVI,DOVIWithHLG,HLG']]){
  const f=fixture();const v=f.item.MediaSources[0].MediaStreams[0];Object.assign(v,{Codec:'hevc',BitDepth:10,VideoRangeType:range,DvProfile:profile,DvLevel:6,RpuPresentFlag:1,BlPresentFlag:1,ElPresentFlag:0});
  const c=create(f.win,async()=>({nativeAudioHlsAvailable:true,nativeDolbyVisionHlsAvailable:true}));
  try{const req=await prepare(f,c),sent=await f.req(req),data=structuredClone(f.result);Object.assign(data.MediaSources[0].MediaStreams[0],v);
   data.MediaSources[0].TranscodingUrl=data.MediaSources[0].TranscodingUrl.replace('VideoCodec=h264','VideoCodec=hevc')+'&hevc-rangetype='+wire;
   const out=f.res({config:sent,data});assert.equal(out.data.MediaSources[0].DeepStreamNativeAudioRequest.audioIndex,2);
   assert.match(out.data.MediaSources[0].TranscodingUrl,/hevc-rangetype=/);
  }finally{c.dispose()}
 }
});
test('missing or widened Dolby Vision range cannot be sent to the native backend',async()=>{
 for(const query of ['', '&hevc-rangetype=HDR10','&hevc-rangetype=DOVI,HDR10','&hevc-rangetype=DOVI&VideoRangeType=HDR10']){
  const f=fixture();Object.assign(f.item.MediaSources[0].MediaStreams[0],{Codec:'hevc',BitDepth:10,VideoRangeType:'DOVI',DvProfile:5,DvLevel:6,RpuPresentFlag:1,BlPresentFlag:1,ElPresentFlag:0});
  const c=create(f.win,async()=>({nativeAudioHlsAvailable:true,nativeDolbyVisionHlsAvailable:true}));
  try{const req=await prepare(f,c),sent=await f.req(req),data=structuredClone(f.result);data.MediaSources[0].TranscodingUrl=data.MediaSources[0].TranscodingUrl.replace('VideoCodec=h264','VideoCodec=hevc')+query;assert.throws(()=>f.res({config:sent,data}),/could not be verified/)}finally{c.dispose()}
 }
});
test('DV max frame rate requires a proven copy path even when reported rates agree',async()=>{
 for(const variant of ['match','lower','different-real','different-response','missing','both-framerate']){
  const f=fixture();const v=f.item.MediaSources[0].MediaStreams[0];Object.assign(v,{Codec:'hevc',BitDepth:10,VideoRangeType:'DOVI',DvProfile:5,DvLevel:6,RpuPresentFlag:1,BlPresentFlag:1,ElPresentFlag:0,AverageFrameRate:24,RealFrameRate:24});
  const c=create(f.win,async()=>({nativeAudioHlsAvailable:true,nativeDolbyVisionHlsAvailable:true}));
  try{const req=await prepare(f,c),sent=await f.req(req),data=structuredClone(f.result);Object.assign(data.MediaSources[0].MediaStreams[0],v);
   if(variant==='different-real')v.RealFrameRate=25;
   if(variant==='different-response')data.MediaSources[0].MediaStreams[0].AverageFrameRate=25;
   if(variant==='missing')delete data.MediaSources[0].MediaStreams[0].RealFrameRate;
   const extra=variant==='both-framerate'?'&Framerate=24':'';
   data.MediaSources[0].TranscodingUrl=data.MediaSources[0].TranscodingUrl.replace('VideoCodec=h264','VideoCodec=hevc')+'&hevc-rangetype=DOVI&MaxFramerate='+(variant==='lower'?'23':'24')+extra;
   assert.throws(()=>f.res({config:sent,data}),/could not be verified/);
  }finally{c.dispose()}
 }
});
test('DV AAC LC stereo uses its own selected-track and session contract',async()=>{
 const f=fixture();Object.assign(f.item.MediaSources[0].MediaStreams[0],{Codec:'hevc',BitDepth:10,VideoRangeType:'DOVI',DvProfile:5,DvLevel:6,RpuPresentFlag:1,BlPresentFlag:1,ElPresentFlag:0});
 Object.assign(f.item.MediaSources[0].MediaStreams[1],{Codec:'aac',Profile:'LC',Channels:2});f.win.jmpInfo.settings.audio.spatialAudio=false;
 const c=create(f.win,async()=>({nativeAudioHlsAvailable:false,nativeDolbyVisionHlsAvailable:true}));
 try{const req=await prepare(f,c),sent=await f.req(req),data=structuredClone(f.result);data.MediaSources[0].MediaStreams=structuredClone(f.item.MediaSources[0].MediaStreams);
  data.MediaSources[0].TranscodingUrl=data.MediaSources[0].TranscodingUrl.replace('VideoCodec=h264','VideoCodec=hevc').replace('AudioCodec=eac3','AudioCodec=aac')+'&hevc-rangetype=DOVI';
  const out=f.res({config:sent,data}),marker=out.data.MediaSources[0].DeepStreamNativeAudioRequest;
  assert.equal(marker.contract,'deepstream-video-hls-v1');assert.equal(marker.audioIndex,2);assert.equal(sent.data.SubtitleStreamIndex,-1);
  const current={serverId:'server-1',serverBaseUrl:'https://server.invalid/jellyfin'};
  const opt={item:f.item,mediaSource:out.data.MediaSources[0],url:out.data.MediaSources[0].TranscodingUrl,playMethod:'Transcode',playSessionId:'play-1'};
  const selection=audioHelper.hlsSelection(opt,current,marker.contract);assert.equal(selection.codec,'aac');assert.equal(selection.channels,2);
  assert.equal(audioHelper.hlsSelection(opt,current),null,'AAC cannot enter the EAC3 contract');
  for(const mutate of [s=>s.Channels=6,s=>s.Profile='HE-AAC',s=>s.Index=99]){
   const copy=structuredClone(opt);mutate(copy.mediaSource.MediaStreams.find(s=>s.Index===2));assert.equal(audioHelper.hlsSelection(copy,current,marker.contract),null);
  }
 }finally{c.dispose()}
});

test('DV EAC3 selected copy remains bound to the video contract without Spatial',async()=>{
 const f=fixture();const v=f.item.MediaSources[0].MediaStreams[0];Object.assign(v,{Codec:'hevc',BitDepth:10,VideoRangeType:'DOVIWithHDR10',DvProfile:8,DvLevel:6,RpuPresentFlag:1,BlPresentFlag:1,ElPresentFlag:0});f.win.jmpInfo.settings.audio.spatialAudio=false;
 const c=create(f.win,async()=>({nativeAudioHlsAvailable:false,nativeDolbyVisionHlsAvailable:true}));
 try{const req=await prepare(f,c),sent=await f.req(req),data=structuredClone(f.result);Object.assign(data.MediaSources[0].MediaStreams[0],v);data.MediaSources[0].TranscodingUrl=data.MediaSources[0].TranscodingUrl.replace('VideoCodec=h264','VideoCodec=hevc')+'&hevc-rangetype=DOVI,DOVIWithHDR10,HDR10';
  const out=f.res({config:sent,data}),marker=out.data.MediaSources[0].DeepStreamNativeAudioRequest;assert.equal(marker.contract,'deepstream-video-hls-v1');assert.equal(marker.audioIndex,2);assert.equal(sent.data.AllowAudioStreamCopy,true);assert.equal(sent.data.AllowVideoStreamCopy,true);assert.equal(sent.data.SubtitleStreamIndex,-1);
 }finally{c.dispose()}
});


test('missing audio settings return the unmarked original profile',async()=>{
 for(const settings of [undefined,null,{}, {audio:undefined}, {audio:null}]) {
  const f=fixture();f.win.jmpInfo.settings=settings;
  const c=create(f.win,async()=>({nativeDolbyVisionHlsAvailable:true}));
  try {assert.equal(await c.registerItem(f.item,undefined,Promise.resolve(f.profile)),f.profile);
       assert.equal(f.requestHandlers.size,0);assert.equal(f.responseHandlers.size,0);}
  finally {c.dispose();}
 }
});


test('active secondary subtitle keeps original negotiation and selection',async()=>{
 for(const secondary of [undefined,null,-1,3]){
  const f=fixture(),c=create(f.win,caps);
  try {const req=await prepare(f,c);req.data.SecondarySubtitleStreamIndex=secondary;
       const sent=await f.req(req);
       assert.equal(sent.data.SecondarySubtitleStreamIndex,secondary);
       assert.equal(sent.data.EnableDirectPlay===false,secondary!==3);
       if(secondary===3)assert.equal(sent,req);
  }finally{c.dispose();}
 }
});


test('delivery with an active secondary subtitle is never marked verified',async()=>{
 for(const secondary of [undefined,null,-1,3]){
  const f=fixture(),c=create(f.win,caps);
  try {const req=await prepare(f,c),sent=await f.req(req),data=structuredClone(f.result);
       data.MediaSources[0].DefaultSecondarySubtitleStreamIndex=secondary;
       if(secondary===3) assert.throws(()=>f.res({config:sent,data}),/could not be verified/);
       else assert.ok(f.res({config:sent,data}).data.MediaSources[0].DeepStreamNativeAudioRequest);
  }finally{c.dispose();}
 }
});

test('DV HLS v2 response keeps exact source codecs, selection, session and copy contract',async()=>{
 const f=fixture();Object.assign(f.item.MediaSources[0].MediaStreams[0],{Codec:'hevc',BitDepth:10,VideoRangeType:'DOVI',DvProfile:5,DvLevel:6,RpuPresentFlag:1,BlPresentFlag:1,ElPresentFlag:0});
 Object.assign(f.item.MediaSources[0].MediaStreams[1],{Codec:'flac',Channels:8,Profile:undefined});f.win.jmpInfo.settings.audio.spatialAudio=false;
 const c=create(f.win,async()=>({nativeDolbyVisionHlsAvailable:true,nativeDolbyVisionAudioHlsV2:{available:true,codecs:['flac']}}));
 try{const req=await prepare(f,c),sent=await f.req(req);
  assert.equal(sent.data.DeviceProfile.TranscodingProfiles[1].AudioCodec,'flac');
  assert.equal(sent.data.DeviceProfile.TranscodingProfiles[1].VideoCodec,'hevc');
  const data=structuredClone(f.result);data.MediaSources[0].MediaStreams=structuredClone(f.item.MediaSources[0].MediaStreams);
  data.MediaSources[0].TranscodingUrl=data.MediaSources[0].TranscodingUrl.replace('VideoCodec=h264','VideoCodec=hevc').replace('AudioCodec=eac3','AudioCodec=flac')+'&hevc-rangetype=DOVI';
  const out=f.res({config:sent,data}),marker=out.data.MediaSources[0].DeepStreamNativeAudioRequest;
  assert.deepEqual(marker,{contract:'deepstream-video-hls-v2',itemId:'item-1',sourceId:'source-1',audioIndex:2,playSessionId:'play-1'});
  assert.equal(sent.data.AllowVideoStreamCopy,true);assert.equal(sent.data.AllowAudioStreamCopy,true);
  const current={serverId:'server-1',serverBaseUrl:'https://server.invalid/jellyfin'};
  const opt={item:f.item,mediaSource:out.data.MediaSources[0],url:out.data.MediaSources[0].TranscodingUrl,playMethod:'Transcode',playSessionId:'play-1'};
  const selection=audioHelper.hlsSelection(opt,current,marker.contract);assert.equal(selection.codec,'flac');assert.equal(selection.channels,8);
 }finally{c.dispose()}
});

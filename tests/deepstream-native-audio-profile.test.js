'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {plan} = require('../native/nativeAudioProfile');
function fixture() {
 const profile={Name:'Synthetic',MaxStaticBitrate:50000000,DirectPlayProfiles:[{Type:'Audio'},{Type:'Photo'},{Type:'Video'}],
  TranscodingProfiles:[{Type:'Audio'},{Type:'Video',Container:'ts',Protocol:'hls',VideoCodec:'h264,hevc',AudioCodec:'aac',MaxAudioChannels:'6'},{Type:'Photo',Container:'jpeg'}],CodecProfiles:[],ContainerProfiles:[],SubtitleProfiles:[{Format:'srt',Method:'External'}]};
 const item={Id:'item1',MediaType:'Video',Type:'Movie',MediaSources:[{Id:'source1',Protocol:'File',IsRemote:false,RequiresOpening:false,RequiresClosing:false,IsInfiniteStream:false,SupportsTranscoding:true,Bitrate:20000000,MediaStreams:[
  {Index:0,Type:'Video',Codec:'hevc',BitDepth:10,IsInterlaced:false,IsExternal:false},
  {Index:1,Type:'Audio',Codec:'eac3',Channels:8,Language:'deu',IsExternal:false},
  {Index:2,Type:'Audio',Codec:'truehd',Channels:8,Language:'eng',IsExternal:false},
  {Index:3,Type:'Subtitle',Codec:'pgs',IsExternal:false}]}]};
 const request={UserId:'user1',MediaSourceId:'source1',IsPlayback:true,AudioStreamIndex:1,SubtitleStreamIndex:-1,MaxStreamingBitrate:25000000,MaxAudioChannels:8,StartTimeTicks:10000000,DeviceProfile:profile};
 return {profile,item,request,capabilities:{nativeAudioHlsAvailable:true},settings:{audio:{spatialAudio:true,devicetype:'basic',device:'auto',channels:'auto',exclusive:false},video:{}}};
}
function unchanged(x){const p=x.profile,r=x.request;const o=plan(x);assert.equal(o.applied,false);assert.equal(o.profile,p);assert.equal(o.request,r);}
test('no explicit actual request leaves original profile',()=>{const x=fixture();delete x.request;unchanged(x)});
test('selected EAC3 with subtitles off changes only cloned playback request and profile',()=>{const x=fixture(),before=JSON.stringify(x);const o=plan(x);assert.equal(o.applied,true);assert.equal(o.reason,'candidate_requires_delivery_verification');assert.equal(JSON.stringify(x),before);assert.notEqual(o.request,x.request);assert.notEqual(o.profile,x.profile);assert.equal(o.request.DeviceProfile,o.profile);for(const k of ['UserId','MediaSourceId','AudioStreamIndex','SubtitleStreamIndex','MaxStreamingBitrate','MaxAudioChannels','StartTimeTicks'])assert.deepEqual(o.request[k],x.request[k]);assert.equal(o.request.EnableDirectPlay,false);assert.equal(o.request.EnableDirectStream,false);assert.equal(o.request.AllowVideoStreamCopy,true);assert.equal(o.request.AllowAudioStreamCopy,true);assert.deepEqual(o.profile.DirectPlayProfiles,[{Type:'Audio'},{Type:'Photo'}]);assert.equal(o.profile.TranscodingProfiles[1].VideoCodec,'hevc');assert.equal(o.profile.TranscodingProfiles[1].AudioCodec,'eac3');assert.equal(o.profile.TranscodingProfiles[1].Container,'mp4');assert.equal(o.profile.TranscodingProfiles[1].MaxAudioChannels,undefined)});
test('source and exact track selection stay authoritative with other versions and languages',()=>{const x=fixture();const other=structuredClone(x.item.MediaSources[0]);other.Id='other';other.MediaStreams[0].Codec='av1';other.MediaStreams[1].Codec='aac';x.item.MediaSources.push(other);assert.equal(plan(x).applied,true);x.request.AudioStreamIndex=2;unchanged(x);x.request.AudioStreamIndex=1;x.request.MediaSourceId='other';unchanged(x);delete x.request.MediaSourceId;unchanged(x);x.item.MediaSources.pop();assert.equal(plan(x).applied,true)});
test('subtitle choice, source identity, flags and unsafe limits leave original',()=>{const changes=[
 x=>x.request.SubtitleStreamIndex=3,x=>delete x.request.SubtitleStreamIndex,x=>delete x.request.AudioStreamIndex,
 x=>x.request.MediaSourceId='source with spaces',x=>x.request.MediaSourceId='other',x=>x.item.MediaSources[0].Id='invalid id',
 x=>x.request.IsPlayback=false,x=>x.options={isRetry:true},x=>x.request.EnableDirectPlay=false,x=>x.request.EnableDirectStream=false,
 x=>x.request.EnableTranscoding=false,x=>x.request.AllowVideoStreamCopy=false,x=>x.request.AllowAudioStreamCopy=false,
 x=>x.request.MaxStreamingBitrate=19999999,x=>delete x.request.MaxStreamingBitrate,x=>x.profile.MaxStaticBitrate=19999999,
 x=>delete x.profile.MaxStaticBitrate,x=>delete x.item.MediaSources[0].Bitrate,x=>x.request.MaxAudioChannels=6,
 x=>x.item.MediaSources[0].RequiresClosing=true,x=>delete x.item.MediaSources[0].RequiresClosing,x=>x.item.MediaSources[0].IsInfiniteStream=true,
 x=>x.item.MediaSources[0].Protocol='Http',x=>x.item.MediaSources[0].MediaStreams[1].IsExternal=true,
 x=>x.item.MediaSources[0].MediaStreams[0].BitDepth=12,x=>x.item.MediaSources[0].MediaStreams[0].IsInterlaced=true,
 x=>x.item.MediaSources[0].MediaStreams.push({Index:4,Type:'Video',Codec:'h264',BitDepth:8,IsExternal:false,IsInterlaced:false})
 ];for(const mutate of changes){const x=fixture();mutate(x);unchanged(x)}});
test('all codec and container conditions, manual outputs, and unknown video constraints reject',()=>{const changes=[
 x=>x.profile.CodecProfiles.push({Type:'VideoAudio',Conditions:[]}),x=>x.profile.CodecProfiles.push({Type:'Audio'}),
 x=>x.profile.ContainerProfiles.push({Type:'Video'}),x=>delete x.profile.ContainerProfiles,x=>x.profile.TranscodingProfiles[1].Conditions=[],
 x=>x.settings.audio.spatialAudio=false,x=>x.settings.audio.devicetype='hdmi',x=>x.settings.audio.device='manual',
 x=>x.settings.audio.channels='5.1',x=>x.settings.audio.exclusive=true,x=>x.settings.video.force_transcode_hdr=true,
 x=>x.request.DeviceProfile=structuredClone(x.profile)
 ];for(const mutate of changes){const x=fixture();mutate(x);unchanged(x)}});
test('H264 eight bit and HEVC eight or ten bit only',()=>{for(const [codec,bits,allowed] of [['h264',8,true],['h264',10,false],['hevc',8,true],['hevc',10,true],['hevc',12,false],['av1',10,false]]){const x=fixture();Object.assign(x.item.MediaSources[0].MediaStreams[0],{Codec:codec,BitDepth:bits});assert.equal(plan(x).applied,allowed)}});
test('cyclic inputs fail closed',()=>{const x=fixture();x.profile.self=x.profile;unchanged(x);assert.equal(plan().applied,false)});

test('clone retains optional undefined fields without mutating the input',()=>{const x=fixture();x.request.ClientOptional=undefined;const r=plan(x);assert.equal(r.applied,true);assert.equal(Object.hasOwn(r.request,'ClientOptional'),true);assert.equal(r.request.ClientOptional,undefined)});
test('Dolby Vision P5 and P8 are advertised only by the experimental native route',()=>{
 for(const [range,profile,value] of [['DOVI',5,'DOVI'],['DOVIWithHDR10',8,'DOVI|DOVIWithHDR10|HDR10'],['DOVIWithHLG',8,'DOVI|DOVIWithHLG|HLG']]){
  const x=fixture();Object.assign(x.item.MediaSources[0].MediaStreams[0],{VideoRangeType:range,DvProfile:profile,DvLevel:6,RpuPresentFlag:1,BlPresentFlag:1,ElPresentFlag:0});unchanged(x);
  x.capabilities.nativeDolbyVisionHlsAvailable=true;const before=JSON.stringify(x),out=plan(x);
  assert.equal(out.applied,true);assert.equal(out.dvRange,value);assert.equal(JSON.stringify(x),before);
  assert.deepEqual(out.profile.CodecProfiles,[{Type:'Video',Codec:'hevc',Conditions:[{Condition:'EqualsAny',Property:'VideoRangeType',Value:value,IsRequired:false}],ApplyConditions:[]}]);
  assert.equal(out.request.AudioStreamIndex,1);assert.equal(out.request.SubtitleStreamIndex,-1);
  assert.equal(out.request.AllowVideoStreamCopy,true);assert.equal(out.request.AllowAudioStreamCopy,true);
 }
});
test('ambiguous Dolby Vision, subtitles and non-EAC3 preserve the original request',()=>{
 for(const change of [v=>v.DvProfile=7,v=>v.DvLevel=null,v=>v.VideoRangeType='DOVIInvalid',v=>delete v.VideoRangeType]){
  const x=fixture();x.capabilities.nativeDolbyVisionHlsAvailable=true;const v=x.item.MediaSources[0].MediaStreams[0];Object.assign(v,{VideoRangeType:'DOVI',DvProfile:5,DvLevel:6,RpuPresentFlag:1,BlPresentFlag:1,ElPresentFlag:0});change(v);unchanged(x);
 }
 for(const change of [x=>x.request.SubtitleStreamIndex=3,x=>x.request.AudioStreamIndex=2]){
  const x=fixture();x.capabilities.nativeDolbyVisionHlsAvailable=true;Object.assign(x.item.MediaSources[0].MediaStreams[0],{VideoRangeType:'DOVI',DvProfile:5,DvLevel:6,RpuPresentFlag:1,BlPresentFlag:1,ElPresentFlag:0});change(x);unchanged(x);
 }
});
test('DV requires bounded level and the supported single-layer metadata flags',()=>{
 for(const mutate of [v=>v.DvLevel=14,v=>v.RpuPresentFlag=0,v=>v.BlPresentFlag=0,v=>v.ElPresentFlag=1,v=>delete v.RpuPresentFlag]){
  const x=fixture();x.capabilities.nativeDolbyVisionHlsAvailable=true;const v=x.item.MediaSources[0].MediaStreams[0];Object.assign(v,{VideoRangeType:'DOVI',DvProfile:5,DvLevel:6,RpuPresentFlag:1,BlPresentFlag:0,ElPresentFlag:0});v.BlPresentFlag=1;mutate(v);unchanged(x);
 }
});
test('AAC LC stereo uses separate DV route without the Spatial Audio setting',()=>{
 const x=fixture();x.capabilities={nativeAudioHlsAvailable:false,nativeDolbyVisionHlsAvailable:true};x.settings.audio.spatialAudio=false;
 Object.assign(x.item.MediaSources[0].MediaStreams[0],{VideoRangeType:'DOVI',DvProfile:5,DvLevel:6,RpuPresentFlag:1,BlPresentFlag:1,ElPresentFlag:0});
 Object.assign(x.item.MediaSources[0].MediaStreams[1],{Codec:'aac',Profile:'LC',Channels:2});const out=plan(x);
 assert.equal(out.applied,true);assert.equal(out.videoRoute,true);assert.equal(out.audioCodec,'aac');assert.equal(out.profile.TranscodingProfiles[1].AudioCodec,'aac');
 for(const mutate of [y=>y.item.MediaSources[0].MediaStreams[1].Channels=6,y=>y.item.MediaSources[0].MediaStreams[1].Profile='HE-AAC',y=>y.request.SubtitleStreamIndex=3,y=>delete y.item.MediaSources[0].MediaStreams[0].DvProfile]){
  const y=fixture();y.capabilities={nativeDolbyVisionHlsAvailable:true};y.settings.audio.spatialAudio=false;Object.assign(y.item.MediaSources[0].MediaStreams[0],{VideoRangeType:'DOVI',DvProfile:5,DvLevel:6,RpuPresentFlag:1,BlPresentFlag:1,ElPresentFlag:0});Object.assign(y.item.MediaSources[0].MediaStreams[1],{Codec:'aac',Profile:'LC',Channels:2});mutate(y);unchanged(y);
 }
});

test('DV EAC3 uses video contract with either Spatial setting and preserves strict guards',()=>{
 for(const spatial of [false,true]){const x=fixture();x.capabilities={nativeDolbyVisionHlsAvailable:true,nativeAudioHlsAvailable:true};x.settings.audio.spatialAudio=spatial;Object.assign(x.item.MediaSources[0].MediaStreams[0],{VideoRangeType:'DOVIWithHDR10',DvProfile:8,DvLevel:6,RpuPresentFlag:1,BlPresentFlag:1,ElPresentFlag:0});const before=JSON.stringify(x),out=plan(x);assert.equal(out.applied,true);assert.equal(out.videoRoute,true);assert.equal(out.audioCodec,'eac3');assert.equal(out.request.AudioStreamIndex,1);assert.equal(out.request.SubtitleStreamIndex,-1);assert.equal(out.request.AllowVideoStreamCopy,true);assert.equal(out.request.AllowAudioStreamCopy,true);assert.equal(JSON.stringify(x),before);}
 for(const mutate of [x=>x.item.MediaSources[0].MediaStreams[1].Channels=9,x=>x.item.MediaSources[0].MediaStreams[1].IsExternal=true,x=>x.request.SubtitleStreamIndex=3,x=>x.settings.audio.exclusive=true,x=>x.request.AllowVideoStreamCopy=false,x=>delete x.item.MediaSources[0].MediaStreams[0].RpuPresentFlag]){const x=fixture();x.capabilities={nativeDolbyVisionHlsAvailable:true};x.settings.audio.spatialAudio=false;Object.assign(x.item.MediaSources[0].MediaStreams[0],{VideoRangeType:'DOVIWithHDR10',DvProfile:8,DvLevel:6,RpuPresentFlag:1,BlPresentFlag:1,ElPresentFlag:0});mutate(x);unchanged(x)}
 const nonDv=fixture();nonDv.capabilities={nativeDolbyVisionHlsAvailable:true};nonDv.settings.audio.spatialAudio=false;unchanged(nonDv);
});


test('missing audio settings preserve the original request and profile',()=>{
 for(const settings of [undefined,null,{}, {audio:undefined}, {audio:null}]) {
  const x=fixture();x.capabilities.nativeDolbyVisionHlsAvailable=true;x.settings=settings;
  const before=JSON.stringify(x), result=plan(x);
  assert.equal(result.applied,false);assert.equal(result.reason,'audio_settings_unknown');
  assert.equal(result.profile,x.profile);assert.equal(result.request,x.request);assert.equal(JSON.stringify(x),before);
 }
});


test('secondary subtitles preserve selection and disable the native candidate when active',()=>{
 for(const secondary of [undefined,null,-1,3]){
  const x=fixture();x.request.SecondarySubtitleStreamIndex=secondary;
  const before=JSON.stringify(x),result=plan(x);
  assert.equal(result.applied,secondary!==3);
  if(secondary===3){assert.equal(result.profile,x.profile);assert.equal(result.request,x.request);}
  assert.equal(x.request.SecondarySubtitleStreamIndex,secondary);assert.equal(JSON.stringify(x),before);
 }
});

function v2Fixture(codec, channels) {
 const x=fixture();
 x.capabilities={nativeDolbyVisionHlsAvailable:true,nativeDolbyVisionAudioHlsV2:{available:true,codecs:[codec]}};
 x.settings.audio.spatialAudio=false;
 const video=x.item.MediaSources[0].MediaStreams[0], audio=x.item.MediaSources[0].MediaStreams[1];
 Object.assign(video,{VideoRangeType:'DOVI',DvProfile:5,DvLevel:6,RpuPresentFlag:1,BlPresentFlag:1,ElPresentFlag:0});
 Object.assign(audio,{Codec:codec,Channels:channels,IsExternal:false});
 if(codec==='aac')audio.Profile='LC';
 return x;
}
test('DV HLS v2 plans direct copy for each explicitly reported codec without Spatial Audio',()=>{
 for(const [codec,channels] of [['aac',2],['ac3',6],['eac3',8],['flac',8],['alac',8]]){
  const x=v2Fixture(codec,channels),out=plan(x);
  assert.equal(out.applied,true,codec);
  assert.equal(out.videoRouteV2,true);
  assert.equal(out.contract,'deepstream-video-hls-v2');
  assert.equal(out.audioCodec,codec);
  assert.equal(out.profile.TranscodingProfiles[1].VideoCodec,'hevc');
  assert.equal(out.profile.TranscodingProfiles[1].AudioCodec,codec);
  assert.equal(out.request.AllowVideoStreamCopy,true);
  assert.equal(out.request.AllowAudioStreamCopy,true);
  assert.equal(out.request.AudioStreamIndex,1);
 }
});
test('DV HLS v2 requires exact capabilities, channels, source selection and genuine DV metadata',()=>{
 for(const mutate of [
  x=>delete x.capabilities.nativeDolbyVisionAudioHlsV2,
  x=>x.capabilities.nativeDolbyVisionAudioHlsV2.available=false,
  x=>x.capabilities.nativeDolbyVisionAudioHlsV2.codecs=['FLAC'],
  x=>x.capabilities.nativeDolbyVisionAudioHlsV2=[],
  x=>delete x.capabilities.nativeDolbyVisionHlsAvailable,
  x=>x.item.MediaSources[0].MediaStreams[0].RpuPresentFlag=0,
  x=>x.request.AudioStreamIndex=2,
  x=>x.request.SecondarySubtitleStreamIndex=3
 ]){const x=v2Fixture('flac',8);mutate(x);unchanged(x);}
 for(const codec of ['ac3','flac','alac']){const x=v2Fixture(codec,2);x.capabilities.nativeDolbyVisionAudioHlsV2.codecs=[];unchanged(x);}
 const eac3=v2Fixture('eac3',6);eac3.capabilities.nativeDolbyVisionAudioHlsV2.codecs=[];assert.equal(plan(eac3).contract,'deepstream-video-hls-v1');
 for(const [codec,channels] of [['aac',3],['ac3',7],['eac3',9],['flac',9],['alac',9]]){const x=v2Fixture(codec,channels-1);x.item.MediaSources[0].MediaStreams[1].Channels=channels;unchanged(x);}
 for(const codec of ['truehd','dts','pcm','unknown']){const x=v2Fixture(codec,2);unchanged(x);}
 const aac=v2Fixture('aac',2);delete aac.capabilities.nativeDolbyVisionAudioHlsV2;
 const fallback=plan(aac);assert.equal(fallback.applied,true);assert.equal(fallback.contract,'deepstream-video-hls-v1');
});

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const bridge = require('../native/dolbyVisionSessionBridge.js');
const dv = require('../native/dolbyVisionSelection.js');

function fixture() {
  const source = {Id:'source', DefaultAudioStreamIndex:2, DefaultSubtitleStreamIndex:-1, MediaStreams:[
    {Index:1,Type:'Video',Codec:'hevc',DvProfile:8,DvBlSignalCompatibilityId:1,VideoRangeType:'DOVIWithHDR10'},
    {Index:2,Type:'Audio',Codec:'eac3'}]};
  const options = {url:'https://fixture.invalid/master.m3u8',playSessionId:'play',mediaSource:source};
  const request = {enabled:true,contract:'deepstream-audio-hls-v1',bindingId:'binding',sourceUrl:options.url,
    playSessionId:'play',selection:{mediaSourceId:'source',audioStreamIndex:2,codec:'eac3',spatial:'joc'}};
  const context = {playbackInfo:{PlaySessionId:'play',MediaSources:[source]},videoStreamIndex:1,
    sessionGeneration:1,generations:{source:2,selection:3},attempt:'attempt',
    variant:{playMethod:'DirectStream',videoDirect:true,playbackInfoGeneration:2,dolbyVision:{preserved:true,
      evidence:dv.PRESERVATION_EVIDENCE,codec:'hevc',profile:8,compatibilityId:1,mode:'8.1'}},
    capabilities:{nativeDolbyVision:{contract:dv.NATIVE_CONTRACT,available:true,modes:['8.1'],
      preservesObjectAudioRoute:true}},
    audioPlan:{selectedIndex:2,nativeObjectRoute:true,source:{objectFormat:'atmos'}}};
  return {options,request,context};
}

test('bound 0.3 session forwards selection without credential-bearing URL or mutation', () => {
  const f=fixture(); const before=structuredClone(f); const result=bridge.assess(f.options,f.request,f.context);
  assert.equal(result.suitable,true); assert.equal(result.output.dolbyVision,'unknown');
  assert.equal(JSON.stringify(result).includes('fixture.invalid'),false);
  assert.deepEqual(f,before);
});
test('stale or mismatched session never reaches the selector', () => {
  for (const mutate of [
    f=>f.request.sourceUrl+='?changed', f=>f.request.playSessionId='other',
    f=>f.request.selection.mediaSourceId='other', f=>f.request.selection.audioStreamIndex=5,
    f=>f.request.selection.codec='aac', f=>f.request.contract='unknown', f=>f.request.enabled=false
  ]) { const f=fixture(); mutate(f); assert.equal(bridge.assess(f.options,f.request,f.context),null); }
});
test('actual 0.3 capability does not establish DV preservation or output', () => {
  const f=fixture();f.context.variant=null;f.context.capabilities={nativeAudioHlsAvailable:true};
  const result=bridge.assess(f.options,f.request,f.context);
  assert.equal(result.suitable,false);assert.equal(result.output.dolbyVision,'unknown');
});
test('unknown selected video and changed audio plan fail closed', () => {
  const f=fixture();f.context.videoStreamIndex=undefined;
  assert.equal(bridge.assess(f.options,f.request,f.context).suitable,false);
  const g=fixture();g.context.audioPlan.selectedIndex=3;
  assert.equal(bridge.assess(g.options,g.request,g.context).suitable,false);
});
test('actual 0.3 request qualifies source metadata without asserting an HLS variant', () => {
  const f=fixture();const result=bridge.inspectBoundSource(f.options,f.request);
  assert.deepEqual(result,{kind:'source-metadata',sourceVideoIndex:1,profile:8,mode:'8.1',baseLayer:'hdr10',eligible:true,reason:null});
  assert.equal(JSON.stringify(result).includes('fixture.invalid'),false);
  assert.equal('outputConfirmed' in result,false);
});
test('source inspection rejects ambiguous tracks and stale audio', () => {
  const f=fixture();f.options.mediaSource.MediaStreams.push({Index:3,Type:'Video',Codec:'hevc',DvProfile:5});
  assert.equal(bridge.inspectBoundSource(f.options,f.request),null);
  const g=fixture();g.options.mediaSource.DefaultAudioStreamIndex=3;
  assert.equal(bridge.inspectBoundSource(g.options,g.request),null);
  const h=fixture();h.options.mediaSource.DefaultVideoStreamIndex=7;
  assert.equal(bridge.inspectBoundSource(h.options,h.request),null);
});

test('video route supports AAC while rejecting unbound or unknown codecs', () => {
  const f=fixture(); f.request.contract='deepstream-video-hls-v1'; f.request.selection.codec='aac';
  assert.equal(bridge.inspectBoundSource(f.options,f.request).mode,'8.1');
  f.request.selection.codec='truehd'; assert.equal(bridge.inspectBoundSource(f.options,f.request),null);
  f.request.selection.codec='aac'; f.request.playSessionId='stale';
  assert.equal(bridge.inspectBoundSource(f.options,f.request),null);
});

test('v2 source inspection is limited to bound direct-copy codec and channel evidence', () => {
  const f=fixture();f.request.contract='deepstream-video-hls-v2';f.request.selection.codec='flac';f.request.selection.channels=8;
  f.options.mediaSource.MediaStreams[1].Codec='flac';
  assert.equal(bridge.inspectBoundSource(f.options,f.request).mode,'8.1');
  f.request.selection.channels=9;assert.equal(bridge.inspectBoundSource(f.options,f.request),null);
  f.request.selection.channels=8;f.request.selection.codec='truehd';assert.equal(bridge.inspectBoundSource(f.options,f.request),null);
});

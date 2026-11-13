'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const dv = require('../native/dolbyVisionSelection.js');

function fixture() {
    return {
        playbackInfo: {PlaySessionId:'session', MediaSources:[{Id:'source', TranscodingInfo:{IsVideoDirect:true}, MediaStreams:[
            {Index:0, Type:'Video', Codec:'hevc', DvProfile:8, DvBlSignalCompatibilityId:1, VideoRangeType:'DOVIWithHDR10'},
            {Index:1, Type:'Audio', Codec:'eac3'}]}]},
        selection:{mediaSourceId:'source', playSessionId:'session', videoStreamIndex:0, audioStreamIndex:1, subtitleStreamIndex:-1},
        session:{identity:'local-session', generation:1}, generations:{source:2,selection:3}, attempt:'attempt',
        variant:{playMethod:'DirectStream',videoDirect:true,playbackInfoGeneration:2,dolbyVision:{preserved:true,evidence:dv.PRESERVATION_EVIDENCE,codec:'hevc',profile:8,compatibilityId:1,mode:'8.1'}},
        capabilities:{nativeDolbyVision:{contract:dv.NATIVE_CONTRACT,available:true,modes:['8.1'],preservesObjectAudioRoute:true,allowsExternalSubtitle:false}},
        audioPlan:{selectedIndex:1,nativeObjectRoute:true,source:{objectFormat:'atmos'}}
    };
}

test('duplicate selected source is rejected rather than silently chosen', () => {
    const f=fixture(); assert.equal(dv.evaluate(f).suitable,true);
    f.playbackInfo.MediaSources.push(structuredClone(f.playbackInfo.MediaSources[0]));
    assert.equal(dv.evaluate(f).suitable,false);
});
test('duplicate selected video track is rejected', () => {
    const f=fixture(); const streams=f.playbackInfo.MediaSources[0].MediaStreams;
    streams.push(structuredClone(streams[0]));
    assert.equal(dv.evaluate(f).suitable,false);
});
test('changed session cannot reuse a prior handoff', () => {
    const f=fixture();const assessment=dv.evaluate(f);assert.ok(dv.handoff(assessment,f));
    f.session.generation++;assert.equal(dv.handoff(assessment,f),null);
});
test('missing track preservation is never proof of Dolby Vision', () => {
    const f=fixture();delete f.variant.dolbyVision.evidence;
    assert.equal(dv.evaluate(f).suitable,false);
});
test('unknown profile numbers never gain a supported mode', () => {
    for (const profile of [-1,0,1,2,3,4,6,7,9,10,999]) {
        const f=fixture();f.playbackInfo.MediaSources[0].MediaStreams[0].DvProfile=profile;
        assert.equal(dv.evaluate(f).suitable,false,`profile ${profile}`);
    }
});
test('malformed or attacker supplied JS inputs fail without throwing', () => {
    for (const value of [null, undefined, [], 0, 'x', {get playbackInfo(){throw Error('no');}}]) {
        assert.doesNotThrow(()=>dv.evaluate(value));
        assert.equal(dv.evaluate(value).suitable,false);
    }
});

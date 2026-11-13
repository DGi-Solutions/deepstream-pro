'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const dv = require('../native/dolbyVisionSelection.js');

function fixture() {
    const video = {
        Index: 1,
        Type: 'Video',
        Codec: 'hevc',
        Profile: 'Main 10',
        DvProfile: 8,
        DvBlSignalCompatibilityId: 1,
        VideoRangeType: 'DOVIWithHDR10'
    };
    const audio = {
        Index: 2,
        Type: 'Audio',
        Codec: 'eac3',
        Channels: 8,
        Profile: 'Dolby Digital Plus + Dolby Atmos'
    };
    const mediaSource = {
        Id: 'source-1',
        DefaultVideoStreamIndex: 0,
        DefaultAudioStreamIndex: 2,
        DefaultSubtitleStreamIndex: -1,
        TranscodingInfo: {IsVideoDirect: true},
        MediaStreams: [
            {Index: 0, Type: 'Video', Codec: 'hevc', VideoRangeType: 'HDR10'},
            video,
            audio
        ]
    };
    return {
        playbackInfo: {
            PlaySessionId: 'play-1',
            MediaSources: [mediaSource]
        },
        selection: {
            mediaSourceId: 'source-1',
            playSessionId: 'play-1',
            videoStreamIndex: 1,
            audioStreamIndex: 2,
            subtitleStreamIndex: -1
        },
        session: {
            identity: 'synthetic-non-secret-session-identity',
            generation: 4
        },
        generations: {source: 8, selection: 9},
        attempt: 'attempt-1',
        variant: {
            playMethod: 'DirectStream',
            videoDirect: true,
            playbackInfoGeneration: 8,
            dolbyVision: {
                preserved: true,
                evidence: dv.PRESERVATION_EVIDENCE,
                codec: 'hevc',
                profile: 8,
                compatibilityId: 1,
                mode: '8.1'
            }
        },
        capabilities: {
            nativeDolbyVision: {
                contract: dv.NATIVE_CONTRACT,
                available: true,
                modes: ['5', '8.1', '8.4'],
                preservesObjectAudioRoute: true,
                allowsExternalSubtitle: false
            }
        },
        audioPlan: {
            selectedIndex: 2,
            nativeObjectRoute: true,
            source: {codec: 'eac3', objectFormat: 'atmos'}
        }
    };
}

function nativeCapabilities(input) {
    return input.capabilities.nativeDolbyVision;
}

function nativeReport(input, values = {}) {
    return {
        contract: dv.OUTPUT_CONTRACT,
        correlation: {...dv.evaluate(input).correlation},
        format: 'dolby-vision',
        mode: '8.1',
        rpuProcessed: true,
        ...values
    };
}

test('qualifies 8.1 without confusing source, variant, track and output', () => {
    const input = fixture();
    const before = structuredClone(input);
    const result = dv.evaluate(input);

    assert.equal(result.suitable, true);
    assert.equal(result.reason, null);
    assert.equal(result.source.mode, '8.1');
    assert.equal(result.source.baseLayer, 'hdr10');
    assert.equal(result.source.compatibilityOrigin, 'declared');
    assert.equal(result.track.role, 'selected-source-video-track');
    assert.equal(result.track.codec, 'hevc');
    assert.equal(result.variant.dolbyVisionPreservation, 'proven-for-selected-variant');
    assert.equal(result.variant.nativePlaybackMode, 'not-requested');
    assert.equal(result.output.status, 'unconfirmed');
    assert.equal(result.output.format, 'unknown');
    assert.equal(result.output.dolbyVision, 'unknown');
    assert.deepEqual(input, before, 'assessment must not mutate negotiation or selection');
});

test('handoff copies all existing identifiers and track indices without URLs', () => {
    const input = fixture();
    const result = dv.evaluate(input);
    const request = dv.handoff(result, input);

    assert.equal(request.contract, dv.NATIVE_CONTRACT);
    assert.equal(request.mediaSourceId, 'source-1');
    assert.equal(request.playSessionId, 'play-1');
    assert.equal(request.videoStreamIndex, 1);
    assert.equal(request.audioStreamIndex, 2);
    assert.equal(request.subtitleStreamIndex, -1);
    assert.equal(request.audio.policy, 'preserve-existing-selection-and-route');
    assert.equal(request.audio.nativeObjectRoute, true);
    assert.equal(request.audio.objectFormat, 'atmos');
    assert.deepEqual(request.processing, {
        audioFilters: false,
        videoFilters: false,
        artificialSurround: false
    });
    assert.equal(request.playback.outputConfirmed, false);
    assert.ok(!('sourceUrl' in request));
    assert.ok(!('upstreamUrl' in request));
    assert.ok(!('authorization' in request));
    assert.ok(!('transport' in request));
});

test('recognizes profile 5 without inventing an HDR base layer', () => {
    const input = fixture();
    const video = input.playbackInfo.MediaSources[0].MediaStreams
        .find(stream => stream.Index === 1);
    video.DvProfile = 5;
    video.DvBlSignalCompatibilityId = 0;
    video.VideoRangeType = 'DOVI';
    input.variant.dolbyVision = {
        ...input.variant.dolbyVision,
        profile: 5,
        compatibilityId: 0,
        mode: '5'
    };

    const result = dv.evaluate(input);
    assert.equal(result.suitable, true);
    assert.equal(result.source.mode, '5');
    assert.equal(result.source.baseLayer, 'none');
    assert.equal(dv.handoff(result, input).video.baseLayer, 'none');
    assert.equal(result.output.status, 'unconfirmed');
});

test('recognizes 8.4 and its HLG base layer', () => {
    const input = fixture();
    const video = input.playbackInfo.MediaSources[0].MediaStreams
        .find(stream => stream.Index === 1);
    video.DvBlSignalCompatibilityId = 4;
    video.VideoRangeType = 'DOVIWithHLG';
    input.variant.dolbyVision = {
        ...input.variant.dolbyVision,
        compatibilityId: 4,
        mode: '8.4'
    };

    const result = dv.evaluate(input);
    assert.equal(result.suitable, true);
    assert.equal(result.source.mode, '8.4');
    assert.equal(result.source.baseLayer, 'hlg');
});

test('can infer 8.1 or 8.4 compatibility only from structured DV range', () => {
    const hdr10 = dv.inspectSource({
        DvProfile: 8,
        VideoRangeType: 'DOVIWithHDR10'
    });
    const hlg = dv.inspectSource({
        DvProfile: 8,
        VideoRangeType: 'DOVIWithHLG'
    });
    assert.equal(hdr10.eligible, true);
    assert.equal(hdr10.compatibilityId, 1);
    assert.equal(hdr10.compatibilityOrigin, 'video-range');
    assert.equal(hlg.eligible, true);
    assert.equal(hlg.compatibilityId, 4);
    assert.equal(hlg.compatibilityOrigin, 'video-range');

    const unknown = dv.inspectSource({DvProfile: 8, VideoRangeType: 'DOVI'});
    assert.equal(unknown.eligible, false);
    assert.equal(unknown.reason, 'dolby_vision_compatibility_unknown');
});

test('recognizes explicitly declared 8.1 with HDR10+ without assuming playback support', () => {
    const stream = {DvProfile: 8, DvBlSignalCompatibilityId: 1,
        VideoRangeType: 'DOVIWithHDR10Plus'};
    const source = dv.inspectSource(stream);
    assert.equal(source.state, 'recognized');
    assert.equal(source.mode, '8.1');
    assert.equal(source.baseLayer, 'hdr10');
    assert.equal(source.eligible, true);

    const unknown = dv.inspectSource({DvProfile: 8, VideoRangeType: 'DOVIWithHDR10Plus'});
    assert.equal(unknown.eligible, false);
    assert.equal(unknown.reason, 'dolby_vision_compatibility_unknown');
    assert.equal(dv.inspectSource({...stream, DvBlSignalCompatibilityId: 4}).state, 'contradictory');

    const input = fixture();
    input.playbackInfo.MediaSources[0].MediaStreams.find(s => s.Index === 1).VideoRangeType = 'DOVIWithHDR10Plus';
    assert.equal(dv.evaluate(input).reason, 'hdr10plus_preservation_unproven');
    input.variant.dolbyVision.hdr10PlusPreserved = true;
    assert.equal(dv.evaluate(input).reason, 'native_hdr10plus_combination_unconfirmed');
    nativeCapabilities(input).supportsDolbyVisionWithHdr10Plus = true;
    const result = dv.evaluate(input);
    assert.equal(result.suitable, true);
    assert.equal(result.output.status, 'unconfirmed');
    assert.equal(result.output.dolbyVision, 'unknown');
});

test('rejects contradictory 8.1/8.4 and profile-5 metadata', () => {
    for (const stream of [
        {
            DvProfile: 8,
            DvBlSignalCompatibilityId: 1,
            VideoRangeType: 'DOVIWithHLG'
        },
        {
            DvProfile: 8,
            DvBlSignalCompatibilityId: 4,
            VideoRangeType: 'DOVIWithHDR10'
        },
        {
            DvProfile: 5,
            DvBlSignalCompatibilityId: 1,
            VideoRangeType: 'DOVI'
        },
        {
            DvProfile: 5,
            DvBlSignalCompatibilityId: 0,
            VideoRangeType: 'DOVIWithHDR10'
        }
    ]) {
        const result = dv.inspectSource(stream);
        assert.equal(result.eligible, false);
        assert.equal(result.state, 'contradictory');
    }
});

test('does not advertise profile 7 or unknown compatibility as implemented', () => {
    assert.equal(dv.inspectSource({
        DvProfile: 7,
        DvBlSignalCompatibilityId: 1,
        VideoRangeType: 'DOVIWithHDR10'
    }).eligible, false);
    assert.equal(dv.inspectSource({
        DvProfile: 8,
        DvBlSignalCompatibilityId: 2,
        VideoRangeType: 'DOVIWithHDR10'
    }).eligible, false);
    assert.equal(dv.inspectSource({
        DvProfile: 8,
        DvBlSignalCompatibilityId: 'not-a-number'
    }).eligible, false);
});

test('titles, display titles, cookies and image-like names are not DV evidence', () => {
    const result = dv.inspectSource({
        Title: 'Dolby Vision Profile 8.1 HDR10',
        DisplayTitle: 'DV 8.4 Atmos',
        VideoRangeType: undefined,
        DvProfile: undefined
    });
    assert.equal(result.state, 'not-dolby-vision');
    assert.equal(result.eligible, false);
    assert.equal(result.mode, null);
});

test('uses only the actually selected video and never another default or source', () => {
    const input = fixture();
    assert.equal(input.playbackInfo.MediaSources[0].DefaultVideoStreamIndex, 0);
    assert.equal(dv.evaluate(input).suitable, true, 'selected stream 1 is DV');

    const wrongTrack = fixture();
    wrongTrack.selection.videoStreamIndex = 0;
    assert.equal(dv.evaluate(wrongTrack).suitable, false);
    assert.equal(dv.evaluate(wrongTrack).reason, 'source_not_dolby_vision');

    const missing = fixture();
    missing.selection.videoStreamIndex = 99;
    assert.equal(dv.evaluate(missing).suitable, false);
    assert.equal(dv.evaluate(missing).reason, 'selected_video_track_unavailable');

    const otherSource = fixture();
    otherSource.playbackInfo.MediaSources.push({
        ...otherSource.playbackInfo.MediaSources[0],
        Id: 'other-source'
    });
    otherSource.selection.mediaSourceId = 'other-source';
    assert.equal(dv.evaluate(otherSource).suitable, true);
    assert.equal(dv.evaluate(otherSource).selection.mediaSourceId, 'other-source');
});

test('requires HEVC for the implemented native DV contract', () => {
    const input = fixture();
    input.playbackInfo.MediaSources[0].MediaStreams
        .find(stream => stream.Index === 1).Codec = 'h264';
    const result = dv.evaluate(input);
    assert.equal(result.suitable, false);
    assert.equal(result.reason, 'native_requires_hevc_dolby_vision');
});

test('source DV plus DirectPlay is insufficient without preservation evidence', () => {
    const input = fixture();
    input.variant.playMethod = 'DirectPlay';
    delete input.variant.dolbyVision;
    delete input.playbackInfo.MediaSources[0].TranscodingInfo;

    const result = dv.evaluate(input);
    assert.equal(result.suitable, false);
    assert.equal(result.reason, 'dv_preservation_unproven');
    assert.equal(result.source.eligible, true);
    assert.equal(result.output.status, 'unconfirmed');
});

test('video transcode wins even over contradictory direct-play claims', () => {
    for (const mutate of [
        input => {
            input.playbackInfo.MediaSources[0].TranscodingInfo.IsVideoDirect = false;
        },
        input => {
            input.variant.videoDirect = false;
        }
    ]) {
        const input = fixture();
        mutate(input);
        const result = dv.evaluate(input);
        assert.equal(result.suitable, false);
        assert.equal(result.reason, 'video_transcode');
        assert.equal(result.variant.videoTranscoded, true);
    }
});

test('audio-only Transcode may qualify but is never relabelled DirectPlay', () => {
    const input = fixture();
    input.variant.playMethod = 'Transcode';
    const result = dv.evaluate(input);
    assert.equal(result.suitable, true);
    assert.equal(result.variant.serverPlayMethod, 'Transcode');
    assert.equal(result.variant.videoTranscoded, false);
    assert.equal(dv.handoff(result, input).playback.serverPlayMethod, 'Transcode');
});

test('preservation evidence must match the selected source track and generation', () => {
    const mismatch = fixture();
    mismatch.variant.dolbyVision.mode = '8.4';
    let result = dv.evaluate(mismatch);
    assert.equal(result.suitable, false);
    assert.equal(result.reason, 'dv_preservation_contradicts_source');

    const stale = fixture();
    stale.variant.playbackInfoGeneration = 7;
    result = dv.evaluate(stale);
    assert.equal(result.suitable, false);
    assert.equal(result.reason, 'video_direct_unproven');
});

test('requires the exact native contract and source mode support', () => {
    const missing = fixture();
    delete missing.capabilities.nativeDolbyVision.contract;
    assert.equal(dv.evaluate(missing).reason, 'native_contract_unavailable');

    const unavailable = fixture();
    nativeCapabilities(unavailable).available = false;
    assert.equal(dv.evaluate(unavailable).reason, 'native_unavailable');

    const noMode = fixture();
    nativeCapabilities(noMode).modes = ['5', '8.4'];
    assert.equal(dv.evaluate(noMode).reason, 'native_dolby_vision_mode_unsupported');
});

test('an active Atmos/object route cannot be silently displaced', () => {
    const input = fixture();
    nativeCapabilities(input).preservesObjectAudioRoute = false;
    const before = structuredClone(input.audioPlan);
    const result = dv.evaluate(input);

    assert.equal(result.suitable, false);
    assert.equal(result.reason, 'native_audio_route_unconfirmed');
    assert.deepEqual(input.audioPlan, before);
    assert.equal(dv.handoff(result, input), null);
});

test('a stale audio plan cannot alter or validate the current audio selection', () => {
    const input = fixture();
    input.audioPlan.selectedIndex = 7;
    const result = dv.evaluate(input);
    assert.equal(result.suitable, false);
    assert.equal(result.reason, 'stale_audio_plan');
    assert.equal(result.selection.audioStreamIndex, 2);
});

test('missing or malformed selected audio/subtitle tracks fail closed', () => {
    const audio = fixture();
    audio.selection.audioStreamIndex = 77;
    assert.equal(dv.evaluate(audio).reason, 'selected_audio_track_unavailable');

    const subtitle = fixture();
    subtitle.selection.subtitleStreamIndex = 4;
    assert.equal(dv.evaluate(subtitle).reason, 'selected_subtitle_track_unavailable');

    const unknown = fixture();
    unknown.selection.subtitleStreamIndex = undefined;
    assert.equal(dv.evaluate(unknown).suitable, false);
    assert.equal(dv.evaluate(unknown).selection.subtitleStreamIndex, null);
});

test('external subtitles need an explicit native capability', () => {
    const input = fixture();
    input.playbackInfo.MediaSources[0].MediaStreams.push({
        Index: 5,
        Type: 'Subtitle',
        IsExternal: true,
        DeliveryMethod: 'External',
        Codec: 'srt'
    });
    input.selection.subtitleStreamIndex = 5;
    assert.equal(dv.evaluate(input).reason, 'native_external_subtitle_unconfirmed');

    nativeCapabilities(input).allowsExternalSubtitle = true;
    assert.equal(dv.evaluate(input).suitable, true);
    assert.equal(dv.handoff(dv.evaluate(input), input).subtitleStreamIndex, 5);
});

test('every session/source/selection/attempt change revokes the handoff', () => {
    const input = fixture();
    const result = dv.evaluate(input);
    assert.equal(dv.isCurrent(result, input), true);
    assert.ok(dv.handoff(result, input));

    for (const mutate of [
        value => { value.session.identity = 'next-session'; },
        value => { value.session.generation += 1; },
        value => { value.generations.source += 1; },
        value => { value.generations.selection += 1; },
        value => { value.attempt = 'attempt-2'; },
        value => { value.selection.mediaSourceId = 'next-source'; },
        value => { value.selection.playSessionId = 'next-play'; },
        value => { value.selection.videoStreamIndex = 0; },
        value => { value.selection.audioStreamIndex = -1; },
        value => { value.selection.subtitleStreamIndex = 4; }
    ]) {
        const current = fixture();
        mutate(current);
        assert.equal(dv.isCurrent(result, current), false);
        assert.equal(dv.handoff(result, current), null);
        assert.equal(dv.recordOutput(result, current, nativeReport(input)), null);
    }
});

test('only a matching explicit native report confirms Dolby Vision output', () => {
    const input = fixture();
    const result = dv.evaluate(input);

    assert.equal(result.output.status, 'unconfirmed');
    assert.equal(dv.recordOutput(result, input, null), null);
    assert.equal(dv.recordOutput(result, input, {
        ...nativeReport(input),
        rpuProcessed: false
    }), null);
    assert.equal(dv.recordOutput(result, input, {
        ...nativeReport(input),
        mode: '8.4'
    }), null);

    const output = dv.recordOutput(result, input, nativeReport(input));
    assert.equal(output.status, 'native-confirmed');
    assert.equal(output.format, 'dolby-vision');
    assert.equal(output.dolbyVision, true);
    assert.equal(output.mode, '8.1');
    assert.equal(output.evidence, 'native-output-attestation');

    const wrongAttempt = nativeReport(input);
    wrongAttempt.correlation.attempt = 'older-attempt';
    assert.equal(dv.recordOutput(result, input, wrongAttempt), null);
});

test('a native HDR/HLG/SDR report confirms fallback, not Dolby Vision', () => {
    const input = fixture();
    const result = dv.evaluate(input);
    const report = nativeReport(input, {
        format: 'hdr10',
        mode: null,
        rpuProcessed: false
    });
    const output = dv.recordOutput(result, input, report);
    assert.equal(output.status, 'native-confirmed');
    assert.equal(output.format, 'hdr10');
    assert.equal(output.dolbyVision, false);
});

test('invalid and ambiguous PlaybackInfo/track selections fail without throwing', () => {
    for (const value of [null, undefined, {}, [], 42, 'invalid']) {
        assert.doesNotThrow(() => dv.evaluate(value));
        assert.equal(dv.evaluate(value).suitable, false);
        assert.equal(dv.handoff(dv.evaluate(value), value), null);
    }

    const duplicateSource = fixture();
    duplicateSource.playbackInfo.MediaSources.push(
        duplicateSource.playbackInfo.MediaSources[0]);
    assert.equal(dv.evaluate(duplicateSource).reason, 'selected_media_source_unavailable');

    const wrongSession = fixture();
    wrongSession.playbackInfo.PlaySessionId = 'another-play-session';
    assert.equal(dv.evaluate(wrongSession).reason, 'playbackinfo_selection_mismatch');

    const duplicateVideo = fixture();
    const selected = duplicateVideo.playbackInfo.MediaSources[0].MediaStreams
        .find(stream => stream.Index === 1);
    duplicateVideo.playbackInfo.MediaSources[0].MediaStreams.push({...selected});
    assert.equal(dv.evaluate(duplicateVideo).reason, 'selected_video_track_unavailable');
});

test('exports the same pure API as a browser global', () => {
    const filename = path.join(__dirname, '../native/dolbyVisionSelection.js');
    const context = {};
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), context);
    assert.equal(typeof context.DeepStreamDolbyVision.evaluate, 'function');
    assert.equal(typeof context.DeepStreamDolbyVision.handoff, 'function');
    assert.equal(
        context.DeepStreamDolbyVision.inspectSource({
            DvProfile: 8,
            DvBlSignalCompatibilityId: 1,
            VideoRangeType: 'DOVIWithHDR10'
        }).mode,
        '8.1'
    );
});

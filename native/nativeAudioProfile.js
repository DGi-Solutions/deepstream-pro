/* PlaybackInfo request-scoped candidate. This module never starts a session. */
(function (root, factory) {
    const helper = factory();
    if (typeof module === 'object' && module.exports) module.exports = helper;
    if (root) root.DeepStreamNativeAudioProfile = helper;
})(typeof window === 'object' ? window : globalThis, function () {
    'use strict';
    const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
    const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
    const positiveInteger = value => Number.isSafeInteger(value) && value > 0;
    const codecs = value => typeof value === 'string' ? value.split(',').map(v => v.trim().toLowerCase()).filter(Boolean) : [];
    const directCopyV2Channels = Object.freeze({aac:2, ac3:6, eac3:8, flac:8, alac:8});

    function plan({profile, item, capabilities, settings, options, request} = {}) {
        const unchanged = reason => ({profile, request, applied: false, reason});
        if (!isRecord(profile) || !isRecord(request) || request.DeviceProfile !== profile) return unchanged('selection_unknown');
        if (capabilities?.nativeAudioHlsAvailable !== true && capabilities?.nativeDolbyVisionHlsAvailable !== true)
            return unchanged('disabled');
        const audioSettings = settings?.audio;
        if (!isRecord(audioSettings)) return unchanged('audio_settings_unknown');
        if (audioSettings.devicetype !== 'basic' || audioSettings.device !== 'auto' ||
            audioSettings.channels !== 'auto' || audioSettings.exclusive !== false)
            return unchanged('manual_audio_route');
        if (options?.isRetry === true || request.IsPlayback !== true || request.EnableDirectPlay === false ||
            request.EnableDirectStream === false || request.EnableTranscoding === false ||
            request.AllowVideoStreamCopy === false || request.AllowAudioStreamCopy === false)
            return unchanged('request_not_eligible');
        const videoSettings = settings?.video;
        if (!isRecord(videoSettings) || videoSettings.always_force_transcode ||
            Object.keys(videoSettings).some(k => k.startsWith('force_transcode_') && videoSettings[k]))
            return unchanged('forced_transcode_setting');
        if (!isRecord(item) || item.MediaType !== 'Video' || !['Movie', 'Episode'].includes(item.Type) ||
            !Array.isArray(item.MediaSources) || item.MediaSources.length === 0)
            return unchanged('sources_unknown');
        if (!Number.isSafeInteger(request.AudioStreamIndex) || request.AudioStreamIndex < 0 ||
            request.SubtitleStreamIndex !== -1 ||
            (request.SecondarySubtitleStreamIndex != null && request.SecondarySubtitleStreamIndex !== -1))
            return unchanged('selection_unknown');
        let source;
        if (request.MediaSourceId == null) {
            if (item.MediaSources.length !== 1) return unchanged('source_ambiguous');
            [source] = item.MediaSources;
        } else {
            if (!validId(request.MediaSourceId)) return unchanged('source_unknown');
            const matches = item.MediaSources.filter(x => x?.Id === request.MediaSourceId);
            if (matches.length !== 1) return unchanged('source_unknown');
            [source] = matches;
        }
        if (!isRecord(source) || !validId(source.Id) || source.Protocol !== 'File' || source.IsRemote !== false ||
            source.RequiresOpening !== false || source.IsInfiniteStream !== false || source.RequiresClosing !== false ||
            !!source.LiveStreamId || source.SupportsTranscoding !== true || source.UseMostCompatibleTranscodingProfile === true ||
            (source.RequiredHttpHeaders != null && (!isRecord(source.RequiredHttpHeaders) || Object.keys(source.RequiredHttpHeaders).length)) ||
            !Array.isArray(source.MediaStreams)) return unchanged('source_ineligible');
        if (!positiveInteger(source.Bitrate) || !positiveInteger(request.MaxStreamingBitrate) ||
            request.MaxStreamingBitrate < source.Bitrate || !positiveInteger(profile.MaxStaticBitrate) ||
            profile.MaxStaticBitrate < source.Bitrate) return unchanged('bitrate_unknown_or_limited');
        const indices = new Set();
        for (const stream of source.MediaStreams) {
            if (!isRecord(stream) || !Number.isSafeInteger(stream.Index) || stream.Index < 0 || indices.has(stream.Index))
                return unchanged('stream_unknown');
            indices.add(stream.Index);
        }
        const selected = source.MediaStreams.filter(s => s.Type === 'Audio' && s.Index === request.AudioStreamIndex);
        if (selected.length !== 1 || selected[0].IsExternal !== false || typeof selected[0].Codec !== 'string' ||
            !Number.isInteger(selected[0].Channels) || selected[0].Channels < 1) return unchanged('audio_ineligible');
        const audioCodec = selected[0].Codec.toLowerCase();
        const v2Capability = capabilities?.nativeDolbyVisionAudioHlsV2;
        const v2ChannelLimit = Object.hasOwn(directCopyV2Channels, audioCodec) ? directCopyV2Channels[audioCodec] : 0;
        const v2AudioRoute = capabilities?.nativeDolbyVisionHlsAvailable === true && isRecord(v2Capability) &&
            v2Capability.available === true && Array.isArray(v2Capability.codecs) && v2Capability.codecs.includes(audioCodec) &&
            selected[0].Channels <= v2ChannelLimit &&
            (audioCodec !== 'aac' || (typeof selected[0].Profile === 'string' && selected[0].Profile.toLowerCase() === 'lc'));
        const videoCandidate = capabilities?.nativeDolbyVisionHlsAvailable === true &&
            ((audioCodec === 'aac' && selected[0].Channels <= 2 &&
              typeof selected[0].Profile === 'string' && selected[0].Profile.toLowerCase() === 'lc') ||
             (audioCodec === 'eac3' && selected[0].Channels <= 8));
        const audioRoute = audioCodec === 'eac3' && selected[0].Channels <= 8 &&
            capabilities?.nativeAudioHlsAvailable === true && settings?.audio?.spatialAudio === true;
        if (!videoCandidate && !audioRoute && !v2AudioRoute) return unchanged('audio_ineligible');
        if (request.MaxAudioChannels != null && (!positiveInteger(request.MaxAudioChannels) ||
            request.MaxAudioChannels < selected[0].Channels)) return unchanged('audio_channel_limit');
        const video = source.MediaStreams.filter(s => s.Type === 'Video');
        if (video.length !== 1 || video[0].IsExternal !== false || video[0].IsInterlaced !== false)
            return unchanged('video_ineligible');
        const videoCodec = typeof video[0].Codec === 'string' ? video[0].Codec.toLowerCase() : '';
        if (!['h264', 'hevc'].includes(videoCodec) || !Number.isInteger(video[0].BitDepth) ||
            (videoCodec === 'h264' && video[0].BitDepth !== 8) ||
            (videoCodec === 'hevc' && ![8, 10].includes(video[0].BitDepth))) return unchanged('video_ineligible');
        // Jellyfin must be told which range AVPlayer can consume when requesting
        // a remux. This is an explicitly enabled experimental candidate; the
        // HLS master and output still need native verification.
        let dvRange = null;
        const range = video[0].VideoRangeType;
        if (typeof range === 'string' && range.toUpperCase().startsWith('DOVI')) {
            if (capabilities?.nativeDolbyVisionHlsAvailable !== true || videoCodec !== 'hevc' ||
                video[0].BitDepth !== 10 || !Number.isInteger(video[0].DvLevel) || video[0].DvLevel < 1 || video[0].DvLevel > 13 ||
                video[0].RpuPresentFlag !== 1 || video[0].BlPresentFlag !== 1 || video[0].ElPresentFlag !== 0)
                return unchanged('dolby_vision_unverified');
            if (range === 'DOVI' && video[0].DvProfile === 5) dvRange = 'DOVI';
            else if (range === 'DOVIWithHDR10' && video[0].DvProfile === 8) dvRange = 'DOVI|DOVIWithHDR10|HDR10';
            else if (range === 'DOVIWithHLG' && video[0].DvProfile === 8) dvRange = 'DOVI|DOVIWithHLG|HLG';
            else return unchanged('dolby_vision_unsupported_profile');
        } else if (video[0].DvProfile != null) {
            return unchanged('dolby_vision_metadata_unknown');
        }
        const videoRoute = !!dvRange && videoCandidate;
        const videoRouteV2 = !!dvRange && v2AudioRoute;
        if (!videoRoute && !videoRouteV2 && !audioRoute) return unchanged(audioCodec === 'aac' ? 'dolby_vision_required' : 'audio_ineligible');
        if (!Array.isArray(profile.DirectPlayProfiles) || !Array.isArray(profile.TranscodingProfiles) ||
            !Array.isArray(profile.CodecProfiles) || profile.CodecProfiles.length !== 0 ||
            !Array.isArray(profile.ContainerProfiles) || profile.ContainerProfiles.length !== 0)
            return unchanged('profile_conditions');
        if (profile.DirectPlayProfiles.some(p => !isRecord(p) || !['Audio', 'Photo', 'Video'].includes(p.Type)) ||
            profile.TranscodingProfiles.some(p => !isRecord(p) || !['Audio', 'Photo', 'Video'].includes(p.Type)))
            return unchanged('incomplete_profile');
        const direct = profile.DirectPlayProfiles.filter(p => p.Type === 'Video');
        const transcode = profile.TranscodingProfiles.filter(p => p.Type === 'Video');
        if (direct.length !== 1 || Object.keys(direct[0]).some(k => k !== 'Type') ||
            transcode.length !== 1 || transcode[0].Protocol !== 'hls' ||
            !['ts','mp4'].includes(transcode[0].Container) || !codecs(transcode[0].VideoCodec).includes(videoCodec) ||
            Object.keys(transcode[0]).some(k => !['Type','Container','Protocol','VideoCodec','AudioCodec','MaxAudioChannels'].includes(k)))
            return unchanged('video_profile_unknown');
        let result, clonedRequest;
        try {
            // PlaybackInfo is JSON; reject cycles and preserve optional values until axios serializes.
            JSON.stringify(request);
            if (typeof structuredClone !== 'function') return unchanged('not_cloneable');
            clonedRequest = structuredClone(request);
            result = clonedRequest.DeviceProfile;
        } catch (_) { return unchanged('not_cloneable'); }
        if (!isRecord(result) || !isRecord(clonedRequest)) return unchanged('not_cloneable');
        result.DirectPlayProfiles = result.DirectPlayProfiles.filter(p => p.Type !== 'Video');
        result.TranscodingProfiles = result.TranscodingProfiles.map(p => {
            if (p.Type !== 'Video') return p;
            const replacement = {...p, Container:'mp4', Protocol:'hls', VideoCodec:videoCodec, AudioCodec:audioCodec};
            delete replacement.MaxAudioChannels;
            return replacement;
        });
        if (dvRange) result.CodecProfiles.push({Type:'Video', Codec:'hevc',
            Conditions:[{Condition:'EqualsAny', Property:'VideoRangeType', Value:dvRange, IsRequired:false}],
            ApplyConditions:[]});
        Object.assign(clonedRequest, {DeviceProfile:result, EnableDirectPlay:false, EnableDirectStream:false,
            AllowVideoStreamCopy:true, AllowAudioStreamCopy:true});
        const contract = videoRouteV2 ? 'deepstream-video-hls-v2' : (videoRoute ? 'deepstream-video-hls-v1' : 'deepstream-audio-hls-v1');
        return {profile:result, request:clonedRequest, applied:true, dvRange, audioCodec, videoRoute, videoRouteV2, contract, reason:'candidate_requires_delivery_verification'};
    }
    return Object.freeze({plan});
});

/* DeepStream Pro: Dolby Vision assessment for an already qualified playback selection.
 *
 * This module deliberately has no network, URL, credential, relay, device-profile
 * augmentation or player-control functionality. It evaluates only the exact
 * PlaybackInfo/MediaSource/track selection supplied by the caller.
 *
 * Main API:
 *   evaluate(snapshot)              -> immutable assessment; never proves output
 *   handoff(assessment, current)    -> native request, or null when unsuitable/stale
 *   isCurrent(assessment, current)  -> session/source/selection/attempt correlation
 *   recordOutput(assessment, current, nativeReport)
 *                                   -> separate native-output attestation, or null
 *   inspectSource(videoStream)      -> structured source metadata classification
 *
 * Required native capability contract:
 *   capabilities.nativeDolbyVision = {
 *     contract: 'deepstream-native-dolby-vision-v1',
 *     available: true,
 *     modes: ['5', '8.1', '8.4'],       // actually implemented native modes
 *     preservesObjectAudioRoute: true,  // required only for an active object route
 *     allowsExternalSubtitle: true      // required only for an external subtitle
 *   }
 *
 * variant.videoDirect and variant.dolbyVision are evidence supplied by Gustav's
 * existing PlaybackInfo qualification. They must not be inferred from source DV
 * metadata, AVPlayer availability, a DirectPlay label or a relay URL. Missing
 * evidence makes the selection unsuitable for a native DV handoff.
 */
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.DeepStreamDolbyVision = api;
})(typeof window === 'object' ? window : globalThis, function () {
    'use strict';

    const ASSESSMENT_CONTRACT = 'deepstream-dolby-vision-assessment-v1';
    const NATIVE_CONTRACT = 'deepstream-native-dolby-vision-v1';
    const OUTPUT_CONTRACT = 'deepstream-native-dolby-vision-output-v1';
    const PRESERVATION_EVIDENCE = 'qualified-playbackinfo-profile';
    const PLAY_METHODS = ['DirectPlay', 'DirectStream', 'Transcode'];
    const CORRELATION_KEYS = [
        'sessionIdentity', 'sessionGeneration', 'sourceGeneration',
        'selectionGeneration', 'attempt', 'mediaSourceId', 'playSessionId',
        'videoStreamIndex', 'audioStreamIndex', 'subtitleStreamIndex'
    ];

    function deepFreeze(value) {
        if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
        for (const child of Object.values(value)) deepFreeze(child);
        return Object.freeze(value);
    }

    function hasValue(value) {
        return value !== undefined && value !== null && value !== '';
    }

    function integer(value) {
        if (typeof value === 'string' && /^-?\d+$/.test(value)) value = Number(value);
        return Number.isSafeInteger(value) ? value : null;
    }

    function generation(value) {
        return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
            ? value : null;
    }

    function streamIndex(value, disabledAllowed) {
        if (typeof value !== 'number' || !Number.isSafeInteger(value)) return null;
        if (value >= 0) return value;
        return disabledAllowed && value === -1 ? -1 : null;
    }

    function identifier(value, maximum = 512) {
        return typeof value === 'string' && value.length > 0 && value.length <= maximum &&
            value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value)
            ? value : null;
    }

    function sessionIdentity(value) {
        return identifier(value, 256);
    }

    function attemptIdentity(value) {
        return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value)
            ? value : null;
    }

    function codec(value) {
        if (typeof value !== 'string') return null;
        const normalized = value.trim().toLowerCase().replace(/[\s._-]/g, '');
        if (['hevc', 'h265', 'hvc1', 'hev1'].includes(normalized)) return 'hevc';
        return normalized ? normalized.slice(0, 40) : null;
    }

    function rangeOf(stream) {
        let raw = null;
        let field = null;
        if (typeof stream?.VideoRangeType === 'string' && stream.VideoRangeType.trim()) {
            raw = stream.VideoRangeType;
            field = 'VideoRangeType';
        } else if (typeof stream?.VideoRange === 'string' && stream.VideoRange.trim()) {
            raw = stream.VideoRange;
            field = 'VideoRange';
        }
        if (raw === null) return {field: null, key: null};

        const normalized = raw.trim().toLowerCase()
            .replace(/[\s._-]/g, '').replace(/\+/g, 'plus');
        const known = [
            'sdr', 'hdr', 'hdr10', 'hdr10plus', 'hlg', 'dovi',
            'doviwithhdr10', 'doviwithhlg', 'doviwithhdr10plus', 'doviwithsdr'
        ];
        return {field, key: known.includes(normalized) ? normalized : 'other'};
    }

    function sourceResult(values) {
        return {
            state: 'unknown',
            eligible: false,
            profile: null,
            declaredCompatibilityId: null,
            compatibilityId: null,
            compatibilityOrigin: 'none',
            range: null,
            rangeField: null,
            mode: null,
            baseLayer: 'unknown',
            reason: 'source_metadata_unknown',
            evidence: 'structured-source-video-metadata-only',
            ...values
        };
    }

    // This describes only the selected source track. It never describes a decoded
    // frame, a server variant, RPU processing, AVPlayer output or display output.
    function inspectSource(stream) {
        try {
            if (!stream || typeof stream !== 'object' || Array.isArray(stream)) {
                return deepFreeze(sourceResult({reason: 'selected_video_track_unavailable'}));
            }

            const profile = integer(stream.DvProfile);
            const compatibility = integer(stream.DvBlSignalCompatibilityId);
            const range = rangeOf(stream);
            const common = {
                profile,
                declaredCompatibilityId: compatibility,
                range: range.key,
                rangeField: range.field
            };

            if (hasValue(stream.DvProfile) && profile === null) {
                return deepFreeze(sourceResult({
                    ...common, reason: 'invalid_dolby_vision_profile'
                }));
            }
            if (hasValue(stream.DvBlSignalCompatibilityId) && compatibility === null) {
                return deepFreeze(sourceResult({
                    ...common, reason: 'invalid_dolby_vision_compatibility'
                }));
            }

            const dvRange = typeof range.key === 'string' && range.key.startsWith('dovi');
            if (profile === null) {
                if (compatibility !== null || dvRange || hasValue(stream.DvProfile)) {
                    return deepFreeze(sourceResult({
                        ...common, reason: 'dolby_vision_profile_unknown'
                    }));
                }
                return deepFreeze(sourceResult({
                    ...common,
                    state: 'not-dolby-vision',
                    reason: 'source_not_dolby_vision'
                }));
            }

            if (![5, 8].includes(profile)) {
                return deepFreeze(sourceResult({
                    ...common,
                    state: 'unsupported',
                    compatibilityId: compatibility,
                    compatibilityOrigin: compatibility === null ? 'none' : 'declared',
                    reason: 'unsupported_dolby_vision_profile'
                }));
            }

            if (profile === 5) {
                if (compatibility !== null && compatibility !== 0) {
                    return deepFreeze(sourceResult({
                        ...common,
                        state: 'contradictory',
                        compatibilityId: compatibility,
                        compatibilityOrigin: 'declared',
                        reason: 'contradictory_dolby_vision_source_metadata'
                    }));
                }
                if (range.key !== null && range.key !== 'dovi') {
                    return deepFreeze(sourceResult({
                        ...common,
                        state: range.key === 'other' ? 'unknown' : 'contradictory',
                        compatibilityId: 0,
                        compatibilityOrigin: compatibility === 0 ? 'declared' : 'profile-default',
                        baseLayer: 'none',
                        reason: range.key === 'other'
                            ? 'unrecognized_video_range'
                            : 'contradictory_dolby_vision_source_metadata'
                    }));
                }
                return deepFreeze(sourceResult({
                    ...common,
                    state: 'recognized',
                    eligible: true,
                    compatibilityId: 0,
                    compatibilityOrigin: compatibility === 0 ? 'declared' : 'profile-default',
                    mode: '5',
                    baseLayer: 'none',
                    reason: null
                }));
            }

            let effective = compatibility;
            let origin = compatibility === null ? 'none' : 'declared';
            if (effective === null) {
                if (range.key === 'doviwithhdr10') {
                    effective = 1;
                    origin = 'video-range';
                } else if (range.key === 'doviwithhlg') {
                    effective = 4;
                    origin = 'video-range';
                } else {
                    return deepFreeze(sourceResult({
                        ...common,
                        reason: 'dolby_vision_compatibility_unknown'
                    }));
                }
            }

            common.compatibilityId = effective;
            common.compatibilityOrigin = origin;

            if (![1, 4].includes(effective)) {
                return deepFreeze(sourceResult({
                    ...common,
                    state: 'unsupported',
                    reason: 'unsupported_dolby_vision_compatibility'
                }));
            }

            const allowedRanges = effective === 1
                ? [null, 'dovi', 'doviwithhdr10', 'doviwithhdr10plus', 'hdr10']
                : [null, 'dovi', 'doviwithhlg', 'hlg'];
            if (!allowedRanges.includes(range.key)) {
                const contradictory =
                    (effective === 1 && ['doviwithhlg', 'hlg'].includes(range.key)) ||
                    (effective === 4 && ['doviwithhdr10', 'doviwithhdr10plus', 'hdr10'].includes(range.key)) ||
                    range.key === 'doviwithsdr';
                return deepFreeze(sourceResult({
                    ...common,
                    state: contradictory ? 'contradictory' : 'unknown',
                    baseLayer: effective === 1 ? 'hdr10' : 'hlg',
                    reason: contradictory
                        ? 'contradictory_dolby_vision_source_metadata'
                        : 'unrecognized_video_range'
                }));
            }

            return deepFreeze(sourceResult({
                ...common,
                state: 'recognized',
                eligible: true,
                mode: effective === 1 ? '8.1' : '8.4',
                baseLayer: effective === 1 ? 'hdr10' : 'hlg',
                reason: null
            }));
        } catch (_) {
            return deepFreeze(sourceResult({reason: 'source_metadata_unknown'}));
        }
    }

    function unconfirmedOutput() {
        return {
            status: 'unconfirmed',
            format: 'unknown',
            dolbyVision: 'unknown',
            mode: null,
            baseLayer: null,
            evidence: 'none'
        };
    }

    function emptyDraft() {
        return {
            contract: ASSESSMENT_CONTRACT,
            suitable: false,
            reason: 'invalid_input',
            source: inspectSource(null),
            selection: {
                mediaSourceId: null,
                playSessionId: null,
                videoStreamIndex: null,
                audioStreamIndex: null,
                subtitleStreamIndex: null
            },
            track: {
                role: 'selected-source-video-track',
                codec: null,
                hevc: false,
                profile: null,
                compatibilityId: null,
                mode: null,
                baseLayer: 'unknown'
            },
            variant: {
                serverPlayMethod: null,
                videoDirect: null,
                videoTranscoded: null,
                dolbyVisionPreservation: 'unknown',
                preservationEvidence: null,
                nativePlaybackMode: 'not-requested'
            },
            audio: {
                policy: 'preserve-existing-selection-and-route',
                selectedIndex: null,
                nativeObjectRoute: null,
                objectFormat: null
            },
            correlation: null,
            output: unconfirmedOutput()
        };
    }

    function readCorrelation(value) {
        const selection = value?.selection;
        const session = value?.session;
        const generations = value?.generations;
        if (!selection || typeof selection !== 'object' ||
            !session || typeof session !== 'object' ||
            !generations || typeof generations !== 'object') return null;

        const result = {
            sessionIdentity: sessionIdentity(session.identity),
            sessionGeneration: generation(session.generation),
            sourceGeneration: generation(generations.source),
            selectionGeneration: generation(generations.selection),
            attempt: attemptIdentity(value.attempt),
            mediaSourceId: identifier(selection.mediaSourceId),
            playSessionId: identifier(selection.playSessionId),
            videoStreamIndex: streamIndex(selection.videoStreamIndex, false),
            audioStreamIndex: streamIndex(selection.audioStreamIndex, true),
            subtitleStreamIndex: streamIndex(selection.subtitleStreamIndex, true)
        };
        return CORRELATION_KEYS.every(key => result[key] !== null) ? result : null;
    }

    function sameCorrelation(a, b) {
        return !!a && !!b && CORRELATION_KEYS.every(key => a[key] === b[key]);
    }

    function isCurrent(assessment, current) {
        try {
            return sameCorrelation(assessment?.correlation, readCorrelation(current));
        } catch (_) {
            return false;
        }
    }

    function external(stream) {
        return stream?.IsExternal === true || stream?.DeliveryMethod === 'External';
    }

    function exactlyOneTrack(mediaSource, index, type) {
        if (index < 0) return {disabled: true, stream: null};
        const matches = mediaSource.MediaStreams.filter(stream =>
            stream && stream.Type === type && stream.Index === index);
        return matches.length === 1
            ? {disabled: false, stream: matches[0]}
            : {disabled: false, stream: null};
    }

    function assess(input) {
        const draft = emptyDraft();
        const fail = reason => {
            draft.suitable = false;
            draft.reason = reason;
            return deepFreeze(draft);
        };

        if (!input || typeof input !== 'object' || Array.isArray(input)) {
            return fail('invalid_input');
        }

        const correlation = readCorrelation(input);
        if (!correlation) return fail('invalid_session_selection_or_generation');
        draft.correlation = {...correlation};
        draft.selection = {
            mediaSourceId: correlation.mediaSourceId,
            playSessionId: correlation.playSessionId,
            videoStreamIndex: correlation.videoStreamIndex,
            audioStreamIndex: correlation.audioStreamIndex,
            subtitleStreamIndex: correlation.subtitleStreamIndex
        };
        draft.audio.selectedIndex = correlation.audioStreamIndex;

        const playbackInfo = input.playbackInfo;
        if (!playbackInfo || typeof playbackInfo !== 'object' ||
            !Array.isArray(playbackInfo.MediaSources) ||
            playbackInfo.PlaySessionId !== correlation.playSessionId) {
            return fail('playbackinfo_selection_mismatch');
        }

        const sources = playbackInfo.MediaSources.filter(source =>
            source && source.Id === correlation.mediaSourceId);
        if (sources.length !== 1) return fail('selected_media_source_unavailable');
        const mediaSource = sources[0];
        if (!Array.isArray(mediaSource.MediaStreams)) return fail('invalid_track_list');

        const videos = mediaSource.MediaStreams.filter(stream =>
            stream && stream.Type === 'Video' &&
            stream.Index === correlation.videoStreamIndex);
        if (videos.length !== 1 || external(videos[0])) {
            return fail('selected_video_track_unavailable');
        }
        const video = videos[0];

        draft.source = inspectSource(video);
        draft.track = {
            role: 'selected-source-video-track',
            codec: codec(video.Codec),
            hevc: codec(video.Codec) === 'hevc',
            profile: draft.source.profile,
            compatibilityId: draft.source.compatibilityId,
            mode: draft.source.mode,
            baseLayer: draft.source.baseLayer
        };

        if (!draft.source.eligible) return fail(draft.source.reason);
        if (!draft.track.hevc) return fail('native_requires_hevc_dolby_vision');

        const audio = exactlyOneTrack(
            mediaSource, correlation.audioStreamIndex, 'Audio');
        const subtitle = exactlyOneTrack(
            mediaSource, correlation.subtitleStreamIndex, 'Subtitle');
        if (correlation.audioStreamIndex >= 0 && (!audio.stream || external(audio.stream))) {
            return fail('selected_audio_track_unavailable');
        }
        if (correlation.subtitleStreamIndex >= 0 && !subtitle.stream) {
            return fail('selected_subtitle_track_unavailable');
        }

        // An audio plan may be DeepStreamAudio.plan's existing result. It is
        // corroborating route information only; this module never reranks audio.
        if (input.audioPlan !== undefined && input.audioPlan !== null) {
            const plan = input.audioPlan;
            if (!plan || typeof plan !== 'object' ||
                plan.selectedIndex !== correlation.audioStreamIndex) {
                return fail('stale_audio_plan');
            }
            draft.audio.nativeObjectRoute =
                plan.nativeObjectRoute === true ? true :
                plan.nativeObjectRoute === false ? false : null;
            const objectFormat = plan.source?.objectFormat;
            draft.audio.objectFormat =
                objectFormat === 'atmos' || objectFormat === 'dtsx'
                    ? objectFormat : null;
        }

        const variant = input.variant;
        if (!variant || typeof variant !== 'object' || Array.isArray(variant)) {
            return fail('qualified_variant_required');
        }
        draft.variant.serverPlayMethod =
            typeof variant.playMethod === 'string' ? variant.playMethod : null;
        draft.variant.videoDirect =
            variant.videoDirect === true ? true :
            variant.videoDirect === false ? false : null;

        if (!PLAY_METHODS.includes(variant.playMethod)) {
            return fail('unknown_server_playback_method');
        }

        const transcodingInfo = mediaSource.TranscodingInfo;
        if (transcodingInfo?.IsVideoDirect === false || variant.videoDirect === false) {
            draft.variant.videoTranscoded = true;
            return fail('video_transcode');
        }
        if (variant.videoDirect !== true ||
            variant.playbackInfoGeneration !== correlation.sourceGeneration) {
            return fail('video_direct_unproven');
        }
        draft.variant.videoTranscoded = false;

        // Transcode with videoDirect=true can denote audio-only server processing.
        // It remains "Transcode"; it is never relabelled as DirectPlay here.
        const preservation = variant.dolbyVision;
        if (!preservation || typeof preservation !== 'object' ||
            preservation.preserved !== true ||
            preservation.evidence !== PRESERVATION_EVIDENCE) {
            return fail('dv_preservation_unproven');
        }
        draft.variant.preservationEvidence = preservation.evidence;

        if (codec(preservation.codec) !== 'hevc' ||
            integer(preservation.profile) !== draft.source.profile ||
            integer(preservation.compatibilityId) !== draft.source.compatibilityId ||
            preservation.mode !== draft.source.mode) {
            draft.variant.dolbyVisionPreservation = 'contradictory';
            return fail('dv_preservation_contradicts_source');
        }
        // Coexisting HDR10+ metadata is not contradictory to explicitly
        // declared DV 8.1, but neither its delivery nor native compatibility
        // follows from a generic DV-only preservation claim.
        if (draft.source.range === 'doviwithhdr10plus' && preservation.hdr10PlusPreserved !== true)
            return fail('hdr10plus_preservation_unproven');
        draft.variant.dolbyVisionPreservation = 'proven-for-selected-variant';

        const capabilities = input.capabilities?.nativeDolbyVision;
        if (!capabilities || capabilities.contract !== NATIVE_CONTRACT) {
            return fail('native_contract_unavailable');
        }
        if (capabilities.available !== true) return fail('native_unavailable');
        if (!Array.isArray(capabilities.modes) ||
            !capabilities.modes.includes(draft.source.mode)) {
            return fail('native_dolby_vision_mode_unsupported');
        }
        if (draft.source.range === 'doviwithhdr10plus' &&
            capabilities.supportsDolbyVisionWithHdr10Plus !== true) {
            return fail('native_hdr10plus_combination_unconfirmed');
        }
        if (subtitle.stream && external(subtitle.stream) &&
            capabilities.allowsExternalSubtitle !== true) {
            return fail('native_external_subtitle_unconfirmed');
        }
        if (draft.audio.nativeObjectRoute === true &&
            capabilities.preservesObjectAudioRoute !== true) {
            return fail('native_audio_route_unconfirmed');
        }

        draft.suitable = true;
        draft.reason = null;
        return deepFreeze(draft);
    }

    function evaluate(input) {
        try {
            return assess(input);
        } catch (_) {
            const fallback = emptyDraft();
            fallback.reason = 'invalid_input';
            return deepFreeze(fallback);
        }
    }

    // The native receiver must resolve this request through Gustav's already
    // authenticated session/relay path. No URL, token or new transport is supplied.
    function handoff(assessment, current) {
        try {
            if (!assessment?.suitable || !isCurrent(assessment, current)) return null;
            const c = assessment.correlation;
            const source = assessment.source;
            return deepFreeze({
                enabled: true,
                contract: NATIVE_CONTRACT,
                correlation: {...c},
                mediaSourceId: c.mediaSourceId,
                playSessionId: c.playSessionId,
                videoStreamIndex: c.videoStreamIndex,
                audioStreamIndex: c.audioStreamIndex,
                subtitleStreamIndex: c.subtitleStreamIndex,
                playback: {
                    serverPlayMethod: assessment.variant.serverPlayMethod,
                    video: 'direct',
                    native: 'dolby-vision-requested',
                    outputConfirmed: false
                },
                video: {
                    codec: 'hevc',
                    profile: source.profile,
                    compatibilityId: source.compatibilityId,
                    mode: source.mode,
                    baseLayer: source.baseLayer,
                    preserveDolbyVision: true,
                    processRpu: true
                },
                audio: {
                    streamIndex: c.audioStreamIndex,
                    policy: 'preserve-existing-selection-and-route',
                    nativeObjectRoute: assessment.audio.nativeObjectRoute,
                    objectFormat: assessment.audio.objectFormat
                },
                subtitle: {
                    streamIndex: c.subtitleStreamIndex,
                    policy: 'preserve-existing-selection'
                },
                processing: {
                    audioFilters: false,
                    videoFilters: false,
                    artificialSurround: false
                }
            });
        } catch (_) {
            return null;
        }
    }

    // This records a native attestation; it does not manufacture one. Gustav must
    // call it only after the native pipeline has actually established the stated
    // output. Source metadata, track negotiation and handoff acceptance are not
    // sufficient reasons to call it.
    function recordOutput(assessment, current, report) {
        try {
            if (!assessment?.suitable || !isCurrent(assessment, current) ||
                !report || report.contract !== OUTPUT_CONTRACT ||
                !sameCorrelation(assessment.correlation, report.correlation)) {
                return null;
            }

            if (report.format === 'dolby-vision') {
                if (report.rpuProcessed !== true ||
                    report.mode !== assessment.source.mode) return null;
                return deepFreeze({
                    status: 'native-confirmed',
                    format: 'dolby-vision',
                    dolbyVision: true,
                    mode: report.mode,
                    baseLayer: assessment.source.baseLayer,
                    evidence: 'native-output-attestation',
                    correlation: {...assessment.correlation}
                });
            }

            if (['hdr10', 'hlg', 'sdr'].includes(report.format)) {
                return deepFreeze({
                    status: 'native-confirmed',
                    format: report.format,
                    dolbyVision: false,
                    mode: null,
                    baseLayer: null,
                    evidence: 'native-output-attestation',
                    correlation: {...assessment.correlation}
                });
            }
            return null;
        } catch (_) {
            return null;
        }
    }

    return Object.freeze({
        ASSESSMENT_CONTRACT,
        NATIVE_CONTRACT,
        OUTPUT_CONTRACT,
        PRESERVATION_EVIDENCE,
        evaluate,
        handoff,
        isCurrent,
        recordOutput,
        inspectSource
    });
});

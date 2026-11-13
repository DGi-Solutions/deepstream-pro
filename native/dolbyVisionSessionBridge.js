/* Session-bound Dolby Vision assessment for the existing native HLS path.
 * This module does not perform playback, networking or credential handling. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./dolbyVisionSelection.js'));
  else root.DeepStreamDolbyVisionSession = factory(root.DeepStreamDolbyVision);
})(typeof window === 'object' ? window : globalThis, function (selection) {
  'use strict';

  const v2ChannelLimits = Object.freeze({aac:2, ac3:6, eac3:8, flac:8, alac:8});
  // A session-bound audio request is generated only after native authorization.
  // All DV evidence and per-attempt state must come from the caller; missing
  // evidence is left missing so the selector can reject it.
  function validRequest(options, audioRequest) {
      const codec = audioRequest?.selection?.codec, channels = audioRequest?.selection?.channels;
      const v2 = audioRequest?.contract === 'deepstream-video-hls-v2' && Object.hasOwn(v2ChannelLimits, codec) &&
          Number.isInteger(channels) && channels >= 1 && channels <= v2ChannelLimits[codec];
      return !!(selection && options && audioRequest &&
          ((audioRequest.contract === 'deepstream-audio-hls-v1' && codec === 'eac3') ||
           (audioRequest.contract === 'deepstream-video-hls-v1' && ['aac','eac3'].includes(codec)) || v2) &&
          audioRequest.enabled === true &&
          typeof audioRequest.bindingId === 'string' && audioRequest.bindingId &&
          audioRequest.sourceUrl === options.url &&
          audioRequest.playSessionId === options.playSessionId &&
          audioRequest.selection?.mediaSourceId === options.mediaSource?.Id &&
          audioRequest.selection?.audioStreamIndex === options.mediaSource?.DefaultAudioStreamIndex);
  }

  function inspectBoundSource(options, audioRequest) {
    try {
      if (!validRequest(options, audioRequest) || !Array.isArray(options.mediaSource.MediaStreams)) return null;
      const videos = options.mediaSource.MediaStreams.filter(stream => stream && stream.Type === 'Video');
      const requested = options.mediaSource.DefaultVideoStreamIndex;
      const candidates = requested == null ? videos : videos.filter(stream => stream.Index === requested);
      if (candidates.length !== 1 || !Number.isSafeInteger(candidates[0].Index) || candidates[0].Index < 0) return null;
      const observed = selection.inspectSource(candidates[0]);
      return Object.freeze({kind:'source-metadata', sourceVideoIndex:candidates[0].Index,
        profile:observed.profile, mode:observed.mode, baseLayer:observed.baseLayer,
        eligible:observed.eligible, reason:observed.reason});
    } catch (_) { return null; }
  }

  function assess(options, audioRequest, context) {
    try {
      if (!context || !validRequest(options, audioRequest)) return null;

      return selection.evaluate({
        playbackInfo: context.playbackInfo,
        selection: {
          mediaSourceId: audioRequest.selection.mediaSourceId,
          playSessionId: audioRequest.playSessionId,
          videoStreamIndex: context.videoStreamIndex,
          audioStreamIndex: audioRequest.selection.audioStreamIndex,
          subtitleStreamIndex: options.mediaSource.DefaultSubtitleStreamIndex
        },
        session: {identity: audioRequest.bindingId, generation: context.sessionGeneration},
        generations: context.generations,
        attempt: context.attempt,
        variant: context.variant,
        capabilities: context.capabilities,
        audioPlan: context.audioPlan
      });
    } catch (_) { return null; }
  }

  return Object.freeze({assess, inspectBoundSource});
});

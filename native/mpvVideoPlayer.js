/* eslint-disable indent */
(function() {
    function getMediaStreamAudioTracks(mediaSource) {
        return mediaSource.MediaStreams.filter(function (s) {
            return s.Type === 'Audio';
        });
    }

    function clampVolume(val) {
        return Math.min(100, Math.max(0, Math.round(val)));
    }

    function nativeControlToken() {
        try {
            if (typeof window.crypto?.getRandomValues !== 'function') return null;
            const bytes = new Uint8Array(16);
            window.crypto.getRandomValues(bytes);
            return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
        } catch (_) { return null; }
    }

    // Test request only. Native code verifies the fetched master bytes before
    // it can open AVPlayer; these fields are not source or renderer evidence.
    function experimentalAvFixtureRequest(options, capabilities) {
        const request = options.experimentalAv;
        if (capabilities.experimentalAvFixtureAvailable !== true || !request ||
            request.enabled !== true || request.fixture !== 'public-apple-joc-v1' ||
            request.sourceSha256 !== '70a29e4e5a56e79127db3820b98ce74a79e52e780beb57ff99eb5f90b428cc9e' ||
            typeof request.sourceUrl !== 'string' || /[?#]/.test(request.sourceUrl) ||
            request.sourceUrl !== options.url || request.audioSelection !== 'single-joc' ||
            request.subtitles !== 'off' || request.transport !== 'public-loopback-fixture' ||
            options.playMethod !== 'DirectPlay' || options.mediaSource?.DefaultAudioStreamIndex === -1 ||
            (options.mediaSource?.DefaultSubtitleStreamIndex ?? -1) !== -1) return null;
        const audio = options.mediaSource?.MediaStreams?.filter(stream => stream.Type === 'Audio') || [];
        if (audio.length !== 1 || audio[0].IsExternal || audio[0].Codec !== 'eac3' ||
            options.mediaSource.DefaultAudioStreamIndex !== audio[0].Index) return null;
        try {
            const url = new URL(request.sourceUrl);
            if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' ||
                !url.port || Number(url.port) < 1024 || url.pathname !== '/single-joc-master.m3u8' ||
                url.username || url.password || url.search || url.hash || url.href !== request.sourceUrl) return null;
        } catch (_) { return null; }
        return {
            enabled: true, fixture: 'public-apple-joc-v1', sourceUrl: request.sourceUrl,
            sourceSha256: request.sourceSha256, audioSelection: 'single-joc',
            subtitles: 'off', transport: 'public-loopback-fixture'
        };
    }

    class mpvVideoPlayer {
        constructor({ events, loading, appRouter, globalize, appHost, appSettings, confirm, dashboard }) {
            this.events = events;
            this.loading = loading;
            this.appRouter = appRouter;
            this.globalize = globalize;
            this.appHost = appHost;
            this.appSettings = appSettings;

            this.setTransparency = dashboard.default.setBackdropTransparency.bind(dashboard);

            /**
             * @type {string}
             */
            this.name = 'DeepStream Player';
            /**
             * @type {string}
             */
            this.type = 'mediaplayer';
            /**
             * @type {string}
             */
            this.id = 'mpvvideoplayer';
            this.syncPlayWrapAs = 'htmlvideoplayer';
            this.priority = -1;
            this.useFullSubtitleUrls = true;
            /**
             * @type {boolean}
             */
            this.isLocalPlayer = true;
            /**
             * @type {boolean}
             */
            this.isFetching = false;

            /**
             * @type {HTMLDivElement | null | undefined}
             */
            this._videoDialog = undefined;
            /**
             * @type {number | undefined}
             */
            this._subtitleTrackIndexToSetOnPlaying = undefined;
            /**
             * @type {number | null}
             */
            this._audioTrackIndexToSetOnPlaying = undefined;
            /**
             * @type {boolean | undefined}
             */
            this._showTrackOffset = undefined;
            /**
             * @type {number | undefined}
             */
            this._currentTrackOffset = undefined;
            /**
             * @type {string[] | undefined}
             */
            this._supportedFeatures = undefined;
            /**
             * @type {string | undefined}
             */
            this._currentSrc = undefined;
            /**
             * @type {boolean | undefined}
             */
            this._started = undefined;
            /**
             * @type {boolean | undefined}
             */
            this._timeUpdated = undefined;
            /**
             * @type {number | null | undefined}
             */
            this._currentTime = undefined;
            /**
             * @private (used in other files)
             * @type {any | undefined}
             */
            this._currentPlayOptions = undefined;
            /**
             * @type {any | undefined}
             */
            this._lastProfile = undefined;
            /**
             * @type {number | undefined}
             */
            this._duration = undefined;
            /**
             * @type {boolean}
             */
            this._paused = false;
            /**
             * @type {int}
             */
            this._volume = 100;
            /**
             * @type {boolean}
             */
            this._muted = false;
            /**
             * @type {float}
             */
            this._playRate;
            /**
             * @type {boolean}
             */
            this._hasConnection = false;
            /**
             * @type {Array<{start: number, end: number}>}
             */
            this._bufferedRanges = [];

            /**
             * @private
             */
            this.onBufferedRangesUpdated = (ranges) => {
                this._bufferedRanges = ranges;
            };

            /**
             * @private
             */
            this.onEnded = () => {
                this.onEndedInternal();
            };

            /**
             * @private
             */
            this.onTimeUpdate = (time) => {
                if (time && !this._timeUpdated) {
                    this._timeUpdated = true;
                }

                this._currentTime = time;
                this.events.trigger(this, 'timeupdate');
            };

            /**
             * @private
             */
            this.onPlaying = () => {
                this._audioEnhancementController?.refreshStatus(this._audioEnhancementSession);
                if (!this._started) {
                    this._started = true;

                    this.loading.hide();

                    const volume = clampVolume(this.getSavedVolume() * 100);
                    this.setVolume(volume, false);

                    this.setPlaybackRate(this.getPlaybackRate());

                    // Hide backdrop when playback starts
                    const dlg = this._videoDialog;
                    if (dlg) {
                        dlg.style.backgroundImage = '';
                    }

                    // Navigate to OSD view to show playback screen
                    if (this._currentPlayOptions.fullscreen) {
                        this.appRouter.showVideoOsd();
                        // Lower video dialog z-index so OSD can receive input
                        if (dlg) {
                            dlg.style.zIndex = 'unset';
                        }
                    }

                    // Keep video fullscreen - native OSD is above it
                    window.api.player.setVideoRectangle(0, 0, 0, 0);
                }

                if (this._paused) {
                    this._paused = false;
                    this.events.trigger(this, 'unpause');
                }

                this.startFormatActivationMonitor();
                this.events.trigger(this, 'playing');
            };

            /**
             * @private
             */
            this.onPause = () => {
                this._paused = true;
                // For Syncplay ready notification
                this.events.trigger(this, 'pause');
            };

            this.onWaiting = () => {
                this.events.trigger(this, 'waiting');
            };

            /**
             * @private
             * @param e {Event} The event received from the `<video>` element
             */
            this.onError = async (error) => {
                this.invalidateAudioEnhancement();
                this.removeMediaDialog();
                console.error(`media error: ${error}`);

                const errorData = {
                    type: 'mediadecodeerror'
                };

                try {
                    await confirm({
                        title: "Playback Failed",
                        text: `Playback failed with error "${error}". Retry with transcode? (Note this may hang the player.)`,
                        cancelText: "Cancel",
                        confirmText: "Retry"
                    });
                } catch (ex) {
                    // User declined retry
                    errorData.streamInfo = {
                        // Prevent jellyfin-web retrying with transcode
                        // which crashes the player
                        mediaSource: {
                            SupportsTranscoding: false
                        }
                    };
                }

                this.events.trigger(this, 'error', [errorData]);
            };

            this.onDuration = (duration) => {
                this._duration = duration;
            };
        }

        currentSrc() {
            return this._currentSrc;
        }

        async play(options) {
            this._started = false;
            this._timeUpdated = false;
            this._currentTime = null;
            this._bufferedRanges = [];

            this.resetSubtitleOffset();
            if (options.fullscreen) {
                this.loading.show();
            }
            const elem = await this.createMediaElement(options);
            return await this.setCurrentSrc(elem, options);
        }

        getSavedVolume() {
            return this.appSettings.get('volume') || 1;
        }


        tryGetFramerate(options) {
            if (options.mediaSource && options.mediaSource.MediaStreams) {
                for (let stream of options.mediaSource.MediaStreams) {
                    if (stream.Type == "Video") {
                        return stream.RealFrameRate || stream.AverageFrameRate || null;
                    }
                }
            }
        }

        /**
         * @private
         */
        getStreamByIndex(mediaStreams, jellyIndex) {
            for (const stream of mediaStreams) {
                if (stream.Index == jellyIndex) {
                    return stream;
                }
            }
            return null;
        }

        /**
         * @private
         */
        getRelativeIndexByType(mediaStreams, jellyIndex, streamType) {
            let relIndex = 1;
            for (const source of mediaStreams) {
                if (source.Type != streamType || source.IsExternal) {
                    continue;
                }
                if (source.Index == jellyIndex) {
                    return relIndex;
                }
                relIndex += 1;
            }
            return null;
        }

        /**
         * @private
         */
        async readAudioPlayerInfo(method) {
            const native = window.api?.player;
            if (!native || typeof native[method] !== 'function') return {};
            return await new Promise(resolve => {
                let completed = false;
                const finish = value => {
                    if (completed) return;
                    completed = true;
                    clearTimeout(timer);
                    resolve(value && typeof value === 'object' ? value : {});
                };
                const timer = setTimeout(() => finish({}), 1500);
                try { native[method](finish); } catch (_) { finish({}); }
            });
        }

        async setCurrentSrc(elem, options) {
            this._dvEvidenceRevision = (this._dvEvidenceRevision || 0) + 1;
            this._dvSourceEvidence = null;
            this.stopFormatActivationMonitor();
            this._nativeControlToken = null;
            this._nativeOriginalAudioIndex = null;
            const generation = (this._audioSelectionGeneration || 0) + 1;
            this._audioSelectionGeneration = generation;
            const enhancements = window.DeepStreamAudioEnhancements?.create(window);
            this._audioEnhancementController = enhancements;
            const enhancementIdentity = enhancements?.identityForPlayback(options);
            const capabilities = await this.readAudioPlayerInfo('getAudioCapabilities');
            if (this._audioSelectionGeneration !== generation) return;
            if (enhancementIdentity && !enhancements.identityCurrent(enhancementIdentity)) return;
            this._audioCapabilities = capabilities;
            const fixtureRequest = experimentalAvFixtureRequest(options, capabilities);
            const negotiated = options.mediaSource?.DeepStreamNativeAudioRequest;
            const selectedV2Track = () => {
                const index = options.mediaSource?.DefaultAudioStreamIndex;
                const tracks = (options.mediaSource?.MediaStreams || [])
                    .filter(stream => stream.Type === 'Audio' && stream.Index === index);
                return tracks.length === 1 ? tracks[0] : null;
            };
            const v2Permitted = () => {
                const route = capabilities.nativeDolbyVisionAudioHlsV2, track = selectedV2Track();
                if (!track) return false;
                const codec = String(track.Codec).toLowerCase();
                return capabilities.nativeDolbyVisionHlsAvailable === true && route !== null && typeof route === 'object' &&
                    !Array.isArray(route) && route.available === true && Array.isArray(route.codecs) && route.codecs.includes(codec);
            };
            const rejectNative = () => {
                this._nativeAudioController?.clear();
                this._nativeAudioController = null;
                // Decline the existing web client's automatic lossy retry for this failed native request.
                // The original source metadata object remains unchanged for a later explicit start.
                options.mediaSource = {...options.mediaSource, SupportsTranscoding: false};
                throw new Error('Requested audio output is unavailable');
            };
            if (negotiated && (!['deepstream-audio-hls-v1','deepstream-video-hls-v1','deepstream-video-hls-v2'].includes(negotiated.contract) ||
                negotiated.itemId !== options.item?.Id || negotiated.sourceId !== options.mediaSource.Id ||
                negotiated.audioIndex !== options.mediaSource.DefaultAudioStreamIndex ||
                negotiated.playSessionId !== options.playSessionId)) rejectNative();
            const nativeAudio = !fixtureRequest && (capabilities.nativeAudioHlsAvailable === true ||
                (negotiated?.contract === 'deepstream-video-hls-v1' && capabilities.nativeDolbyVisionHlsAvailable === true) ||
                (negotiated?.contract === 'deepstream-video-hls-v2' && v2Permitted()))
                ? window.DeepStreamNativeAudio?.create(window) : null;
            if (this._nativeAudioController && this._nativeAudioController !== nativeAudio) this._nativeAudioController.clear();
            this._nativeAudioController = nativeAudio;
            let nativeAudioRequest = null;
            try { nativeAudioRequest = nativeAudio ? await nativeAudio.requestForPlayback(options, capabilities) : null; }
            catch (_) { /* Retain the original mpv path if the session bridge is unavailable. */ }
            if (this._audioSelectionGeneration !== generation) return;
            if (enhancementIdentity && !enhancements.identityCurrent(enhancementIdentity)) return;
            if (negotiated && !nativeAudioRequest) rejectNative();
            if (negotiated && nativeAudioRequest.contract !== negotiated.contract) rejectNative();
            if (!nativeAudioRequest && nativeAudio) {
                nativeAudio.clear();
                this._nativeAudioController = null;
            }
            if (nativeAudioRequest && (!Number.isInteger(nativeAudioRequest.selection?.audioStreamIndex) ||
                nativeAudioRequest.selection.audioStreamIndex !== options.mediaSource?.DefaultAudioStreamIndex)) rejectNative();
            if (nativeAudioRequest?.contract === 'deepstream-video-hls-v2' && (!v2Permitted() ||
                nativeAudioRequest.selection?.codec !== String(selectedV2Track()?.Codec).toLowerCase() ||
                nativeAudioRequest.selection?.channels !== selectedV2Track()?.Channels)) rejectNative();
            const engine = window.DeepStreamAudio;
            this._audioPlan = engine ? engine.plan({
                streams: options.mediaSource?.MediaStreams,
                selectedIndex: options.mediaSource?.DefaultAudioStreamIndex,
                mode: window.jmpInfo.settings?.audio?.streamSelection || 'auto',
                playMethod: options.playMethod,
                capabilities
            }) : null;
            if (nativeAudioRequest && this._audioPlan &&
                this._audioPlan.selectedIndex !== nativeAudioRequest.selection.audioStreamIndex) rejectNative();
            let controlToken = null;
            if (nativeAudioRequest || fixtureRequest) {
                controlToken = nativeControlToken();
                if (!controlToken || !this.connectNativeControlSignals(window.api?.player)) rejectNative();
            }
            return new Promise((resolve, reject) => {
                const val = options.url;
                this._currentSrc = val;
                console.debug("[MPV] Playback requested");

                // Convert to seconds
                const ms = (options.playerStartPositionTicks || 0) / 10000;
                this._currentPlayOptions = options;
                this._subtitleTrackIndexToSetOnPlaying = options.mediaSource.DefaultSubtitleStreamIndex == null ? -1 : options.mediaSource.DefaultSubtitleStreamIndex;
                this._audioTrackIndexToSetOnPlaying = this._audioPlan
                    ? this._audioPlan.selectedIndex : options.mediaSource.DefaultAudioStreamIndex;
                options.mediaSource.DefaultAudioStreamIndex = this._audioTrackIndexToSetOnPlaying;
                this._dvSourceEvidence = nativeAudioRequest
                    ? window.DeepStreamDolbyVisionSession?.inspectBoundSource(options, nativeAudioRequest) || null
                    : null;

                console.log('[MPV] Audio track index:', this._audioTrackIndexToSetOnPlaying);
                console.log('[MPV] Subtitle track index:', this._subtitleTrackIndexToSetOnPlaying);

                const streamdata = {type: 'video', headers: {'User-Agent': jmpInfo.userAgent}, metadata: options.item, media: {}};
                const fps = this.tryGetFramerate(options);
                if (fps) {
                    streamdata.frameRate = fps;
                }

                const player = window.api.player;

                const streams = options.mediaSource?.MediaStreams || [];

                // Remuxed and transcoded output contains the server-selected
                // track. Original stream indices only apply to DirectPlay.
                const selectedAudio = this._audioTrackIndexToSetOnPlaying;
                const audioRelIndex = selectedAudio === -1 ? -1
                    : options.playMethod !== 'DirectPlay' || selectedAudio == null ? 1
                    : this.getRelativeIndexByType(streams, selectedAudio, 'Audio') ?? 1;

                // Handle subtitle - check for external first
                let subtitleParam;
                if (this._subtitleTrackIndexToSetOnPlaying >= 0) {
                    const subStream = this.getStreamByIndex(streams, this._subtitleTrackIndexToSetOnPlaying);
                    if (subStream && subStream.DeliveryMethod === 'External' && subStream.DeliveryUrl) {
                        subtitleParam = '#,' + subStream.DeliveryUrl;
                        console.log('[MPV] External subtitle selected');
                    } else {
                        const relIndex = this.getRelativeIndexByType(streams, this._subtitleTrackIndexToSetOnPlaying, 'Subtitle');
                        subtitleParam = relIndex != null ? relIndex : -1;
                        console.log('[MPV] Mapped subtitle index:', this._subtitleTrackIndexToSetOnPlaying, '->', subtitleParam);
                    }
                } else {
                    subtitleParam = -1;
                }

                console.log('[MPV] Mapped audio index:', this._audioTrackIndexToSetOnPlaying, '->', audioRelIndex);

                const loadOptions = {startMilliseconds: ms, autoplay: true};
                if (controlToken) {
                    this._nativeControlToken = controlToken;
                    this._nativeOriginalAudioIndex = nativeAudioRequest?.selection.audioStreamIndex ?? null;
                    loadOptions.nativeControlToken = controlToken;
                }
                if (fixtureRequest) {
                    loadOptions.experimentalAv = fixtureRequest;
                    streamdata.headers = {};
                }
                if (nativeAudioRequest) {
                    loadOptions.nativeAudioHls = nativeAudioRequest;
                    streamdata.headers = {};
                }
                if (enhancements) {
                    const ticket = enhancements.preparePlayback(options, this._audioPlan);
                    loadOptions.audioEnhancement = ticket.nativeConfig;
                    loadOptions.audioEnhancementSession = ticket.session;
                    this._audioEnhancementSession = enhancements.bindPlayback(ticket, () =>
                        this._audioSelectionGeneration === generation && this._currentPlayOptions === options && this._currentSrc === val);
                }
                const session = this._audioEnhancementSession;
                player.load(val,
                    loadOptions,
                    streamdata,
                    audioRelIndex,
                    subtitleParam,
                    result => {
                        if (this._audioSelectionGeneration === generation && this._audioEnhancementSession === session) {
                            if (result === false) {
                                if (this._nativeControlToken === controlToken) {
                                    this._nativeControlToken = null;
                                    this._nativeOriginalAudioIndex = null;
                                }
                                this.invalidateAudioEnhancement();
                                const controller = this._nativeAudioController;
                                this._nativeAudioController = null;
                                controller?.clear();
                                reject(new Error('Playback request rejected'));
                                return;
                            }
                            enhancements?.refreshStatus(session);
                        }
                        resolve(result);
                    });
            });
        }

        startFormatActivationMonitor() {
            const helper = window.DeepStreamFormatActivationToast;
            if (!helper || !window.document?.body || !this._currentPlayOptions ||
                this._formatActivationMonitor?.generation === this._audioSelectionGeneration) return;
            this.stopFormatActivationMonitor();
            if (!this._formatActivationToast) {
                this._formatActivationToast = helper.create(window, {language: window.DeepStreamLocale?.language(window)});
            }
            const monitor = {id: 'play-' + (this._formatActivationSequence = (this._formatActivationSequence || 0) + 1),
                generation: this._audioSelectionGeneration, options: this._currentPlayOptions, source: this._currentSrc,
                busy: false, interval: null, expiry: null};
            this._formatActivationMonitor = monitor;
            this._formatActivationToast.startSession(monitor.id);
            const live = () => this._formatActivationMonitor === monitor && this._audioSelectionGeneration === monitor.generation &&
                this._currentPlayOptions === monitor.options && this._currentSrc === monitor.source;
            const poll = async () => {
                if (!live() || monitor.busy) return;
                monitor.busy = true;
                try {
                    const [audio, video] = await Promise.all([
                        this.readAudioPlayerInfo('getAudioSignalPath'), this.readAudioPlayerInfo('getVideoSignalPath')
                    ]);
                    if (!live()) return;
                    // activation is an explicit native runtime result. Source/codec labels never create it.
                    this._formatActivationToast.observe(monitor.id, {audio: audio.activation, video: video.activation});
                } finally { monitor.busy = false; }
            };
            monitor.interval = window.setInterval(poll, 1000);
            monitor.expiry = window.setTimeout(() => {
                if (!live()) return;
                window.clearInterval(monitor.interval);
                monitor.interval = null;
            }, 15000);
            poll();
        }

        stopFormatActivationMonitor() {
            const monitor = this._formatActivationMonitor;
            this._formatActivationMonitor = null;
            if (!monitor) return;
            if (monitor.interval !== null) window.clearInterval(monitor.interval);
            if (monitor.expiry !== null) window.clearTimeout(monitor.expiry);
            this._formatActivationToast?.stop(monitor.id);
        }

        invalidateAudioEnhancement() {
            this._audioEnhancementController?.invalidatePlayback(this._audioEnhancementSession);
            this._audioEnhancementSession = null;
        }

        setSubtitleStreamIndex(index) {
            this._dvEvidenceRevision = (this._dvEvidenceRevision || 0) + 1;
            this._dvSourceEvidence = null;
            console.log('[MPV] setSubtitleStreamIndex called with index:', index);
            this._subtitleTrackIndexToSetOnPlaying = index;

            if (index < 0) {
                window.api.player.setSubtitleStream(-1);
                return;
            }

            const streams = this._currentPlayOptions?.mediaSource?.MediaStreams || [];
            const stream = this.getStreamByIndex(streams, index);

            // Handle external subtitle URL
            if (stream && stream.DeliveryMethod === 'External' && stream.DeliveryUrl) {
                console.log('[MPV] Loading external subtitle');
                window.api.player.setSubtitleStream('#,' + stream.DeliveryUrl);
                return;
            }

            // Handle embedded subtitle via relative index
            const relIndex = this.getRelativeIndexByType(streams, index, 'Subtitle');
            console.log('[MPV] Mapped subtitle index:', index, '->', relIndex);
            window.api.player.setSubtitleStream(relIndex != null ? relIndex : -1);
        }

        setSecondarySubtitleStreamIndex(index) {
            // MPV doesn't support secondary subtitles - no-op for compatibility
            console.log('[MPV] setSecondarySubtitleStreamIndex not supported, ignoring index:', index);
        }

        resetSubtitleOffset() {
            this._currentTrackOffset = 0;
            this._showTrackOffset = false;
            window.api.player.setSubtitleDelay(0);
        }

        enableShowingSubtitleOffset() {
            this._showTrackOffset = true;
        }

        disableShowingSubtitleOffset() {
            this._showTrackOffset = false;
        }

        isShowingSubtitleOffsetEnabled() {
            return this._showTrackOffset;
        }

        setSubtitleOffset(offset) {
            const offsetValue = parseFloat(offset);
            this._currentTrackOffset = offsetValue;
            window.api.player.setSubtitleDelay(Math.round(offsetValue * 1000));
        }

        getSubtitleOffset() {
            return this._currentTrackOffset;
        }

        /**
         * @private
         */
        isAudioStreamSupported() {
            return true;
        }

        /**
         * @private
         */
        getSupportedAudioStreams() {
            const profile = this._lastProfile;

            return getMediaStreamAudioTracks(this._currentPlayOptions.mediaSource).filter((stream) => {
                return this.isAudioStreamSupported(stream, profile);
            });
        }

        setAudioStreamIndex(index) {
            this._dvEvidenceRevision = (this._dvEvidenceRevision || 0) + 1;
            this._dvSourceEvidence = null;
            console.log('[MPV] setAudioStreamIndex called with index:', index);
            if (this._nativeControlToken && this._nativeOriginalAudioIndex !== null &&
                index !== this._nativeOriginalAudioIndex) {
                this.events.trigger(this, 'error', [{type: 'mediadecodeerror',
                    message: 'Audio track change requires a new playback request',
                    streamInfo: {mediaSource: {SupportsTranscoding: false}}}]);
                return;
            }
            this._audioTrackIndexToSetOnPlaying = index;
            const engine = window.DeepStreamAudio;
            if (engine) this._audioPlan = engine.plan({
                streams: this._currentPlayOptions?.mediaSource?.MediaStreams,
                selectedIndex: index, mode: 'manual', capabilities: this._audioCapabilities
            });

            const playOptions = this._currentPlayOptions;
            const streams = playOptions?.mediaSource?.MediaStreams || [];
            const serverOutput = playOptions?.playMethod !== 'DirectPlay';
            const relIndex = index < 0 ? -1 : (serverOutput ? 1 : this.getRelativeIndexByType(streams, index, 'Audio'));
            console.log('[MPV] Mapped audio index:', index, '->', relIndex);
            window.api.player.setAudioStream(relIndex != null ? relIndex : -1);
            this._audioEnhancementController?.updatePlan(this._audioEnhancementSession, this._audioPlan);
        }

        onEndedInternal() {
            this._dvEvidenceRevision = (this._dvEvidenceRevision || 0) + 1;
            this._dvSourceEvidence = null;
            this._nativeControlToken = null;
            this._nativeOriginalAudioIndex = null;
            this.stopFormatActivationMonitor();
            const source = this._currentSrc;
            this._currentTime = null;
            this._currentSrc = null;
            this._currentPlayOptions = null;
            const nativeAudio = this._nativeAudioController;
            this._nativeAudioController = null;
            nativeAudio?.clear();
            this.invalidateAudioEnhancement();
            if (source != null) this.events.trigger(this, 'stopped', [{src: source}]);
        }

        stop(destroyPlayer) {
            this._dvEvidenceRevision = (this._dvEvidenceRevision || 0) + 1;
            this._dvSourceEvidence = null;
            this._nativeControlToken = null;
            this._nativeOriginalAudioIndex = null;
            this._audioSelectionGeneration = (this._audioSelectionGeneration || 0) + 1;
            this._nativeAudioNegotiation?.clear();
            this._nativeAudioController?.clear();
            this._nativeAudioController = null;
            this.invalidateAudioEnhancement();
            window.api.player.stop();

            this.onEndedInternal();

            if (destroyPlayer) {
                this.destroy();
            }
            return Promise.resolve();
        }

        removeMediaDialog() {
            this._dvEvidenceRevision = (this._dvEvidenceRevision || 0) + 1;
            this._dvSourceEvidence = null;
            this._nativeControlToken = null;
            this._nativeOriginalAudioIndex = null;
            this.stopFormatActivationMonitor();
            this._audioSelectionGeneration = (this._audioSelectionGeneration || 0) + 1;
            this._nativeAudioController?.clear();
            this._nativeAudioController = null;
            this.invalidateAudioEnhancement();
            window.api.player.stop();

            window.api.player.setVideoRectangle(-1, 0, 0, 0);

            document.body.classList.remove('hide-scroll');

            const dlg = this._videoDialog;
            if (dlg) {
                this.setTransparency(0); // TRANSPARENCY_LEVEL.None
                this._videoDialog = null;
                dlg.parentNode.removeChild(dlg);
            }

            // Only supporting QtWebEngine here
            if (document.webkitIsFullScreen && document.webkitExitFullscreen) {
                document.webkitExitFullscreen();
            }
        }

        destroy() {
            this.stopFormatActivationMonitor();
            this._formatActivationToast?.destroy();
            this._formatActivationToast = null;
            this._nativeAudioNegotiation?.dispose();
            this._nativeAudioNegotiation = null;
            this.removeMediaDialog();

            const player = window.api.player;
            if (this._nativeControlSignalsConnected) {
                try { this._nativeControlSignalPlayer.nativeWindowStopped.disconnect(this._onNativeWindowStopped); } catch (_) {}
                try { this._nativeControlSignalPlayer.nativeAudioStateChanged.disconnect(this._onNativeAudioStateChanged); } catch (_) {}
                this._nativeControlSignalsConnected = false;
                this._nativeControlSignalPlayer = null;
            }
            this._hasConnection = false;
            this._bufferedRanges = [];
            player.playing.disconnect(this.onPlaying);
            player.positionUpdate.disconnect(this.onTimeUpdate);
            player.finished.disconnect(this.onEnded);
            this._duration = undefined;
            player.updateDuration.disconnect(this.onDuration);
            player.error.disconnect(this.onError);
            player.paused.disconnect(this.onPause);
            player.bufferedRangesUpdated.disconnect(this.onBufferedRangesUpdated);
        }

        connectNativeControlSignals(player) {
            if (this._nativeControlSignalsConnected && this._nativeControlSignalPlayer === player) return true;
            if (this._nativeControlSignalsConnected) {
                try { this._nativeControlSignalPlayer.nativeWindowStopped.disconnect(this._onNativeWindowStopped); } catch (_) {}
                try { this._nativeControlSignalPlayer.nativeAudioStateChanged.disconnect(this._onNativeAudioStateChanged); } catch (_) {}
                this._nativeControlSignalsConnected = false;
                this._nativeControlSignalPlayer = null;
            }
            const stopped = player?.nativeWindowStopped, audio = player?.nativeAudioStateChanged;
            if (typeof stopped?.connect !== 'function' || typeof stopped?.disconnect !== 'function' ||
                typeof audio?.connect !== 'function' || typeof audio?.disconnect !== 'function') return false;
            this._onNativeWindowStopped ||= token => {
                if (typeof token !== 'string' || !token || token !== this._nativeControlToken) return;
                this._nativeControlToken = null;
                this._nativeOriginalAudioIndex = null;
                this._audioSelectionGeneration = (this._audioSelectionGeneration || 0) + 1;
                this._nativeAudioNegotiation?.clear();
                this.onEndedInternal();
            };
            this._onNativeAudioStateChanged ||= (token, volume, muted) => {
                if (typeof token !== 'string' || !token || token !== this._nativeControlToken ||
                    !Number.isInteger(volume) || volume < 0 || volume > 100 || typeof muted !== 'boolean') return;
                if (this._volume === volume && this._muted === muted) return;
                this._volume = volume;
                this._muted = muted;
                this.events.trigger(this, 'volumechange');
            };
            try {
                stopped.connect(this._onNativeWindowStopped);
                try { audio.connect(this._onNativeAudioStateChanged); }
                catch (error) { try { stopped.disconnect(this._onNativeWindowStopped); } catch (_) {} throw error; }
                this._nativeControlSignalsConnected = true;
                this._nativeControlSignalPlayer = player;
                return true;
            } catch (_) { return false; }
        }

        /**
         * @private
         */
        createMediaElement(options) {
            const dlg = document.querySelector('.videoPlayerContainer');

            if (!dlg) {
                const dlg = document.createElement('div');

                dlg.classList.add('videoPlayerContainer');
                dlg.style.position = 'fixed';
                dlg.style.top = 0;
                dlg.style.bottom = 0;
                dlg.style.left = 0;
                dlg.style.right = 0;
                dlg.style.display = 'flex';
                dlg.style.alignItems = 'center';

                if (options.fullscreen) {
                    dlg.style.zIndex = 1000;
                }

                const html = '';

                dlg.innerHTML = html;

                // Set backdrop if available
                if (options.backdropUrl) {
                    dlg.style.backgroundImage = `url('${options.backdropUrl}')`;
                    dlg.style.backgroundSize = 'cover';
                    dlg.style.backgroundPosition = 'center';
                }

                document.body.insertBefore(dlg, document.body.firstChild);
                this.setTransparency(2); // TRANSPARENCY_LEVEL.Full
                this._videoDialog = dlg;
                const player = window.api.player;
                if (!this._hasConnection) {
                    this._hasConnection = true;
                    player.playing.connect(this.onPlaying);
                    player.positionUpdate.connect(this.onTimeUpdate);
                    player.finished.connect(this.onEnded);
                    player.updateDuration.connect(this.onDuration);
                    player.error.connect(this.onError);
                    player.paused.connect(this.onPause);
                    player.bufferedRangesUpdated.connect(this.onBufferedRangesUpdated);

                    // Log all other signals
                    player.buffering.connect((percent) => {
                        console.log(`[MPV Signal] buffering: ${percent}`);
                    });
                    player.canceled.connect(() => console.log('[MPV Signal] canceled'));
                    player.stopped.connect(() => console.log('[MPV Signal] stopped'));
                    player.stateChanged.connect((newState, oldState) => console.log(`[MPV Signal] stateChanged: ${oldState} -> ${newState}`));
                    player.videoPlaybackActive.connect((active) => console.log(`[MPV Signal] videoPlaybackActive: ${active}`));
                    player.windowVisible.connect((visible) => console.log(`[MPV Signal] windowVisible: ${visible}`));
                    player.onVideoRecangleChanged.connect(() => console.log('[MPV Signal] onVideoRecangleChanged'));
                    player.onMetaData.connect(() => console.log('[MPV Signal] onMetaData'));
                }

                if (options.fullscreen) {
                    // At this point, we must hide the scrollbar placeholder, so it's not being displayed while the item is being loaded
                    document.body.classList.add('hide-scroll');
                }
                return Promise.resolve();
            } else {
                // we need to hide scrollbar when starting playback from page with animated background
                if (options.fullscreen) {
                    document.body.classList.add('hide-scroll');
                }

                return Promise.resolve();
            }
        }

    /**
     * @private
     */
    canPlayMediaType(mediaType) {
        return (mediaType || '').toLowerCase() === 'video';
    }

    canPlayItem(item, playOptions) {
        // Delegate to canPlayMediaType - MPV can play any video the media type check passes
        return this.canPlayMediaType(item.MediaType);
    }

    /**
     * @private
     */
    supportsPlayMethod() {
        return true;
    }

    /**
     * @private
     */
    async getDeviceProfile(item, options) {
        const helper = window.DeepStreamNativeAudioNegotiation;
        if (!this._nativeAudioNegotiation && helper) {
            this._nativeAudioNegotiation = helper.create(window, method => this.readAudioPlayerInfo(method));
        }
        const profilePromise = Promise.resolve(this.appHost?.getDeviceProfile ? this.appHost.getDeviceProfile(item, options) : {});
        let registration = null;
        try {
            const candidate = this._nativeAudioNegotiation?.registerItem(item, options, profilePromise);
            if (candidate != null) registration = Promise.resolve(candidate).catch(() => null);
        } catch (_) {
            // Keep the original profile when experimental negotiation fails.
        }
        const profile = await profilePromise;
        return (await registration) || profile;
    }

    /**
     * @private
     */
    static getSupportedFeatures() {
        return ['PlaybackRate', 'SetAspectRatio'];
    }

    supports(feature) {
        if (!this._supportedFeatures) {
            this._supportedFeatures = mpvVideoPlayer.getSupportedFeatures();
        }

        return this._supportedFeatures.includes(feature);
    }

    isFullscreen() {
        // Check native window fullscreen state
        if (window.jmpInfo && window.jmpInfo.settings && window.jmpInfo.settings.main) {
            return window.jmpInfo.settings.main.fullscreen === true;
        }
        return false;
    }

    toggleFullscreen() {
        if (window.api && window.api.input) {
            window.api.input.executeActions(['host:fullscreen']);
        }
    }

    // Save this for when playback stops, because querying the time at that point might return 0
    currentTime(val) {
        if (val != null) {
            window.api.player.seekTo(val);
            return;
        }

        return this._currentTime;
    }

    currentTimeAsync() {
        return new Promise((resolve) => {
            window.api.player.getPosition(resolve);
        });
    }

    duration() {
        if (this._duration) {
            return this._duration;
        }

        return null;
    }

    canSetAudioStreamIndex() {
        return true;
    }

    static onPictureInPictureError(err) {
        console.error(`Picture in picture error: ${err}`);
    }

    setPictureInPictureEnabled() {}

    isPictureInPictureEnabled() {
        return false;
    }

    isAirPlayEnabled() {
        return false;
    }

    setAirPlayEnabled() {}

    setBrightness() {}

    getBrightness() {
        return 100;
    }

    seekable() {
        return Boolean(this._duration);
    }

    pause() {
        window.api.player.pause();
    }

    // This is a retry after error
    resume() {
        this._paused = false;
        window.api.player.play();
    }

    unpause() {
        window.api.player.play();
    }

    paused() {
        return this._paused;
    }

    setPlaybackRate(value) {
        let playSpeed = +value; //this comes as a string from player force int for now
        this._playRate = playSpeed;
        window.api.player.setPlaybackRate(playSpeed * 1000);

        if (window.api && window.api.player) {
            window.api.player.notifyRateChange(playSpeed);
        }
    }

    getPlaybackRate() {
        if(!this._playRate) //On startup grab default
        {
            let playRate = window.jmpInfo.settings.video.default_playback_speed;

            if(!playRate) //fallback if default missing
                playRate = 1;

            this._playRate = playRate;
        }
        return this._playRate;
    }

    getSupportedPlaybackRates() {
        return [{
            name: '0.5x',
            id: 0.5
        }, {
            name: '0.75x',
            id: 0.75
        }, {
            name: '1x',
            id: 1.0
        }, {
            name: '1.25x',
            id: 1.25
        }, {
            name: '1.5x',
            id: 1.5
        }, {
            name: '1.75x',
            id: 1.75
        }, {
            name: '2x',
            id: 2.0
        }, {
            name: '2.5x',
            id: 2.5
        }, {
            name: '3x',
            id: 3.0
        }, {
            name: '3.5x',
            id: 3.5
        }, {
            name: '4.0x',
            id: 4.0
        }];
    }

    saveVolume(value) {
        if (value) {
            this.appSettings.set('volume', value);
        }
    }

    setVolume(val, save = true) {
        val = Number(val);
        if (!isNaN(val)) {
            val = clampVolume(val);
            this._volume = val;
            if (save) {
                this.saveVolume(val / 100);
                this.events.trigger(this, 'volumechange');
            }
            window.api.player.setVolume(val);
        }
    }

    getVolume() {
        return clampVolume(this._volume ?? 100);
    }

    volumeUp() {
        this.setVolume(Math.min(this.getVolume() + 2, 100));
    }

    volumeDown() {
        this.setVolume(Math.max(this.getVolume() - 2, 0));
    }

    setMute(mute, triggerEvent = true) {
        this._muted = mute;
        window.api.player.setMuted(mute);
        if (triggerEvent) {
            this.events.trigger(this, 'volumechange');
        }
    }

    isMuted() {
        return this._muted;
    }

    togglePictureInPicture() {
    }

    toggleAirPlay() {
    }

    getBufferedRanges() {
        return this._bufferedRanges;
    }

    getStats() {
        const dvEvidenceRevision = this._dvEvidenceRevision;
        const playOptions = this._currentPlayOptions || [];
        const generation = this._audioSelectionGeneration;
        const source = this._currentSrc;
        const audioPlan = this._audioPlan;
        const dvSourceEvidence = this._dvSourceEvidence;
        const categories = [];

        if (!this._currentPlayOptions) {
            return Promise.resolve({
                categories: categories
            });
        }

        const mediaCategory = {
            stats: [],
            type: 'media'
        };
        categories.push(mediaCategory);

        if (playOptions.url) {
            //  create an anchor element (note: no need to append this element to the document)
            let link = document.createElement('a');
            //  set href to any path
            link.setAttribute('href', playOptions.url);
            const protocol = (link.protocol || '').replace(':', '');

            if (protocol) {
                mediaCategory.stats.push({
                    label: this.globalize.translate('LabelProtocol'),
                    value: protocol
                });
            }

            link = null;
        }

        mediaCategory.stats.push({
            label: this.globalize.translate('LabelStreamType'),
            value: 'Video'
        });

        const videoCategory = {
            stats: [],
            type: 'video'
        };
        categories.push(videoCategory);
        if (dvSourceEvidence?.mode) {
            videoCategory.stats.push({label:'Dolby-Vision-Quelldeklaration', value:dvSourceEvidence.mode});
        }

        const audioCategory = {
            stats: [],
            type: 'audio'
        };
        categories.push(audioCategory);

        return this.readAudioPlayerInfo('getAudioSignalPath').then(path => {
            if (this._currentPlayOptions !== playOptions || this._audioSelectionGeneration !== generation || this._currentSrc !== source || this._audioPlan !== audioPlan || this._dvSourceEvidence !== dvSourceEvidence || this._dvEvidenceRevision !== dvEvidenceRevision) {
                return {categories: []};
            }
            const apple = path.backend === 'avplayer';
            const mpv = path.backend === 'mpv' || (!path.backend && (path.engine === 'libmpv' || (!path.engine && Boolean(path.outputDriver))));
            if (apple || mpv) mediaCategory.stats.push({label: 'Wiedergabe-Engine', value: apple ? 'Apple AVPlayer' : 'libmpv'});
            if (mpv && audioPlan?.source) {
                audioCategory.stats.push({label: 'Gewählte Tonspur', value: audioPlan.source.label});
                const selectionNames = {manual: 'Manuell', server_selected: 'Vom Server', capabilities_unknown: 'Unverändert (Decoder noch nicht bekannt)', no_supported_alternative: 'Unverändert (keine passende Alternative)'};
                audioCategory.stats.push({label: 'Tonspurauswahl', value: selectionNames[audioPlan.reason] || 'Automatisch'});
            }
            // AVPlayer does not expose the mpv PCM or decoder properties. A
            // source-selection check is separate from object-renderer evidence.
            if (apple) {
                const evidence = path.sourceEvidence || {};
                const sourceLabels = {
                    'manifest-single-joc-selected': 'E-AC-3 / JOC · Playlist und Auswahl bestätigt',
                    'fixture_joc_declared': 'E-AC-3 / JOC · Testquelle'
                };
                audioCategory.stats.push({label: 'Audioquelle im Stream', value: sourceLabels[evidence.status] || 'Noch nicht geprüft'});
                const available = evidence.availableAudioOptions, selected = evidence.selectedAudioOptions;
                if (Number.isInteger(available) && available > 0 && Number.isInteger(selected) && selected >= 0 && selected <= available) {
                    audioCategory.stats.push({label: 'Ausgewählte Tonspuren', value: `${selected} / ${available}`});
                }
            }
            if (mpv && path.decoder) audioCategory.stats.push({label: 'Decoder', value: path.decoder});
            if (path.outputDriver) audioCategory.stats.push({label: 'Audioausgang', value: path.outputDriver});
            if (mpv && path.decoded?.['channel-count']) audioCategory.stats.push({label: 'Decodierte Kanäle', value: String(path.decoded['channel-count'])});
            if (mpv && path.output?.['channel-count']) audioCategory.stats.push({label: 'Ausgabekanäle', value: String(path.output['channel-count'])});
            if (mpv && path.output?.format) audioCategory.stats.push({label: 'Ausgabeformat', value: path.output.format});
            if (mpv && path.output?.samplerate) audioCategory.stats.push({label: 'Abtastrate der Ausgabe', value: String(path.output.samplerate) + ' Hz'});
            if (path.outputDriver) audioCategory.stats.push({label: 'Objektwiedergabe', value: path.objectRenderingConfirmed === true ? 'Bestätigt' : 'Nicht bestätigt'});
            if (window.DeepStreamLocale) {
                const language = window.DeepStreamLocale.language(window);
                for (const stat of audioCategory.stats) {
                    stat.label = window.DeepStreamLocale.text(stat.label, language);
                    stat.value = window.DeepStreamLocale.text(stat.value, language);
                }
            }
            return this.readAudioPlayerInfo('getVideoSignalPath').then(video => {
                if (this._currentPlayOptions !== playOptions || this._audioSelectionGeneration !== generation ||
                    this._currentSrc !== source || this._audioPlan !== audioPlan || this._dvSourceEvidence !== dvSourceEvidence || this._dvEvidenceRevision !== dvEvidenceRevision) return {categories: []};
                if (video.backend === 'avplayer') {
                    const description = video.status === 'dv-track-record'
                        ? 'Dolby-Vision-Konfiguration in gewählter Videospur erkannt'
                        : video.status === 'unsupported-dv-track-record'
                            ? 'Dolby-Vision-Profil dieser Videospur nicht unterstützt'
                            : 'Gewähltes Dolby-Vision-Format nicht bestätigt';
                    videoCategory.stats.push({label:'Videospur', value:description});
                    const offered = video.hlsOffered;
                    const counts = [offered?.dv5Count, offered?.dv81Count, offered?.dv84Count];
                    if (dvSourceEvidence && offered?.status === 'offered-manifest-only' &&
                        offered.selected === 'unknown' && offered.outputConfirmed === false &&
                        Number.isInteger(offered.variantCount) && offered.variantCount > 0 && offered.variantCount <= 1024 &&
                        counts.every(value => Number.isInteger(value) && value >= 0 && value <= offered.variantCount) &&
                        counts.reduce((sum, value) => sum + value, 0) <= offered.variantCount) {
                        const modes = ['5', '8.1', '8.4'].filter((_, index) => counts[index] > 0);
                        videoCategory.stats.push({label:'Dolby-Vision-Angebot im Stream',
                            value:modes.length ? modes.join(', ') : 'Nicht erkannt'});
                        const observed = video.hlsLastObserved;
                        if (observed?.status === 'last-access-log-declaration' &&
                            observed.outputConfirmed === false && modes.includes(observed.mode) &&
                            observed.mode === dvSourceEvidence.mode) {
                            videoCategory.stats.push({label:'Zuletzt beobachtete HLS-Variante',
                                value:`Dolby Vision ${observed.mode}`});
                        }
                    }
                    videoCategory.stats.push({label:'Dolby-Vision-Ausgabe', value:'Nicht bestätigt'});
                }
                if (window.DeepStreamLocale) {
                    const language = window.DeepStreamLocale.language(window);
                    for (const stat of videoCategory.stats) {
                        stat.label = window.DeepStreamLocale.text(stat.label, language);
                        stat.value = window.DeepStreamLocale.text(stat.value, language);
                    }
                }
                return {categories};
            });
        });
    }

    getSupportedAspectRatios() {
        const options = window.jmpInfo.settingsDescriptions.video.find(x => x.key == 'aspect').options;
        const current = window.jmpInfo.settings.video.aspect;

        const getOptionName = (option) => {
            const canTranslate = {
                'normal': 'Auto',
                'zoom': 'AspectRatioCover',
                'stretch': 'AspectRatioFill',
            }
            const name = option.replace('video.aspect.', '');
            return canTranslate[name]
                ? this.globalize.translate(canTranslate[name])
                : name;
        }

        return options.map(x => ({
            id: x.value,
            name: getOptionName(x.title),
            selected: x.value == current
        }));
    }

    getAspectRatio() {
        return window.jmpInfo.settings.video.aspect;
    }

    setAspectRatio(value) {
        window.jmpInfo.settings.video.aspect = value;
    }
}
/* eslint-enable indent */

window._mpvVideoPlayer = mpvVideoPlayer;
})();

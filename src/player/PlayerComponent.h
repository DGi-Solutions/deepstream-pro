#ifndef PLAYERCOMPONENT_H
#define PLAYERCOMPONENT_H

#include <QObject>
#include <QtCore/qglobal.h>
#include <QVariant>
#include <QSet>
#include <QQuickWindow>
#include <QTimer>
#include <QTextStream>

#include <functional>

#include "ComponentManager.h"
#include "AudioEnhancementSession.h"
#include "MpvLoadEvidence.h"
#include "QtHelper.h"
#if defined(Q_OS_MAC) && defined(DEEPSTREAM_HAS_NATIVE_AV_BACKEND)
#include "ExperimentalBackendCoordinator.h"
#include "DeferredLoadGate.h"
#include "MpvStopFence.h"
#include <QNetworkAccessManager>
#include <QColor>
#include <QPointer>
#include <memory>
class QNetworkReply;
class NativeAVBackend;
#if defined(DEEPSTREAM_EXPERIMENTAL_AUDIO_HLS)
class NativeHlsSession;
class HlsSessionRelay;
#endif
#endif

#include <mpv/client.h>

class MpvController;
class AlbumArtProvider;

///////////////////////////////////////////////////////////////////////////////////////////////////
class PlayerComponent : public ComponentBase
{
  Q_OBJECT
  friend class LocalMediaController;
  Q_PROPERTY(bool avFixtureVideoActive READ avFixtureVideoActive NOTIFY avFixtureVideoActiveChanged)
  DEFINE_SINGLETON(PlayerComponent);

public:
  bool avFixtureVideoActive() const {
#if defined(Q_OS_MAC) && defined(DEEPSTREAM_HAS_NATIVE_AV_BACKEND)
    return m_avFixtureWindowColorSaved;
#else
    return false;
#endif
  }
  const char* componentName() override { return "player"; }
  bool componentExport() override { return true; }
  bool componentInitialize() override;
  void componentPostInitialize() override;

  explicit PlayerComponent(QObject* parent = nullptr);
  ~PlayerComponent() override;

  // Deprecated. Corresponds to stop() + queueMedia().
  Q_INVOKABLE bool load(const QString& url, const QVariantMap& options, const QVariantMap& metadata, const QVariant& audioStream = QVariant(), const QVariant& subtitleStream = QVariant());
#if defined(Q_OS_MAC) && defined(DEEPSTREAM_HAS_NATIVE_AV_BACKEND) && defined(DEEPSTREAM_EXPERIMENTAL_AUDIO_HLS)
  Q_INVOKABLE QString bindNativeAudioSession(const QVariantMap& request);
  Q_INVOKABLE void clearNativeAudioSession();
#endif

  // Append a media item to the internal playlist. If nothing is played yet, the
  // newly appended item will start playing immediately.
  // options:
  //  - startMilliseconds: start playback at this time (in ms)
  //  - autoplay: if false, start playback paused; if true, start normally
  Q_INVOKABLE void queueMedia(const QString& url, const QVariantMap& options, const QVariantMap &metadata, const QVariant& audioStream, const QVariant& subtitleStream);

  // This clears all items queued with queueMedia().
  // It explicitly excludes the currently playing item. The main use of this function
  // is updating the next item that should be played (for the purpose of gapless audio).
  // If you want to wipe everything, use stop().
  Q_INVOKABLE void clearQueue();

  Q_INVOKABLE virtual void seekTo(qint64 ms);

  // Stop playback and clear all queued items.
  Q_INVOKABLE virtual void stop();

  // A full reload of the stream is imminent (stop() + load())
  // Used for not resetting display mode with the next stop() call.
  Q_INVOKABLE virtual void streamSwitch();

  Q_INVOKABLE virtual void pause();
  Q_INVOKABLE virtual void play();

  // OS media integration notifications (called from JavaScript)
  Q_INVOKABLE void notifyShuffleChange(bool enabled);
  Q_INVOKABLE void notifyRepeatChange(const QString& mode);
  Q_INVOKABLE void notifyFullscreenChange(bool isFullscreen);
  Q_INVOKABLE void notifyRateChange(double rate);
  Q_INVOKABLE void notifyQueueChange(bool canNext, bool canPrevious);
  Q_INVOKABLE void notifyPlaybackStop(bool isNavigating);
  Q_INVOKABLE void notifyDurationChange(qint64 durationMs);
  Q_INVOKABLE void notifyPlaybackState(const QString& state);
  Q_INVOKABLE void notifyPosition(qint64 positionMs);
  Q_INVOKABLE void notifySeek(qint64 positionMs);
  Q_INVOKABLE void notifyMetadata(const QVariantMap& metadata);
  Q_INVOKABLE void notifyVolumeChange(double volume);

  // 0-100 volume 0=mute and 100=normal
  // Ignored if no audio output active (e.g. when no file is playing).
  Q_INVOKABLE virtual void setVolume(int volume);
  // Returns 0 if no audio output active.
  Q_INVOKABLE virtual int volume();

  // Ignored if no audio output active.
  Q_INVOKABLE virtual void setMuted(bool muted);
  // Returns 0 if no audio output active.
  Q_INVOKABLE virtual bool muted();

  // Returns a QVariant of the following format:
  // QVariantList                   (list of audio device entries)
  //    QVariantMap                 (an audio device entry)
  //      "name" -> QString         (symbolic name/ID of the device)
  //      "description" -> QString  (human readable description intended for display)
  //
  Q_INVOKABLE virtual QVariant getAudioDeviceList();
  Q_INVOKABLE QVariantMap getAudioCapabilities() const;
  Q_INVOKABLE QVariantMap getAudioSignalPath() const;
  Q_INVOKABLE QVariantMap getVideoSignalPath() const;
#ifdef DEEPSTREAM_HLS_CONTROLLED_MPV_TEST
  Q_INVOKABLE QVariantMap getControlledSwitchDiagnostics() const;
#endif
  // Scoped to the currently loaded file; a stale UI response must not alter another title.
  Q_INVOKABLE QVariantMap setAudioEnhancementForSession(const QString& session, const QVariantMap& settings);
  Q_INVOKABLE QVariantMap getAudioEnhancementStatusForSession(const QString& session) const;
  // Uses the "name" from the device list.
  Q_INVOKABLE virtual void setAudioDevice(const QString& name);

  Q_INVOKABLE virtual void setAudioStream(const QVariant& audioStream);
  Q_INVOKABLE virtual void setSubtitleStream(const QVariant& subtitleStream);

  Q_INVOKABLE virtual void setAudioDelay(qint64 milliseconds);
  Q_INVOKABLE virtual void setSubtitleDelay(qint64 milliseconds);

  // If enabled, hide the web view (whether it's OSD or not), and show video
  // only. If no video is running, render a black background only.
  Q_INVOKABLE virtual void setVideoOnlyMode(bool enable);

  Q_INVOKABLE void userCommand(QString command);

  // Set the region in which video should be rendered. This uses Qt pixel
  // coordinates (x=0,y=0 is the top/left corner).
  // If the aspect ratio mismatches, the video will be letterboxed or pillarboxed.
  // The lower/right pixel border is always excluded.
  // setVideoRectangle(-1, -1, -1 , -1) will revert to the default and
  // automatically use the whole window. (Same if the rectangle is 0-sized.)
  Q_INVOKABLE void setVideoRectangle(int x, int y, int w, int h);

  Q_INVOKABLE void setPlaybackRate(int rate);

  // Cached from the observed playback-time property, in milliseconds.
  Q_INVOKABLE qint64 getPosition();
  // Cached from the observed duration property, in milliseconds.
  Q_INVOKABLE qint64 getDuration();

  Q_INVOKABLE QVariantList getWebPlaylist() const;
  Q_INVOKABLE QString getCurrentWebPlaylistItemId() const;
  Q_INVOKABLE void setWebPlaylist(const QVariantList& playlist, const QString& currentItemId);

  // True while the video output is up (stays true while paused).
  Q_INVOKABLE bool isVideoWindowVisible() const { qInfo() << m_windowVisible; return m_windowVisible; }

  QRect videoRectangle() { return m_videoRectangle; }

  AlbumArtProvider* albumArtProvider() const { return m_albumArtProvider; }

  void setMpvController(MpvController* controller) {
    if (!m_mpv)
      m_mpv = controller;
  }
  void initializeMpv();

  virtual void setWindow(QQuickWindow* window);

  QString videoInformation() const;

  static QStringList AudioCodecsAll() { return { "ac3", "dts", "eac3", "dts-hd", "truehd" }; };
  static QStringList AudioCodecsSPDIF() { return { "ac3", "dts" }; };

  enum class State {
    finished,
    canceled,
    error,
    paused,
    playing,
    buffering,
  };

  enum class MediaType {
    Subtitle,
    Audio,
  };

public Q_SLOTS:
  void updateAudioDeviceList();
  void setAudioConfiguration();
  void setSubtitleConfiguration();
  void setVideoConfiguration();
  void setOtherConfiguration();
  void updateAudioConfiguration();
  void updateSubtitleConfiguration();
  void updateVideoConfiguration();
  void updateConfiguration();
  void stopPlaybackInternal();
  bool loadAccepted(const QString&, const QVariantMap&, const QVariantMap&, const QVariant&, const QVariant&, quint64);

private Q_SLOTS:
  void handleMpvEvents();
  void onRestoreDisplay();
  void onRefreshRateChange();
  void updateAudioDevice();

Q_SIGNALS:
  void playbackOwnerChangeRequested();
  void playbackQueueChangeRequested();
  void mpvEntryStarted(qint64 entry);
  void mpvEntryLoaded(qint64 entry);
  void mpvEntryFailed(qint64 entry);
  void avFixtureVideoActiveChanged();
#if defined(Q_OS_MAC) && defined(DEEPSTREAM_HAS_NATIVE_AV_BACKEND) && defined(DEEPSTREAM_EXPERIMENTAL_AUDIO_HLS)
  void nativeAudioSessionBindingResult(const QString& bindingId,bool success);
#endif
  // The following signals correspond to the State enum above.
  void playing();                 // playback is progressing (audio playing, pictures are moving)
  void buffering(float percent);  // temporary state during "playing", or during media loading
  void paused();                  // paused (covers all sub-states)
  void finished();                // playback finished successfully
  void canceled();                // playback was stopped (by user/via API)
  void error(const QString& msg); // playback stopped due to external error
  // To be phased out. Raised on finished() and canceled().
  void stopped();                 // playback finished successfully, or was stopped with stop()
  void stateChanged(State newState, State oldState); // all state changes

  // true if the video (or music) is actually playing
  // false if nothing is loaded, playback is paused, during seeking, or media is being loaded
  void videoPlaybackActive(bool active);
  void windowVisible(bool visible);
  // emitted as soon as the duration of the current file is known
  void updateDuration(qint64 milliseconds);
  void playbackRateChanged(double rate);

  // Use getPosition() for the precise cached position
  // when a resolution higher than the update interval is required
  void positionUpdate(quint64);

  void onVideoRecangleChanged();

  void onMpvEvents();

  void onMetaData(const QVariantMap &meta, QUrl baseUrl);

  void webPlaylistChanged(const QVariantList& playlist, const QString& currentItemId);

  // OS media integration signals (for MPRIS, SMTC, etc.)
  void shuffleChanged(bool enabled);
  void repeatChanged(const QString& mode);
  void fullscreenChanged(bool isFullscreen);
  void rateChanged(double rate);
  void queueChanged(bool canNext, bool canPrevious);
  void playbackStopped(bool isNavigating);
  void durationChanged(qint64 durationMs);
  void playbackStateChanged(const QString& state);
  void positionChanged(qint64 positionMs);
  void seekPerformed(qint64 positionMs);
  void metadataChanged(const QVariantMap& metadata);
  void volumeChanged(double volume);
  void nativeAudioStateChanged(const QString& playbackToken, int volume, bool muted);
  void nativeWindowStopped(const QString& playbackToken);

  // Buffered ranges from demuxer-cache-state, as list of {start, end} in ticks
  void bufferedRangesUpdated(const QVariantList& ranges);

private:
  // this is the function actually implemented in the backends. the variantmap contains
  // a few known keys:
  // * subtitleStreamIndex
  // * subtitleStreamIdentifier
  // * audioStreamIndex
  // * audioStreamIdentifier
  // * viewOffset
  //
  void loadWithOptions(const QVariantMap& options);
  void setQtQuickWindow(QQuickWindow* window);
  void updatePlaybackState();
  void handleMpvEvent(mpv_event *event);
  // Potentially switch the display refresh rate, and return true if the refresh rate
  // was actually changed.
  bool switchDisplayFrameRate();
  void checkCurrentAudioDevice(const QSet<QString>& old_devs, const QSet<QString>& new_devs);
  void appendAudioFormat(QTextStream& info, const QString& property) const;
  void updateVideoAspectSettings();
  QVariantList findStreamsForURL(const QString &url);
  void reselectStream(const QVariant &streamSelection, MediaType target);
  void queueMediaInternal(const QString& url, const QVariantMap& options, const QVariantMap& metadata,
                          const QVariant& audioStream, const QVariant& subtitleStream);

  QVariantMap setAudioEnhancement(const QVariantMap& settings);
  QVariantMap getAudioEnhancementStatus() const;
  QVariantMap sanitizeAudioEnhancement(const QVariantMap& settings, QString* error) const;
  void applyAudioEnhancement();
  bool removeAudioEnhancementFilter();
  bool hasAudioEnhancementFilter() const;
  QString audioEnhancementRouteBlockReason() const;
  qint64 currentPlayingEntryId() const;
  MpvLoadEvidence m_mpvLoadEvidence;
  void refreshAudioEnhancement();
  bool removeAudioEnhancementAtBoundary();
  void invalidateAudioEnhancementRoute();
  QVariantMap scopedAudioEnhancementStatus(const QString& session, bool accepted) const;
#ifdef Q_OS_MAC
  static quint32 defaultAudioOutputDevice();
#endif

#if defined(Q_OS_MAC) && defined(DEEPSTREAM_HAS_NATIVE_AV_BACKEND)
  enum class AVFixturePhase { Idle, Hashing, Draining, Starting, Active };
  bool startAVFixture(const QString&, const QVariantMap&, const QVariantMap&, const QVariant&, const QVariant&);
#if defined(DEEPSTREAM_EXPERIMENTAL_AUDIO_HLS)
  bool startNativeAudioHls(const QString&, const QVariantMap&, const QVariantMap&, const QVariant&, const QVariant&);
  bool nativeAudioHlsRouteAllowed(bool videoRoute=false) const;
  std::unique_ptr<NativeHlsSession> m_nativeHlsSession;
  std::unique_ptr<HlsSessionRelay> m_nativeFallbackRelay;
  QUrl m_nativeFallbackMetadataOrigin;
  bool m_nativeAudioHls=false;
  bool m_nativeVideoHls=false;
  QString m_nativeAudioHlsCodec;
  QString m_nativeAudioHlsBindingId;
  int m_nativeAudioHlsExpectedChannels=0;
#endif
  bool cancelAVFixture(bool userStop);
  bool snapshotNativeAudioState();
  bool restoreMpvAudioState();
  void fallbackAVFixture();
  void beginAVFixtureDrain();
  void advanceAVFixtureDrain();
  void checkAVFixtureAudioSelection();
  void failAVFixture(const QString&);
  void setAVFixtureState(State);
  void setAVFixtureVideoVisible(bool);
  AVFixturePhase m_avFixturePhase = AVFixturePhase::Idle;
  struct AVFixtureLoadRequest { QString url; QVariantMap options, metadata; QVariant audio, subtitle; std::optional<int> volume, rate; std::optional<bool> muted; };
  DeferredLoadGate<AVFixtureLoadRequest> m_avFixtureLoads;
  quint64 m_avFixtureDrainTicket = 0;
  ExperimentalBackendCoordinator m_avFixtureCoordinator;
  MpvStopFence m_avFixtureFence;
  std::unique_ptr<NativeAVBackend> m_avFixtureBackend;
  QNetworkAccessManager m_avFixtureNetwork;
  QPointer<QNetworkReply> m_avFixtureReply;
  QTimer m_avFixtureTimeout;
  QTimer m_avFixtureAudioPoll;
  quint64 m_avFixtureEpoch = 0;
  quint64 m_avFixtureGeneration = 0;
  bool m_avFixtureStopAccepted = false;
  bool m_avFixtureMpvLoadPending = false;
  bool m_avFixtureMpvIsolated = false;
  bool m_avFixtureSeekPending = false;
  bool m_avFixtureVideoReady = false;
  bool m_avFixtureWindowColorSaved = false;
  bool m_avFixtureVideoVisibilitySaved = false;
  bool m_avFixturePreviousVideoVisible = false;
  QColor m_avFixturePreviousWindowColor;
  bool m_avFixtureCancelRequested = false;
  bool m_suppressMpvDuringDeferredHash = false;
  bool m_avFixtureGaplessSaved = false;
  QVariant m_avFixturePreviousGapless;
  bool restoreAVFixtureGapless();
  bool m_avFixtureAutoplay = true;
  bool m_avFixtureMuted = false;
  int m_avFixtureVolume = 0;
  int m_avFixtureRate = 1000;
  qint64 m_avFixtureSeek = 0;
  QString m_avFixtureUrl;
  QVariantMap m_avFixtureOptions, m_avFixtureMetadata;
  QVariant m_avFixtureAudio, m_avFixtureSubtitle;
#endif

  AudioEnhancementSession m_audioEnhancementSession;
  QVariantMap m_audioEnhancement;
  QVariantMap m_pendingAudioEnhancement;
  QString m_audioEnhancementReason = QStringLiteral("disabled");
  QString m_pendingAudioEnhancementReason = QStringLiteral("disabled");
  bool m_audioEnhancementActive = false;
  bool m_audioEnhancementLoadPrepared = false;
  bool m_audioEnhancementPlanFresh = false;
  bool m_audioEnhancementBoundaryFailed = false;
  bool m_lastQueueSucceeded = false;
#ifdef Q_OS_MAC
  QTimer m_audioOutputMonitorTimer;
  quint32 m_audioOutputDevice = 0;
#endif
  MpvController* m_mpv = nullptr;

  State m_state;
  bool m_paused;
  bool m_playbackActive;
  bool m_windowVisible;
  bool m_videoPlaybackActive;
  bool m_inPlayback;
  bool m_playbackCanceled;
  QString m_playbackError;
  int m_bufferingPercentage;
  int m_lastBufferingPercentage;
  qint64 m_durationMs;
  qint64 m_positionMs;
  qint64 m_lastPositionUpdateMs;
  qint64 m_playbackAudioDelay;
  QQuickWindow* m_window;
  float m_mediaFrameRate;
  QTimer m_restoreDisplayTimer;
  QTimer m_reloadAudioTimer;
  QSet<QString> m_audioDevices;
  bool m_streamSwitchImminent;
  bool m_doAc3Transcoding;
#ifdef Q_OS_MAC
  bool m_spatialAudioAO = false;
  QString m_savedSpatialAudioAO;
#endif
  QStringList m_passthroughCodecs;
  QVariantMap m_serverMediaInfo;
  QVariant m_currentSubtitleStream;
  QVariant m_currentAudioStream;
  QRect m_videoRectangle;

  QVariantList m_webPlaylist;
  QString m_currentWebPlaylistItemId;
  QTimer* m_playlistTimer;
  QVariantList m_queuedItems;

  AlbumArtProvider* m_albumArtProvider;
};

#endif // PLAYERCOMPONENT_H

#include "PlayerComponent.h"
#include "LocalMediaController.h"
#include <QString>
#include <Qt>
#include <QDir>
#include <QCoreApplication>
#include <QGuiApplication>
#include <QDebug>
#include <QSet>
#include "display/DisplayComponent.h"
#include "settings/SettingsComponent.h"
#include "system/SystemComponent.h"
#include "utils/Utils.h"
#include "utils/Log.h"
#include "ComponentManager.h"
#include "settings/SettingsSection.h"

#include "MpvVideoItem.h"
#include "AlbumArtProvider.h"
#include "input/InputComponent.h"
#include <MpvController>

#include <algorithm>
#include <cmath>
#include <math.h>
#include <string.h>
#include <shared/Paths.h>
#include <QRegularExpression>
#if defined(Q_OS_MAC) && defined(DEEPSTREAM_HAS_NATIVE_AV_BACKEND)
#include "NativeAVBackend.h"
#ifdef DEEPSTREAM_EXPERIMENTAL_AUDIO_HLS
#include "NativeHlsSession.h"
#include "NativeAudioHlsRoute.h"
#ifdef DEEPSTREAM_EXPERIMENTAL_DOLBY_VISION_AUDIO_V2
#include "NativeHlsAudioCodecPolicy.h"
#endif
#include "HlsSessionRelay.h"
#include <QUrlQuery>
#include <QScopedValueRollback>
#endif
#include <QCryptographicHash>
#include <QNetworkReply>
#include <QNetworkRequest>
#endif
#ifdef Q_OS_MAC
#include <CoreAudio/CoreAudio.h>
#endif

#if !defined(Q_OS_WIN)
#include <unistd.h>
#endif

#ifdef TARGET_RPI
#include <bcm_host.h>
#include <interface/vmcs_host/vcgencmd.h>
#endif

static constexpr qint64 POSITION_UPDATE_INTERVAL_MS = 100;

///////////////////////////////////////////////////////////////////////////////////////////////////
static void wakeup_cb(void *context)
{
  auto *player = static_cast<PlayerComponent*>(context);

  emit player->onMpvEvents();
}

///////////////////////////////////////////////////////////////////////////////////////////////////
PlayerComponent::PlayerComponent(QObject* parent)
  : ComponentBase(parent), m_state(State::finished), m_paused(false), m_playbackActive(false),
  m_windowVisible(false), m_videoPlaybackActive(false), m_inPlayback(false), m_playbackCanceled(false),
  m_bufferingPercentage(100), m_lastBufferingPercentage(-1),
  m_durationMs(0), m_positionMs(0), m_lastPositionUpdateMs(-1), m_playbackAudioDelay(0),
  m_window(nullptr), m_mediaFrameRate(0),
  m_restoreDisplayTimer(this), m_reloadAudioTimer(this),
  m_streamSwitchImminent(false), m_doAc3Transcoding(false),
  m_videoRectangle(-1, 0, 0, 0),
  m_albumArtProvider(new AlbumArtProvider(this))
{
  qmlRegisterType<MpvVideoItem>("Konvergo", 1, 0, "MpvVideo"); // deprecated name
  qmlRegisterType<MpvVideoItem>("Konvergo", 1, 0, "KonvergoVideo");
  qmlRegisterType<MpvVideoItem>("Konvergo", 1, 0, "MpvVideoItem");
  qmlRegisterType<LocalMediaController>("Konvergo", 1, 0, "LocalMediaController");

  m_restoreDisplayTimer.setSingleShot(true);
  connect(&m_restoreDisplayTimer, &QTimer::timeout, this, &PlayerComponent::onRestoreDisplay);

  connect(&DisplayComponent::Get(), &DisplayComponent::refreshRateChanged, this, &PlayerComponent::onRefreshRateChange);

#if defined(Q_OS_MAC) && defined(DEEPSTREAM_HAS_NATIVE_AV_BACKEND)
#ifdef DEEPSTREAM_EXPERIMENTAL_AUDIO_HLS
  m_nativeHlsSession=std::make_unique<NativeHlsSession>([this]{
    NativeHlsSession::Context context;context.verifiedBase=SystemComponent::Get().verifiedHlsBase();
    context.verifiedServerId=SystemComponent::Get().verifiedHlsServerId();
    if(m_window){if(QObject* web=m_window->findChild<QObject*>("web")){
      context.webUrl=web->property("url").toUrl();
      context.mainFrameReady=web->property("nativeHlsMainFrameReady").toBool()&&!web->property("loading").toBool();
    }}
    return context;
  });
  connect(m_nativeHlsSession.get(),&NativeHlsSession::bindingResult,this,&PlayerComponent::nativeAudioSessionBindingResult);
  connect(&SystemComponent::Get(),&SystemComponent::nativeHlsTrustChanged,this,&PlayerComponent::clearNativeAudioSession);
#endif
  m_avFixtureTimeout.setSingleShot(true);
  m_avFixtureAudioPoll.setInterval(100);
  connect(&m_avFixtureAudioPoll, &QTimer::timeout, this, &PlayerComponent::checkAVFixtureAudioSelection);
  connect(&m_avFixtureTimeout, &QTimer::timeout, this, [this] {
    if (m_avFixturePhase == AVFixturePhase::Starting) {
      if (m_avFixtureSeekPending) qWarning() << "fixture_seek_timeout";
      else if (m_avFixtureVideoReady && m_avFixtureBackend)
        qWarning() << "fixture_audio_selection_timeout" << m_avFixtureBackend->audioSelectionState(m_avFixtureGeneration);
      else qWarning() << "fixture_video_ready_timeout";
      fallbackAVFixture();
    } else if (m_avFixturePhase == AVFixturePhase::Draining) failAVFixture(QStringLiteral("fixture_mpv_stop_timeout"));
  });
#endif

  m_reloadAudioTimer.setSingleShot(true);
  connect(&m_reloadAudioTimer, &QTimer::timeout, this, &PlayerComponent::updateAudioDevice);
#ifdef Q_OS_MAC
  m_audioOutputMonitorTimer.setInterval(500);
  connect(&m_audioOutputMonitorTimer, &QTimer::timeout, this, [this]() {
    const quint32 current = defaultAudioOutputDevice();
    if (current == m_audioOutputDevice)
      return;
    m_audioOutputDevice = current;
    invalidateAudioEnhancementRoute();
    // A default-device switch need not emit a new mpv reconfiguration event.
    // Retry once after the system route settles, only for the same playlist item.
    const qint64 entry = m_audioEnhancementSession.activeEntry();
    QTimer::singleShot(250, this, [this, entry]() {
      if (entry >= 0 && currentPlayingEntryId() == entry && m_audioEnhancementSession.loaded(entry))
        refreshAudioEnhancement();
    });
  });
#endif
}

/////////////////////////////////////////////////////////////////////////////////////////
void PlayerComponent::componentPostInitialize()
{
  InputComponent::Get().registerHostCommand("player", this, "userCommand");
}

///////////////////////////////////////////////////////////////////////////////////////////////////
PlayerComponent::~PlayerComponent()
{
  // m_mpv is owned by MpvVideoItem, don't access it here as it may be destroyed
}

///////////////////////////////////////////////////////////////////////////////////////////////////
bool PlayerComponent::componentInitialize()
{
  // Defer mpv creation until setQtQuickWindow() where we get MpvQt's handle
  // m_mpv will be set via setMpvHandle() called from MpvVideoItem::initMpv()
  return true;
}

///////////////////////////////////////////////////////////////////////////////////////////////////
void PlayerComponent::initializeMpv()
{
  if (!m_mpv)
    throw FatalException(tr("Failed to load mpv."));

  // MpvQt already called mpv_initialize(), so mpv is ready
  // Properties that needed to be set before init were set in MpvVideoItem constructor

  mpv_request_log_messages(m_mpv->mpv(), "terminal-default");
  m_mpv->setProperty("msg-level", "all=v");

  mpv_set_wakeup_callback(m_mpv->mpv(), wakeup_cb, this);

  // Disable native OSD if mpv_command_string() is used.
  m_mpv->setProperty("osd-level", "0");

  // This forces the player not to rebase playback time to 0 with mkv. We
  // require this, because mkv transcoding lets files start at times other
  // than 0, and web-client expects that we return these times unchanged.
  m_mpv->setProperty( "demuxer-mkv-probe-start-time", false);

  // Upstream mpv sets this to "auto", which disables probing for HLS (at least),
  // in order to speed up playback start. The situation is more complex in PMP
  // due to us wanting to use system codecs, so always enable this.
  m_mpv->setProperty( "demuxer-lavf-probe-info", true);

  // Just discard audio output if no audio device could be opened. This gives
  // us better flexibility how to react to such errors (instead of just
  // aborting playback immediately).
  m_mpv->setProperty( "audio-fallback-to-null", "yes");

  // Do not let the decoder downmix (better customization for us).
  m_mpv->setProperty( "ad-lavc-downmix", false);

  // User-visible application name used by some audio APIs (at least PulseAudio).
  m_mpv->setProperty( "audio-client-name", QCoreApplication::applicationName());

  // User-visible stream title used by some audio APIs (at least PulseAudio and wasapi).
  m_mpv->setProperty( "title", QCoreApplication::applicationName());

  // See: https://github.com/plexinc/plex-media-player/issues/736
  m_mpv->setProperty( "cache-seek-min", 5000);

  // Disable ytdl
  m_mpv->setProperty( "ytdl", false);

  // By default libmpv asks for a redraw ahead of each frame and then blocks
  // mpv_render_context_render() until the frame is due (see render.h). The
  // render call runs on the Qt render thread, which is the GUI thread with the
  // basic render loop (macOS/OpenGL): the whole UI was capped to the video
  // frame rate and the GUI thread spent most of its time waiting. With 0, mpv
  // requests the redraw when the frame is due and rendering never blocks.
  m_mpv->setProperty( "video-timing-offset", 0);

  if (SettingsComponent::Get().ignoreSSLErrors()) {
    m_mpv->setProperty( "tls-ca-file", "");
    m_mpv->setProperty( "tls-verify", "no");
  } else {
#if !defined(Q_OS_WIN) && !defined(Q_OS_MAC)
    if (SettingsComponent::Get().autodetectCertBundle()) {
      QString certPath = SettingsComponent::Get().detectCertBundlePath();
      if (!certPath.isEmpty()) {
        m_mpv->setProperty("tls-ca-file", certPath);
        m_mpv->setProperty("tls-verify", QString("yes"));
      } else {
        throw FatalException(tr("Failed to locate CA bundle."));
      }
    } else {
      m_mpv->setProperty( "tls-verify", "yes");
    }
#else
    // We need to not use Shinchiro's personal CA file...
    m_mpv->setProperty( "tls-ca-file", "");
#endif
  }

  // Apply some low-memory settings on RPI, which is relatively memory-constrained.
#ifdef TARGET_RPI
  // The backbuffer makes seeking back faster (without having to do a HTTP-level seek)
  m_mpv->setProperty( "cache-backbuffer", 10 * 1024); // KB
  // The demuxer queue is used for the readahead, and also for dealing with badly
  // interlaved audio/video. Setting it too low increases sensitivity to network
  // issues, and could cause playback failure with "bad" files.
  m_mpv->setProperty( "demuxer-max-bytes", 50 * 1024 * 1024); // bytes
  // Specifically for enabling mpeg4.
  m_mpv->setProperty( "hwdec-codecs", "all");
  // Do not use exact seeks by default. (This affects the start position in the "loadfile"
  // command in particular. We override the seek mode for normal "seek" commands.)
  m_mpv->setProperty( "hr-seek", "no");
  // Force vo_rpi to fullscreen.
  m_mpv->setProperty( "fullscreen", true);
#endif

  // MpvQt already called mpv_initialize() - don't call it again
  // if (mpv_initialize(m_mpv) < 0)
  //   throw FatalException(tr("Failed to initialize mpv."));

  mpv_observe_property(m_mpv->mpv(), 0, "pause", MPV_FORMAT_FLAG);
  mpv_observe_property(m_mpv->mpv(), 0, "core-idle", MPV_FORMAT_FLAG);
  mpv_observe_property(m_mpv->mpv(), 0, "cache-buffering-state", MPV_FORMAT_INT64);
  mpv_observe_property(m_mpv->mpv(), 0, "playback-time", MPV_FORMAT_DOUBLE);
  mpv_observe_property(m_mpv->mpv(), 0, "vo-configured", MPV_FORMAT_FLAG);
  mpv_observe_property(m_mpv->mpv(), 0, "duration", MPV_FORMAT_DOUBLE);
  mpv_observe_property(m_mpv->mpv(), 0, "audio-device-list", MPV_FORMAT_NODE);
  mpv_observe_property(m_mpv->mpv(), 0, "video-dec-params", MPV_FORMAT_NODE);
  mpv_observe_property(m_mpv->mpv(), 0, "demuxer-cache-state", MPV_FORMAT_NODE);

  // Setup a hook with the ID 1, which is run during the file is loaded.
  // Used to delay playback start for display framerate switching.
  // (See handler in handleMpvEvent() for details.)
  // Setup a hook with the ID 2, which is run at a certain stage during loading.
  // We use it to initialize stream selections and to probe the codecs.
#if MPV_CLIENT_API_VERSION < MPV_MAKE_VERSION(1, 100)
  m_mpv->command( QStringList() << "hook-add" << "on_load" << "1" << "0");
  m_mpv->command( QStringList() << "hook-add" << "on_preloaded" << "2" << "0");
#else
  mpv_hook_add(m_mpv->mpv(), 1, "on_load", 0);
  mpv_hook_add(m_mpv->mpv(), 2, "on_preloaded", 0);
#endif

  updateAudioDeviceList();
  setAudioConfiguration();
  setVideoConfiguration();
  setSubtitleConfiguration();
  setOtherConfiguration();

  if (auto* s = SettingsComponent::Get().getSection(SETTINGS_SECTION_AUDIO))
    connect(s, &SettingsSection::valuesUpdated, this, &PlayerComponent::updateAudioConfiguration);

  if (auto* s = SettingsComponent::Get().getSection(SETTINGS_SECTION_VIDEO))
    connect(s, &SettingsSection::valuesUpdated, this, &PlayerComponent::updateVideoConfiguration);

  if (auto* s = SettingsComponent::Get().getSection(SETTINGS_SECTION_SUBTITLES))
    connect(s, &SettingsSection::valuesUpdated, this, &PlayerComponent::updateSubtitleConfiguration);

  if (auto* s = SettingsComponent::Get().getSection(SETTINGS_SECTION_OTHER))
    connect(s, &SettingsSection::valuesUpdated, this, &PlayerComponent::updateConfiguration);

  connect(this, &PlayerComponent::onMpvEvents, this, &PlayerComponent::handleMpvEvents, Qt::QueuedConnection);
  emit onMpvEvents();
}

///////////////////////////////////////////////////////////////////////////////////////////////////
void PlayerComponent::setVideoRectangle(int x, int y, int w, int h)
{
  QRect rc(x, y, w, h);
  if (rc != m_videoRectangle)
  {
    m_videoRectangle = rc;
    emit onVideoRecangleChanged();
  }
}

///////////////////////////////////////////////////////////////////////////////////////////////////
void PlayerComponent::setQtQuickWindow(QQuickWindow* window)
{
  qDebug() << "PlayerComponent::setQtQuickWindow called";
  MpvVideoItem* video = window->findChild<MpvVideoItem*>("video");
  if (!video) {
    qCritical() << "Failed to find MpvVideoItem with objectName 'video'";
    throw FatalException(tr("Failed to load video element."));
  }

  qDebug() << "Found MpvVideoItem, calling setPlayerComponent";
  video->setPlayerComponent(this);
}

///////////////////////////////////////////////////////////////////////////////////////////////////
void PlayerComponent::setWindow(QQuickWindow* window)
{
  QString vo = "libmpv";

#ifdef TARGET_RPI
  window->setFlags(Qt::FramelessWindowHint);
  vo = "rpi";
#endif

  m_window = window;
  if (!window)
    return;

  QString forceVo = SettingsComponent::Get().value(SETTINGS_SECTION_VIDEO, "debug.force_vo").toString();
  if (forceVo.size())
    vo = forceVo;

  // MpvQt sets vo=libmpv in MpvVideoItem constructor
  // Don't set it here since m_mpv may be null (MpvQt not ready yet)

  if (vo == "libmpv")
    setQtQuickWindow(window);
}

///////////////////////////////////////////////////////////////////////////////////////////////////
bool PlayerComponent::load(const QString& url, const QVariantMap& options, const QVariantMap &metadata, const QVariant& audioStream , const QVariant& subtitleStream)
{
  emit playbackOwnerChangeRequested();
#if defined(Q_OS_MAC) && defined(DEEPSTREAM_HAS_NATIVE_AV_BACKEND)
  const AVFixtureLoadRequest request{url,options,metadata,audioStream,subtitleStream,std::nullopt,std::nullopt,std::nullopt};
  const auto result=m_avFixtureLoads.load(request);
  if(result.disposition==DeferredLoadGate<AVFixtureLoadRequest>::LoadDisposition::Rejected) return false;
  if(result.disposition==DeferredLoadGate<AVFixtureLoadRequest>::LoadDisposition::Deferred) {
    m_avFixtureCancelRequested=true;
    return true;
  }
  return loadAccepted(url,options,metadata,audioStream,subtitleStream,result.revision);
#else
  return loadAccepted(url,options,metadata,audioStream,subtitleStream,0);
#endif
}

bool PlayerComponent::loadAccepted(const QString& url, const QVariantMap& options, const QVariantMap& metadata,
                                   const QVariant& audioStream, const QVariant& subtitleStream, quint64 revision)
{
#if defined(Q_OS_MAC) && defined(DEEPSTREAM_HAS_NATIVE_AV_BACKEND)
  if(!m_avFixtureLoads.isCurrent(revision)) return false;
  if(m_avFixturePhase!=AVFixturePhase::Idle) {
    if(!cancelAVFixture(false) || !m_avFixtureLoads.isCurrent(revision)) return false;
  }
#ifdef DEEPSTREAM_EXPERIMENTAL_AUDIO_HLS
  if(options.contains(QStringLiteral("nativeAudioHls")))
    return startNativeAudioHls(url,options,metadata,audioStream,subtitleStream);
#endif
  if(startAVFixture(url,options,metadata,audioStream,subtitleStream)) return true;
#else
  Q_UNUSED(revision);
#endif
  stopPlaybackInternal();
#if defined(Q_OS_MAC) && defined(DEEPSTREAM_HAS_NATIVE_AV_BACKEND)
  if(!m_avFixtureLoads.isCurrent(revision)) return false;
#endif
  if (!m_mpv || m_audioEnhancementBoundaryFailed)
    return false;

  // Only load() prepares an item; arbitrary queued files remain neutral.
  const QString token = options.value("audioEnhancementSession").toString();
  const bool validToken = !token.isEmpty() && token.size() <= 128 &&
      QRegularExpression(QStringLiteral("^[A-Za-z0-9_-]+$")).match(token).hasMatch();
  m_audioEnhancementSession.prepare(validToken ? token.toStdString() : std::string());
  QString error;
  m_pendingAudioEnhancement = sanitizeAudioEnhancement(options.value("audioEnhancement").toMap(), &error);
  m_pendingAudioEnhancementReason = error.isEmpty() ? QStringLiteral("awaiting_audio") : error;
  m_audioEnhancementLoadPrepared = validToken;
  m_lastQueueSucceeded = false;
  queueMediaInternal(url, options, metadata, audioStream, subtitleStream);
  m_audioEnhancementLoadPrepared = false;
  return m_lastQueueSucceeded;
}

///////////////////////////////////////////////////////////////////////////////////////////////////
void PlayerComponent::queueMedia(const QString& url, const QVariantMap& options, const QVariantMap &metadata, const QVariant& audioStream, const QVariant& subtitleStream)
{
  emit playbackQueueChangeRequested();
  queueMediaInternal(url, options, metadata, audioStream, subtitleStream);
}

void PlayerComponent::queueMediaInternal(const QString& url, const QVariantMap& options, const QVariantMap &metadata, const QVariant& audioStream, const QVariant& subtitleStream)
{
#if defined(Q_OS_MAC) && defined(DEEPSTREAM_HAS_NATIVE_AV_BACKEND)
  if (m_avFixturePhase != AVFixturePhase::Idle) return;
#endif
  if (!m_mpv) {
    qWarning() << "PlayerComponent::queueMedia: mpv not initialized yet";
    return;
  }

  m_lastQueueSucceeded = false;
  if (m_audioEnhancementBoundaryFailed)
    return;
  QSet<qint64> playlistBefore;
  bool beforeKnown = false;
  if (m_audioEnhancementLoadPrepared) {
    const QVariant value = m_mpv->getProperty("playlist");
    beforeKnown = value.metaType().id() == QMetaType::QVariantList;
    if (beforeKnown) {
      for (const QVariant& entry : value.toList()) {
        bool ok = false;
        const qint64 id = entry.toMap().value("id").toLongLong(&ok);
        if (!ok || id < 0) { beforeKnown = false; break; }
        playlistBefore.insert(id);
      }
    }
  }
  InputComponent::Get().cancelAutoRepeat();

  m_mediaFrameRate = metadata["frameRate"].toFloat(); // returns 0 on failure
  m_serverMediaInfo = metadata["media"].toMap();

  updateVideoConfiguration();

  QUrl qurl = url;
  QString host = qurl.host();

  QStringList command;
  command << "loadfile" << qurl.toString(QUrl::FullyEncoded);
  command << "append-play"; // if nothing is playing, play it now, otherwise just enqueue it

#if MPV_CLIENT_API_VERSION >= MPV_MAKE_VERSION(2, 3)
  command << "-1"; // insert_at_idx
#endif

  QString extraArgs;

  quint64 startMilliseconds = options["startMilliseconds"].toLongLong();
  if (startMilliseconds != 0)
    extraArgs += "start=+" + QString::number(startMilliseconds / 1000.0) + ",";

  // we're going to select these streams later, in the preloaded hook
  extraArgs += "aid=no,";
  extraArgs += "sid=no,";

  m_currentSubtitleStream = subtitleStream;
  m_currentAudioStream = audioStream;

  if (metadata["type"] == "music")
    extraArgs += "vid=no,";

  QString pause = options["autoplay"].toBool() ? "no" : "yes";
  extraArgs += "pause=" + pause + ",";

  QString userAgent = metadata["headers"].toMap()["User-Agent"].toString();
  if (userAgent.size())
    extraArgs += "user-agent=" + userAgent + ",";

  // Make sure the list of requested codecs is reset.
  extraArgs += "ad=,";
  extraArgs += "vd="; // Keep last

  command << extraArgs;

  const QVariant commandResult = m_mpv->command(command);
#if defined(Q_OS_MAC) && defined(DEEPSTREAM_HAS_NATIVE_AV_BACKEND)
  if (commandResult.metaType().id()!=qMetaTypeId<ErrorReturn>()) m_avFixtureMpvLoadPending=true;
#endif
  if (commandResult.metaType().id() == qMetaTypeId<ErrorReturn>()) {
    m_audioEnhancementSession.queued(-1);
    return;
  }
  m_lastQueueSucceeded = true;
  if (m_audioEnhancementLoadPrepared) {
    const QVariant value = m_mpv->getProperty("playlist");
    QSet<qint64> appended;
    if (beforeKnown && value.metaType().id() == QMetaType::QVariantList) {
      for (const QVariant& entry : value.toList()) {
        bool ok = false;
        const qint64 id = entry.toMap().value("id").toLongLong(&ok);
        if (!ok || id < 0) { appended.clear(); beforeKnown = false; break; }
        if (!playlistBefore.contains(id)) appended.insert(id);
      }
    }
    m_audioEnhancementSession.queued(beforeKnown && appended.size() == 1 ? *appended.constBegin() : -1);
  }

  QVariantMap jellyfinMetadata = metadata["metadata"].toMap();
  QUrl jellyfinBaseUrl = qurl.adjusted(QUrl::RemovePath | QUrl::RemoveQuery);
#if defined(Q_OS_MAC) && defined(DEEPSTREAM_HAS_NATIVE_AV_BACKEND) && defined(DEEPSTREAM_EXPERIMENTAL_AUDIO_HLS)
  if(m_nativeFallbackMetadataOrigin.isValid() && !m_nativeFallbackMetadataOrigin.isEmpty())
    jellyfinBaseUrl=m_nativeFallbackMetadataOrigin;
#endif
  emit onMetaData(jellyfinMetadata, jellyfinBaseUrl);

  // Request album art from the provider
  if (m_albumArtProvider)
    m_albumArtProvider->requestArtwork(jellyfinMetadata, jellyfinBaseUrl);
}

/////////////////////////////////////////////////////////////////////////////////////////
void PlayerComponent::streamSwitch()
{
  m_streamSwitchImminent = true;
}

///////////////////////////////////////////////////////////////////////////////////////////////////
bool PlayerComponent::switchDisplayFrameRate()
{
  qDebug() << "Video framerate:" << m_mediaFrameRate << "fps";

  if (!SettingsComponent::Get().value(SETTINGS_SECTION_VIDEO, "refreshrate.auto_switch").toBool())
  {
    qDebug() << "Not switching refresh-rate (disabled by settings).";
    return false;
  }

  bool fs = SettingsComponent::Get().value(SETTINGS_SECTION_MAIN, "fullscreen").toBool();
#ifdef KONVERGO_OPENELEC
  fs = true;
#endif
  if (!fs)
  {
    qDebug() << "Not switching refresh-rate (not in fullscreen mode).";
    return false;
  }

  if (m_mediaFrameRate < 1)
  {
    qDebug() << "Not switching refresh-rate (no known video framerate).";
    return false;
  }

  // Make sure a timer started by the previous file ending isn't accidentally
  // still in-flight. It could switch the display back after we've switched.
  m_restoreDisplayTimer.stop();

  DisplayComponent* display = &DisplayComponent::Get();
  if (!display->switchToBestVideoMode(m_mediaFrameRate))
  {
    qDebug() << "Switching refresh-rate failed or unnecessary.";
    return false;
  }

  // Make sure settings dependent on the display refresh rate are updated properly.
  updateVideoConfiguration();
  return true;
}

///////////////////////////////////////////////////////////////////////////////////////////////////
void PlayerComponent::onRestoreDisplay()
{
  // If the player will in fact start another file (or is playing one), don't restore.
  if (m_mpv->getProperty( "idle-active").toBool())
    DisplayComponent::Get().restorePreviousVideoMode();
}

///////////////////////////////////////////////////////////////////////////////////////////////////
void PlayerComponent::onRefreshRateChange()
{
  // Make sure settings dependent on the display refresh rate are updated properly.
  updateVideoConfiguration();
}

///////////////////////////////////////////////////////////////////////////////////////////////////
void PlayerComponent::updatePlaybackState()
{
  State newState = m_state;

  if (m_inPlayback) {
    if (m_paused)
    {
      newState = State::paused;
    }
    else if (m_playbackActive)
    {
      newState = State::playing;
    }
    else
    {
      // Playback not active, but also not buffering means we're in some "other"
      // waiting state. Pretend to web-client that we're buffering.
      if (m_bufferingPercentage == 100)
        m_bufferingPercentage = 0;
      newState = State::buffering;
    }
  }
  else
  {
    if (!m_playbackError.isEmpty())
      newState = State::error;
    else if (m_playbackCanceled)
      newState = State::canceled;
    else
      newState = State::finished;
  }

  if (newState != m_state)
  {
    switch (newState) {
    case State::paused:
      qInfo() << "Entering state: paused";
      emit paused();
      break;
    case State::playing:
      qInfo() << "Entering state: playing";
      emit playing();
      break;
    case State::buffering:
      qInfo() << "Entering state: buffering";
      m_lastBufferingPercentage = -1; /* force update below */
      break;
    case State::finished:
      qInfo() << "Entering state: finished";
      emit finished();
      emit stopped();
      break;
    case State::canceled:
      qInfo() << "Entering state: canceled";
      emit canceled();
      emit stopped();
      break;
    case State::error:
      qInfo() << ("Entering state: error (" + m_playbackError + ")");
      emit error(m_playbackError);
      break;
    }
    emit stateChanged(newState, m_state);
    m_state = newState;
  }

  if (m_state == State::buffering && m_lastBufferingPercentage != m_bufferingPercentage)
    emit buffering(m_bufferingPercentage);
  m_lastBufferingPercentage = m_bufferingPercentage;

  bool isVideoPlaybackActive = m_state == State::playing && m_windowVisible;
  if (m_videoPlaybackActive != isVideoPlaybackActive)
  {
    m_videoPlaybackActive = isVideoPlaybackActive;
    emit videoPlaybackActive(m_videoPlaybackActive);
  }
}

///////////////////////////////////////////////////////////////////////////////////////////////////
void PlayerComponent::handleMpvEvent(mpv_event *event)
{
#if defined(Q_OS_MAC) && defined(DEEPSTREAM_HAS_NATIVE_AV_BACKEND)
  if(event->event_id==MPV_EVENT_FILE_LOADED || event->event_id==MPV_EVENT_END_FILE) m_avFixtureMpvLoadPending=false;
#endif
  switch (event->event_id)
  {
    case MPV_EVENT_START_FILE:
    {
      m_inPlayback = true;
      const auto *start = static_cast<const mpv_event_start_file*>(event->data);
      const qint64 entry = start ? start->playlist_entry_id : -1;
      m_mpvLoadEvidence.start(entry);
      if (entry >= 0) emit mpvEntryStarted(entry);
      if (m_audioEnhancementSession.start(entry)) {
        m_audioEnhancement = m_pendingAudioEnhancement;
        m_audioEnhancementReason = m_pendingAudioEnhancementReason;
        m_pendingAudioEnhancement.clear();
        m_audioEnhancementPlanFresh = true;
      } else {
        m_audioEnhancement.clear();
        m_audioEnhancementReason = QStringLiteral("disabled");
        m_audioEnhancementPlanFresh = false;
      }
#ifdef Q_OS_MAC
      m_audioOutputDevice = defaultAudioOutputDevice();
      m_audioOutputMonitorTimer.start();
#endif
      break;
    }
    case MPV_EVENT_END_FILE:
    {
      auto *endFile = static_cast<mpv_event_end_file*>(event->data);
      if (endFile) {
        m_mpvLoadEvidence.end(endFile->playlist_entry_id);
        if (endFile->reason == MPV_END_FILE_REASON_ERROR)
          emit mpvEntryFailed(endFile->playlist_entry_id);
      }
      const bool endedEnhancement = endFile && m_audioEnhancementSession.end(endFile->playlist_entry_id);
      if (endedEnhancement) {
        if (!removeAudioEnhancementAtBoundary())
          m_audioEnhancementReason = QStringLiteral("filter_remove_failed");
        m_audioEnhancement.clear();
        m_audioEnhancementPlanFresh = false;
      }
#ifdef Q_OS_MAC
      if (endedEnhancement && !m_audioEnhancementSession.pending()) m_audioOutputMonitorTimer.stop();
#endif

      m_inPlayback = false;
      m_playbackCanceled = false;
      m_playbackError = "";

      switch (endFile->reason)
      {
        case MPV_END_FILE_REASON_ERROR:
        {
          m_playbackError = mpv_error_string(endFile->error);
          break;
        }
        case MPV_END_FILE_REASON_STOP:
        {
          m_playbackCanceled = true;
          break;
        }
        case MPV_END_FILE_REASON_EOF:
        case MPV_END_FILE_REASON_QUIT:
        case MPV_END_FILE_REASON_REDIRECT:
          break;
      }

      if (!m_streamSwitchImminent)
        m_restoreDisplayTimer.start(0);
      m_streamSwitchImminent = false;
      break;
    }
    case MPV_EVENT_FILE_LOADED:
    case MPV_EVENT_AUDIO_RECONFIG:
    {
      const qint64 playingEntry = currentPlayingEntryId();
      if (event->event_id == MPV_EVENT_FILE_LOADED) {
        const qint64 loaded = m_mpvLoadEvidence.loaded(playingEntry);
        if (loaded >= 0) emit mpvEntryLoaded(loaded);
      }
      if (m_audioEnhancementSession.loaded(playingEntry))
        refreshAudioEnhancement();
      break;
    }
    case MPV_EVENT_PROPERTY_CHANGE:
    {
      auto *prop = static_cast<mpv_event_property*>(event->data);
      if (strcmp(prop->name, "pause") == 0 && prop->format == MPV_FORMAT_FLAG)
      {
        m_paused = !!*static_cast<int*>(prop->data);
      }
      else if (strcmp(prop->name, "core-idle") == 0 && prop->format == MPV_FORMAT_FLAG)
      {
        m_playbackActive = !*static_cast<int*>(prop->data);
      }
      else if (strcmp(prop->name, "cache-buffering-state") == 0)
      {
        m_bufferingPercentage = prop->format == MPV_FORMAT_INT64 ? static_cast<int>(*static_cast<int64_t*>(prop->data)) : 100;
      }
      else if (strcmp(prop->name, "playback-time") == 0 && prop->format == MPV_FORMAT_DOUBLE)
      {
        const double pos = *static_cast<double*>(prop->data);
        if (qIsFinite(pos)) {
          m_positionMs = qMax<qint64>(qRound64(pos * 1000.0), 0);
          if (m_lastPositionUpdateMs < 0 ||
              qAbs(m_positionMs - m_lastPositionUpdateMs) >= POSITION_UPDATE_INTERVAL_MS)
          {
            emit positionUpdate(static_cast<quint64>(m_positionMs));
            m_lastPositionUpdateMs = m_positionMs;
          }
        }
      }
      else if (strcmp(prop->name, "vo-configured") == 0)
      {
        int state = prop->format == MPV_FORMAT_FLAG ? *static_cast<int*>(prop->data) : 0;
        m_windowVisible = state;
        emit windowVisible(m_windowVisible);
      }
      else if (strcmp(prop->name, "duration") == 0)
      {
        if (prop->format == MPV_FORMAT_DOUBLE) {
          const double duration = *static_cast<double*>(prop->data);
          m_durationMs = qIsFinite(duration) ? qMax<qint64>(qRound64(duration * 1000.0), 0) : 0;
        } else {
          m_durationMs = 0;
        }

        emit updateDuration(m_durationMs);
      }
      else if (strcmp(prop->name, "audio-device-list") == 0)
      {
        updateAudioDeviceList();
      }
      else if (strcmp(prop->name, "demuxer-cache-state") == 0 && prop->format == MPV_FORMAT_NODE)
      {
        constexpr double ticksPerSecond = 10000000.0; // 100ns ticks (Jellyfin's internal unit)
        auto *node = static_cast<mpv_node*>(prop->data);
        QVariantMap cacheState = mpv::qt::node_to_variant(node).toMap();
        QVariantList seekableRanges = cacheState[QStringLiteral("seekable-ranges")].toList();
        QVariantList ranges;
        for (const QVariant &entry : seekableRanges)
        {
          QVariantMap rangeMap = entry.toMap();
          QVariantMap r;
          r[QStringLiteral("start")] = static_cast<qint64>(rangeMap[QStringLiteral("start")].toDouble() * ticksPerSecond);
          r[QStringLiteral("end")] = static_cast<qint64>(rangeMap[QStringLiteral("end")].toDouble() * ticksPerSecond);
          ranges.append(r);
        }
        emit bufferedRangesUpdated(ranges);
      }
      else if (strcmp(prop->name, "video-dec-params") == 0)
      {
        // Aspect might be known now (or it changed during playback), so update settings
        // dependent on the aspect ratio.
        updateVideoAspectSettings();
      }
      break;
    }
    case MPV_EVENT_LOG_MESSAGE:
    {
      auto *msg = static_cast<mpv_event_log_message*>(event->data);
      // libmpv messages and prefixes may contain stream URLs and local paths.
      // Retain severity without persisting arbitrary media metadata.
      if (msg->log_level >= MPV_LOG_LEVEL_V)
        qDebug() << "mpv log event";
      else if (msg->log_level >= MPV_LOG_LEVEL_INFO)
        qInfo() << "mpv log event";
      else if (msg->log_level >= MPV_LOG_LEVEL_WARN)
        qWarning() << "mpv log event";
      else
        qCritical() << "mpv log event";
      break;
    }
    case MPV_EVENT_CLIENT_MESSAGE:
    {
      auto *msg = static_cast<mpv_event_client_message*>(event->data);
      if (msg->num_args < 3 || strcmp(msg->args[0], "hook_run") != 0)
        break;
      QString resumeId = QString::fromUtf8(msg->args[2]);
      // Start "on_load" hook.
      // This happens when the player is about to load the file, but no actual loading has taken part yet.
      // We use this to block loading until we explicitly tell it to continue.
      if (!strcmp(msg->args[1], "1"))
      {
        if (!removeAudioEnhancementAtBoundary()) {
          m_mpv->command(QStringList() << "stop");
          m_mpv->command(QStringList() << "hook-ack" << resumeId);
          break;
        }
        // Calling this lambda will instruct mpv to continue loading the file.
        auto resume = [=] {
          qInfo() << "resuming loading";
          m_mpv->command( QStringList() << "hook-ack" << resumeId);
        };
        if (switchDisplayFrameRate())
        {
          // Now wait for some time for mode change - this is needed because mode changing can take some
          // time, during which the screen is black, and initializing hardware decoding could fail due
          // to various strange OS-related reasons.
          // (Better hope the user doesn't try to exit Konvergo during mode change.)
          int pause = SettingsComponent::Get().value(SETTINGS_SECTION_VIDEO, "refreshrate.delay").toInt() * 1000;
          qInfo() << "waiting" << pause << "msec after rate switch before loading";
          QTimer::singleShot(pause, resume);
        }
        else
        {
          resume();
        }
        break;
      }
      // Start "on_preloaded" hook.
      // Used to initialize stream selections.
      if (!strcmp(msg->args[1], "2"))
      {
        reselectStream(m_currentSubtitleStream, MediaType::Subtitle);
        reselectStream(m_currentAudioStream, MediaType::Audio);
        m_mpv->command( QStringList() << "hook-ack" << resumeId);
        break;
      }
      break;
    }
#if MPV_CLIENT_API_VERSION >= MPV_MAKE_VERSION(1, 100)
    case MPV_EVENT_HOOK:
    {
      auto *hook = static_cast<mpv_event_hook*>(event->data);
      uint64_t id = hook->id;

      if (!strcmp(hook->name, "on_load"))
      {
        if (!removeAudioEnhancementAtBoundary()) {
          m_mpv->command(QStringList() << "stop");
          mpv_hook_continue(m_mpv->mpv(), id);
          break;
        }
        // Calling this lambda will instruct mpv to continue loading the file.
        auto resume = [=] {
          qInfo() << "resuming loading";
          mpv_hook_continue(m_mpv->mpv(), id);
        };
        if (switchDisplayFrameRate())
        {
          // Now wait for some time for mode change - this is needed because mode changing can take some
          // time, during which the screen is black, and initializing hardware decoding could fail due
          // to various strange OS-related reasons.
          // (Better hope the user doesn't try to exit Konvergo during mode change.)
          int pause = SettingsComponent::Get().value(SETTINGS_SECTION_VIDEO, "refreshrate.delay").toInt() * 1000;
          qInfo() << "waiting" << pause << "msec after rate switch before loading";
          QTimer::singleShot(pause, resume);
        }
        else
        {
          resume();
        }
        break;
      }
      if (!strcmp(hook->name, "on_preloaded"))
      {
        reselectStream(m_currentSubtitleStream, MediaType::Subtitle);
        reselectStream(m_currentAudioStream, MediaType::Audio);
        mpv_hook_continue(m_mpv->mpv(), id);
        break;
      }
      break;
    }
#endif

    default:; /* ignore */
  }
}

///////////////////////////////////////////////////////////////////////////////////////////////////
void PlayerComponent::handleMpvEvents()
{
  // Process all events, until the event queue is empty.
  while (1)
  {
    mpv_event *event = mpv_wait_event(m_mpv->mpv(), 0);
    if (event->event_id == MPV_EVENT_NONE)
      break;
#if defined(Q_OS_MAC) && defined(DEEPSTREAM_HAS_NATIVE_AV_BACKEND)
    if (m_avFixturePhase == AVFixturePhase::Draining || m_avFixturePhase == AVFixturePhase::Starting || m_avFixturePhase == AVFixturePhase::Active ||
        (m_avFixturePhase == AVFixturePhase::Hashing && m_suppressMpvDuringDeferredHash)) {
      if(m_avFixturePhase==AVFixturePhase::Hashing && m_suppressMpvDuringDeferredHash && event->event_id==MPV_EVENT_START_FILE) {
        m_avFixtureLoads.failClosed();
        m_mpv->command(QStringList()<<"stop");
        failAVFixture(QStringLiteral("fixture_unexpected_mpv_start"));
        return;
      }
      if(m_avFixturePhase==AVFixturePhase::Hashing && m_suppressMpvDuringDeferredHash && event->event_id==MPV_EVENT_END_FILE)
        m_avFixtureMpvLoadPending=false;
      if ((m_avFixturePhase == AVFixturePhase::Starting || m_avFixturePhase == AVFixturePhase::Active) && event->event_id == MPV_EVENT_START_FILE) {
        if(m_avFixtureBackend) m_avFixtureBackend->setMuted(m_avFixtureGeneration,true);
        m_mpv->command(QStringList()<<"stop");
        failAVFixture(QStringLiteral("native_unexpected_mpv_start"));
        return;
      }
      if (m_avFixturePhase == AVFixturePhase::Draining && event->event_id == MPV_EVENT_START_FILE) {
        m_avFixtureMpvLoadPending=true;m_avFixtureFence.startFile(m_avFixtureGeneration);
      }
      if (m_avFixturePhase == AVFixturePhase::Draining && event->event_id == MPV_EVENT_END_FILE && event->data)
        m_avFixtureFence.endFile(m_avFixtureGeneration, static_cast<mpv_event_end_file*>(event->data)->playlist_entry_id);
      if (event->event_id == MPV_EVENT_HOOK || event->event_id == MPV_EVENT_CLIENT_MESSAGE)
        handleMpvEvent(event);
      continue;
    }
#endif
    handleMpvEvent(event);
  }
#if defined(Q_OS_MAC) && defined(DEEPSTREAM_HAS_NATIVE_AV_BACKEND)
  if (m_avFixturePhase == AVFixturePhase::Draining) { advanceAVFixtureDrain(); return; }
  if (m_avFixturePhase == AVFixturePhase::Starting || m_avFixturePhase == AVFixturePhase::Active ||
      (m_avFixturePhase == AVFixturePhase::Hashing && m_suppressMpvDuringDeferredHash)) return;
#endif
  // Once we got all status updates, determine the new canonical state.
  updatePlaybackState();
}

///////////////////////////////////////////////////////////////////////////////////////////////////
void PlayerComponent::setVideoOnlyMode(bool enable)
{
  if (m_window)
  {
    QQuickItem *web = m_window->findChild<QQuickItem *>("web");
    if (web)
      web->setVisible(!enable);
  }
}

///////////////////////////////////////////////////////////////////////////////////////////////////
void PlayerComponent::play()
{
#if defined(Q_OS_MAC) && defined(DEEPSTREAM_HAS_NATIVE_AV_BACKEND)
  if(m_avFixturePhase==AVFixturePhase::Draining && m_avFixtureLoads.mutatePending(m_avFixtureLoads.revision(),[](auto& request){request.options.insert("autoplay",true);}))return;
  if (m_avFixturePhase == AVFixturePhase::Hashing) m_avFixtureAutoplay=true;
  if (m_avFixturePhase == AVFixturePhase::Draining || m_avFixturePhase == AVFixturePhase::Starting) { m_avFixtureAutoplay=true; return; }
  if (m_avFixturePhase == AVFixturePhase::Active) { m_avFixtureBackend->play(m_avFixtureGeneration); return; }
#endif
  if (!m_mpv) {
    qWarning() << "PlayerComponent::play: mpv not initialized yet";
    return;
  }
  QStringList args = (QStringList() << "set" << "pause" << "no");
  m_mpv->command( args);
}

///////////////////////////////////////////////////////////////////////////////////////////////////
void PlayerComponent::notifyShuffleChange(bool enabled)
{
  emit shuffleChanged(enabled);
}

///////////////////////////////////////////////////////////////////////////////////////////////////
void PlayerComponent::notifyRepeatChange(const QString& mode)
{
  emit repeatChanged(mode);
}

///////////////////////////////////////////////////////////////////////////////////////////////////
void PlayerComponent::notifyFullscreenChange(bool isFullscreen)
{
  emit fullscreenChanged(isFullscreen);
}

///////////////////////////////////////////////////////////////////////////////////////////////////
void PlayerComponent::notifyRateChange(double rate)
{
  emit rateChanged(rate);
}

///////////////////////////////////////////////////////////////////////////////////////////////////
void PlayerComponent::notifyQueueChange(bool canNext, bool canPrevious)
{
  emit queueChanged(canNext, canPrevious);
}

///////////////////////////////////////////////////////////////////////////////////////////////////
void PlayerComponent::notifyPlaybackStop(bool isNavigating)
{
  emit playbackStopped(isNavigating);
}

///////////////////////////////////////////////////////////////////////////////////////////////////
void PlayerComponent::notifyDurationChange(qint64 durationMs)
{
  emit durationChanged(durationMs);
}

///////////////////////////////////////////////////////////////////////////////////////////////////
void PlayerComponent::notifyPlaybackState(const QString& state)
{
  emit playbackStateChanged(state);
}

///////////////////////////////////////////////////////////////////////////////////////////////////
void PlayerComponent::notifyPosition(qint64 positionMs)
{
  emit positionChanged(positionMs);
}

///////////////////////////////////////////////////////////////////////////////////////////////////
void PlayerComponent::notifySeek(qint64 positionMs)
{
  emit seekPerformed(positionMs);
}

///////////////////////////////////////////////////////////////////////////////////////////////////
void PlayerComponent::notifyMetadata(const QVariantMap& metadata)
{
  emit metadataChanged(metadata);
}

///////////////////////////////////////////////////////////////////////////////////////////////////
void PlayerComponent::notifyVolumeChange(double volume)
{
  emit volumeChanged(volume);
}

///////////////////////////////////////////////////////////////////////////////////////////////////
void PlayerComponent::stop()
{
  emit playbackOwnerChangeRequested();
#if defined(Q_OS_MAC) && defined(DEEPSTREAM_HAS_NATIVE_AV_BACKEND)
  m_avFixtureLoads.stop();
#endif
  stopPlaybackInternal();
}

void PlayerComponent::stopPlaybackInternal()
{
#if defined(Q_OS_MAC) && defined(DEEPSTREAM_HAS_NATIVE_AV_BACKEND)
#ifdef DEEPSTREAM_EXPERIMENTAL_AUDIO_HLS
  if(m_avFixturePhase!=AVFixturePhase::Draining)m_nativeFallbackRelay.reset();
#endif
  if (m_avFixturePhase == AVFixturePhase::Draining) { m_avFixtureCancelRequested=true; return; }
  if (m_avFixturePhase != AVFixturePhase::Idle) {
    const bool hashing = m_avFixturePhase == AVFixturePhase::Hashing;
    const auto revision=m_avFixtureLoads.revision();
    if(!cancelAVFixture(true))return;
    if (!hashing || revision!=m_avFixtureLoads.revision()) return;
  }
#endif
  m_audioEnhancementSession.stop();
  m_audioEnhancementPlanFresh = false;
  m_audioEnhancementLoadPrepared = false;
  m_pendingAudioEnhancement.clear();
#ifdef Q_OS_MAC
  m_audioOutputMonitorTimer.stop();
#endif
  if (!removeAudioEnhancementAtBoundary())
    m_audioEnhancementReason = QStringLiteral("filter_remove_failed");
  else {
    m_audioEnhancement.clear();
    m_audioEnhancementReason = QStringLiteral("disabled");
  }
  if (!m_mpv) {
    qWarning() << "PlayerComponent::stop: mpv not initialized yet";
    return;
  }
  QStringList args("stop");
  m_mpv->command( args);
}

///////////////////////////////////////////////////////////////////////////////////////////////////
void PlayerComponent::clearQueue()
{
  emit playbackQueueChangeRequested();
  if (!m_mpv) {
    qWarning() << "PlayerComponent::clearQueue: mpv not initialized yet";
    return;
  }
  QStringList args("playlist_clear");
  m_mpv->command( args);
}

///////////////////////////////////////////////////////////////////////////////////////////////////
void PlayerComponent::pause()
{
#if defined(Q_OS_MAC) && defined(DEEPSTREAM_HAS_NATIVE_AV_BACKEND)
  if(m_avFixturePhase==AVFixturePhase::Draining && m_avFixtureLoads.mutatePending(m_avFixtureLoads.revision(),[](auto& request){request.options.insert("autoplay",false);}))return;
  if (m_avFixturePhase == AVFixturePhase::Hashing) m_avFixtureAutoplay=false;
  if (m_avFixturePhase == AVFixturePhase::Draining || m_avFixturePhase == AVFixturePhase::Starting) { m_avFixtureAutoplay=false; return; }
  if (m_avFixturePhase == AVFixturePhase::Active) { m_avFixtureBackend->pause(m_avFixtureGeneration); return; }
#endif
  if (!m_mpv) {
    qWarning() << "PlayerComponent::pause: mpv not initialized yet";
    return;
  }
  QStringList args = (QStringList() << "set" << "pause" << "yes");
  m_mpv->command( args);
}

///////////////////////////////////////////////////////////////////////////////////////////////////
void PlayerComponent::seekTo(qint64 ms)
{
#if defined(Q_OS_MAC) && defined(DEEPSTREAM_HAS_NATIVE_AV_BACKEND)
  if(m_avFixturePhase==AVFixturePhase::Draining && m_avFixtureLoads.mutatePending(m_avFixtureLoads.revision(),[ms](auto& request){request.options.insert("startMilliseconds",qMax<qint64>(0,ms));}))return;
  if (m_avFixturePhase == AVFixturePhase::Hashing) m_avFixtureSeek=qMax<qint64>(0,ms);
  if (m_avFixturePhase == AVFixturePhase::Draining || m_avFixturePhase == AVFixturePhase::Starting) { m_avFixtureSeek=qMax<qint64>(0,ms); return; }
  if (m_avFixturePhase == AVFixturePhase::Active) { m_avFixtureBackend->seek(m_avFixtureGeneration,ms); return; }
#endif
  if (!m_mpv) {
    qWarning() << "PlayerComponent::seekTo: mpv not initialized yet";
    return;
  }
  double timeSecs = ms / 1000.0;
  QStringList args = (QStringList() << "seek" << QString::number(timeSecs) << "absolute+exact");
  m_mpv->command( args);
}

///////////////////////////////////////////////////////////////////////////////////////////////////
QVariant PlayerComponent::getAudioDeviceList()
{
  if (!m_mpv) {
    qWarning() << "PlayerComponent::getAudioDeviceList: mpv not initialized yet";
    return QVariant();
  }
  return m_mpv->getProperty( "audio-device-list");
}

///////////////////////////////////////////////////////////////////////////////////////////////////
void PlayerComponent::setAudioDevice(const QString& name)
{
  if (!m_mpv) {
    qWarning() << "PlayerComponent::setAudioDevice: mpv not initialized yet";
    return;
  }
  invalidateAudioEnhancementRoute();
  m_mpv->setProperty( "audio-device", name);
}

///////////////////////////////////////////////////////////////////////////////////////////////////
void PlayerComponent::setVolume(int volume)
{
#if defined(Q_OS_MAC) && defined(DEEPSTREAM_HAS_NATIVE_AV_BACKEND)
  if(m_avFixturePhase==AVFixturePhase::Draining && m_avFixtureLoads.mutatePending(m_avFixtureLoads.revision(),[volume](auto& request){request.volume=qBound(0,volume,100);}))return;
  if (m_avFixturePhase != AVFixturePhase::Idle && m_avFixturePhase != AVFixturePhase::Hashing) { m_avFixtureVolume=qBound(0,volume,100); if(m_avFixturePhase==AVFixturePhase::Active) m_avFixtureBackend->setVolume(m_avFixtureGeneration,m_avFixtureVolume); return; }
#endif
  if (!m_mpv) {
    qWarning() << "PlayerComponent::setVolume: mpv not initialized yet";
    return;
  }
  // Will fail if no audio output opened (i.e. no file playing)
  m_mpv->setProperty( "volume", volume);
}

///////////////////////////////////////////////////////////////////////////////////////////////////
int PlayerComponent::volume()
{
#if defined(Q_OS_MAC) && defined(DEEPSTREAM_HAS_NATIVE_AV_BACKEND)
  if(m_avFixturePhase==AVFixturePhase::Active)return m_avFixtureBackend->volume(m_avFixtureGeneration);
#endif
  if (!m_mpv) {
    qWarning() << "PlayerComponent::volume: mpv not initialized yet";
    return 0;
  }
  QVariant volume = m_mpv->getProperty( "volume");
  if (volume.isValid())
    return volume.toInt();
  return 0;
}

///////////////////////////////////////////////////////////////////////////////////////////////////
void PlayerComponent::setMuted(bool muted)
{
#if defined(Q_OS_MAC) && defined(DEEPSTREAM_HAS_NATIVE_AV_BACKEND)
  if(m_avFixturePhase==AVFixturePhase::Draining && m_avFixtureLoads.mutatePending(m_avFixtureLoads.revision(),[muted](auto& request){request.muted=muted;}))return;
  if (m_avFixturePhase != AVFixturePhase::Idle && m_avFixturePhase != AVFixturePhase::Hashing) { m_avFixtureMuted=muted; if(m_avFixturePhase==AVFixturePhase::Active) m_avFixtureBackend->setMuted(m_avFixtureGeneration,muted); return; }
#endif
  if (!m_mpv) {
    qWarning() << "PlayerComponent::setMuted: mpv not initialized yet";
    return;
  }
  // Will fail if no audio output opened (i.e. no file playing)
  m_mpv->setProperty( "mute", muted);
}

///////////////////////////////////////////////////////////////////////////////////////////////////
bool PlayerComponent::muted()
{
#if defined(Q_OS_MAC) && defined(DEEPSTREAM_HAS_NATIVE_AV_BACKEND)
  if(m_avFixturePhase==AVFixturePhase::Active)return m_avFixtureBackend->muted(m_avFixtureGeneration);
#endif
  if (!m_mpv) {
    qWarning() << "PlayerComponent::muted: mpv not initialized yet";
    return false;
  }
  QVariant mute = m_mpv->getProperty( "mute");
  if (mute.isValid())
    return mute.toBool();
  return false;
}

///////////////////////////////////////////////////////////////////////////////////////////////////
QVariantList PlayerComponent::findStreamsForURL(const QString &url)
{
  if (!m_mpv) {
    qWarning() << "PlayerComponent::findStreamsForURL: mpv not initialized yet";
    return QVariantList();
  }
  bool isExternal = !url.isEmpty();
  QVariantList res;

  auto tracks = m_mpv->getProperty( "track-list");
  for (auto track : tracks.toList())
  {
    QVariantMap map = track.toMap();

    if (map["external"].toBool() != isExternal)
      continue;

    if (!isExternal || map["external-filename"].toString() == url)
      res += map;
  }

  return res;
}

///////////////////////////////////////////////////////////////////////////////////////////////////
void PlayerComponent::reselectStream(const QVariant &streamSelection, MediaType target)
{
  if (!m_mpv) {
    qWarning() << "PlayerComponent::reselectStream: mpv not initialized yet";
    return;
  }

  QString streamIdPropertyName;
  QString streamAddCommandName;
  QString mpvStreamTypeName;

  switch (target)
  {
  case MediaType::Subtitle:
    mpvStreamTypeName = "sub";
    streamIdPropertyName = "sid";
    streamAddCommandName = "sub-add";
    break;
  case MediaType::Audio:
    mpvStreamTypeName = "audio";
    streamIdPropertyName = "aid";
    streamAddCommandName = "audio-add";
    break;
  }

  // Check for string format first (handles "#,URL" and "#index")
  QString streamSelectionStr = streamSelection.toString();
  bool isStringFormat = streamSelectionStr.startsWith("#") || !streamSelection.canConvert<int>();

  // Handle integer Jellyfin stream index (new format)
  if (!isStringFormat && streamSelection.canConvert<int>()) {
    int index = streamSelection.toInt();
    if (index < 0) {
      m_mpv->setProperty(streamIdPropertyName, "no");
    } else {
      // Jellyfin stream index is the MPV track ID (already 1-based)
      m_mpv->setProperty(streamIdPropertyName, index);
    }
    return;
  }

  // Handle legacy string format "#1" or "#,http://..."
  QString streamName;
  QString streamID;

  if (streamSelectionStr.startsWith("#"))
  {
    qsizetype splitPos = streamSelectionStr.indexOf(",");
    if (splitPos < 0)
    {
      // Stream from the main file
      streamID = streamSelectionStr.mid(1);
      streamName = "";
    }
    else
    {
      // Stream from an external file
      streamID = streamSelectionStr.mid(1, splitPos - 1);
      streamName = streamSelectionStr.mid(splitPos + 1);
    }
  }
  else if (streamSelectionStr.isEmpty() || !streamSelection.isValid())
  {
    m_mpv->setProperty( streamIdPropertyName, "no");
    return;
  }

  if (!streamName.isEmpty())
  {
    auto streams = findStreamsForURL(streamName);
    if (streams.isEmpty())
    {
      QStringList args = (QStringList() << streamAddCommandName << streamName);
      m_mpv->command( args);
    }
  }

  QString selection = "no";

  if (!streamID.isEmpty())
  {
    selection = streamID;
  } else {
    for (auto stream : findStreamsForURL(streamName))
    {
      auto map = stream.toMap();

      if (map["type"].toString() != mpvStreamTypeName)
      {
        continue;
      } else if (map["external-filename"].toString() == streamName) {
        selection = map["id"].toString();
        break;
      }
    }
  }

  // Fallback to the first stream if none could be found.
  // Useful if web-client uses wrong stream IDs when e.g. transcoding.
  if ((target == MediaType::Audio || !streamID.isEmpty()) && selection == "no")
    selection = "1";

  m_mpv->setProperty( streamIdPropertyName, selection);
}

///////////////////////////////////////////////////////////////////////////////////////////////////
void PlayerComponent::setSubtitleStream(const QVariant &subtitleStream)
{
#if defined(Q_OS_MAC) && defined(DEEPSTREAM_HAS_NATIVE_AV_BACKEND)
  if(m_avFixturePhase==AVFixturePhase::Draining && m_avFixtureLoads.mutatePending(m_avFixtureLoads.revision(),[subtitleStream](auto& request){request.subtitle=subtitleStream;}))return;
  if (m_avFixturePhase != AVFixturePhase::Idle) {
    bool ok=false;const int selected=subtitleStream.toInt(&ok);
    if(!ok || selected!=-1) {
      m_avFixtureSubtitle=subtitleStream;
      if(m_avFixturePhase==AVFixturePhase::Hashing || m_avFixturePhase==AVFixturePhase::Starting) fallbackAVFixture();
      else if(m_avFixturePhase==AVFixturePhase::Draining) m_avFixtureCancelRequested=true;
      else failAVFixture(QStringLiteral("fixture_subtitle_unavailable"));
    }
    return;
  }
#endif
  m_currentSubtitleStream = subtitleStream;
  reselectStream(m_currentSubtitleStream, MediaType::Subtitle);
}

///////////////////////////////////////////////////////////////////////////////////////////////////
QVariantMap PlayerComponent::getAudioCapabilities() const
{
  QVariantMap result;
  result.insert("engine", "libmpv");
#if defined(Q_OS_MAC) && defined(DEEPSTREAM_HAS_NATIVE_AV_BACKEND)
#ifdef DEEPSTREAM_EXPERIMENTAL_AV_FIXTURE
  result.insert("experimentalAvFixtureAvailable", true);
#endif
#ifdef DEEPSTREAM_EXPERIMENTAL_AUDIO_HLS
  result.insert("nativeAudioHlsAvailable", m_mpv && m_mpv->fixtureIsolationConfirmed() && m_window && nativeAudioHlsRouteAllowed());
#ifdef DEEPSTREAM_EXPERIMENTAL_DOLBY_VISION_HLS
  // This build opt-in is not a hardware or output-format detection API.
  const bool nativeDvAvailable=m_mpv && m_mpv->fixtureIsolationConfirmed() && m_window && nativeAudioHlsRouteAllowed(true);
  result.insert("nativeDolbyVisionHlsAvailable", nativeDvAvailable);
#ifdef DEEPSTREAM_EXPERIMENTAL_DOLBY_VISION_AUDIO_V2
  result.insert("nativeDolbyVisionAudioHlsV2", QVariantMap{
    {QStringLiteral("available"),nativeDvAvailable},
    {QStringLiteral("codecs"),QStringList{QStringLiteral("aac"),QStringLiteral("ac3"),QStringLiteral("eac3"),QStringLiteral("flac"),QStringLiteral("alac")}}});
#endif
#endif
#endif
#endif
  result.insert("decoderEnumerationAvailable", false);
  result.insert("decoders", QStringList());
  // The current libmpv PCM path does not expose a verified object renderer.
  result.insert("objectAudioRoutes", QVariantList());
  if (!m_mpv)
    return result;

  const QSet<QString> audioCodecs = {
    "truehd", "mlp", "dts", "eac3", "ac3", "flac", "alac", "aac",
    "mp3", "mp2", "opus", "vorbis", "wavpack", "ape", "tta",
    "wmalossless", "wmapro", "wmav2"
  };
  QSet<QString> found;
  const QVariantList decoderList = m_mpv->getProperty("decoder-list").toList();
  for (const QVariant& value : decoderList)
  {
    const QString codec = value.toMap().value("codec").toString();
    if (audioCodecs.contains(codec) || codec.startsWith("pcm_"))
      found.insert(codec);
  }
  QStringList names = found.values();
  names.sort();
  result.insert("decoderEnumerationAvailable", !names.isEmpty());
  result.insert("decoders", names);
  return result;
}

///////////////////////////////////////////////////////////////////////////////////////////////////
#ifdef DEEPSTREAM_HLS_CONTROLLED_MPV_TEST
QVariantMap PlayerComponent::getControlledSwitchDiagnostics() const
{
  QVariantMap result;result.insert("nativeActive",m_avFixturePhase==AVFixturePhase::Active);
  if(!m_mpv)return result;
  const QVariant ao=m_mpv->getProperty("current-ao");
  const bool inactive=(ao.metaType().id()==qMetaTypeId<ErrorReturn>() && ao.value<ErrorReturn>().error==MPV_ERROR_PROPERTY_UNAVAILABLE) ||
                      (ao.metaType().id()==QMetaType::QString && ao.toString().isEmpty());
  const bool active=ao.metaType().id()==QMetaType::QString && !ao.toString().isEmpty() && ao.toString()!=QStringLiteral("null");
  const QVariantMap video=m_mpv->getProperty("video-params").toMap();
  result.insert("mpvAoActive",active);result.insert("mpvAoInactive",inactive);
  result.insert("mpvVideoDecoded",video.value("w").toInt()>0 && video.value("h").toInt()>0);
  return result;
}
#endif
QVariantMap PlayerComponent::getVideoSignalPath() const
{
#if defined(Q_OS_MAC) && defined(DEEPSTREAM_HAS_NATIVE_AV_BACKEND)
  if(m_avFixturePhase == AVFixturePhase::Active && m_avFixtureBackend){
    QVariantMap result=m_avFixtureBackend->videoSelectionEvidence(m_avFixtureGeneration);
    result.insert(QStringLiteral("backend"),QStringLiteral("avplayer"));
    return result;
  }
#endif
  return {{QStringLiteral("backend"),QStringLiteral("mpv")},
          {QStringLiteral("status"),QStringLiteral("unknown")},
          {QStringLiteral("outputConfirmed"),false}};
}

QVariantMap PlayerComponent::getAudioSignalPath() const
{
  QVariantMap result;
#if defined(Q_OS_MAC) && defined(DEEPSTREAM_HAS_NATIVE_AV_BACKEND)
  if (m_avFixturePhase == AVFixturePhase::Active) {
    result.insert("backend", "avplayer");result.insert("engine", "AVPlayer");result.insert("outputDriver", "AVFoundation");
    result.insert("objectRenderingConfirmed", false);
    QVariantMap evidence{{"status", "fixture_joc_declared"}};
#ifdef DEEPSTREAM_EXPERIMENTAL_AUDIO_HLS
    if(m_nativeAudioHls)evidence.insert("status",m_nativeAudioHlsCodec + QStringLiteral("_verified"));
#endif
    if (m_avFixtureBackend) {
      const QVariantMap audioEvidence=m_avFixtureBackend->audioSelectionEvidence(m_avFixtureGeneration);
      for (const QString& key : {QStringLiteral("availableAudioOptions"), QStringLiteral("selectedAudioOptions")})
        if (audioEvidence.contains(key)) evidence.insert(key,audioEvidence.value(key));
    }
    result.insert("sourceEvidence",evidence);return result;
  }
#endif
  result.insert("backend", "mpv");
  result.insert("engine", "libmpv");
  result.insert("objectRenderingConfirmed", false);
  result.insert("sourceEvidence", QVariantMap{{"status", "unknown"}});
  if (!m_mpv)
    return result;
  result.insert("decoder", m_mpv->getProperty("audio-codec-name"));
  result.insert("outputDriver", m_mpv->getProperty("current-ao"));
  auto format = [this](const QString& property) {
    const QVariantMap source = m_mpv->getProperty(property).toMap();
    QVariantMap value;
    for (const QString& key : {QStringLiteral("samplerate"), QStringLiteral("channel-count"),
                              QStringLiteral("channels"), QStringLiteral("format")})
      if (source.contains(key))
        value.insert(key, source.value(key));
    return value;
  };
  result.insert("decoded", format("audio-params"));
  result.insert("output", format("audio-out-params"));
  return result;
}

///////////////////////////////////////////////////////////////////////////////////////////////////
void PlayerComponent::setAudioStream(const QVariant &audioStream)
{
#if defined(Q_OS_MAC) && defined(DEEPSTREAM_HAS_NATIVE_AV_BACKEND)
  if(m_avFixturePhase==AVFixturePhase::Draining && m_avFixtureLoads.mutatePending(m_avFixtureLoads.revision(),[audioStream](auto& request){request.audio=audioStream;}))return;
  if (m_avFixturePhase != AVFixturePhase::Idle) {
    bool ok=false;const int selected=audioStream.toInt(&ok);
    if(!ok || selected!=1) {
      m_avFixtureAudio=audioStream;
      if(m_avFixturePhase==AVFixturePhase::Hashing || m_avFixturePhase==AVFixturePhase::Starting) fallbackAVFixture();
      else if(m_avFixturePhase==AVFixturePhase::Draining) m_avFixtureCancelRequested=true;
      else failAVFixture(QStringLiteral("fixture_audio_selection_unavailable"));
    }
    return;
  }
#endif
  m_audioEnhancementPlanFresh = false;
  invalidateAudioEnhancementRoute();
  m_currentAudioStream = audioStream;
  reselectStream(m_currentAudioStream, MediaType::Audio);
}

/////////////////////////////////////////////////////////////////////////////////////////
void PlayerComponent::setAudioDelay(qint64 milliseconds)
{
  m_playbackAudioDelay = milliseconds;

  double displayFps = DisplayComponent::Get().currentRefreshRate();
  const char *audioDelaySetting = "audio_delay.normal";
  if (fabs(displayFps - 24) < 0.5) // cover 24Hz, 23.976Hz, and values very close
    audioDelaySetting = "audio_delay.24hz";
  else if (fabs(displayFps - 25) < 0.5)
    audioDelaySetting = "audio_delay.25hz";
  else if (fabs(displayFps - 50) < 0.5)
    audioDelaySetting = "audio_delay.50hz";

  double fixedDelay = SettingsComponent::Get().value(SETTINGS_SECTION_VIDEO, audioDelaySetting).toFloat();
  m_mpv->setProperty( "audio-delay", (fixedDelay + m_playbackAudioDelay) / 1000.0);
}

/////////////////////////////////////////////////////////////////////////////////////////
void PlayerComponent::setSubtitleDelay(qint64 milliseconds)
{
  if (!m_mpv) {
    qWarning() << "PlayerComponent::setSubtitleDelay: mpv not initialized yet";
    return;
  }
  m_mpv->setProperty( "sub-delay", milliseconds / 1000.0);
}

/////////////////////////////////////////////////////////////////////////////////////////
void PlayerComponent::setPlaybackRate(int rate)
{
#if defined(Q_OS_MAC) && defined(DEEPSTREAM_HAS_NATIVE_AV_BACKEND)
  if(m_avFixturePhase==AVFixturePhase::Draining && m_avFixtureLoads.mutatePending(m_avFixtureLoads.revision(),[rate](auto& request){request.rate=rate;}))return;
  if (m_avFixturePhase == AVFixturePhase::Draining || m_avFixturePhase == AVFixturePhase::Starting) { m_avFixtureRate=rate; return; }
  if (m_avFixturePhase == AVFixturePhase::Active) { m_avFixtureRate=rate; m_avFixtureBackend->setRate(m_avFixtureGeneration,rate); emit playbackRateChanged(rate/1000.0); return; }
#endif
  if (!m_mpv) {
    qWarning() << "PlayerComponent::setPlaybackRate: mpv not initialized yet";
    return;
  }
  double speed = rate / 1000.0;
  m_mpv->setProperty( "speed", speed);
  emit playbackRateChanged(speed);
}

/////////////////////////////////////////////////////////////////////////////////////////
qint64 PlayerComponent::getPosition()
{
  return m_positionMs;
}

/////////////////////////////////////////////////////////////////////////////////////////
qint64 PlayerComponent::getDuration()
{
  return m_durationMs;
}

///////////////////////////////////////////////////////////////////////////////////////////////////
// This is called with the set of previous audio devices that were detected, and the set of current
// audio devices. From this we guess whether we should reopen the audio device. If the user-selected
// device went away previously, and now comes back, reinitializing the player's audio output will
// force the player and/or the OS to move audio output back to the user-selected device.
void PlayerComponent::checkCurrentAudioDevice(const QSet<QString>& old_devs, const QSet<QString>& new_devs)
{
  QString userDevice = SettingsComponent::Get().value(SETTINGS_SECTION_AUDIO, "device").toString();

  QSet<QString> removed = old_devs - new_devs;
  QSet<QString> added = new_devs - old_devs;

  qDebug() << "Audio devices removed:" << removed;
  qDebug() << "Audio devices added:" << added;
  qDebug() << "Audio device selected:" << userDevice;

  if (userDevice.length())
  {
    if (added.contains(userDevice) || removed.contains(userDevice))
    {
      // The timer is for debouncing the reload. Several change notifications could
      // come in quick succession. Also, it's possible that trying to open the
      // reappeared audio device immediately can fail.
      m_reloadAudioTimer.start(500);
    }
  }
}

///////////////////////////////////////////////////////////////////////////////////////////////////
void PlayerComponent::updateAudioDeviceList()
{
  QString userDevice = SettingsComponent::Get().value(SETTINGS_SECTION_AUDIO, "device").toString();
  bool userDeviceFound = false;

  QVariantList settingList;
  QVariant list = getAudioDeviceList();
  QSet<QString> devices;
  for(const QVariant& d : list.toList())
  {
    Q_ASSERT(d.typeId() == QMetaType::QVariantMap);
    QVariantMap dmap = d.toMap();

    QString device = dmap["name"].toString();
    QString description = dmap["description"].toString();

    devices.insert(device);

    if (userDevice == device)
      userDeviceFound = true;

    QVariantMap entry;
    entry["value"] = device;
    entry["title"] = description;

    settingList << entry;
  }

  if (!userDeviceFound)
  {
    QVariantMap entry;
    entry["value"] = userDevice;
    entry["title"] = "[Disconnected device: " + userDevice + "]";

    settingList << entry;
  }

  SettingsComponent::Get().updatePossibleValues(SETTINGS_SECTION_AUDIO, "device", settingList);

  checkCurrentAudioDevice(m_audioDevices, devices);
  m_audioDevices = devices;
}

///////////////////////////////////////////////////////////////////////////////////////////////////
void PlayerComponent::updateAudioDevice()
{
  QString device = SettingsComponent::Get().value(SETTINGS_SECTION_AUDIO, "device").toString();

  if (!m_audioDevices.contains(device))
  {
    qWarning() << "Not using audio device" << device << "because it's not present.";
    device = "auto";
  }

  if (m_mpv->getProperty("audio-device").toString() != device)
    invalidateAudioEnhancementRoute();
  m_mpv->setProperty( "audio-device", device);
}

///////////////////////////////////////////////////////////////////////////////////////////////////
void PlayerComponent::updateAudioConfiguration()
{
  setAudioConfiguration();
  setOtherConfiguration();
#if defined(Q_OS_MAC) && defined(DEEPSTREAM_HAS_NATIVE_AV_BACKEND) && defined(DEEPSTREAM_EXPERIMENTAL_AUDIO_HLS)
  if((m_nativeAudioHls || m_nativeFallbackRelay) && !nativeAudioHlsRouteAllowed(m_nativeVideoHls))clearNativeAudioSession();
#endif
}

///////////////////////////////////////////////////////////////////////////////////////////////////
void PlayerComponent::setAudioConfiguration()
{
  QString deviceType = SettingsComponent::Get().value(SETTINGS_SECTION_AUDIO, "devicetype").toString();

  bool exclusive = SettingsComponent::Get().value(SETTINGS_SECTION_AUDIO, "exclusive").toBool();
  m_mpv->setProperty( "audio-exclusive", exclusive);

#ifdef Q_OS_MAC
  // AVFoundation is opt-in and restricted to the automatic, non-passthrough
  // configuration. setOtherConfiguration() runs afterwards, so a manual mpv
  // "ao" setting still wins. Changing an AO can require an application restart.
  QString configuredDevice = SettingsComponent::Get().value(SETTINGS_SECTION_AUDIO, "device").toString();
  QString channels = SettingsComponent::Get().value(SETTINGS_SECTION_AUDIO, "channels").toString();
  bool useSpatialAudio = SettingsComponent::Get().value(SETTINGS_SECTION_AUDIO, "spatialAudio").toBool() &&
                         configuredDevice == "auto" && channels == "auto" &&
                         deviceType == AUDIO_DEVICE_TYPE_BASIC && !exclusive;
  if (useSpatialAudio && !m_spatialAudioAO)
  {
    // Preserve libmpv's actual value, including an empty default/autoprobe value.
    char* previousAO = nullptr;
    int result = mpv_get_property(m_mpv->mpv(), "ao", MPV_FORMAT_STRING, &previousAO);
    if (result < 0)
    {
      qWarning() << "Could not read the current mpv audio output:" << mpv_error_string(result);
    }
    else
    {
      QString savedAO = QString::fromUtf8(previousAO ? previousAO : "");
      mpv_free(previousAO);
      // The trailing comma retains mpv's automatic probing fallback.
      result = mpv_set_property_string(m_mpv->mpv(), "ao", "avfoundation,coreaudio,");
      if (result < 0)
        qWarning() << "Could not enable the spatial-audio output list:" << mpv_error_string(result);
      else
      {
        m_savedSpatialAudioAO = savedAO;
        m_spatialAudioAO = true;
      }
    }
  }
  else if (!useSpatialAudio && m_spatialAudioAO)
  {
    // On failure retain state and value so a later update can retry restoration.
    QByteArray savedAO = m_savedSpatialAudioAO.toUtf8();
    int result = mpv_set_property_string(m_mpv->mpv(), "ao", savedAO.constData());
    if (result < 0)
      qWarning() << "Could not restore the previous mpv audio output:" << mpv_error_string(result);
    else
    {
      m_spatialAudioAO = false;
      m_savedSpatialAudioAO.clear();
    }
  }
#endif

  updateAudioDevice();

  bool normalize = SettingsComponent::Get().value(SETTINGS_SECTION_AUDIO, "normalize").toBool();
  m_mpv->setProperty( "audio-normalize-downmix", normalize ? "yes" : "no");

  // Make downmix more similar to PHT.
  m_mpv->setProperty( "audio-swresample-o", "surround_mix_level=1");

  m_passthroughCodecs.clear();

  // passthrough doesn't make sense with basic type
  if (deviceType != AUDIO_DEVICE_TYPE_BASIC)
  {
    SettingsSection* audioSection = SettingsComponent::Get().getSection(SETTINGS_SECTION_AUDIO);

    QStringList codecs;
    if (deviceType == AUDIO_DEVICE_TYPE_SPDIF)
      codecs = AudioCodecsSPDIF();
    else if (deviceType == AUDIO_DEVICE_TYPE_HDMI)
      codecs = AudioCodecsAll();

    for(const QString& key : codecs)
    {
      if (audioSection->value("passthrough." + key).toBool())
        m_passthroughCodecs << key;
    }

    // dts-hd includes dts, but listing dts before dts-hd may disable dts-hd.
    if (m_passthroughCodecs.indexOf("dts-hd") != -1)
      m_passthroughCodecs.removeAll("dts");
  }

  QString passthroughCodecs = m_passthroughCodecs.join(",");
  m_mpv->setProperty( "audio-spdif", passthroughCodecs);

  // set the channel layout
  QVariant layout = SettingsComponent::Get().value(SETTINGS_SECTION_AUDIO, "channels");

  // always force either stereo or transcoding
  if (deviceType == AUDIO_DEVICE_TYPE_SPDIF)
    layout = "2.0";

  m_mpv->setProperty( "audio-channels", layout);

  // if the user has indicated that PCM only works for stereo, and that
  // the receiver supports AC3, set this extra option that allows us to transcode
  // 5.1 audio into a usable format, note that we only support AC3
  // here for now. We might need to add support for DTS transcoding
  // if we see user requests for it.
  //
  bool wasAc3Transcoding = m_doAc3Transcoding;
  m_doAc3Transcoding =
  (deviceType == AUDIO_DEVICE_TYPE_SPDIF &&
   SettingsComponent::Get().value(SETTINGS_SECTION_AUDIO, "passthrough.ac3").toBool());
  if (m_doAc3Transcoding && !wasAc3Transcoding)
  {
    m_mpv->command( QStringList() << "af" << "add" << "@ac3:lavcac3enc");
  }
  else if (!m_doAc3Transcoding && wasAc3Transcoding)
  {
    m_mpv->command( QStringList() << "af" << "remove" << "@ac3");
  }

  QVariant device = SettingsComponent::Get().value(SETTINGS_SECTION_AUDIO, "device");

  // Make a informational log message.
  QString audioConfig = QString(QString("Audio Config - device: %1, ") +
                                        "channel layout: %2, " +
                                        "passthrough codecs: %3, " +
                                        "ac3 transcoding: %4").arg(device.toString(),
                                                                   layout.toString(),
                                                                   passthroughCodecs.isEmpty() ? "none" : passthroughCodecs,
                                                                   m_doAc3Transcoding ? "yes" : "no");
  qInfo() << qPrintable(audioConfig);
}

///////////////////////////////////////////////////////////////////////////////////////////////////
void PlayerComponent::updateSubtitleConfiguration()
{
  setSubtitleConfiguration();
  setOtherConfiguration();
}

///////////////////////////////////////////////////////////////////////////////////////////////////
void PlayerComponent::setSubtitleConfiguration()
{
  bool assScaleBorderAndShadow = SettingsComponent::Get().value(SETTINGS_SECTION_SUBTITLES, "ass_scale_border_and_shadow").toBool();
  m_mpv->setProperty( "sub-ass-style-overrides", assScaleBorderAndShadow ? "ScaledBorderAndShadow=yes" : "ScaledBorderAndShadow=no");

  QString assStyleOverride = SettingsComponent::Get().value(SETTINGS_SECTION_SUBTITLES, "ass_style_override").toString();
  if (!assStyleOverride.isEmpty())
  {
    m_mpv->setProperty( "sub-ass-override", assStyleOverride);
  }

  QVariant size = SettingsComponent::Get().value(SETTINGS_SECTION_SUBTITLES, "size");
  if (size != -1)
  {
    m_mpv->setProperty( "sub-scale", size.toInt() / 32.0);
  }

  QString font = SettingsComponent::Get().value(SETTINGS_SECTION_SUBTITLES, "font").toString();
  if (!font.isEmpty())
  {
    m_mpv->setProperty( "sub-font", font);
  }

  QString color = SettingsComponent::Get().value(SETTINGS_SECTION_SUBTITLES, "color").toString();
  if (!color.isEmpty())
  {
    m_mpv->setProperty( "sub-color", color);
  }

  QString borderColor = SettingsComponent::Get().value(SETTINGS_SECTION_SUBTITLES, "border_color").toString();
  if (!borderColor.isEmpty())
  {
    m_mpv->setProperty( "sub-border-color", borderColor);
  }

  QVariant borderSize = SettingsComponent::Get().value(SETTINGS_SECTION_SUBTITLES, "border_size");
  if (borderSize != -1)
  {
    m_mpv->setProperty( "sub-border-size", borderSize.toInt());
  }

  QString backgroundColor = SettingsComponent::Get().value(SETTINGS_SECTION_SUBTITLES, "background_color").toString();
  QString backgroundTransparency = SettingsComponent::Get().value(SETTINGS_SECTION_SUBTITLES, "background_transparency").toString();
  if (!backgroundColor.isEmpty() && !backgroundTransparency.isEmpty())
  {
    // Color is #RRGGBB or #AARRGGBB, insert Alpha after # (at position 1)
    backgroundColor.insert(1, backgroundTransparency);
    m_mpv->setProperty( "sub-back-color", backgroundColor);
  }

  QVariant subposString = SettingsComponent::Get().value(SETTINGS_SECTION_SUBTITLES, "placement");
  auto subpos = subposString.toString().split(",");
  if (subpos.length() == 2)
  {
    m_mpv->setProperty( "sub-align-x", subpos[0]);
    m_mpv->setProperty( "sub-pos", subpos[1] == "bottom" ? 100 : 10);
  }
}

///////////////////////////////////////////////////////////////////////////////////////////////////
void PlayerComponent::updateVideoAspectSettings()
{
  QVariant mode = SettingsComponent::Get().value(SETTINGS_SECTION_VIDEO, "aspect").toString();
  bool disableScaling = false;
  bool keepAspect = true;
  QString forceAspect = "no";
  double panScan = 0.0;
  if (mode == "custom")
  {
    // in particular, do not restore anything - the intention is not to touch the user's mpv.conf settings, or whatever
    return;
  }
  else if (mode == "zoom")
  {
    panScan = 1.0;
  }
  else if (mode == "force_4_3")
  {
    forceAspect = "4:3";
  }
  else if (mode == "force_16_9")
  {
    forceAspect = "16:9";
  }
  else if (mode == "force_16_9_if_4_3")
  {
    auto params = m_mpv->getProperty( "video-dec-params").toMap();
    auto aspect = params["aspect"].toFloat();
    if (fabs(aspect - 4.0/3.0) < 0.1)
      forceAspect = "16:9";
  }
  else if (mode == "stretch")
  {
    keepAspect = false;
  }
  else if (mode == "noscaling")
  {
    disableScaling = true;
  }

  m_mpv->setProperty( "video-unscaled", disableScaling);
  m_mpv->setProperty( "video-aspect-override", forceAspect);
  m_mpv->setProperty( "keepaspect", keepAspect);
  m_mpv->setProperty( "panscan", panScan);
}

///////////////////////////////////////////////////////////////////////////////////////////////////
void PlayerComponent::updateVideoConfiguration()
{
  setVideoConfiguration();
  setOtherConfiguration();
}

///////////////////////////////////////////////////////////////////////////////////////////////////
void PlayerComponent::setVideoConfiguration()
{
  if (!m_mpv)
    return;

  QVariant syncMode = SettingsComponent::Get().value(SETTINGS_SECTION_VIDEO, "sync_mode");
  m_mpv->setProperty( "video-sync", syncMode);

  QString hardwareDecodingMode = SettingsComponent::Get().value(SETTINGS_SECTION_VIDEO, "hardwareDecoding").toString();
  QString hwdecMode = "no";
  QString hwdecVTFormat = "no";
  if (hardwareDecodingMode == "enabled")
    hwdecMode = "auto";
  else if (hardwareDecodingMode == "osx_compat")
  {
    hwdecMode = "auto";
    hwdecVTFormat = "uyvy422";
  }
  else if (hardwareDecodingMode == "copy")
  {
    hwdecMode = "auto-copy";
  }
  m_mpv->setProperty( "hwdec", hwdecMode);
  m_mpv->setProperty( "hwdec-image-format", hwdecVTFormat);

  QVariant deinterlace = SettingsComponent::Get().value(SETTINGS_SECTION_VIDEO, "deinterlace");
  m_mpv->setProperty( "deinterlace", deinterlace.toBool() ? "yes" : "no");

#ifndef TARGET_RPI
  double displayFps = DisplayComponent::Get().currentRefreshRate();
  m_mpv->setProperty( "display-fps-override", displayFps);
#endif

  setAudioDelay(m_playbackAudioDelay);

  QVariant cache = SettingsComponent::Get().value(SETTINGS_SECTION_VIDEO, "cache");
  m_mpv->setProperty( "demuxer-max-bytes", cache.toInt() * 1024 * 1024);

  updateVideoAspectSettings();
  setOtherConfiguration();
}


///////////////////////////////////////////////////////////////////////////////////////////////////
void PlayerComponent::setOtherConfiguration()
{
#if defined(Q_OS_MAC) && (defined(DEEPSTREAM_EXPERIMENTAL_AV_FIXTURE) || defined(DEEPSTREAM_HLS_CONTROLLED_MPV_TEST))
  return; // controlled test only: keep pre-init isolation
#endif
  if (!m_mpv) return;

  QString otherConfiguration = SettingsComponent::Get().value(SETTINGS_SECTION_OTHER, "other_conf").toString();
  qDebug() << "Parsing other configuration: "+otherConfiguration;
  QStringList configurationList = otherConfiguration.split(QRegularExpression("[\r\n]"), Qt::SkipEmptyParts);

  for(const QString& configuration : configurationList)
  {
    qsizetype splitIndex = configuration.indexOf("=");
    qsizetype configurationLength = configuration.length();
    if (splitIndex > 0 && splitIndex < configurationLength - 1)
    {
      QString configurationKey = configuration.left(splitIndex).remove(QRegularExpression("^([\"]+)")).remove(QRegularExpression("([\"]+)$"));
      QString configurationValue = configuration.right(configurationLength - splitIndex - 1).remove(QRegularExpression("^([\"]+)")).remove(QRegularExpression("([\"]+)$"));
      m_mpv->setProperty( configurationKey, configurationValue);
    }
  }
}

///////////////////////////////////////////////////////////////////////////////////////////////////
void PlayerComponent::updateConfiguration()
{
  setAudioConfiguration();
  setVideoConfiguration();
  setSubtitleConfiguration();
  setOtherConfiguration();
}

/////////////////////////////////////////////////////////////////////////////////////////
void PlayerComponent::userCommand(QString command)
{
  emit playbackOwnerChangeRequested();
#if defined(Q_OS_MAC) && (defined(DEEPSTREAM_EXPERIMENTAL_AV_FIXTURE) || defined(DEEPSTREAM_HLS_CONTROLLED_MPV_TEST))
  Q_UNUSED(command);return; // controlled test only: no untracked mpv commands
#endif
  QByteArray cmdUtf8 = command.toUtf8();
  mpv_command_string(m_mpv->mpv(), cmdUtf8.data());
}

/////////////////////////////////////////////////////////////////////////////////////////
static QString get_mpv_osd(mpv_handle *ctx, const QString& property)
{
  char *s = mpv_get_property_osd_string(ctx, property.toUtf8().data());
  if (!s)
    return "-";
  QString r = QString::fromUtf8(s);
  mpv_free(s);
  if (r.size() > 400)
    r = r.mid(0, 400) + "...";
  Log::CensorAuthTokens(r);
  return r;
}

#define MPV_PROPERTY(p) get_mpv_osd(m_mpv->mpv(), p)
#define MPV_PROPERTY_BOOL(p) (m_mpv->getProperty(p).toBool())

/////////////////////////////////////////////////////////////////////////////////////////
void PlayerComponent::appendAudioFormat(QTextStream& info, const QString& property) const
{
  // Guess if it's a passthrough format. Don't show the channel layout in this
  // case, because it's confusing.
  QString audioFormat = MPV_PROPERTY(property + "/format");
  if (audioFormat.startsWith("spdif-"))
  {
    info << "passthrough (" << audioFormat.mid(6) << ")";
  }
  else
  {
    QString hr = MPV_PROPERTY(property + "/hr-channels");
    QString full = MPV_PROPERTY(property + "/channels");
    info << hr;
    if (hr != full)
      info << " (" << full << ")";
  }
}

/////////////////////////////////////////////////////////////////////////////////////////
QString PlayerComponent::videoInformation() const
{
  QString infoStr;
  QTextStream info(&infoStr);

  // check if video is playing
  if (m_mpv->getProperty( "idle-active").toBool())
    return "";

  info << "File:\n";
  info << "URL: " << MPV_PROPERTY("path") << "\n";
  info << "Container: " << MPV_PROPERTY("file-format") << "\n";
  info << "Native seeking: " << ((MPV_PROPERTY_BOOL("seekable") &&
                                  !MPV_PROPERTY_BOOL("partially-seekable"))
                                 ? "yes" : "no") << "\n";
  info << "\n";
  info << "Video:\n";
  info << "Codec: " << MPV_PROPERTY("video-codec") << "\n";
  info << "Size: " << MPV_PROPERTY("video-params/dw") << "x"
                   << MPV_PROPERTY("video-params/dh") << "\n";
  info << "FPS (container): " << MPV_PROPERTY("container-fps") << "\n";
  info << "FPS (filters): " << MPV_PROPERTY("estimated-vf-fps") << "\n";
  info << "Aspect: " << MPV_PROPERTY("video-params/aspect") << "\n";
  info << "Bitrate: " << MPV_PROPERTY("video-bitrate") << "\n";
  double displayFps = DisplayComponent::Get().currentRefreshRate();
  info << "Display FPS: " << MPV_PROPERTY("override-display-fps")
                          << " (" << displayFps << ")" << "\n";
  info << "Hardware Decoding: " << MPV_PROPERTY("hwdec-current")
                                << " (" << MPV_PROPERTY("hwdec-interop") << ")\n";
  info << "\n";
  info << "Audio:\n";
  info << "Codec: " << MPV_PROPERTY("audio-codec") << "\n";
  info << "Bitrate: " << MPV_PROPERTY("audio-bitrate") << "\n";
  info << "Channels: ";
  appendAudioFormat(info, "audio-params");
  info << " -> ";
  appendAudioFormat(info, "audio-out-params");
  info << "\n";
  info << "Output driver: " << MPV_PROPERTY("current-ao") << "\n";
  info << "\n";
  info << "Performance:\n";
  info << "A/V: " << MPV_PROPERTY("avsync") << "\n";
  info << "Dropped frames: " << MPV_PROPERTY("frame-drop-count") << "/" << MPV_PROPERTY("decoder-frame-drop-count") << "\n";
  bool dispSync = MPV_PROPERTY_BOOL("display-sync-active");
  info << "Display Sync: ";
  if (!dispSync)
  {
     info << "no\n";
  }
  else
  {
    info << "yes (ratio " << MPV_PROPERTY("vsync-ratio") << ")\n";
    info << "Mistimed frames: " << MPV_PROPERTY("mistimed-frame-count")
                                << "/" << MPV_PROPERTY("vo-delayed-frame-count") << "\n";
    info << "Measured FPS: " << MPV_PROPERTY("estimated-display-fps")
                             << " (" << MPV_PROPERTY("vsync-jitter") << ")\n";
    info << "V. speed corr.: " << MPV_PROPERTY("video-speed-correction") << "\n";
    info << "A. speed corr.: " << MPV_PROPERTY("audio-speed-correction") << "\n";
  }
  info << "\n";
  info << "Cache:\n";
  info << "Seconds: " << MPV_PROPERTY("demuxer-cache-duration") << "\n";
  info << "Buffering: " << MPV_PROPERTY("cache-buffering-state") << "\n";
  info << "Speed: " << MPV_PROPERTY("cache-speed") << "\n";
  info << "\n";
  info << "Misc:\n";
  info << "Time: " << MPV_PROPERTY("playback-time") << " / "
                   << MPV_PROPERTY("duration")
                   << " (" << MPV_PROPERTY("percent-pos") << "%)\n";
  info << "State: " << (MPV_PROPERTY_BOOL("pause") ? "paused " : "")
                    << (MPV_PROPERTY_BOOL("paused-for-cache") ? "buffering " : "")
                    << (MPV_PROPERTY_BOOL("core-idle") ? "waiting " : "playing ")
                    << (MPV_PROPERTY_BOOL("seeking") ? "seeking " : "")
                    << "\n";

  info.flush();
  return infoStr;
}

/////////////////////////////////////////////////////////////////////////////////////////
void PlayerComponent::setWebPlaylist(const QVariantList& playlist, const QString& currentItemId)
{
  m_webPlaylist = playlist;
  m_currentWebPlaylistItemId = currentItemId;
  emit webPlaylistChanged(playlist, currentItemId);
}

/////////////////////////////////////////////////////////////////////////////////////////
QVariantList PlayerComponent::getWebPlaylist() const
{
  return m_webPlaylist;
}

/////////////////////////////////////////////////////////////////////////////////////////
QString PlayerComponent::getCurrentWebPlaylistItemId() const
{
  return m_currentWebPlaylistItemId;
}

// The local PCM effect owns only @deepstream-enhancement. Other filters remain untouched.
#include "PlayerComponentAudioEnhancement.inc"

#ifdef Q_OS_MAC
quint32 PlayerComponent::defaultAudioOutputDevice()
{
  AudioObjectPropertyAddress address{kAudioHardwarePropertyDefaultOutputDevice,
                                     kAudioObjectPropertyScopeGlobal,
                                     kAudioObjectPropertyElementMain};
  AudioDeviceID device = kAudioObjectUnknown;
  UInt32 size = sizeof(device);
  return AudioObjectGetPropertyData(kAudioObjectSystemObject, &address, 0, nullptr, &size, &device) == noErr
      ? static_cast<quint32>(device) : 0;
}
#endif

qint64 PlayerComponent::currentPlayingEntryId() const
{
  if (!m_mpv) return -1;
  bool ok = false;
  const qint64 position = m_mpv->getProperty("playlist-playing-pos").toLongLong(&ok);
  if (!ok || position < 0) return -1;
  const qint64 id = m_mpv->getProperty(QStringLiteral("playlist/%1/id").arg(position)).toLongLong(&ok);
  return ok && id >= 0 ? id : -1;
}

QString PlayerComponent::audioEnhancementRouteBlockReason() const
{
  if (!m_mpv || !m_inPlayback || !m_audioEnhancementSession.ready() ||
      currentPlayingEntryId() != m_audioEnhancementSession.activeEntry())
    return QStringLiteral("awaiting_audio");
  if (!m_audioEnhancementPlanFresh)
    return QStringLiteral("awaiting_audio_selection");
  if (m_doAc3Transcoding || !m_passthroughCodecs.isEmpty())
    return QStringLiteral("passthrough_configured");
#ifdef Q_OS_MAC
  if (!m_audioOutputDevice) return QStringLiteral("output_unconfirmed");
#endif
  const QString ao = m_mpv->getProperty("current-ao").toString().toLower();
  if (ao == QStringLiteral("avfoundation")) return QStringLiteral("spatial_route");
  if (ao != QStringLiteral("coreaudio")) return QStringLiteral("output_unconfirmed");
  const QString codec = m_mpv->getProperty("audio-codec-name").toString().toLower();
  if (codec.isEmpty()) return QStringLiteral("output_unconfirmed");
  // libmpv's codec name alone cannot disprove embedded object metadata.
  if (codec.contains("truehd") || codec.contains("eac3") || codec.contains("e-ac-3") ||
      codec.contains("dts") || codec == QStringLiteral("dca") || codec == QStringLiteral("mlp"))
    return QStringLiteral("object_unconfirmed");
  static const QSet<QString> pcmFormats = {QStringLiteral("u8"), QStringLiteral("u8p"),
      QStringLiteral("s16"), QStringLiteral("s16p"), QStringLiteral("s32"), QStringLiteral("s32p"),
      QStringLiteral("float"), QStringLiteral("floatp"), QStringLiteral("double"), QStringLiteral("doublep")};
  const QVariantMap decoded = m_mpv->getProperty("audio-params").toMap();
  const QVariantMap output = m_mpv->getProperty("audio-out-params").toMap();
  if (!pcmFormats.contains(decoded.value("format").toString().toLower()) ||
      !pcmFormats.contains(output.value("format").toString().toLower()) ||
      decoded.value("channel-count").toInt() <= 0 || output.value("channel-count").toInt() <= 0)
    return QStringLiteral("output_unconfirmed");
  return {};
}

bool PlayerComponent::removeAudioEnhancementAtBoundary()
{
  if (removeAudioEnhancementFilter()) {
    m_audioEnhancementBoundaryFailed = false;
    return true;
  }
  m_audioEnhancementBoundaryFailed = true;
  m_audioEnhancementReason = QStringLiteral("filter_remove_failed");
  return false;
}

void PlayerComponent::invalidateAudioEnhancementRoute()
{
  if (!m_audioEnhancementSession.matches(m_audioEnhancementSession.active())) return;
  m_audioEnhancementSession.changingTrack();
  if (!removeAudioEnhancementAtBoundary()) {
    if (m_mpv) m_mpv->command(QStringList() << "stop");
    return;
  }
  m_audioEnhancementReason = QStringLiteral("awaiting_audio");
}

void PlayerComponent::refreshAudioEnhancement()
{
  if (!m_audioEnhancement.value("enabled").toBool()) return;
  const QString blocked = audioEnhancementRouteBlockReason();
  if (!blocked.isEmpty()) {
    if (!removeAudioEnhancementAtBoundary()) {
      if (m_mpv) m_mpv->command(QStringList() << "stop");
      return;
    }
    m_audioEnhancementReason = blocked;
    return;
  }
  // Our own af-add causes another AUDIO_RECONFIG; don't remove/re-add in a loop.
  if (m_audioEnhancementActive && hasAudioEnhancementFilter()) return;
  applyAudioEnhancement();
  if (m_audioEnhancementReason == QStringLiteral("filter_remove_failed") && m_mpv)
    m_mpv->command(QStringList() << "stop");
}

QVariantMap PlayerComponent::scopedAudioEnhancementStatus(const QString& session, bool accepted) const
{
  QVariantMap status = accepted ? getAudioEnhancementStatus() : QVariantMap{};
  status.insert("session", session.left(128));
  status.insert("accepted", accepted);
  if (!accepted) {
    status.insert("state", QStringLiteral("bypass"));
    status.insert("reason", QStringLiteral("stale_session"));
    status.insert("active", false);
    status.insert("verified", false);
  }
  return status;
}

QVariantMap PlayerComponent::getAudioEnhancementStatusForSession(const QString& session) const
{
  return scopedAudioEnhancementStatus(session, m_audioEnhancementSession.matches(session.toStdString()));
}

QVariantMap PlayerComponent::setAudioEnhancementForSession(const QString& session, const QVariantMap& settings)
{
  const bool accepted = m_audioEnhancementSession.matches(session.toStdString());
  if (!accepted) return scopedAudioEnhancementStatus(session, false);
  m_audioEnhancementPlanFresh = true;
  setAudioEnhancement(settings);
  if (m_audioEnhancementReason == QStringLiteral("filter_remove_failed") && m_mpv)
    m_mpv->command(QStringList() << "stop");
  return scopedAudioEnhancementStatus(session, true);
}
#if defined(Q_OS_MAC) && defined(DEEPSTREAM_HAS_NATIVE_AV_BACKEND)

#ifdef DEEPSTREAM_EXPERIMENTAL_AUDIO_HLS
bool PlayerComponent::nativeAudioHlsRouteAllowed(bool videoRoute) const
{
  auto& settings=SettingsComponent::Get();QVariantMap audio;
  for(const QString& key : {QStringLiteral("spatialAudio"),QStringLiteral("devicetype"),QStringLiteral("device"),QStringLiteral("channels"),QStringLiteral("exclusive")})
    audio.insert(key,settings.value(SETTINGS_SECTION_AUDIO,key));
  return NativeAudioHlsRoute::allowed(audio,settings.value(SETTINGS_SECTION_OTHER,"other_conf").toString(),!videoRoute);
}
QString PlayerComponent::bindNativeAudioSession(const QVariantMap& request)
{
  clearNativeAudioSession();
  const QString contract=request.value(QStringLiteral("contract")).toString();
  bool videoRoute=false;
#ifdef DEEPSTREAM_EXPERIMENTAL_DOLBY_VISION_HLS
  videoRoute=contract==QStringLiteral("deepstream-video-hls-v1");
#ifdef DEEPSTREAM_EXPERIMENTAL_DOLBY_VISION_AUDIO_V2
  videoRoute=videoRoute || contract==QStringLiteral("deepstream-video-hls-v2");
#endif
#endif
  if((!videoRoute && !contract.isEmpty() && contract!=QStringLiteral("deepstream-audio-hls-v1")) ||
     !m_mpv || !m_mpv->fixtureIsolationConfirmed() || !m_nativeHlsSession || !nativeAudioHlsRouteAllowed(videoRoute))return {};
  return m_nativeHlsSession->bind(request);
}
void PlayerComponent::clearNativeAudioSession()
{
  if(m_nativeHlsSession)m_nativeHlsSession->clear();
  const bool stopNative=m_nativeAudioHls && m_avFixturePhase!=AVFixturePhase::Idle;
  const bool stopFallback=m_nativeFallbackRelay && (m_inPlayback || m_avFixtureMpvLoadPending);
  m_nativeFallbackRelay.reset();
  if(stopNative||stopFallback)stop();
}
#endif

#ifdef DEEPSTREAM_EXPERIMENTAL_AUDIO_HLS
bool PlayerComponent::startNativeAudioHls(const QString& url,const QVariantMap& options,const QVariantMap& metadata,
                                          const QVariant& audio,const QVariant& subtitle)
{
  const QVariantMap f=options.value(QStringLiteral("nativeAudioHls")).toMap();
  const QString contract=f.value(QStringLiteral("contract")).toString();
  bool videoRoute=false;
  bool videoV2=false;
#ifdef DEEPSTREAM_EXPERIMENTAL_DOLBY_VISION_HLS
  videoRoute=contract==QStringLiteral("deepstream-video-hls-v1");
#ifdef DEEPSTREAM_EXPERIMENTAL_DOLBY_VISION_AUDIO_V2
  videoV2=contract==QStringLiteral("deepstream-video-hls-v2");
  videoRoute=videoRoute || videoV2;
#endif
#endif
  if(f.value(QStringLiteral("enabled")).metaType().id()!=QMetaType::Bool || !f.value(QStringLiteral("enabled")).toBool() ||
     (!videoRoute && contract!=QStringLiteral("deepstream-audio-hls-v1")) ||
     f.value(QStringLiteral("sourceUrl")).toString()!=url || !m_nativeHlsSession || !m_mpv || !m_window ||
     !m_mpv->fixtureIsolationConfirmed() || !nativeAudioHlsRouteAllowed(videoRoute))return false;
  const QUrl source(url,QUrl::StrictMode);const QString binding=f.value(QStringLiteral("bindingId")).toString();
  if(!m_nativeHlsSession->permits(binding,source))return false;
  bool audioOk=false,subtitleOk=false;const int ai=audio.toInt(&audioOk),si=subtitle.toInt(&subtitleOk);
  const QVariantMap selected=f.value(QStringLiteral("selection")).toMap();bool streamOk=false;
  const int stream=selected.value(QStringLiteral("audioStreamIndex")).toInt(&streamOk);
  const QString media=selected.value(QStringLiteral("mediaSourceId")).toString();
  const QString spatial=selected.value(QStringLiteral("spatial")).toString();
  const QString playSession=f.value(QStringLiteral("playSessionId")).toString();
  const QString expectedCodec=selected.value(QStringLiteral("codec")).toString().toLower();
  const int selectedChannels=selected.value(QStringLiteral("channels")).toInt();
  int expectedChannels=0;
  if(videoV2){
#ifdef DEEPSTREAM_EXPERIMENTAL_DOLBY_VISION_AUDIO_V2
    const QVariant channelValue=selected.value(QStringLiteral("channels"));
    bool integerOk=false,numberOk=false;
    const int channels=channelValue.toInt(&integerOk);const double number=channelValue.toDouble(&numberOk);
    if(channelValue.metaType().id()==QMetaType::Bool || !integerOk || !numberOk ||
       number!=double(channels) || !NativeHlsAudioCodecPolicy::permitted(expectedCodec.toStdString(),channels))return false;
    expectedChannels=channels;
#else
    return false;
#endif
  }
  const bool allowedCodec=videoV2 || (videoRoute ? (expectedCodec==QStringLiteral("aac") || expectedCodec==QStringLiteral("eac3")) : expectedCodec==QStringLiteral("eac3"));
  if(!audioOk||ai!=1||!subtitleOk||si!=-1||!streamOk||stream<0||media.isEmpty()||playSession.isEmpty()||
     !allowedCodec ||
     (videoRoute && !videoV2 && (selectedChannels<1 || selectedChannels>(expectedCodec==QStringLiteral("aac") ? 2 : 8))) ||
     (spatial!=QStringLiteral("joc") && spatial!=QStringLiteral("unknown")))return false;
  const auto query=QUrlQuery(source).queryItems(QUrl::FullyDecoded);
  auto unique=[&](const QString& name,const QString& value){int count=0;QString found;
    for(const auto& pair:query)if(pair.first.compare(name,Qt::CaseInsensitive)==0){++count;found=pair.second;}
    return count==1 && found.compare(value,Qt::CaseInsensitive)==0;
  };
  if(!unique(QStringLiteral("AudioCodec"),expectedCodec)||
     !unique(QStringLiteral("AllowAudioStreamCopy"),QStringLiteral("true"))||
     !unique(QStringLiteral("AudioStreamIndex"),QString::number(stream))||
     !unique(QStringLiteral("MediaSourceId"),media)||!unique(QStringLiteral("PlaySessionId"),playSession))return false;
  if(videoV2 && (!unique(QStringLiteral("VideoCodec"),QStringLiteral("hevc")) ||
                 !unique(QStringLiteral("AllowVideoStreamCopy"),QStringLiteral("true"))))return false;
  m_nativeAudioHls=true;m_nativeVideoHls=videoRoute;m_nativeAudioHlsCodec=expectedCodec;m_nativeAudioHlsBindingId=binding;
  m_nativeAudioHlsExpectedChannels=expectedChannels;
  m_avFixtureUrl=url;m_avFixtureOptions=options;m_avFixtureMetadata=metadata;m_avFixtureAudio=audio;m_avFixtureSubtitle=subtitle;
  m_avFixtureAutoplay=options.value(QStringLiteral("autoplay")).toBool();
  m_avFixtureSeek=qMax<qint64>(0,options.value(QStringLiteral("startMilliseconds")).toLongLong());
  m_avFixturePhase=AVFixturePhase::Hashing;++m_avFixtureEpoch;beginAVFixtureDrain();return true;
}
#endif

bool PlayerComponent::startAVFixture(const QString& url, const QVariantMap& options, const QVariantMap& metadata,
                                     const QVariant& audio, const QVariant& subtitle)
{
#ifndef DEEPSTREAM_EXPERIMENTAL_AV_FIXTURE
  Q_UNUSED(url);Q_UNUSED(options);Q_UNUSED(metadata);Q_UNUSED(audio);Q_UNUSED(subtitle);
  return false;
#else
  const QVariantMap f = options.value("experimentalAv").toMap();
  if (f.value("enabled").metaType().id() != QMetaType::Bool || !f.value("enabled").toBool() || !m_mpv || !m_window)
    return false;
  const QString digest = QStringLiteral("70a29e4e5a56e79127db3820b98ce74a79e52e780beb57ff99eb5f90b428cc9e");
  const QUrl source(url);
  bool aok=false, sok=false;
  const int ai=audio.toInt(&aok), si=subtitle.toInt(&sok);
  if (f.value("fixture").toString() != "public-apple-joc-v1" || f.value("sourceUrl").toString() != url ||
      f.value("sourceSha256").toString() != digest || f.value("audioSelection").toString() != "single-joc" ||
      f.value("subtitles").toString() != "off" || f.value("transport").toString() != "public-loopback-fixture" ||
      source.scheme() != "http" || source.host() != "127.0.0.1" || source.port() < 1024 ||
      source.port() > 65535 || source.path() != "/single-joc-master.m3u8" || source.hasQuery() ||
      source.hasFragment() || !source.userInfo().isEmpty() || !aok || ai != 1 || !sok || si != -1 ||
      metadata.value("headers").metaType().id()!=QMetaType::QVariantMap ||
      !metadata.value("headers").toMap().isEmpty()) return false;
#ifdef DEEPSTREAM_EXPERIMENTAL_AUDIO_HLS
  m_nativeAudioHls=false;m_nativeVideoHls=false;m_nativeAudioHlsBindingId.clear();m_nativeAudioHlsCodec.clear();m_nativeAudioHlsExpectedChannels=0;
#endif
  m_avFixtureUrl=url; m_avFixtureOptions=options; m_avFixtureMetadata=metadata;
  m_avFixtureAudio=audio; m_avFixtureSubtitle=subtitle;
  m_avFixtureAutoplay=options.value("autoplay").toBool();
  m_avFixtureSeek=qMax<qint64>(0,options.value("startMilliseconds").toLongLong());
  m_avFixturePhase=AVFixturePhase::Hashing;
  const quint64 epoch=++m_avFixtureEpoch;
  QNetworkRequest req(source);
  req.setAttribute(QNetworkRequest::RedirectPolicyAttribute,QNetworkRequest::ManualRedirectPolicy);
  req.setTransferTimeout(4000);
  QNetworkReply* reply=m_avFixtureNetwork.get(req);m_avFixtureReply=reply;
  connect(reply,&QNetworkReply::readyRead,this,[reply]{if(reply->bytesAvailable()>16384)reply->abort();});
  connect(reply,&QNetworkReply::finished,this,[this,reply,epoch,digest]{
    const bool current=epoch==m_avFixtureEpoch && m_avFixturePhase==AVFixturePhase::Hashing;
    const int status=reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
    const QByteArray body=reply->readAll();
    const bool ok=reply->error()==QNetworkReply::NoError && status==200 && body.size()<=16384 &&
       QCryptographicHash::hash(body,QCryptographicHash::Sha256).toHex()==digest.toLatin1();
    reply->deleteLater();if(m_avFixtureReply==reply)m_avFixtureReply=nullptr;
    if(!current)return;
    if(!ok){failAVFixture(QStringLiteral("fixture_hash_or_http_failed"));return;}
    beginAVFixtureDrain();
  });
  return true;
#endif
}

void PlayerComponent::setAVFixtureVideoVisible(bool visible)
{
#ifdef DEEPSTREAM_HLS_CONTROLLED_MPV_TEST
  Q_UNUSED(visible);
  return; // separate native player window leaves WebEngine composition intact
#endif
  if (!m_window) return;
  const bool previousActive = avFixtureVideoActive();
  const auto revision=m_avFixtureLoads.revision();
  if (!visible && !m_avFixtureWindowColorSaved) {
    m_avFixturePreviousWindowColor=m_window->color();m_avFixtureWindowColorSaved=true;
    m_window->setColor(Qt::transparent);
    if(revision!=m_avFixtureLoads.revision())return;
  }
  if (QQuickItem* video=m_window->findChild<QQuickItem*>("video")) {
    if (!visible && !m_avFixtureVideoVisibilitySaved) {
      m_avFixturePreviousVideoVisible=video->isVisible();m_avFixtureVideoVisibilitySaved=true;video->setVisible(false);
      if(revision!=m_avFixtureLoads.revision())return;
    } else if (visible && m_avFixtureVideoVisibilitySaved) {
      m_avFixtureVideoVisibilitySaved=false;video->setVisible(m_avFixturePreviousVideoVisible);
      if(revision!=m_avFixtureLoads.revision())return;
    }
  }
  if (visible && m_avFixtureWindowColorSaved) {
    m_avFixtureWindowColorSaved=false;m_window->setColor(m_avFixturePreviousWindowColor);
    if(revision!=m_avFixtureLoads.revision())return;
  }
  if (previousActive != avFixtureVideoActive()) emit avFixtureVideoActiveChanged();
}

void PlayerComponent::setAVFixtureState(State state)
{
  if(state==m_state)return;
  const State old=m_state;m_state=state;
  const auto revision=m_avFixtureLoads.revision();
  switch(state) {
  case State::playing: emit playing(); break;
  case State::paused: emit paused(); break;
  case State::buffering: emit buffering(0); break;
  case State::finished: emit finished();if(revision!=m_avFixtureLoads.revision())return;emit stopped();break;
  case State::canceled: emit canceled();if(revision!=m_avFixtureLoads.revision())return;emit stopped();break;
  case State::error: break;
  }
  if(revision==m_avFixtureLoads.revision())emit stateChanged(state,old);
}

void PlayerComponent::beginAVFixtureDrain()
{
  if(m_avFixturePhase!=AVFixturePhase::Hashing || !m_mpv)return;
  const QVariant posValue=m_mpv->getProperty("playlist-playing-pos");
  bool ok=false;const qint64 pos=posValue.toLongLong(&ok);
  if(posValue.metaType().id()!=QMetaType::LongLong)ok=false;
  if(!ok || (pos<0 && (m_inPlayback || m_audioEnhancementSession.pending()))) {fallbackAVFixture();return;}
  std::optional<qint64> entry;
  if(pos>=0) {const qint64 id=currentPlayingEntryId();if(id<0){fallbackAVFixture();return;}entry=id;}
  // Test-only pre-initialization isolation rules out untracked scripts, config and IPC.
  // All app loadfile requests are tracked; userCommand and config reloads are disabled.
  const QVariant playlist=m_mpv->getProperty("playlist");
  m_avFixtureMpvIsolated=m_mpv->fixtureIsolationConfirmed();
  if(!m_avFixtureMpvIsolated || m_avFixtureMpvLoadPending || playlist.metaType().id()!=QMetaType::QVariantList ||
      playlist.toList().size()>(entry ? 1 : 0)){fallbackAVFixture();return;}
  // Never unmute a new output when the currently selected volume/mute state is unknown.
  const QVariant volumeValue=m_mpv->getProperty("volume"),muteValue=m_mpv->getProperty("mute");
  bool volumeOk=false;const double volume=volumeValue.toDouble(&volumeOk);
  if(volumeOk && qIsFinite(volume) && volume>=0 && volume<=100 && muteValue.metaType().id()==QMetaType::Bool) {
    m_avFixtureVolume=qRound(volume);m_avFixtureMuted=muteValue.toBool();
  } else {m_avFixtureVolume=0;m_avFixtureMuted=true;}
  const QVariant speedValue=m_mpv->getProperty("speed");bool speedOk=false;const double speed=speedValue.toDouble(&speedOk);
  m_avFixtureRate=(speedOk && qIsFinite(speed) && speed>=0.25 && speed<=4.0)?qRound(speed*1000.0):1000;
  m_avFixturePreviousGapless=m_mpv->getProperty("gapless-audio");
  if (!m_avFixturePreviousGapless.isValid() || m_avFixturePreviousGapless.metaType().id()==qMetaTypeId<ErrorReturn>()) {fallbackAVFixture();return;}
  if (m_mpv->setProperty("gapless-audio",QStringLiteral("no")) < 0) {fallbackAVFixture();return;}
  m_avFixtureGaplessSaved=true;
  const auto d=m_avFixtureCoordinator.start(true);
  if(d.action!=ExperimentalBackendCoordinator::Action::StopMpv){fallbackAVFixture();return;}
  m_avFixtureGeneration=d.generation;m_avFixtureCancelRequested=false;
  m_avFixtureDrainTicket=m_avFixtureLoads.beginDrain();
  if(!m_avFixtureDrainTicket){failAVFixture(QStringLiteral("fixture_drain_gate_failed"));return;}
  m_avFixtureFence.arm(d.generation,entry,true);
  m_avFixturePhase=AVFixturePhase::Draining;m_suppressMpvDuringDeferredHash=false;
  m_audioEnhancementSession.stop();m_audioEnhancementPlanFresh=false;m_pendingAudioEnhancement.clear();
  m_audioOutputMonitorTimer.stop();
  if(!removeAudioEnhancementAtBoundary()){failAVFixture(QStringLiteral("fixture_audio_cleanup_failed"));return;}
  const QVariant cleared=m_mpv->command(QStringList()<<"playlist-clear");
  const QVariant stopped=m_mpv->command(QStringList()<<"stop");
  m_avFixtureStopAccepted=cleared.metaType().id()!=qMetaTypeId<ErrorReturn>() && stopped.metaType().id()!=qMetaTypeId<ErrorReturn>();
  if(!m_avFixtureStopAccepted){failAVFixture(QStringLiteral("fixture_mpv_stop_failed"));return;}
  setAVFixtureState(State::buffering);
  m_avFixtureTimeout.setSingleShot(true);m_avFixtureTimeout.start(7000);
  emit onMpvEvents();
}

void PlayerComponent::advanceAVFixtureDrain()
{
  if(m_avFixturePhase!=AVFixturePhase::Draining || !m_mpv)return;
  QVariant idle=m_mpv->getProperty("core-idle"),pos=m_mpv->getProperty("playlist-playing-pos");
  bool posOk=false;const qint64 p=pos.toLongLong(&posOk);
  if(pos.metaType().id()!=QMetaType::LongLong)posOk=false;
  MpvStopFence::Snapshot snapshot;
  snapshot.commandAccepted=m_avFixtureStopAccepted;
  snapshot.coreIdleKnown=idle.metaType().id()==QMetaType::Bool;snapshot.coreIdle=idle.toBool();
  snapshot.playingPositionKnown=posOk;snapshot.playingPosition=p;
  snapshot.queueDrained=true;snapshot.noPendingLoads=m_avFixtureMpvIsolated && !m_avFixtureMpvLoadPending;
  // mpv reports current-ao as unavailable after the AO is detached. This
  // verifies only mpv state, never physical hardware-buffer release.
  const QVariant currentAO=m_mpv->getProperty("current-ao");
  if(currentAO.metaType().id()==qMetaTypeId<ErrorReturn>()) {
    snapshot.audioOutputKnown=currentAO.value<ErrorReturn>().error==MPV_ERROR_PROPERTY_UNAVAILABLE;
    snapshot.audioOutputInactive=snapshot.audioOutputKnown;
  } else if(currentAO.metaType().id()==QMetaType::QString) {
    snapshot.audioOutputKnown=true;snapshot.audioOutputInactive=currentAO.toString().isEmpty();
  }
  if(m_avFixtureFence.state()==MpvStopFence::State::Failed){failAVFixture(QStringLiteral("fixture_mpv_boundary_failed"));return;}
  if(!m_avFixtureFence.check(m_avFixtureGeneration,snapshot))return;
#ifdef DEEPSTREAM_EXPERIMENTAL_AUDIO_HLS
  m_nativeFallbackRelay.reset();
#endif
  // Hold gapless-audio=no throughout AV playback; the normal value is restored
  // on cancel, fallback, failure, or AV close before mpv is started again.
  if(m_avFixtureCancelRequested){
    if(!restoreAVFixtureGapless()){failAVFixture(QStringLiteral("fixture_gapless_restore_failed"));return;}
    const auto stop=m_avFixtureCoordinator.stop();
    if(stop.action!=ExperimentalBackendCoordinator::Action::StopMpv ||
       m_avFixtureCoordinator.mpvStopped(stop.generation,true).action!=ExperimentalBackendCoordinator::Action::None ||
       m_avFixtureCoordinator.state()!=ExperimentalBackendCoordinator::State::Idle) {
      failAVFixture(QStringLiteral("fixture_stop_transition_failed"));return;
    }
    // Keep the gate in Draining while visibility notifications run, so a
    // reentrant control or new load still targets the pending request.
    setAVFixtureVideoVisible(true);
    const auto deferred=m_avFixtureLoads.finishDrain(m_avFixtureDrainTicket,true);
    m_avFixtureDrainTicket=0;
    if(deferred.disposition==DeferredLoadGate<AVFixtureLoadRequest>::DrainDisposition::Stale ||
       deferred.disposition==DeferredLoadGate<AVFixtureLoadRequest>::DrainDisposition::Failed) {
      failAVFixture(QStringLiteral("fixture_drain_gate_failed"));return;
    }
    m_inPlayback=false;m_playbackCanceled=true;m_playbackError.clear();
#ifdef DEEPSTREAM_EXPERIMENTAL_AUDIO_HLS
    m_nativeAudioHls=false;m_nativeVideoHls=false;m_nativeAudioHlsBindingId.clear();m_nativeAudioHlsCodec.clear();m_nativeAudioHlsExpectedChannels=0;
#endif
    m_avFixturePhase=AVFixturePhase::Idle;m_avFixtureTimeout.stop();
    if(deferred.disposition==DeferredLoadGate<AVFixtureLoadRequest>::DrainDisposition::Load && deferred.request) {
      const auto request=*deferred.request;const auto revision=deferred.revision;
      if(!m_avFixtureLoads.isCurrent(revision) || m_avFixturePhase!=AVFixturePhase::Idle) return;
      bool controlsApplied=m_mpv;
      if(controlsApplied && request.volume) controlsApplied=m_mpv->setProperty("volume",*request.volume)>=0;
      if(controlsApplied && request.rate) controlsApplied=m_mpv->setProperty("speed",*request.rate/1000.0)>=0;
      if(controlsApplied && request.muted) controlsApplied=m_mpv->setProperty("mute",*request.muted)>=0;
      if(!m_avFixtureLoads.isCurrent(revision))return;
      m_suppressMpvDuringDeferredHash=true;
      const bool accepted=controlsApplied && loadAccepted(request.url,request.options,request.metadata,request.audio,request.subtitle,revision);
      if(m_avFixturePhase!=AVFixturePhase::Hashing)m_suppressMpvDuringDeferredHash=false;
      if(!accepted && m_avFixtureLoads.isCurrent(revision)) emit error(QStringLiteral("fixture_deferred_load_failed"));
    } else if(m_avFixtureLoads.revision()==deferred.revision) setAVFixtureState(State::canceled);
    return;
  }
  const auto completed=m_avFixtureLoads.finishDrain(m_avFixtureDrainTicket,true);
  m_avFixtureDrainTicket=0;
  if(completed.disposition!=DeferredLoadGate<AVFixtureLoadRequest>::DrainDisposition::Nothing) {
    failAVFixture(QStringLiteral("fixture_drain_gate_failed"));return;
  }
  const auto decision=m_avFixtureCoordinator.mpvStopped(m_avFixtureGeneration,true);
  if(decision.action!=ExperimentalBackendCoordinator::Action::StartAv){failAVFixture(QStringLiteral("fixture_transition_failed"));return;}
  m_inPlayback=false;m_avFixturePhase=AVFixturePhase::Starting;
  m_avFixtureVideoReady=false;m_avFixtureSeekPending=false;m_avFixtureAudioPoll.stop();
  m_avFixtureTimeout.start(7000);
  if(!m_avFixtureBackend){
    m_avFixtureBackend=std::make_unique<NativeAVBackend>();
    m_avFixtureBackend->setOutputLease([this]{return m_avFixturePhase==AVFixturePhase::Starting;},[]{});
    connect(m_avFixtureBackend.get(),&NativeAVBackend::videoReady,this,[this](quint64 id){
      if(id!=m_avFixtureGeneration || m_avFixturePhase!=AVFixturePhase::Starting)return;
      m_avFixtureVideoReady=true;
      checkAVFixtureAudioSelection();
      if(m_avFixturePhase==AVFixturePhase::Starting && !m_avFixtureSeekPending)m_avFixtureAudioPoll.start();
    });
    connect(m_avFixtureBackend.get(),&NativeAVBackend::seekFinished,this,[this](quint64 id,qint64 ms,bool ok){
      if(id!=m_avFixtureGeneration || m_avFixturePhase!=AVFixturePhase::Starting || !m_avFixtureSeekPending)return;
      if(!ok){qWarning() << "fixture_seek_failed";fallbackAVFixture();return;}
      if(ms!=m_avFixtureSeek){m_avFixtureBackend->seek(id,m_avFixtureSeek);return;}
      m_avFixtureSeekPending=false;
      const auto d=m_avFixtureCoordinator.avStarted(id,true);
      if(d.action!=ExperimentalBackendCoordinator::Action::None || !m_avFixtureCoordinator.accepts(ExperimentalBackendCoordinator::Backend::Av,id)){fallbackAVFixture();return;}
      m_avFixtureTimeout.stop();m_avFixturePhase=AVFixturePhase::Active;
      m_avFixtureBackend->setVolume(id,m_avFixtureVolume);m_avFixtureBackend->setRate(id,m_avFixtureRate);m_avFixtureBackend->setMuted(id,m_avFixtureMuted);
      if(m_avFixtureAutoplay){m_avFixtureBackend->play(id);}
      else {m_avFixtureBackend->pause(id);setAVFixtureState(State::paused);}
    });
    connect(m_avFixtureBackend.get(),&NativeAVBackend::positionChanged,this,[this](quint64 id,qint64 ms){
      if(m_avFixturePhase!=AVFixturePhase::Active || !m_avFixtureCoordinator.accepts(ExperimentalBackendCoordinator::Backend::Av,id))return;
      m_positionMs=ms;emit positionUpdate(quint64(qMax<qint64>(0,ms)));
    });
    connect(m_avFixtureBackend.get(),&NativeAVBackend::durationChanged,this,[this](quint64 id,qint64 ms){
      if(id!=m_avFixtureGeneration || (m_avFixturePhase!=AVFixturePhase::Starting && m_avFixturePhase!=AVFixturePhase::Active))return;
      m_durationMs=ms;emit updateDuration(ms);
    });
    connect(m_avFixtureBackend.get(),&NativeAVBackend::stateChanged,this,[this](quint64 id,const QString& state){
      if(m_avFixturePhase!=AVFixturePhase::Active || !m_avFixtureCoordinator.accepts(ExperimentalBackendCoordinator::Backend::Av,id))return;
      if(state=="playing")setAVFixtureState(State::playing);else if(state=="paused")setAVFixtureState(State::paused);else if(state=="buffering")setAVFixtureState(State::buffering);
    });
    connect(m_avFixtureBackend.get(),&NativeAVBackend::audioStateChanged,this,[this](quint64 id,int volume,bool muted){
      if(m_avFixturePhase!=AVFixturePhase::Active || !m_avFixtureCoordinator.accepts(ExperimentalBackendCoordinator::Backend::Av,id))return;
      m_avFixtureVolume=volume;m_avFixtureMuted=muted;
      const QString token=m_avFixtureOptions.value(QStringLiteral("nativeControlToken")).toString();
      if(QRegularExpression(QStringLiteral("^[0-9a-f]{32}$")).match(token).hasMatch())emit nativeAudioStateChanged(token,volume,muted);
    });
#ifdef DEEPSTREAM_HLS_CONTROLLED_MPV_TEST
    connect(m_avFixtureBackend.get(),&NativeAVBackend::nativeWindowClosed,this,[this](quint64 id){
      if(id!=m_avFixtureGeneration || (m_avFixturePhase!=AVFixturePhase::Starting && m_avFixturePhase!=AVFixturePhase::Active))return;
      const QString token=m_avFixtureOptions.value(QStringLiteral("nativeControlToken")).toString();
      stop();
      if(id==m_avFixtureGeneration && m_avFixturePhase==AVFixturePhase::Idle && m_state==State::canceled && QRegularExpression(QStringLiteral("^[0-9a-f]{32}$")).match(token).hasMatch())emit nativeWindowStopped(token);
    });
#endif
    connect(m_avFixtureBackend.get(),&NativeAVBackend::finished,this,[this](quint64 id){
      if(m_avFixturePhase!=AVFixturePhase::Active || !m_avFixtureCoordinator.accepts(ExperimentalBackendCoordinator::Backend::Av,id))return;
      const auto revision=m_avFixtureLoads.revision();
      if(!cancelAVFixture(false) || revision!=m_avFixtureLoads.revision())return;
      m_inPlayback=false;m_playbackCanceled=false;m_playbackError.clear();setAVFixtureState(State::finished);
    });
    connect(m_avFixtureBackend.get(),&NativeAVBackend::error,this,[this](quint64 id,const QString& reason){
      if(id!=m_avFixtureGeneration)return;
      if(m_avFixturePhase==AVFixturePhase::Starting){qWarning() << "fixture_av_start_failed";fallbackAVFixture();}
      else if(m_avFixturePhase==AVFixturePhase::Active){
        if(reason==QStringLiteral("native_hls_audio_changed"))failAVFixture(QStringLiteral("native_hls_audio_changed"));
        else fallbackAVFixture();
      }
    });
  }
  const auto revision=m_avFixtureLoads.revision();const auto generation=m_avFixtureGeneration;
  m_avFixtureBackend->setVideoWindow(m_window);setAVFixtureVideoVisible(false);
  if(revision!=m_avFixtureLoads.revision() || generation!=m_avFixtureGeneration || m_avFixturePhase!=AVFixturePhase::Starting)return;
  bool opened=false;
#ifdef DEEPSTREAM_EXPERIMENTAL_AUDIO_HLS
  if(m_nativeAudioHls){
    const QUrl source(m_avFixtureUrl,QUrl::StrictMode);
    if(!m_nativeHlsSession||!m_nativeHlsSession->permits(m_nativeAudioHlsBindingId,source)){failAVFixture(QStringLiteral("native_hls_session_expired"));return;}
    opened=m_avFixtureBackend->openAuthorizedHls(generation,source,m_nativeHlsSession->base(),m_nativeHlsSession->authorization(),m_nativeHlsSession->allowsLocalHttp(),true);
  } else
#endif
    opened=m_avFixtureBackend->open(generation,QUrl(m_avFixtureUrl),true);
  if(!opened){
    if(revision==m_avFixtureLoads.revision() && generation==m_avFixtureGeneration && m_avFixturePhase==AVFixturePhase::Starting){qWarning() << "fixture_av_open_failed";fallbackAVFixture();}return;
  }
  if(revision!=m_avFixtureLoads.revision() || generation!=m_avFixtureGeneration || m_avFixturePhase!=AVFixturePhase::Starting)return;
  m_avFixtureBackend->play(generation); // muted until source selection and video are checked
}

void PlayerComponent::checkAVFixtureAudioSelection()
{
  if(m_avFixturePhase!=AVFixturePhase::Starting || !m_avFixtureVideoReady ||
     m_avFixtureSeekPending || !m_avFixtureBackend || m_avFixtureBackend->session()!=m_avFixtureGeneration)return;
#ifdef DEEPSTREAM_EXPERIMENTAL_AUDIO_HLS
  if(m_nativeAudioHls){
    const QString state=m_avFixtureBackend->authenticatedHlsAudioState(m_avFixtureGeneration,m_nativeAudioHlsCodec,m_nativeAudioHlsExpectedChannels);
    if(state==QStringLiteral("pending"))return;
    if(state!=m_nativeAudioHlsCodec+QStringLiteral("_verified")){fallbackAVFixture();return;}
    m_avFixtureBackend->monitorAuthenticatedHlsAudio(m_avFixtureGeneration,m_nativeAudioHlsCodec,m_nativeAudioHlsExpectedChannels);
  } else
#endif
    if(!m_avFixtureBackend->hasOneSelectedAudioOption(m_avFixtureGeneration))return;
  m_avFixtureAudioPoll.stop();
  // The short muted run exposes the image/audio choice; restore requested time before release.
  m_avFixtureBackend->pause(m_avFixtureGeneration);m_avFixtureSeekPending=true;
  m_avFixtureBackend->seek(m_avFixtureGeneration,m_avFixtureSeek);
}

void PlayerComponent::fallbackAVFixture()
{
  const auto phase=m_avFixturePhase;
  if(phase!=AVFixturePhase::Hashing && phase!=AVFixturePhase::Starting && phase!=AVFixturePhase::Active)return;
  bool captured=phase==AVFixturePhase::Starting;
  if(phase==AVFixturePhase::Active){
    const QVariantMap snapshot=m_avFixtureBackend?m_avFixtureBackend->failureSnapshot(m_avFixtureGeneration):QVariantMap{};
    const QVariant position=snapshot.value(QStringLiteral("positionMs"));
    const QVariant autoplay=snapshot.value(QStringLiteral("autoplay"));
    const QVariant volume=snapshot.value(QStringLiteral("volume"));
    const QVariant muted=snapshot.value(QStringLiteral("muted"));
    bool okPos=false,okVolume=false;const qint64 ms=position.toLongLong(&okPos);const int level=volume.toInt(&okVolume);
    if(!okPos||ms<0||!okVolume||level<0||level>100||autoplay.metaType().id()!=QMetaType::Bool||muted.metaType().id()!=QMetaType::Bool){failAVFixture(QStringLiteral("native_fallback_state_unavailable"));return;}
    m_avFixtureSeek=ms;m_avFixtureAutoplay=autoplay.toBool();m_avFixtureVolume=level;m_avFixtureMuted=muted.toBool();captured=true;
  }
  const auto revision=m_avFixtureLoads.revision();
  const auto generation=m_avFixtureGeneration;
  const QString url=m_avFixtureUrl;QVariantMap options=m_avFixtureOptions;options.remove("experimentalAv");
#ifdef DEEPSTREAM_EXPERIMENTAL_AUDIO_HLS
  const bool authenticatedFallback=m_nativeAudioHls;const QString fallbackBinding=m_nativeAudioHlsBindingId;
  options.remove("nativeAudioHls");m_nativeAudioHls=false;m_nativeVideoHls=false;m_nativeAudioHlsBindingId.clear();m_nativeAudioHlsCodec.clear();m_nativeAudioHlsExpectedChannels=0;
#endif
  options.insert("startMilliseconds",m_avFixtureSeek);options.insert("autoplay",m_avFixtureAutoplay);
  const QVariantMap metadata=m_avFixtureMetadata;const QVariant audio=m_avFixtureAudio,subtitle=m_avFixtureSubtitle;
  if(phase==AVFixturePhase::Starting || phase==AVFixturePhase::Active){
    auto d=m_avFixtureCoordinator.avFailed(m_avFixtureGeneration);
    if(d.action!=ExperimentalBackendCoordinator::Action::CloseAv){failAVFixture(QStringLiteral("fixture_fallback_transition_failed"));return;}
    if(m_avFixtureBackend)m_avFixtureBackend->close(m_avFixtureGeneration);
    if(m_avFixtureCoordinator.avClosed(m_avFixtureGeneration,true).action!=ExperimentalBackendCoordinator::Action::StartMpv){failAVFixture(QStringLiteral("fixture_fallback_close_failed"));return;}
    // No mpv start was issued yet. Confirm its actual idle state before
    // returning the coordinator to Idle, so reentrant replacements are safe.
    const QVariant idle=m_mpv ? m_mpv->getProperty("core-idle") : QVariant();
    const QVariant pos=m_mpv ? m_mpv->getProperty("playlist-playing-pos") : QVariant();
    bool ok=false;const qint64 position=pos.toLongLong(&ok);
    const auto stopping=m_avFixtureCoordinator.stop();
    const bool confirmed=stopping.action==ExperimentalBackendCoordinator::Action::StopMpv &&
      idle.metaType().id()==QMetaType::Bool && idle.toBool() &&
      pos.metaType().id()==QMetaType::LongLong && ok && position==-1 &&
      m_avFixtureMpvIsolated && !m_avFixtureMpvLoadPending;
    if(stopping.action!=ExperimentalBackendCoordinator::Action::StopMpv ||
       m_avFixtureCoordinator.mpvStopped(stopping.generation,confirmed).action!=ExperimentalBackendCoordinator::Action::None ||
       m_avFixtureCoordinator.state()!=ExperimentalBackendCoordinator::State::Idle) {
      m_avFixtureLoads.failClosed();failAVFixture(QStringLiteral("fixture_fallback_stop_unconfirmed"));return;
    }
  }
  ++m_avFixtureEpoch;m_avFixtureTimeout.stop();m_avFixtureAudioPoll.stop();m_avFixtureVideoReady=false;m_avFixtureSeekPending=false;
  m_avFixturePhase=AVFixturePhase::Idle;m_suppressMpvDuringDeferredHash=false;
  const bool restored=restoreAVFixtureGapless();
  const auto restoredRevision=restored ? revision : m_avFixtureLoads.failClosed();
  setAVFixtureVideoVisible(true);
  if(restoredRevision!=m_avFixtureLoads.revision())return;
  if(!restored){emit error(QStringLiteral("fixture_gapless_restore_failed"));return;}
  if(captured && !restoreMpvAudioState()){emit error(QStringLiteral("native_audio_state_restore_failed"));return;}
  bool loaded=false;
#ifdef DEEPSTREAM_EXPERIMENTAL_AUDIO_HLS
  if(authenticatedFallback){
    const QUrl source(url,QUrl::StrictMode);
    if(!m_nativeHlsSession || !m_nativeHlsSession->permits(fallbackBinding,source)){
      emit error(QStringLiteral("native_hls_session_expired"));return;
    }
    auto relay=std::make_unique<HlsSessionRelay>();
    const QUrl local=relay->start(source,m_nativeHlsSession->base(),m_nativeHlsSession->authorization(),m_nativeHlsSession->allowsLocalHttp());
    if(local.isValid()){
      const QUrl trustedOrigin=source.adjusted(QUrl::RemovePath | QUrl::RemoveQuery | QUrl::RemoveFragment);
      QScopedValueRollback<QUrl> metadataOrigin(m_nativeFallbackMetadataOrigin,trustedOrigin);
      loaded=loadAccepted(local.toString(QUrl::FullyEncoded),options,metadata,audio,subtitle,revision);
    }
    if(revision!=m_avFixtureLoads.revision() || generation!=m_avFixtureGeneration)return;
    if(loaded)m_nativeFallbackRelay=std::move(relay);
  } else
#endif
    loaded=loadAccepted(url,options,metadata,audio,subtitle,revision);
  if(revision!=m_avFixtureLoads.revision() || generation!=m_avFixtureGeneration)return;
  if(!loaded)emit error(QStringLiteral("fixture_fallback_failed"));
}

bool PlayerComponent::snapshotNativeAudioState()
{
  if(!m_avFixtureBackend || m_avFixtureBackend->session()!=m_avFixtureGeneration)return false;
  m_avFixtureVolume=m_avFixtureBackend->volume(m_avFixtureGeneration);
  m_avFixtureMuted=m_avFixtureBackend->muted(m_avFixtureGeneration);
  return true;
}

bool PlayerComponent::restoreMpvAudioState()
{
  if(!m_mpv || m_mpv->setProperty("mute",true)<0)return false;
  if(m_mpv->setProperty("volume",m_avFixtureVolume)<0)return false;
  if(m_mpv->setProperty("mute",m_avFixtureMuted)<0){m_mpv->setProperty("mute",true);return false;}
  return true;
}

bool PlayerComponent::cancelAVFixture(bool userStop)
{
  const AVFixturePhase old=m_avFixturePhase;
  const bool needsAudioRestore=(old==AVFixturePhase::Starting || old==AVFixturePhase::Active);
  const bool captured=old==AVFixturePhase::Starting || (old==AVFixturePhase::Active && snapshotNativeAudioState());
  const auto revision=m_avFixtureLoads.revision();
  if(old==AVFixturePhase::Draining && m_avFixtureDrainTicket) {
    m_avFixtureLoads.finishDrain(m_avFixtureDrainTicket,false);m_avFixtureDrainTicket=0;
  }
  ++m_avFixtureEpoch;m_avFixtureTimeout.stop();m_avFixtureAudioPoll.stop();m_avFixtureVideoReady=false;m_avFixtureSeekPending=false;
  if(m_avFixtureReply){m_avFixtureReply->abort();m_avFixtureReply=nullptr;}
  if(m_avFixtureBackend && (old==AVFixturePhase::Starting || old==AVFixturePhase::Active)){
    m_avFixtureBackend->setMuted(m_avFixtureGeneration,true);m_avFixtureBackend->close(m_avFixtureGeneration);
  }
  if(old!=AVFixturePhase::Hashing && old!=AVFixturePhase::Idle){
    const auto d=m_avFixtureCoordinator.stop();
    if(d.action==ExperimentalBackendCoordinator::Action::CloseAv)m_avFixtureCoordinator.avClosed(d.generation,true);
    else if(d.action==ExperimentalBackendCoordinator::Action::StopMpv)m_avFixtureCoordinator.mpvStopped(d.generation,false);
  }
  m_avFixturePhase=AVFixturePhase::Idle;m_suppressMpvDuringDeferredHash=false;
  const bool restored=restoreAVFixtureGapless();
  const auto restoredRevision=restored ? revision : m_avFixtureLoads.failClosed();
  m_avFixtureUrl.clear();m_avFixtureOptions.clear();m_avFixtureMetadata.clear();
#ifdef DEEPSTREAM_EXPERIMENTAL_AUDIO_HLS
  m_nativeAudioHls=false;m_nativeVideoHls=false;m_nativeAudioHlsBindingId.clear();m_nativeAudioHlsCodec.clear();m_nativeAudioHlsExpectedChannels=0;
#endif
  setAVFixtureVideoVisible(true);
  if(restoredRevision!=m_avFixtureLoads.revision())return false;
  if(!restored){emit error(QStringLiteral("fixture_gapless_restore_failed"));return false;}
  if(needsAudioRestore && !captured){if(m_mpv)m_mpv->setProperty("mute",true);emit error(QStringLiteral("native_audio_state_unavailable"));return false;}
  if(needsAudioRestore && !restoreMpvAudioState()){emit error(QStringLiteral("native_audio_state_restore_failed"));return false;}
  if(userStop && old!=AVFixturePhase::Hashing && old!=AVFixturePhase::Idle){m_inPlayback=false;m_playbackCanceled=true;m_playbackError.clear();setAVFixtureState(State::canceled);}
  return restoredRevision==m_avFixtureLoads.revision();
}

bool PlayerComponent::restoreAVFixtureGapless()
{
  if(!m_avFixtureGaplessSaved)return true;
  if(!m_mpv || m_mpv->setProperty("gapless-audio",m_avFixturePreviousGapless)<0)return false;
  m_avFixtureGaplessSaved=false;m_avFixturePreviousGapless.clear();return true;
}

void PlayerComponent::failAVFixture(const QString& reason)
{
  const auto revision=m_avFixtureLoads.stop();
  if(!cancelAVFixture(false) || revision!=m_avFixtureLoads.revision())return;
  m_playbackError=reason;setAVFixtureState(State::error);
  if(revision==m_avFixtureLoads.revision())emit error(reason);
}
#endif

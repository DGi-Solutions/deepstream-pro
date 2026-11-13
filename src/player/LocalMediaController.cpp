#include "LocalMediaController.h"
#include "PlayerComponent.h"
#include "LocalMediaTrackPolicy.h"
#include "LocalMediaPendingPolicy.h"
#include <MpvController>
#include <QFileInfo>
#include <QScopedValueRollback>
#include <QTimer>

LocalMediaController::LocalMediaController(QObject *parent) : QObject(parent) {
  auto &p = PlayerComponent::Get();
  connect(&p, &PlayerComponent::playbackOwnerChangeRequested, this, [this] { externalChange(); });
  connect(&p, &PlayerComponent::playbackQueueChangeRequested, this, [this] {
    if (m_gate.active()) m_foreignQueue = true;
  });
  connect(&p, &PlayerComponent::mpvEntryStarted, this, [this](qint64) {
    if (m_gate.active()) ready();
  });
  connect(&p, &PlayerComponent::mpvEntryLoaded, this, [this](qint64 entry) {
    if (!m_gate.active() || !ready()) return;
    if (m_gate.matches(m_gate.generation(), entry, true)) m_started = true;
  });
  connect(&p, &PlayerComponent::mpvEntryFailed, this, [this](qint64 entry) {
    if (!m_gate.active() || !m_gate.matches(m_gate.generation(), entry, true)) return;
    m_gate.invalidate(); m_file.clear(); m_started = false; m_foreignQueue = false;
    emit startupFailed(true); // This specific playlist entry has already ended.
  });
}

void LocalMediaController::externalChange() {
  if (m_ownRequest) { m_ownRequest = false; return; }
  const bool wasActive = m_gate.active();
  m_gate.invalidate();
  m_file.clear();
  m_foreignQueue = false;
  if (wasActive) emit invalidated();
}

bool LocalMediaController::canDropFile(const QUrl &url) const {
  if (!url.isLocalFile() || !url.host().isEmpty() || url.hasQuery() || url.hasFragment()) return false;
  const QFileInfo file(url.toLocalFile());
  const QString canonical = file.canonicalFilePath();
  return file.isFile() && file.isReadable() && !canonical.isEmpty();
}

QString LocalMediaController::dropInteractionToken() const {
  auto &p = PlayerComponent::Get();
  if (!p.m_mpv) return QString();
  const QVariant playlist = p.m_mpv->getProperty("playlist");
  if (playlist.metaType().id() != QMetaType::QVariantList) return QString();
  QStringList parts{QString::number(static_cast<qulonglong>(m_gate.generation())),
                    QString::number(p.currentPlayingEntryId())};
  for (const QVariant &item : playlist.toList()) {
    bool ok = false;
    const qint64 id = item.toMap().value(QStringLiteral("id")).toLongLong(&ok);
    if (!ok || id < 0) return QString();
    parts.append(QString::number(id));
  }
  return parts.join(QLatin1Char(':'));
}

bool LocalMediaController::open(const QUrl &url) {
  if (!canDropFile(url)) return false;
  const QString canonical = QFileInfo(url.toLocalFile()).canonicalFilePath();
  if (canonical.isEmpty()) return false;
  auto &p = PlayerComponent::Get();
  if (!p.m_mpv) return false;
  const QVariant playlist = p.m_mpv->getProperty("playlist");
  if (playlist.metaType().id() != QMetaType::QVariantList) return false;
  std::vector<long long> previous;
  for (const QVariant &item : playlist.toList()) {
    bool ok = false; const qint64 id = item.toMap().value(QStringLiteral("id")).toLongLong(&ok);
    if (!ok || id < 0) return false;
    previous.push_back(id);
  }
  const auto request = m_gate.begin(previous);
  m_file = canonical;
  m_started = false;
  m_foreignQueue = false;
  m_loadRevision = 0;
  const QScopedValueRollback<bool> guard(m_ownRequest, true);
  const bool accepted = p.load(url.toString(QUrl::FullyEncoded), {{QStringLiteral("autoplay"),true}}, {}, QStringLiteral("#auto"), -1);
  if (!accepted && m_gate.generation() == request) { m_gate.invalidate(); m_file.clear(); emit invalidated(); }
  if (!accepted || !m_gate.active() || m_gate.generation() != request) return false;
#if defined(Q_OS_MAC) && defined(DEEPSTREAM_HAS_NATIVE_AV_BACKEND)
  m_loadRevision = p.m_avFixtureLoads.revision();
#endif
  QTimer::singleShot(30000, this, [this, request] {
    if (!localShouldTimeOut(m_gate.active(), m_started, m_gate.generation() == request)) return;
    ready(); // Bind/check ownership without mistaking a playlist entry for FILE_LOADED.
    if (!localShouldTimeOut(m_gate.active(), m_started, m_gate.generation() == request)) return;
    emit startupFailed(close());
  });
  return true;
}

bool LocalMediaController::sameFile() const {
  const auto &p = PlayerComponent::Get();
  if (!p.m_mpv || m_file.isEmpty()) return false;
  const QString value = p.m_mpv->getProperty("path").toString();
  const QUrl url(value);
  const QString path = url.isLocalFile() ? url.toLocalFile() : value;
  return !path.isEmpty() && QFileInfo(path).canonicalFilePath() == m_file;
}

bool LocalMediaController::ready() {
  auto &p = PlayerComponent::Get();
  if (!m_gate.active()) return false;
  const qint64 entry = p.currentPlayingEntryId();
  const bool fileMatches = sameFile();
  if (m_gate.bound() && entry >= 0 && !m_gate.matches(m_gate.generation(), entry, true)) {
    externalChange();
    return false;
  }
  if (m_gate.matches(m_gate.generation(), entry, fileMatches)) return true;
  return m_gate.bind(m_gate.generation(), entry, fileMatches);
}

bool LocalMediaController::cancelOwnedPending() {
  auto &p = PlayerComponent::Get();
#if defined(Q_OS_MAC) && defined(DEEPSTREAM_HAS_NATIVE_AV_BACKEND)
  if (p.m_avFixtureLoads.draining()) {
    if (!m_loadRevision || !p.m_avFixtureLoads.isCurrent(m_loadRevision)) return false;
    p.m_avFixtureLoads.stop(); // Cancels only the pending request, not the draining backend.
    return true;
  }
  if (p.m_avFixturePhase != PlayerComponent::AVFixturePhase::Idle) return false;
#endif
  if (!p.m_mpv) return false;
  const QVariant value = p.m_mpv->getProperty("playlist");
  if (value.metaType().id() != QMetaType::QVariantList) return false;
  const QVariantList list = value.toList();
  std::vector<LocalPendingEntry> entries;
  for (const QVariant &value : list) {
    const QVariantMap item = value.toMap();
    bool ok = false;
    const qint64 id = item.value(QStringLiteral("id")).toLongLong(&ok);
    const QString valuePath = item.value(QStringLiteral("filename")).toString();
    const QUrl url(valuePath);
    const QString path = url.isLocalFile() ? url.toLocalFile() : valuePath;
    entries.push_back({ok && id >= 0, m_gate.isNewEntry(id),
                       !path.isEmpty() && QFileInfo(path).canonicalFilePath() == m_file});
  }
  const auto action = localPendingAction(entries);
  if (action == LocalPendingAction::NothingPending) return true;
  if (action != LocalPendingAction::StopSoleOwned) return false;
  // A single newly created entry matching our selected file is the only
  // unbound mpv state in which a global stop cannot stop another playlist item.
  const QScopedValueRollback<bool> guard(m_ownRequest, true);
  p.stop();
  return true;
}

bool LocalMediaController::advanceOwnedEntryWithoutClearingQueue() {
  auto &p = PlayerComponent::Get();
  if (!p.m_mpv || !m_gate.active() || !m_gate.bound() || !sameFile()) return false;
  bool ok = false;
  const qint64 index = p.m_mpv->getProperty("playlist-playing-pos").toLongLong(&ok);
  if (!ok || index < 0) return false;
  const qint64 id = p.m_mpv->getProperty(QStringLiteral("playlist/%1/id").arg(index)).toLongLong(&ok);
  if (!ok || !m_gate.matches(m_gate.generation(), id, true)) return false;
  const std::string expression = localGuardedNextValue(index, id);
  if (expression.empty()) return false;
  // An ordinary read followed by playlist-remove has a core-thread race. mpv
  // expands this conditional and sets playlist-pos within one core command:
  // stale playlist index/ID or a no-longer-playing entry fails closed.
  const QVariant result = p.m_mpv->command(QStringList() << QStringLiteral("expand-properties")
      << QStringLiteral("set") << QStringLiteral("playlist-pos") << QString::fromStdString(expression));
  return result.metaType().id() != qMetaTypeId<ErrorReturn>();
}

bool LocalMediaController::close() {
  if (!m_gate.active()) return true;
  const bool owned = ready();
  if (!m_gate.active()) return true;
  if (owned && m_foreignQueue) {
    // Advance to the next queued entry without globally clearing the playlist.
    // On a stale/mismatched current entry mpv rejects the guarded set.
    if (!advanceOwnedEntryWithoutClearingQueue()) return false;
    m_gate.invalidate(); m_file.clear(); m_started = false; m_foreignQueue = false;
    return true;
  }
  if (!owned && !cancelOwnedPending()) return false;
  m_gate.invalidate(); m_file.clear();
  if (!owned) return true;
  const QScopedValueRollback<bool> guard(m_ownRequest, true);
  PlayerComponent::Get().stop();
  return true;
}

QVariantMap LocalMediaController::state() {
  const bool isReady = ready();
  QVariantMap result{{QStringLiteral("active"),m_gate.active()},{QStringLiteral("ready"),isReady}};
  if (!isReady) return result;
  auto &p = PlayerComponent::Get();
  result[QStringLiteral("position")] = p.getPosition();
  result[QStringLiteral("duration")] = p.getDuration();
  result[QStringLiteral("volume")] = p.volume();
  result[QStringLiteral("paused")] = p.m_mpv->getProperty("pause").toBool();
  QVariantList tracks;
  for (const QVariant &item : p.m_mpv->getProperty("track-list").toList()) {
    const QVariantMap track = item.toMap();
    const QString type = track.value(QStringLiteral("type")).toString();
    bool ok = false; const int id = track.value(QStringLiteral("id")).toInt(&ok);
    if (!ok || id <= 0 || (type != QStringLiteral("audio") && type != QStringLiteral("sub"))) continue;
    QVariantMap entry{{QStringLiteral("type"),type},{QStringLiteral("id"),id},
      {QStringLiteral("language"),track.value(QStringLiteral("lang")).toString().left(32)},
      {QStringLiteral("codec"),track.value(QStringLiteral("codec")).toString().left(32)},
      {QStringLiteral("selected"),track.value(QStringLiteral("selected")).toBool()}};
    tracks.append(entry);
  }
  result[QStringLiteral("tracks")] = tracks;
  return result;
}

void LocalMediaController::play() { if (ready()) PlayerComponent::Get().play(); }
void LocalMediaController::pause() { if (ready()) PlayerComponent::Get().pause(); }
void LocalMediaController::seek(qint64 ms) { if (ms >= 0 && ready()) PlayerComponent::Get().seekTo(ms); }
void LocalMediaController::volume(int value) { if (value >= 0 && value <= 100 && ready()) PlayerComponent::Get().setVolume(value); }
bool LocalMediaController::selectTrack(const QString &type, int id) {
  const auto kind = type == QStringLiteral("audio") ? LocalMediaTrackKind::Audio :
                    type == QStringLiteral("sub") ? LocalMediaTrackKind::Subtitle : LocalMediaTrackKind::Invalid;
  if (!ready() || kind == LocalMediaTrackKind::Invalid) return false;
  auto &p = PlayerComponent::Get();
  std::vector<int> present;
  for (const QVariant &item : p.m_mpv->getProperty("track-list").toList()) {
    const QVariantMap track = item.toMap(); bool ok = false;
    const int candidate = track.value(QStringLiteral("id")).toInt(&ok);
    if (ok && candidate > 0 && track.value(QStringLiteral("type")).toString() == type) present.push_back(candidate);
  }
  if (!localMediaTrackAllowed(ready(), kind, id, present)) return false;
  if (kind == LocalMediaTrackKind::Audio) p.setAudioStream(id); else p.setSubtitleStream(id);
  return true;
}

QString LocalMediaController::subtitleDialogToken() {
  return ready() ? QString::number(static_cast<qulonglong>(m_gate.generation())) : QString();
}

bool LocalMediaController::addSubtitleFile(const QUrl &url, const QString &token) {
  bool validToken = false;
  const quint64 generation = token.toULongLong(&validToken);
  if (!validToken || token.isEmpty() || !ready() || m_gate.generation() != generation ||
      !url.isLocalFile() || !url.host().isEmpty() || url.hasQuery() || url.hasFragment()) return false;
  const QFileInfo file(url.toLocalFile());
  const QString canonical = file.canonicalFilePath();
  if (!file.isFile() || !file.isReadable() || canonical.isEmpty()) return false;
  // The dialog can remain open during a session change; never act on the
  // subsequent player session even if its file name happens to be identical.
  if (!ready() || m_gate.generation() != generation) return false;
  auto &p = PlayerComponent::Get();
  const QVariant result = p.m_mpv->command(QStringList() << QStringLiteral("sub-add") << canonical << QStringLiteral("select"));
  return result.metaType().id() != qMetaTypeId<ErrorReturn>();
}

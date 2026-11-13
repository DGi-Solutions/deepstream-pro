#pragma once
#include <QObject>
#include <QString>
#include <QUrl>
#include <QVariantMap>
#include <functional>
#include <memory>

class QQuickWindow;

// Isolated feasibility prototype: local files or HTTPS HLS; no integration with mpv.
class NativeAVBackend : public QObject {
 Q_OBJECT
public:
 using Acquire = std::function<bool()>;
 using Release = std::function<void()>;
 explicit NativeAVBackend(QObject *parent = nullptr);
 ~NativeAVBackend() override;
 void setOutputLease(Acquire acquire, Release release);
 void setVideoWindow(QQuickWindow *window);
 static bool supportsTestUrl(const QUrl &url);
 bool open(quint64 session, const QUrl &url, bool muted = true);
#ifdef DEEPSTREAM_EXPERIMENTAL_AUDIO_HLS
 // Origin must come from the trusted active Jellyfin session, not media metadata.
 bool openAuthorizedHls(quint64 session, const QUrl &url, const QUrl &configuredOrigin,
                        const QByteArray &authorization, bool explicitlyConfiguredLocalHttp,
                        bool muted = true);
#endif
 void play(quint64 session);
 void pause(quint64 session);
 void setVolume(quint64 session, int volume);
 void setMuted(quint64 session, bool muted);
 void setRate(quint64 session, int rate);
 int volume(quint64 session) const;
 bool muted(quint64 session) const;
 void seek(quint64 session, qint64 milliseconds);
 void close(quint64 session);
 quint64 session() const;
 // Confirms a single selected AV audio option only; it does not identify JOC.
 bool hasOneSelectedAudioOption(quint64 session) const;
 QString audioSelectionState(quint64 session) const;
 QVariantMap audioSelectionEvidence(quint64 session) const;
 QVariantMap videoSelectionEvidence(quint64 session) const;
 QVariantMap failureSnapshot(quint64 session) const;
#ifdef DEEPSTREAM_EXPERIMENTAL_AUDIO_HLS
 // Reject unknown codecs and ambiguous HLS audio choices.
 QString authenticatedHlsAudioState(quint64 session, const QString& codec = QStringLiteral("eac3"), int expectedChannels = 0) const;
 void monitorAuthenticatedHlsAudio(quint64 session, const QString& codec = QStringLiteral("eac3"), int expectedChannels = 0);
#endif
signals:
 void ready(quint64 session);
 void videoReady(quint64 session);
 void stateChanged(quint64 session, const QString &state);
 void audioStateChanged(quint64 session, int volume, bool muted);
 void positionChanged(quint64 session, qint64 milliseconds);
 void durationChanged(quint64 session, qint64 milliseconds);
 void seekFinished(quint64 session, qint64 milliseconds, bool finished);
 void finished(quint64 session);
#ifdef DEEPSTREAM_HLS_CONTROLLED_MPV_TEST
 void nativeWindowClosed(quint64 session);
#endif
 void error(quint64 session, const QString &reason);
private:
 struct Impl; std::unique_ptr<Impl> d;
 void reset();
 bool openResolved(quint64 session, const QUrl &url, bool muted);
 void recordFailureSnapshot();
 void poll();
};

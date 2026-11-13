#pragma once
#include "HlsOriginPolicy.h"
#include <QObject>
#include <QHash>
#include <QByteArray>
#include <QNetworkAccessManager>
#include <QTcpServer>
#include <QUrl>
#include <QVariantMap>
#include "HlsDolbyManifestEvidence.h"

class QTcpSocket;
class QNetworkReply;

// One instance belongs to one playback session and is destroyed at stop.
// Callers supply the *existing* authorization value; nothing is logged or
// persisted. Cross-origin references and all redirects fail closed.
class HlsSessionRelay : public QObject {
 Q_OBJECT
public:
 explicit HlsSessionRelay(QObject* parent=nullptr);
 ~HlsSessionRelay() override;
 // `configuredOrigin` must come from the trusted active server configuration,
 // not from the playlist or the request being evaluated.
 QUrl start(const QUrl& source,const QUrl& configuredOrigin,const QByteArray& authorization,
            bool explicitlyConfiguredLocalHttp=false);
 void stop();
 int inFlightCount() const;
 // Session-scoped aggregate declarations; never exposes source URLs or tokens.
 QVariantMap offeredDolbyVisionEvidence() const;
 // Returns a redacted declaration from the latest AVPlayer access log only.
 QVariantMap lastObservedDolbyVariant(const QByteArray& uri) const;
signals:
 // Emitted before replacing root evidence. Native observer snapshots how many
 // access-log entries predate this request; no URL is exposed in the signal.
 void rootPlaylistWillReload();
private:
 void incoming(QTcpSocket* socket);
 void handle(QTcpSocket* socket,const QByteArray& request);
 QUrl addMapping(const QUrl& upstream);
 void fail(QTcpSocket* socket,int status);
 QTcpServer server_;
 QNetworkAccessManager network_;
 QUrl origin_, loopback_;
 QUrl rootSource_;
 HlsDolbyManifestEvidence::BoundSummary offeredDolby_;
 HlsDolbyManifestEvidence::BoundVariantLookup variantsDolby_;
 QByteArray authorization_, capability_;
 QHash<QString,QUrl> routes_;
 QHash<QUrl,QString> reverseRoutes_;
 quint64 counter_=0, epoch_=0, rootRequestSerial_=0;
};

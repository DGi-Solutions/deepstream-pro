#pragma once
#include "HlsOriginPolicy.h"
#include <QObject>
#include <QByteArray>
#include <QNetworkAccessManager>
#include <QPointer>
#include <QUrl>
#include <QVariantMap>
#include <functional>
class QNetworkReply;

// Ephemeral authorization. Context is supplied by native connectivity and
// the actual main-frame state, never by the playback request itself.
class NativeHlsSession : public QObject {
 Q_OBJECT
public:
 struct Context { QUrl verifiedBase; QString verifiedServerId; QUrl webUrl; bool mainFrameReady=false; };
 using ContextProvider=std::function<Context()>;
 explicit NativeHlsSession(ContextProvider provider,QObject* parent=nullptr);
 ~NativeHlsSession() override;
 QString bind(const QVariantMap& request);
 void clear();
 bool permits(const QString& bindingId,const QUrl& source) const;
 QUrl base() const {return ready_?base_:QUrl();}
 QByteArray authorization() const {return ready_?authorization_:QByteArray();}
 bool allowsLocalHttp() const {return ready_&&base_.scheme().compare(QStringLiteral("http"),Qt::CaseInsensitive)==0;}
signals:
 void bindingResult(const QString& bindingId,bool success);
private:
 bool contextMatches(const Context& ctx,const QUrl& base,const QString& serverId) const;
 ContextProvider provider_;QNetworkAccessManager network_;QPointer<QNetworkReply> reply_;
 QUrl base_;QString serverId_,userId_,bindingId_;QByteArray authorization_;quint64 generation_=0;bool ready_=false;
};

#include "NativeHlsSession.h"
#include "HlsAuthorizationPolicy.h"
#include <QJsonDocument>
#include <QElapsedTimer>
#include <QTimer>
#include <QJsonObject>
#include <QNetworkReply>
#include <QNetworkRequest>
#include <QRegularExpression>
#include <QUuid>
namespace {
QUrl cleanOrigin(QUrl url){url.setPath(QString());url.setQuery(QString());url.setFragment(QString());return url;}
bool cleanBase(const QUrl& url){return HlsOriginPolicy::validHttpUrl(url)&&!url.hasQuery()&&!url.hasFragment()&&url.userInfo().isEmpty();}
QString normalizedPath(const QUrl& url){QString path=url.adjusted(QUrl::NormalizePathSegments).path(QUrl::FullyEncoded);while(path.endsWith('/')&&path.size()>1)path.chop(1);return path==QStringLiteral("/")?QString():path;}
bool safeId(const QString& text){return text.size()>0&&text.size()<=128&&QRegularExpression(QStringLiteral("^[A-Za-z0-9_.-]+$")).match(text).hasMatch();}
bool safeAuth(const QByteArray& value){return !value.isEmpty()&&value.size()<=8192&&!value.contains('\r')&&!value.contains('\n')&&!value.contains('\0');}
}
NativeHlsSession::NativeHlsSession(ContextProvider provider,QObject* parent):QObject(parent),provider_(std::move(provider)){}
NativeHlsSession::~NativeHlsSession(){clear();}
void NativeHlsSession::clear(){
 ++generation_;ready_=false;if(reply_){auto* reply=reply_.data();reply_=nullptr;reply->abort();reply->deleteLater();}
 authorization_.fill('\0');authorization_.clear();base_=QUrl();serverId_.clear();userId_.clear();bindingId_.clear();
}
bool NativeHlsSession::contextMatches(const Context& ctx,const QUrl& base,const QString& serverId)const{
 if(!ctx.mainFrameReady||!cleanBase(base)||!cleanBase(ctx.verifiedBase)||!safeId(serverId)||
    serverId.compare(ctx.verifiedServerId,Qt::CaseInsensitive)!=0)return false;
 if(!HlsOriginPolicy::sameOrigin(base,ctx.verifiedBase)||!HlsOriginPolicy::safeScopedPath(base)||normalizedPath(base)!=normalizedPath(ctx.verifiedBase))return false;
 QUrl webOrigin=cleanOrigin(ctx.webUrl);if(!HlsOriginPolicy::sameOrigin(webOrigin,base)||!HlsOriginPolicy::safeScopedPath(ctx.webUrl))return false;
 const QString prefix=normalizedPath(base), webPath=normalizedPath(ctx.webUrl), webBase=prefix+QStringLiteral("/web");
 return webPath==webBase || webPath.startsWith(webBase+QStringLiteral("/"));
}
QString NativeHlsSession::bind(const QVariantMap& request){
 clear();const QUrl base(request.value(QStringLiteral("serverBaseUrl")).toString(),QUrl::StrictMode);
 const QString server=request.value(QStringLiteral("serverId")).toString(),user=request.value(QStringLiteral("userId")).toString();
 const QByteArray auth=request.value(QStringLiteral("authorization")).toString().toUtf8();
 if(!provider_||!contextMatches(provider_(),base,server)||!safeId(user)||!safeAuth(auth)||HlsAuthorizationPolicy::token(auth).isEmpty()||
    (base.scheme().compare(QStringLiteral("http"),Qt::CaseInsensitive)==0 && !HlsOriginPolicy::localLiteral(base.host())))return {};
 base_=base;serverId_=server;userId_=user;authorization_=auth;bindingId_=QUuid::createUuid().toString(QUuid::WithoutBraces);
 const QString id=bindingId_;const quint64 epoch=generation_;
 QUrl me=base_;QString path=me.path();while(path.endsWith('/'))path.chop(1);me.setPath(path+QStringLiteral("/Users/Me"));
 QNetworkRequest q(me);q.setRawHeader("Authorization",auth);q.setRawHeader("Accept","application/json");
 q.setAttribute(QNetworkRequest::RedirectPolicyAttribute,QNetworkRequest::ManualRedirectPolicy);
 q.setAttribute(QNetworkRequest::CookieLoadControlAttribute,QNetworkRequest::Manual);q.setAttribute(QNetworkRequest::CookieSaveControlAttribute,QNetworkRequest::Manual);q.setTransferTimeout(8000);
 QNetworkReply* reply=network_.get(q);reply_=reply;QElapsedTimer started;started.start();
 QTimer::singleShot(10000,reply,[reply]{if(!reply->isFinished())reply->abort();});
 connect(reply,&QNetworkReply::readyRead,this,[reply]{if(reply->bytesAvailable()>65536)reply->abort();});
 connect(reply,&QNetworkReply::finished,this,[this,reply,id,epoch,started]{
  if(reply_==reply)reply_=nullptr;const QByteArray body=reply->readAll();
  const bool ok=epoch==generation_&&started.elapsed()<=10000&&reply->error()==QNetworkReply::NoError&&
   reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt()==200&&body.size()<=65536&&
   HlsOriginPolicy::sameOrigin(reply->url(),base_)&&provider_&&contextMatches(provider_(),base_,serverId_)&&
   QJsonDocument::fromJson(body).object().value(QStringLiteral("Id")).toString().compare(userId_,Qt::CaseInsensitive)==0;
  reply->deleteLater();if(epoch!=generation_)return;
  if(ok)ready_=true;else{authorization_.fill('\0');authorization_.clear();base_=QUrl();serverId_.clear();userId_.clear();bindingId_.clear();}
  emit bindingResult(id,ok);
 });
 return id;
}
bool NativeHlsSession::permits(const QString& id,const QUrl& source)const{
 if(!ready_||id.isEmpty()||id!=bindingId_||!provider_||!contextMatches(provider_(),base_,serverId_)||!HlsOriginPolicy::sameScope(source,base_)||
    HlsAuthorizationPolicy::mode(source,authorization_)==HlsAuthorizationPolicy::Mode::Invalid)return false;
 return source.path().endsWith(QStringLiteral(".m3u8"),Qt::CaseInsensitive);
}

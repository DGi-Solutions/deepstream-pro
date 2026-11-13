#include "HlsSessionRelay.h"
#include "HlsAuthorizationPolicy.h"
#include <QTcpSocket>
#include <QNetworkReply>
#include <QNetworkRequest>
#include <QPointer>
#include <QRandomGenerator>
#include <QRegularExpression>
#include <QSharedPointer>
#include <QTimer>
#include <limits>

namespace {
struct Exchange {
 QPointer<QTcpSocket> socket;
 QPointer<QNetworkReply> reply;
 QUrl upstream;
 QByteArray buffer, probe, requestedRange;
 quint64 epoch=0,rootRequest=0;
 bool playlist=false,classified=false,ranged=false,headersSent=false,networkFinished=false,closed=false;
};
bool safeHeader(const QByteArray& value){return value.size()<=8192&&!value.contains('\r')&&!value.contains('\n')&&!value.contains('\0');}
}
HlsSessionRelay::HlsSessionRelay(QObject* parent):QObject(parent){
 connect(&server_,&QTcpServer::newConnection,this,[this]{while(auto* socket=server_.nextPendingConnection())incoming(socket);});
}
HlsSessionRelay::~HlsSessionRelay(){stop();}
int HlsSessionRelay::inFlightCount() const {return network_.findChildren<QNetworkReply*>().size();}
QVariantMap HlsSessionRelay::offeredDolbyVisionEvidence() const {
 const auto offered=offeredDolby_.read(epoch_);
 if(!server_.isListening()||!offered.available)return {{QStringLiteral("status"),QStringLiteral("unknown")}};
 return {{QStringLiteral("status"),QStringLiteral("offered-manifest-only")},
         {QStringLiteral("variantCount"),offered.variants},
         {QStringLiteral("dv5Count"),offered.dv5},
         {QStringLiteral("dv81Count"),offered.dv81},
         {QStringLiteral("dv84Count"),offered.dv84},
         {QStringLiteral("selected"),QStringLiteral("unknown")},
         {QStringLiteral("outputConfirmed"),false}};
}
QVariantMap HlsSessionRelay::lastObservedDolbyVariant(const QByteArray& uri) const {
 if(!server_.isListening()||uri.isEmpty()||uri.size()>8192)return {{QStringLiteral("status"),QStringLiteral("unknown")}};
 const auto mode=variantsDolby_.lastObserved(epoch_,std::string(uri.constData(),static_cast<std::size_t>(uri.size())));
 if(mode=="unknown")return {{QStringLiteral("status"),QStringLiteral("unknown")}};
 return {{QStringLiteral("status"),QStringLiteral("last-access-log-declaration")},
         {QStringLiteral("mode"),QString::fromStdString(mode)},
         {QStringLiteral("outputConfirmed"),false}};
}
QUrl HlsSessionRelay::start(const QUrl& source,const QUrl& configuredOrigin,const QByteArray& authorization,bool explicitlyConfiguredLocalHttp){
 stop();
 if(!HlsOriginPolicy::sameScope(source,configuredOrigin)||configuredOrigin.hasQuery()||
    (configuredOrigin.scheme().compare(QStringLiteral("http"),Qt::CaseInsensitive)==0 &&
      (!explicitlyConfiguredLocalHttp || !HlsOriginPolicy::localLiteral(configuredOrigin.host()))) ||
    !safeHeader(authorization)||authorization.isEmpty()||!source.path().endsWith(QStringLiteral(".m3u8"),Qt::CaseInsensitive))return {};
 if(!server_.listen(QHostAddress::LocalHost,0))return {};
 origin_=configuredOrigin;rootSource_=source;authorization_=authorization;capability_.clear();
 for(int i=0;i<4;i++)capability_+=QByteArray::number(QRandomGenerator::system()->generate(),16).rightJustified(8,'0');
 loopback_=QUrl(QStringLiteral("http://127.0.0.1:%1").arg(server_.serverPort()));
 const QUrl mapped=addMapping(source);if(!mapped.isValid())stop();return mapped;
}
void HlsSessionRelay::stop(){
 ++epoch_;
 server_.close();
 const auto sockets=findChildren<QTcpSocket*>();for(auto* socket:sockets)socket->abort();
 const auto replies=network_.findChildren<QNetworkReply*>();for(auto* reply:replies){reply->abort();reply->deleteLater();}
 routes_.clear();reverseRoutes_.clear();authorization_.fill('\0');authorization_.clear();capability_.clear();origin_=QUrl();loopback_=QUrl();rootSource_=QUrl();offeredDolby_.clear();variantsDolby_.clear();counter_=0;rootRequestSerial_=0;
}
QUrl HlsSessionRelay::addMapping(const QUrl& upstream){
 if(!HlsOriginPolicy::sameScope(upstream,origin_)||HlsAuthorizationPolicy::mode(upstream,authorization_)==HlsAuthorizationPolicy::Mode::Invalid)return {};
 QString id=reverseRoutes_.value(upstream);
 if(id.isEmpty()){
  if(counter_==std::numeric_limits<quint64>::max()||routes_.size()>=100000)return {};
  const QString ext=upstream.path().section('.',-1).toLower();
  static const QStringList allowedExtensions={QStringLiteral("m3u8"),QStringLiteral("ts"),QStringLiteral("m4s"),QStringLiteral("mp4"),QStringLiteral("aac"),QStringLiteral("vtt")};
  const QString suffix=allowedExtensions.contains(ext)?ext:QStringLiteral("bin");
  id=QString::number(++counter_)+QStringLiteral("/resource.")+suffix;
  routes_.insert(id,upstream);reverseRoutes_.insert(upstream,id);
 }
 QUrl u=loopback_;u.setPath(QStringLiteral("/")+QString::fromLatin1(capability_)+QStringLiteral("/")+id);return u;
}
void HlsSessionRelay::fail(QTcpSocket* socket,int status){
 if(!socket)return;const QByteArray message=status==404?"Not Found":"Bad Gateway";
 socket->write("HTTP/1.1 "+QByteArray::number(status)+" "+message+"\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");socket->disconnectFromHost();
}
void HlsSessionRelay::incoming(QTcpSocket* socket){
 socket->setParent(this);
 if(findChildren<QTcpSocket*>().size()>64){socket->abort();socket->deleteLater();return;}
 if(!socket->peerAddress().isLoopback()){socket->abort();socket->deleteLater();return;}
 const quint64 epoch=epoch_;
 auto buffer=QSharedPointer<QByteArray>::create();auto handled=QSharedPointer<bool>::create(false);
 connect(socket,&QTcpSocket::disconnected,socket,&QObject::deleteLater);
 connect(socket,&QTcpSocket::readyRead,this,[this,socket,buffer,handled,epoch]{
  if(*handled || epoch!=epoch_)return;*buffer+=socket->readAll();if(buffer->size()>16384){*handled=true;fail(socket,400);return;}
  const auto end=buffer->indexOf("\r\n\r\n");if(end<0)return;*handled=true;
  if(buffer->size()!=end+4){fail(socket,400);return;}handle(socket,*buffer);
 });
 QTimer::singleShot(10000,socket,[socket,handled]{if(!*handled)socket->abort();});
}
void HlsSessionRelay::handle(QTcpSocket* socket,const QByteArray& raw){
 const QList<QByteArray> lines=raw.split('\n');if(lines.isEmpty()){fail(socket,400);return;}
 const auto start=lines.first().trimmed().split(' ');if(start.size()!=3||start[0]!="GET"||start[2]!="HTTP/1.1"){fail(socket,400);return;}
 const QByteArray path=start[1];const QByteArray prefix="/"+capability_+"/";
 if(capability_.isEmpty()||!path.startsWith(prefix)||path.contains('?')||path.contains('#')){fail(socket,404);return;}
 const QString id=QString::fromLatin1(path.mid(prefix.size()));if(!routes_.contains(id)){fail(socket,404);return;}
 QByteArray host,range;int hostCount=0,rangeCount=0;
 for(int i=1;i<lines.size();++i){const QByteArray line=lines[i].trimmed();if(line.isEmpty())continue;const auto colon=line.indexOf(':');if(colon<=0){fail(socket,400);return;}
  const QByteArray key=line.left(colon).trimmed().toLower(),value=line.mid(colon+1).trimmed();
  if(key=="host"){host=value;++hostCount;}else if(key=="range"){range=value;++rangeCount;}
  else if(key=="content-length"||key=="transfer-encoding"){fail(socket,400);return;}
 }
 if(hostCount!=1||host.toLower()!=("127.0.0.1:"+QByteArray::number(server_.serverPort()))||rangeCount>1){fail(socket,400);return;}
 if(!range.isEmpty()&&!QRegularExpression(QStringLiteral("^bytes=[0-9]+-[0-9]*$")).match(QString::fromLatin1(range)).hasMatch()){fail(socket,400);return;}
 // A request for the entire entity may be answered with 200. Fetch and
 // rewrite playlists whole, including those without a .m3u8 suffix.
 if(range=="bytes=0-")range.clear();
 const QUrl upstream=routes_.value(id);if(!HlsOriginPolicy::sameScope(upstream,origin_)){fail(socket,404);return;}
 quint64 rootRequest=0;
 if(upstream==rootSource_){
  if(rootRequestSerial_==std::numeric_limits<quint64>::max()){fail(socket,502);return;}
  emit rootPlaylistWillReload();
  rootRequest=++rootRequestSerial_;
  offeredDolby_.clear();
  variantsDolby_.invalidateCurrent();
 }
 if(upstream.path().endsWith(QStringLiteral(".m3u8"),Qt::CaseInsensitive)&&!range.isEmpty()){fail(socket,400);return;}
 QNetworkRequest req(upstream);req.setAttribute(QNetworkRequest::RedirectPolicyAttribute,QNetworkRequest::ManualRedirectPolicy);
 req.setAttribute(QNetworkRequest::CookieLoadControlAttribute,QNetworkRequest::Manual);
 req.setAttribute(QNetworkRequest::CookieSaveControlAttribute,QNetworkRequest::Manual);
 req.setTransferTimeout(20000);
 const auto authMode=HlsAuthorizationPolicy::mode(upstream,authorization_);
 if(authMode==HlsAuthorizationPolicy::Mode::Invalid){fail(socket,404);return;}
 if(authMode==HlsAuthorizationPolicy::Mode::Header)req.setRawHeader("Authorization",authorization_);
 req.setRawHeader("Accept-Encoding","identity");if(!range.isEmpty())req.setRawHeader("Range",range);
 auto* reply=network_.get(req);reply->setReadBufferSize(1024*1024);
 auto state=QSharedPointer<Exchange>::create();state->socket=socket;state->reply=reply;state->upstream=upstream;state->epoch=epoch_;state->rootRequest=rootRequest;
 state->playlist=upstream.path().endsWith(QStringLiteral(".m3u8"),Qt::CaseInsensitive);state->ranged=!range.isEmpty();state->requestedRange=range;
 connect(socket,&QTcpSocket::disconnected,reply,[reply]{reply->abort();});
 auto pump=[this,state]{
  auto* socket=state->socket.data();auto* reply=state->reply.data();if(!socket||!reply||state->closed||state->epoch!=epoch_)return;
  const int status=reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
  if(status!=200&&status!=206){if(state->networkFinished){state->closed=true;fail(socket,502);reply->deleteLater();}return;}
  // The origin may ignore Range and return 200. Never serve a full object
  // as the requested bounded or nonzero range. bytes=0- was normalized above.
  if(state->ranged&&status==200){state->closed=true;reply->abort();fail(socket,502);reply->deleteLater();return;}
  if(!state->classified){
   const QByteArray encoding=reply->rawHeader("Content-Encoding").trimmed().toLower();
   if(!encoding.isEmpty() && encoding!="identity"){state->closed=true;reply->abort();fail(socket,502);reply->deleteLater();return;}
   const QByteArray type=reply->rawHeader("Content-Type").split(';').first().trimmed().toLower();
   const bool playlistType=type=="application/vnd.apple.mpegurl" || type=="application/x-mpegurl" || type=="audio/mpegurl" || type=="audio/x-mpegurl";
   state->probe+=reply->read(qMax<qint64>(0,10-state->probe.size()));
   if(!state->playlist && !playlistType && state->probe.size()<10 && !state->networkFinished)return;
   const bool playlistSignature=state->probe.startsWith("#EXTM3U") || state->probe.startsWith("\xef\xbb\xbf#EXTM3U");
   state->playlist=state->playlist||playlistType||playlistSignature;state->classified=true;
   if(state->playlist && state->ranged){state->closed=true;reply->abort();fail(socket,502);reply->deleteLater();return;}
   if(state->playlist)state->buffer=state->probe;
  }
  if(state->playlist){
   state->buffer+=reply->readAll();if(state->buffer.size()>1024*1024){state->closed=true;reply->abort();fail(socket,502);reply->deleteLater();return;}
   if(!state->networkFinished)return;
   if(reply->error()!=QNetworkReply::NoError){state->closed=true;fail(socket,502);reply->deleteLater();return;}
   const auto result=HlsOriginPolicy::rewrite(state->buffer,state->upstream,origin_,loopback_,[this](const QUrl& url){return addMapping(url);});
   state->closed=true;if(result.error!=HlsOriginPolicy::Error::None){fail(socket,502);reply->deleteLater();return;}
   offeredDolby_.observe(state->epoch,epoch_,state->upstream==rootSource_,true,state->rootRequest,rootRequestSerial_,
       std::string(state->buffer.constData(),static_cast<std::size_t>(state->buffer.size())));
   variantsDolby_.observe(state->epoch,epoch_,state->upstream==rootSource_,true,state->rootRequest,rootRequestSerial_,
       std::string(result.playlist.constData(),static_cast<std::size_t>(result.playlist.size())));
   socket->write("HTTP/1.1 200 OK\r\nContent-Type: application/vnd.apple.mpegurl\r\nCache-Control: no-store\r\nContent-Length: "+QByteArray::number(result.playlist.size())+"\r\nConnection: close\r\n\r\n");socket->write(result.playlist);socket->disconnectFromHost();reply->deleteLater();return;
  }
  if(!state->headersSent){
   const QByteArray contentType=reply->rawHeader("Content-Type"),contentRange=reply->rawHeader("Content-Range"),contentLength=reply->rawHeader("Content-Length");
   bool lengthOk=contentLength.isEmpty();quint64 length=0;
   if(!contentLength.isEmpty())length=contentLength.toULongLong(&lengthOk);
   bool rangeOk=true;
   if(status==206){
    const auto asked=QRegularExpression(QStringLiteral("^bytes=([0-9]+)-([0-9]*)$")).match(QString::fromLatin1(state->requestedRange));
    const auto got=QRegularExpression(QStringLiteral("^bytes ([0-9]+)-([0-9]+)/([0-9]+|\\*)$")).match(QString::fromLatin1(contentRange));
    bool aok=false,bok=false,cok=false,dok=true;const quint64 start=asked.captured(1).toULongLong(&aok),lo=got.captured(1).toULongLong(&bok),hi=got.captured(2).toULongLong(&cok);
    quint64 askedEnd=0;if(!asked.captured(2).isEmpty())askedEnd=asked.captured(2).toULongLong(&dok);
    bool totalOk=true;quint64 total=0;if(got.captured(3)!=QStringLiteral("*"))total=got.captured(3).toULongLong(&totalOk);
    const bool totalKnown=got.captured(3)!=QStringLiteral("*");
    const bool expectedEnd=totalKnown ? (total>0 && hi==(asked.captured(2).isEmpty()?total-1:qMin(askedEnd,total-1))) :
      (!asked.captured(2).isEmpty() && hi==askedEnd);
    // A partial response without a declared byte count cannot be safely
    // verified before streaming it to the local player: fail closed.
    rangeOk=asked.hasMatch()&&got.hasMatch()&&aok&&bok&&cok&&dok&&totalOk&&lo==start&&hi>=lo&&expectedEnd&&
      !contentLength.isEmpty() && lengthOk && hi-lo<std::numeric_limits<quint64>::max() && length==hi-lo+1;
   }
   if(!safeHeader(contentType)||!safeHeader(contentRange)||!safeHeader(contentLength)||!lengthOk||!rangeOk){state->closed=true;reply->abort();fail(socket,502);reply->deleteLater();return;}
   QByteArray out="HTTP/1.1 "+QByteArray::number(status)+(status==206?" Partial Content\r\n":" OK\r\n");
   if(!contentType.isEmpty())out+="Content-Type: "+contentType+"\r\n";if(!contentRange.isEmpty())out+="Content-Range: "+contentRange+"\r\n";
   if(!contentLength.isEmpty())out+="Content-Length: "+contentLength+"\r\n";out+="Cache-Control: no-store\r\nConnection: close\r\n\r\n";socket->write(out);state->headersSent=true;
  }
  if(!state->probe.isEmpty()){socket->write(state->probe);state->probe.clear();}
  while(reply->bytesAvailable()>0&&socket->bytesToWrite()<1024*1024)socket->write(reply->read(65536));
  if(state->networkFinished&&reply->bytesAvailable()==0){state->closed=true;if(reply->error()!=QNetworkReply::NoError)socket->abort();else socket->disconnectFromHost();reply->deleteLater();}
 };
 connect(reply,&QNetworkReply::readyRead,this,pump);connect(socket,&QTcpSocket::bytesWritten,this,[pump](qint64){pump();});
 connect(reply,&QNetworkReply::finished,this,[state,pump]{state->networkFinished=true;pump();});
}

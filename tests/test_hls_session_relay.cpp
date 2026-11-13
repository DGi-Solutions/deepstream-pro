#include "HlsSessionRelay.h"
#include <QCoreApplication>
#include <QTcpServer>
#include <QTcpSocket>
#include <QNetworkAccessManager>
#include <QNetworkReply>
#include <QEventLoop>
#include <QTimer>
#include <cstdlib>
#include <iostream>
#define CHECK(x) do{if(!(x)){std::cerr<<"FAIL line "<<__LINE__<<"\n";std::exit(1);}}while(false)
struct TestServer:QObject {
 QTcpServer s;int requests=0;bool authOk=true,sawRange=false,cookieSeen=false;
 TestServer(){connect(&s,&QTcpServer::newConnection,this,[this]{while(auto* c=s.nextPendingConnection()){
  c->setParent(this);connect(c,&QTcpSocket::disconnected,c,&QObject::deleteLater);
  connect(c,&QTcpSocket::readyRead,this,[this,c]{QByteArray raw=c->readAll();if(!raw.contains("\r\n\r\n"))return;++requests;
   const bool hasHeader=raw.contains("Authorization: MediaBrowser Token=\"synthetic\"\r\n");const bool hasQuery=raw.contains("ApiKey=synthetic");
   authOk=authOk&&(hasHeader!=hasQuery);cookieSeen=cookieSeen||raw.toLower().contains("\r\ncookie:");
   const bool range=raw.contains("Range: bytes=1-3\r\n");if(range)sawRange=true;
   QByteArray body,head="HTTP/1.1 200 OK\r\n";
   if(raw.startsWith("GET /slow.m3u8"))return;
   if(raw.startsWith("GET /master.m3u8")){body="#EXTM3U\nchild.m3u8?ApiKey=synthetic\n";head+="Set-Cookie: synthetic=must-not-persist; Path=/\r\n";}
   else if(raw.startsWith("GET /range-master.m3u8"))body="#EXTM3U\nbad-range.ts\n";
   else if(raw.startsWith("GET /ignored-master.m3u8"))body="#EXTM3U\nignored-range.ts\n";
   else if(raw.startsWith("GET /ignored-range.ts"))body="abcde"; // Deliberately ignore Range.
   else if(raw.startsWith("GET /unsolicited-master.m3u8"))body="#EXTM3U\nunsolicited.ts\n";
   else if(raw.startsWith("GET /nocl-master.m3u8"))body="#EXTM3U\nnocl.ts\n";
   else if(raw.startsWith("GET /nocl.ts")){c->write("HTTP/1.1 206 Partial Content\r\nContent-Range: bytes 1-3/5\r\nConnection: close\r\n\r\nbcd");c->disconnectFromHost();return;}
   else if(raw.startsWith("GET /short-master.m3u8"))body="#EXTM3U\nshort.ts\n";
   else if(raw.startsWith("GET /short.ts")){body="bcd";head="HTTP/1.1 206 Partial Content\r\nContent-Range: bytes 1-3/10\r\n";}
   else if(raw.startsWith("GET /bad-range.ts")){body="bcd";head="HTTP/1.1 206 Partial Content\r\nContent-Range: bytes 2-4/5\r\n";}
   else if(raw.startsWith("GET /unsolicited.ts")){body="bcd";head="HTTP/1.1 206 Partial Content\r\nContent-Range: bytes 1-3/5\r\n";}
   else if(raw.startsWith("GET /alt.m3u8"))body="#EXTM3U\nno-extension\n";
   else if(raw.startsWith("GET /alt2.m3u8"))body="#EXTM3U\nmasquerade.ts\n";
   else if(raw.startsWith("GET /alt3.m3u8"))body="#EXTM3U\nvalid-no-extension\n";
   else if(raw.startsWith("GET /valid-no-extension")){body="#EXTM3U\n#EXTINF:1,\nsegment.ts\n";head+="Content-Type: application/vnd.apple.mpegurl\r\n";}
   else if(raw.startsWith("GET /no-extension")){body="#EXTM3U\nhttps://other.invalid/leak.ts\n";head+="Content-Type: application/vnd.apple.mpegurl\r\n";}
   else if(raw.startsWith("GET /masquerade.ts"))body="#EXTM3U\nhttps://other.invalid/leak.ts\n";
   else if(raw.startsWith("GET /child.m3u8"))body="#EXTM3U\n#EXTINF:1,\nsegment.ts\n";
   else if(raw.startsWith("GET /segment.ts")){body=range?"bcd":"abcde";if(range)head="HTTP/1.1 206 Partial Content\r\nContent-Range: bytes 1-3/5\r\n";}
   else if(raw.startsWith("GET /foreign.m3u8"))body="#EXTM3U\nhttps://other.invalid/secret.ts\n";
   else if(raw.startsWith("GET /redirect.m3u8")){c->write("HTTP/1.1 302 Found\r\nLocation: https://other.invalid/x\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");c->disconnectFromHost();return;}
   else {c->write("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");c->disconnectFromHost();return;}
   c->write(head+"Content-Length: "+QByteArray::number(body.size())+"\r\nConnection: close\r\n\r\n"+body);c->disconnectFromHost();
  });}});CHECK(s.listen(QHostAddress::LocalHost,0));}
 QUrl url(const char* path)const{return QUrl(QString("http://127.0.0.1:%1%2").arg(s.serverPort()).arg(QString::fromLatin1(path)));}
};
struct Response {int status;QByteArray body;};
Response get(QNetworkAccessManager& net,const QUrl& url,const QByteArray& range={}){
 QNetworkRequest req(url);if(!range.isEmpty())req.setRawHeader("Range",range);auto* reply=net.get(req);QEventLoop e;QTimer timer;timer.setSingleShot(true);QObject::connect(&timer,&QTimer::timeout,&e,&QEventLoop::quit);QObject::connect(reply,&QNetworkReply::finished,&e,&QEventLoop::quit);timer.start(5000);e.exec();CHECK(timer.isActive());Response out{reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt(),reply->readAll()};reply->deleteLater();return out;
}
int main(int argc,char**argv){QCoreApplication app(argc,argv);TestServer upstream;QNetworkAccessManager client;HlsSessionRelay relay;const QUrl server=upstream.url("/");const QByteArray auth="MediaBrowser Token=\"synthetic\"";
 QUrl master=relay.start(upstream.url("/master.m3u8?ApiKey=synthetic"),server,auth,true);CHECK(master.isValid()&&!master.hasQuery()&&!master.toString().contains("synthetic"));
 auto rangedMaster=get(client,master,"bytes=0-");CHECK(rangedMaster.status==200&&!rangedMaster.body.contains("synthetic"));CHECK(get(client,master,"bytes=1-").status==400);
 auto a=get(client,master);CHECK(a.status==200&&!a.body.contains("synthetic"));auto repeated=get(client,master);CHECK(repeated.status==200&&repeated.body==a.body);const auto lines=a.body.split('\n');CHECK(lines.size()>=2);QUrl child(QString::fromUtf8(lines[1]));CHECK(child.host()=="127.0.0.1");auto b=get(client,child);CHECK(b.status==200);auto parts=b.body.split('\n');CHECK(parts.size()>=3);QUrl segment(QString::fromUtf8(parts[2]));auto c=get(client,segment,"bytes=1-3");CHECK(c.status==206&&c.body=="bcd"&&upstream.sawRange&&upstream.authOk);
 relay.stop();QUrl ignoredMaster=relay.start(upstream.url("/ignored-master.m3u8"),server,auth,true);auto ignoredManifest=get(client,ignoredMaster);CHECK(ignoredManifest.status==200);QUrl ignored(QString::fromUtf8(ignoredManifest.body.split('\n')[1]));auto ignoredRange=get(client,ignored,"bytes=1-3");CHECK(ignoredRange.status==502&&!ignoredRange.body.contains("abcde"));CHECK(get(client,ignored,"bytes=0-2").status==502);auto whole=get(client,ignored);CHECK(whole.status==200&&whole.body=="abcde");auto allRange=get(client,ignored,"bytes=0-");CHECK(allRange.status==200&&allRange.body=="abcde");
 relay.stop();QUrl slow=relay.start(upstream.url("/slow.m3u8"),server,auth,true);auto* hanging=client.get(QNetworkRequest(slow));QEventLoop wait;QTimer::singleShot(300,&wait,&QEventLoop::quit);wait.exec();CHECK(relay.inFlightCount()>0);relay.stop();QCoreApplication::sendPostedEvents(nullptr,QEvent::DeferredDelete);QCoreApplication::processEvents();CHECK(relay.inFlightCount()==0);hanging->deleteLater();QUrl rangeMaster=relay.start(upstream.url("/range-master.m3u8"),server,auth,true);auto rangeManifest=get(client,rangeMaster);QUrl badRange(QString::fromUtf8(rangeManifest.body.split('\n')[1]));CHECK(get(client,badRange,"bytes=1-3").status==502);relay.stop();QUrl noClMaster=relay.start(upstream.url("/nocl-master.m3u8"),server,auth,true);auto noClManifest=get(client,noClMaster);QUrl noCl(QString::fromUtf8(noClManifest.body.split('\n')[1]));CHECK(get(client,noCl,"bytes=1-3").status==502);relay.stop();QUrl shortMaster=relay.start(upstream.url("/short-master.m3u8"),server,auth,true);auto shortManifest=get(client,shortMaster);QUrl shortUrl(QString::fromUtf8(shortManifest.body.split('\n')[1]));CHECK(get(client,shortUrl,"bytes=1-9").status==502);CHECK(get(client,shortUrl,"bytes=1-").status==502);relay.stop();QUrl unsolicitedMaster=relay.start(upstream.url("/unsolicited-master.m3u8"),server,auth,true);auto unsolicitedManifest=get(client,unsolicitedMaster);QUrl unsolicited(QString::fromUtf8(unsolicitedManifest.body.split('\n')[1]));CHECK(get(client,unsolicited).status==502);relay.stop();QUrl alt=relay.start(upstream.url("/alt.m3u8"),server,auth,true);auto altMaster=get(client,alt);CHECK(altMaster.status==200);QUrl childNoExt(QString::fromUtf8(altMaster.body.split('\n')[1]));CHECK(get(client,childNoExt).status==502);relay.stop();QUrl alt2=relay.start(upstream.url("/alt2.m3u8"),server,auth,true);auto alt2Master=get(client,alt2);CHECK(alt2Master.status==200);QUrl masquerade(QString::fromUtf8(alt2Master.body.split('\n')[1]));CHECK(get(client,masquerade).status==502);relay.stop();QUrl alt3=relay.start(upstream.url("/alt3.m3u8"),server,auth,true);auto alt3Master=get(client,alt3);CHECK(alt3Master.status==200);QUrl validNoExt(QString::fromUtf8(alt3Master.body.split('\n')[1]));auto noExtRanged=get(client,validNoExt,"bytes=0-");CHECK(noExtRanged.status==200&&noExtRanged.body.contains("127.0.0.1"));CHECK(!upstream.cookieSeen);relay.stop();QUrl foreign=relay.start(upstream.url("/foreign.m3u8"),server,auth,true);CHECK(get(client,foreign).status==502);relay.stop();QUrl redirect=relay.start(upstream.url("/redirect.m3u8"),server,auth,true);CHECK(get(client,redirect).status==502);relay.stop();CHECK(!relay.start(upstream.url("/master.m3u8"),QUrl("http://else.invalid"),auth).isValid());CHECK(!relay.start(upstream.url("/master.m3u8"),server,auth).isValid());CHECK(!relay.start(QUrl("http://8.8.8.8/master.m3u8"),QUrl("http://8.8.8.8"),auth,true).isValid());CHECK(!relay.start(upstream.url("/master.m3u8"),server,"bad\r\nInjected: x",true).isValid());
 std::cout<<"PASS: authenticated same-origin playlist/segment relay, range, foreign URI and redirect refusal\n";
}

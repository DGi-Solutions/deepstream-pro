#include "NativeHlsSession.h"
#include <QCoreApplication>
#include <QTcpServer>
#include <QTcpSocket>
#include <QEventLoop>
#include <QTimer>
#include <iostream>
#include <cstdlib>
#define CHECK(x) do{if(!(x)){std::cerr<<"FAIL line "<<__LINE__<<"\n";std::exit(1);}}while(false)
struct Server:QObject{QTcpServer server;bool authOk=true;int requests=0;Server(){connect(&server,&QTcpServer::newConnection,this,[this]{while(auto* c=server.nextPendingConnection()){c->setParent(this);connect(c,&QTcpSocket::disconnected,c,&QObject::deleteLater);connect(c,&QTcpSocket::readyRead,this,[this,c]{auto bytes=c->readAll();if(!bytes.contains("\r\n\r\n"))return;++requests;authOk=authOk&&bytes.contains("Authorization: MediaBrowser Token=\"synthetic\"\r\n");QByteArray body="{\"Id\":\"user-synthetic\"}";c->write("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: "+QByteArray::number(body.size())+"\r\nConnection: close\r\n\r\n"+body);c->disconnectFromHost();});}});CHECK(server.listen(QHostAddress::LocalHost,0));}QUrl origin()const{return QUrl(QString("http://127.0.0.1:%1").arg(server.serverPort()));}};
int main(int argc,char**argv){QCoreApplication app(argc,argv);Server s;NativeHlsSession::Context ctx{s.origin(),"server-synthetic",s.origin().resolved(QUrl("/web/index.html")),true};NativeHlsSession session([&]{return ctx;});QString completed;bool success=false;QObject::connect(&session,&NativeHlsSession::bindingResult,[&](const QString&id,bool ok){completed=id;success=ok;});
 auto request=[&]{return QVariantMap{{"serverBaseUrl",s.origin().toString()},{"serverId","server-synthetic"},{"userId","user-synthetic"},{"authorization","MediaBrowser Token=\"synthetic\""}};};
 auto result=[&](const QString&id){QEventLoop loop;QTimer timeout;timeout.setSingleShot(true);QObject::connect(&timeout,&QTimer::timeout,&loop,&QEventLoop::quit);QObject::connect(&session,&NativeHlsSession::bindingResult,&loop,&QEventLoop::quit);timeout.start(5000);loop.exec();CHECK(timeout.isActive()&&completed==id);};
 QString id=session.bind(request());CHECK(!id.isEmpty()&&!session.permits(id,s.origin().resolved(QUrl("/master.m3u8"))));result(id);CHECK(success&&s.authOk&&session.permits(id,s.origin().resolved(QUrl("/master.m3u8?ApiKey=synthetic"))));CHECK(!session.permits(id,QUrl("https://evil.invalid/master.m3u8")));CHECK(!session.permits("stale",s.origin().resolved(QUrl("/master.m3u8"))));ctx.mainFrameReady=false;CHECK(!session.permits(id,s.origin().resolved(QUrl("/master.m3u8"))));ctx.mainFrameReady=true;session.clear();CHECK(!session.permits(id,s.origin().resolved(QUrl("/master.m3u8"))));
 auto bad=request();bad["userId"]="different-user";completed.clear();id=session.bind(bad);CHECK(!id.isEmpty());result(id);CHECK(!success&&!session.permits(id,s.origin().resolved(QUrl("/master.m3u8"))));
 int count=s.requests;bad=request();bad["serverId"]="wrong-server";CHECK(session.bind(bad).isEmpty()&&s.requests==count);ctx.webUrl=QUrl("https://evil.invalid/web/index.html");CHECK(session.bind(request()).isEmpty()&&s.requests==count);ctx.webUrl=s.origin().resolved(QUrl("/other/index.html"));CHECK(session.bind(request()).isEmpty()&&s.requests==count);ctx.webUrl=s.origin().resolved(QUrl("/web/index.html"));ctx.mainFrameReady=false;CHECK(session.bind(request()).isEmpty()&&s.requests==count);ctx.mainFrameReady=true;
 completed.clear();id=session.bind(request());CHECK(!id.isEmpty());ctx.mainFrameReady=false;result(id);CHECK(!success&&!session.permits(id,s.origin().resolved(QUrl("/master.m3u8"))));
 std::cout<<"PASS: authenticated session, main frame, origin, user, clear and stale binding\n";
}

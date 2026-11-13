#include "HlsOriginPolicy.h"
#include "HlsAuthorizationPolicy.h"
#include <QCoreApplication>
#include <cstdlib>
#include <iostream>
#include <vector>
using namespace HlsOriginPolicy;
#define CHECK(x) do{if(!(x)){std::cerr<<"FAIL line "<<__LINE__<<"\n";std::exit(1);}}while(false)
int main(int argc,char** argv){QCoreApplication app(argc,argv);
 const QUrl origin("https://media.invalid:443");const QUrl source("https://media.invalid/a/master.m3u8?ApiKey=fake-token");const QUrl loop("http://127.0.0.1:45123");std::vector<QUrl> resolved;
 const Mapper map=[&](const QUrl& value){resolved.push_back(value);return QUrl(QString("http://127.0.0.1:45123/capability/%1").arg(resolved.size()));};
 CHECK(sameOrigin(source,origin));CHECK(!sameOrigin(QUrl("http://media.invalid/a"),origin));CHECK(!sameOrigin(QUrl("https://media.invalid:444/a"),origin));CHECK(!sameOrigin(QUrl("https://evil.invalid/a"),origin));CHECK(!sameOrigin(QUrl("https://a@media.invalid/a"),origin));
 auto result=rewrite("#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,URI=\"audio.m3u8?x=1\"\n#EXT-X-STREAM-INF:BANDWIDTH=1\nvideo.m3u8?ApiKey=fake-token\n#EXT-X-KEY:METHOD=AES-128,URI=\"../key?id=1\"\n#EXTINF:5,\nsegment.ts\n",source,origin,loop,map);
 CHECK(result.error==Error::None && resolved.size()==4);CHECK(!result.playlist.contains("fake-token"));CHECK(result.playlist.contains("127.0.0.1:45123/capability/"));CHECK(resolved[0].toEncoded().contains("audio.m3u8?x=1"));CHECK(!resolved[0].hasQuery() || !resolved[0].toEncoded().contains("fake-token"));CHECK(resolved[1].toEncoded().contains("ApiKey=fake-token"));
 CHECK(rewrite("#EXTM3U\nhttps://evil.invalid/a.ts\n",source,origin,loop,map).error==Error::ForeignOrigin);
 CHECK(rewrite("#EXTM3U\n//evil.invalid/a.ts\n",source,origin,loop,map).error==Error::ForeignOrigin);
 CHECK(rewrite("#EXTM3U\nhttp://media.invalid/a.ts\n",source,origin,loop,map).error==Error::ForeignOrigin);
 CHECK(rewrite("#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=\"skd://key\"\n",source,origin,loop,map).error==Error::ForeignOrigin);
 CHECK(rewrite("#EXTM3U\n#EXT-X-DEFINE:NAME=\"foo\",VALUE=\"x\"\n",source,origin,loop,map).error==Error::UnsupportedReference);
 CHECK(rewrite("#EXTM3U\n#EXT-X-CONTENT-STEERING:SERVER-URI=\"https://evil.invalid/\"\n",source,origin,loop,map).error==Error::UnsupportedReference);
 CHECK(rewrite("#EXTM3U\n#EXT-X-MEDIA:URI=unquoted\n",source,origin,loop,map).error==Error::InvalidPlaylist);
 CHECK(rewrite("#EXTM3U\nseg.ts\n",source,origin,loop,[](const QUrl&){return QUrl("https://evil.invalid/x");}).error==Error::InvalidLocalMapping);
 const QUrl scoped("https://media.invalid/jellyfin");
 CHECK(sameScope(QUrl("https://media.invalid/jellyfin/Videos/master.m3u8?ApiKey=synthetic"),scoped));
 CHECK(!sameScope(QUrl("https://media.invalid/other/secret.ts"),scoped));
 CHECK(!sameScope(QUrl("https://media.invalid/jellyfin/..%2Fother/secret.ts"),scoped));
 CHECK(!sameScope(QUrl("https://media.invalid/jellyfin/%252e%252e/secret.ts"),scoped));
 const QUrl scopedSource("https://media.invalid/jellyfin/video/master.m3u8");
 CHECK(rewrite("#EXTM3U\n../../other/secret.ts\n",scopedSource,scoped,loop,map).error==Error::ForeignOrigin);
 const QByteArray auth="MediaBrowser Client=\"synthetic\", Token=\"synthetic\"";
 CHECK(HlsAuthorizationPolicy::mode(QUrl("https://media.invalid/a?ApiKey=synthetic"),auth)==HlsAuthorizationPolicy::Mode::Query);
 CHECK(HlsAuthorizationPolicy::mode(QUrl("https://media.invalid/a?api_key=other"),auth)==HlsAuthorizationPolicy::Mode::Invalid);
 CHECK(HlsAuthorizationPolicy::mode(QUrl("https://media.invalid/a?ApiKey=synthetic&api_key=synthetic"),auth)==HlsAuthorizationPolicy::Mode::Invalid);
 CHECK(HlsAuthorizationPolicy::mode(QUrl("https://media.invalid/a"),auth)==HlsAuthorizationPolicy::Mode::Header);
 CHECK(HlsAuthorizationPolicy::token("MediaBrowser Token=\"one\", Token=\"two\"").isEmpty());
 const QUrl httpOrigin("http://local.invalid:8096");CHECK(sameOrigin(QUrl("http://local.invalid:8096/master.m3u8?ApiKey=x"),httpOrigin));CHECK(!sameOrigin(QUrl("http://local.invalid:8097/a"),httpOrigin));
 std::cout<<"PASS: origin, authorized query, child references and fail-closed playlist rewrite\n";
}

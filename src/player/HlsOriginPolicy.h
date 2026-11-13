#pragma once
#include <QByteArray>
#include <QString>
#include <QStringList>
#include <QUrl>
#include <QHostAddress>
#include <functional>

// Transport-neutral rules used by the session-bound HLS relay. No network IO,
// logging, token invention, or public capability is performed here.
namespace HlsOriginPolicy {
enum class Error { None, InvalidOrigin, InvalidPlaylist, UnsupportedReference, ForeignOrigin, InvalidLocalMapping };
struct Result { Error error=Error::None; QByteArray playlist; };
using Mapper=std::function<QUrl(const QUrl&)>;
inline int port(const QUrl& url) { return url.port(url.scheme().compare(QStringLiteral("https"),Qt::CaseInsensitive)==0 ? 443 : 80); }
inline bool validHttpUrl(const QUrl& u) {
 const auto scheme=u.scheme().toLower();
 return u.isValid() && (scheme==QStringLiteral("https") || scheme==QStringLiteral("http")) &&
        !u.host().isEmpty() && u.userInfo().isEmpty() && !u.hasFragment() && u.port(-1)!=0;
}
inline bool localLiteral(const QString& host){
 QHostAddress ip;if(!ip.setAddress(host))return false;
 if(ip.isLoopback()||ip.isLinkLocal())return true;
 bool ok=false;const quint32 v=ip.toIPv4Address(&ok);
 if(ok)return (v>>24)==10 || ((v>>24)==172 && ((v>>16)&255)>=16 && ((v>>16)&255)<=31) || (v>>16)==0xc0a8;
 const auto v6=ip.toIPv6Address();return (v6[0]&0xfe)==0xfc;
}
inline bool sameOrigin(const QUrl& candidate,const QUrl& authorizedOrigin) {
 if(!validHttpUrl(candidate)||!validHttpUrl(authorizedOrigin))return false;
 return candidate.scheme().compare(authorizedOrigin.scheme(),Qt::CaseInsensitive)==0 &&
        candidate.host().compare(authorizedOrigin.host(),Qt::CaseInsensitive)==0 && port(candidate)==port(authorizedOrigin);
}
inline bool safeScopedPath(const QUrl& url) {
 const auto path=url.path(QUrl::FullyEncoded).toLower();
 return !path.contains(QStringLiteral("%2f"))&&!path.contains(QStringLiteral("%5c"))&&
        !path.contains(QStringLiteral("%2e"))&&!path.contains(QStringLiteral("%25"))&&!path.contains('\\');
}
inline bool sameScope(const QUrl& candidate,const QUrl& base){
 if(!sameOrigin(candidate,base)||!safeScopedPath(candidate)||!safeScopedPath(base))return false;
 QString prefix=base.adjusted(QUrl::NormalizePathSegments).path(QUrl::FullyEncoded);
 QString path=candidate.adjusted(QUrl::NormalizePathSegments).path(QUrl::FullyEncoded);
 while(prefix.endsWith('/')&&prefix.size()>1)prefix.chop(1);
 return prefix.isEmpty()||prefix==QStringLiteral("/")||path.startsWith(prefix+QStringLiteral("/"));
}
inline Result rewrite(const QByteArray& data,const QUrl& currentPlaylist,const QUrl& authorizedOrigin,
                      const QUrl& loopbackOrigin,const Mapper& map) {
 if(!validHttpUrl(authorizedOrigin)||authorizedOrigin.hasQuery()||!sameScope(currentPlaylist,authorizedOrigin) ||
    !validHttpUrl(loopbackOrigin)||loopbackOrigin.hasQuery()||loopbackOrigin.scheme()!=QStringLiteral("http") ||
    loopbackOrigin.host()!=QStringLiteral("127.0.0.1")||!map)
  return {Error::InvalidOrigin,{}};
 if(data.isEmpty()||data.size()>1024*1024||data.contains('\0'))return {Error::InvalidPlaylist,{}};
 QString input=QString::fromUtf8(data);if(input.toUtf8()!=data)return {Error::InvalidPlaylist,{}};
 if(input.startsWith(QChar(0xfeff)))input.remove(0,1);
 QStringList lines=input.split('\n');
 if(lines.isEmpty()||lines.first().trimmed()!=QStringLiteral("#EXTM3U"))return {Error::InvalidPlaylist,{}};
 auto resolve=[&](const QString& value,QString& mapped)->Error {
  if(value.isEmpty()||value.contains(QStringLiteral("{$"))||value.contains('\\')||value.contains('\r')||value.contains('\n'))return Error::UnsupportedReference;
  const auto ref=QUrl::fromEncoded(value.toUtf8(),QUrl::StrictMode);
  if(!ref.isValid())return Error::UnsupportedReference;
  const QUrl absolute=currentPlaylist.resolved(ref);
  if(!sameScope(absolute,authorizedOrigin))return Error::ForeignOrigin;
  const QUrl local=map(absolute);
  if(!sameOrigin(local,loopbackOrigin)||local.hasQuery()||local.hasFragment()||local.path().isEmpty())return Error::InvalidLocalMapping;
  mapped=QString::fromLatin1(local.toEncoded(QUrl::FullyEncoded));
  return Error::None;
 };
 for(QString& line:lines) {
  if(line.endsWith('\r'))line.chop(1);
  const QString trimmed=line.trimmed();if(trimmed.isEmpty())continue;
  if(!trimmed.startsWith('#')) {
   QString mapped;const auto err=resolve(trimmed,mapped);if(err!=Error::None)return {err,{}};line=mapped;continue;
  }
  if(!trimmed.startsWith(QStringLiteral("#EXT-X-")))continue;
  const auto colon=line.indexOf(':');if(colon<0)continue;
  const QString tag=line.left(colon).trimmed();
  // Variable substitution and content steering introduce additional URL paths.
  if(tag==QStringLiteral("#EXT-X-DEFINE")||tag==QStringLiteral("#EXT-X-CONTENT-STEERING"))return {Error::UnsupportedReference,{}};
  QString attributes=line.mid(colon+1);QStringList fields;QString field;bool quoted=false;
  for(const QChar c:attributes){if(c=='"')quoted=!quoted;if(c==','&&!quoted){fields.append(field);field.clear();}else field+=c;}
  if(quoted)return {Error::InvalidPlaylist,{}};fields.append(field);
  bool changed=false;
  for(QString& item:fields){const auto eq=item.indexOf('=');if(eq<0)continue;const QString key=item.left(eq).trimmed();
   if(key.endsWith(QStringLiteral("-URI"),Qt::CaseInsensitive)||key.compare(QStringLiteral("X-ASSET-LIST"),Qt::CaseInsensitive)==0)return {Error::UnsupportedReference,{}};
   if(key.compare(QStringLiteral("URI"),Qt::CaseInsensitive)!=0)continue;
   const QString value=item.mid(eq+1).trimmed();if(value.size()<2||!value.startsWith('"')||!value.endsWith('"'))return {Error::InvalidPlaylist,{}};
   QString mapped;const auto err=resolve(value.mid(1,value.size()-2),mapped);if(err!=Error::None)return {err,{}};
   item=item.left(eq+1)+'"'+mapped+'"';changed=true;
  }
  if(changed)line=line.left(colon+1)+fields.join(',');
 }
 return {Error::None,lines.join('\n').toUtf8()};
}
}

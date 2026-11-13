#pragma once
#include <QByteArray>
#include <QRegularExpression>
#include <QString>
#include <QUrl>
#include <QUrlQuery>

namespace HlsAuthorizationPolicy {
enum class Mode { Invalid, Header, Query };
inline QString token(const QByteArray& header){
 const QString value=QString::fromUtf8(header);if(value.toUtf8()!=header||header.contains('\r')||header.contains('\n')||header.contains('\0'))return {};
 const auto prefix=QRegularExpression(QStringLiteral("^MediaBrowser\\s+"),QRegularExpression::CaseInsensitiveOption).match(value);
 if(!prefix.hasMatch())return {};
 const QString fields=value.mid(prefix.capturedEnd());
 const QRegularExpression expression(QStringLiteral("(?:^|,)\\s*Token\\s*=\\s*\"([^\"\\r\\n]+)\"\\s*(?=,|$)"),QRegularExpression::CaseInsensitiveOption);
 auto it=expression.globalMatch(fields);QString found;int count=0;
 while(it.hasNext()){found=it.next().captured(1);++count;}
 return count==1?found:QString();
}
inline Mode mode(const QUrl& url,const QByteArray& header){
 const QString expected=token(header);if(expected.isEmpty())return Mode::Invalid;
 const auto items=QUrlQuery(url).queryItems(QUrl::FullyDecoded);int count=0;QString value;
 for(const auto& item:items){const auto key=item.first.toLower();
  if(key==QStringLiteral("apikey")||key==QStringLiteral("api_key")){++count;value=item.second;}
  else if(key==QStringLiteral("access_token")||key==QStringLiteral("token")||key==QStringLiteral("x-emby-token"))return Mode::Invalid;
 }
 if(count==0)return Mode::Header;
 return count==1&&value==expected?Mode::Query:Mode::Invalid;
}
}

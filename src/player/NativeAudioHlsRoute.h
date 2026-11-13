#pragma once
#include <QString>
#include <QVariantMap>
#include <QRegularExpression>
namespace NativeAudioHlsRoute {
inline bool allowed(const QVariantMap& audio,const QString& other,bool requireSpatial=true) {
 if((requireSpatial && !audio.value(QStringLiteral("spatialAudio")).toBool()) ||
    audio.value(QStringLiteral("devicetype")).toString()!=QStringLiteral("basic") ||
    audio.value(QStringLiteral("device")).toString()!=QStringLiteral("auto") ||
    audio.value(QStringLiteral("channels")).toString()!=QStringLiteral("auto") ||
    audio.value(QStringLiteral("exclusive")).toBool()) return false;
 const auto lines=other.split(QRegularExpression(QStringLiteral("[\\r\\n]")),Qt::SkipEmptyParts);
 for(QString line:lines) {
   line=line.trimmed();if(line.isEmpty() || line.startsWith(QLatin1Char('#')))continue;
   const qsizetype i=line.indexOf(QLatin1Char('='));if(i<=0)continue;
   QString key=line.left(i).trimmed();
   if(key.size()>=2 && key.startsWith(QLatin1Char('"')) && key.endsWith(QLatin1Char('"')))key=key.mid(1,key.size()-2);
   key=key.trimmed().toLower();
   if(key==QStringLiteral("ao") || key==QStringLiteral("audio-device") || key==QStringLiteral("audio-channels") ||
      key==QStringLiteral("audio-exclusive") || key==QStringLiteral("audio-spdif"))return false;
 }
 return true;
}
}

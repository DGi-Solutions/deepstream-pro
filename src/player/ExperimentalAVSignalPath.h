#pragma once
#include <QVariantMap>

// SingleJocSelected records source evidence, never object-rendering proof.
// Only set it after the verified single-JOC manifest is bound to the selected AV option.
enum class ExperimentalAVSourceEvidence { Unknown, SingleJocSelected };
inline QVariantMap experimentalAVSignalPath(ExperimentalAVSourceEvidence evidence)
{
  const QString status = evidence == ExperimentalAVSourceEvidence::SingleJocSelected
      ? QStringLiteral("manifest-single-joc-selected") : QStringLiteral("unknown");
  return {{QStringLiteral("backend"), QStringLiteral("avplayer")},
          {QStringLiteral("engine"), QStringLiteral("AVPlayer")},
          {QStringLiteral("outputDriver"), QStringLiteral("AVFoundation")},
          {QStringLiteral("objectRenderingConfirmed"), false},
          {QStringLiteral("sourceEvidence"), QVariantMap{{QStringLiteral("status"), status}}},
          {QStringLiteral("decoded"), QVariantMap{}},
          {QStringLiteral("output"), QVariantMap{}}};
}

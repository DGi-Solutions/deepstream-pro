#ifndef DEEPSTREAM_AUDIO_FILTER_GUARD_H
#define DEEPSTREAM_AUDIO_FILTER_GUARD_H

#include <QMetaType>
#include <QVariant>

enum class AudioFilterPresence { Unknown, Absent, Present };

// mpv returns `af` as a node array of node maps. An unreadable or malformed
// value must never be treated as proof that the owned filter is absent.
inline AudioFilterPresence deepstreamAudioFilterPresence(const QVariant& value)
{
  if (value.metaType().id() != QMetaType::QVariantList)
    return AudioFilterPresence::Unknown;
  bool present = false;
  for (const QVariant& entry : value.toList()) {
    if (entry.metaType().id() != QMetaType::QVariantMap)
      return AudioFilterPresence::Unknown;
    const QVariant label = entry.toMap().value(QStringLiteral("label"));
    if (label.isValid() && label.metaType().id() != QMetaType::QString)
      return AudioFilterPresence::Unknown;
    const QString name = label.toString();
    if (name == QStringLiteral("deepstream-enhancement") ||
        name == QStringLiteral("@deepstream-enhancement"))
      present = true;
  }
  return present ? AudioFilterPresence::Present : AudioFilterPresence::Absent;
}

template <typename Read, typename Remove>
bool deepstreamEnsureAudioFilterAbsent(Read read, Remove remove)
{
  const AudioFilterPresence before = deepstreamAudioFilterPresence(read());
  if (before == AudioFilterPresence::Unknown)
    return false;
  if (before == AudioFilterPresence::Absent)
    return true;
  if (remove() < 0)
    return false;
  return deepstreamAudioFilterPresence(read()) == AudioFilterPresence::Absent;
}

#endif

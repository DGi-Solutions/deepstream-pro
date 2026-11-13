// Private PlayerComponent implementation, included by PlayerComponent.cpp.
#include "AudioFilterGuard.h"
// All settings are validated again here; JavaScript never supplies a filter graph.
QVariantMap PlayerComponent::sanitizeAudioEnhancement(const QVariantMap& settings, QString* error) const
{
  QVariantMap result;
  result.insert("enabled", false);
  result.insert("profile", "speakers");
  result.insert("bass", 0.0);
  result.insert("treble", 0.0);
  result.insert("clarity", 0.0);
  result.insert("night", 0.0);
  result.insert("boost", 0.0);
  result.insert("objectSource", false);
  if (error)
    error->clear();

  bool valid = true;
  auto readBool = [&settings, &result, &valid](const QString& key) {
    const auto it = settings.constFind(key);
    if (it == settings.constEnd())
      return;
    if (it.value().metaType().id() != QMetaType::Bool)
    {
      valid = false;
      return;
    }
    result.insert(key, it.value().toBool());
  };
  readBool("enabled");
  readBool("objectSource");

  const auto profile = settings.constFind("profile");
  if (profile != settings.constEnd())
  {
    if (profile.value().metaType().id() != QMetaType::QString ||
        (profile.value().toString() != "speakers" && profile.value().toString() != "headphones"))
      valid = false;
    else
      result.insert("profile", profile.value().toString());
  }

  auto readNumber = [&settings, &result, &valid](const QString& key, double minimum, double maximum) {
    const auto it = settings.constFind(key);
    if (it == settings.constEnd())
      return;
    const int type = it.value().metaType().id();
    const bool numeric = type == QMetaType::Double || type == QMetaType::Float ||
                         type == QMetaType::Int || type == QMetaType::UInt ||
                         type == QMetaType::LongLong || type == QMetaType::ULongLong;
    bool ok = false;
    const double value = numeric ? it.value().toDouble(&ok) : 0.0;
    if (!numeric || !ok || !std::isfinite(value) || value < minimum || value > maximum)
    {
      valid = false;
      return;
    }
    result.insert(key, value);
  };
  readNumber("bass", -4.0, 4.0);
  readNumber("treble", -4.0, 4.0);
  readNumber("clarity", 0.0, 100.0);
  readNumber("night", 0.0, 100.0);
  readNumber("boost", 0.0, 3.0);

  if (!valid)
  {
    // Fail closed as a whole rather than retaining a partially valid effect.
    result.insert("enabled", false);
    result.insert("objectSource", false);
    result.insert("profile", "speakers");
    result.insert("bass", 0.0);
    result.insert("treble", 0.0);
    result.insert("clarity", 0.0);
    result.insert("night", 0.0);
    result.insert("boost", 0.0);
    if (error)
      *error = QStringLiteral("invalid_settings");
  }
  return result;
}

bool PlayerComponent::hasAudioEnhancementFilter() const
{
  return m_mpv && deepstreamAudioFilterPresence(m_mpv->getProperty("af")) == AudioFilterPresence::Present;
}

bool PlayerComponent::removeAudioEnhancementFilter()
{
  if (!m_mpv)
  {
    m_audioEnhancementActive = false;
    return true;
  }
  // Never clear or replace the complete chain: only the owned label is removed.
  // A failed read or verification cannot release the session boundary.
  const bool absent = deepstreamEnsureAudioFilterAbsent(
      [this] { return m_mpv->getProperty("af"); },
      [this] { return mpv_command_string(m_mpv->mpv(), "af remove @deepstream-enhancement"); });
  if (absent)
    m_audioEnhancementActive = false;
  return absent;
}

QVariantMap PlayerComponent::setAudioEnhancement(const QVariantMap& settings)
{
  QString error;
  m_audioEnhancement = sanitizeAudioEnhancement(settings, &error);
  m_audioEnhancementReason = error.isEmpty()
      ? (m_audioEnhancement.value("enabled").toBool() ? QStringLiteral("awaiting_audio")
                                                       : QStringLiteral("disabled"))
      : error;
  applyAudioEnhancement();
  return getAudioEnhancementStatus();
}

void PlayerComponent::applyAudioEnhancement()
{
  if (!removeAudioEnhancementFilter())
  {
    m_audioEnhancementReason = QStringLiteral("filter_remove_failed");
    return;
  }
  if (!m_audioEnhancement.value("enabled").toBool())
  {
    if (m_audioEnhancementReason != "invalid_settings")
      m_audioEnhancementReason = QStringLiteral("disabled");
    return;
  }
  if (!m_inPlayback)
  {
    m_audioEnhancementReason = QStringLiteral("awaiting_audio");
    return;
  }
  if (!m_mpv)
  {
    m_audioEnhancementReason = QStringLiteral("unavailable");
    return;
  }
  if (m_audioEnhancement.value("objectSource").toBool())
  {
    m_audioEnhancementReason = QStringLiteral("object_audio_source");
    return;
  }
  // This conservative check also covers the existing @ac3 encoder. Processing
  // after an encoder would be invalid, and bitstream paths must remain untouched.
  if (m_doAc3Transcoding || !m_passthroughCodecs.isEmpty())
  {
    m_audioEnhancementReason = QStringLiteral("passthrough_configured");
    return;
  }

  // Only native playback state can establish whether processing is safe.
  const QString routeBlock = audioEnhancementRouteBlockReason();
  if (!routeBlock.isEmpty())
  {
    m_audioEnhancementReason = routeBlock;
    return;
  }

  const double bass = m_audioEnhancement.value("bass").toDouble();
  const double treble = m_audioEnhancement.value("treble").toDouble();
  const double clarity = m_audioEnhancement.value("clarity").toDouble();
  const double night = m_audioEnhancement.value("night").toDouble();
  const double boost = m_audioEnhancement.value("boost").toDouble();
  const double lowGain = bass;
  const double highGain = treble;
  const double clarityGain = clarity * 0.025; // At most +2.5 dB; no restoration claim.

  if (std::abs(lowGain) < 0.001 && std::abs(highGain) < 0.001 &&
      clarityGain < 0.001 && night < 0.001 && boost < 0.001)
  {
    m_audioEnhancementReason = QStringLiteral("neutral_settings");
    return;
  }

  QStringList filters;
  const auto number = [](double value) { return QString::number(value, 'f', 3); };
  if (std::abs(lowGain) >= 0.001)
    filters.append(QStringLiteral("lowshelf=f=150:g=") + number(lowGain));
  if (std::abs(highGain) >= 0.001)
    filters.append(QStringLiteral("highshelf=f=5500:g=") + number(highGain));
  if (clarityGain >= 0.001)
    filters.append(QStringLiteral("equalizer=f=2800:t=q:w=0.9:g=") + number(clarityGain));

  double makeupDb = 0.0;
  if (night >= 0.001)
  {
    const double amount = night / 100.0;
    const double threshold = 0.25 - 0.17 * amount;
    const double ratio = 1.0 + 3.0 * amount;
    const double makeup = 1.0 + amount;
    makeupDb = 20.0 * std::log10(makeup);
    filters.append(QStringLiteral("acompressor=threshold=") + number(threshold) +
                   QStringLiteral(":ratio=") + number(ratio) +
                   QStringLiteral(":attack=20:release=250:makeup=") + number(makeup));
  }

  // Headroom covers the strongest band and make-up; the limiter catches overlap.
  const double strongestEqGain = std::max({0.0, lowGain, highGain, clarityGain});
  const double trimDb = boost - strongestEqGain - makeupDb - 1.0;
  filters.append(QStringLiteral("volume=") + number(trimDb) + "dB");
  filters.append(QStringLiteral("alimiter=limit=0.891:attack=5:release=50:level=false:latency=true"));

  const QString graph = QStringLiteral("@deepstream-enhancement:lavfi=[") + filters.join(',') + "]";
  const QByteArray command = QStringLiteral("af add ").toUtf8() + graph.toUtf8();
  if (mpv_command_string(m_mpv->mpv(), command.constData()) < 0)
  {
    m_audioEnhancementActive = false;
    m_audioEnhancementReason = QStringLiteral("filter_unavailable");
    return;
  }
  m_audioEnhancementActive = true;
  if (!hasAudioEnhancementFilter())
  {
    if (!removeAudioEnhancementFilter())
      m_audioEnhancementReason = QStringLiteral("filter_remove_failed");
    else
      m_audioEnhancementReason = QStringLiteral("filter_verification_failed");
    return;
  }
  m_audioEnhancementReason = QStringLiteral("active");
}

QVariantMap PlayerComponent::getAudioEnhancementStatus() const
{
  QVariantMap result;
  const bool present = hasAudioEnhancementFilter();
  QString reason = m_audioEnhancementReason;
  if (reason == "active" && !present)
    reason = QStringLiteral("filter_missing");
  const bool enabled = m_audioEnhancement.value("enabled").toBool();
  const QString state = reason == "filter_remove_failed" ? QStringLiteral("error")
      : reason == "active" && present ? QStringLiteral("active")
      : enabled && reason == "awaiting_audio" ? QStringLiteral("pending")
      : QStringLiteral("bypass");
  result.insert("engine", "libmpv");
  result.insert("state", state);
  result.insert("reason", reason);
  result.insert("enabled", enabled);
  result.insert("active", present);
  result.insert("verified", reason == "active" && present && m_audioEnhancementActive);
  result.insert("pcmOnly", true);
  result.insert("objectRenderingConfirmed", false);
  result.insert("profile", m_audioEnhancement.value("profile", "speakers"));
  result.insert("limitDbfs", -1.0);
  return result;
}

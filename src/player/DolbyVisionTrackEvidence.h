#pragma once
#include <QByteArray>
#include <QString>

struct DolbyVisionTrackEvidence {
  bool valid = false;
  bool eligible = false;
  int profile = -1;
  int level = -1;
  int compatibilityId = -1;
  QString mode;
  QString baseLayer;
};

// Source-format evidence only. This does not prove RPU application, HDMI output
// mode, display certification or panel/receiver rendering.
inline DolbyVisionTrackEvidence decodeDolbyVisionTrack(const QByteArray& record)
{
  DolbyVisionTrackEvidence result;
  const auto* p = reinterpret_cast<const unsigned char*>(record.constData());
  if (record.size() < 5 || p[0] != 1)
    return result;

  result.profile = static_cast<int>(p[2] >> 1);
  result.level = static_cast<int>(((p[2] & 1) << 5) | (p[3] >> 3));
  // dv_bl_signal_compatibility_id occupies the upper nibble of byte four.
  result.compatibilityId = static_cast<int>((p[4] >> 4) & 0x0f);
  result.valid = true;

  // The supported single-layer profiles require RPU and base layer present;
  // enhancement-layer records are outside this diagnostic's supported path.
  // The declarations themselves do not prove that a decoder applied the RPU.
  const bool rpuPresent = (p[3] & 0x04) != 0;
  const bool enhancementLayerPresent = (p[3] & 0x02) != 0;
  const bool baseLayerPresent = (p[3] & 0x01) != 0;
  // Only Dolby's publicly documented level IDs are recognized here; this
  // does not establish whether the device can decode a particular level.
  if (!rpuPresent || !baseLayerPresent || enhancementLayerPresent ||
      result.level < 1 || result.level > 13)
    return result;

  if (result.profile == 5 && result.compatibilityId == 0) {
    result.eligible = true;
    result.mode = QStringLiteral("5");
    result.baseLayer = QStringLiteral("none");
  } else if (result.profile == 8 && result.compatibilityId == 1) {
    result.eligible = true;
    result.mode = QStringLiteral("8.1");
    result.baseLayer = QStringLiteral("hdr10");
  } else if (result.profile == 8 && result.compatibilityId == 4) {
    result.eligible = true;
    result.mode = QStringLiteral("8.4");
    result.baseLayer = QStringLiteral("hlg");
  }
  return result;
}

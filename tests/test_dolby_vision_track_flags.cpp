#include "DolbyVisionTrackEvidence.h"
#include <cassert>
#include <initializer_list>

static QByteArray configuration(unsigned char profile, unsigned char flags,
                                unsigned char compatibility, unsigned char level = 6)
{
  const char bytes[] = {1, 0, static_cast<char>((profile << 1) | (level >> 5)),
                        static_cast<char>(((level & 31) << 3) | flags),
                        static_cast<char>(compatibility << 4)};
  return QByteArray(bytes, sizeof(bytes));
}

int main()
{
  for (unsigned char flags = 0; flags < 8; ++flags) {
    for (const auto& track : {configuration(5, flags, 0),
                             configuration(8, flags, 1),
                             configuration(8, flags, 4)}) {
      const auto evidence = decodeDolbyVisionTrack(track);
      assert(evidence.valid);
      assert(evidence.level == 6);
      assert(evidence.eligible == (flags == 5));
    }
  }
  assert(!decodeDolbyVisionTrack(configuration(8, 5, 2)).eligible);
  assert(!decodeDolbyVisionTrack(configuration(7, 5, 0)).eligible);
  for (const auto level : {0, 1, 13, 14, 63}) {
    for (const auto& track : {configuration(5, 5, 0, level),
                             configuration(8, 5, 1, level),
                             configuration(8, 5, 4, level)}) {
      const auto evidence = decodeDolbyVisionTrack(track);
      assert(evidence.valid);
      assert(evidence.level == level);
      assert(evidence.eligible == (level == 1 || level == 13));
    }
  }
  const char shortRecord[] = {1, 0, 0x10, 0x35};
  assert(!decodeDolbyVisionTrack(QByteArray(shortRecord, sizeof(shortRecord))).valid);
  const char otherVersion[] = {2, 0, 0x10, 0x35, 0x10};
  assert(!decodeDolbyVisionTrack(QByteArray(otherVersion, sizeof(otherVersion))).valid);
}

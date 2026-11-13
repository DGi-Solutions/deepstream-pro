#pragma once
#include <string_view>

// The v2 contract describes app-side selection and validation, not the native
// decoder or output route. Actual playback remains independently checked.
namespace NativeHlsAudioCodecPolicy {
inline int maxChannels(std::string_view codec) {
  if (codec == "aac") return 2;
  if (codec == "ac3") return 6;
  if (codec == "eac3" || codec == "flac" || codec == "alac") return 8;
  return 0;
}
inline bool permitted(std::string_view codec, int channels) {
  const int maximum = maxChannels(codec);
  return maximum && channels >= 1 && channels <= maximum;
}
}

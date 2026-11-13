#include "../src/player/NativeHlsAudioCodecPolicy.h"
#include <cassert>
#include <initializer_list>
#include <string_view>
#include <utility>

int main() {
  using NativeHlsAudioCodecPolicy::permitted;
  for (auto item : {std::pair<std::string_view, int>{"aac", 2}, {"ac3", 6},
                    {"eac3", 8}, {"flac", 8}, {"alac", 8}}) {
    assert(permitted(item.first, 1));
    assert(permitted(item.first, item.second));
    assert(!permitted(item.first, 0));
    assert(!permitted(item.first, -1));
    assert(!permitted(item.first, item.second + 1));
  }
  for (auto codec : {"truehd", "dts", "pcm", "", "AAC", "eac3 ", "unknown"})
    assert(!permitted(codec, 2));
}

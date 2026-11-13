#pragma once
#include <algorithm>
#include <vector>
enum class LocalMediaTrackKind { Audio, Subtitle, Invalid };
inline bool localMediaTrackAllowed(bool ready, LocalMediaTrackKind kind, int id, const std::vector<int>& present) {
  if (!ready || kind == LocalMediaTrackKind::Invalid) return false;
  if (kind == LocalMediaTrackKind::Subtitle && id == -1) return true;
  return id > 0 && std::find(present.begin(), present.end(), id) != present.end();
}

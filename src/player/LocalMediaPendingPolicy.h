#pragma once
#include <climits>
#include <string>
#include <vector>

struct LocalPendingEntry {
  bool validId;
  bool newEntry;
  bool sameFile;
};

enum class LocalPendingAction { NothingPending, StopSoleOwned, Refuse };

// A global mpv stop is safe only for a single, positively identified local
// playlist item. Multiple, old, missing, or mismatching items stay untouched.
inline LocalPendingAction localPendingAction(const std::vector<LocalPendingEntry> &entries) {
  if (entries.empty()) return LocalPendingAction::NothingPending;
  if (entries.size() != 1) return LocalPendingAction::Refuse;
  const auto &entry = entries.front();
  return entry.validId && entry.newEntry && entry.sameFile
      ? LocalPendingAction::StopSoleOwned : LocalPendingAction::Refuse;
}

// A foreign append can coexist with the currently playing local item.
// Never use global stop until the queue is proven to contain only our item.
inline bool localMayStopAfterQueue(bool foreignQueueRequested, bool soleOwnedItem) {
  return !foreignQueueRequested || soleOwnedItem;
}

// mpv expands both checks and runs the string-valued set command while holding
// its core lock. A stale index, id or playing flag expands to an invalid empty
// value; it must not change playback. Only numeric values from mpv are accepted.
inline std::string localGuardedNextValue(long long index, long long entryId) {
  if (index < 0 || index >= INT_MAX || entryId < 0) return {};
  const std::string key = "playlist/" + std::to_string(index) + "/";
  return "${?" + key + "id==" + std::to_string(entryId) + ":${?" + key +
         "playing==yes:" + std::to_string(index + 1) + "}}";
}

// A playlist ID and filename identify ownership, not successful decoding.
inline bool localShouldTimeOut(bool active, bool fileLoaded, bool currentGeneration) {
  return active && !fileLoaded && currentGeneration;
}

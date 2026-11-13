#pragma once
#include <cstdint>
#include <unordered_set>
#include <vector>

// Local control owns a playback request until any other player load or stop.
// An entry existing before that request must never become the new session.
class LocalMediaGate {
public:
  std::uint64_t begin(const std::vector<long long>& previous) { ++generation_; active_ = true; previous_.clear(); previous_.insert(previous.begin(), previous.end()); entry_ = -1; return generation_; }
  void invalidate() { ++generation_; active_ = false; entry_ = -1; }
  bool active() const { return active_; }
  bool bound() const { return entry_ >= 0; }
  bool isNewEntry(long long entry) const { return active_ && entry >= 0 && previous_.count(entry) == 0; }
  std::uint64_t generation() const { return generation_; }
  bool bind(std::uint64_t request, long long entry, bool sameFile) {
    if (!active_ || request != generation_ || !sameFile || entry < 0 || previous_.count(entry)) return false;
    if (entry_ < 0) entry_ = entry;
    return entry_ == entry;
  }
  bool matches(std::uint64_t request, long long entry, bool sameFile) const {
    return active_ && request == generation_ && sameFile && entry_ >= 0 && entry == entry_;
  }
private:
  std::uint64_t generation_ = 0;
  bool active_ = false;
  std::unordered_set<long long> previous_;
  long long entry_ = -1;
};

#pragma once

// MPV_EVENT_FILE_LOADED has no playlist ID. Correlate it with the latest
// START_FILE only when the current playing ID still agrees. END_FILE carries
// its own ID and must not clear evidence for a newer start.
class MpvLoadEvidence {
public:
  void start(long long entry) { entry_ = entry >= 0 ? entry : -1; }
  void end(long long entry) { if (entry >= 0 && entry_ == entry) entry_ = -1; }
  long long loaded(long long current) const { return entry_ >= 0 && current == entry_ ? entry_ : -1; }
private:
  long long entry_ = -1;
};

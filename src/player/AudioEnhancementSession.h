#ifndef DEEPSTREAM_AUDIO_ENHANCEMENT_SESSION_H
#define DEEPSTREAM_AUDIO_ENHANCEMENT_SESSION_H

#include <cstdint>
#include <string>
#include <utility>

// Pure playback identity state. A queued replacement can coexist with the old
// file's delayed END event without inheriting its settings or losing its token.
class AudioEnhancementSession
{
public:
  void stop() { m_active.clear(); m_pending.clear(); m_activeEntry = m_pendingEntry = -1; m_loaded = false; }
  void prepare(std::string token) { stop(); m_pending = std::move(token); }
  void queued(std::int64_t entry) { m_pendingEntry = m_pending.empty() || entry < 0 ? -1 : entry; }
  bool start(std::int64_t entry)
  {
    m_active.clear(); m_activeEntry = entry; m_loaded = false;
    if (entry < 0 || entry != m_pendingEntry || m_pending.empty())
      return false;
    m_active = std::move(m_pending); m_pending.clear(); m_pendingEntry = -1;
    return true;
  }
  bool end(std::int64_t entry)
  {
    const bool endedActive = entry >= 0 && entry == m_activeEntry;
    if (endedActive) { m_active.clear(); m_activeEntry = -1; m_loaded = false; }
    if (entry >= 0 && entry == m_pendingEntry) { m_pending.clear(); m_pendingEntry = -1; }
    return endedActive;
  }
  bool loaded(std::int64_t entry)
  {
    m_loaded = entry >= 0 && entry == m_activeEntry && !m_active.empty();
    return m_loaded;
  }
  void changingTrack() { m_loaded = false; }
  bool matches(const std::string& token) const { return !token.empty() && token == m_active; }
  bool ready() const { return m_loaded; }
  const std::string& active() const { return m_active; }
  bool pending() const { return !m_pending.empty() && m_pendingEntry >= 0; }
  std::int64_t activeEntry() const { return m_activeEntry; }
private:
  std::string m_active, m_pending;
  std::int64_t m_activeEntry = -1, m_pendingEntry = -1;
  bool m_loaded = false;
};
#endif

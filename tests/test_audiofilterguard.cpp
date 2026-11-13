#include "AudioFilterGuard.h"

#include <iostream>

namespace {
int failures = 0;
void check(bool condition, const char* name)
{
  if (!condition) {
    std::cerr << "FAIL: " << name << '\n';
    ++failures;
  }
}
struct FakeFilters {
  bool owned = false;
  bool foreign = true;
  bool failRemoval = false;
  bool failRead = false;
  bool failReadAfterRemoval = false;
  int removals = 0;

  QVariant read() const {
    if (failRead) return {};
    QVariantList result;
    if (foreign) result.append(QVariantMap{{QStringLiteral("label"), QStringLiteral("other")}});
    if (owned) result.append(QVariantMap{{QStringLiteral("label"), QStringLiteral("deepstream-enhancement")}});
    return result;
  }
  int remove() {
    ++removals;
    if (failRemoval) return -1;
    owned = false;
    if (failReadAfterRemoval) failRead = true;
    return 0;
  }
  bool ensureAbsent() {
    return deepstreamEnsureAudioFilterAbsent([this] { return read(); }, [this] { return remove(); });
  }
};
}

int main()
{
  check(deepstreamAudioFilterPresence({}) == AudioFilterPresence::Unknown, "unreadable af");
  check(deepstreamAudioFilterPresence(QStringLiteral("invalid")) == AudioFilterPresence::Unknown, "wrong af type");
  check(deepstreamAudioFilterPresence(QVariantList{QStringLiteral("invalid")}) == AudioFilterPresence::Unknown, "invalid entry");
  check(deepstreamAudioFilterPresence(QVariantList{QVariantMap{{"label", 42}}}) == AudioFilterPresence::Unknown, "invalid label");
  check(deepstreamAudioFilterPresence(QVariantList{QVariantMap{}}) == AudioFilterPresence::Absent, "unlabelled filter");
  check(deepstreamAudioFilterPresence(QVariantList{QVariantMap{{"label", "@deepstream-enhancement"}}}) == AudioFilterPresence::Present, "prefixed label");

  FakeFilters filters;
  check(filters.ensureAbsent() && filters.removals == 0 && filters.foreign, "confirmed neutral path");
  filters.owned = true;
  filters.failRead = true;
  check(!filters.ensureAbsent() && filters.owned && filters.removals == 0, "failed read blocks boundary");
  filters.failRead = false;
  filters.failRemoval = true;
  check(!filters.ensureAbsent() && filters.owned && filters.foreign, "failed removal blocks boundary");
  filters.failRemoval = false;
  check(filters.ensureAbsent() && !filters.owned && filters.foreign, "successful retry preserves other filter");
  filters.owned = true;
  filters.failReadAfterRemoval = true;
  check(!filters.ensureAbsent() && !filters.owned && filters.foreign, "unverified removal blocks boundary");
  check(!filters.ensureAbsent(), "repeated failed read remains blocked");
  filters.failRead = false;
  filters.failReadAfterRemoval = false;
  check(filters.ensureAbsent() && filters.foreign, "read retry confirms absence");
  if (failures) return 1;
  std::cout << "PASS: verified filter boundary and retry\n";
  return 0;
}

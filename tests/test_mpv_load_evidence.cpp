#include "MpvLoadEvidence.h"
#include "LocalMediaGate.h"
#include <cassert>

int main() {
  MpvLoadEvidence evidence;
  LocalMediaGate gate;
  const auto oldGeneration = gate.begin({10});
  evidence.start(11); // START_FILE/path only, not a successful load.
  assert(gate.bind(oldGeneration, 11, true));
  assert(evidence.loaded(12) == -1); // Current playlist ID already changed.
  evidence.end(11); // A loading error/end must not become FILE_LOADED.
  assert(evidence.loaded(11) == -1);
  gate.invalidate();
  const auto current = gate.begin({10, 11});
  evidence.start(12);
  assert(gate.bind(current, 12, true));
  evidence.end(11); // A late old END_FILE cannot clear the new start.
  assert(!gate.matches(oldGeneration, 11, true));
  assert(evidence.loaded(11) == -1); // Old playing-ID sample is rejected.
  assert(evidence.loaded(12) == 12);
  assert(gate.matches(current, 12, true));
  evidence.end(12);
  assert(evidence.loaded(12) == -1);
}

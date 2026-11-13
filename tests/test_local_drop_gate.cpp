#include "LocalMediaGate.h"
#include <cassert>
#include <vector>

int main() {
  LocalMediaGate gate;
  const auto idle = gate.generation();
  gate.invalidate(); // A foreign request must invalidate even an idle drag.
  assert(gate.generation() != idle);
  assert(!gate.active());
  const auto first = gate.begin(std::vector<long long>{1, 2});
  assert(!gate.isNewEntry(-1));
  assert(!gate.isNewEntry(1));
  assert(gate.isNewEntry(3));
  assert(gate.bind(first, 3, true));
  gate.invalidate();
  assert(!gate.isNewEntry(4));
  const auto second = gate.begin(std::vector<long long>{1, 2, 3});
  assert(second != first);
  assert(!gate.matches(first, 3, true));
  assert(!gate.bind(second, 3, true)); // An old entry cannot become the new session.
  assert(gate.bind(second, 4, true));
  assert(gate.matches(second, 4, true));
}

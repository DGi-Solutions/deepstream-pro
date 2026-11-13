#include "DeferredLoadGate.h"
#include "LocalMediaPendingPolicy.h"
#include "LocalMediaGate.h"
#include <cassert>
#include <string>

int main() {
  using A = LocalPendingAction;
  assert(localPendingAction({}) == A::NothingPending);
  assert(localPendingAction({{true, true, true}}) == A::StopSoleOwned);
  assert(localPendingAction({{true, false, true}}) == A::Refuse); // previous owner
  assert(localPendingAction({{false, true, true}}) == A::Refuse); // malformed ID
  assert(localPendingAction({{true, true, false}}) == A::Refuse); // another file
  assert(localPendingAction({{true, true, true}, {true, true, false}}) == A::Refuse);
  assert(localGuardedNextValue(0, 42) ==
      "${?playlist/0/id==42:${?playlist/0/playing==yes:1}}");
  assert(localGuardedNextValue(1, 0) ==
      "${?playlist/1/id==0:${?playlist/1/playing==yes:2}}");
  assert(localGuardedNextValue(-1, 42).empty());
  assert(localGuardedNextValue(0, -1).empty());
  assert(localGuardedNextValue(INT_MAX, 42).empty());
  // A queue append does not revoke the local view, but a global stop would
  // destroy a foreign queued item and must be refused until it is gone.
  assert(!localMayStopAfterQueue(true, false));
  assert(localMayStopAfterQueue(true, true));
  assert(localMayStopAfterQueue(false, false));
  LocalMediaGate current;
  const auto generation = current.begin({7});
  assert(current.bind(generation, 8, true));
  const bool foreignQueued = true; // Foreign append leaves current item playing.
  assert(current.active() && current.matches(generation, 8, true));
  assert(!localMayStopAfterQueue(foreignQueued, false));
  // START_FILE/path can be present beyond the deadline without FILE_LOADED.
  assert(current.matches(generation, 8, true));
  assert(localShouldTimeOut(current.active(), false, current.generation() == generation));
  assert(!localShouldTimeOut(current.active(), true, current.generation() == generation));
  current.invalidate();
  assert(!localShouldTimeOut(current.active(), false, current.generation() == generation));

  DeferredLoadGate<std::string> gate;
  const auto ticket = gate.beginDrain();
  const auto local = gate.load("local");
  assert(local.disposition == decltype(gate)::LoadDisposition::Deferred);
  const auto foreign = gate.load("foreign");
  // A stale local timer may never cancel the newer foreign request.
  if (gate.draining() && gate.isCurrent(local.revision)) gate.stop();
  assert(gate.isCurrent(foreign.revision));
  const auto delivered = gate.finishDrain(ticket, true);
  assert(delivered.disposition == decltype(gate)::DrainDisposition::Load);
  assert(delivered.request && *delivered.request == "foreign");

  DeferredLoadGate<std::string> own;
  const auto ownTicket = own.beginDrain();
  const auto ownLocal = own.load("local");
  if (own.draining() && own.isCurrent(ownLocal.revision)) own.stop();
  assert(own.finishDrain(ownTicket, true).disposition == decltype(own)::DrainDisposition::Nothing);
}

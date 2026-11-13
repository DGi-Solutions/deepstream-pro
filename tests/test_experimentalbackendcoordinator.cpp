#include "ExperimentalBackendCoordinator.h"
#include <cstdlib>
#include <iostream>

using C = ExperimentalBackendCoordinator;
using A = C::Action;
using S = C::State;
using B = C::Backend;
#define REQUIRE(x) do { if (!(x)) { std::cerr << "FAIL line " << __LINE__ << ": " << #x << '\n'; std::exit(1); } } while (false)

static void defaultAndOptIn() {
  C c;
  auto d = c.start(false); auto mpv1=d.generation;
  REQUIRE(d.action==A::StartMpv && !c.accepts(B::Mpv,mpv1));
  REQUIRE(c.mpvStarted(mpv1,true).action==A::None && c.accepts(B::Mpv,mpv1));
  d=c.start(true);auto av1=d.generation;
  REQUIRE(av1!=mpv1 && d.action==A::StopMpv && !c.accepts(B::Mpv,mpv1));
  REQUIRE(c.mpvStopped(mpv1,true).action==A::None && c.state()==S::StoppingMpv);
  REQUIRE(c.mpvStopped(av1,true).action==A::StartAv && !c.accepts(B::Av,av1));
  REQUIRE(c.avStarted(av1,true).action==A::None && c.accepts(B::Av,av1));
  REQUIRE(!c.accepts(B::Mpv,av1));
}
static void fallbackOnlyAfterClose() {
  C c; auto d=c.start(true);auto id=d.generation;
  REQUIRE(d.action==A::StopMpv && c.mpvStopped(id,true).action==A::StartAv);
  REQUIRE(c.avStarted(id,false).action==A::CloseAv && c.state()==S::ClosingAv);
  REQUIRE(c.avFailed(id).action==A::None && c.mpvStarted(id,true).action==A::None);
  REQUIRE(c.avClosed(id,true).action==A::StartMpv && c.state()==S::StartingMpv);
  REQUIRE(c.avFailed(id).action==A::None && c.avClosed(id,true).action==A::None);
  REQUIRE(c.mpvStarted(id,true).action==A::None && c.accepts(B::Mpv,id));
  REQUIRE(c.avFailed(id).action==A::None && c.state()==S::Mpv);
}
static void activeFailureAndUserStop() {
  C c;auto d=c.start(true);auto id=d.generation;
  REQUIRE(c.mpvStopped(id,true).action==A::StartAv);
  REQUIRE(c.avStarted(id,true).action==A::None);
  REQUIRE(c.avFailed(id).action==A::CloseAv && !c.accepts(B::Av,id));
  d=c.stop();auto stop=d.generation;
  REQUIRE(stop!=id && d.action==A::CloseAv);
  REQUIRE(c.avClosed(id,true).action==A::None && c.state()==S::ClosingAv);
  REQUIRE(c.avClosed(stop,true).action==A::None && c.state()==S::Idle);
  REQUIRE(c.mpvStarted(stop,true).action==A::None && c.state()==S::Idle);
}
static void transitionsAndStaleEvents() {
  C c;auto first=c.start(true);auto a=first.generation;
  auto second=c.start(false);auto b=second.generation;
  REQUIRE(first.action==A::StopMpv && second.action==A::StopMpv && a!=b);
  REQUIRE(c.mpvStopped(a,true).action==A::None && c.mpvStopped(b,true).action==A::StartMpv);
  REQUIRE(c.mpvStarted(b,true).action==A::None);
  auto third=c.start(true);auto cgen=third.generation;
  REQUIRE(c.mpvStopped(cgen,true).action==A::StartAv);
  auto fourth=c.start(true);auto d=fourth.generation;
  REQUIRE(fourth.action==A::CloseAv);
  REQUIRE(c.avStarted(cgen,true).action==A::None && c.avClosed(cgen,true).action==A::None);
  REQUIRE(c.avClosed(d,true).action==A::StopMpv);
  REQUIRE(c.mpvStopped(d,true).action==A::StartAv);
  REQUIRE(c.avStarted(d,true).action==A::None && c.accepts(B::Av,d));
  auto fifth=c.start(false);auto e=fifth.generation;
  REQUIRE(fifth.action==A::CloseAv && c.avClosed(e,true).action==A::StartMpv);
  REQUIRE(c.mpvStarted(e,true).action==A::None && c.accepts(B::Mpv,e));
}
static void failedTeardownBlocks() {
  C c;auto d=c.start(true);auto id=d.generation;
  REQUIRE(c.mpvStopped(id,false).action==A::Failure && c.state()==S::Blocked);
  REQUIRE(c.start(true).action==A::None && c.state()==S::Blocked);
  auto stop=c.stop();REQUIRE(stop.action==A::StopAll);
  REQUIRE(c.allStopped(stop.generation,false).action==A::Failure && c.state()==S::Blocked);
  stop=c.stop();REQUIRE(stop.action==A::StopAll);
  REQUIRE(c.allStopped(stop.generation,true).action==A::None && c.state()==S::Idle);
  d=c.start(true);id=d.generation;
  REQUIRE(c.mpvStopped(id,true).action==A::StartAv && c.avStarted(id,true).action==A::None);
  REQUIRE(c.avFailed(id).action==A::CloseAv);
  REQUIRE(c.avClosed(id,false).action==A::Failure && c.state()==S::Blocked);
  REQUIRE(c.mpvStarted(id,true).action==A::None && c.start(false).action==A::None);
}
static void stoppedDuringStartup() {
  C c;auto a=c.start(true);auto stop=c.stop();
  REQUIRE(stop.action==A::StopMpv && c.mpvStopped(a.generation,true).action==A::None);
  REQUIRE(c.mpvStopped(stop.generation,true).action==A::None && c.state()==S::Idle);
  auto x=c.start(true);REQUIRE(c.mpvStopped(x.generation,true).action==A::StartAv);
  auto y=c.stop();REQUIRE(y.action==A::CloseAv);
  REQUIRE(c.avStarted(x.generation,true).action==A::None && c.avClosed(y.generation,true).action==A::None);
  REQUIRE(c.state()==S::Idle);
}
static void stopReloadRejectsOldCallbacks() {
  C c; auto first=c.start(true); auto a=first.generation;
  REQUIRE(c.mpvStopped(a,true).action==A::StartAv);
  REQUIRE(c.avStarted(a,true).action==A::None && c.accepts(B::Av,a));
  auto stop=c.stop(); REQUIRE(stop.action==A::CloseAv);
  REQUIRE(c.avClosed(stop.generation,true).action==A::None && c.state()==S::Idle);
  auto next=c.start(true); auto b=next.generation;
  REQUIRE(b!=a && b!=stop.generation && next.action==A::StopMpv);
  REQUIRE(c.avStarted(a,true).action==A::None && c.avClosed(stop.generation,true).action==A::None);
  REQUIRE(c.mpvStopped(b,true).action==A::StartAv);
  REQUIRE(c.avStarted(a,true).action==A::None && c.avFailed(a).action==A::None);
  REQUIRE(c.avStarted(b,true).action==A::None && c.accepts(B::Av,b) && !c.accepts(B::Av,a));
  REQUIRE(c.avFailed(a).action==A::None && c.accepts(B::Av,b));
}
int main() {
  stopReloadRejectsOldCallbacks();
  defaultAndOptIn();fallbackOnlyAfterClose();activeFailureAndUserStop();
  transitionsAndStaleEvents();failedTeardownBlocks();stoppedDuringStartup();
  std::cout << "PASS: opt-in, stop gates, close-before-fallback, stale events, failure and user stop\n";
}

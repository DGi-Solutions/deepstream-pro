#include "DeferredLoadGate.h"
#include <cstdlib>
#include <iostream>
#include <string>
#include <vector>
using G=DeferredLoadGate<std::string>;
#define CHECK(x) do { if (!(x)) { std::cerr << "FAIL line " << __LINE__ << ": " << #x << '\n'; std::exit(1); } } while(false)
static void latestWins() {
 G g; auto first=g.load("A");CHECK(first.disposition==G::LoadDisposition::RunNow);
 auto ticket=g.beginDrain();CHECK(ticket && !g.beginDrain());
 auto b=g.load("B");auto c=g.load("C");CHECK(b.disposition==G::LoadDisposition::Deferred && c.disposition==G::LoadDisposition::Deferred);
 CHECK(!g.isCurrent(first.revision) && !g.isCurrent(b.revision) && g.isCurrent(c.revision));
 auto done=g.finishDrain(ticket,true);CHECK(done.disposition==G::DrainDisposition::Load && done.request && *done.request=="C" && done.revision==c.revision);
 CHECK(g.finishDrain(ticket,true).disposition==G::DrainDisposition::Stale);
}
static void stopsAndNewLoad() {
 G g;g.load("A");auto t=g.beginDrain();g.load("B");auto stop=g.stop();
 auto done=g.finishDrain(t,true);CHECK(done.disposition==G::DrainDisposition::Nothing && done.revision==stop);
 CHECK(!g.draining()); t=g.beginDrain();stop=g.stop();auto after=g.load("D");
 CHECK(!g.isCurrent(stop) && after.disposition==G::LoadDisposition::Deferred);
 done=g.finishDrain(t,true);CHECK(done.request && *done.request=="D" && done.revision==after.revision);
}
static void staleAndUnconfirmed() {
 G g;g.load("A");auto old=g.beginDrain();g.stop();CHECK(g.finishDrain(old,true).disposition==G::DrainDisposition::Nothing);
 auto t=g.beginDrain();auto pending=g.load("B");
 CHECK(g.finishDrain(old,true).disposition==G::DrainDisposition::Stale && g.draining());
 CHECK(g.finishDrain(old,false).disposition==G::DrainDisposition::Stale && !g.blocked());
 auto failed=g.finishDrain(t,false);CHECK(failed.disposition==G::DrainDisposition::Failed && !failed.request && failed.revision==pending.revision && g.blocked());
 CHECK(g.load("C").disposition==G::LoadDisposition::Rejected && !g.beginDrain());
 CHECK(!g.recover(false) && g.blocked());CHECK(g.recover(true) && !g.blocked());
 CHECK(g.load("D").disposition==G::LoadDisposition::RunNow);
}
static void synchronousReentry() {
 G g;auto first=g.load("A");std::vector<std::string> emitted;
 // A Qt signal handler selects B synchronously. Old signal batch must stop.
 CHECK(!g.callIfCurrent(first.revision,[&]{emitted.push_back("A:canceled");g.load("B");}));
 CHECK(!g.callIfCurrent(first.revision,[&]{emitted.push_back("A:stopped");}));
 CHECK(emitted.size()==1 && emitted[0]=="A:canceled");
 auto current=g.load("C");CHECK(!g.callIfCurrent(current.revision,[&]{emitted.push_back("C:error");g.stop();}));
 CHECK(!g.callIfCurrent(current.revision,[&]{emitted.push_back("C:state");}));
 CHECK(emitted.size()==2 && emitted[1]=="C:error");
 // After confirmed drain, a reentrant new request invalidates the returned payload.
 auto t=g.beginDrain();g.load("D");auto result=g.finishDrain(t,true);CHECK(result.request && *result.request=="D");
 g.load("E");CHECK(!g.isCurrent(result.revision));
}
struct Playback { std::string url; bool autoplay; int seekMs; };
static void pendingPlaybackControls() {
 using P=DeferredLoadGate<Playback>;P g;auto t=g.beginDrain();auto a=g.load({"A",true,0});
 CHECK(g.mutatePending(a.revision,[](Playback &p){p.autoplay=false;}));
 CHECK(g.mutatePending(a.revision,[](Playback &p){p.seekMs=2500;}));
 CHECK(g.mutatePending(a.revision,[](Playback &p){p.autoplay=true;}));
 auto done=g.finishDrain(t,true);CHECK(done.request && done.request->url=="A" && done.request->autoplay && done.request->seekMs==2500);
 CHECK(!g.mutatePending(a.revision,[](Playback &p){p.seekMs=1;}));
 t=g.beginDrain();a=g.load({"A",true,0});auto b=g.load({"B",false,50});
 CHECK(!g.mutatePending(a.revision,[](Playback &p){p.autoplay=true;p.seekMs=99;}));
 CHECK(g.mutatePending(b.revision,[](Playback &p){p.seekMs=500;}));
 done=g.finishDrain(t,true);CHECK(done.request && done.request->url=="B" && !done.request->autoplay && done.request->seekMs==500);
}
static void mutationReentry() {
 using P=DeferredLoadGate<Playback>;P g;auto t=g.beginDrain();auto a=g.load({"A",true,0});
 CHECK(!g.mutatePending(a.revision,[&](Playback &p){p.seekMs=5;g.stop();p.seekMs=6;}));
 CHECK(g.finishDrain(t,true).disposition==P::DrainDisposition::Nothing);
 t=g.beginDrain();a=g.load({"A",true,0});
 CHECK(!g.mutatePending(a.revision,[&](Playback &p){g.load({"B",false,100});p.seekMs=7;}));
 auto b=g.revision();CHECK(g.mutatePending(b,[&](Playback &p){CHECK(!g.mutatePending(b,[](Playback &q){q.seekMs=9;}));p.seekMs=200;}));
 auto done=g.finishDrain(t,true);CHECK(done.request && done.request->url=="B" && !done.request->autoplay && done.request->seekMs==200);
}
static void restorationFailureBlocks() {
 G g;auto first=g.load("A");auto token=g.failClosed();CHECK(token!=first.revision && g.blocked());
 CHECK(g.load("B").disposition==G::LoadDisposition::Rejected && !g.beginDrain());
 CHECK(!g.recover(false));CHECK(g.recover(true));CHECK(g.load("C").disposition==G::LoadDisposition::RunNow);
}
int main(){restorationFailureBlocks();latestWins();stopsAndNewLoad();staleAndUnconfirmed();synchronousReentry();pendingPlaybackControls();mutationReentry();std::cout<<"PASS: latest load, stop, stale/failed drain, playback controls and reentry\n";}

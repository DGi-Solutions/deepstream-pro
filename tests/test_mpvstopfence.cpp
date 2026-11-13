#include "MpvStopFence.h"
#include <cstdlib>
#define CHECK(x) do { if(!(x)) return 1; } while(false)
int main(){MpvStopFence f;MpvStopFence::Snapshot s;s.commandAccepted=true;s.coreIdleKnown=true;s.coreIdle=true;s.playingPositionKnown=true;s.playingPosition=-1;s.queueDrained=true;s.noPendingLoads=true;
 f.arm(1,42,true);f.endFile(1,41);CHECK(!f.check(1,s));f.endFile(1,42);CHECK(!f.check(1,s));s.audioOutputKnown=true;CHECK(!f.check(1,s));s.audioOutputInactive=true;CHECK(f.check(1,s));
 f.arm(2,55,true);f.startFile(2);CHECK(f.state()==MpvStopFence::State::Failed);
 f.arm(3,std::nullopt,true);s.noPendingLoads=false;CHECK(!f.check(3,s));s.noPendingLoads=true;s.audioOutputKnown=false;CHECK(!f.check(3,s));
}
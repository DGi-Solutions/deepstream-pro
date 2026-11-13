#pragma once
#include <cstdint>
#include <optional>

// Decision-only stop fence for a PlayerComponent adapter. No mpv calls are made
// here; false/unknown observations always keep the fence closed. core-idle by
// itself is NOT a stop indication (paused/buffering may also be core-idle).
// A matched END_FILE and an empty playing position attest to the mpv core state,
// not to physical hardware buffer drain or the AVPlayer audio route.
class MpvStopFence {
public:
 using Generation = std::uint64_t;
 enum class State { Unarmed, Waiting, Failed, Confirmed };
 struct Snapshot {
  bool commandAccepted = false;
  bool coreIdleKnown = false;
  bool coreIdle = false;
  bool playingPositionKnown = false;
  std::int64_t playingPosition = -1;
  bool queueDrained = false;
  bool noPendingLoads = false;
  bool audioOutputKnown = false;
  bool audioOutputInactive = false;
 };
 // expectedEntry is the actual prior playlist_entry_id, or nullopt only if the
 // adapter observed no playing/loading item and no pending load before stop.
 void arm(Generation generation, std::optional<std::int64_t> expectedEntry,
          bool knownPreStopState) {
  gen_=generation;entry_=expectedEntry;seenEnd_=false;state_=State::Waiting;
  if(!generation||!knownPreStopState||(entry_&&*entry_<0))state_=State::Failed;
 }
 void startFile(Generation generation) {
  if(current(generation)&&state_==State::Waiting)state_=State::Failed;
 }
 void endFile(Generation generation,std::int64_t entry) {
  if(current(generation)&&state_==State::Waiting&&entry_&&entry==*entry_)seenEnd_=true;
 }
 bool check(Generation generation,const Snapshot& s) {
  if(!current(generation)||state_!=State::Waiting)return false;
  if(!s.commandAccepted){state_=State::Failed;return false;}
  if(entry_&&!seenEnd_)return false;
  if(!s.coreIdleKnown||!s.coreIdle||!s.playingPositionKnown||s.playingPosition!=-1||
     !s.queueDrained||!s.noPendingLoads||!s.audioOutputKnown||!s.audioOutputInactive)return false;
  state_=State::Confirmed;return true;
 }
 State state()const{return state_;}
private:
 bool current(Generation g)const{return g&&g==gen_;}
 Generation gen_=0; std::optional<std::int64_t> entry_; bool seenEnd_=false; State state_=State::Unarmed;
};

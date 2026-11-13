#include "LocalMediaGate.h"
#include "LocalMediaTrackPolicy.h"
#include <cassert>
int main() {
  LocalMediaGate g;
  auto a = g.begin({10, 15});
  assert(!g.bind(a,10,true)); // old same-file playlist entry
  assert(!g.bind(a,11,false)); // other file
  assert(!g.bind(a,15,true)); // previously queued same-file entry
  assert(g.bind(a,11,true));
  assert(g.matches(a,11,true));
  assert(!g.matches(a,12,true));
  assert(!g.matches(a,11,false));
  auto b = g.begin({11});
  assert(!g.bind(a,12,true)); // stale callback from a
  assert(!g.matches(a,11,true));
  assert(!g.bind(b,11,true));
  assert(g.bind(b,12,true));
  g.invalidate(); // external playback or stop
  assert(!g.matches(b,12,true));
  assert(!g.bind(b,13,true));
  using K = LocalMediaTrackKind;
  assert(localMediaTrackAllowed(true,K::Audio,2,{2,4}));
  assert(!localMediaTrackAllowed(false,K::Audio,2,{2,4}));
  assert(!localMediaTrackAllowed(true,K::Audio,3,{2,4}));
  assert(!localMediaTrackAllowed(true,K::Audio,-1,{2,4}));
  assert(localMediaTrackAllowed(true,K::Subtitle,-1,{}));
  assert(localMediaTrackAllowed(true,K::Subtitle,7,{7}));
  assert(!localMediaTrackAllowed(true,K::Subtitle,2,{7}));
  assert(!localMediaTrackAllowed(true,K::Invalid,2,{2}));
}

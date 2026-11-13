#include "AudioEnhancementSession.h"
#include <cassert>

int main()
{
  AudioEnhancementSession s;
  assert(!s.ready() && !s.matches("a"));
  s.prepare("a"); s.queued(10);
  assert(s.pending());
  assert(!s.end(4) && s.pending()); // Old END may arrive after replacement load.
  assert(s.start(10) && s.matches("a") && !s.ready());
  assert(s.loaded(10) && s.ready());
  assert(!s.loaded(11) && !s.ready());
  assert(s.loaded(10));
  s.changingTrack(); assert(!s.ready() && s.matches("a"));
  assert(s.loaded(10));
  s.prepare("b"); s.queued(20);
  assert(!s.end(10) && s.pending());
  assert(!s.start(15) && !s.matches("a") && s.pending());
  assert(s.end(15) && s.pending());
  assert(s.start(20) && s.matches("b"));
  assert(s.loaded(20));
  assert(!s.matches("a") && !s.matches(""));
  assert(s.end(20) && !s.matches("b") && !s.ready());
  s.prepare("c"); s.queued(30); assert(s.pending());
  s.stop(); assert(!s.pending() && !s.start(30) && !s.matches("c"));
  s.prepare("d"); s.queued(-1); assert(!s.pending());
  assert(!s.start(-1) && !s.loaded(-1));
  s.prepare(""); s.queued(40); assert(!s.start(40));
}

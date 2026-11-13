#pragma once
#include <cstdint>
#include <limits>
#include <optional>
#include <utility>

// A single-thread-owned gate. An application still has to prove actual output
// teardown, arrange timeouts, dispatch the returned request, and handle errors.
// It does not start, stop, own, or inspect either media backend.
template<class Request>
class DeferredLoadGate {
public:
  using Token = std::uint64_t;
  enum class LoadDisposition { RunNow, Deferred, Rejected };
  enum class DrainDisposition { Stale, Nothing, Load, Failed };
  struct LoadResult { Token revision; LoadDisposition disposition; };
  struct DrainResult { Token revision; DrainDisposition disposition; std::optional<Request> request; };

  Token revision() const { return revision_; }
  bool draining() const { return draining_; }
  bool blocked() const { return blocked_; }
  bool isCurrent(Token revision) const { return revision != 0 && revision == revision_; }

  // Load values must own their data; there is at most one pending request.
  LoadResult load(Request request) {
    if (!advanceRevision()) return {revision_, LoadDisposition::Rejected};
    if (blocked_) return {revision_, LoadDisposition::Rejected};
    if (!draining_) { pending_.reset(); return {revision_, LoadDisposition::RunNow}; }
    pending_ = std::move(request);
    return {revision_, LoadDisposition::Deferred};
  }

  // A new user stop supersedes a queued load. Any later load during the same
  // drain becomes the new desired request and supersedes that stop.
  Token stop() {
    if (!advanceRevision()) return revision_;
    pending_.reset();
    return revision_;
  }

  // Mutate a private copy to survive reentrant load()/stop() without keeping
  // a reference into a destroyed pending object. Nested mutations are refused.
  // The callback must not destroy the gate itself; its owner must use a
  // separate lifetime guard when invoking external code.
  template<class Mutator> bool mutatePending(Token token, Mutator &&mutator) {
    if (mutating_ || blocked_ || !draining_ || !pending_ || !isCurrent(token)) return false;
    struct MutationGuard {
      bool &active;
      explicit MutationGuard(bool &v) : active(v) { active = true; }
      ~MutationGuard() { active = false; }
    } guard(mutating_);
    Request copy = *pending_;
    std::forward<Mutator>(mutator)(copy);
    if (blocked_ || !draining_ || !pending_ || !isCurrent(token)) return false;
    pending_ = std::move(copy);
    return true;
  }

  // A drain cannot be restarted concurrently. Return 0 when blocked or already
  // draining; callers must associate real teardown completion with this ticket.
  Token beginDrain() {
    if (blocked_ || draining_ || drainTicket_ == std::numeric_limits<Token>::max()) {
      if (drainTicket_ == std::numeric_limits<Token>::max()) blocked_ = true;
      return 0;
    }
    draining_ = true;
    return ++drainTicket_;
  }

  // `confirmed` must mean the real backend boundary was positively verified.
  // A failed/unknown boundary blocks future loads until a separate recovery has
  // positively confirmed silence and the caller invokes recover(true).
  DrainResult finishDrain(Token ticket, bool confirmed) {
    if (!ticket || !draining_ || ticket != drainTicket_)
      return {revision_, DrainDisposition::Stale, std::nullopt};
    draining_ = false;
    if (!confirmed) {
      blocked_ = true;
      pending_.reset();
      return {revision_, DrainDisposition::Failed, std::nullopt};
    }
    if (!pending_) return {revision_, DrainDisposition::Nothing, std::nullopt};
    auto result = std::move(pending_);
    pending_.reset();
    return {revision_, DrainDisposition::Load, std::move(result)};
  }

  // Fail closed when a required backend restoration cannot be verified.
  Token failClosed() {
    advanceRevision();
    pending_.reset();
    blocked_ = true;
    return revision_;
  }

  bool recover(bool bothBackendsConfirmedStopped) {
    if (!blocked_ || draining_ || !bothBackendsConfirmedStopped ||
        revision_ == std::numeric_limits<Token>::max() ||
        drainTicket_ == std::numeric_limits<Token>::max()) return false;
    blocked_ = false;
    return true;
  }

  // Check again after each synchronous callback: it may call load() or stop().
  // The owner must separately protect its own lifetime during callback dispatch.
  template<class Callback> bool callIfCurrent(Token token, Callback &&callback) {
    if (!isCurrent(token)) return false;
    std::forward<Callback>(callback)();
    return isCurrent(token);
  }

private:
  bool advanceRevision() {
    if (revision_ == std::numeric_limits<Token>::max()) {
      pending_.reset(); blocked_ = true; return false;
    }
    ++revision_; return true;
  }
  Token revision_ = 0;
  Token drainTicket_ = 0;
  bool draining_ = false;
  bool blocked_ = false;
  bool mutating_ = false;
  std::optional<Request> pending_;
};

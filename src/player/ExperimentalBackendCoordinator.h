#pragma once

#include <cstdint>
#include <limits>

// Decision-only coordinator. It never starts/stops a real player itself.
// The adapter must tag every command completion with that command's generation
// and confirm actual output teardown before acknowledging a stop/close.
class ExperimentalBackendCoordinator {
public:
  using Generation = std::uint64_t;
  enum class State { Idle, StoppingMpv, StartingMpv, Mpv, StartingAv, Av,
                     ClosingAv, StoppingAll, Blocked };
  enum class Action { None, StopMpv, StartMpv, StartAv, CloseAv, StopAll, Failure };
  enum class Backend { Mpv, Av };
  struct Decision { Generation generation; Action action; };

  State state() const { return state_; }
  Generation generation() const { return generation_; }

  // AV is opt-in. Even from Idle it requires an explicit mpv-stop confirmation.
  // Starting a new request invalidates all previous backend event generations.
  Decision start(bool experimentalAv) {
    if (state_ == State::Blocked || state_ == State::StoppingAll || !next()) return noAction();
    const bool mustCloseAv = state_ == State::StartingAv || state_ == State::Av || state_ == State::ClosingAv;
    intent_ = experimentalAv ? Intent::Av : Intent::Mpv;
    if (mustCloseAv) { state_ = State::ClosingAv; return decision(Action::CloseAv); }
    // An earlier mpv start may be pending, so stop it before either replacement.
    if (state_ != State::Idle || experimentalAv) { state_ = State::StoppingMpv; return decision(Action::StopMpv); }
    state_ = State::StartingMpv;
    return decision(Action::StartMpv);
  }

  // User stop never schedules a fallback. Repeated commands supersede pending
  // completions; the adapter must make stop/close idempotent and acknowledge
  // the most recent command, even when the resource was already stopped.
  Decision stop() {
    if (!next()) return noAction();
    intent_ = Intent::Stop;
    if (state_ == State::Idle) return noAction();
    if (state_ == State::Blocked || state_ == State::StoppingAll) {
      state_ = State::StoppingAll; return decision(Action::StopAll);
    }
    if (state_ == State::StartingAv || state_ == State::Av || state_ == State::ClosingAv) {
      state_ = State::ClosingAv; return decision(Action::CloseAv);
    }
    state_ = State::StoppingMpv;
    return decision(Action::StopMpv);
  }

  Decision mpvStopped(Generation id, bool confirmed) {
    if (!current(id) || state_ != State::StoppingMpv) return noAction();
    if (!confirmed) return block();
    if (intent_ == Intent::Stop) { state_ = State::Idle; return noAction(); }
    if (intent_ == Intent::Av) { state_ = State::StartingAv; return decision(Action::StartAv); }
    state_ = State::StartingMpv; return decision(Action::StartMpv);
  }

  Decision mpvStarted(Generation id, bool ok) {
    if (!current(id) || state_ != State::StartingMpv) return noAction();
    if (!ok) return block();
    state_ = State::Mpv; return noAction();
  }

  Decision avStarted(Generation id, bool ok) {
    if (!current(id) || state_ != State::StartingAv) return noAction();
    if (!ok) return avFailed(id);
    state_ = State::Av; return noAction();
  }

  // AV fallback is single-shot: it first closes AV and only then starts mpv.
  // A duplicate AV failure in ClosingAv or any later state does nothing.
  Decision avFailed(Generation id) {
    if (!current(id) || (state_ != State::StartingAv && state_ != State::Av)) return noAction();
    intent_ = Intent::Mpv;
    state_ = State::ClosingAv; return decision(Action::CloseAv);
  }

  Decision avClosed(Generation id, bool confirmed) {
    if (!current(id) || state_ != State::ClosingAv) return noAction();
    if (!confirmed) return block();
    if (intent_ == Intent::Stop) { state_ = State::Idle; return noAction(); }
    if (intent_ == Intent::Av) { state_ = State::StoppingMpv; return decision(Action::StopMpv); }
    state_ = State::StartingMpv; return decision(Action::StartMpv);
  }

  // Recovery from a failed/unknown stop requires confirmation that BOTH
  // backends are stopped; the adapter must not report this optimistically.
  Decision allStopped(Generation id, bool confirmed) {
    if (!current(id) || state_ != State::StoppingAll) return noAction();
    if (!confirmed) return block();
    state_ = State::Idle; return noAction();
  }

  // Forward public playback signals only from the current, ready backend.
  bool accepts(Backend backend, Generation id) const {
    return current(id) && ((backend == Backend::Mpv && state_ == State::Mpv) ||
                           (backend == Backend::Av && state_ == State::Av));
  }

private:
  enum class Intent { Stop, Mpv, Av };
  State state_ = State::Idle;
  Intent intent_ = Intent::Stop;
  Generation generation_ = 0;
  bool next() {
    if (generation_ == std::numeric_limits<Generation>::max()) { state_ = State::Blocked; return false; }
    ++generation_; return true;
  }
  bool current(Generation id) const { return id && id == generation_; }
  Decision decision(Action action) const { return {generation_, action}; }
  Decision noAction() const { return decision(Action::None); }
  Decision block() { state_ = State::Blocked; return decision(Action::Failure); }
};

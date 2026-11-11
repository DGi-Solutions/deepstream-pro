#!/usr/bin/env python3
"""Check calls on PlayerComponent's MpvController against its public header."""
import argparse
from pathlib import Path
import re


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True, type=Path)
    root = parser.parse_args().source
    player = (root / "src/player/PlayerComponent.cpp").read_text()
    header = (root / "external/mpvqt/src/mpvcontroller.h").read_text()
    calls = set(re.findall(r"\bm_mpv->([A-Za-z_]\w*)\s*\(", player))
    missing = sorted(name for name in calls
                     if not re.search(r"\b" + re.escape(name) + r"\s*\(", header))
    if missing:
        raise SystemExit("MpvController methods absent from public header: " + ", ".join(missing))
    print("PASS MpvController methods:", ", ".join(sorted(calls)))
    print("Scope: public method-name check only; this is not a C++ compilation.")


if __name__ == "__main__":
    main()

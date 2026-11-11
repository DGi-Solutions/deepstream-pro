#!/usr/bin/env python3
"""Finish a private native bundle without retaining build-host dependencies."""
import json
from pathlib import Path
import plistlib
import re
import subprocess
import sys

app = Path(sys.argv[1]).resolve(strict=True)
report = Path(sys.argv[2])
info = plistlib.loads((app / "Contents/Info.plist").read_bytes())
if info.get("CFBundleIdentifier") != "local.dgi.DeepStreamPro":
    raise SystemExit("Refusing to modify a different application")
main = app / "Contents/MacOS" / info["CFBundleExecutable"]
frameworks = app / "Contents/Frameworks"
if not (frameworks / "libmpv.2.dylib").is_file():
    raise SystemExit("MPV was not deployed")
actions = []

def run(*args):
    return subprocess.check_output(args, text=True, stderr=subprocess.STDOUT)

# macdeployqt discovers MPV through its actual SDK path. The released executable
# must subsequently use the deployed copy, never the temporary source path.
for line in run("/usr/bin/otool", "-L", str(main)).splitlines()[1:]:
    dep = line.strip().split(" (compatibility version", 1)[0]
    if dep.startswith("/") and Path(dep).name == "libmpv.2.dylib":
        run("/usr/bin/install_name_tool", "-change", dep, "@rpath/libmpv.2.dylib", str(main))
        actions.append({"binary": str(main.relative_to(app)), "replace": dep, "with": "@rpath/libmpv.2.dylib"})

# These optional Qt integrations are unused by this player. Their SDK binaries
# require external database installations or a separately installed GPS module.
# SQLite and the native CoreLocation positioning backend remain bundled.
for relative in (
    "Contents/PlugIns/sqldrivers/libqsqlodbc.dylib",
    "Contents/PlugIns/sqldrivers/libqsqlpsql.dylib",
    "Contents/PlugIns/sqldrivers/libqsqlmimer.dylib",
    "Contents/PlugIns/position/libqtposition_nmea.dylib",
):
    p = app / relative
    if p.is_file() and not p.is_symlink():
        p.unlink()
        actions.append({"omit_unused_plugin": relative})

magic = {b"\xcf\xfa\xed\xfe", b"\xfe\xed\xfa\xcf", b"\xca\xfe\xba\xbe", b"\xbe\xba\xfe\xca", b"\xca\xfe\xba\xbf"}
for p in app.rglob("*"):
    if p.is_symlink() or not p.is_file():
        continue
    with p.open("rb") as f:
        if f.read(4) not in magic:
            continue
    executable = p if p.name == "QtWebEngineProcess" else main
    loads = run("/usr/bin/otool", "-l", str(p))
    rpaths = set(re.findall(r"cmd LC_RPATH\s+cmdsize \d+\s+path (.*?) \(offset", loads))
    for rp in sorted(rpaths):
        expanded = Path(rp.replace("@loader_path", str(p.parent)).replace("@executable_path", str(executable.parent)))
        if not expanded.is_absolute() or not expanded.resolve().is_relative_to(app):
            run("/usr/bin/install_name_tool", "-delete_rpath", rp, str(p))
            actions.append({"binary": str(p.relative_to(app)), "remove_build_rpath": rp})

report.write_text(json.dumps({"bundle_id": info["CFBundleIdentifier"], "actions": actions}, indent=2) + "\n")
print("Native bundle fixups:", len(actions))

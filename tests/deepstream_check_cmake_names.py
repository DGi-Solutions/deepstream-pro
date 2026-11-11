#!/usr/bin/env python3
"""Execute the upstream CMake naming module for simulated target platforms."""
import argparse
import os
from pathlib import Path
import shutil
import subprocess
import tempfile


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--cmake", type=Path, required=True)
    args = parser.parse_args()
    root = args.source.resolve()
    cmake = args.cmake.resolve()
    module = root / "CMakeModules" / "NameConfiguration.cmake"
    template = root / "src" / "shared" / "Names.cpp.in"
    with tempfile.TemporaryDirectory(prefix="deepstream-cmake-") as tmp:
        tmp = Path(tmp)
        (tmp / "src" / "shared").mkdir(parents=True)
        shutil.copyfile(template, tmp / "src" / "shared" / "Names.cpp.in")
        script = tmp / "inspect.cmake"
        script.write_text(f'include("{module}")\n'
                          'file(WRITE "${CMAKE_CURRENT_BINARY_DIR}/names.txt" '
                          '"${MAIN_NAME}\\n${DATA_NAME}\\n")\n')
        cases = [
            ("macOS", "ON", "OFF", "Jellyfin Desktop", "DeepStream Pro"),
            ("Windows", "OFF", "ON", "Jellyfin Desktop", "Jellyfin Desktop"),
            ("Linux", "OFF", "OFF", "jellyfin-desktop", "jellyfin-desktop"),
        ]
        for name, apple, windows, expected_main, expected_data in cases:
            subprocess.run([str(cmake), f"-DAPPLE={apple}", f"-DWIN32={windows}",
                            "-P", str(script)], cwd=tmp, check=True,
                           stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                           env=os.environ.copy())
            values = (tmp / "names.txt").read_text().splitlines()
            if values != [expected_main, expected_data]:
                raise AssertionError(f"{name}: unexpected generated names: {values}")
            generated = (tmp / "src" / "shared" / "Names.cpp").read_text()
            if f'"{expected_data}"' not in generated:
                raise AssertionError(f"{name}: generated application data name mismatch")
            print(f"PASS {name}: generated data name {expected_data}")

        # Evaluate the actual bundle declarations, not a separately copied model
        # of the expected branches. This catches later overrides of the ID.
        cmakelists = (root / "src" / "CMakeLists.txt").read_text()
        start = cmakelists.index("set(MACOSX_BUNDLE_ICON_FILE")
        stop = cmakelists.index("\nif(APPLE)\n  if(HAVE_UPDATER)", start)
        declarations = cmakelists[start:stop]
        script.write_text(declarations + '\nfile(WRITE "${CMAKE_CURRENT_BINARY_DIR}/bundle.txt" '
                          '"${MACOSX_BUNDLE_BUNDLE_NAME}\\n${MACOSX_BUNDLE_GUI_IDENTIFIER}\\n")\n')
        for name, apple, expected_name, expected_id in [
            ("macOS", "ON", "DeepStream Pro", "local.dgi.DeepStreamPro"),
            ("non-Apple", "OFF", "Jellyfin", "org.jellyfin.JellyfinDesktop"),
        ]:
            subprocess.run([str(cmake), f"-DAPPLE={apple}", "-P", str(script)],
                           cwd=tmp, check=True, stdout=subprocess.PIPE,
                           stderr=subprocess.PIPE, text=True, env=os.environ.copy())
            values = (tmp / "bundle.txt").read_text().splitlines()
            if values != [expected_name, expected_id]:
                raise AssertionError(f"{name}: unexpected bundle identity: {values}")
            print(f"PASS {name}: generated bundle identity {expected_id}")
    print("Scope: CMake identity declarations only; not a macOS build.")


if __name__ == "__main__":
    main()

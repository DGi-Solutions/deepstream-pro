#!/bin/sh
# Build a separately named, ad-hoc-signed Apple Silicon preview. Dependencies
# are installed separately; this script never changes the installed app.
set -eu

if [ "$#" -ne 1 ]; then
    echo "Usage: $0 EXISTING_OUTPUT_DIRECTORY" >&2
    exit 2
fi
if [ "$(uname -s)" != Darwin ] || [ "$(uname -m)" != arm64 ]; then
    echo "An Apple Silicon Mac is required." >&2
    exit 1
fi
for tool in cmake ninja pkg-config xcrun lipo codesign ditto python3; do
    if ! command -v "$tool" >/dev/null 2>&1; then
        echo "Missing required build tool: $tool" >&2
        exit 1
    fi
done
if [ ! -d "$1" ]; then
    echo "Output directory does not exist: $1" >&2
    exit 1
fi
out_dir=$(cd "$1" && pwd)
source_root=$(CDPATH= cd "$(dirname "$0")/../.." && pwd)
qt_root=${DEEPSTREAM_QTROOT:-"$source_root/dev/macos/deps/qt/6.11.3/macos"}
if [ ! -d "$qt_root" ]; then
    echo "Qt 6.11.3 not found at $qt_root; set DEEPSTREAM_QTROOT." >&2
    exit 1
fi
if ! pkg-config --exists mpv; then
    echo "The libmpv pkg-config entry is unavailable." >&2
    exit 1
fi
sdk=$(xcrun --sdk macosx --show-sdk-version)
sdk_major=${sdk%%.*}
case "$sdk_major" in *[!0-9]*|'') echo "Unexpected macOS SDK version: $sdk" >&2; exit 1;; esac
if [ "$sdk_major" -lt 27 ]; then
    echo "macOS SDK 27 or newer is required for this build; found $sdk." >&2
    exit 1
fi
app="$out_dir/DeepStream Pro.app"
archive="$out_dir/DeepStream-Pro-macOS-arm64.zip"
if [ -e "$app" ] || [ -e "$archive" ]; then
    echo "Output already exists; choose a fresh directory." >&2
    exit 1
fi
build_dir=$(mktemp -d "${TMPDIR:-/tmp}/deepstream-pro-build.XXXXXX")
printf 'Build directory: %s\nSDK: %s\nQt: %s\n' "$build_dir" "$sdk" "$qt_root"

cmake -S "$source_root" -B "$build_dir" -G Ninja \
    -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_OSX_ARCHITECTURES=arm64 \
    -DCMAKE_OSX_SYSROOT=macosx \
    -DCMAKE_INSTALL_PREFIX="$build_dir/output" \
    -DQTROOT="$qt_root" \
    -DCMAKE_PREFIX_PATH="$qt_root" \
    -DUSE_STATIC_MPVQT=ON \
    -DCHECK_FOR_UPDATES=OFF
cmake --build "$build_dir" --target install --parallel 4

internal="$build_dir/output/Jellyfin Desktop.app"
if [ ! -d "$internal" ]; then
    echo "Bundled app not found: $internal" >&2
    exit 1
fi
ditto "$internal" "$app"
python3 "$source_root/dev/macos/finalize-bundle.py" "$app" "$out_dir/native-bundle-fixups.json"
codesign --force --deep --sign - "$app"
codesign --verify --deep --strict "$app"
lipo -verify_arch arm64 "$app/Contents/MacOS/Jellyfin Desktop"
name=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleName' "$app/Contents/Info.plist")
bundle_id=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$app/Contents/Info.plist")
if [ "$name" != 'DeepStream Pro' ] || [ "$bundle_id" != 'local.dgi.DeepStreamPro' ]; then
    echo "Unexpected app identity: $name / $bundle_id" >&2
    exit 1
fi
ditto -c -k --sequesterRsrc --keepParent "$app" "$archive"
shasum -a 256 "$archive"
echo "Created: $archive"
echo "The app is ad-hoc signed, not notarized. Native playback tests remain required."

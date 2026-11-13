#!/usr/bin/env python3
"""Sign an already bundled DeepStream app, including Qt WebEngine helpers."""
import argparse
from pathlib import Path
import plistlib
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument('app', type=Path)
parser.add_argument('--identity', required=True)
args = parser.parse_args()
app = args.app.resolve(strict=True)
source = Path(__file__).resolve().parents[2]
info = plistlib.loads((app / 'Contents/Info.plist').read_bytes())
assert info['CFBundleIdentifier'] == 'local.dgi.DeepStreamPro'
main_entitlements = source / 'bundle/osx/DeepStream.entitlements'
magic = {b'\xcf\xfa\xed\xfe', b'\xfe\xed\xfa\xcf', b'\xca\xfe\xba\xbe', b'\xbe\xba\xfe\xca', b'\xca\xfe\xba\xbf'}

def sign(path, entitlements=None):
    command = ['codesign', '--force', '--timestamp', '--options', 'runtime', '--sign', args.identity]
    if entitlements:
        command += ['--entitlements', str(entitlements)]
    subprocess.run(command + [str(path)], check=True, capture_output=True)

count = 0
for path in sorted(app.rglob('*'), key=lambda path: len(path.parts), reverse=True):
    if path.is_symlink() or not path.is_file():
        continue
    with path.open('rb') as handle:
        if handle.read(4) not in magic:
            continue
    sign(path)
    count += 1
bundles = [path for path in app.rglob('*') if path.is_dir() and not path.is_symlink() and path.suffix in ('.app', '.framework')]
for bundle in sorted(bundles, key=lambda path: len(path.parts), reverse=True):
    entitlements = None
    if bundle.name == 'QtWebEngineProcess.app':
        entitlements = bundle / 'Contents/Resources/QtWebEngineProcess.entitlements'
        assert entitlements.is_file(), 'Qt vendor entitlements are required'
    sign(bundle, entitlements)
sign(app, main_entitlements)
subprocess.run(['codesign', '--verify', '--deep', '--strict', str(app)], check=True)
print(f'Signed {count} Mach-O files and {len(bundles) + 1} bundles.')

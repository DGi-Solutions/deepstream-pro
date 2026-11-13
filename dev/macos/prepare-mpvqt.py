#!/usr/bin/env python3
"""Stage the pinned mpvqt source with the recorded DeepStream modifications."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys

HERE = Path(__file__).resolve().parent
EXPECTED = json.loads((HERE / 'mpvqt-manifest.json').read_text())
PATCH = HERE / 'mpvqt-local-changes.patch'
CHUNK = 1024 * 1024


def manifest(root):
    """Refuse unknown files and symlinks; hash only the expected source tree."""
    names = {}
    for directory, dirs, files in os.walk(root, followlinks=False):
        path = Path(directory)
        if path == root:
            dirs[:] = [name for name in dirs if name != '.git']
            files = [name for name in files if name != '.git']
        for name in dirs:
            if (path / name).is_symlink():
                raise ValueError('mpvqt source contains a symlink')
        for name in files:
            f = path / name
            if f.is_symlink() or not stat.S_ISREG(f.lstat().st_mode):
                raise ValueError('mpvqt source contains a non-regular file')
            names[f.relative_to(root).as_posix()] = f
    if set(names) != set(EXPECTED['base']):
        raise ValueError('mpvqt source files differ from the pinned source')
    hashes = {}
    for name, file in names.items():
        h = hashlib.sha256()
        with file.open('rb') as handle:
            while chunk := handle.read(CHUNK):
                h.update(chunk)
        hashes[name] = h.hexdigest()
    return hashes


def main():
    if len(sys.argv) != 3:
        raise ValueError('Usage: prepare-mpvqt.py SOURCE NEW_OUTPUT')
    source = Path(sys.argv[1]).resolve(strict=True)
    output = Path(sys.argv[2]).absolute()
    if not source.is_dir() or output.exists() or output.is_symlink():
        raise ValueError('source must exist and output must be new')
    if source == output.resolve() or source in output.resolve().parents:
        raise ValueError('output must not be inside source')
    actual = manifest(source)
    if actual == EXPECTED['base']:
        needs_patch = True
    elif actual == EXPECTED['patched']:
        needs_patch = False
    else:
        raise ValueError('mpvqt differs from both pinned and recorded sources')
    shutil.copytree(source, output, symlinks=True, ignore=shutil.ignore_patterns('.git'))
    if needs_patch:
        subprocess.run(['patch', '-s', '-p1', '-i', str(PATCH)], cwd=output,
                       stdin=subprocess.DEVNULL, check=True, timeout=30)
    if manifest(output) != EXPECTED['patched']:
        raise ValueError('staged mpvqt differs from recorded build source')
    print('Prepared pinned mpvqt source with recorded DeepStream changes.')


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, KeyError, subprocess.SubprocessError) as error:
        print('mpvqt preparation failed:', str(error), file=sys.stderr)
        sys.exit(1)

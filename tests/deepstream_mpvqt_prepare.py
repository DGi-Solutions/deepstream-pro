#!/usr/bin/env python3
"""Offline tests for reproducible staging of the pinned mpvqt dependency."""
from pathlib import Path
import hashlib
import os
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path(os.environ.get('DEEPSTREAM_MPVQT_TEST_SOURCE', ROOT/'external/mpvqt'))
SCRIPT = ROOT/'dev/macos/prepare-mpvqt.py'
PATCH = ROOT/'dev/macos/mpvqt-local-changes.patch'

def hashes(root):
    return {p.relative_to(root).as_posix():hashlib.sha256(p.read_bytes()).hexdigest()
            for p in root.rglob('*') if p.is_file() and not p.is_symlink() and '.git' not in p.relative_to(root).parts}

@unittest.skipUnless((SOURCE/'src/mpvcontroller.cpp').is_file(), 'initialize mpvqt before testing')
class Preparation(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.addCleanup(self.temp.cleanup)
        self.patched = self.root/'prepared baseline'
        initial = self.invoke(SOURCE,self.patched)
        self.assertEqual(initial.returncode,0,initial.stderr)
        self.base = self.root/'pinned baseline'
        shutil.copytree(self.patched,self.base)
        result = subprocess.run(['patch','-s','-R','-p1','-i',str(PATCH)],cwd=self.base,
                                stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=20)
        self.assertEqual(result.returncode,0,result.stderr)

    def invoke(self,source,out):
        return subprocess.run(['python3',str(SCRIPT),str(source),str(out)],
                              stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=20)

    def test_clean_and_already_patched_input(self):
        expected=hashes(self.patched)
        for num,source in enumerate((self.base,self.patched)):
            before=hashes(source);out=self.root/str(num)
            result=self.invoke(source,out)
            self.assertEqual(result.returncode,0,result.stderr)
            self.assertEqual(hashes(out),expected)
            self.assertEqual(hashes(source),before)

    def test_reject_unknown_mutation_or_extra_file(self):
        for what in ('mutation','extra'):
            source=self.root/what;shutil.copytree(self.base,source)
            if what=='mutation':(source/'src/mpvcontroller.cpp').write_text('changed')
            else:(source/'untracked').write_text('new')
            before=hashes(source);out=self.root/(what+'-out')
            self.assertNotEqual(self.invoke(source,out).returncode,0)
            self.assertFalse(out.exists());self.assertEqual(hashes(source),before)

    def test_reject_symlink_and_existing_output(self):
        source=self.root/'source';shutil.copytree(self.base,source)
        (source/'untracked').symlink_to(source/'README.md')
        self.assertNotEqual(self.invoke(source,self.root/'out').returncode,0)
        out=self.root/'existing';out.mkdir();(out/'keep').write_text('kept')
        self.assertNotEqual(self.invoke(self.base,out).returncode,0)
        self.assertEqual((out/'keep').read_text(),'kept')

    def test_paths_with_spaces(self):
        source=self.root/'source with spaces';shutil.copytree(self.base,source)
        out=self.root/'output with spaces'
        result=self.invoke(source,out)
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertEqual(hashes(out),hashes(self.patched))

if __name__ == '__main__':
    unittest.main(verbosity=2)

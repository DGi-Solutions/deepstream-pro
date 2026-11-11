#!/usr/bin/env python3
"""Read-only libmpv option probe: no user configuration, media, or audio output.

Run on macOS with --lib pointing to the libmpv bundled in the candidate app.
The process environment must allow the library's bundled dependencies to load.
This tests option parsing and readback only, not actual audio device behavior.
"""
import argparse
import ctypes
import json
from pathlib import Path


class MpvValue(ctypes.Union):
    _fields_ = [("string", ctypes.c_char_p), ("flag", ctypes.c_int),
                ("int64", ctypes.c_int64), ("double", ctypes.c_double),
                ("opaque", ctypes.c_void_p)]


class MpvNode(ctypes.Structure):
    _fields_ = [("value", MpvValue), ("format", ctypes.c_int)]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--lib", required=True, type=Path)
    args = parser.parse_args()
    if not args.lib.is_absolute() or not args.lib.is_file():
        parser.error("--lib must be an absolute path to an existing libmpv")

    lib = ctypes.CDLL(str(args.lib))
    lib.mpv_create.restype = ctypes.c_void_p
    lib.mpv_initialize.argtypes = [ctypes.c_void_p]
    lib.mpv_initialize.restype = ctypes.c_int
    lib.mpv_set_option_string.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_char_p]
    lib.mpv_set_option_string.restype = ctypes.c_int
    lib.mpv_set_property.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_int, ctypes.c_void_p]
    lib.mpv_set_property.restype = ctypes.c_int
    lib.mpv_get_property_string.argtypes = [ctypes.c_void_p, ctypes.c_char_p]
    lib.mpv_get_property_string.restype = ctypes.c_void_p
    lib.mpv_free.argtypes = [ctypes.c_void_p]
    lib.mpv_terminate_destroy.argtypes = [ctypes.c_void_p]

    handle = lib.mpv_create()
    if not handle:
        raise RuntimeError("mpv_create failed")
    try:
        for key, value in ((b"config", b"no"), (b"load-scripts", b"no"), (b"vo", b"null")):
            if lib.mpv_set_option_string(handle, key, value) < 0:
                raise RuntimeError("Unable to isolate mpv configuration")
        rc = lib.mpv_initialize(handle)
        if rc < 0:
            raise RuntimeError(f"mpv_initialize failed: {rc}")

        results = []
        for text in ("avfoundation,coreaudio", "avfoundation,coreaudio,", "auto", ""):
            node = MpvNode()
            encoded = text.encode("utf-8")
            node.value.string = encoded
            node.format = 1  # MPV_FORMAT_STRING within the node, like MpvQt.
            rc = lib.mpv_set_property(handle, b"ao", 6, ctypes.byref(node))  # MPV_FORMAT_NODE
            ptr = lib.mpv_get_property_string(handle, b"ao")
            try:
                value = ctypes.string_at(ptr).decode("utf-8", "replace") if ptr else None
            finally:
                if ptr:
                    lib.mpv_free(ptr)
            results.append({"requested": text, "set_result": rc, "readback": value})
        print(json.dumps({"scope": "libmpv AO option parsing only; no media or audio device opened",
                          "results": results}, indent=2))
    finally:
        lib.mpv_terminate_destroy(handle)


if __name__ == "__main__":
    main()

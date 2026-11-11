#!/usr/bin/env python3
"""Exercise bundled libmpv with generated audio, without user media or profiles.

This checks decoding, the reported PCM output, pause, seek and track switching.
It does not check Atmos objects, Bluetooth codecs, lip sync or listening quality.
"""
import argparse
import array
import ctypes as c
import json
import math
from pathlib import Path
import subprocess
import sys
import time
import wave


class Value(c.Union):
    _fields_ = [('string', c.c_char_p), ('flag', c.c_int), ('int64', c.c_int64),
                ('double', c.c_double), ('pointer', c.c_void_p)]


class Node(c.Structure):
    _fields_ = [('value', Value), ('format', c.c_int)]


class NodeList(c.Structure):
    _fields_ = [('count', c.c_int), ('values', c.POINTER(Node)), ('keys', c.POINTER(c.c_char_p))]


def unpack(node):
    if node.format == 0:
        return None
    if node.format in (1, 2):
        return node.value.string.decode('utf-8', 'replace') if node.value.string else ''
    if node.format == 3:
        return bool(node.value.flag)
    if node.format == 4:
        return node.value.int64
    if node.format == 5:
        return node.value.double
    if node.format in (7, 8):
        items = c.cast(node.value.pointer, c.POINTER(NodeList)).contents
        if node.format == 7:
            return [unpack(items.values[i]) for i in range(items.count)]
        return {items.keys[i].decode(): unpack(items.values[i]) for i in range(items.count)}
    raise ValueError(f'Unexpected mpv node format {node.format}')


class Player:
    def __init__(self, library, output):
        self.lib = c.CDLL(str(library))
        signatures = {
            'mpv_create': ([], c.c_void_p),
            'mpv_set_option_string': ([c.c_void_p, c.c_char_p, c.c_char_p], c.c_int),
            'mpv_initialize': ([c.c_void_p], c.c_int),
            'mpv_get_property': ([c.c_void_p, c.c_char_p, c.c_int, c.c_void_p], c.c_int),
            'mpv_free_node_contents': ([c.POINTER(Node)], None),
            'mpv_command': ([c.c_void_p, c.POINTER(c.c_char_p)], c.c_int),
            'mpv_wait_event': ([c.c_void_p, c.c_double], c.c_void_p),
            'mpv_terminate_destroy': ([c.c_void_p], None),
        }
        for name, (args, result) in signatures.items():
            function = getattr(self.lib, name)
            function.argtypes, function.restype = args, result
        self.handle = self.lib.mpv_create()
        assert self.handle, 'mpv_create failed'
        for name, value in {
            'config': 'no', 'load-scripts': 'no', 'vo': 'null', 'ao': output,
            'volume': '0', 'audio-channels': 'auto', 'terminal': 'no', 'msg-level': 'all=no',
        }.items():
            assert self.lib.mpv_set_option_string(self.handle, name.encode(), value.encode()) >= 0, name
        assert self.lib.mpv_initialize(self.handle) >= 0, 'mpv_initialize failed'

    def get(self, name):
        value = Node()
        if self.lib.mpv_get_property(self.handle, name.encode(), 6, c.byref(value)) < 0:
            return None
        try:
            return unpack(value)
        finally:
            self.lib.mpv_free_node_contents(c.byref(value))

    def command(self, *args):
        values = (c.c_char_p * (len(args) + 1))(*[str(a).encode() for a in args], None)
        assert self.lib.mpv_command(self.handle, values) >= 0, args[0]

    def wait_for(self, predicate, seconds=6):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            if predicate():
                return
            self.lib.mpv_wait_event(self.handle, 0.02)
        raise TimeoutError('Native audio state did not reach the expected value')

    def close(self):
        self.lib.mpv_terminate_destroy(self.handle)


def make_fixtures(ffmpeg, directory):
    wav = directory / 'generated-8ch.wav'
    with wave.open(str(wav), 'wb') as out:
        out.setparams((8, 2, 48000, 0, 'NONE', 'not compressed'))
        for block in range(4 * 48):
            samples = array.array('h', (round(120 * math.sin(2 * math.pi * (220 + ch * 110) * (block * 1000 + i) / 48000))
                                       for i in range(1000) for ch in range(8)))
            if sys.byteorder != 'little':
                samples.byteswap()
            out.writeframes(samples.tobytes())
    specifications = [
        ('truehd', 'truehd', '5.1(side)', 6, ['-strict', '-2']),
        ('eac3', 'eac3', '5.1(side)', 6, ['-b:a', '640k']),
        ('ac3', 'ac3', '5.1(side)', 6, ['-b:a', '448k']),
        ('dts', 'dca', '5.1(side)', 6, ['-strict', '-2', '-b:a', '768k']),
        ('flac', 'flac', '7.1', 8, []),
        ('alac', 'alac', '5.1', 6, []),
        ('aac', 'aac', '5.1', 6, ['-b:a', '384k']),
        ('pcm_s16le', 'pcm_s16le', '7.1', 8, []),
    ]
    fixtures = []
    for codec, encoder, layout, channels, extra in specifications:
        destination = directory / f'generated-{codec}.mka'
        command = [str(ffmpeg), '-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(wav),
                   '-map', '0:a', '-channel_layout', layout, '-c:a', encoder, *extra, str(destination)]
        subprocess.run(command, check=True, capture_output=True)
        fixtures.append((codec, channels, destination))
    multi = directory / 'generated-tracks.mka'
    subprocess.run([str(ffmpeg), '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
                    '-i', str(directory / 'generated-ac3.mka'), '-i', str(directory / 'generated-truehd.mka'),
                    '-map', '0:a', '-map', '1:a', '-c', 'copy', str(multi)], check=True, capture_output=True)
    return fixtures, multi


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--lib', type=Path, required=True)
    parser.add_argument('--ffmpeg', type=Path, required=True)
    parser.add_argument('--work-dir', type=Path, required=True)
    parser.add_argument('--output', default='avfoundation,coreaudio,')
    args = parser.parse_args()
    assert sys.platform == 'darwin', 'This test requires a native Mac'
    assert args.lib.is_absolute() and args.lib.is_file()
    assert args.ffmpeg.is_absolute() and args.ffmpeg.is_file()
    args.work_dir.mkdir(mode=0o700, parents=True, exist_ok=False)
    report = {'scope': 'Generated audio only; muted output; no Atmos-object, Bluetooth-codec or listening-quality test',
              'cases': [], 'pass': False}
    player = None
    try:
        fixtures, multi = make_fixtures(args.ffmpeg, args.work_dir)
        player = Player(args.lib, args.output)
        decoded = player.get('decoder-list') or []
        report['audio_decoders'] = sorted({x['codec'] for x in decoded
                                          if x.get('codec') in {f[0] for f in fixtures}})
        for codec, channels, source in fixtures:
            assert codec in report['audio_decoders'], f'Missing decoder {codec}'
            player.command('loadfile', source)
            player.wait_for(lambda: player.get('audio-codec-name') == codec and (player.get('time-pos') or 0) > 0.05)
            decoded_params, output_params = player.get('audio-params') or {}, player.get('audio-out-params') or {}
            assert decoded_params.get('channel-count') == channels, codec
            assert output_params.get('samplerate') == 48000, codec
            assert output_params.get('channel-count', 0) > 0, codec
            assert player.get('volume') == 0
            report['cases'].append({'codec': codec, 'decoded': decoded_params, 'output': output_params,
                                    'driver': player.get('current-ao')})
        player.command('loadfile', multi, 'replace', '-1', 'aid=1')
        player.wait_for(lambda: player.get('audio-codec-name') == 'ac3' and (player.get('time-pos') or 0) > 0.05)
        player.command('set', 'pause', 'yes')
        player.wait_for(lambda: player.get('pause') is True)
        before = player.get('time-pos')
        time.sleep(0.2)
        assert abs((player.get('time-pos') or 0) - before) < 0.05, 'Pause must hold position'
        player.command('set', 'aid', 2)
        player.wait_for(lambda: player.get('audio-codec-name') == 'truehd')
        player.command('seek', '2', 'absolute+exact')
        player.command('set', 'pause', 'no')
        player.wait_for(lambda: (player.get('time-pos') or 0) >= 1.9)
        report['transport'] = {'pause': True, 'track_switch': 'ac3 -> truehd', 'seek': True}
        report['pass'] = True
    except Exception as error:
        report['error'] = f'{type(error).__name__}: {error}'
        raise
    finally:
        if player:
            player.close()
        (args.work_dir / 'RESULT.json').write_text(json.dumps(report, indent=2) + '\n')
        print(json.dumps({'pass': report['pass'], 'codecs': [x['codec'] for x in report['cases']],
                          'transport': report.get('transport'), 'error': report.get('error')}, indent=2))


if __name__ == '__main__':
    main()

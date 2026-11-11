#!/usr/bin/env python3
"""Compile and exercise the candidate's actual Mac AO decision block with mocks.

The mocked controller exposes the actual MpvQt method name. This checks state
transitions and error handling, not Qt compilation or native audio playback.
"""
import argparse
from pathlib import Path
import subprocess
import tempfile

HARNESS = r'''
#include <cassert>
#include <cstdlib>
#include <cstring>
#include <iostream>
#include <string>

struct QByteArray {
    std::string data;
    const char *constData() const { return data.c_str(); }
};
struct QString {
    std::string data;
    QString() = default;
    QString(const char *s) : data(s ? s : "") {}
    static QString fromUtf8(const char *s) { return QString(s); }
    QByteArray toUtf8() const { return {data}; }
    void clear() { data.clear(); }
    bool operator==(const char *rhs) const { return data == rhs; }
};
struct FakeMpv { std::string ao; bool readError = false; bool writeError = false; int writes = 0; };
struct MpvController {
    FakeMpv *native;
    FakeMpv *mpv() { return native; }
};
constexpr int MPV_FORMAT_STRING = 1;
int mpv_get_property(FakeMpv *mpv, const char *, int, char **result) {
    if (mpv->readError) return -1;
    *result = ::strdup(mpv->ao.c_str());
    return 0;
}
int mpv_set_property_string(FakeMpv *mpv, const char *, const char *value) {
    if (mpv->writeError) return -1;
    mpv->ao = value;
    ++mpv->writes;
    return 0;
}
void mpv_free(void *ptr) { std::free(ptr); }
const char *mpv_error_string(int) { return "mock error"; }
struct Warning { template <typename T> Warning &operator<<(const T &) { return *this; } };
Warning qWarning() { return {}; }
struct Value {
    QString text;
    bool flag = false;
    QString toString() const { return text; }
    bool toBool() const { return flag; }
};
struct SettingsComponent {
    QString device = "auto", channels = "auto";
    bool enabled = false;
    static SettingsComponent &Get() { static SettingsComponent value; return value; }
    Value value(const char *, const char *name) const {
        if (std::strcmp(name, "device") == 0) return {device, false};
        if (std::strcmp(name, "channels") == 0) return {channels, false};
        if (std::strcmp(name, "spatialAudio") == 0) return {QString(), enabled};
        std::abort();
    }
};
#define SETTINGS_SECTION_AUDIO "audio"
#define AUDIO_DEVICE_TYPE_BASIC "basic"
struct Player {
    FakeMpv native;
    MpvController controller{&native};
    MpvController *m_mpv = &controller;
    bool m_spatialAudioAO = false;
    QString m_savedSpatialAudioAO;
    QString deviceType = "basic";
    bool exclusive = false;
    void update() {
        /* ACTUAL_BLOCK */
    }
};
int main() {
    auto &s = SettingsComponent::Get();
    Player p;
    p.native.ao = "";
    p.update();
    assert(p.native.writes == 0 && !p.m_spatialAudioAO);
    s.enabled = true;
    p.update();
    assert(p.native.ao == "avfoundation,coreaudio," && p.m_spatialAudioAO);
    p.update();
    assert(p.native.writes == 1);
    s.enabled = false;
    p.update();
    assert(p.native.ao.empty() && !p.m_spatialAudioAO);
    p.native.ao = "coreaudio";
    s.enabled = true;
    p.update();
    s.enabled = false;
    p.update();
    assert(p.native.ao == "coreaudio" && !p.m_spatialAudioAO);
    s.enabled = true;
    s.device = "explicit";
    int writes = p.native.writes;
    p.update();
    assert(p.native.writes == writes && !p.m_spatialAudioAO);
    s.device = "auto";
    p.exclusive = true;
    p.update();
    assert(p.native.writes == writes && !p.m_spatialAudioAO);
    p.exclusive = false;
    p.native.readError = true;
    p.update();
    assert(!p.m_spatialAudioAO && p.native.writes == writes);
    p.native.readError = false;
    p.native.writeError = true;
    p.update();
    assert(!p.m_spatialAudioAO && p.native.ao == "coreaudio");
    p.native.writeError = false;
    p.update();
    assert(p.m_spatialAudioAO);
    s.enabled = false;
    p.native.writeError = true;
    p.update();
    assert(p.m_spatialAudioAO);
    p.native.writeError = false;
    p.update();
    assert(!p.m_spatialAudioAO && p.native.ao == "coreaudio");
    std::cout << "PASS: AO activation, restoration, eligibility and failure handling\\n";
}
'''


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    args = parser.parse_args()
    text = (args.source / "src/player/PlayerComponent.cpp").read_text()
    scope = text[text.index("void PlayerComponent::setAudioConfiguration()"):]
    begin = scope.index("#ifdef Q_OS_MAC") + len("#ifdef Q_OS_MAC")
    end = scope.index("#endif", begin)
    block = scope[begin:end]
    if "spatialAudio" not in block or "mpv_set_property_string" not in block:
        raise SystemExit("Expected candidate AO decision block not found")
    program = HARNESS.replace("/* ACTUAL_BLOCK */", block)
    with tempfile.TemporaryDirectory(prefix="deepstream-audio-test-") as temp:
        source = Path(temp) / "test.cpp"
        binary = Path(temp) / "test"
        source.write_text(program)
        subprocess.run(["g++", "-std=c++17", "-Wall", "-Wextra", "-Werror",
                        str(source), "-o", str(binary)], check=True)
        subprocess.run([str(binary)], check=True)
    print("Scope: mocked libmpv decision block; not a native macOS playback test.")


if __name__ == "__main__":
    main()

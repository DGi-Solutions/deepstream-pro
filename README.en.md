<p align="center"><img src="docs/assets/deepstream-pro.png" alt="DeepStream Pro" width="180"></p>
<p align="center">by <a href="https://dgi-solutions.de"><img src="docs/assets/dgi-solutions-logo.png" alt="DGi Solutions" width="170"></a></p>

# DeepStream Pro

[Deutsch](README.md) · English

**A movie player for macOS with a focus on high-quality sound.**

DeepStream Pro plays films and series from your Jellyfin server. It is a public fork of [Jellyfin Desktop](https://github.com/jellyfin/jellyfin-desktop), developed further by [DGi Solutions](https://dgi-solutions.de).

## Platform and status

DeepStream Pro is developed exclusively for **macOS**. Native testing so far has been on Apple Silicon. The project is in development: the source code is public, but no installable download has been released yet.

The app uses Qt WebEngine and libmpv. Movie pages show available audio and video details. Audio track selection considers the chosen language and available decoders; manual selection remains available.

## Spatial Audio and movie sound

The experimental Spatial Audio output sends decoded multichannel PCM to macOS. Supported AirPods can use the macOS **Fixed** and **Head Tracked** modes. An Atmos or DTS:X source label alone does not establish that its object metadata is being rendered.

A native Apple audio path for Dolby Digital Plus (E-AC-3) with Atmos/JOC is in development for **0.3**. Picture, sound, pause, seek and restarting playback were tested in a separate app; macOS displayed “Dolby Atmos”. Integration with authenticated Jellyfin streams is still underway.

TrueHD/Atmos and DTS:X are currently decoded to channel audio. Rendering their object metadata has not yet been established. [Audio architecture](docs/AUDIO-ARCHITECTURE.md) (German; status as of November 11)

## Coming next: 0.4

Dolby Vision, end-to-end HDR output and opening local movie files are planned for **0.4**. A 10-bit source or framebuffer alone does not confirm Dolby Vision output.

## Downloads

There are **no published downloads** on the [releases page](https://github.com/DGi-Solutions/deepstream-pro/releases) yet. GitHub source archives are not installable apps. When a package is published, its release will include version, checksums, signing and Apple notarization information.

## Building

The native build used so far requires an Apple Silicon Mac, the macOS SDK, Qt 6 with WebEngine, libmpv, CMake, Ninja and pkg-config. Versions and instructions are in the [build guide](dev/macos/README-deepstream.md) (German).

## Contributing and license

Bug reports and contributions are welcome: [CONTRIBUTING.md](CONTRIBUTING.md). Please keep private media, credentials, profiles and unfiltered logs out of public issues and pull requests.

DeepStream Pro builds on the work of Jellyfin Desktop and its contributors. [Origin and upstream](docs/UPSTREAM.md) · [GNU GPL v2](LICENSE)

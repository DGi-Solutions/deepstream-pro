<p align="center"><img src="docs/assets/deepstream-pro.png" alt="DeepStream Pro" width="180"></p>
<p align="center">by <a href="https://dgi-solutions.de"><img src="docs/assets/dgi-solutions-logo.png" alt="DGi Solutions" width="170"></a></p>

# DeepStream Pro

[English](README.en.md) · Deutsch

**Ein Filmplayer für macOS mit besonderem Augenmerk auf hochwertigen Ton.**

DeepStream Pro spielt Filme und Serien von deinem Jellyfin-Server ab. Das Projekt ist ein öffentlicher Fork von [Jellyfin Desktop](https://github.com/jellyfin/jellyfin-desktop), den [DGi Solutions](https://dgi-solutions.de) weiterentwickelt.

## Plattform und Stand

DeepStream Pro wird ausschließlich für **macOS** entwickelt. Der bisherige native Teststand läuft auf Apple Silicon. Das Projekt ist in Entwicklung; der Quellcode ist öffentlich, ein installierbarer Download wurde noch nicht veröffentlicht.

Die App nutzt Qt WebEngine und libmpv. Die Filmseite zeigt die verfügbaren Audio- und Videodaten. Die Tonspurauswahl berücksichtigt die gewählte Sprache und die verfügbaren Decoder. Eine manuelle Auswahl bleibt möglich.

## Spatial Audio und Filmton

Die experimentelle Spatial-Audio-Ausgabe gibt decodierten Mehrkanalton als PCM an macOS weiter. Mit unterstützten AirPods stehen die macOS-Modi **Fixed** und **Head Tracked** zur Verfügung. Aus einer Atmos- oder DTS:X-Kennung der Quelle lässt sich dabei nicht auf die Verarbeitung ihrer Objektdaten schließen.

Für **0.3** entsteht ein nativer Apple-Audioweg für Dolby Digital Plus (E-AC-3) mit Atmos/JOC. Bild, Ton, Pause, Springen und Neustart wurden in einer separaten App getestet; macOS zeigte „Dolby Atmos“ an. Die Anbindung an angemeldete Jellyfin-Streams ist noch in Arbeit.

TrueHD/Atmos und DTS:X werden bisher zu Kanalton decodiert. Die Verarbeitung ihrer Objektdaten ist noch nicht nachgewiesen. [Mehr zur Audio-Architektur](docs/AUDIO-ARCHITECTURE.md) (Stand: 11. November)

## Ausblick: 0.4

Für **0.4** sind Dolby Vision, die durchgängige HDR-Ausgabe und das Öffnen lokaler Filmdateien vorgesehen. Ein 10-Bit-Quellformat oder Bildpuffer allein bestätigt noch keine Dolby-Vision-Ausgabe.

## Downloads

Auf der [Release-Seite](https://github.com/DGi-Solutions/deepstream-pro/releases) gibt es derzeit **keine veröffentlichten Downloads**. Quellcode-Archive sind keine installierbaren Apps. Sobald ein Paket erscheint, stehen Version, Prüfsummen sowie Angaben zu Signatur und Apple-Notarisierung bei der jeweiligen Veröffentlichung.

## Selbst bauen

Der bisherige native Build verwendet einen Apple-Silicon-Mac, das macOS SDK, Qt 6 mit WebEngine, libmpv, CMake, Ninja und pkg-config. Details und Versionen stehen in der [Build-Anleitung](dev/macos/README-deepstream.md).

## Mitwirken und Lizenz

Fehlerberichte und Beiträge sind willkommen: [CONTRIBUTING.md](CONTRIBUTING.md). Bitte keine privaten Medien, Zugangsdaten, Profile oder ungefilterten Logs öffentlich teilen.

DeepStream Pro baut auf der Arbeit von Jellyfin Desktop und seinen Mitwirkenden auf. [Herkunft und Upstream](docs/UPSTREAM.md) · [GNU GPL v2](LICENSE)

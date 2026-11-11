<p align="center"><img src="docs/assets/deepstream-pro.png" alt="DeepStream Pro" width="180"></p>
<p align="center">by <a href="https://dgi-solutions.de"><img src="docs/assets/dgi-solutions-logo.png" alt="DGi Solutions" width="170"></a></p>

# DeepStream Pro

**Ein audiophiler Filmplayer für macOS – entwickelt von [DGi Solutions](https://dgi-solutions.de).**

DeepStream Pro wird für Filmfreunde entwickelt, die hochwertige Tonspuren auf dem Mac nutzen wollen – mit Kopfhörern, AirPods, einem USB-DAC oder einer Heimkinoanlage. Die integrierte Audio-Engine soll Tonspur und Ausgabegerät aufeinander abstimmen und zeigen, wie der Ton tatsächlich wiedergegeben wird.

Die heutige Prüffassung nutzt die Medienauswahl eines verbundenen Jellyfin-Servers. Das direkte Öffnen lokaler Filme oder von NAS-Freigaben ohne diesen Serverweg ist noch nicht als Nutzerablauf umgesetzt und geprüft.

Das Projekt ist ein eigenständig weiterentwickelter, öffentlicher Fork von [Jellyfin Desktop](https://github.com/jellyfin/jellyfin-desktop). Es befindet sich in aktiver Entwicklung.

## Plattform

**DeepStream Pro wird ausschließlich für macOS entwickelt.** Der aktuelle native Teststand ist für Apple Silicon mit macOS 27 gebaut. Weitere Mac-Konfigurationen werden erst nach entsprechender Prüfung als unterstützt aufgeführt.

## Aktueller Teststand

- Separate App **DeepStream Pro** mit eigenem Profil und eigener App-Identität.
- Native Videowiedergabe mit Qt WebEngine und libmpv.
- **Spatial Audio für AirPods:** räumlicher Filmton mit den macOS-Modi „Fixed“ und „Head Tracked“; derzeit experimentell.
- Automatische Tonspurauswahl anhand der verfügbaren Decoder, in der gewählten Sprache.
- Anzeige von Decoder, Audiotreiber, Kanalzahl, PCM-Format und Abtastrate.
- Korrigierte Trailer-Ansteuerung und native Paketierung.

Filmwiedergabe, Trailer, Pause, Spulen und Tonspurwechsel wurden auf dem Mac geprüft. Audiotests über AVFoundation bestehen für TrueHD, Dolby Digital Plus, Dolby Digital, DTS, FLAC, ALAC, AAC und PCM.

## Spatial Audio

DeepStream Pro gibt Mehrkanalton über AVFoundation an macOS weiter. Mit AirPods lässt sich der Ton räumlich wiedergeben: mit fester Ausrichtung über **Fixed** oder mit Kopfverfolgung über **Head Tracked**. Die Ausgabe lässt sich in den Audioeinstellungen einschalten.

Die aktuelle Spatial-Audio-Ausgabe verwendet Mehrkanal-PCM. Die Verarbeitung von Atmos- und DTS:X-Objektdaten ist der nächste Schritt der Audio-Engine.

## In Entwicklung: DeepStream Audio Engine

Unsere integrierte Audio-Engine soll Tonspuren und Ausgabegerät gemeinsam berücksichtigen:

- automatische Formatwahl innerhalb der gewünschten Sprache,
- Atmos und DTS:X, wenn der tatsächlich verfügbare Wiedergabeweg die räumlichen Informationen verarbeitet,
- passende Rückfälle für TrueHD, DTS-HD MA/HRA, Dolby Digital Plus (E-AC-3), Dolby Digital (AC-3), DTS, FLAC, ALAC, PCM und AAC,
- neutrale Wiedergabe sowie getrennte, bewusst gewählte Klangbearbeitung,
- Ausgabeprofile für Kopfhörer, integrierte Lautsprecher, USB-Audiogeräte und HDMI,
- verständliche Anzeige von Quelle, Verarbeitung und Ausgabe.

Die Tonspurauswahl ist im aktuellen Entwicklungsstand umgesetzt. Geräteprofile, ein vollständiger Fehler-Rückfall und der native Objekt-Audio-Weg sind weitere Entwicklungsschritte. Details: [Audio-Architektur](docs/AUDIO-ARCHITECTURE.md) und [Projektstatus](docs/STATUS.md).

## Downloads

Es gibt derzeit **keine stabile öffentliche Veröffentlichung**. Geprüfte macOS-Prüffassungen werden ausschließlich in den [Releases dieses Projekts](https://github.com/DGi-Solutions/deepstream-pro/releases) bereitgestellt, sobald sie veröffentlicht sind.

Quellcode-Archive von GitHub sind keine installierbaren Apps. Jede Prüffassung erhält eigene Angaben zu Version, Prüfsumme, getesteten Macs und Signaturstatus.

## Selbst bauen

Der native Build benötigt einen Apple-Silicon-Mac, macOS SDK 27 oder neuer, Qt 6.11.3 mit WebEngine sowie libmpv, CMake, Ninja und pkg-config. [Build-Anleitung](dev/macos/README-deepstream.md).

## Mitwirken

Fehlerberichte und Beiträge sind willkommen. Bitte beachte [CONTRIBUTING.md](CONTRIBUTING.md). Keine Filmdateien, Zugangsdaten, privaten Profile oder ungefilterten Diagnoselogs in öffentliche Issues oder Pull Requests laden.

## Herkunft und Lizenz

DeepStream Pro baut auf der Arbeit von Jellyfin Desktop und dessen Mitwirkenden auf. Herkunft, Basisstand und unsere Änderungen sind unter [UPSTREAM.md](docs/UPSTREAM.md) dokumentiert. Die vorhandene [GNU GPL v2](LICENSE) und weitere Komponentenhinweise bleiben erhalten.

**DeepStream Pro by DGi Solutions** · [dgi-solutions.de](https://dgi-solutions.de)

# DeepStream Pro für macOS bauen

## Voraussetzungen

- Apple Silicon und macOS SDK 27 oder neuer.
- Qt 6.11.3 mit WebEngine, WebChannel und Positioning.
- libmpv mit AVFoundation-Ausgang und eine passende FFmpeg-Laufzeit.
- CMake, Ninja, pkg-config, Python 3, `patch` und Apples Command Line Tools.

Bestehende Homebrew-Installationen erhalten. Wenn eine eigene FFmpeg-Installation verwendet wird, sind inkompatible Core-Pakete nicht darüberzuinstallieren; eine getrennte SDK-Ablage kann über `PKG_CONFIG_PATH` gewählt werden.

## Build

Nach einem frischen Checkout das benötigte Submodul initialisieren:

```sh
git submodule update --init external/mpvqt
```

Der Build prüft die Version der mpvqt-Quellen und wendet die mitgelieferten Anpassungen auf eine separate Kopie an.

```sh
mkdir -p /absolute/path/to/new-output
DEEPSTREAM_QTROOT=/absolute/path/to/Qt/6.11.3/macos \
  sh dev/macos/build-deepstream.sh /absolute/path/to/new-output
```

Das Ausgabeverzeichnis muss existieren und darf noch keine gleichnamige App bzw. ZIP enthalten. Der Build erstellt eine separate `DeepStream Pro.app` und `DeepStream-Pro-macOS-arm64.zip`.

Die Paketierung bündelt die Laufzeitbibliotheken und bereinigt Verweise auf den Buildrechner. Nur die neue App wird ad hoc signiert; bestehende Nutzer-Apps werden nicht ersetzt. Ad-hoc-Signatur bedeutet keine Developer-ID-Signatur oder Notarisierung.

## Prüfung

Quellprüfungen liegen unter `tests/deepstream-*`. Die fertige App benötigt zusätzlich einen nativen Start- und Wiedergabetest. Die tatsächliche Audioausgabe, Gerätewechsel und Bild-Ton-Synchronität sind dabei zu prüfen; eine bestandene Übersetzung reicht dafür nicht.

# DeepStream Pro auf macOS bauen

Die aktuelle Anleitung steht unter [README-deepstream.md](README-deepstream.md). Der geprüfte Stand verwendet Apple Silicon, macOS SDK 27, Qt 6.11.3 und libmpv mit AVFoundation.

Der Befehl `build-deepstream.sh` erstellt eine separat benannte App mit eigener App- und Profil-Identität. Die ursprünglichen Upstream-Skripte in diesem Verzeichnis bleiben aus Herkunftsgründen erhalten; sie sind nicht die Anleitung für diese Prüffassung.

Daten liegen pro Profil unter `~/Library/Application Support/DeepStream Pro/profiles/`, Logs unter `~/Library/Logs/DeepStream Pro/profiles/`. Private Profile und Rohlogs nicht veröffentlichen.

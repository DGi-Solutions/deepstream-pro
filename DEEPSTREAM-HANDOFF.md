# DeepStream Pro: Übergabe

Öffentliches Projekt: https://github.com/DGi-Solutions/deepstream-pro

## Arbeitsstand

Die App wird eigenständig für macOS weiterentwickelt. Technische Grundlage ist Jellyfin Desktop; Herkunft und gebundene Komponenten stehen in [docs/UPSTREAM.md](docs/UPSTREAM.md). App-Identität und Profilbereich von DeepStream Pro sind getrennt. Die ursprüngliche Jellyfin-App und reale Profile bleiben erhalten.

Der aktuelle Ausbau ergänzt Tonspurautomatik und Anzeige des tatsächlichen Audioausgangs. Architektur und offene Punkte stehen in [docs/AUDIO-ARCHITECTURE.md](docs/AUDIO-ARCHITECTURE.md) und [docs/STATUS.md](docs/STATUS.md). Die Website soll den audiophilen Filmplayer und seinen Nutzen vorstellen. Der heutige Jellyfin-Serverweg ist die technische Ausgangslage; direkte lokale Datei- oder NAS-Auswahl ohne Server ist noch nicht als Nutzerablauf geprüft.

## Quellprüfungen

```sh
node tests/deepstream-audio-engine.test.js
node tests/deepstream-audio-player.test.js
node tests/deepstream-inputPlugin.test.js
python3 tests/deepstream_check_mpvqt_api.py --source .
python3 tests/deepstream_test_audio_state.py --source .
python3 -m json.tool resources/settings/settings_description.json >/dev/null
git diff --check
```

Das mpvqt-Submodul muss zuvor am gebundenen Commit ausgecheckt sein. CTest registriert die JavaScript-Tests, wenn Node vorhanden ist.

## Native Prüfung

[Mac-Build](dev/macos/README-deepstream.md). Die Testkopie und endgültige Artefakte erhalten ein Dateimanifest mit Quelle und Prüfsummen. Dauerhafte Ablage ist auf der VM; auf dem Mac bleiben nur die für den konkreten Test benötigten Dateien.

`tests/deepstream-audio-native.py` erzeugt Testsignale, verwendet keine Nutzerprofile und setzt die Ausgabe auf Lautstärke null. Der Test benötigt ein frisches Arbeitsverzeichnis. Beim Laden der gebündelten Bibliothek aus Python muss `DYLD_LIBRARY_PATH` ausschließlich auf das Frameworks-Verzeichnis dieser Prüffassung zeigen. Das ist der Testkontext für die Bibliotheksabhängigkeiten, keine Änderung der installierten App.

Eine bestandene Decodierung oder PCM-Ausgabe bestätigt keinen Atmos-/DTS:X-Objektton. Zum Abschluss gehören ein interaktiver Start, Filmwiedergabe, Untertitel, Gerätewechsel und Prüfung der Bild-Ton-Synchronität. Ergebnisse und verbleibende Grenzen werden zusammen mit dem konkreten Build festgehalten.

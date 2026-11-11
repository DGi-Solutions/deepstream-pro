# Projektstatus

Stand: 11. November 2026.

## Beobachtet

- Native Apple-Silicon-Prüffassung auf macOS 27.2.1 gebaut.
- Separate App-Identität und separater Profilbereich.
- Native Filmwiedergabe und Trailer funktionieren in der lokalen Prüfung.
- Nach Aktivierung der experimentellen Ausgabe: AVFoundation, 48 kHz, 7.1, acht PCM-Kanäle.
- macOS bietet räumliche Mehrkanalwiedergabe sowie Fixed/Head Tracked an. Der Wechsel über Off auf Fixed wurde bestätigt.
- Branded Build mit eigenem Icon: Arm64, Codesign-Prüfung und statische Bibliotheksprüfung bestanden. Dieser Zwischenstand enthält noch das vorherige Logo; das Schwarz-Gold-Design wird aktualisiert.

## Offen

- Der Höreindruck der räumlichen Ausgabe wurde als schal beschrieben und ist noch nicht abgenommen.
- Audioautomatik und integrierte DeepStream Audio Engine sind in Entwicklung.
- Kein bestätigter nativer Atmos-/DTS:X-Objektweg in diesem Build.
- Zusätzliche Codecs und Ausgabegeräte benötigen jeweils echte Wiedergabeprüfungen.
- Aktuelle Prüffassungen sind ad hoc signiert und nicht notarisiert.
- Es ist noch kein stabiles öffentliches Binärrelease veröffentlicht.

Ein erfolgreicher Build, eine Formatangabe oder eine aktivierte Betriebssystemoption ersetzen keine Prüfung des tatsächlich genutzten Signalwegs.

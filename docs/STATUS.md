# Projektstatus

Stand: 11. November 2026.

## Geprüft

- Separate Apple-Silicon-App auf macOS 27.2.1, mit eigenem Profilbereich.
- Film- und Trailerwiedergabe in der bisherigen Prüffassung.
- Tonspurautomatik: Sprache und Spurart bleiben erhalten. Eine manuelle Auswahl gilt für den laufenden Film. Die Automatik ändert nur direkt abgespielte Originalquellen; bei Umwandlung oder Remux bleibt die Serverauswahl erhalten.
- Formatwahl und Player-Anbindung bestehen die JavaScript-Tests, einschließlich falscher Metadaten, Spurnummern und abgebrochener Ladevorgänge.
- Der neue native Build besteht Codesign- und Bibliotheksprüfung. Vier Qt-Tests und drei JavaScript-Testgruppen bestehen. Die Testregistrierung wurde nach einem falschen Arbeitsverzeichnis korrigiert.
- Mit selbst erzeugten Testdateien: TrueHD, E-AC-3, AC-3, DTS, FLAC, ALAC, AAC und PCM über AVFoundation, jeweils 48 kHz und sechs bzw. acht decodierte Kanäle. Pause, Spulen und Wechsel zwischen AC-3 und TrueHD bestehen.
- Die Playerstatistik liest Decoder, Audiotreiber, PCM-Format, Kanalzahl und Abtastrate aus libmpv aus.

## Noch offen

- Der Nutzer beschreibt die räumliche Ausgabe weiterhin als schal. Eine Klangabnahme steht aus.
- Die genannten Codec-Tests enthalten keine Atmos- oder DTS:X-Objekte. Native Objektwiedergabe ist noch nicht bestätigt und wird durch die aktuelle Tonspurautomatik nicht ergänzt.
- Fehler einer konkreten Datei können trotz vorhandenem Decoder auftreten. Die Automatik ersetzt keine vollständige Wiedergabeprüfung aller Quellen und Geräte.
- Gerätewechsel, Bild-Ton-Synchronität und der aktuelle Filmton müssen mit der fertig integrierten App geprüft werden.
- Das neue Schwarz-Gold-Design wird integriert. Der bereits geprüfte Zwischenbuild hat noch nicht alle neuen Bedienelementfarben.
- Prüffassungen sind ad hoc signiert und nicht notarisiert. Es gibt noch kein stabiles öffentliches Binärrelease.

Die Protokolle der nativen Tests enthalten nur erzeugte Testsignale. Persönliche Filme und Profile gehören nicht in das Repository.

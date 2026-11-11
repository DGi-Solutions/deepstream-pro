# Projektstatus

Stand: 11. November 2026. Aktuelle native Prüffassung: **2.1.0-pre3**.

## Geprüft

- Separate Apple-Silicon-App auf macOS 27.2.1, mit eigenem Profilbereich. Die neue Prüffassung ist installiert und startet mit der vorhandenen Mediathek.
- Film- und Trailerwiedergabe in der bisherigen Prüffassung.
- Tonspurautomatik: Sprache und Spurart bleiben erhalten. Eine manuelle Auswahl gilt für den laufenden Film. Die Automatik ändert nur direkt abgespielte Originalquellen; bei Umwandlung oder Remux bleibt die Serverauswahl erhalten.
- Audiodetails vor dem Filmstart: Codec, Sprache, Kanalbelegung, Bitrate, Abtastrate, Bittiefe, Kompression und räumliche Quelldaten. Eine Vorschau zeigt die geplante Tonspur und Ausgabe. Alle Tonspuren lassen sich aufklappen.
- Die Audioansicht wurde im nativen Fenster mit erzeugten Metadaten und anschließend auf einer echten Filmseite geprüft. Der Nutzer bestätigt Audioinfos, kleineren Play-Button und funktionierende Zurück-Bedienung. Spur- und Filmversionswechsel, fehlende Angaben sowie verspätete Antworten nach Seiten- oder Kontowechsel sind durch Regressionen abgesichert.
- Sichtbare Zurück-Buttons und Escape im Einstellungsdialog. Der Dialogtest prüft außerdem Fokus, doppelte Dialoge und das Entfernen von Ereignisbehandlern. Der Play-Button auf der Filmseite ist rund und 42 Pixel groß.
- Der aktuelle Build besteht die Signatur- und Bibliotheksprüfung: 173 Mach-O-Dateien, keine Abhängigkeit vom Build-Rechner. Vier Qt-Tests und fünf JavaScript-Testgruppen bestehen.
- Mit selbst erzeugten Testdateien: TrueHD, E-AC-3, AC-3, DTS, FLAC, ALAC, AAC und PCM über AVFoundation, jeweils 48 kHz und sechs bzw. acht decodierte Kanäle. Pause, Spulen und Wechsel zwischen AC-3 und TrueHD bestehen.
- Die Playerstatistik liest Decoder, Audiotreiber, PCM-Format, Kanalzahl und Abtastrate aus libmpv aus. Die Spatial-Audio-Vorschau liest die tatsächlichen App-Einstellungen.
- Die neue Prüffassung, die bisherige Fassung als Rückweg und die Prüfberichte liegen auf der Codex-VM. Beide Archive wurden vollständig zurückgelesen und per SHA-256 verglichen.

## Noch offen

- Die Filmseite erhält auf Nutzerwunsch eine zusammenhängende grafische Überarbeitung; im Kopfbereich erscheint noch das Serverlogo.
- Der Nutzer beschreibt die räumliche Ausgabe weiterhin als schal. Eine Klangabnahme steht aus.
- Der aktuelle Spatial-Audio-Weg gibt kanalbasiertes PCM aus. Die Codec-Tests enthalten keine Atmos- oder DTS:X-Objekte. Die Verarbeitung dieser Objektdaten ist noch nicht umgesetzt.
- Fehler einer konkreten Datei können trotz vorhandenem Decoder auftreten. Ein vollständiger automatischer Rückfall bei Decoderfehlern fehlt noch.
- Gerätewechsel und Bild-Ton-Synchronität müssen mit der integrierten App geprüft werden.
- Prüffassungen sind ad hoc signiert und nicht notarisiert. Es gibt noch kein stabiles öffentliches Binärrelease.
- Die zugeordneten Mac-Testdateien bleiben für die direkt anschließende grafische Überarbeitung vorerst erhalten. Installierte App und echte Profile bleiben erhalten; dauerhafte Artefakte liegen auf der VM.

Die Protokolle der nativen Tests enthalten nur erzeugte Testsignale. Persönliche Filme und Profile gehören nicht in das Repository.

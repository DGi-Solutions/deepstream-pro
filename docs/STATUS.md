# Projektstatus

Stand: 13. November 2026. **0.3.0 ist gebaut und notariert; die Veröffentlichung steht noch aus.**

## Aktueller Entwicklungsstand

- Der experimentelle native DV-/Audiopfad bleibt standardmäßig ausgeschaltet. Der isolierte macOS-arm64-Build sowie sechs native und 67 JavaScript-Prüfungen bestanden; die integrierte Dolby-Vision-Ausgabe ist offen.
- Das HLS-Relay weist eine vollständige Serverantwort auf eine angeforderte Teilmenge zurück. Die gezielte Regression bestand mit synthetischen HTTP-Daten unter Linux und macOS.
- Im stummen Mac-Vergleich startete der Apple-Player eine synthetische E-AC-3-HLS-Kontrolle. Die TrueHD-HLS-Variante wurde vor dem Start mit einem CoreMedia-Fehler abgelehnt; hörbare Ausgabe und Atmos-Objektverarbeitung sind damit nicht geprüft.
- Der lokale DV-Remux bleibt ein Untersuchungskandidat. Bild- und Tonpakete konnten in synthetischen Tests erhalten werden; Zeitbasis, Sprungverhalten und integrierte Wiedergabe müssen noch nachgewiesen werden.
- Der 0.3.0-Installer ist mit Developer ID signiert und von Apple notarisiert; das hinterlegte Ticket wurde geprüft. Die Veröffentlichung steht noch aus.

## Installierte Prüffassung

Die bisherige macOS-Prüffassung bleibt während der getrennten 0.3-Entwicklung installiert. Film- und Trailerbild, Pause, Springen, der Spatial-Audio-Schalter auf der Filmseite und die überarbeitete Ansicht wurden auf dem Mac bestätigt.

- Eigenes App-Profil, Schwarz-Gold-Ansicht, eingebundenes Logo und Zurück-Bedienung.
- Audio- und Videodetails auf der Filmseite, bereinigte Tonspurnamen und automatisch bezogene Bilder vom verbundenen Server.
- Bildcache für Detailbilder: bis zu 64 Einträge. Dieser Cache ist von den Bildkacheln der Mediathek zu unterscheiden.
- Decoderbasierte Tonspurauswahl mit erhaltener Sprache und manueller Wahl. Der bisherige Spatial-Audio-Weg gibt kanalbasiertes PCM an macOS weiter.
- Klangbearbeitung ist wählbar und beim Neustart ausgeschaltet. Neutrale Wiedergabe bleibt der Ausgangspunkt.
- Die bisherige Prüffassung ist mit Developer ID signiert. Das 0.3.0-Releasepaket wurde separat signiert und notarisiert.

## 0.4: experimenteller nativer Apple-Audioweg

Ein öffentlicher E-AC-3/JOC-Teststream wurde inzwischen über die echte PlayerComponent im getrennten App-Test wiedergegeben. Der Nutzer bestätigte sichtbares Bild, hörbaren Ton und die macOS-Anzeige „Dolby Atmos“ mit AirPods. Die Testplaylist enthielt genau eine JOC-Audiorendition; AVFoundation bestätigte deren Auswahl. Ein angemeldeter HLS-Transport ist im abgeschalteten Integrationsstand vorhanden und mit synthetischen Daten geprüft.

Die Einbindung in PlayerComponent entsteht in einem getrennten Arbeitsstand. Ein expliziter Testbuild darf ausschließlich die festgelegte öffentliche Testquelle verwenden. Die native Seite prüft die abgerufene Masterplaylist per SHA-256. Der normale Build schaltet diesen Weg nicht durch eine JavaScript-Option frei.

Bereits geprüft:

- Sitzungsgebundene AVPlayer-Steuerung und WebChannel-Aufrufe für Wiedergabe, Pause und Springen mit erzeugten Medien.
- Getrennter mpv→AVPlayer→mpv-Versuch, einschließlich AV-Startfehler vor dem ersten Bild. Dabei war mpv auf Nullausgabe gestellt und AVPlayer stumm.
- JavaScript-Adapter: Testbuild-Grenze, einzelne E-AC-3-Spur, Untertitel aus, unveränderte Quellzuordnung und keine Weitergabe von Browser-Headern an die Testquelle.
- Die Wiedergabeinfo unterscheidet die aktive Engine. AVPlayer erhält keine alten mpv-Decoder-, PCM- oder Kanalwerte. Ein JOC-Quellnachweis bestätigt nicht automatisch die Objektverarbeitung.
- 128 JavaScript-Tests bestanden im aktuellen 0.3-Arbeitsstand. Fixture- und Default-OFF-App-Targets kompilieren auf macOS; der getrennte Produktionspfad mit normalen mpv-Treibern wird geprüft.
- Der mpv-Videopuffer wurde in einem isolierten Mac-Test mit GL-Readback geprüft: RGB 16/16/16, Testbild und Web-Bedienung sichtbar. Die endgültige Ausgabe bis zum Bildschirm bleibt offen.
- Der zusätzliche WebEngine-Renderlayer verdeckte die Web-Bedienleiste bei AVPlayer. Die Korrektur schaltet ihn gezielt im Apple-Pfad ab und stellt ihn beim Rückfall zu mpv wieder her. Die grüne Diagnosemarkierung gehört nicht zur Produktoberfläche.

Ein weiterer, noch abgeschalteter Integrationsschnitt bindet den bestehenden angemeldeten Client an einen nativen HLS-Transport. Der JavaScript-Adapter übernimmt die bereits ausgehandelte Medienquelle, Tonspur und Wiedergabesitzung. Er gibt den bestehenden Authorization-Header ausschließlich an einen separaten nativen Sitzungsaufruf. Der Header gehört weder in Ladeoptionen noch in dauerhafte Ablagen; vorhandene Quell-URLs können weiterhin Query-Anmeldedaten enthalten und dürfen nicht protokolliert werden. Abmelden, Nutzerwechsel, Stop, Timeout und Rückfall widerrufen die Bindung. Ein echter Jellyfin-Testserver lieferte eine passende HLS-Quelle; die ausgewählte synthetische E-AC-3-Spur wurde paketgleich übernommen. Der echte SDK-Aufruf erreichte den Server; die Prüfung der Antwort wird noch an dessen Format angepasst. Eine vollständige Wiedergabe über den integrierten Produktionspfad steht aus.

## Noch offen für 0.4

- Angemeldeten Sitzungswechsel und Fehler-Rückfall in der integrierten App abschließend prüfen. Bild, Web-Bedienleiste, Pause, Fortsetzen, Springen, Stop und erneuter Start sind im bisherigen Test durch den Nutzer bestätigt. Ein nativer Gegenversuch prüfte außerdem neue Startanforderungen während des Stoppens: Nur die jüngste Anforderung wird anschließend gestartet.
- Exklusiver Audioausgang beim Enginewechsel, einschließlich Gerätewechsel und Bild-Ton-Synchronität.
- Die passende angemeldete Jellyfin-HLS-Quelle in der integrierten App mit überprüfter Rendition und allen Segmenten wiedergeben. Der isolierte Servertest mit synthetischer Tonspur besteht; die Ende-zu-Ende-Prüfung steht noch aus.
- TrueHD/Atmos und DTS:X mit tatsächlicher Objektverarbeitung. Die vorhandene Decodierung dieser Träger zu Kanal-PCM bleibt der Rückfall.
- Klangprüfung des integrierten Wegs auf den vorgesehenen Ausgabegeräten.

Für **0.4** sind Dolby Vision, HDR-Ausgabe, objektbasierte TrueHD-/Atmos-Ausgabe und das Öffnen lokaler Filmdateien vorgesehen. Die 0.3-Fassung nutzt den bestehenden Player mit kanalbasiertem Spatial Audio.

Dauerhafte Build- und Prüfarbelege liegen auf der Codex-VM. Auf dem Mac bleiben nur die zugeordneten nativen Testdateien und benötigten Rückwege. Medien, Profile, Zugangsdaten und ungefilterte Logs gehören nicht in das Repository.

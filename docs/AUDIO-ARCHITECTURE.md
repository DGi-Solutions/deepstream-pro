# DeepStream Audio Engine

DeepStream Pro soll hochwertige Filmtonspuren auf dem Mac passend zum angeschlossenen Gerät wiedergeben. Die Engine verbindet Formaterkennung, Tonspurauswahl, Ausgabe und Diagnose. Die Quelle allein sagt noch nicht, was am Kopfhörer oder Verstärker ankommt.

## Tonspurauswahl

Die Einstellung **Tonspurauswahl → Automatisch** gilt beim nächsten Filmstart. Die Engine liest die tatsächlich vorhandenen libmpv-Decoder aus. Eine Atmos- oder DTS:X-Route wird nur bevorzugt, wenn der Renderer ausdrücklich als verfügbar und metadatenerhaltend gemeldet wird. Der derzeitige libmpv-Weg meldet keine solche Route.

Bei direkt abgespielten Originalquellen vergleicht die Engine interne Tonspuren derselben Sprache und Art. Hauptton, Kommentar, Audiodeskription und Hörgeschädigtenfassung werden getrennt behandelt. Anschließend zählen eine bestätigte Objektroute, Kanalzahl, verlustfreie Decodierung, Auflösung und Formatpräferenz. Die Bitrate wird erst nach dem Format verglichen. Ein freier Spurtitel gilt nicht als Atmos-Nachweis.

Eine manuelle Auswahl bleibt für die laufende Wiedergabe erhalten. Bei einem vom Server umgewandelten oder neu verpackten Stream wird keine Spur aus der Originaldatei angewählt, die im gelieferten Stream fehlen könnte. „Ton aus“ bleibt ausgeschaltet. Wenn Decoderinformationen fehlen, bleibt die bereits gewählte Spur erhalten.

Erkannt werden unter anderem TrueHD/Atmos, E-AC-3/Atmos, DTS:X, DTS-HD MA/HRA, AC-3, DTS, FLAC, ALAC, PCM, AAC und Opus. Erkennung und Decoderverfügbarkeit sind keine Bestätigung der Objektwiedergabe. Laufzeitfehler einer beschädigten Datei werden weiterhin vom bestehenden Playerfehlerweg behandelt; ein automatischer Wechsel bei jedem Decoderfehler ist noch nicht umgesetzt.

## Ausgabe

Die experimentelle Spatial-Audio-Einstellung wählt bei Basic, automatischem Gerät, automatischen Kanälen und ausgeschaltetem Exklusivmodus AVFoundation. CoreAudio und die automatische Treibersuche bleiben als Rückfall erhalten. Manuelle mpv-Ausgabeeinstellungen haben Vorrang. Dieser Weg gibt decodiertes, kanalbasiertes PCM aus.

Die Statistik zeigt die gewählte Quellspur sowie tatsächlichen Decoder, Audiotreiber, decodierte und ausgegebene Kanäle, PCM-Format und Abtastrate. Eine aktive Spatial-Audio-Option von macOS wird nicht als Nachweis verarbeiteter Atmos-Objekte ausgegeben.

Klangbearbeitung und Downmix-Pegelbegrenzung bleiben eigene Einstellungen. Aus PCM-Abtastrate oder Wortbreite werden weder Bluetooth-Codec noch Verlustfreiheit der Funkübertragung abgeleitet.

## Audioinformationen vor dem Start

Die Filmseite liest die Metadaten der gewählten Filmversion über den vorhandenen angemeldeten Client. Sie zeigt die ausgewählte Quellspur und die geplante automatische Auswahl getrennt. Codec, Sprache, Kanalbelegung, Bitrate, Abtastrate, Bittiefe und räumliche Quelldaten stammen aus den strukturierten Medieninformationen. Fehlende Werte bleiben als nicht angegeben erkennbar.

Die Vorschau verwendet die vorhandene Auswahlregel, die tatsächlichen App-Einstellungen und die gemeldeten Decoder. Die tatsächliche PCM-Ausgabe wird erst nach dem Start in der Wiedergabeinfo angezeigt. Ein später API-Rücklauf darf die Ansicht nach Film-, Versions- oder Kontowechsel nicht überschreiben. Die Ansicht startet keine Wiedergabe und ändert keine Serverdaten.

## 0.3: nativer Apple-Wiedergabeweg

Ein separater AVPlayer-Weg verwendet dieselbe Player-Instanz für Bild und Ton. Der experimentelle Adapter wird in PlayerComponent eingebunden; nach außen bleibt ein DeepStream-Player mit derselben Bedienung bestehen. mpv bleibt für die regulären Quellen und als Rückfall erhalten.

Der erste Integrationsschnitt ist auf einen expliziten Testbuild und eine einzelne öffentliche E-AC-3/JOC-Testquelle begrenzt. JavaScript übergibt einen eng geprüften Testauftrag; die native Seite prüft die abgerufene Masterplaylist gegen den festgelegten SHA-256-Wert. Die Testoption ist keine allgemeine HLS- oder Anmeldefunktion.

Der Enginewechsel benötigt eine bestätigte mpv-Stilllegung, getrennte Sitzungszustände und das Verwerfen verspäteter Ereignisse. Lautstärke, Stummstatus, Pause und Position müssen beim Übergang erhalten bleiben. Ein AV-Startfehler schließt den Apple-Weg vor dem Rückfall zu mpv. Die vollständige App-Anbindung wird gesondert nativ geprüft.

`getAudioSignalPath` meldet die aktive Engine und deren eigene Laufzeitwerte. Bei AVPlayer bleiben nicht ermittelte Decoder-, PCM- und Ausgabekanaldaten leer. Der Status `fixture_joc_declared` beschreibt die deklarierte JOC-Testquelle. `availableAudioOptions` und `selectedAudioOptions` geben die von AVFoundation ermittelten Auswahlzahlen getrennt an. Diese Angaben bestätigen keine Objektverarbeitung. `objectRenderingConfirmed` bleibt ohne eigenen Laufzeitnachweis falsch. Die Wiedergabeinfo verwirft späte Antworten nach Quellenwechsel oder Stop.

Die öffentliche Referenz wurde im isolierten App-Test über die echte PlayerComponent mit hörbarem Ton und der macOS-Anzeige „Dolby Atmos“ an AirPods geprüft. Der Nutzer bestätigte Bild und Web-Bedienleiste sowie Pause, Fortsetzen und Springen. Der zusätzliche WebEngine-Renderlayer wird im Apple-Pfad gezielt abgeschaltet und beim Rückweg wieder aktiviert. Die reguläre Jellyfin-Wiedergabe benötigt zusätzlich einen passenden E-AC-3/JOC-Transport, eine überprüfte Auswahl und eine unterstützte Anmeldung für Playlist und Segmente.

## Angemeldeter HLS-Transport in Entwicklung

`nativeAudioSession.js` verwendet ausschließlich den aktuell angemeldeten Jellyfin-Client und dessen vorhandenen SDK-Authorization-Header. Eine neue Anmeldung oder zusätzliche Tokenablage entsteht dadurch nicht. Die native Bindung muss Server, geladenen Hauptframe und Nutzer bestätigen. Ohne die explizite native Capability bleibt der bisherige mpv-Weg aktiv.

Der Adapter übernimmt nur eine bereits ausgehandelte, ausgewählte interne E-AC-3-Spur in einer passenden HLS-Quelle. Medienquelle, Tonspurindex, Startposition und PlaySessionId bleiben erhalten. Eine zweite versteckte PlaybackInfo-Sitzung wird nicht erzeugt. Eine Copy-Anforderung und die JOC-Deklaration der Quelle sind noch kein Nachweis für die gelieferte oder gerenderte Atmos-Ausgabe. Widersprüchliche Kanal-, Abtastraten- und Bitratenvorgaben lehnt der Adapter ab.

Der Header wird ausschließlich ephemer an `bindNativeAudioSession` übergeben; Ladeoptionen verwenden eine zufällige Bindungskennung. Vorhandene Query-Anmeldedaten auf der Quell-URL bleiben ein ausdrücklich zu schützender Teil des bestehenden Transports. Der Loopback-Transport darf sie weder offen in lokale URLs übernehmen noch an fremde Ziele weitergeben oder protokollieren. Abmelden und Nutzerwechsel über die Jellyfin-NativeShell-Hooks, Navigation, Stop, Timeout und ein Wechsel zum bisherigen Player verwerfen aktive und ausstehende Bindungen. Verspätete Rückmeldungen dürfen keine alte Wiedergabe starten.

Dieser Schnitt ist noch nicht für den regulären Betrieb freigegeben. Die Tests des JavaScript-Vertrags ersetzen weder einen nativen App-Build noch die Wiedergabe über einen angemeldeten Jellyfin-Server.

## Weitere Objektformate

Für TrueHD/Atmos und DTS:X wird ein geeigneter Decoder mit Objektverarbeitung benötigt. Eine gewöhnliche Umwandlung nach E-AC-3 erzeugt keine metadatentreue Atmos-Quelle. Neue Komponenten werden erst nach Prüfung von Version, Lizenz, Synchronität und tatsächlichem Ausgabeweg eingebaut. Bisher wurde keine zusätzliche Bibliothek dafür aufgenommen. Dolby Vision wird getrennt für 0.4 entwickelt.

## Prüfungen

Die JavaScript-Tests prüfen Auswahlregeln und den echten Playeradapter. Die native Prüfung erzeugt eigene Testdateien für acht Codecs und prüft Decodierung, PCM-Ausgabe, Pause, Spulen und Spurwechsel. Sie prüft weder Objektton noch Bluetooth-Codec oder Höreindruck. Interaktive Filmwiedergabe, Gerätewechsel und Bild-Ton-Synchronität bleiben gesonderte Prüfungen.

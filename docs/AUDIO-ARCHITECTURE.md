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

## Nächster Schritt: Objektton

E-AC-3 mit Atmos soll einen nativen Apple-Weg erhalten, der die räumlichen Metadaten verarbeitet. Für TrueHD/Atmos und DTS:X wird ein geeigneter Decoder mit Objektverarbeitung benötigt. Neue Komponenten werden erst nach Prüfung von Version, Lizenz, Synchronität und tatsächlichem Ausgabeweg eingebaut. Bisher wurde keine zusätzliche Bibliothek dafür aufgenommen.

## Prüfungen

Die JavaScript-Tests prüfen Auswahlregeln und den echten Playeradapter. Die native Prüfung erzeugt eigene Testdateien für acht Codecs und prüft Decodierung, PCM-Ausgabe, Pause, Spulen und Spurwechsel. Sie prüft weder Objektton noch Bluetooth-Codec oder Höreindruck. Interaktive Filmwiedergabe, Gerätewechsel und Bild-Ton-Synchronität bleiben gesonderte Prüfungen.

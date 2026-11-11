# DeepStream Audio Engine

## Ziel

Ein integrierter, quell- und ausgabegerätegerechter Audioweg für Filme auf macOS. Hohe Quellauflösung allein ist kein Qualitätsnachweis. Die Engine soll möglichst wenige unnötige Veränderungen vornehmen und ihren tatsächlichen Ausgabepfad benennen.

## Schichten

1. Quellinformationen: Codec, Formatprofil, Sprache, Kanäle und räumliche Metadaten.
2. Fähigkeiten: tatsächlich vorhandener Decoder/Renderer, Betriebssystem und Ausgabegerät.
3. Auswahl: manuelle Entscheidung oder automatische Auswahl innerhalb der gewünschten Sprache.
4. Wiedergabe: unveränderte Weitergabe, sofern unterstützt; sonst geeignete Dekodierung oder ein nachvollziehbarer Rückfall.
5. Diagnose: Quelle, gewählter Decoder, PCM-Format, Renderer und bekannte Transportgrenzen getrennt anzeigen.

## Formate

Atmos kann mit unterschiedlichen Trägerformaten vorkommen, insbesondere TrueHD und Dolby Digital Plus/E-AC-3. DTS:X und DTS-HD sind ebenfalls zu unterscheiden. Unterstütztes Dekodieren des Grundformats bedeutet nicht automatisch Auswertung der Objektmetadaten.

Die Automatik berücksichtigt TrueHD, DTS:X, DTS-HD MA/HRA, E-AC-3, AC-3, DTS, FLAC, ALAC, PCM, AAC und weitere tatsächlich verfügbare Decoder. Sie darf keine andere Sprache oder Kommentarspur allein für eine höhere Formatwertung wählen. Eine manuelle Wahl gilt für die laufende Wiedergabe.

## Aktueller und geplanter Weg

Der aktuelle Player verwendet libmpv und kann auf macOS kanalbasiertes PCM über AVFoundation ausgeben. Der native Objekt-Audio-Weg ist ein gesonderter Entwicklungsschritt. Eine Quelle wird nur dann als objektbasiert wiedergegeben ausgewiesen, wenn der verwendete Renderer das tatsächlich leistet.

Apple AVFoundation, Apples Positional Audio Codec und aktuelle offene Decoder-/Rendererprojekte werden auf Eignung, Lizenzverträglichkeit und native Integration geprüft. Es ist noch keine dieser neuen Bibliotheken als Produktabhängigkeit aufgenommen.

## Neutrale Wiedergabe

Klangbearbeitung, Normalisierung, Lautheitsanpassung und räumliche Verarbeitung müssen bewusst wählbar und von unveränderter Weitergabe unterscheidbar sein. Für Bluetooth, USB und HDMI werden Fähigkeiten festgestellt; es werden weder Codec noch Verlustfreiheit aus einer angezeigten PCM-Abtastrate abgeleitet.

## Prüfungen

Formatwahl, Sprache, manuelle Auswahl, geordneter Rückfall und fehlerhafte Metadaten werden automatisiert geprüft. Native Abnahme umfasst Start, Pause, Seek, Bild-Ton-Synchronität, Gerätewechsel und die tatsächlich ausgegebenen Kanäle. Höreindrücke werden getrennt von technischen Messwerten dokumentiert.

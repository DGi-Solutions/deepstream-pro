/* DeepStream labels follow the language selected in the Jellyfin client. */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.DeepStreamLocale = factory();
})(typeof window === 'object' ? window : null, function () {
    'use strict';
    const english = {
        'Profil': 'Profile', 'Auflösung': 'Resolution', 'Bildrate': 'Frame rate',
        'Pixelformat': 'Pixel format', 'Dynamikumfang': 'Dynamic range', 'Farbraum': 'Colour space',
        'Transferfunktion': 'Transfer function', 'Primärfarben': 'Colour primaries', 'Seitenverhältnis': 'Aspect ratio',
        'Dolby-Vision-Profil': 'Dolby Vision profile', 'Dolby-Vision-Level': 'Dolby Vision level',
        'Videodetails': 'Video details', 'Wiedergabeweg': 'Playback path', 'Tonspur': 'Audio track',
        'Videospur': 'Video track', 'Dolby-Vision-Ausgabe': 'Dolby Vision output',
        'Dolby-Vision-Angebot im Stream': 'Dolby Vision offered by stream', 'Nicht erkannt': 'Not detected',
        'Zuletzt beobachtete HLS-Variante': 'Last observed HLS variant',
        'Dolby-Vision-Quelldeklaration': 'Dolby Vision source declaration',
        'Dolby-Vision-Konfiguration in gewählter Videospur erkannt': 'Dolby Vision configuration detected in the selected video track',
        'Dolby-Vision-Profil dieser Videospur nicht unterstützt': 'Dolby Vision profile in this video track is not supported',
        'Gewähltes Dolby-Vision-Format nicht bestätigt': 'Selected Dolby Vision format not confirmed',
        'Verarbeitung': 'Processing', 'Ausgabe': 'Output', 'Decodierung zu PCM': 'Decoding to PCM', 'Decoder': 'Decoder',
        'Geplant vor dem Start. Die laufende Ausgabe steht in der Wiedergabeinfo.': 'Planned before playback. Open playback information for the current output.',
        'PCM ist der decodierte Ton, den macOS an das Ausgabegerät weitergibt.': 'PCM is the decoded audio that macOS sends to your output device.',
        'Nicht angegeben': 'Not specified', 'Deutsch': 'German', 'Englisch': 'English',
        'Französisch': 'French', 'Spanisch': 'Spanish', 'Italienisch': 'Italian', 'Japanisch': 'Japanese',
        'Kanäle': 'Channels', 'Kommentar': 'Commentary', 'Audiodeskription': 'Audio description',
        'Hörgeschädigtenfassung': 'Hearing impaired', 'Sprache': 'Language', 'Bitrate': 'Bitrate',
        'Abtastrate': 'Sample rate', 'Bittiefe': 'Bit depth', 'Kompression': 'Compression',
        'Verlustfrei': 'Lossless', 'Verlustbehaftet': 'Lossy',
        'Räumliche Metadaten der Quelle': 'Spatial metadata in the source',
        'Benutzerdefinierter Audioausgang': 'Custom audio output', 'Mehrkanal-PCM': 'Multichannel PCM',
        'Stereo-PCM': 'Stereo PCM', 'HDMI nach Ausgabeeinstellung': 'HDMI according to output settings',
        'S/PDIF nach Ausgabeeinstellung': 'S/PDIF according to output settings',
        'PCM über die gewählte Audioausgabe': 'PCM through the selected audio output',
        'Manuell': 'Manual', 'Automatisch': 'Automatic', 'Noch nicht geprüft': 'Not checked yet',
        'Verfügbar': 'Available', 'Kein lokaler Decoder gemeldet': 'No local decoder reported',
        'Audiodetails': 'Audio details', 'Keine Audiodaten verfügbar.': 'No audio information available.',
        'Ausgabevorschau': 'Output preview', 'Tonspurauswahl': 'Audio track selection',
        'Audioausgabe': 'Audio output', 'Wiedergabe': 'Playback', 'Alle Tonspuren': 'All audio tracks',
        'Nach dem Start zeigt die Wiedergabeinfo die tatsächliche Ausgabe.': 'Playback information shows the actual output once playback starts.',
        'Audiodaten konnten nicht geladen werden.': 'Audio information could not be loaded.',
        'Zurück': 'Back', 'Schließen': 'Close', 'Einstellungen': 'Settings',
        'Gewählte Tonspur': 'Selected audio track', 'Ausgabekanäle': 'Output channels',
        'Ausgabeformat': 'Output format', 'Abtastrate der Ausgabe': 'Output sample rate',
        'Objektwiedergabe': 'Object audio rendering', 'Bestätigt': 'Confirmed', 'Nicht bestätigt': 'Not confirmed',
        'Wiedergabe-Engine': 'Playback engine', 'Audioquelle im Stream': 'Audio source in the stream',
        'E-AC-3 / JOC · Playlist und Auswahl bestätigt': 'E-AC-3 / JOC · playlist and selection verified',
        'E-AC-3 / JOC · Testquelle': 'E-AC-3 / JOC · test source', 'Ausgewählte Tonspuren': 'Selected audio tracks',
        'Manuelle Auswahl': 'Manual selection', 'Sprache beibehalten': 'Language preserved',
        'Passender Decoder': 'Matching decoder', 'Serverauswahl': 'Server selection',
        'Vom Server': 'Selected by server', 'Audioausgang': 'Audio output', 'Decodierte Kanäle': 'Decoded channels',
        'Unverändert (Decoder noch nicht bekannt)': 'Unchanged (decoder not known yet)',
        'Unverändert (keine passende Alternative)': 'Unchanged (no suitable alternative)'
    };
    function language(win) {
        const selected = win.document?.documentElement?.lang || win.navigator?.language || 'en';
        return /^de(?:[-_]|$)/i.test(selected) ? 'de' : 'en';
    }
    function text(value, lang = 'de') {
        return lang === 'de' ? value : english[value] || value;
    }
    return Object.freeze({language, text});
});
